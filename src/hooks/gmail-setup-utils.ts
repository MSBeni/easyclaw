import { randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { hasBinary } from "../agents/skills.js";
import { resolveOAuthDir } from "../config/paths.js";
import { findTailscaleBinary } from "../infra/tailscale.js";
import { runCommandWithTimeout, type SpawnResult } from "../process/exec.js";
import { ensureDir, resolveUserPath } from "../utils.js";
import { normalizeServePath, OPENCLAW_GOG_CLIENT } from "./gmail.js";

let cachedPythonPath: string | null | undefined;
let cachedGogFileKeyringConfigured: boolean | undefined;
let cachedGogKeyringPassword: string | null | undefined;
const MAX_OUTPUT_CHARS = 800;
const GOG_KEYRING_PASSWORD_FILENAME = "gog-keyring-password";

export function resetGmailSetupUtilsCachesForTest(): void {
  cachedPythonPath = undefined;
  cachedGogFileKeyringConfigured = undefined;
  cachedGogKeyringPassword = undefined;
}

function trimOutput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.length <= MAX_OUTPUT_CHARS) {
    return trimmed;
  }
  return `${trimmed.slice(0, MAX_OUTPUT_CHARS)}…`;
}

function formatCommandResultInternal(
  command: string,
  result: SpawnResult,
  statusLabel: "failed" | "exited",
): string {
  const code = result.code ?? "null";
  const signal = result.signal ? `, signal=${result.signal}` : "";
  const killed = result.killed ? ", killed=true" : "";
  const stderr = trimOutput(result.stderr);
  const stdout = trimOutput(result.stdout);
  const lines = [`${command} ${statusLabel} (code=${code}${signal}${killed})`];
  if (stderr) {
    lines.push(`stderr: ${stderr}`);
  }
  if (stdout) {
    lines.push(`stdout: ${stdout}`);
  }
  return lines.join("\n");
}

function formatCommandFailure(command: string, result: SpawnResult): string {
  return formatCommandResultInternal(command, result, "failed");
}

function formatCommandResult(command: string, result: SpawnResult): string {
  return formatCommandResultInternal(command, result, "exited");
}

function formatJsonParseFailure(command: string, result: SpawnResult, err: unknown): string {
  const reason = err instanceof Error ? err.message : String(err);
  return `${command} returned invalid JSON: ${reason}\n${formatCommandResult(command, result)}`;
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}

function trimTrailingPunctuation(value: string): string {
  return value.replace(/[)\],.;]+$/g, "");
}

export function extractTailscaleFunnelEnableUrl(message: string): string | null {
  const match = message.match(/https:\/\/login\.tailscale\.com\/[^\s"'<>]+/i);
  if (!match) {
    return null;
  }
  return trimTrailingPunctuation(match[0]);
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10 || a === 127) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  }
  return false;
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:")
  );
}

export function validatePublicPushEndpoint(value: string):
  | {
      ok: true;
      normalized: string;
    }
  | {
      ok: false;
      error: string;
    } {
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: true, normalized: "" };
  }
  if (!/^https:\/\//i.test(trimmed)) {
    return {
      ok: false,
      error:
        "Public Push Endpoint must be a full public HTTPS URL, not just a host or IP address. Example: https://your-host.example/gmail-pubsub?token=...",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      ok: false,
      error:
        "Public Push Endpoint must be a valid public HTTPS URL. Example: https://your-host.example/gmail-pubsub?token=...",
    };
  }

  if (parsed.protocol !== "https:") {
    return {
      ok: false,
      error:
        "Public Push Endpoint must start with https:// so Google Pub/Sub can deliver push requests securely.",
    };
  }

  const hostname = parsed.hostname.trim().toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".local")) {
    return {
      ok: false,
      error:
        "Public Push Endpoint must be reachable from the public internet. Localhost and .local addresses will not work.",
    };
  }

  const ipVersion = net.isIP(hostname);
  if (
    (ipVersion === 4 && isPrivateIpv4(hostname)) ||
    (ipVersion === 6 && isPrivateIpv6(hostname))
  ) {
    return {
      ok: false,
      error:
        "Public Push Endpoint must be a public HTTPS URL. Private, LAN, and Tailscale IP addresses will not work for Google Pub/Sub push delivery.",
    };
  }

  return { ok: true, normalized: parsed.toString() };
}

