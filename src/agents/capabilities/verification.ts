import { resolveSlackAccount } from "../../../extensions/slack/src/accounts.js";
import { createSlackWebClient } from "../../../extensions/slack/src/client.js";
import { parseSlackTarget } from "../../../extensions/slack/src/targets.js";
import { resolveChannelDefaultAccountId } from "../../channels/plugins/helpers.js";
import { getChannelPlugin } from "../../channels/plugins/index.js";
import type { OpenClawConfig } from "../../config/config.js";
import { getGogAuthStatus, probeGogGmailApi } from "../../hooks/gmail-setup-utils.js";
import { writePlannerIntegrations } from "./integration-store.js";
import type {
  PlannedIntegrationInstance,
  PlannedVerificationResult,
  PlannedVerificationStatus,
  RequirementPlannerResult,
} from "./planner.js";
import { rebuildRequirementPlannerResult } from "./planner.js";
import {
  readPlannerVerificationResults,
  writePlannerVerificationResults,
} from "./verification-store.js";

export type RequirementPlannerVerificationRun = {
  fingerprint: string;
  checkedAt: string;
  passedCount: number;
  failedCount: number;
  blockedCount: number;
  unresolvedCount: number;
  results: PlannedVerificationResult[];
};

type LiveVerificationParams = {
  planning: RequirementPlannerResult;
  cfg?: OpenClawConfig;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
};

type ChannelProbeOutcome =
  | { ok: true; detail: string }
  | { ok: false; status: "failed" | "blocked"; detail: string };

function dedupeStrings(values: string[]): string[] {
  return values.filter((value, index, all) => all.indexOf(value) === index);
}

