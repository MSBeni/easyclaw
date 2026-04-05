import process from "node:process";
import { runCommandWithTimeout } from "../process/exec.js";

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

type TerminalLaunchOptions = {
  env?: Record<string, string>;
};

function buildTerminalCommand(command: string, options?: TerminalLaunchOptions): string {
  const exports = [
    'export PATH="/opt/homebrew/bin:/usr/local/bin:/opt/homebrew/share/google-cloud-sdk/bin:/usr/local/share/google-cloud-sdk/bin:$PATH"',
  ];
  for (const [key, value] of Object.entries(options?.env ?? {})) {
    exports.push(`export ${key}=${shellEscape(value)}`);
  }
  return `${exports.join("; ")}; ${command}`;
}

export async function launchTerminalCommand(
  command: string,
  options?: TerminalLaunchOptions,
): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error(`Automatic command launch is not supported on ${process.platform}.`);
  }
  const script = [
    'tell application "Terminal"',
    "activate",
    `do script ${appleScriptString(buildTerminalCommand(command, options))}`,
    "end tell",
  ];
  const result = await runCommandWithTimeout(
    ["/usr/bin/osascript", ...script.flatMap((line) => ["-e", line])],
    { timeoutMs: 15_000 },
  );
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || "osascript failed";
    throw new Error(detail);
  }
}

export async function launchMacApp(appName: string): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error(`Automatic app launch is not supported on ${process.platform}.`);
  }

  const verify = await runCommandWithTimeout(["/usr/bin/open", "-Ra", appName], {
    timeoutMs: 10_000,
  });
  if (verify.code !== 0) {
    throw new Error(`${appName} app is not installed on this Mac.`);
  }

  const result = await runCommandWithTimeout(["/usr/bin/open", "-a", appName], {
    timeoutMs: 15_000,
  });
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || "open failed";
    throw new Error(detail);
  }
}

export async function launchMacPath(targetPath: string): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error(`Automatic file launch is not supported on ${process.platform}.`);
  }

  const result = await runCommandWithTimeout(["/usr/bin/open", targetPath], {
    timeoutMs: 15_000,
  });
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || "open failed";
    throw new Error(detail);
  }
}