function findExecutablesOnPath(bins: string[]): string[] {
  const pathEnv = process.env.PATH ?? "";
  const parts = pathEnv.split(path.delimiter).filter(Boolean);
  const seen = new Set<string>();
  const matches: string[] = [];
  for (const part of parts) {
    for (const bin of bins) {
      const candidate = path.join(part, bin);
      if (seen.has(candidate)) {
        continue;
      }
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        matches.push(candidate);
        seen.add(candidate);
      } catch {
        // keep scanning
      }
    }
  }
  return matches;
}

function isExecutable(candidate: string): boolean {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function ensurePathIncludes(dirPath: string, position: "append" | "prepend") {
  const pathEnv = process.env.PATH ?? "";
  const parts = pathEnv.split(path.delimiter).filter(Boolean);
  if (parts.includes(dirPath)) {
    return;
  }
  const next = position === "prepend" ? [dirPath, ...parts] : [...parts, dirPath];
  process.env.PATH = next.join(path.delimiter);
}

async function ensureBrewPrefixBinOnPath() {
  if (!hasBinary("brew")) {
    return;
  }
  const result = await runCommandWithTimeout(["brew", "--prefix"], {
    timeoutMs: 10_000,
  });
  if (result.code !== 0) {
    return;
  }
  const prefix = result.stdout.trim().split(/\s+/)[0];
  if (!prefix) {
    return;
  }
  const binDir = path.join(prefix, "bin");
  if (!fs.existsSync(binDir)) {
    return;
  }
  ensurePathIncludes(binDir, "append");
}

async function isMacAppInstalled(appName: string): Promise<boolean> {
  if (process.platform !== "darwin") {
    return false;
  }
  const verify = await runCommandWithTimeout(["/usr/bin/open", "-Ra", appName], {
    timeoutMs: 10_000,
  });
  return verify.code === 0;
}

function brewCaskRoots(): string[] {
  return ["/opt/homebrew/Caskroom", "/usr/local/Caskroom"];
}

async function findInstalledBrewPkg(caskNames: string[]): Promise<string | null> {
  for (const root of brewCaskRoots()) {
    for (const caskName of caskNames) {
      const caskRoot = path.join(root, caskName);
      let entries: fs.Dirent[] = [];
      try {
        entries = await fs.promises.readdir(caskRoot, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }
        const versionDir = path.join(caskRoot, entry.name);
        let versionEntries: fs.Dirent[] = [];
        try {
          versionEntries = await fs.promises.readdir(versionDir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const versionEntry of versionEntries) {
          if (!versionEntry.isFile() || !versionEntry.name.toLowerCase().endsWith(".pkg")) {
            continue;
          }
          return path.join(versionDir, versionEntry.name);
        }
      }
    }
  }
  return null;
}

function ensureGcloudOnPath(): boolean {
  if (hasBinary("gcloud")) {
    return true;
  }
  const candidates = [
    "/opt/homebrew/share/google-cloud-sdk/bin/gcloud",
    "/usr/local/share/google-cloud-sdk/bin/gcloud",
    "/opt/homebrew/Caskroom/google-cloud-sdk/latest/google-cloud-sdk/bin/gcloud",
    "/usr/local/Caskroom/google-cloud-sdk/latest/google-cloud-sdk/bin/gcloud",
  ];
  const versionedRoots = [
    "/opt/homebrew/Caskroom/google-cloud-sdk",
    "/usr/local/Caskroom/google-cloud-sdk",
  ];
  for (const root of versionedRoots) {
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }
        candidates.push(path.join(root, entry.name, "google-cloud-sdk", "bin", "gcloud"));
      }
    } catch {
      // keep scanning
    }
  }
  for (const candidate of candidates) {
    if (isExecutable(candidate)) {
      ensurePathIncludes(path.dirname(candidate), "append");
      return true;
    }
  }
  return false;
}

