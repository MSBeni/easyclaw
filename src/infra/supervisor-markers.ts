const SUPERVISOR_HINTS = {
  launchd: ["LAUNCH_JOB_LABEL", "LAUNCH_JOB_NAME", "XPC_SERVICE_NAME", "OPENCLAW_LAUNCHD_LABEL"],
  systemd: ["OPENCLAW_SYSTEMD_UNIT", "INVOCATION_ID", "SYSTEMD_EXEC_PID", "JOURNAL_STREAM"],
  schtasks: ["OPENCLAW_WINDOWS_TASK_NAME"],
} as const;

export const SUPERVISOR_HINT_ENV_VARS = [
  ...SUPERVISOR_HINTS.launchd,
  ...SUPERVISOR_HINTS.systemd,
  ...SUPERVISOR_HINTS.schtasks,
  "OPENCLAW_SERVICE_MARKER",
  "OPENCLAW_SERVICE_KIND",
] as const;

export type RespawnSupervisor = "launchd" | "systemd" | "schtasks";

function hasAnyHint(env: NodeJS.ProcessEnv, keys: readonly string[]): boolean {
  return keys.some((key) => {
    const value = env[key];
    if (typeof value !== "string") {
      return false;
    }
    const normalized = value.trim();
    if (!normalized) {
      return false;
    }
    // macOS Terminal sessions often expose XPC_SERVICE_NAME=0 even when the
    // process is not the managed launchd service we can safely "supervise".
    if (normalized === "0") {
      return false;
    }
    return true;
  });
}

export function detectRespawnSupervisor(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): RespawnSupervisor | null {
  if (platform === "darwin") {
    const explicitLaunchdLabel = env.OPENCLAW_LAUNCHD_LABEL?.trim();
    if (explicitLaunchdLabel) {
      return "launchd";
    }
    const launchJobLabel = env.LAUNCH_JOB_LABEL?.trim();
    if (launchJobLabel && launchJobLabel.toLowerCase().includes("openclaw")) {
      return "launchd";
    }
    return null;
  }
  if (platform === "linux") {
    return hasAnyHint(env, SUPERVISOR_HINTS.systemd) ? "systemd" : null;
  }
  if (platform === "win32") {
    if (hasAnyHint(env, SUPERVISOR_HINTS.schtasks)) {
      return "schtasks";
    }
    const marker = env.OPENCLAW_SERVICE_MARKER?.trim();
    const serviceKind = env.OPENCLAW_SERVICE_KIND?.trim();
    return marker && serviceKind === "gateway" ? "schtasks" : null;
  }
  return null;
}
