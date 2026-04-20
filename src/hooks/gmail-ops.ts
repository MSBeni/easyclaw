import { spawn } from "node:child_process";
import process from "node:process";
import { formatCliCommand } from "../cli/command-format.js";
import {
  type OpenClawConfig,
  CONFIG_PATH,
  loadConfig,
  readConfigFileSnapshot,
  resolveGatewayPort,
  validateConfigObjectWithPlugins,
  writeConfigFile,
} from "../config/config.js";
import { runCommandWithTimeout } from "../process/exec.js";
import { defaultRuntime } from "../runtime.js";
import { displayPath } from "../utils.js";
import {
  ensureDependency,
  ensureGcloudAuth,
  getActiveGcloudAccount,
  getGogCommandEnv,
  getGogAuthStatus,
  ensureGogAuth,
  ensureSubscription,
  ensureTailscaleEndpoint,
  ensureTopic,
  validatePublicPushEndpoint,
  resolveProjectIdFromGogCredentials,
  runGcloud,
} from "./gmail-setup-utils.js";
import {
  buildDefaultHookUrl,
  buildGogWatchServeArgs,
  buildGogWatchStartArgs,
  buildTopicPath,
  DEFAULT_GMAIL_LABEL,
  DEFAULT_GMAIL_MAX_BYTES,
  DEFAULT_GMAIL_RENEW_MINUTES,
  DEFAULT_GMAIL_SERVE_BIND,
  DEFAULT_GMAIL_SERVE_PATH,
  DEFAULT_GMAIL_SERVE_PORT,
  DEFAULT_GMAIL_SUBSCRIPTION,
  DEFAULT_GMAIL_TOPIC,
  OPENCLAW_GOG_CLIENT,
  type GmailHookOverrides,
  type GmailHookRuntimeConfig,
  generateHookToken,
  mergeHookPresets,
  normalizeHooksPath,
  normalizeServePath,
  parseSubscriptionPath,
  parseTopicPath,
  resolveGmailHookRuntimeConfig,
} from "./gmail.js";

type GmailCommonOptions = {
  topic?: string;
  subscription?: string;
  label?: string;
  hookToken?: string;
  pushToken?: string;
  hookUrl?: string;
  bind?: string;
  port?: number;
  path?: string;
  includeBody?: boolean;
  maxBytes?: number;
  renewEveryMinutes?: number;
  tailscale?: "off" | "serve" | "funnel";
  tailscalePath?: string;
  tailscaleTarget?: string;
};

export type GmailSetupOptions = GmailCommonOptions & {
  account: string;
  project?: string;
  pushEndpoint?: string;
  interactiveAuth?: boolean;
  json?: boolean;
};

export type GmailSetupSummary = {
  projectId: string;
  topic: string;
  subscription: string;
  pushEndpoint: string;
  hookUrl: string;
  hookToken: string;
  pushToken: string;
  serve: {
    bind: string;
    port: number;
    path: string;
  };
};

export type GmailRunOptions = GmailCommonOptions & {
  account?: string;
};

const DEFAULT_GMAIL_TOPIC_IAM_MEMBER = "serviceAccount:gmail-api-push@system.gserviceaccount.com";

function buildGmailGogLoginCommand(account: string): string {
  return `gog login ${account} --client ${OPENCLAW_GOG_CLIENT} --services gmail --gmail-scope full --force-consent`;
}