export async function resolvePythonExecutablePath(): Promise<string | undefined> {
  if (cachedPythonPath !== undefined) {
    return cachedPythonPath ?? undefined;
  }
  const candidates = findExecutablesOnPath(["python3", "python"]);
  for (const candidate of candidates) {
    const res = await runCommandWithTimeout(
      [candidate, "-c", "import os, sys; print(os.path.realpath(sys.executable))"],
      { timeoutMs: 2_000 },
    );
    if (res.code !== 0) {
      continue;
    }
    const resolved = res.stdout.trim().split(/\s+/)[0];
    if (!resolved) {
      continue;
    }
    try {
      if (!isExecutable(resolved)) {
        continue;
      }
      cachedPythonPath = resolved;
      return resolved;
    } catch {
      // keep scanning
    }
  }
  cachedPythonPath = null;
  return undefined;
}

function resolveConfiguredPythonOverride(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) {
    return undefined;
  }
  const expanded = resolveUserPath(value);
  if (isExecutable(expanded)) {
    return expanded;
  }
  const onPath = findExecutablesOnPath([value])[0];
  return onPath && isExecutable(onPath) ? onPath : undefined;
}

async function gcloudEnv(): Promise<NodeJS.ProcessEnv | undefined> {
  const configuredPython = resolveConfiguredPythonOverride(process.env.CLOUDSDK_PYTHON);
  if (configuredPython) {
    return { CLOUDSDK_PYTHON: configuredPython };
  }
  const pythonPath = await resolvePythonExecutablePath();
  if (!pythonPath) {
    return undefined;
  }
  return { CLOUDSDK_PYTHON: pythonPath };
}

async function runGcloudCommand(
  args: string[],
  timeoutMs: number,
): Promise<Awaited<ReturnType<typeof runCommandWithTimeout>>> {
  return await runCommandWithTimeout(["gcloud", ...args], {
    timeoutMs,
    env: await gcloudEnv(),
  });
}

export async function getActiveGcloudAccount(): Promise<string | null> {
  const result = await runGcloudCommand(["config", "get-value", "account", "--quiet"], 30_000);
  if (result.code !== 0) {
    return null;
  }
  const value = result.stdout.trim();
  if (!value || value === "(unset)") {
    return null;
  }
  return value;
}

export async function ensureDependency(bin: string, brewArgs: string[]) {
  await ensureBrewPrefixBinOnPath();
  if (bin === "gcloud" && ensureGcloudOnPath()) {
    return;
  }
  if (hasBinary(bin)) {
    return;
  }
  if (process.platform !== "darwin") {
    throw new Error(`${bin} not installed; install it and retry`);
  }
  if (!hasBinary("brew")) {
    throw new Error("Homebrew not installed (install brew and retry)");
  }
  const brewEnv = bin === "gcloud" ? await gcloudEnv() : undefined;
  const result = await runCommandWithTimeout(["brew", "install", ...brewArgs], {
    timeoutMs: 600_000,
    env: brewEnv,
  });
  if (result.code !== 0) {
    if (bin === "gcloud" && ensureGcloudOnPath()) {
      return;
    }
    throw new Error(
      `brew install failed for ${bin}: ${trimOutput(result.stderr || result.stdout)}`,
    );
  }
  await ensureBrewPrefixBinOnPath();
  if (bin === "gcloud" ? !ensureGcloudOnPath() && !hasBinary(bin) : !hasBinary(bin)) {
    throw new Error(`${bin} still not available after brew install`);
  }
}

export async function installMacAppWithBrew(params: {
  appName: string;
  caskName: string;
}): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error(`Automatic app installation is not supported on ${process.platform}.`);
  }
  if (await isMacAppInstalled(params.appName)) {
    return;
  }
  await ensureBrewPrefixBinOnPath();
  if (!hasBinary("brew")) {
    throw new Error("Homebrew not installed (install brew and retry)");
  }
  const result = await runCommandWithTimeout(["brew", "install", "--cask", params.caskName], {
    timeoutMs: 600_000,
  });
  if (result.code !== 0 && !(await isMacAppInstalled(params.appName))) {
    throw new Error(
      `brew install --cask ${params.caskName} failed: ${trimOutput(result.stderr || result.stdout)}`,
    );
  }
  if (!(await isMacAppInstalled(params.appName))) {
    throw new Error(`${params.appName} app is not installed on this Mac.`);
  }
}

