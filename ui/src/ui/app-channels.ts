import type { OpenClawApp } from "./app.ts";
import {
  loadChannels,
  logoutWhatsApp,
  startWhatsAppLogin,
  waitWhatsAppLogin,
} from "./controllers/channels.ts";
import {
  applyConfig,
  loadConfig,
  saveConfig,
  updateConfigFormValue,
} from "./controllers/config.ts";
import type { NostrProfile } from "./types.ts";
import { createNostrProfileFormState } from "./views/channels.nostr-profile-form.ts";

const WEB_LOGIN_PROVIDER_UNAVAILABLE = "web login provider is not available";
const WHATSAPP_ALREADY_LINKED = "whatsapp is already linked";
const WHATSAPP_LOGIN_RETRY_DELAYS_MS = [300, 700, 1200];
const WHATSAPP_CONNECTED_CONVERGENCE_DELAYS_MS = [400, 800, 1200, 1600];
const WHATSAPP_READY_CONVERGENCE_DELAYS_MS = [500, 900, 1400, 2200, 3200];
const WHATSAPP_AUTH_FAILURE_HINTS = ["401", "unauthorized", "logged out", "connection failure"];
const WHATSAPP_AUTO_TARGET_CONNECTOR_ID = "channel:whatsapp:auto-default-target";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readConfigValue(
  form: Record<string, unknown> | null,
  path: Array<string | number>,
): unknown {
  if (!form) {
    return undefined;
  }
  let cursor: unknown = form;
  for (const segment of path) {
    if (cursor == null || typeof cursor !== "object" || Array.isArray(cursor)) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[String(segment)];
  }
  return cursor;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean);
}

function isWhatsAppProviderUnavailable(message: string | null | undefined): boolean {
  return message?.toLowerCase().includes(WEB_LOGIN_PROVIDER_UNAVAILABLE) ?? false;
}

function isWhatsAppAlreadyLinked(message: string | null | undefined): boolean {
  return message?.toLowerCase().includes(WHATSAPP_ALREADY_LINKED) ?? false;
}

function hasWhatsAppAuthFailureHint(message: string | null | undefined): boolean {
  if (!message) {
    return false;
  }
  const normalized = message.toLowerCase();
  return WHATSAPP_AUTH_FAILURE_HINTS.some((hint) => normalized.includes(hint));
}

