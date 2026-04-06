import { resolveDiscordAccount } from "../../../extensions/discord/src/accounts.js";
import { probeDiscord } from "../../../extensions/discord/src/probe.js";
import { normalizeDiscordToken } from "../../../extensions/discord/src/token.js";
import { resolveGoogleChatAccount } from "../../../extensions/googlechat/src/accounts.js";
import { probeGoogleChat } from "../../../extensions/googlechat/src/api.js";
import { resolveIMessageAccount } from "../../../extensions/imessage/src/accounts.js";
import { probeIMessage } from "../../../extensions/imessage/src/probe.js";
import { resolveMatrixAccount } from "../../../extensions/matrix/src/matrix/accounts.js";
import { resolveMatrixAuth } from "../../../extensions/matrix/src/matrix/client/config.js";
import { probeMatrix } from "../../../extensions/matrix/src/matrix/probe.js";
import { probeMSTeams } from "../../../extensions/msteams/src/probe.js";
import { resolveSignalAccount } from "../../../extensions/signal/src/accounts.js";
import { probeSignal } from "../../../extensions/signal/src/probe.js";
import { resolveSlackAccount } from "../../../extensions/slack/src/accounts.js";
import { createSlackWebClient } from "../../../extensions/slack/src/client.js";
import { probeSlack } from "../../../extensions/slack/src/probe.js";
import { resolveTelegramAccount } from "../../../extensions/telegram/src/accounts.js";
import {
  fetchTelegramBotIdentity,
  fetchTelegramLatestDeliveryTarget,
} from "../../../extensions/telegram/src/api-fetch.js";
import { normalizeTelegramBotToken } from "../../../extensions/telegram/src/token.js";
import {
  applyAgentBlueprintBuilderPlan,
  compileAgentBlueprintBuilderPlan,
  verifyAgentBlueprintBuilderPlan,
} from "../../agents/blueprints/builder.js";
import { inspectConnectorSetupState } from "../../agents/capabilities/planner.js";
import { loadConfig, writeConfigFile } from "../../config/config.js";
import { REDACTED_SENTINEL } from "../../config/redact-snapshot.js";
import { runGmailSetup } from "../../hooks/gmail-ops.js";
import {
  discoverDownloadedGogCredentials,
  extractTailscaleFunnelEnableUrl,
  getActiveGcloudAccount,
  getGogKeyringPasswordPath,
  getGogAuthStatus,
  getTailscaleConnectionSummary,
  importGogCredentialsJson,
  installMacAppWithBrew,
  validatePublicPushEndpoint,
} from "../../hooks/gmail-setup-utils.js";
import { OPENCLAW_GOG_CLIENT } from "../../hooks/gmail.js";
import { launchMacApp, launchMacPath, launchTerminalCommand } from "../../infra/terminal-launch.js";
import { normalizeAccountId } from "../../routing/session-key.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