async function ensureGmailSetupAuth(account: string, interactive: boolean) {
  if (interactive) {
    await ensureGcloudAuth(true);
    await ensureGogAuth(account, true);
    return;
  }

  const missing: string[] = [];
  const gcloudAccount = await getActiveGcloudAccount();
  if (!gcloudAccount) {
    // Keep the "gcloud login required" phrase — the Builder UI matches it
    // to drive the gcloud sign-in step. The user-facing UI replaces it
    // with a friendly Setup button.
    missing.push("gcloud login required. Run `gcloud auth login`.");
  }
  const gogStatus = await getGogAuthStatus();
  if (!gogStatus.credentialsExists) {
    // Keep the "gog OAuth client credentials missing" phrase for matching;
    // the Builder quick-setup card shows a file upload UI when it detects
    // this.
    missing.push(
      "gog OAuth client credentials missing. Import them with `gog auth credentials set --client openclaw-gmail-hook <credentials.json>`.",
    );
  } else if (gogStatus.email !== account) {
    if (gogStatus.email) {
      missing.push(
        `gog is signed in as ${gogStatus.email}. Run \`${buildGmailGogLoginCommand(account)}\`.`,
      );
    } else {
      missing.push(`gog login required. Run \`${buildGmailGogLoginCommand(account)}\`.`);
    }
  }
  if (missing.length > 0) {
    // Prefix with a user-facing hint so whenever this bubbles up to the UI
    // (agent run errors, verification failures) the user knows where to go.
    throw new Error(
      `Gmail is not fully connected yet. Open Gmail Setup in EasyClaw (Setup → Gmail Hook) to finish — it walks you through uploading your credentials file and signing in with Google. ${missing.join(" ")} Retry after both are complete.`,
    );
  }
}