export async function ensureGcloudAuth(interactive = true) {
  const account = await getActiveGcloudAccount();
  if (account) {
    return;
  }
  if (!interactive) {
    throw new Error("gcloud login required. Run `gcloud auth login` and retry.");
  }
  const login = await runGcloudCommand(["auth", "login"], 600_000);
  if (login.code !== 0) {
    throw new Error(login.stderr || "gcloud auth login failed");
  }
}

export type GogAuthStatus = {
  credentialsExists: boolean;
  email: string | null;
};

async function ensureGogKeyringBackend(): Promise<void> {
  if (cachedGogFileKeyringConfigured) {
    return;
  }
  await getGogCommandEnv();
  cachedGogFileKeyringConfigured = true;
}

async function ensureGogKeyringPassword(): Promise<string> {
  const explicitPassword = process.env.GOG_KEYRING_PASSWORD?.trim();
  if (explicitPassword) {
    return explicitPassword;
  }
  if (cachedGogKeyringPassword) {
    return cachedGogKeyringPassword;
  }
  const oauthDir = resolveOAuthDir();
  await ensureDir(oauthDir);
  const passwordPath = path.join(oauthDir, GOG_KEYRING_PASSWORD_FILENAME);
  try {
    const existing = (await fs.promises.readFile(passwordPath, "utf8")).trim();
    if (existing) {
      cachedGogKeyringPassword = existing;
      return existing;
    }
  } catch {
    // create a new password below
  }

  const generated = randomBytes(24).toString("hex");
  await fs.promises.writeFile(passwordPath, `${generated}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.promises.chmod(passwordPath, 0o600).catch(() => {
    // Best-effort permission tightening on non-POSIX filesystems.
  });
  cachedGogKeyringPassword = generated;
  return generated;
}

export async function getGogKeyringPasswordPath(): Promise<string> {
  const oauthDir = resolveOAuthDir();
  await ensureDir(oauthDir);
  const passwordPath = path.join(oauthDir, GOG_KEYRING_PASSWORD_FILENAME);
  await ensureGogKeyringPassword();
  return passwordPath;
}

export async function getGogCommandEnv(): Promise<NodeJS.ProcessEnv> {
  const password = await ensureGogKeyringPassword();
  return {
    GOG_KEYRING_BACKEND: "file",
    GOG_KEYRING_PASSWORD: password,
  };
}

export type DiscoveredGogCredentials = {
  filePath: string;
  filename: string;
  credentialsJson: string;
  projectId: string | null;
};

function parseGoogleDesktopOauthClient(rawJson: string): {
  credentialsJson: string;
  projectId: string | null;
} | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const installed = (parsed as { installed?: Record<string, unknown> }).installed;
  if (!installed || typeof installed !== "object") {
    return null;
  }
  const clientId = typeof installed.client_id === "string" ? installed.client_id.trim() : "";
  const clientSecret =
    typeof installed.client_secret === "string" ? installed.client_secret.trim() : "";
  const redirectUris = Array.isArray(installed.redirect_uris)
    ? installed.redirect_uris.filter(
        (uri): uri is string => typeof uri === "string" && uri.trim().length > 0,
      )
    : [];
  if (!clientId || !clientSecret || redirectUris.length === 0) {
    return null;
  }
  const projectId =
    typeof installed.project_id === "string" && installed.project_id.trim().length > 0
      ? installed.project_id.trim()
      : null;
  return {
    credentialsJson: JSON.stringify(parsed),
    projectId,
  };
}

function credentialDiscoveryDirs(): string[] {
  const dirs = [path.join(os.homedir(), "Downloads"), path.join(os.homedir(), "Desktop")];
  return Array.from(new Set(dirs));
}

export async function discoverDownloadedGogCredentials(
  projectId?: string,
): Promise<DiscoveredGogCredentials | null> {
  const candidates: Array<{
    filePath: string;
    filename: string;
    mtimeMs: number;
    credentialsJson: string;
    projectId: string | null;
  }> = [];

  for (const dirPath of credentialDiscoveryDirs()) {
    let entries: Array<fs.Dirent> = [];
    try {
      entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json")) {
        continue;
      }
      const looksRelevant =
        entry.name.startsWith("client_secret") ||
        entry.name.toLowerCase().includes("oauth") ||
        entry.name.toLowerCase().includes("google");
      if (!looksRelevant) {
        continue;
      }
      const filePath = path.join(dirPath, entry.name);
      let rawJson = "";
      let stats: fs.Stats;
      try {
        [rawJson, stats] = await Promise.all([
          fs.promises.readFile(filePath, "utf8"),
          fs.promises.stat(filePath),
        ]);
      } catch {
        continue;
      }
      const parsed = parseGoogleDesktopOauthClient(rawJson);
      if (!parsed) {
        continue;
      }
      if (projectId && parsed.projectId && parsed.projectId !== projectId) {
        continue;
      }
      candidates.push({
        filePath,
        filename: entry.name,
        mtimeMs: stats.mtimeMs,
        credentialsJson: parsed.credentialsJson,
        projectId: parsed.projectId,
      });
    }
  }

  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  const selected = candidates[0];
  if (!selected) {
    return null;
  }
  return {
    filePath: selected.filePath,
    filename: selected.filename,
    credentialsJson: selected.credentialsJson,
    projectId: selected.projectId,
  };
}

export async function getGogAuthStatus(): Promise<GogAuthStatus> {
  await ensureGogKeyringBackend();
  const commandArgs = ["auth", "status", "--json", "--no-input", "--client", OPENCLAW_GOG_CLIENT];
  const result = await runCommandWithTimeout(["gog", ...commandArgs], {
    timeoutMs: 30_000,
    env: await getGogCommandEnv(),
  });
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || "gog auth status failed");
  }
  try {
    const parsed = JSON.parse(result.stdout) as {
      account?: { credentials_exists?: boolean; email?: string };
    };
    return {
      credentialsExists: Boolean(parsed.account?.credentials_exists),
      email:
        typeof parsed.account?.email === "string" && parsed.account.email.trim().length > 0
          ? parsed.account.email.trim()
          : null,
    };
  } catch (error) {
    throw new Error(formatJsonParseFailure(`gog ${commandArgs.join(" ")}`, result, error), {
      cause: error,
    });
  }
}

export async function ensureGogAuth(account: string, interactive = true) {
  await ensureGogKeyringBackend();
  const status = await getGogAuthStatus();
  if (!status.credentialsExists) {
    throw new Error(
      "gog OAuth client credentials missing. Import them with `gog auth credentials set --client openclaw-gmail-hook <credentials.json>` and retry.",
    );
  }
  if (status.email === account) {
    return;
  }
  if (!interactive) {
    if (status.email && status.email !== account) {
      throw new Error(
        `gog is signed in as ${status.email}. Run \`gog login ${account} --client ${OPENCLAW_GOG_CLIENT} --services gmail --gmail-scope full --force-consent\` and retry.`,
      );
    }
    throw new Error(
      `gog login required. Run \`gog login ${account} --client ${OPENCLAW_GOG_CLIENT} --services gmail --gmail-scope full --force-consent\` and retry.`,
    );
  }
  const login = await runCommandWithTimeout(
    [
      "gog",
      "login",
      account,
      "--client",
      OPENCLAW_GOG_CLIENT,
      "--services",
      "gmail",
      "--gmail-scope",
      "full",
      "--force-consent",
    ],
    {
      timeoutMs: 600_000,
      env: await getGogCommandEnv(),
    },
  );
  if (login.code !== 0) {
    throw new Error(login.stderr || login.stdout || "gog login failed");
  }
}

