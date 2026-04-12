import {
  asString,
  collectIssuesForEnabledAccounts,
  isRecord,
} from "../../../src/channels/plugins/status-issues/shared.js";
import type {
  ChannelAccountSnapshot,
  ChannelStatusIssue,
} from "../../../src/channels/plugins/types.js";
import { formatCliCommand } from "../../../src/cli/command-format.js";
import { isLikelyWhatsAppCryptoError } from "./auto-reply/util.js";

type WhatsAppAccountStatus = {
  accountId?: unknown;
  enabled?: unknown;
  linked?: unknown;
  connected?: unknown;
  running?: unknown;
  reconnectAttempts?: unknown;
  lastError?: unknown;
  probe?: unknown;
};

function readWhatsAppAccountStatus(value: ChannelAccountSnapshot): WhatsAppAccountStatus | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    accountId: value.accountId,
    enabled: value.enabled,
    linked: value.linked,
    connected: value.connected,
    running: value.running,
    reconnectAttempts: value.reconnectAttempts,
    lastError: value.lastError,
    probe: value.probe,
  };
}

export function collectWhatsAppStatusIssues(
  accounts: ChannelAccountSnapshot[],
): ChannelStatusIssue[] {
  return collectIssuesForEnabledAccounts({
    accounts,
    readAccount: readWhatsAppAccountStatus,
    collectIssues: ({ account, accountId, issues }) => {
      const linked = account.linked === true;
      const running = account.running === true;
      const connected = account.connected === true;
      const reconnectAttempts =
        typeof account.reconnectAttempts === "number" ? account.reconnectAttempts : null;
      const lastError = asString(account.lastError);
      const probeRecord =
        account.probe && typeof account.probe === "object" && !Array.isArray(account.probe)
          ? (account.probe as Record<string, unknown>)
          : null;
      const probeError =
        probeRecord && typeof probeRecord.error === "string" ? probeRecord.error.trim() : "";
      const cryptoAuthFailure = isLikelyWhatsAppCryptoError(lastError || probeError);
      const reconnectFix = cryptoAuthFailure
        ? `Run: ${formatCliCommand("openclaw channels login")} to relink the WhatsApp Web session, then restart the gateway.`
        : `Run: ${formatCliCommand("openclaw doctor")} (or restart the gateway). If it persists, relink via channels login and check logs.`;

      if (!linked) {
        issues.push({
          channel: "whatsapp",
          accountId,
          kind: "auth",
          message: "Not linked (no WhatsApp Web session).",
          fix: `Run: ${formatCliCommand("openclaw channels login")} (scan QR on the gateway host).`,
        });
        return;
      }

      if (!running) {
        issues.push({
          channel: "whatsapp",
          accountId,
          kind: "runtime",
          message: `Linked but not running${lastError ? `: ${lastError}` : probeError ? `: ${probeError}` : "."}`,
          fix: reconnectFix,
        });
        return;
      }

      if (!connected) {
        issues.push({
          channel: "whatsapp",
          accountId,
          kind: "runtime",
          message: `Linked but disconnected${reconnectAttempts != null ? ` (reconnectAttempts=${reconnectAttempts})` : ""}${lastError ? `: ${lastError}` : probeError ? `: ${probeError}` : "."}`,
          fix: reconnectFix,
        });
      }
    },
  });
}