export async function runGmailSetup(opts: GmailSetupOptions): Promise<GmailSetupSummary> {
  await ensureDependency("gcloud", ["--cask", "gcloud-cli"]);
  await ensureDependency("gog", ["gogcli"]);
  if (opts.tailscale !== "off" && !opts.pushEndpoint) {
    await ensureDependency("tailscale", ["tailscale"]);
  }

  const interactiveAuth = opts.interactiveAuth ?? true;
  await ensureGmailSetupAuth(opts.account, interactiveAuth);

  if (opts.pushEndpoint) {
    const validation = validatePublicPushEndpoint(opts.pushEndpoint);
    if (!validation.ok) {
      throw new Error(validation.error);
    }
    opts.pushEndpoint = validation.normalized;
  }

  const configSnapshot = await readConfigFileSnapshot();
  if (!configSnapshot.valid) {
    throw new Error(`Config invalid: ${CONFIG_PATH}`);
  }

  const baseConfig = configSnapshot.config;
  const hooksPath = normalizeHooksPath(baseConfig.hooks?.path);
  const hookToken = opts.hookToken ?? baseConfig.hooks?.token ?? generateHookToken();
  const pushToken = opts.pushToken ?? baseConfig.hooks?.gmail?.pushToken ?? generateHookToken();

  const topicInput = opts.topic ?? baseConfig.hooks?.gmail?.topic ?? DEFAULT_GMAIL_TOPIC;
  const parsedTopic = parseTopicPath(topicInput);
  const topicName = parsedTopic?.topicName ?? topicInput;

  const projectId =
    opts.project ?? parsedTopic?.projectId ?? (await resolveProjectIdFromGogCredentials());
  // Gmail watch requires the Pub/Sub topic to live in the OAuth client project.
  if (!projectId) {
    throw new Error(
      "GCP project id required (use --project or ensure gog credentials are available)",
    );
  }

  const topicPath = buildTopicPath(projectId, topicName);

  const subscriptionInput = opts.subscription ?? DEFAULT_GMAIL_SUBSCRIPTION;
  const subscription =
    parseSubscriptionPath(subscriptionInput)?.subscriptionName ?? subscriptionInput;
  const label = opts.label ?? DEFAULT_GMAIL_LABEL;
  const hookUrl =
    opts.hookUrl ??
    baseConfig.hooks?.gmail?.hookUrl ??
    buildDefaultHookUrl(hooksPath, resolveGatewayPort(baseConfig));

  const serveBind = opts.bind ?? DEFAULT_GMAIL_SERVE_BIND;
  const servePort = opts.port ?? DEFAULT_GMAIL_SERVE_PORT;
  const configuredServePath = opts.path ?? baseConfig.hooks?.gmail?.serve?.path;
  const configuredTailscaleTarget =
    opts.tailscaleTarget ?? baseConfig.hooks?.gmail?.tailscale?.target;
  const normalizedServePath =
    typeof configuredServePath === "string" && configuredServePath.trim().length > 0
      ? normalizeServePath(configuredServePath)
      : DEFAULT_GMAIL_SERVE_PATH;
  const normalizedTailscaleTarget =
    typeof configuredTailscaleTarget === "string" && configuredTailscaleTarget.trim().length > 0
      ? configuredTailscaleTarget.trim()
      : undefined;

  const includeBody = opts.includeBody ?? true;
  const maxBytes = opts.maxBytes ?? DEFAULT_GMAIL_MAX_BYTES;
  const renewEveryMinutes = opts.renewEveryMinutes ?? DEFAULT_GMAIL_RENEW_MINUTES;

  const tailscaleMode = opts.tailscale ?? "funnel";
  // Tailscale strips the path before proxying; keep a public path while gog
  // listens on "/" whenever Tailscale is enabled.
  const servePath = normalizeServePath(
    tailscaleMode !== "off" && !normalizedTailscaleTarget ? "/" : normalizedServePath,
  );
  const tailscalePath = normalizeServePath(
    opts.tailscalePath ??
      baseConfig.hooks?.gmail?.tailscale?.path ??
      (tailscaleMode !== "off" ? normalizedServePath : servePath),
  );

  await runGcloud(["config", "set", "project", projectId, "--quiet"]);
  await runGcloud([
    "services",
    "enable",
    "gmail.googleapis.com",
    "pubsub.googleapis.com",
    "--project",
    projectId,
    "--quiet",
  ]);

  await ensureTopic(projectId, topicName);
  await runGcloud([
    "pubsub",
    "topics",
    "add-iam-policy-binding",
    topicName,
    "--project",
    projectId,
    "--member",
    DEFAULT_GMAIL_TOPIC_IAM_MEMBER,
    "--role",
    "roles/pubsub.publisher",
    "--quiet",
  ]);

  const pushEndpoint = opts.pushEndpoint
    ? opts.pushEndpoint
    : await ensureTailscaleEndpoint({
        mode: tailscaleMode,
        path: tailscalePath,
        port: servePort,
        target: normalizedTailscaleTarget,
        token: pushToken,
      });

  if (!pushEndpoint) {
    throw new Error("push endpoint required (set --push-endpoint)");
  }

  await ensureSubscription(projectId, subscription, topicName, pushEndpoint);

  await startGmailWatch(
    {
      account: opts.account,
      label,
      topic: topicPath,
    },
    true,
  );

  const nextConfig: OpenClawConfig = {
    ...baseConfig,
    hooks: {
      ...baseConfig.hooks,
      enabled: true,
      path: hooksPath,
      token: hookToken,
      presets: mergeHookPresets(baseConfig.hooks?.presets, "gmail"),
      gmail: {
        ...baseConfig.hooks?.gmail,
        account: opts.account,
        label,
        topic: topicPath,
        subscription,
        pushToken,
        hookUrl,
        includeBody,
        maxBytes,
        renewEveryMinutes,
        serve: {
          ...baseConfig.hooks?.gmail?.serve,
          bind: serveBind,
          port: servePort,
          path: servePath,
        },
        tailscale: {
          ...baseConfig.hooks?.gmail?.tailscale,
          mode: tailscaleMode,
          path: tailscalePath,
          target: normalizedTailscaleTarget,
        },
      },
    },
  };

  const validated = validateConfigObjectWithPlugins(nextConfig);
  if (!validated.ok) {
    throw new Error(`Config validation failed: ${validated.issues[0]?.message ?? "invalid"}`);
  }
  await writeConfigFile(validated.config);

  const summary: GmailSetupSummary = {
    projectId,
    topic: topicPath,
    subscription,
    pushEndpoint,
    hookUrl,
    hookToken,
    pushToken,
    serve: {
      bind: serveBind,
      port: servePort,
      path: servePath,
    },
  };

  if (opts.json) {
    defaultRuntime.log(JSON.stringify(summary, null, 2));
    return summary;
  }

  defaultRuntime.log("Gmail hooks configured:");
  defaultRuntime.log(`- project: ${projectId}`);
  defaultRuntime.log(`- topic: ${topicPath}`);
  defaultRuntime.log(`- subscription: ${subscription}`);
  defaultRuntime.log(`- push endpoint: ${pushEndpoint}`);
  defaultRuntime.log(`- hook url: ${hookUrl}`);
  defaultRuntime.log(`- config: ${displayPath(CONFIG_PATH)}`);
  defaultRuntime.log(`Next: ${formatCliCommand("openclaw webhooks gmail run")}`);
  return summary;
}