export async function importGogCredentialsJson(
  credentialsJson: string,
  filename = "credentials.json",
): Promise<void> {
  await ensureGogKeyringBackend();
  const parsed = parseGoogleDesktopOauthClient(credentialsJson);
  if (!parsed) {
    throw new Error(
      "OAuth client JSON is invalid. Upload the Desktop app credentials JSON downloaded from Google Cloud.",
    );
  }

  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "openclaw-gog-credentials-"));
  const safeName = path.basename(filename).trim() || "credentials.json";
  const filePath = path.join(dir, safeName.endsWith(".json") ? safeName : `${safeName}.json`);
  try {
    await fs.promises.writeFile(filePath, parsed.credentialsJson, "utf8");
    const result = await runCommandWithTimeout(
      ["gog", "auth", "credentials", "set", filePath, "--client", OPENCLAW_GOG_CLIENT],
      {
        timeoutMs: 120_000,
        env: await getGogCommandEnv(),
      },
    );
    if (result.code !== 0) {
      throw new Error(result.stderr || result.stdout || "gog auth credentials failed");
    }
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

export async function runGcloud(args: string[]) {
  const result = await runGcloudCommand(args, 120_000);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || "gcloud command failed");
  }
  return result;
}

export async function ensureTopic(projectId: string, topicName: string) {
  const describe = await runGcloudCommand(
    ["pubsub", "topics", "describe", topicName, "--project", projectId],
    30_000,
  );
  if (describe.code === 0) {
    return;
  }
  await runGcloud(["pubsub", "topics", "create", topicName, "--project", projectId]);
}