function readRecordBoolean(record: Record<string, unknown> | null, key: string): boolean | null {
  if (!record) {
    return null;
  }
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

function readRecordString(record: Record<string, unknown> | null, key: string): string | null {
  if (!record) {
    return null;
  }
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function resolveWhatsAppPrimaryAccount(host: OpenClawApp): Record<string, unknown> | null {
  const accounts = host.channelsSnapshot?.channelAccounts?.whatsapp;
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return null;
  }
  return asRecord(accounts[0]);
}

function syncWhatsAppConnectedFromSnapshot(host: OpenClawApp) {
  const account = resolveWhatsAppPrimaryAccount(host);
  const connected = readRecordBoolean(account, "connected");
  if (connected !== null) {
    host.whatsappLoginConnected = connected;
  }
}

function isWhatsAppConnectedInSnapshot(host: OpenClawApp): boolean {
  const account = resolveWhatsAppPrimaryAccount(host);
  return readRecordBoolean(account, "connected") === true;
}

function shouldAutoRelinkWhatsApp(host: OpenClawApp): boolean {
  const account = resolveWhatsAppPrimaryAccount(host);
  if (!account) {
    return false;
  }
  const linked = readRecordBoolean(account, "linked") === true;
  const connected = readRecordBoolean(account, "connected") === true;
  if (!linked || connected) {
    return false;
  }
  const lastError = readRecordString(account, "lastError");
  return hasWhatsAppAuthFailureHint(lastError);
}

function shouldAutoWaitForWhatsAppScan(host: OpenClawApp): boolean {
  return Boolean(host.whatsappLoginQrDataUrl) && host.whatsappLoginConnected !== true;
}

function readWhatsAppProbeError(host: OpenClawApp): string | null {
  const account = resolveWhatsAppPrimaryAccount(host);
  if (!account) {
    return null;
  }
  const probe = asRecord(account.probe);
  return readRecordString(probe, "error");
}

function readWhatsAppProbeOk(host: OpenClawApp): boolean | null {
  const account = resolveWhatsAppPrimaryAccount(host);
  if (!account) {
    return null;
  }
  const probe = asRecord(account.probe);
  return readRecordBoolean(probe, "ok");
}

function readWhatsAppIdentity(host: OpenClawApp): string | null {
  const account = resolveWhatsAppPrimaryAccount(host);
  if (!account) {
    return null;
  }
  return (
    readRecordString(account, "name") ??
    readRecordString(account, "accountId") ??
    null
  );
}

function isWhatsAppLinkedButListenerDown(host: OpenClawApp): boolean {
  const account = resolveWhatsAppPrimaryAccount(host);
  if (!account) {
    return false;
  }
  const linked = readRecordBoolean(account, "linked") === true;
  const running = readRecordBoolean(account, "running") === true;
  const connected = readRecordBoolean(account, "connected") === true;
  return linked && !running && !connected;
}

function isWhatsAppReadyInSnapshot(host: OpenClawApp): boolean {
  const probeOk = readWhatsAppProbeOk(host);
  if (probeOk === true) {
    return true;
  }
  const account = resolveWhatsAppPrimaryAccount(host);
  if (!account) {
    return false;
  }
  const running = readRecordBoolean(account, "running") === true;
  const connected = readRecordBoolean(account, "connected") === true;
  return running && connected;
}

function setWhatsAppListenerRecoveryMessage(host: OpenClawApp, context: "linked" | "timeout") {
  if (!isWhatsAppLinkedButListenerDown(host)) {
    return;
  }
  const who = readWhatsAppIdentity(host) ?? "this account";
  const lastError = readRecordString(resolveWhatsAppPrimaryAccount(host), "lastError");
  const probeError = readWhatsAppProbeError(host);
  const detail = lastError?.trim() || probeError?.trim();
  const detailSuffix = detail ? ` Last runtime detail: ${detail}` : "";
  host.whatsappLoginMessage =
    context === "timeout"
      ? `WhatsApp is already linked (${who}), but the live listener is not running. Builder timed out waiting for a fresh QR because the runtime is still unhealthy.${detailSuffix} Restart the gateway first. If you really want a brand-new pairing, use Logout, then Show QR.`
      : `WhatsApp is already linked (${who}), but the live listener is not running.${detailSuffix} Restart the gateway first. You usually do not need a fresh QR unless you want to replace the linked session.`;
}

async function convergeWhatsAppConnectedState(host: OpenClawApp) {
  if (host.whatsappLoginConnected !== true) {
    return;
  }
  if (isWhatsAppConnectedInSnapshot(host)) {
    return;
  }
  for (const delayMs of WHATSAPP_CONNECTED_CONVERGENCE_DELAYS_MS) {
    await waitMs(delayMs);
    await loadChannels(host, true);
    syncWhatsAppConnectedFromSnapshot(host);
    if (isWhatsAppConnectedInSnapshot(host)) {
      host.whatsappLoginConnected = true;
      return;
    }
  }
}

async function convergeWhatsAppReadyState(host: OpenClawApp) {
  if (isWhatsAppReadyInSnapshot(host)) {
    host.whatsappLoginConnected = true;
    return;
  }
  for (const delayMs of WHATSAPP_READY_CONVERGENCE_DELAYS_MS) {
    await waitMs(delayMs);
    await loadChannels(host, true);
    syncWhatsAppConnectedFromSnapshot(host);
    if (isWhatsAppReadyInSnapshot(host)) {
      host.whatsappLoginConnected = true;
      return;
    }
  }
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

type BuilderSetupRunResult = {
  status?: string;
  message?: string;
};

async function autoConfigureWhatsAppDefaultTarget(host: OpenClawApp): Promise<void> {
  if (!host.client || !host.connected) {
    return;
  }
  try {
    const result = await host.client.request<BuilderSetupRunResult>("agents.builder.setup.run", {
      connectorId: WHATSAPP_AUTO_TARGET_CONNECTOR_ID,
      inputs: {},
    });
    if (result?.status === "configured" && result.message?.trim()) {
      host.whatsappLoginMessage = result.message.trim();
    }
  } catch {
    // Keep login flow resilient even if auto-target setup fails.
  }
}

async function ensureWhatsAppProviderConfigured(host: OpenClawApp): Promise<boolean> {
  await loadConfig(host);
  const form = asRecord(host.configForm);
  if (!form) {
    return false;
  }

  let changed = false;
  const pluginsEnabled = readConfigValue(form, ["plugins", "enabled"]);
  if (pluginsEnabled === false) {
    updateConfigFormValue(host, ["plugins", "enabled"], true);
    changed = true;
  }

  const webEnabled = readConfigValue(form, ["web", "enabled"]);
  if (webEnabled === false) {
    updateConfigFormValue(host, ["web", "enabled"], true);
    changed = true;
  }

  const whatsappEnabled = readConfigValue(form, ["channels", "whatsapp", "enabled"]) === true;
  if (!whatsappEnabled) {
    updateConfigFormValue(host, ["channels", "whatsapp", "enabled"], true);
    changed = true;
  }

  const allow = readStringArray(readConfigValue(form, ["plugins", "allow"]));
  if (allow.length > 0 && !allow.some((entry) => entry.toLowerCase() === "whatsapp")) {
    updateConfigFormValue(host, ["plugins", "allow", allow.length], "whatsapp");
    changed = true;
  }

  const deny = readStringArray(readConfigValue(form, ["plugins", "deny"]));
  if (deny.some((entry) => entry.toLowerCase() === "whatsapp")) {
    updateConfigFormValue(
      host,
      ["plugins", "deny"],
      deny.filter((entry) => entry.toLowerCase() !== "whatsapp"),
    );
    changed = true;
  }

  const entryEnabled = readConfigValue(form, ["plugins", "entries", "whatsapp", "enabled"]);
  if (entryEnabled === false) {
    updateConfigFormValue(host, ["plugins", "entries", "whatsapp", "enabled"], true);
    changed = true;
  }

  if (!changed) {
    return true;
  }

  await applyConfig(host);
  if (host.lastError) {
    return false;
  }
  await loadConfig(host);
  return true;
}

export async function handleWhatsAppStart(host: OpenClawApp, force: boolean) {
  await startWhatsAppLogin(host, force);
  if (isWhatsAppProviderUnavailable(host.whatsappLoginMessage)) {
    const configured = await ensureWhatsAppProviderConfigured(host);
    if (configured) {
      for (const delayMs of WHATSAPP_LOGIN_RETRY_DELAYS_MS) {
        await startWhatsAppLogin(host, force);
        if (!isWhatsAppProviderUnavailable(host.whatsappLoginMessage)) {
          break;
        }
        await waitMs(delayMs);
      }
    } else if (isWhatsAppProviderUnavailable(host.whatsappLoginMessage)) {
      host.whatsappLoginMessage =
        "WhatsApp login provider is unavailable. Auto-enable failed. Ensure plugins.enabled, web.enabled, and channels.whatsapp.enabled are true; remove whatsapp from plugins.deny; if plugins.allow is set, include whatsapp.";
    }
  }
  if (!force && isWhatsAppAlreadyLinked(host.whatsappLoginMessage)) {
    await loadChannels(host, true);
    syncWhatsAppConnectedFromSnapshot(host);
    if (!host.whatsappLoginConnected && shouldAutoRelinkWhatsApp(host)) {
      await startWhatsAppLogin(host, true);
    }
  }
  await loadChannels(host, true);
  syncWhatsAppConnectedFromSnapshot(host);
  if (!force && isWhatsAppAlreadyLinked(host.whatsappLoginMessage)) {
    setWhatsAppListenerRecoveryMessage(host, "linked");
  }
  if (
    force &&
    host.whatsappLoginMessage?.toLowerCase().includes("timed out waiting for whatsapp qr")
  ) {
    setWhatsAppListenerRecoveryMessage(host, "timeout");
  }
  if (shouldAutoWaitForWhatsAppScan(host)) {
    await waitWhatsAppLogin(host);
    const waitReportedConnected = host.whatsappLoginConnected === true;
    await loadChannels(host, true);
    syncWhatsAppConnectedFromSnapshot(host);
    if (waitReportedConnected) {
      await convergeWhatsAppConnectedState(host);
      await convergeWhatsAppReadyState(host);
      if (!isWhatsAppReadyInSnapshot(host)) {
        setWhatsAppListenerRecoveryMessage(host, "linked");
        host.whatsappLoginConnected = false;
      }
    }
  }
  if (isWhatsAppReadyInSnapshot(host)) {
    await autoConfigureWhatsAppDefaultTarget(host);
  }
}

export async function handleWhatsAppWait(host: OpenClawApp) {
  await waitWhatsAppLogin(host);
  const waitReportedConnected = host.whatsappLoginConnected === true;
  await loadChannels(host, true);
  syncWhatsAppConnectedFromSnapshot(host);
  if (waitReportedConnected) {
    await convergeWhatsAppConnectedState(host);
    await convergeWhatsAppReadyState(host);
    if (!isWhatsAppReadyInSnapshot(host)) {
      setWhatsAppListenerRecoveryMessage(host, "linked");
      host.whatsappLoginConnected = false;
    }
  }
  if (isWhatsAppReadyInSnapshot(host)) {
    await autoConfigureWhatsAppDefaultTarget(host);
  }
}

export async function handleWhatsAppLogout(host: OpenClawApp) {
  await logoutWhatsApp(host);
  await loadChannels(host, true);
  syncWhatsAppConnectedFromSnapshot(host);
}

export async function handleChannelConfigSave(host: OpenClawApp) {
  await saveConfig(host);
  await loadConfig(host);
  await loadChannels(host, true);
}

export async function handleChannelConfigReload(host: OpenClawApp) {
  await loadConfig(host);
  await loadChannels(host, true);
}

function parseValidationErrors(details: unknown): Record<string, string> {
  if (!Array.isArray(details)) {
    return {};
  }
  const errors: Record<string, string> = {};
  for (const entry of details) {
    if (typeof entry !== "string") {
      continue;
    }
    const [rawField, ...rest] = entry.split(":");
    if (!rawField || rest.length === 0) {
      continue;
    }
    const field = rawField.trim();
    const message = rest.join(":").trim();
    if (field && message) {
      errors[field] = message;
    }
  }
  return errors;
}

function resolveNostrAccountId(host: OpenClawApp): string {
  const accounts = host.channelsSnapshot?.channelAccounts?.nostr ?? [];
  return accounts[0]?.accountId ?? host.nostrProfileAccountId ?? "default";
}

function buildNostrProfileUrl(accountId: string, suffix = ""): string {
  return `/api/channels/nostr/${encodeURIComponent(accountId)}/profile${suffix}`;
}

function resolveGatewayHttpAuthHeader(host: OpenClawApp): string | null {
  const deviceToken = host.hello?.auth?.deviceToken?.trim();
  if (deviceToken) {
    return `Bearer ${deviceToken}`;
  }
  const token = host.settings.token.trim();
  if (token) {
    return `Bearer ${token}`;
  }
  const password = host.password.trim();
  if (password) {
    return `Bearer ${password}`;
  }
  return null;
}

function buildGatewayHttpHeaders(host: OpenClawApp): Record<string, string> {
  const authorization = resolveGatewayHttpAuthHeader(host);
  return authorization ? { Authorization: authorization } : {};
}

export function handleNostrProfileEdit(
  host: OpenClawApp,
  accountId: string,
  profile: NostrProfile | null,
) {
  host.nostrProfileAccountId = accountId;
  host.nostrProfileFormState = createNostrProfileFormState(profile ?? undefined);
}

export function handleNostrProfileCancel(host: OpenClawApp) {
  host.nostrProfileFormState = null;
  host.nostrProfileAccountId = null;
}

export function handleNostrProfileFieldChange(
  host: OpenClawApp,
  field: keyof NostrProfile,
  value: string,
) {
  const state = host.nostrProfileFormState;
  if (!state) {
    return;
  }
  host.nostrProfileFormState = {
    ...state,
    values: {
      ...state.values,
      [field]: value,
    },
    fieldErrors: {
      ...state.fieldErrors,
      [field]: "",
    },
  };
}

export function handleNostrProfileToggleAdvanced(host: OpenClawApp) {
  const state = host.nostrProfileFormState;
  if (!state) {
    return;
  }
  host.nostrProfileFormState = {
    ...state,
    showAdvanced: !state.showAdvanced,
  };
}

export async function handleNostrProfileSave(host: OpenClawApp) {
  const state = host.nostrProfileFormState;
  if (!state || state.saving) {
    return;
  }
  const accountId = resolveNostrAccountId(host);

  host.nostrProfileFormState = {
    ...state,
    saving: true,
    error: null,
    success: null,
    fieldErrors: {},
  };

  try {
    const response = await fetch(buildNostrProfileUrl(accountId), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...buildGatewayHttpHeaders(host),
      },
      body: JSON.stringify(state.values),
    });
    const data = (await response.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
      details?: unknown;
      persisted?: boolean;
    } | null;

    if (!response.ok || data?.ok === false || !data) {
      const errorMessage = data?.error ?? `Profile update failed (${response.status})`;
      host.nostrProfileFormState = {
        ...state,
        saving: false,
        error: errorMessage,
        success: null,
        fieldErrors: parseValidationErrors(data?.details),
      };
      return;
    }

    if (!data.persisted) {
      host.nostrProfileFormState = {
        ...state,
        saving: false,
        error: "Profile publish failed on all relays.",
        success: null,
      };
      return;
    }

    host.nostrProfileFormState = {
      ...state,
      saving: false,
      error: null,
      success: "Profile published to relays.",
      fieldErrors: {},
      original: { ...state.values },
    };
    await loadChannels(host, true);
  } catch (err) {
    host.nostrProfileFormState = {
      ...state,
      saving: false,
      error: `Profile update failed: ${String(err)}`,
      success: null,
    };
  }
}