export async function runGmailService(opts: GmailRunOptions) {
  await ensureDependency("gog", ["gogcli"]);
  const config = loadConfig();

  const overrides: GmailHookOverrides = {
    account: opts.account,
    topic: opts.topic,
    subscription: opts.subscription,
    label: opts.label,
    hookToken: opts.hookToken,
    pushToken: opts.pushToken,
    hookUrl: opts.hookUrl,
    serveBind: opts.bind,
    servePort: opts.port,
    servePath: opts.path,
    includeBody: opts.includeBody,
    maxBytes: opts.maxBytes,
    renewEveryMinutes: opts.renewEveryMinutes,
    tailscaleMode: opts.tailscale,
    tailscalePath: opts.tailscalePath,
    tailscaleTarget: opts.tailscaleTarget,
  };

  const resolved = resolveGmailHookRuntimeConfig(config, overrides);
  if (!resolved.ok) {
    throw new Error(resolved.error);
  }

  const runtimeConfig = resolved.value;

  if (runtimeConfig.tailscale.mode !== "off") {
    await ensureDependency("tailscale", ["tailscale"]);
    await ensureTailscaleEndpoint({
      mode: runtimeConfig.tailscale.mode,
      path: runtimeConfig.tailscale.path,
      port: runtimeConfig.serve.port,
      target: runtimeConfig.tailscale.target,
    });
  }

  await startGmailWatch(runtimeConfig);

  let shuttingDown = false;
  let child = await spawnGogServe(runtimeConfig);

  const renewMs = runtimeConfig.renewEveryMinutes * 60_000;
  const renewTimer = setInterval(() => {
    void startGmailWatch(runtimeConfig);
  }, renewMs);

  const detachSignals = () => {
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
  };

  const shutdown = () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    detachSignals();
    clearInterval(renewTimer);
    child.kill("SIGTERM");
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  child.on("exit", () => {
    if (shuttingDown) {
      detachSignals();
      return;
    }
    defaultRuntime.log("gog watch serve exited; restarting in 2s");
    setTimeout(() => {
      if (shuttingDown) {
        return;
      }
      void spawnGogServe(runtimeConfig).then((nextChild) => {
        child = nextChild;
      });
    }, 2000);
  });
}

async function spawnGogServe(cfg: GmailHookRuntimeConfig) {
  const args = buildGogWatchServeArgs(cfg);
  defaultRuntime.log(`Starting gog ${args.join(" ")}`);
  return spawn("gog", args, {
    stdio: "inherit",
    env: { ...process.env, ...(await getGogCommandEnv()) },
  });
}

async function startGmailWatch(
  cfg: Pick<GmailHookRuntimeConfig, "account" | "label" | "topic">,
  fatal = false,
) {
  const args = ["gog", ...buildGogWatchStartArgs(cfg)];
  const result = await runCommandWithTimeout(args, {
    timeoutMs: 120_000,
    env: await getGogCommandEnv(),
  });
  if (result.code !== 0) {
    const message = result.stderr || result.stdout || "gog watch start failed";
    const normalized = message.trim();
    if (
      normalized.includes("insufficientPermissions") ||
      normalized.includes("insufficient authentication scopes") ||
      normalized.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT")
    ) {
      const scopeMessage = `Gmail API auth is missing required Gmail scopes. Re-run \`${buildGmailGogLoginCommand(
        cfg.account,
      )}\`, complete consent, then retry Gmail setup. Original error: ${normalized}`;
      if (fatal) {
        throw new Error(scopeMessage);
      }
      defaultRuntime.error(scopeMessage);
      return;
    }
    if (fatal) {
      throw new Error(message);
    }
    defaultRuntime.error(message);
  }
}