export async function ensureSubscription(
  projectId: string,
  subscription: string,
  topicName: string,
  pushEndpoint: string,
) {
  const describe = await runGcloudCommand(
    ["pubsub", "subscriptions", "describe", subscription, "--project", projectId],
    30_000,
  );
  if (describe.code === 0) {
    await runGcloud([
      "pubsub",
      "subscriptions",
      "update",
      subscription,
      "--project",
      projectId,
      "--push-endpoint",
      pushEndpoint,
    ]);
    return;
  }
  await runGcloud([
    "pubsub",
    "subscriptions",
    "create",
    subscription,
    "--project",
    projectId,
    "--topic",
    topicName,
    "--push-endpoint",
    pushEndpoint,
  ]);
}

export async function ensureTailscaleEndpoint(params: {
  mode: "off" | "serve" | "funnel";
  path: string;
  port?: number;
  target?: string;
  token?: string;
}): Promise<string> {
  if (params.mode === "off") {
    return "";
  }

  const statusArgs = ["status", "--json"];
  const statusCommand = formatCommand("tailscale", statusArgs);
  const status = await runCommandWithTimeout(["tailscale", ...statusArgs], {
    timeoutMs: 30_000,
  });
  if (status.code !== 0) {
    throw new Error(formatCommandFailure(statusCommand, status));
  }
  let parsed: { Self?: { DNSName?: string } };
  try {
    parsed = JSON.parse(status.stdout) as { Self?: { DNSName?: string } };
  } catch (err) {
    throw new Error(formatJsonParseFailure(statusCommand, status, err), { cause: err });
  }
  const dnsName = parsed.Self?.DNSName?.replace(/\.$/, "");
  if (!dnsName) {
    throw new Error("tailscale DNS name missing; run tailscale up");
  }

  const target =
    typeof params.target === "string" && params.target.trim().length > 0
      ? params.target.trim()
      : params.port
        ? String(params.port)
        : "";
  if (!target) {
    throw new Error("tailscale target missing; set a port or target URL");
  }
  const pathArg = normalizeServePath(params.path);
  const funnelArgs = [params.mode, "--bg", "--set-path", pathArg, "--yes", target];
  const funnelCommand = formatCommand("tailscale", funnelArgs);
  const funnelResult = await runCommandWithTimeout(["tailscale", ...funnelArgs], {
    timeoutMs: 30_000,
  });
  const funnelOutput = `${funnelResult.stderr}\n${funnelResult.stdout}`;
  const funnelEnableUrl = extractTailscaleFunnelEnableUrl(funnelOutput);
  if (params.mode === "funnel" && funnelEnableUrl) {
    throw new Error(`tailscale funnel enable required. Enable it at ${funnelEnableUrl} and retry.`);
  }
  if (params.mode === "funnel" && funnelOutput.includes("Funnel is not enabled on your tailnet")) {
    throw new Error(
      "tailscale funnel enable required. Enable Funnel for this node/tailnet and retry.",
    );
  }
  if (funnelResult.code !== 0) {
    throw new Error(formatCommandFailure(funnelCommand, funnelResult));
  }

  const baseUrl = `https://${dnsName}${pathArg}`;
  // Funnel/serve strips pathArg before proxying; keep it only in the public URL.
  return params.token ? `${baseUrl}?token=${params.token}` : baseUrl;
}