export async function handleNostrProfileImport(host: OpenClawApp) {
  const state = host.nostrProfileFormState;
  if (!state || state.importing) {
    return;
  }
  const accountId = resolveNostrAccountId(host);

  host.nostrProfileFormState = {
    ...state,
    importing: true,
    error: null,
    success: null,
  };

  try {
    const response = await fetch(buildNostrProfileUrl(accountId, "/import"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildGatewayHttpHeaders(host),
      },
      body: JSON.stringify({ autoMerge: true }),
    });
    const data = (await response.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
      imported?: NostrProfile;
      merged?: NostrProfile;
      saved?: boolean;
    } | null;

    if (!response.ok || data?.ok === false || !data) {
      const errorMessage = data?.error ?? `Profile import failed (${response.status})`;
      host.nostrProfileFormState = {
        ...state,
        importing: false,
        error: errorMessage,
        success: null,
      };
      return;
    }

    const merged = data.merged ?? data.imported ?? null;
    const nextValues = merged ? { ...state.values, ...merged } : state.values;
    const showAdvanced = Boolean(
      nextValues.banner || nextValues.website || nextValues.nip05 || nextValues.lud16,
    );

    host.nostrProfileFormState = {
      ...state,
      importing: false,
      values: nextValues,
      error: null,
      success: data.saved
        ? "Profile imported from relays. Review and publish."
        : "Profile imported. Review and publish.",
      showAdvanced,
    };

    if (data.saved) {
      await loadChannels(host, true);
    }
  } catch (err) {
    host.nostrProfileFormState = {
      ...state,
      importing: false,
      error: `Profile import failed: ${String(err)}`,
      success: null,
    };
  }
}