function buildGmailGogLoginCommand(account: string): string {
  return `gog login ${account} --client ${OPENCLAW_GOG_CLIENT} --services gmail --gmail-scope full --force-consent`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function buildGmailGogLaunchCommand(account: string): Promise<string> {
  const passwordPath = await getGogKeyringPasswordPath();
  const loginCommand = buildGmailGogLoginCommand(account);
  return `export GOG_KEYRING_BACKEND=file; export GOG_KEYRING_PASSWORD="$(cat ${shellQuote(
    passwordPath,
  )})"; ${loginCommand}`;
}

function parseBuilderParams(raw: unknown): {
  brief: string;
  templateId?: string;
  modelId?: string;
} {
  if (!raw || typeof raw !== "object") {
    return { brief: "" };
  }
  const record = raw as Record<string, unknown>;
  const brief = typeof record.brief === "string" ? record.brief.trim() : "";
  const templateId = typeof record.templateId === "string" ? record.templateId.trim() : "";
  const modelId = typeof record.modelId === "string" ? record.modelId.trim() : "";
  return {
    brief,
    ...(templateId ? { templateId } : {}),
    ...(modelId ? { modelId } : {}),
  };
}

function parseBuilderSetupParams(raw: unknown): {
  connectorId: string;
  inputs: Record<string, unknown>;
} {
  if (!raw || typeof raw !== "object") {
    return { connectorId: "", inputs: {} };
  }
  const record = raw as Record<string, unknown>;
  const connectorId = typeof record.connectorId === "string" ? record.connectorId.trim() : "";
  const inputs =
    record.inputs && typeof record.inputs === "object" && !Array.isArray(record.inputs)
      ? (record.inputs as Record<string, unknown>)
      : {};
  return { connectorId, inputs };
}

function stringInput(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function firstStringInput(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = stringInput(record, key);
    if (value) {
      return value;
    }
  }
  return "";
}

function normalizeSetupSecret(value: string): string {
  if (!value || value === REDACTED_SENTINEL) {
    return "";
  }
  return value;
}

function normalizeSetupTelegramToken(value: string): string {
  const normalized = normalizeTelegramBotToken(value);
  if (!normalized || normalized === REDACTED_SENTINEL) {
    return "";
  }
  return normalized;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function dedupeStrings(values: string[]): string[] {
  return values.filter((value, index, all) => all.indexOf(value) === index);
}

function channelAccountRef(channel: string, accountId: string): string {
  return accountId && accountId !== "default"
    ? `channels.${channel}.accounts.${accountId}`
    : `channels.${channel}`;
}

async function probeSlackAppToken(
  appToken: string,
  timeoutMs: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const client = createSlackWebClient(appToken, { timeout: timeoutMs });
  try {
    const response = await client.apiCall("apps.connections.open");
    const record = asRecord(response);
    const ok = typeof record?.ok === "boolean" ? record.ok : true;
    if (!ok) {
      return {
        ok: false,
        error: stringInput(record ?? {}, "error") || "Slack rejected the app token.",
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: String(error instanceof Error ? error.message : error),
    };
  }
}

function setTelegramDefaultTargetInConfig(params: {
  cfg: ReturnType<typeof loadConfig>;
  target: string;
  accountId?: string;
}): ReturnType<typeof loadConfig> {
  const channels = asRecord(params.cfg.channels);
  const nextChannels = channels ? { ...channels } : {};
  const telegram = asRecord(nextChannels.telegram);
  const nextTelegram = telegram ? { ...telegram } : {};
  if (params.accountId) {
    const accounts = asRecord(nextTelegram.accounts);
    const nextAccounts = accounts ? { ...accounts } : {};
    const account = asRecord(nextAccounts[params.accountId]);
    const nextAccount = account ? { ...account } : {};
    nextAccount.defaultTo = params.target;
    nextAccounts[params.accountId] = nextAccount;
    nextTelegram.accounts = nextAccounts;
  } else {
    nextTelegram.defaultTo = params.target;
  }
  nextChannels.telegram = nextTelegram;
  return {
    ...params.cfg,
    channels: nextChannels,
  } as ReturnType<typeof loadConfig>;
}

function buildGmailSetupInputs(account: string, inputs: Record<string, unknown>) {
  return {
    account,
    project: stringInput(inputs, "project"),
    topic: stringInput(inputs, "topic"),
    subscription: stringInput(inputs, "subscription"),
    pushEndpoint: stringInput(inputs, "pushEndpoint"),
  };
}

function gmailSetupArgsFromInputs(account: string, inputs: Record<string, unknown>) {
  const setupInputs = buildGmailSetupInputs(account, inputs);
  return {
    account,
    interactiveAuth: false as const,
    ...(setupInputs.project ? { project: setupInputs.project } : {}),
    ...(setupInputs.topic ? { topic: setupInputs.topic } : {}),
    ...(setupInputs.subscription ? { subscription: setupInputs.subscription } : {}),
    ...(setupInputs.pushEndpoint ? { pushEndpoint: setupInputs.pushEndpoint } : {}),
  };
}

function gmailConfiguredPayload(
  connectorId: string,
  summary: Awaited<ReturnType<typeof runGmailSetup>>,
) {
  return {
    connectorId,
    status: "configured" as const,
    message:
      "Gmail hook configured. OpenClaw updated the topic, subscription, push endpoint, and Gmail watch.",
    updatedRefs: ["hooks.gmail", "hooks.token"],
    summary: {
      projectId: summary.projectId,
      topic: summary.topic,
      subscription: summary.subscription,
      pushEndpoint: summary.pushEndpoint,
      hookUrl: summary.hookUrl,
      serve: summary.serve,
    },
  };
}

function buildGmailAuthSteps(params: {
  account: string;
  includeGcloud: boolean;
  includeGog: boolean;
  gmailScopes?: boolean;
}) {
  const authSteps: Array<{
    id: string;
    label: string;
    detail: string;
    command: string;
    connectorId: string;
    inputs: Record<string, string>;
  }> = [];
  if (params.includeGcloud) {
    authSteps.push({
      id: "gcloud-auth",
      label: "Sign in to Google Cloud",
      detail: "Log in to the Google Cloud CLI so EasyClaw can enable APIs and manage Pub/Sub.",
      command: "gcloud auth login",
      connectorId: "platform:gmail-hook:gcloud-auth",
      inputs: {},
    });
  }
  if (params.includeGog) {
    const gmailCommand = buildGmailGogLoginCommand(params.account);
    authSteps.push({
      id: "gog-auth",
      label: params.gmailScopes ? "Grant Gmail access in gog" : "Sign in to gog",
      detail: params.gmailScopes
        ? "Re-consent in gog with Gmail access so EasyClaw can create the Gmail watch subscription."
        : "Authorize the Gmail helper with your mailbox so EasyClaw can create the Gmail watch subscription.",
      command: gmailCommand,
      connectorId: "platform:gmail-hook:gog-auth",
      inputs: { account: params.account },
    });
  }
  return authSteps;
}

function buildGmailTailscaleSteps(params: {
  account: string;
  inputs: Record<string, unknown>;
  appInstalled: boolean;
  installerPackagePath?: string | null;
  funnelEnableUrl?: string | null;
}) {
  const setupInputs = buildGmailSetupInputs(params.account, params.inputs);
  const steps: Array<{
    id: string;
    label: string;
    detail: string;
    command: string;
    connectorId: string;
    inputs: Record<string, string>;
  }> = [];

  if (process.platform === "darwin" && !params.appInstalled && params.installerPackagePath) {
    steps.push({
      id: "tailscale-open-installer",
      label: "Open Tailscale installer",
      detail:
        "Homebrew already downloaded the Tailscale installer package. Open it, finish the macOS install, then return here and continue.",
      command: `open ${params.installerPackagePath}`,
      connectorId: "platform:gmail-hook:tailscale-open-installer",
      inputs: setupInputs,
    });
    return steps;
  }

  if (process.platform === "darwin" && !params.appInstalled) {
    steps.push({
      id: "tailscale-install",
      label: "Install Tailscale",
      detail:
        "Install the Tailscale Mac app with Homebrew. EasyClaw will open it afterward so you can connect this machine.",
      command: "brew install --cask tailscale",
      connectorId: "platform:gmail-hook:tailscale-install",
      inputs: setupInputs,
    });
    return steps;
  }

  if (params.funnelEnableUrl) {
    steps.push({
      id: "tailscale-funnel-enable",
      label: "Enable Tailscale Funnel",
      detail:
        "Open the Tailscale Funnel page, enable Funnel for this node or tailnet, then return here and continue.",
      command: `open ${params.funnelEnableUrl}`,
      connectorId: "platform:gmail-hook:tailscale-funnel-enable",
      inputs: {
        ...setupInputs,
        funnelEnableUrl: params.funnelEnableUrl,
      },
    });
  }

  steps.push({
    id: "tailscale-start",
    label: "Open Tailscale",
    detail:
      "Open the Tailscale app and connect this machine. Gmail auto-setup uses a Tailscale-backed public push endpoint unless you provide your own Public Push Endpoint.",
    command: "open -a Tailscale",
    connectorId: "platform:gmail-hook:tailscale-start",
    inputs: setupInputs,
  });
  steps.push({
    id: "tailscale-check",
    label: "Check Tailscale and continue",
    detail:
      "After Tailscale shows this machine as connected, EasyClaw will verify it and immediately resume Gmail setup.",
    command: "tailscale status --json",
    connectorId: "platform:gmail-hook:tailscale-check",
    inputs: setupInputs,
  });
  return steps;
}

function buildGmailCredentialImport(inputs: Record<string, unknown>) {
  const project = stringInput(inputs, "project");
  return {
    connectorId: "platform:gmail-hook:gog-credentials",
    label: "Import OAuth client JSON",
    detail:
      "If EasyClaw cannot find the downloaded Desktop app OAuth client JSON automatically, upload it here so it can import it into gog.",
    consoleUrl: project
      ? `https://console.cloud.google.com/apis/credentials?project=${encodeURIComponent(project)}`
      : "https://console.cloud.google.com/apis/credentials",
    autoDetect: {
      connectorId: "platform:gmail-hook:gog-credentials-auto",
      label: "Import from Downloads and continue",
      detail:
        "After Google downloads the Desktop app OAuth client JSON, EasyClaw can find the newest matching file in Downloads, import it into gog, and continue into gog login automatically.",
    },
  };
}

function buildGenericSetupRunPayload(params: {
  connectorId: string;
  inspection: NonNullable<ReturnType<typeof inspectConnectorSetupState>>;
}) {
  const refs = dedupeStrings([
    ...params.inspection.integration.configRefs,
    ...params.inspection.integration.authRefs,
  ]);
  if (params.inspection.setupTask.status === "completed") {
    return {
      connectorId: params.connectorId,
      status: "configured" as const,
      message: params.inspection.setupTask.detail,
      updatedRefs: refs,
    };
  }

  const needsAuth =
    params.inspection.connector.setup.requiresAuth &&
    params.inspection.integration.status !== "install_required";
  const status = needsAuth ? "needs_auth" : "needs_setup";
  const detail =
    params.inspection.integration.issues[0]?.trim() || params.inspection.setupTask.detail.trim();
  const message = detail.length > 0 ? detail : `Finish ${params.inspection.connector.label} setup.`;
  return {
    connectorId: params.connectorId,
    status,
    message,
    updatedRefs: refs,
    resume: {
      connectorId: params.connectorId,
      label: "Re-check setup",
      detail: `Run setup check again after updating ${params.inspection.connector.label}.`,
      inputs: {},
    },
  };
}

async function buildGmailBlockedPayload(
  account: string,
  message: string,
  inputs: Record<string, unknown>,
) {
  const normalized = message.trim();
  const lower = normalized.toLowerCase();
  const pushEndpoint = stringInput(inputs, "pushEndpoint");
  const pushEndpointValidation = pushEndpoint ? validatePublicPushEndpoint(pushEndpoint) : null;
  if (pushEndpointValidation && !pushEndpointValidation.ok) {
    return {
      connectorId: "platform:gmail-hook",
      status: "needs_setup" as const,
      message: pushEndpointValidation.error,
      updatedRefs: [] as string[],
      resume: {
        connectorId: "platform:gmail-hook",
        label: "Retry Gmail setup",
        detail:
          "Run Gmail auto-setup again after you enter a valid public HTTPS Push Endpoint or use Tailscale Funnel.",
        inputs: {
          account,
          project: stringInput(inputs, "project"),
          topic: stringInput(inputs, "topic"),
          subscription: stringInput(inputs, "subscription"),
          pushEndpoint,
        },
      },
    };
  }
  const gcloudAccount = await getActiveGcloudAccount().catch(() => null);
  const gogStatus = await getGogAuthStatus().catch(() => null);
  const funnelEnableUrl = extractTailscaleFunnelEnableUrl(normalized);
  const needsTailscaleFunnel =
    lower.includes("tailscale funnel enable required") ||
    lower.includes("funnel is not enabled on your tailnet");
  const needsGmailScopes =
    lower.includes("insufficientpermissions") ||
    lower.includes("insufficient authentication scopes") ||
    lower.includes("access_token_scope_insufficient");
  const needsCredentials =
    lower.includes("gog oauth client credentials missing") ||
    (gogStatus ? !gogStatus.credentialsExists : false);
  const needsGcloud =
    lower.includes("gcloud login required") || (!gcloudAccount && normalized.length > 0);
  const needsGog =
    !needsCredentials &&
    (lower.includes("gog login required") ||
      lower.includes("gog is signed in as") ||
      Boolean(gogStatus && gogStatus.credentialsExists && gogStatus.email !== account));
  const needsTailscale =
    !pushEndpoint &&
    (lower.includes("tailscale status --json failed") ||
      lower.includes("failed to connect to local tailscale service") ||
      lower.includes("tailscale dns name missing") ||
      lower.includes("run tailscale up") ||
      needsTailscaleFunnel ||
      lower.includes("push endpoint required"));

  if (needsCredentials) {
    return {
      connectorId: "platform:gmail-hook",
      status: "needs_credentials" as const,
      message:
        "Gmail setup needs a Google OAuth client JSON before gog can sign in to this mailbox.",
      updatedRefs: [] as string[],
      authSteps: buildGmailAuthSteps({
        account,
        includeGcloud: needsGcloud,
        includeGog: false,
      }),
      credentialImport: buildGmailCredentialImport(inputs),
      resume: {
        connectorId: "platform:gmail-hook",
        label: "Retry Gmail setup",
        detail: "Run Gmail auto-setup again after the OAuth client JSON has been imported.",
        inputs: {
          account,
          project: stringInput(inputs, "project"),
          topic: stringInput(inputs, "topic"),
          subscription: stringInput(inputs, "subscription"),
          pushEndpoint,
        },
      },
    };
  }

  if (needsTailscale) {
    const tailscale = await getTailscaleConnectionSummary().catch(() => ({
      appInstalled: false,
      connected: false,
      dnsName: null,
      detail: "Tailscale is not available on this machine yet.",
      installerPackagePath: null,
    }));
    return {
      connectorId: "platform:gmail-hook",
      status: "needs_setup" as const,
      message: needsTailscaleFunnel
        ? "Tailscale is connected, but Funnel is not enabled yet. Enable Funnel for this node or tailnet, then continue, or paste your own public HTTPS Push Endpoint."
        : tailscale.appInstalled
          ? "Gmail auto-setup needs a public push endpoint. EasyClaw defaults to Tailscale Funnel/Serve, but Tailscale is not connected on this machine yet. Open Tailscale, connect this Mac, or paste your own Public Push Endpoint, then continue."
          : tailscale.installerPackagePath
            ? "Gmail auto-setup needs a public push endpoint. Homebrew already downloaded the Tailscale installer, but macOS still needs you to finish that installation. Complete it, or paste your own Public Push Endpoint, then continue."
            : "Gmail auto-setup needs a public push endpoint. EasyClaw defaults to Tailscale Funnel/Serve, but the Tailscale Mac app is not installed yet. Install Tailscale or paste your own Public Push Endpoint, then continue.",
      updatedRefs: [] as string[],
      authSteps: buildGmailTailscaleSteps({
        account,
        inputs,
        appInstalled: tailscale.appInstalled,
        installerPackagePath: tailscale.installerPackagePath,
        funnelEnableUrl,
      }),
      resume: {
        connectorId: "platform:gmail-hook",
        label: "Retry Gmail setup",
        detail:
          "Run Gmail auto-setup again after Tailscale is running or a Public Push Endpoint is set.",
        inputs: buildGmailSetupInputs(account, inputs),
      },
    };
  }

  const authSteps = buildGmailAuthSteps({
    account,
    includeGcloud: needsGcloud,
    includeGog: needsGog || needsGmailScopes,
    gmailScopes: needsGmailScopes,
  });
  if (authSteps.length === 0) {
    return null;
  }
  return {
    connectorId: "platform:gmail-hook",
    status: "needs_auth" as const,
    message: needsGmailScopes
      ? "Gmail setup reached the Gmail API, but the current gog token is missing Gmail scopes. Re-consent with Gmail access, then retry."
      : "Gmail setup needs sign-in before EasyClaw can finish the remaining steps.",
    updatedRefs: [] as string[],
    authSteps,
    resume: {
      connectorId: "platform:gmail-hook",
      label: "Retry Gmail setup",
      detail: "Run Gmail auto-setup again after the sign-in steps are complete.",
      inputs: {
        account,
        project: stringInput(inputs, "project"),
        topic: stringInput(inputs, "topic"),
        subscription: stringInput(inputs, "subscription"),
        pushEndpoint,
      },
    },
  };
}

export const builderHandlers: GatewayRequestHandlers = {
  "agents.builder.plan": async ({ params, respond }) => {
    const parsed = parseBuilderParams(params);
    if (!parsed.brief) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "agents.builder.plan requires a `brief` param."),
      );
      return;
    }
    try {
      const result = await compileAgentBlueprintBuilderPlan({
        brief: parsed.brief,
        ...(parsed.templateId ? { templateId: parsed.templateId } : {}),
        ...(parsed.modelId ? { modelId: parsed.modelId } : {}),
        cfg: loadConfig(),
      });
      respond(true, result, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, String(error instanceof Error ? error.message : error)),
      );
    }
  },

  "agents.builder.apply": async ({ params, respond }) => {
    const parsed = parseBuilderParams(params);
    if (!parsed.brief) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "agents.builder.apply requires a `brief` param."),
      );
      return;
    }
    try {
      const cfg = loadConfig();
      const result = await applyAgentBlueprintBuilderPlan({
        brief: parsed.brief,
        ...(parsed.templateId ? { templateId: parsed.templateId } : {}),
        ...(parsed.modelId ? { modelId: parsed.modelId } : {}),
        cfg,
      });
      respond(true, result, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, String(error instanceof Error ? error.message : error)),
      );
    }
  },

  "agents.builder.verify": async ({ params, respond }) => {
    const parsed = parseBuilderParams(params);
    if (!parsed.brief) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "agents.builder.verify requires a `brief` param."),
      );
      return;
    }
    try {
      const cfg = loadConfig();
      const result = await verifyAgentBlueprintBuilderPlan({
        brief: parsed.brief,
        ...(parsed.templateId ? { templateId: parsed.templateId } : {}),
        ...(parsed.modelId ? { modelId: parsed.modelId } : {}),
        cfg,
      });
      respond(true, result, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, String(error instanceof Error ? error.message : error)),
      );
    }
  },

  "agents.builder.setup.run": async ({ params, respond }) => {
    const parsed = parseBuilderSetupParams(params);
    if (!parsed.connectorId) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "agents.builder.setup.run requires a `connectorId` param.",
        ),
      );
      return;
    }
    try {
      switch (parsed.connectorId) {
        case "platform:gmail-hook": {
          const account = stringInput(parsed.inputs, "account");
          if (!account) {
            respond(
              false,
              undefined,
              errorShape(
                ErrorCodes.INVALID_REQUEST,
                "agents.builder.setup.run for platform:gmail-hook requires an `account` input.",
              ),
            );
            return;
          }
          const pushEndpoint = stringInput(parsed.inputs, "pushEndpoint");
          if (pushEndpoint) {
            const validation = validatePublicPushEndpoint(pushEndpoint);
            if (!validation.ok) {
              respond(
                true,
                {
                  connectorId: "platform:gmail-hook",
                  status: "needs_setup",
                  message: validation.error,
                  updatedRefs: [],
                  resume: {
                    connectorId: "platform:gmail-hook",
                    label: "Retry Gmail setup",
                    detail:
                      "Run Gmail auto-setup again after you enter a valid public HTTPS Push Endpoint or use Tailscale Funnel.",
                    inputs: buildGmailSetupInputs(account, parsed.inputs),
                  },
                },
                undefined,
              );
              return;
            }
            parsed.inputs.pushEndpoint = validation.normalized;
          }
          const summary = await runGmailSetup(gmailSetupArgsFromInputs(account, parsed.inputs));
          respond(true, gmailConfiguredPayload(parsed.connectorId, summary), undefined);
          return;
        }
        case "channel:telegram:verify-token": {
          const cfg = loadConfig();
          const requestedAccountId =
            stringInput(parsed.inputs, "accountId") || stringInput(parsed.inputs, "account");
          const accountId = requestedAccountId ? normalizeAccountId(requestedAccountId) : "";
          const inputToken = normalizeSetupTelegramToken(
            stringInput(parsed.inputs, "token") || stringInput(parsed.inputs, "botToken"),
          );
          const account = resolveTelegramAccount({
            cfg,
            ...(accountId ? { accountId } : {}),
          });
          const resolvedAccountId = accountId || account.accountId || "default";
          const verificationToken = inputToken || normalizeSetupTelegramToken(account.token);
          if (!verificationToken) {
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "needs_setup",
                message: `Telegram token is missing for account "${resolvedAccountId}". Save the bot token, then run Verify Bot Token.`,
                updatedRefs: [],
                summary: {
                  command: "getMe",
                  accountId: resolvedAccountId,
                },
                resume: {
                  connectorId: parsed.connectorId,
                  label: "Verify Bot Token",
                  detail: "After saving the bot token, run verification again.",
                  inputs: accountId ? { accountId } : {},
                },
              },
              undefined,
            );
            return;
          }

          const verified = await fetchTelegramBotIdentity({ token: verificationToken });
          if (verified.error) {
            const lower = verified.error.toLowerCase();
            const message =
              lower === "not found" || lower.includes("error 404")
                ? `Telegram returned Not Found for account "${resolvedAccountId}". The token is invalid for Bot API calls (wrong bot, revoked token, or copied incorrectly). Re-copy from BotFather and save again.`
                : `Telegram token verification failed: ${verified.error}`;
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "needs_setup",
                message,
                updatedRefs: [],
                summary: {
                  command: "getMe",
                  accountId: resolvedAccountId,
                },
                resume: {
                  connectorId: parsed.connectorId,
                  label: "Verify Bot Token",
                  detail: "After saving the correct token, run verification again.",
                  inputs: accountId ? { accountId } : {},
                },
              },
              undefined,
            );
            return;
          }

          if (!verified.bot) {
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "needs_setup",
                message:
                  "Telegram verification succeeded but did not return bot identity details. Re-save token and retry.",
                updatedRefs: [],
                summary: {
                  command: "getMe",
                  accountId: resolvedAccountId,
                },
                resume: {
                  connectorId: parsed.connectorId,
                  label: "Verify Bot Token",
                  detail: "Run verification again.",
                  inputs: accountId ? { accountId } : {},
                },
              },
              undefined,
            );
            return;
          }

          const botLabel = verified.bot.username
            ? `@${verified.bot.username}`
            : `id ${verified.bot.id}`;
          respond(
            true,
            {
              connectorId: parsed.connectorId,
              status: "configured",
              message: `Telegram token is valid for ${botLabel} (account ${resolvedAccountId}).`,
              updatedRefs: [],
              summary: {
                command: "getMe",
                botId: verified.bot.id,
                botUsername: verified.bot.username ?? null,
                accountId: resolvedAccountId,
              },
            },
            undefined,
          );
          return;
        }
        case "channel:telegram:auto-default-target": {
          const cfg = loadConfig();
          const requestedAccountId =
            stringInput(parsed.inputs, "accountId") || stringInput(parsed.inputs, "account");
          const accountId = requestedAccountId ? normalizeAccountId(requestedAccountId) : "";
          const inputToken = normalizeSetupTelegramToken(
            stringInput(parsed.inputs, "token") || stringInput(parsed.inputs, "botToken"),
          );
          const account = resolveTelegramAccount({
            cfg,
            ...(accountId ? { accountId } : {}),
          });
          const resolvedAccountId = accountId || account.accountId || "default";
          const detectionToken = inputToken || normalizeSetupTelegramToken(account.token);
          if (!detectionToken) {
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "needs_setup",
                message: `Telegram auto-detect needs a bot token for account "${resolvedAccountId}" first. Save the token, or provide an account-specific token, then retry.`,
                updatedRefs: [],
                summary: {
                  command: "getUpdates",
                  accountId: resolvedAccountId,
                },
                resume: {
                  connectorId: parsed.connectorId,
                  label: "Retry target auto-detect",
                  detail: "After saving the bot token, run auto-detect again.",
                  inputs: accountId ? { accountId } : {},
                },
              },
              undefined,
            );
            return;
          }
          const detected = await fetchTelegramLatestDeliveryTarget({
            token: detectionToken,
          });
          if (detected.error) {
            const lower = detected.error.toLowerCase();
            const message = lower.includes("webhook")
              ? `Telegram auto-detect cannot read updates while webhook mode is active for account "${resolvedAccountId}". Set Default Target manually in Channels -> Telegram, or switch to polling and retry.`
              : lower === "not found" || lower.includes("error 404")
                ? `Telegram returned Not Found for account "${resolvedAccountId}". The token is likely invalid/revoked, or it belongs to a different bot than the one you are messaging. Re-copy the token from BotFather for that account, save it, then retry.`
                : `Telegram auto-detect could not read recent updates: ${detected.error}`;
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "needs_setup",
                message,
                updatedRefs: [],
                summary: {
                  command: "getUpdates",
                  accountId: resolvedAccountId,
                },
                resume: {
                  connectorId: parsed.connectorId,
                  label: "Retry target auto-detect",
                  detail:
                    "After the bot can read updates, run auto-detect again to set Telegram defaultTo.",
                  inputs: accountId ? { accountId } : {},
                },
              },
              undefined,
            );
            return;
          }
          if (!detected.target) {
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "needs_setup",
                message:
                  "Telegram auto-detect did not find any pending updates for this bot. Send a fresh message to that exact bot and retry immediately. If the bot is already running in polling mode, it may consume updates before auto-detect can read them.",
                updatedRefs: [],
                summary: {
                  command: "getUpdates",
                  accountId: resolvedAccountId,
                },
                resume: {
                  connectorId: parsed.connectorId,
                  label: "Retry target auto-detect",
                  detail:
                    "After sending a message to the bot from your destination chat, run auto-detect again.",
                  inputs: accountId ? { accountId } : {},
                },
              },
              undefined,
            );
            return;
          }

          const nextConfig = setTelegramDefaultTargetInConfig({
            cfg,
            target: detected.target.target,
            ...(accountId ? { accountId } : {}),
          });
          await writeConfigFile(nextConfig);

          const updatedRef = accountId
            ? `channels.telegram.accounts.${accountId}.defaultTo`
            : "channels.telegram.defaultTo";
          const destinationLabel = detected.target.messageThreadId
            ? `${detected.target.chatId} topic ${detected.target.messageThreadId}`
            : detected.target.chatId;
          respond(
            true,
            {
              connectorId: parsed.connectorId,
              status: "configured",
              message: `Telegram default target set to ${destinationLabel}.`,
              updatedRefs: [updatedRef],
              summary: {
                command: "getUpdates",
              },
            },
            undefined,
          );
          return;
        }
        case "channel:slack:verify-credentials": {
          const cfg = loadConfig();
          const requestedAccountId = firstStringInput(parsed.inputs, [
            "slack.accountId",
            "accountId",
            "account",
          ]);
          const accountId = requestedAccountId ? normalizeAccountId(requestedAccountId) : "";
          const account = resolveSlackAccount({
            cfg,
            ...(accountId ? { accountId } : {}),
          });
          const resolvedAccountId = accountId || account.accountId || "default";
          const mode =
            firstStringInput(parsed.inputs, ["slack.mode", "mode"]) ||
            account.config.mode ||
            "socket";
          const botToken =
            normalizeSetupSecret(
              firstStringInput(parsed.inputs, ["slack.botToken", "botToken", "token"]),
            ) || normalizeSetupSecret(account.botToken?.trim() ?? "");
          const appToken =
            normalizeSetupSecret(firstStringInput(parsed.inputs, ["slack.appToken", "appToken"])) ||
            normalizeSetupSecret(account.appToken?.trim() ?? "");
          if (!botToken) {
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "needs_setup",
                message: `Slack bot token is missing for account "${resolvedAccountId}". Save Bot Token, then run Verify Slack credentials.`,
                updatedRefs: [],
                summary: {
                  command: "auth.test",
                  accountId: resolvedAccountId,
                },
                resume: {
                  connectorId: parsed.connectorId,
                  label: "Verify Slack credentials",
                  detail: "After saving Bot Token, run verification again.",
                  inputs: accountId ? { accountId } : {},
                },
              },
              undefined,
            );
            return;
          }
          const botProbe = await probeSlack(botToken, 5000);
          if (!botProbe.ok) {
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "needs_setup",
                message: `Slack bot token verification failed: ${botProbe.error ?? "unknown error"}`,
                updatedRefs: [],
                summary: {
                  command: "auth.test",
                  accountId: resolvedAccountId,
                },
                resume: {
                  connectorId: parsed.connectorId,
                  label: "Verify Slack credentials",
                  detail: "Fix Slack credentials and run verification again.",
                  inputs: accountId ? { accountId } : {},
                },
              },
              undefined,
            );
            return;
          }
          if (mode !== "http") {
            if (!appToken) {
              respond(
                true,
                {
                  connectorId: parsed.connectorId,
                  status: "needs_setup",
                  message: `Slack app token is missing for account "${resolvedAccountId}" in socket mode. Save App Token, then run Verify Slack credentials.`,
                  updatedRefs: [],
                  summary: {
                    command: "apps.connections.open",
                    accountId: resolvedAccountId,
                  },
                  resume: {
                    connectorId: parsed.connectorId,
                    label: "Verify Slack credentials",
                    detail: "After saving App Token, run verification again.",
                    inputs: accountId ? { accountId } : {},
                  },
                },
                undefined,
              );
              return;
            }
            const appProbe = await probeSlackAppToken(appToken, 5000);
            if (!appProbe.ok) {
              respond(
                true,
                {
                  connectorId: parsed.connectorId,
                  status: "needs_setup",
                  message: `Slack app token verification failed: ${appProbe.error}`,
                  updatedRefs: [],
                  summary: {
                    command: "apps.connections.open",
                    accountId: resolvedAccountId,
                  },
                  resume: {
                    connectorId: parsed.connectorId,
                    label: "Verify Slack credentials",
                    detail: "Fix Slack App Token and run verification again.",
                    inputs: accountId ? { accountId } : {},
                  },
                },
                undefined,
              );
              return;
            }
          }
          respond(
            true,
            {
              connectorId: parsed.connectorId,
              status: "configured",
              message: `Slack credentials are valid${botProbe.team?.name ? ` for ${botProbe.team.name}` : ""} (account ${resolvedAccountId}).`,
              updatedRefs: [channelAccountRef("slack", resolvedAccountId)],
              summary: {
                command: mode === "http" ? "auth.test" : "auth.test + apps.connections.open",
                accountId: resolvedAccountId,
              },
            },
            undefined,
          );
          return;
        }
        case "channel:discord:verify-token": {
          const cfg = loadConfig();
          const requestedAccountId = firstStringInput(parsed.inputs, [
            "discord.accountId",
            "accountId",
            "account",
          ]);
          const accountId = requestedAccountId ? normalizeAccountId(requestedAccountId) : "";
          const account = resolveDiscordAccount({
            cfg,
            ...(accountId ? { accountId } : {}),
          });
          const resolvedAccountId = accountId || account.accountId || "default";
          const inputToken = normalizeDiscordToken(
            firstStringInput(parsed.inputs, ["discord.token", "token", "botToken"]),
            "agents.builder.setup.run.inputs.discord.token",
          );
          const token =
            (inputToken && inputToken !== REDACTED_SENTINEL ? inputToken : "") ||
            normalizeSetupSecret(account.token);
          if (!token) {
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "needs_setup",
                message: `Discord bot token is missing for account "${resolvedAccountId}". Save Token, then run Verify Discord token.`,
                updatedRefs: [],
                summary: {
                  command: "GET /users/@me",
                  accountId: resolvedAccountId,
                },
                resume: {
                  connectorId: parsed.connectorId,
                  label: "Verify Discord token",
                  detail: "After saving Token, run verification again.",
                  inputs: accountId ? { accountId } : {},
                },
              },
              undefined,
            );
            return;
          }
          const verified = await probeDiscord(token, 5000, { includeApplication: true });
          if (!verified.ok) {
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "needs_setup",
                message: `Discord token verification failed: ${verified.error ?? "unknown error"}`,
                updatedRefs: [],
                summary: {
                  command: "GET /users/@me",
                  accountId: resolvedAccountId,
                },
                resume: {
                  connectorId: parsed.connectorId,
                  label: "Verify Discord token",
                  detail: "Fix Discord token and run verification again.",
                  inputs: accountId ? { accountId } : {},
                },
              },
              undefined,
            );
            return;
          }
          const botLabel = verified.bot?.username
            ? `@${verified.bot.username}`
            : "the configured bot";
          respond(
            true,
            {
              connectorId: parsed.connectorId,
              status: "configured",
              message: `Discord token is valid for ${botLabel} (account ${resolvedAccountId}).`,
              updatedRefs: [channelAccountRef("discord", resolvedAccountId)],
              summary: {
                command: "GET /users/@me",
                accountId: resolvedAccountId,
              },
            },
            undefined,
          );
          return;
        }
        case "channel:signal:verify-transport": {
          const cfg = loadConfig();
          const requestedAccountId = firstStringInput(parsed.inputs, [
            "signal.accountId",
            "accountId",
            "account",
          ]);
          const accountId = requestedAccountId ? normalizeAccountId(requestedAccountId) : "";
          const account = resolveSignalAccount({
            cfg,
            ...(accountId ? { accountId } : {}),
          });
          const resolvedAccountId = accountId || account.accountId || "default";
          const signalAccount =
            firstStringInput(parsed.inputs, ["signal.account", "signalAccount"]) ||
            account.config.account?.trim() ||
            account.config.accountUuid?.trim() ||
            "";
          const baseUrl =
            firstStringInput(parsed.inputs, ["signal.httpUrl", "httpUrl", "baseUrl"]) ||
            account.baseUrl;
          if (!signalAccount) {
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "needs_setup",
                message: `Signal account identifier is missing for account "${resolvedAccountId}". Set channels.signal.account (or accountUuid), then run Verify Signal transport.`,
                updatedRefs: [],
                summary: {
                  command: "signal-cli version",
                  accountId: resolvedAccountId,
                },
                resume: {
                  connectorId: parsed.connectorId,
                  label: "Verify Signal transport",
                  detail: "After setting Signal account details, run verification again.",
                  inputs: accountId ? { accountId } : {},
                },
              },
              undefined,
            );
            return;
          }
          const probe = await probeSignal(baseUrl, 5000);
          if (!probe.ok) {
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "needs_setup",
                message: `Signal transport check failed: ${probe.error ?? "unreachable"}`,
                updatedRefs: [],
                summary: {
                  command: "signal-cli version",
                  accountId: resolvedAccountId,
                },
                resume: {
                  connectorId: parsed.connectorId,
                  label: "Verify Signal transport",
                  detail: "Start signal-cli HTTP transport and run verification again.",
                  inputs: accountId ? { accountId } : {},
                },
              },
              undefined,
            );
            return;
          }
          respond(
            true,
            {
              connectorId: parsed.connectorId,
              status: "configured",
              message: `Signal transport is reachable${probe.version ? ` (signal-cli ${probe.version})` : ""} for account ${resolvedAccountId}.`,
              updatedRefs: [channelAccountRef("signal", resolvedAccountId)],
              summary: {
                command: "signal-cli version",
                accountId: resolvedAccountId,
              },
            },
            undefined,
          );
          return;
        }
        case "channel:googlechat:verify-auth": {
          const cfg = loadConfig();
          const requestedAccountId = firstStringInput(parsed.inputs, [
            "googlechat.accountId",
            "accountId",
            "account",
          ]);
          const accountId = requestedAccountId ? normalizeAccountId(requestedAccountId) : "";
          const account = resolveGoogleChatAccount({
            cfg,
            ...(accountId ? { accountId } : {}),
          });
          const resolvedAccountId = accountId || account.accountId || "default";
          if (!account.enabled) {
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "needs_setup",
                message: `Google Chat is disabled for account "${resolvedAccountId}". Enable channels.googlechat, then run Verify Google Chat auth again.`,
                updatedRefs: [],
                summary: {
                  command: "GET /v1/spaces?pageSize=1",
                  accountId: resolvedAccountId,
                },
                resume: {
                  connectorId: parsed.connectorId,
                  label: "Verify Google Chat auth",
                  detail: "Enable Google Chat in config, then run verification again.",
                  inputs: accountId ? { accountId } : {},
                },
              },
              undefined,
            );
            return;
          }
          if (account.credentialSource === "none") {
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "needs_setup",
                message: `Google Chat service-account credentials are missing for account "${resolvedAccountId}". Set channels.googlechat.serviceAccount (or serviceAccountFile), then run Verify Google Chat auth.`,
                updatedRefs: [],
                summary: {
                  command: "GET /v1/spaces?pageSize=1",
                  accountId: resolvedAccountId,
                },
                resume: {
                  connectorId: parsed.connectorId,
                  label: "Verify Google Chat auth",
                  detail: "After setting service-account credentials, run verification again.",
                  inputs: accountId ? { accountId } : {},
                },
              },
              undefined,
            );
            return;
          }

          const verified = await probeGoogleChat(account);
          if (!verified.ok) {
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "needs_setup",
                message: `Google Chat auth verification failed: ${verified.error ?? "unknown error"}`,
                updatedRefs: [],
                summary: {
                  command: "GET /v1/spaces?pageSize=1",
                  accountId: resolvedAccountId,
                },
                resume: {
                  connectorId: parsed.connectorId,
                  label: "Verify Google Chat auth",
                  detail: "Fix service-account credentials and run verification again.",
                  inputs: accountId ? { accountId } : {},
                },
              },
              undefined,
            );
            return;
          }

          const audienceType =
            firstStringInput(parsed.inputs, ["googlechat.audienceType", "audienceType"]) ||
            account.config.audienceType?.trim() ||
            "";
          const audience =
            firstStringInput(parsed.inputs, ["googlechat.audience", "audience"]) ||
            account.config.audience?.trim() ||
            "";
          if (!audienceType || !audience) {
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "needs_setup",
                message:
                  "Google Chat API auth is valid, but webhook auth fields are incomplete. Set channels.googlechat.audienceType and channels.googlechat.audience, then rerun verification.",
                updatedRefs: [],
                summary: {
                  command: "GET /v1/spaces?pageSize=1",
                  accountId: resolvedAccountId,
                },
                resume: {
                  connectorId: parsed.connectorId,
                  label: "Verify Google Chat auth",
                  detail:
                    "After setting audienceType + audience for webhook verification, run again.",
                  inputs: accountId ? { accountId } : {},
                },
              },
              undefined,
            );
            return;
          }

          respond(
            true,
            {
              connectorId: parsed.connectorId,
              status: "configured",
              message: `Google Chat credentials are valid (account ${resolvedAccountId}, source ${account.credentialSource}).`,
              updatedRefs: [channelAccountRef("googlechat", resolvedAccountId)],
              summary: {
                command: "GET /v1/spaces?pageSize=1",
                accountId: resolvedAccountId,
                credentialSource: account.credentialSource,
                audienceType,
              },
            },
            undefined,
          );
          return;
        }
        case "channel:matrix:verify-credentials": {
          const cfg = loadConfig();
          const requestedAccountId = firstStringInput(parsed.inputs, [
            "matrix.accountId",
            "accountId",
            "account",
          ]);
          const accountId = requestedAccountId ? normalizeAccountId(requestedAccountId) : "";
          const account = resolveMatrixAccount({
            cfg,
            ...(accountId ? { accountId } : {}),
          });
          const resolvedAccountId = accountId || account.accountId || "default";
          if (!account.enabled) {
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "needs_setup",
                message: `Matrix is disabled for account "${resolvedAccountId}". Enable channels.matrix, then run Verify Matrix credentials.`,
                updatedRefs: [],
                summary: {
                  command: "whoami",
                  accountId: resolvedAccountId,
                },
                resume: {
                  connectorId: parsed.connectorId,
                  label: "Verify Matrix credentials",
                  detail: "Enable Matrix in config, then run verification again.",
                  inputs: accountId ? { accountId } : {},
                },
              },
              undefined,
            );
            return;
          }

          const auth = await resolveMatrixAuth({
            cfg,
            ...(accountId ? { accountId } : {}),
          });
          const verified = await probeMatrix({
            homeserver: auth.homeserver,
            accessToken: auth.accessToken,
            userId: auth.userId,
            timeoutMs: 5000,
          });
          if (!verified.ok) {
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "needs_setup",
                message: `Matrix credential verification failed: ${verified.error ?? "unknown error"}`,
                updatedRefs: [],
                summary: {
                  command: "whoami",
                  accountId: resolvedAccountId,
                },
                resume: {
                  connectorId: parsed.connectorId,
                  label: "Verify Matrix credentials",
                  detail: "Fix Matrix homeserver/token (or password login) and rerun verification.",
                  inputs: accountId ? { accountId } : {},
                },
              },
              undefined,
            );
            return;
          }
          respond(
            true,
            {
              connectorId: parsed.connectorId,
              status: "configured",
              message: `Matrix credentials are valid for ${auth.userId || "the configured account"} (account ${resolvedAccountId}).`,
              updatedRefs: [channelAccountRef("matrix", resolvedAccountId)],
              summary: {
                command: "whoami",
                accountId: resolvedAccountId,
                userId: auth.userId,
                homeserver: auth.homeserver,
              },
            },
            undefined,
          );
          return;
        }
        case "channel:msteams:verify-credentials": {
          const cfg = loadConfig();
          const appId = normalizeSetupSecret(
            firstStringInput(parsed.inputs, ["msteams.appId", "appId"]),
          );
          const appPassword = normalizeSetupSecret(
            firstStringInput(parsed.inputs, ["msteams.appPassword", "appPassword", "appSecret"]),
          );
          const tenantId = normalizeSetupSecret(
            firstStringInput(parsed.inputs, ["msteams.tenantId", "tenantId"]),
          );
          const msteamsConfig = {
            ...asRecord(cfg.channels?.msteams),
            ...(appId ? { appId } : {}),
            ...(appPassword ? { appPassword } : {}),
            ...(tenantId ? { tenantId } : {}),
          };
          if (msteamsConfig.enabled === false) {
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "needs_setup",
                message:
                  "Microsoft Teams is disabled. Enable channels.msteams, then run Verify Teams credentials.",
                updatedRefs: [],
                summary: {
                  command: "Bot Framework token",
                },
                resume: {
                  connectorId: parsed.connectorId,
                  label: "Verify Teams credentials",
                  detail: "Enable Microsoft Teams in config, then rerun verification.",
                  inputs: {},
                },
              },
              undefined,
            );
            return;
          }

          const verified = await probeMSTeams(msteamsConfig);
          if (!verified.ok) {
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "needs_setup",
                message: `Microsoft Teams credential verification failed: ${verified.error ?? "missing credentials"}`,
                updatedRefs: [],
                summary: {
                  command: "Bot Framework token",
                },
                resume: {
                  connectorId: parsed.connectorId,
                  label: "Verify Teams credentials",
                  detail: "Set appId, appPassword, and tenantId, then rerun verification.",
                  inputs: {},
                },
              },
              undefined,
            );
            return;
          }
          const graphDetail =
            verified.graph && !verified.graph.ok
              ? ` Graph token probe failed: ${verified.graph.error ?? "unknown error"}.`
              : "";
          respond(
            true,
            {
              connectorId: parsed.connectorId,
              status: "configured",
              message: `Microsoft Teams credentials are valid${verified.appId ? ` for app ${verified.appId}` : ""}.${graphDetail}`,
              updatedRefs: ["channels.msteams"],
              summary: {
                command: "Bot Framework token + Graph token",
                appId: verified.appId,
                graphOk: verified.graph?.ok ?? null,
              },
            },
            undefined,
          );
          return;
        }
        case "channel:imessage:verify-transport": {
          const cfg = loadConfig();
          const requestedAccountId = firstStringInput(parsed.inputs, [
            "imessage.accountId",
            "accountId",
            "account",
          ]);
          const accountId = requestedAccountId ? normalizeAccountId(requestedAccountId) : "";
          const account = resolveIMessageAccount({
            cfg,
            ...(accountId ? { accountId } : {}),
          });
          const resolvedAccountId = accountId || account.accountId || "default";
          if (!account.enabled) {
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "needs_setup",
                message: `iMessage is disabled for account "${resolvedAccountId}". Enable channels.imessage, then run Verify iMessage transport.`,
                updatedRefs: [],
                summary: {
                  command: "imsg rpc --help + chats.list",
                  accountId: resolvedAccountId,
                },
                resume: {
                  connectorId: parsed.connectorId,
                  label: "Verify iMessage transport",
                  detail: "Enable iMessage in config, then rerun verification.",
                  inputs: accountId ? { accountId } : {},
                },
              },
              undefined,
            );
            return;
          }
          const cliPath = firstStringInput(parsed.inputs, ["imessage.cliPath", "cliPath"]);
          const dbPath = firstStringInput(parsed.inputs, ["imessage.dbPath", "dbPath"]);
          const verified = await probeIMessage(5000, {
            ...(cliPath ? { cliPath } : {}),
            ...(dbPath ? { dbPath } : {}),
          });
          if (!verified.ok) {
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "needs_setup",
                message: `iMessage transport verification failed: ${verified.error ?? "unknown error"}`,
                updatedRefs: [],
                summary: {
                  command: "imsg rpc --help + chats.list",
                  accountId: resolvedAccountId,
                },
                resume: {
                  connectorId: parsed.connectorId,
                  label: "Verify iMessage transport",
                  detail:
                    "Install/fix imsg RPC and iMessage access on this macOS host, then rerun verification.",
                  inputs: accountId ? { accountId } : {},
                },
              },
              undefined,
            );
            return;
          }
          respond(
            true,
            {
              connectorId: parsed.connectorId,
              status: "configured",
              message: `iMessage transport is reachable for account ${resolvedAccountId}.`,
              updatedRefs: [channelAccountRef("imessage", resolvedAccountId)],
              summary: {
                command: "imsg rpc --help + chats.list",
                accountId: resolvedAccountId,
              },
            },
            undefined,
          );
          return;
        }
        case "platform:gmail-hook:tailscale-install": {
          const account = stringInput(parsed.inputs, "account");
          if (!account) {
            respond(
              false,
              undefined,
              errorShape(
                ErrorCodes.INVALID_REQUEST,
                "agents.builder.setup.run for platform:gmail-hook:tailscale-install requires an `account` input.",
              ),
            );
            return;
          }

          let installSummaryCommand = "brew install --cask tailscale";
          try {
            await installMacAppWithBrew({
              appName: "Tailscale",
              caskName: "tailscale",
            });
          } catch {
            const tailscale = await getTailscaleConnectionSummary().catch(() => ({
              appInstalled: false,
              connected: false,
              dnsName: null,
              detail: "Tailscale is not available on this machine yet.",
              installerPackagePath: null,
            }));
            respond(
              true,
              {
                connectorId: "platform:gmail-hook",
                status: "needs_setup",
                message: tailscale.installerPackagePath
                  ? "Homebrew downloaded the Tailscale installer, but macOS still needs you to finish installing it. Open the installer package, then continue."
                  : "EasyClaw could not finish installing the Tailscale Mac app yet. You can retry the install, install it manually, or paste a Public Push Endpoint and continue without Tailscale.",
                updatedRefs: [],
                authSteps: buildGmailTailscaleSteps({
                  account,
                  inputs: parsed.inputs,
                  appInstalled: false,
                  installerPackagePath: tailscale.installerPackagePath,
                }),
                summary: {
                  command: installSummaryCommand,
                },
                resume: {
                  connectorId: "platform:gmail-hook",
                  label: "Retry Gmail setup",
                  detail:
                    "Run Gmail auto-setup again after Tailscale is installed and connected, or after you set a Public Push Endpoint.",
                  inputs: buildGmailSetupInputs(account, parsed.inputs),
                },
              },
              undefined,
            );
            return;
          }

          try {
            await launchMacApp("Tailscale");
          } catch {
            const tailscale = await getTailscaleConnectionSummary().catch(() => ({
              appInstalled: false,
              connected: false,
              dnsName: null,
              detail: "Tailscale is not available on this machine yet.",
              installerPackagePath: null,
            }));
            respond(
              true,
              {
                connectorId: "platform:gmail-hook",
                status: "needs_setup",
                message: tailscale.installerPackagePath
                  ? "Homebrew downloaded the Tailscale installer, but the Mac app is not installed yet. Finish the installer package, then continue."
                  : "Tailscale installed, but the Mac app is not ready to open yet. Open Tailscale from Applications once it appears, connect this Mac, then click Check Tailscale and continue.",
                updatedRefs: [],
                authSteps: buildGmailTailscaleSteps({
                  account,
                  inputs: parsed.inputs,
                  appInstalled: tailscale.appInstalled,
                  installerPackagePath: tailscale.installerPackagePath,
                }),
                summary: {
                  command: installSummaryCommand,
                },
                resume: {
                  connectorId: "platform:gmail-hook",
                  label: "Retry Gmail setup",
                  detail:
                    "Run Gmail auto-setup again after Tailscale is connected, or after you set a Public Push Endpoint.",
                  inputs: buildGmailSetupInputs(account, parsed.inputs),
                },
              },
              undefined,
            );
            return;
          }

          const tailscale = await getTailscaleConnectionSummary();
          if (tailscale.connected) {
            const summary = await runGmailSetup(gmailSetupArgsFromInputs(account, parsed.inputs));
            respond(true, gmailConfiguredPayload("platform:gmail-hook", summary), undefined);
            return;
          }

          respond(
            true,
            {
              connectorId: "platform:gmail-hook",
              status: "started",
              message:
                "Installed Tailscale and opened it. Sign in and connect this Mac there, then click Check Tailscale and continue.",
              updatedRefs: [],
              authSteps: buildGmailTailscaleSteps({
                account,
                inputs: parsed.inputs,
                appInstalled: true,
                installerPackagePath: tailscale.installerPackagePath,
              }),
              summary: {
                command: "brew install --cask tailscale",
              },
              resume: {
                connectorId: "platform:gmail-hook",
                label: "Retry Gmail setup",
                detail:
                  "Run Gmail auto-setup again after Tailscale is connected, or after you set a Public Push Endpoint.",
                inputs: buildGmailSetupInputs(account, parsed.inputs),
              },
            },
            undefined,
          );
          return;
        }
        case "platform:gmail-hook:gcloud-auth": {
          await launchTerminalCommand("gcloud auth login");
          respond(
            true,
            {
              connectorId: parsed.connectorId,
              status: "started",
              message:
                "Opened Terminal to complete `gcloud auth login`. Finish the sign-in there, then return and retry Gmail setup.",
              updatedRefs: [],
              summary: {
                command: "gcloud auth login",
              },
            },
            undefined,
          );
          return;
        }
        case "platform:gmail-hook:tailscale-start": {
          const account = stringInput(parsed.inputs, "account");
          if (!account) {
            respond(
              false,
              undefined,
              errorShape(
                ErrorCodes.INVALID_REQUEST,
                "agents.builder.setup.run for platform:gmail-hook:tailscale-start requires an `account` input.",
              ),
            );
            return;
          }
          try {
            await launchMacApp("Tailscale");
          } catch {
            const tailscale = await getTailscaleConnectionSummary().catch(() => ({
              appInstalled: false,
              connected: false,
              dnsName: null,
              detail: "Tailscale is not available on this machine yet.",
              installerPackagePath: null,
            }));
            respond(
              true,
              {
                connectorId: "platform:gmail-hook",
                status: "needs_setup",
                message: tailscale.installerPackagePath
                  ? "Homebrew already downloaded the Tailscale installer, but the Mac app is not installed yet. Open the installer package, finish installing it, or paste a Public Push Endpoint, then continue."
                  : "Tailscale is not installed on this Mac. Install the Tailscale app or paste a Public Push Endpoint, then continue.",
                updatedRefs: [],
                authSteps: buildGmailTailscaleSteps({
                  account,
                  inputs: parsed.inputs,
                  appInstalled: false,
                  installerPackagePath: tailscale.installerPackagePath,
                }),
                resume: {
                  connectorId: "platform:gmail-hook",
                  label: "Retry Gmail setup",
                  detail:
                    "Run Gmail auto-setup again after Tailscale is installed and connected, or after you set a Public Push Endpoint.",
                  inputs: buildGmailSetupInputs(account, parsed.inputs),
                },
              },
              undefined,
            );
            return;
          }
          const tailscale = await getTailscaleConnectionSummary();
          if (tailscale.connected) {
            const summary = await runGmailSetup(gmailSetupArgsFromInputs(account, parsed.inputs));
            respond(true, gmailConfiguredPayload("platform:gmail-hook", summary), undefined);
            return;
          }
          respond(
            true,
            {
              connectorId: "platform:gmail-hook",
              status: "started",
              message:
                "Opened Tailscale. Connect this machine there, then click Check Tailscale and continue.",
              updatedRefs: [],
              authSteps: buildGmailTailscaleSteps({
                account,
                inputs: parsed.inputs,
                appInstalled: true,
                installerPackagePath: tailscale.installerPackagePath,
              }),
              summary: {
                command: "open -a Tailscale",
              },
            },
            undefined,
          );
          return;
        }
        case "platform:gmail-hook:tailscale-check": {
          const account = stringInput(parsed.inputs, "account");
          if (!account) {
            respond(
              false,
              undefined,
              errorShape(
                ErrorCodes.INVALID_REQUEST,
                "agents.builder.setup.run for platform:gmail-hook:tailscale-check requires an `account` input.",
              ),
            );
            return;
          }
          const tailscale = await getTailscaleConnectionSummary();
          if (!tailscale.appInstalled) {
            respond(
              true,
              {
                connectorId: "platform:gmail-hook",
                status: "needs_setup",
                message: tailscale.installerPackagePath
                  ? "Homebrew already downloaded the Tailscale installer, but the Mac app is not installed yet. Finish the installer package, or set a Public Push Endpoint, then continue."
                  : "Tailscale is not installed on this Mac yet. Install it or set a Public Push Endpoint, then continue.",
                updatedRefs: [],
                authSteps: buildGmailTailscaleSteps({
                  account,
                  inputs: parsed.inputs,
                  appInstalled: false,
                  installerPackagePath: tailscale.installerPackagePath,
                }),
                resume: {
                  connectorId: "platform:gmail-hook",
                  label: "Retry Gmail setup",
                  detail:
                    "Run Gmail auto-setup again after Tailscale is installed and connected, or after you set a Public Push Endpoint.",
                  inputs: buildGmailSetupInputs(account, parsed.inputs),
                },
              },
              undefined,
            );
            return;
          }
          if (!tailscale.connected) {
            respond(
              true,
              {
                connectorId: "platform:gmail-hook",
                status: "needs_setup",
                message: `${tailscale.detail} Finish connecting this Mac in Tailscale, or set a Public Push Endpoint, then continue.`,
                updatedRefs: [],
                authSteps: buildGmailTailscaleSteps({
                  account,
                  inputs: parsed.inputs,
                  appInstalled: true,
                  installerPackagePath: tailscale.installerPackagePath,
                }),
                summary: {
                  command: "tailscale status --json",
                },
                resume: {
                  connectorId: "platform:gmail-hook",
                  label: "Retry Gmail setup",
                  detail:
                    "Run Gmail auto-setup again after Tailscale is connected, or after you set a Public Push Endpoint.",
                  inputs: buildGmailSetupInputs(account, parsed.inputs),
                },
              },
              undefined,
            );
            return;
          }

          const summary = await runGmailSetup(gmailSetupArgsFromInputs(account, parsed.inputs));
          respond(true, gmailConfiguredPayload("platform:gmail-hook", summary), undefined);
          return;
        }
        case "platform:gmail-hook:tailscale-open-installer": {
          const account = stringInput(parsed.inputs, "account");
          if (!account) {
            respond(
              false,
              undefined,
              errorShape(
                ErrorCodes.INVALID_REQUEST,
                "agents.builder.setup.run for platform:gmail-hook:tailscale-open-installer requires an `account` input.",
              ),
            );
            return;
          }
          const tailscale = await getTailscaleConnectionSummary();
          if (!tailscale.installerPackagePath) {
            respond(
              true,
              {
                connectorId: "platform:gmail-hook",
                status: "needs_setup",
                message:
                  "EasyClaw could not find the staged Tailscale installer anymore. Retry the install, or paste a Public Push Endpoint and continue without Tailscale.",
                updatedRefs: [],
                authSteps: buildGmailTailscaleSteps({
                  account,
                  inputs: parsed.inputs,
                  appInstalled: tailscale.appInstalled,
                  installerPackagePath: null,
                }),
                resume: {
                  connectorId: "platform:gmail-hook",
                  label: "Retry Gmail setup",
                  detail:
                    "Run Gmail auto-setup again after Tailscale is installed and connected, or after you set a Public Push Endpoint.",
                  inputs: buildGmailSetupInputs(account, parsed.inputs),
                },
              },
              undefined,
            );
            return;
          }
          await launchMacPath(tailscale.installerPackagePath);
          respond(
            true,
            {
              connectorId: "platform:gmail-hook",
              status: "started",
              message:
                "Opened the Tailscale installer package. Finish the macOS install there, then click Open Tailscale or Check Tailscale and continue.",
              updatedRefs: [],
              authSteps: buildGmailTailscaleSteps({
                account,
                inputs: parsed.inputs,
                appInstalled: false,
                installerPackagePath: tailscale.installerPackagePath,
              }),
              summary: {
                command: `open ${tailscale.installerPackagePath}`,
              },
              resume: {
                connectorId: "platform:gmail-hook",
                label: "Retry Gmail setup",
                detail:
                  "Run Gmail auto-setup again after Tailscale is installed and connected, or after you set a Public Push Endpoint.",
                inputs: buildGmailSetupInputs(account, parsed.inputs),
              },
            },
            undefined,
          );
          return;
        }
        case "platform:gmail-hook:tailscale-funnel-enable": {
          const account = stringInput(parsed.inputs, "account");
          if (!account) {
            respond(
              false,
              undefined,
              errorShape(
                ErrorCodes.INVALID_REQUEST,
                "agents.builder.setup.run for platform:gmail-hook:tailscale-funnel-enable requires an `account` input.",
              ),
            );
            return;
          }
          const rawEnableUrl = stringInput(parsed.inputs, "funnelEnableUrl");
          const funnelEnableUrl = extractTailscaleFunnelEnableUrl(rawEnableUrl) ?? rawEnableUrl;
          if (!funnelEnableUrl) {
            respond(
              true,
              {
                connectorId: "platform:gmail-hook",
                status: "needs_setup",
                message:
                  "EasyClaw no longer has the Tailscale Funnel enable URL. Retry Gmail setup to regenerate it, or paste your own Public Push Endpoint.",
                updatedRefs: [],
                resume: {
                  connectorId: "platform:gmail-hook",
                  label: "Retry Gmail setup",
                  detail:
                    "Run Gmail auto-setup again after Tailscale Funnel is enabled or after you set a Public Push Endpoint.",
                  inputs: buildGmailSetupInputs(account, parsed.inputs),
                },
              },
              undefined,
            );
            return;
          }
          await launchMacPath(funnelEnableUrl);
          respond(
            true,
            {
              connectorId: "platform:gmail-hook",
              status: "started",
              message:
                "Opened the Tailscale Funnel settings page. Enable Funnel there, then click Check Tailscale and continue.",
              updatedRefs: [],
              authSteps: buildGmailTailscaleSteps({
                account,
                inputs: {
                  ...parsed.inputs,
                  funnelEnableUrl,
                },
                appInstalled: true,
                installerPackagePath: null,
                funnelEnableUrl,
              }),
              summary: {
                command: `open ${funnelEnableUrl}`,
              },
              resume: {
                connectorId: "platform:gmail-hook",
                label: "Retry Gmail setup",
                detail:
                  "Run Gmail auto-setup again after Tailscale Funnel is enabled, or after you set a Public Push Endpoint.",
                inputs: buildGmailSetupInputs(account, parsed.inputs),
              },
            },
            undefined,
          );
          return;
        }
        case "platform:gmail-hook:gog-auth": {
          const account = stringInput(parsed.inputs, "account");
          if (!account) {
            respond(
              false,
              undefined,
              errorShape(
                ErrorCodes.INVALID_REQUEST,
                "agents.builder.setup.run for platform:gmail-hook:gog-auth requires an `account` input.",
              ),
            );
            return;
          }
          await launchTerminalCommand(await buildGmailGogLaunchCommand(account));
          respond(
            true,
            {
              connectorId: parsed.connectorId,
              status: "started",
              message:
                "Opened Terminal to complete the Gmail gog sign-in flow. Finish the consent there, then return and retry Gmail setup.",
              updatedRefs: [],
              summary: {
                command: buildGmailGogLoginCommand(account),
              },
            },
            undefined,
          );
          return;
        }
        case "platform:gmail-hook:gog-credentials-auto": {
          const account = stringInput(parsed.inputs, "account");
          if (!account) {
            respond(
              false,
              undefined,
              errorShape(
                ErrorCodes.INVALID_REQUEST,
                "agents.builder.setup.run for platform:gmail-hook:gog-credentials-auto requires an `account` input.",
              ),
            );
            return;
          }
          const discovered = await discoverDownloadedGogCredentials(
            stringInput(parsed.inputs, "project") || undefined,
          );
          if (!discovered) {
            respond(
              true,
              {
                connectorId: "platform:gmail-hook",
                status: "needs_credentials",
                message:
                  "EasyClaw could not find a recent Desktop app OAuth client JSON in Downloads. Create and download it in Google Cloud, then try automatic import again or upload it manually.",
                updatedRefs: [],
                credentialImport: buildGmailCredentialImport(parsed.inputs),
                authSteps: buildGmailAuthSteps({
                  account,
                  includeGcloud: !(await getActiveGcloudAccount().catch(() => null)),
                  includeGog: false,
                }),
                resume: {
                  connectorId: "platform:gmail-hook",
                  label: "Retry Gmail setup",
                  detail:
                    "Run Gmail auto-setup again after the OAuth client JSON has been imported.",
                  inputs: {
                    account,
                    project: stringInput(parsed.inputs, "project"),
                    topic: stringInput(parsed.inputs, "topic"),
                    subscription: stringInput(parsed.inputs, "subscription"),
                    pushEndpoint: stringInput(parsed.inputs, "pushEndpoint"),
                  },
                },
              },
              undefined,
            );
            return;
          }

          await importGogCredentialsJson(discovered.credentialsJson, discovered.filename);
          await launchTerminalCommand(await buildGmailGogLaunchCommand(account));
          const gcloudAccount = await getActiveGcloudAccount().catch(() => null);
          respond(
            true,
            {
              connectorId: "platform:gmail-hook",
              status: "started",
              message: `Imported ${discovered.filename} from Downloads and opened Terminal to continue the Gmail gog consent flow.`,
              updatedRefs: [],
              authSteps: buildGmailAuthSteps({
                account,
                includeGcloud: !gcloudAccount,
                includeGog: false,
              }),
              summary: {
                projectId: discovered.projectId ?? undefined,
                command: buildGmailGogLoginCommand(account),
              },
              resume: {
                connectorId: "platform:gmail-hook",
                label: "Retry Gmail setup",
                detail: "Run Gmail auto-setup again after the sign-in steps are complete.",
                inputs: buildGmailSetupInputs(account, parsed.inputs),
              },
            },
            undefined,
          );
          return;
        }
        case "platform:gmail-hook:gog-credentials": {
          const credentialsJson = stringInput(parsed.inputs, "credentialsJson");
          if (!credentialsJson) {
            respond(
              false,
              undefined,
              errorShape(
                ErrorCodes.INVALID_REQUEST,
                "agents.builder.setup.run for platform:gmail-hook:gog-credentials requires a `credentialsJson` input.",
              ),
            );
            return;
          }
          const account = stringInput(parsed.inputs, "account");
          await importGogCredentialsJson(
            credentialsJson,
            stringInput(parsed.inputs, "filename") || "credentials.json",
          );
          const gcloudAccount = await getActiveGcloudAccount().catch(() => null);
          respond(
            true,
            {
              connectorId: "platform:gmail-hook",
              status: "needs_auth",
              message: "OAuth client JSON imported. Sign in to gog next, then retry Gmail setup.",
              updatedRefs: [],
              authSteps: buildGmailAuthSteps({
                account,
                includeGcloud: !gcloudAccount,
                includeGog: true,
              }),
              resume: {
                connectorId: "platform:gmail-hook",
                label: "Retry Gmail setup",
                detail: "Run Gmail auto-setup again after the sign-in steps are complete.",
                inputs: buildGmailSetupInputs(account, parsed.inputs),
              },
            },
            undefined,
          );
          return;
        }
        default: {
          const cfg = loadConfig();
          const inspection = inspectConnectorSetupState({
            connectorId: parsed.connectorId,
            cfg,
            workspaceDir: process.cwd(),
          });
          if (!inspection) {
            respond(
              false,
              undefined,
              errorShape(
                ErrorCodes.INVALID_REQUEST,
                `agents.builder.setup.run received unknown connectorId: ${parsed.connectorId}.`,
              ),
            );
            return;
          }
          respond(
            true,
            buildGenericSetupRunPayload({
              connectorId: parsed.connectorId,
              inspection,
            }),
            undefined,
          );
          return;
        }
      }
    } catch (error) {
      if (
        parsed.connectorId === "platform:gmail-hook" ||
        parsed.connectorId.startsWith("platform:gmail-hook:")
      ) {
        const account = stringInput(parsed.inputs, "account");
        const authPayload = await buildGmailBlockedPayload(
          account,
          String(error instanceof Error ? error.message : error),
          parsed.inputs,
        );
        if (authPayload) {
          respond(true, authPayload, undefined);
          return;
        }
      }
      if (
        parsed.connectorId === "channel:telegram:auto-default-target" ||
        parsed.connectorId === "channel:telegram:verify-token"
      ) {
        const isVerify = parsed.connectorId === "channel:telegram:verify-token";
        respond(
          true,
          {
            connectorId: parsed.connectorId,
            status: "needs_setup",
            message: isVerify
              ? `Telegram token verification is blocked: ${String(error instanceof Error ? error.message : error)}`
              : `Telegram auto-detect is blocked: ${String(error instanceof Error ? error.message : error)}`,
            updatedRefs: [],
            summary: {
              command: isVerify ? "getMe" : "getUpdates",
            },
            resume: {
              connectorId: parsed.connectorId,
              label: isVerify ? "Verify Bot Token" : "Retry target auto-detect",
              detail: isVerify
                ? "Make sure the Telegram bot token is configured, then retry verification."
                : "Make sure the Telegram bot token is configured and the bot has recent messages, then retry.",
              inputs: {},
            },
          },
          undefined,
        );
        return;
      }
      if (
        parsed.connectorId === "channel:slack:verify-credentials" ||
        parsed.connectorId === "channel:discord:verify-token" ||
        parsed.connectorId === "channel:signal:verify-transport" ||
        parsed.connectorId === "channel:googlechat:verify-auth" ||
        parsed.connectorId === "channel:matrix:verify-credentials" ||
        parsed.connectorId === "channel:msteams:verify-credentials" ||
        parsed.connectorId === "channel:imessage:verify-transport"
      ) {
        const label =
          parsed.connectorId === "channel:slack:verify-credentials"
            ? "Verify Slack credentials"
            : parsed.connectorId === "channel:discord:verify-token"
              ? "Verify Discord token"
              : parsed.connectorId === "channel:signal:verify-transport"
                ? "Verify Signal transport"
                : parsed.connectorId === "channel:googlechat:verify-auth"
                  ? "Verify Google Chat auth"
                  : parsed.connectorId === "channel:matrix:verify-credentials"
                    ? "Verify Matrix credentials"
                    : parsed.connectorId === "channel:msteams:verify-credentials"
                      ? "Verify Teams credentials"
                      : "Verify iMessage transport";
        respond(
          true,
          {
            connectorId: parsed.connectorId,
            status: "needs_setup",
            message: `${label} is blocked: ${String(error instanceof Error ? error.message : error)}`,
            updatedRefs: [],
            resume: {
              connectorId: parsed.connectorId,
              label,
              detail: "Fix the channel setup inputs and run verification again.",
              inputs: {},
            },
          },
          undefined,
        );
        return;
      }
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, String(error instanceof Error ? error.message : error)),
      );
    }
  },
};