function parseTimestamp(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mergeVerificationResults(
  planning: RequirementPlannerResult,
  updates: PlannedVerificationResult[],
  source: "persisted" | "live",
): RequirementPlannerResult {
  if (updates.length === 0) {
    return planning;
  }
  const updatesById = new Map(updates.map((result) => [result.id, result] as const));
  const verifications = planning.verifications.map((result) => {
    const updated = updatesById.get(result.id);
    if (!updated) {
      return result;
    }
    return {
      ...result,
      status: updated.status,
      detail: updated.detail,
      source,
      checkedAt: updated.checkedAt,
    };
  });
  const integrations = planning.integrations.map((integration) =>
    mergeIntegrationVerificationState(integration, verifications),
  );
  return rebuildRequirementPlannerResult({
    status: planning.status,
    selections: planning.selections,
    alternatives: planning.alternatives,
    variants: planning.variants,
    integrations,
    verifications,
    verificationFingerprint: planning.verificationFingerprint,
    topology: planning.topology,
  });
}

function mergeIntegrationVerificationState(
  integration: PlannedIntegrationInstance,
  verifications: PlannedVerificationResult[],
): PlannedIntegrationInstance {
  const relevant = verifications.filter(
    (result) =>
      result.connectorId === integration.connectorId &&
      (result.source ?? "preflight") !== "preflight",
  );
  if (relevant.length === 0) {
    return integration;
  }

  const issues = integration.issues.slice();
  let status = integration.status;

  const latestVerifiedAt = relevant
    .filter((result) => result.status === "passed" && result.checkedAt)
    .map((result) => result.checkedAt)
    .toSorted((left, right) => parseTimestamp(left) - parseTimestamp(right))
    .at(-1);
  const failedResults = relevant.filter((result) => result.status === "failed");
  if (failedResults.length > 0) {
    status =
      integration.status === "install_required" || integration.status === "discovered"
        ? integration.status
        : "degraded";
    for (const result of failedResults) {
      issues.push(`Live verification failed for ${result.probeLabel}: ${result.detail}`);
    }
  } else {
    const verifiableResults = relevant.filter((result) => result.status !== "needs_live_check");
    if (
      verifiableResults.length > 0 &&
      verifiableResults.every((result) => result.status === "passed")
    ) {
      const unresolved = relevant.some((result) => result.status === "needs_live_check");
      if (
        !unresolved &&
        integration.status !== "install_required" &&
        integration.status !== "discovered"
      ) {
        status = "verified";
      }
    }
  }

  return {
    ...integration,
    status,
    issues: dedupeStrings(issues),
    ...(latestVerifiedAt ? { lastVerifiedAt: latestVerifiedAt } : {}),
  };
}

function liveCheckUnavailable(
  result: PlannedVerificationResult,
  detail: string,
  checkedAt: string,
): PlannedVerificationResult {
  return {
    ...result,
    status: "needs_live_check",
    detail,
    source: "live",
    checkedAt,
  };
}

function passedLiveResult(
  result: PlannedVerificationResult,
  detail: string,
  checkedAt: string,
): PlannedVerificationResult {
  return {
    ...result,
    status: "passed",
    detail,
    source: "live",
    checkedAt,
  };
}

function failedLiveResult(
  result: PlannedVerificationResult,
  status: Extract<PlannedVerificationStatus, "failed" | "blocked">,
  detail: string,
  checkedAt: string,
): PlannedVerificationResult {
  return {
    ...result,
    status,
    detail,
    source: "live",
    checkedAt,
  };
}

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Live verification for the Gmail Hook (gog OAuth client).
 *
 * Previously this returned `needs_live_check`, which meant the Builder would
 * happily create agents that referenced Gmail even when the underlying `gog`
 * keyring was corrupted or the OAuth client credentials were missing. That
 * produced runtime failures like `read token: aes.KeyUnwrap(): integrity check
 * failed`, with no chance for the user to fix things during setup.
 *
 * This actually calls `gog auth status --json --client openclaw-gmail-hook`
 * via the shared helper and classifies common failure modes so the verify step
 * surfaces them before apply.
 */
async function runGmailHookLiveVerification(params: {
  result: PlannedVerificationResult;
  integration: PlannedIntegrationInstance;
  checkedAt: string;
}): Promise<PlannedVerificationResult> {
  // User-facing guidance: point to the EasyClaw Gmail setup page instead of
  // raw terminal commands. The setup page walks users through uploading
  // credentials.json and signing in with Google; it's the primary way
  // non-technical users should recover from broken Gmail auth.
  const openGmailSetupHint = "Open Gmail Setup in EasyClaw (Setup → Gmail Hook) to reconnect.";
  try {
    const status = await getGogAuthStatus();
    if (!status.credentialsExists) {
      return failedLiveResult(
        params.result,
        "failed",
        `Gmail is not connected yet. ${openGmailSetupHint} You'll upload a credentials file once and sign in with Google — no terminal needed.`,
        params.checkedAt,
      );
    }
    if (!status.email) {
      return failedLiveResult(
        params.result,
        "failed",
        `Gmail credentials are loaded, but no account is signed in. ${openGmailSetupHint}`,
        params.checkedAt,
      );
    }
    // Metadata is fine; now confirm the keyring can actually decrypt the
    // stored token and the token still has Gmail scopes. This is the only
    // check that catches the `aes.KeyUnwrap(): integrity check failed`
    // state that otherwise only surfaces when the agent runs.
    const apiProbe = await probeGogGmailApi({ account: status.email });
    if (!apiProbe.ok) {
      switch (apiProbe.kind) {
        case "keyring":
          return failedLiveResult(
            params.result,
            "failed",
            `Gmail needs to be reconnected: its sign-in state is corrupted. ${openGmailSetupHint}`,
            params.checkedAt,
          );
        case "scopes":
          return failedLiveResult(
            params.result,
            "failed",
            `Gmail is connected but is missing the permissions EasyClaw needs. ${openGmailSetupHint} Make sure to grant the full Gmail permission when signing in.`,
            params.checkedAt,
          );
        case "auth":
          return failedLiveResult(
            params.result,
            "failed",
            `Gmail sign-in has expired. ${openGmailSetupHint}`,
            params.checkedAt,
          );
        default:
          return failedLiveResult(
            params.result,
            "failed",
            `Gmail access check failed. ${openGmailSetupHint} Details: ${apiProbe.detail}`,
            params.checkedAt,
          );
      }
    }
    return passedLiveResult(
      params.result,
      `Gmail is connected for ${status.email} and can read messages.`,
      params.checkedAt,
    );
  } catch (error) {
    const message = normalizeErrorMessage(error);
    if (/KeyUnwrap|integrity check failed/i.test(message)) {
      return failedLiveResult(
        params.result,
        "failed",
        `Gmail needs to be reconnected: its sign-in state is corrupted. ${openGmailSetupHint}`,
        params.checkedAt,
      );
    }
    if (/ENOENT|not found|missing/i.test(message)) {
      return failedLiveResult(
        params.result,
        "blocked",
        `EasyClaw can't reach the Gmail helper on this machine. ${openGmailSetupHint} If the setup page says the helper is missing, complete it once — it installs what's needed.`,
        params.checkedAt,
      );
    }
    return failedLiveResult(
      params.result,
      "failed",
      `Gmail access check failed. ${openGmailSetupHint} Details: ${message}`,
      params.checkedAt,
    );
  }
}

async function runSlackSendTestResult(params: {
  result: PlannedVerificationResult;
  cfg?: OpenClawConfig;
  timeoutMs: number;
  checkedAt: string;
}): Promise<PlannedVerificationResult> {
  const cfg = params.cfg ?? {};
  const plugin = getChannelPlugin("slack");
  if (!plugin) {
    return failedLiveResult(
      params.result,
      "blocked",
      "Slack is not active in this runtime yet.",
      params.checkedAt,
    );
  }

  const accountIds = plugin.config.listAccountIds(cfg);
  const defaultAccountId = resolveChannelDefaultAccountId({
    plugin,
    cfg,
    accountIds,
  });
  const account = resolveSlackAccount({ cfg, accountId: defaultAccountId });
  const rawTarget = account.config.defaultTo?.trim();
  if (!rawTarget) {
    return failedLiveResult(
      params.result,
      "blocked",
      "Slack default delivery target is not configured yet.",
      params.checkedAt,
    );
  }

  const parsedTarget = parseSlackTarget(rawTarget, { defaultKind: "channel" });
  if (!parsedTarget) {
    return failedLiveResult(
      params.result,
      "blocked",
      `Slack default delivery target "${rawTarget}" is invalid.`,
      params.checkedAt,
    );
  }

  // Slack DM/user routes need a stateful send probe to be fully verified.
  if (
    parsedTarget.kind !== "channel" ||
    /^D[A-Z0-9]+$/i.test(parsedTarget.id) ||
    /^U[A-Z0-9]+$/i.test(parsedTarget.id)
  ) {
    return liveCheckUnavailable(
      params.result,
      `Slack delivery target ${rawTarget} is configured, but a non-destructive live DM send probe is not implemented yet.`,
      params.checkedAt,
    );
  }

  const botToken = account.botToken?.trim();
  if (!botToken) {
    return failedLiveResult(
      params.result,
      "blocked",
      `Slack bot token is missing for account "${account.accountId}".`,
      params.checkedAt,
    );
  }

  const client = createSlackWebClient(botToken, { timeout: params.timeoutMs });
  const destinationLabel = `channel:${parsedTarget.id}`;
  try {
    const response = await client.conversations.info({ channel: parsedTarget.id });
    const channelName = response.channel?.name?.trim();
    const label = channelName ? `#${channelName}` : destinationLabel;
    if (response.channel?.is_member === true) {
      return passedLiveResult(
        params.result,
        `Slack delivery target ${label} is reachable for live delivery.`,
        params.checkedAt,
      );
    }
    return failedLiveResult(
      params.result,
      "failed",
      `Slack workspace auth is ready, but the bot is not a member of ${label}. Invite the app to that conversation, then rerun verification.`,
      params.checkedAt,
    );
  } catch (error) {
    const message = normalizeErrorMessage(error);
    if (message.includes("channel_not_found")) {
      return failedLiveResult(
        params.result,
        "failed",
        `Slack workspace auth is ready, but delivery target ${destinationLabel} is not visible to the bot. Invite the app to that conversation, then rerun verification.`,
        params.checkedAt,
      );
    }
    if (message.includes("missing_scope")) {
      return failedLiveResult(
        params.result,
        "failed",
        `Slack workspace auth is ready, but delivery target ${destinationLabel} cannot be verified because the bot token is missing the required channel-read scopes.`,
        params.checkedAt,
      );
    }
    return failedLiveResult(
      params.result,
      "failed",
      `Slack delivery target ${destinationLabel} could not be verified: ${message}`,
      params.checkedAt,
    );
  }
}

async function runChannelProbe(params: {
  integration: PlannedIntegrationInstance;
  cfg?: OpenClawConfig;
  timeoutMs: number;
}): Promise<ChannelProbeOutcome> {
  const channelId = params.integration.connectorId.replace(/^channel:/, "");
  const plugin = getChannelPlugin(channelId);
  if (!plugin) {
    return {
      ok: false,
      status: "blocked",
      detail: `${params.integration.label} is not active in this runtime yet.`,
    };
  }

  const cfg = params.cfg ?? {};
  const accountIds = plugin.config.listAccountIds(cfg);
  const defaultAccountId = resolveChannelDefaultAccountId({
    plugin,
    cfg,
    accountIds,
  });
  const account = plugin.config.resolveAccount(cfg, defaultAccountId);
  const enabled = plugin.config.isEnabled ? plugin.config.isEnabled(account, cfg) : true;
  const configured = plugin.config.isConfigured
    ? await plugin.config.isConfigured(account, cfg)
    : true;
  if (!enabled) {
    return {
      ok: false,
      status: "blocked",
      detail: `${params.integration.label} is disabled in the current configuration.`,
    };
  }
  if (!configured) {
    return {
      ok: false,
      status: "blocked",
      detail: `${params.integration.label} is not configured enough for a live probe yet.`,
    };
  }
  if (!plugin.status?.probeAccount) {
    return {
      ok: false,
      status: "blocked",
      detail: `${params.integration.label} does not expose a live account probe yet.`,
    };
  }

  try {
    const probe = await plugin.status.probeAccount({
      account,
      timeoutMs: params.timeoutMs,
      cfg,
    });
    const record =
      probe && typeof probe === "object" ? (probe as Record<string, unknown>) : undefined;
    const ok = record && typeof record.ok === "boolean" ? record.ok : undefined;
    if (ok === false) {
      const error =
        typeof record?.error === "string" && record.error.trim().length > 0
          ? record.error.trim()
          : `${params.integration.label} probe returned an unhealthy response.`;
      return {
        ok: false,
        status: "failed",
        detail: error,
      };
    }
    return {
      ok: true,
      detail: `${params.integration.label} responded to a live account probe successfully.`,
    };
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runLiveVerificationResult(params: {
  result: PlannedVerificationResult;
  integration: PlannedIntegrationInstance | undefined;
  cfg?: OpenClawConfig;
  timeoutMs: number;
  checkedAt: string;
  channelProbeCache: Map<string, Promise<ChannelProbeOutcome>>;
}): Promise<PlannedVerificationResult> {
  const integration = params.integration;
  if (!integration) {
    return failedLiveResult(
      params.result,
      "blocked",
      "The planned integration for this probe is missing.",
      params.checkedAt,
    );
  }

  if (integration.status === "install_required" || integration.status === "discovered") {
    return failedLiveResult(
      params.result,
      "blocked",
      integration.issues[0] ??
        `${integration.label} still needs setup before ${params.result.probeLabel.toLowerCase()} can run.`,
      params.checkedAt,
    );
  }

  if (
    integration.sourceKind === "builtin_channel" ||
    integration.sourceKind === "channel_catalog"
  ) {
    if (integration.connectorId === "channel:slack" && params.result.probeKind === "send_test") {
      return await runSlackSendTestResult({
        result: params.result,
        cfg: params.cfg,
        timeoutMs: params.timeoutMs,
        checkedAt: params.checkedAt,
      });
    }
    const probePromise =
      params.channelProbeCache.get(integration.connectorId) ??
      runChannelProbe({
        integration,
        cfg: params.cfg,
        timeoutMs: params.timeoutMs,
      });
    params.channelProbeCache.set(integration.connectorId, probePromise);
    const outcome = await probePromise;
    if (params.result.probeKind === "send_test") {
      return liveCheckUnavailable(
        params.result,
        `${integration.label} is connected, but a non-destructive live send probe is not implemented yet.`,
        params.checkedAt,
      );
    }
    return outcome.ok
      ? passedLiveResult(params.result, outcome.detail, params.checkedAt)
      : failedLiveResult(params.result, outcome.status, outcome.detail, params.checkedAt);
  }

  if (integration.sourceKind === "core_platform") {
    switch (integration.connectorId) {
      case "platform:exec-approvals":
      case "platform:webhook-runtime":
        return integration.status === "configured" || integration.status === "verified"
          ? passedLiveResult(params.result, params.result.detail, params.checkedAt)
          : failedLiveResult(
              params.result,
              "blocked",
              integration.issues[0] ??
                `${integration.label} is not configured enough for live verification.`,
              params.checkedAt,
            );
      case "platform:gmail-hook":
        return runGmailHookLiveVerification({
          result: params.result,
          integration,
          checkedAt: params.checkedAt,
        });
      case "platform:core-model":
        return liveCheckUnavailable(
          params.result,
          `${integration.label} does not have a non-destructive live verification path yet.`,
          params.checkedAt,
        );
      default:
        return passedLiveResult(params.result, params.result.detail, params.checkedAt);
    }
  }

  if (integration.sourceKind === "core_tool_section") {
    if (integration.connectorId === "tools:messaging" && params.result.probeKind === "send_test") {
      return liveCheckUnavailable(
        params.result,
        "OpenClaw Messaging Tools do not expose a non-destructive live send probe yet.",
        params.checkedAt,
      );
    }
    if (integration.connectorId === "tools:ui" && params.result.probeKind === "browser_session") {
      return liveCheckUnavailable(
        params.result,
        "OpenClaw UI Tools do not expose a reusable browser session probe yet.",
        params.checkedAt,
      );
    }
    if (
      integration.connectorId === "tools:web" ||
      integration.connectorId === "tools:fs" ||
      integration.connectorId === "tools:memory" ||
      integration.connectorId === "tools:media"
    ) {
      return liveCheckUnavailable(
        params.result,
        `${integration.label} needs workflow-specific input before a safe live check can run.`,
        params.checkedAt,
      );
    }
    return passedLiveResult(
      params.result,
      `${integration.label} is available in the current OpenClaw runtime.`,
      params.checkedAt,
    );
  }

  return liveCheckUnavailable(
    params.result,
    `${integration.label} does not have a dedicated live verification handler yet.`,
    params.checkedAt,
  );
}

function buildVerificationRun(
  fingerprint: string,
  checkedAt: string,
  results: PlannedVerificationResult[],
): RequirementPlannerVerificationRun {
  return {
    fingerprint,
    checkedAt,
    passedCount: results.filter((result) => result.status === "passed").length,
    failedCount: results.filter((result) => result.status === "failed").length,
    blockedCount: results.filter((result) => result.status === "blocked").length,
    unresolvedCount: results.filter((result) => result.status === "needs_live_check").length,
    results,
  };
}

export async function hydrateRequirementPlannerVerificationState(
  planning: RequirementPlannerResult,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RequirementPlannerResult> {
  const fingerprint = planning.verificationFingerprint;
  const persisted = await readPlannerVerificationResults({ fingerprint, env });
  return mergeVerificationResults(planning, persisted, "persisted");
}

export async function runRequirementPlannerLiveVerification(
  params: LiveVerificationParams,
): Promise<{ planning: RequirementPlannerResult; run: RequirementPlannerVerificationRun }> {
  const fingerprint = params.planning.verificationFingerprint;
  const checkedAt = new Date().toISOString();
  const channelProbeCache = new Map<string, Promise<ChannelProbeOutcome>>();
  const liveResults = await Promise.all(
    params.planning.verifications.map(async (result) => {
      const integration = params.planning.integrations.find(
        (entry) => entry.connectorId === result.connectorId,
      );
      return await runLiveVerificationResult({
        result,
        integration,
        cfg: params.cfg,
        timeoutMs: Math.max(1_000, params.timeoutMs ?? 5_000),
        checkedAt,
        channelProbeCache,
      });
    }),
  );
  await writePlannerVerificationResults({
    fingerprint,
    results: liveResults,
    env: params.env,
  });
  const planning = mergeVerificationResults(params.planning, liveResults, "live");
  await writePlannerIntegrations({
    integrations: planning.integrations,
    env: params.env,
  });
  return {
    planning,
    run: buildVerificationRun(fingerprint, checkedAt, liveResults),
  };
}

export const __testing = {
  buildVerificationFingerprint: (planning: RequirementPlannerResult) =>
    planning.verificationFingerprint,
  mergeVerificationResults,
};