export type TailscaleConnectionSummary = {
  appInstalled: boolean;
  connected: boolean;
  dnsName: string | null;
  detail: string;
  installerPackagePath: string | null;
};

export async function getTailscaleConnectionSummary(): Promise<TailscaleConnectionSummary> {
  const appInstalled = await isMacAppInstalled("Tailscale");
  const installerPackagePath = await findInstalledBrewPkg(["tailscale-app", "tailscale"]);
  const tailscaleBin = await findTailscaleBinary();
  if (!tailscaleBin) {
    return {
      appInstalled,
      connected: false,
      dnsName: null,
      installerPackagePath,
      detail: appInstalled
        ? "Tailscale is installed, but the CLI is not available yet."
        : installerPackagePath
          ? "Homebrew downloaded the Tailscale installer, but macOS still needs you to finish installing it."
          : "Tailscale is not installed on this Mac.",
    };
  }

  const statusArgs = ["status", "--json"];
  const statusCommand = formatCommand(path.basename(tailscaleBin), statusArgs);
  const status = await runCommandWithTimeout([tailscaleBin, ...statusArgs], {
    timeoutMs: 30_000,
  });
  if (status.code !== 0) {
    return {
      appInstalled,
      connected: false,
      dnsName: null,
      installerPackagePath,
      detail:
        trimOutput(status.stderr || status.stdout) ||
        `${statusCommand} failed; connect Tailscale and retry.`,
    };
  }

  try {
    const parsed = JSON.parse(status.stdout) as { Self?: { DNSName?: string } };
    const dnsName = parsed.Self?.DNSName?.replace(/\.$/, "") ?? "";
    if (!dnsName) {
      return {
        appInstalled,
        connected: false,
        dnsName: null,
        installerPackagePath,
        detail: "Tailscale is installed, but this machine is not connected yet.",
      };
    }
    return {
      appInstalled,
      connected: true,
      dnsName,
      installerPackagePath,
      detail: `Tailscale is connected as ${dnsName}.`,
    };
  } catch (error) {
    return {
      appInstalled,
      connected: false,
      dnsName: null,
      installerPackagePath,
      detail: formatJsonParseFailure(statusCommand, status, error),
    };
  }
}

export async function resolveProjectIdFromGogCredentials(): Promise<string | null> {
  const candidates = gogCredentialsPaths();
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    try {
      const raw = fs.readFileSync(candidate, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const clientId = extractGogClientId(parsed);
      const projectNumber = extractProjectNumber(clientId);
      if (!projectNumber) {
        continue;
      }
      const res = await runGcloudCommand(
        [
          "projects",
          "list",
          "--filter",
          `projectNumber=${projectNumber}`,
          "--format",
          "value(projectId)",
        ],
        30_000,
      );
      if (res.code !== 0) {
        continue;
      }
      const projectId = res.stdout.trim().split(/\s+/)[0];
      if (projectId) {
        return projectId;
      }
    } catch {
      // keep scanning
    }
  }
  return null;
}

function gogCredentialsPaths(): string[] {
  const paths: string[] = [];
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) {
    paths.push(path.join(xdg, "gogcli", "credentials.json"));
  }
  paths.push(resolveUserPath("~/.config/gogcli/credentials.json"));
  if (process.platform === "darwin") {
    paths.push(resolveUserPath("~/Library/Application Support/gogcli/credentials.json"));
  }
  return paths;
}

function extractGogClientId(parsed: Record<string, unknown>): string | null {
  const installed = parsed.installed as Record<string, unknown> | undefined;
  const web = parsed.web as Record<string, unknown> | undefined;
  const candidate = installed?.client_id || web?.client_id || parsed.client_id || "";
  return typeof candidate === "string" ? candidate : null;
}

function extractProjectNumber(clientId: string | null): string | null {
  if (!clientId) {
    return null;
  }
  const match = clientId.match(/^(\d+)-/);
  return match?.[1] ?? null;
}
