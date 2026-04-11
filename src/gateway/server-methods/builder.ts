import { resolveDiscordAccount } from "../../../extensions/discord/src/accounts.js";
import { fetchDiscord } from "../../../extensions/discord/src/api.js";
import { listGuilds } from "../../../extensions/discord/src/guilds.js";
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
import { resolveWhatsAppAccount } from "../../../extensions/whatsapp/src/accounts.js";
import { readWebSelfId } from "../../../extensions/whatsapp/src/auth-store.js";
import {
  applyAgentBlueprintBuilderPlan,
  compileAgentBlueprintBuilderPlan,
  type AgentBlueprintBuilderManagedDocEdit,
  verifyAgentBlueprintBuilderPlan,
} from "../../agents/blueprints/builder.js";
import { inspectConnectorSetupState } from "../../agents/capabilities/planner.js";
import { DEFAULT_PROVIDER } from "../../agents/defaults.js";
import { buildModelAliasIndex } from "../../agents/model-selection.js";
import { getChannelPluginCatalogEntry } from "../../channels/plugins/catalog.js";
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
import { clearPluginDiscoveryCache } from "../../plugins/discovery.js";
import { enablePluginInConfig } from "../../plugins/enable.js";
import { installPluginFromNpmSpec } from "../../plugins/install.js";
import { buildNpmResolutionInstallFields, recordPluginInstall } from "../../plugins/installs.js";
import { normalizeAccountId } from "../../routing/session-key.js";
import { normalizeWhatsAppTarget } from "../../whatsapp/normalize.js";
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
  agentName?: string;
  workspaceDocEdits?: AgentBlueprintBuilderManagedDocEdit[];
} {
  if (!raw || typeof raw !== "object") {
    return { brief: "" };
  }
  const record = raw as Record<string, unknown>;
  const brief = typeof record.brief === "string" ? record.brief.trim() : "";
  const templateId = typeof record.templateId === "string" ? record.templateId.trim() : "";
  const modelId = typeof record.modelId === "string" ? record.modelId.trim() : "";
  const agentName = typeof record.agentName === "string" ? record.agentName.trim() : "";
  const workspaceDocEdits = Array.isArray(record.workspaceDocEdits)
    ? record.workspaceDocEdits
        .map((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            return null;
          }
          const docRecord = entry as Record<string, unknown>;
          const nodeId = typeof docRecord.nodeId === "string" ? docRecord.nodeId.trim() : "";
          const fileName = typeof docRecord.fileName === "string" ? docRecord.fileName.trim() : "";
          const content = typeof docRecord.content === "string" ? docRecord.content : "";
          if (!nodeId || !fileName || !content.trim()) {
            return null;
          }
          return {
            nodeId,
            fileName,
            content,
          } satisfies AgentBlueprintBuilderManagedDocEdit;
        })
        .filter((entry): entry is AgentBlueprintBuilderManagedDocEdit => Boolean(entry))
    : [];
  return {
    brief,
    ...(templateId ? { templateId } : {}),
    ...(modelId ? { modelId } : {}),
    ...(agentName ? { agentName } : {}),
    ...(workspaceDocEdits.length > 0 ? { workspaceDocEdits } : {}),
  };
}

function normalizeBuilderModelId(
  modelId: string | undefined,
  cfg: ReturnType<typeof loadConfig>,
): string {
  const trimmed = modelId?.trim() ?? "";
  if (!trimmed) {
    return "";
  }
  if (trimmed.includes("/")) {
    return trimmed;
  }

  const aliasIndex = buildModelAliasIndex({
    cfg,
    defaultProvider: DEFAULT_PROVIDER,
  });
  const aliasMatch = aliasIndex.byAlias.get(trimmed.toLowerCase());
  if (aliasMatch) {
    return `${aliasMatch.ref.provider}/${aliasMatch.ref.model}`;
  }

  const providers = cfg.models?.providers;
  if (!providers || typeof providers !== "object") {
    return trimmed;
  }
  const matches = new Set<string>();
  for (const [providerId, providerRaw] of Object.entries(providers)) {
    const provider = providerId.trim();
    if (!provider || !providerRaw || typeof providerRaw !== "object") {
      continue;
    }
    const models = (providerRaw as { models?: unknown }).models;
    if (!Array.isArray(models)) {
      continue;
    }
    for (const modelRaw of models) {
      if (!modelRaw || typeof modelRaw !== "object") {
        continue;
      }
      const discoveredId =
        typeof (modelRaw as { id?: unknown }).id === "string"
          ? ((modelRaw as { id?: string }).id ?? "").trim()
          : "";
      if (!discoveredId) {
        continue;
      }
      if (discoveredId === trimmed) {
        matches.add(`${provider}/${discoveredId}`);
      }
    }
  }
  if (matches.size === 1) {
    return Array.from(matches)[0] ?? trimmed;
  }
  return trimmed;
}

function parseBuilderSetupParams(raw: unknown): {
  actionId: string;
  connectorId: string;
  inputs: Record<string, unknown>;
} {
  if (!raw || typeof raw !== "object") {
    return { actionId: "", connectorId: "", inputs: {} };
  }
  const record = raw as Record<string, unknown>;
  const actionId = typeof record.actionId === "string" ? record.actionId.trim() : "";
  const connectorId = typeof record.connectorId === "string" ? record.connectorId.trim() : "";
  const inputs =
    record.inputs && typeof record.inputs === "object" && !Array.isArray(record.inputs)
      ? (record.inputs as Record<string, unknown>)
      : {};
  return { actionId, connectorId, inputs };
}

function deriveBuilderSetupConnectorId(actionId: string, connectorId: string): string {
  const normalizedConnectorId = connectorId.trim();
  if (normalizedConnectorId && normalizedConnectorId.split(":").filter(Boolean).length <= 2) {
    return normalizedConnectorId;
  }
  const trimmed = actionId.trim();
  if (!trimmed) {
    return "";
  }
  const segments = trimmed.split(":").filter(Boolean);
  if (segments.length >= 2) {
    return `${segments[0]}:${segments[1]}`;
  }
  return trimmed;
}

function buildPluginInstallActionId(connectorId: string): string {
  return `${connectorId}:install`;
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

type WebSearchProvider = "brave" | "gemini" | "grok" | "kimi" | "perplexity";

const WEB_SEARCH_PROVIDER_ORDER: WebSearchProvider[] = [
  "brave",
  "gemini",
  "grok",
  "kimi",
  "perplexity",
];

function normalizeWebSearchProvider(value: string): WebSearchProvider | "" {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "brave" ||
    normalized === "gemini" ||
    normalized === "grok" ||
    normalized === "kimi" ||
    normalized === "perplexity"
  ) {
    return normalized;
  }
  return "";
}

function hasConfiguredSecret(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  const record = asRecord(value);
  if (!record) {
    return false;
  }
  const source = stringInput(record, "source");
  const id = stringInput(record, "id");
  return source.length > 0 && id.length > 0;
}

function envVarsForWebSearchProvider(provider: WebSearchProvider): string[] {
  switch (provider) {
    case "brave":
      return ["BRAVE_API_KEY"];
    case "gemini":
      return ["GEMINI_API_KEY"];
    case "grok":
      return ["XAI_API_KEY"];
    case "kimi":
      return ["KIMI_API_KEY", "MOONSHOT_API_KEY"];
    case "perplexity":
      return ["PERPLEXITY_API_KEY", "OPENROUTER_API_KEY"];
  }
}

function hasProviderEnvCredential(provider: WebSearchProvider): boolean {
  return envVarsForWebSearchProvider(provider).some((name) => {
    const value = process.env[name];
    return typeof value === "string" && value.trim().length > 0;
  });
}

function hasWebSearchProviderCredential(
  cfg: ReturnType<typeof loadConfig>,
  provider: WebSearchProvider,
): boolean {
  const search = asRecord(asRecord(asRecord(cfg.tools)?.web)?.search);
  if (!search) {
    return hasProviderEnvCredential(provider);
  }
  const configuredSecret =
    provider === "brave"
      ? hasConfiguredSecret(search.apiKey)
      : hasConfiguredSecret(asRecord(search[provider])?.apiKey);
  return configuredSecret || hasProviderEnvCredential(provider);
}

function resolveConfiguredWebSearchProvider(
  cfg: ReturnType<typeof loadConfig>,
): WebSearchProvider | null {
  const search = asRecord(asRecord(asRecord(cfg.tools)?.web)?.search);
  const configured = normalizeWebSearchProvider(stringInput(search ?? {}, "provider"));
  if (configured) {
    return configured;
  }
  for (const provider of WEB_SEARCH_PROVIDER_ORDER) {
    if (hasWebSearchProviderCredential(cfg, provider)) {
      return provider;
    }
  }
  return null;
}

function setWebSearchConfigInConfig(params: {
  cfg: ReturnType<typeof loadConfig>;
  provider: WebSearchProvider;
  apiKey?: string;
}): ReturnType<typeof loadConfig> {
  const tools = asRecord(params.cfg.tools);
  const nextTools = tools ? { ...tools } : {};
  const web = asRecord(nextTools.web);
  const nextWeb = web ? { ...web } : {};
  const search = asRecord(nextWeb.search);
  const nextSearch = search ? { ...search } : {};
  nextSearch.enabled = true;
  nextSearch.provider = params.provider;
  if (params.apiKey) {
    if (params.provider === "brave") {
      nextSearch.apiKey = params.apiKey;
    } else {
      const scoped = asRecord(nextSearch[params.provider]);
      nextSearch[params.provider] = {
        ...scoped,
        apiKey: params.apiKey,
      };
    }
  }
  nextWeb.search = nextSearch;
  nextTools.web = nextWeb;
  return {
    ...params.cfg,
    tools: nextTools,
  } as ReturnType<typeof loadConfig>;
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

function setChannelDefaultTargetInConfig(params: {
  cfg: ReturnType<typeof loadConfig>;
  channel: string;
  target: string;
  accountId?: string;
}): ReturnType<typeof loadConfig> {
  const channels = asRecord(params.cfg.channels);
  const nextChannels = channels ? { ...channels } : {};
  const channelConfig = asRecord(nextChannels[params.channel]);
  const nextChannelConfig = channelConfig ? { ...channelConfig } : {};
  if (params.accountId) {
    const accounts = asRecord(nextChannelConfig.accounts);
    const nextAccounts = accounts ? { ...accounts } : {};
    const account = asRecord(nextAccounts[params.accountId]);
    const nextAccount = account ? { ...account } : {};
    nextAccount.defaultTo = params.target;
    nextAccounts[params.accountId] = nextAccount;
    nextChannelConfig.accounts = nextAccounts;
  } else {
    nextChannelConfig.defaultTo = params.target;
  }
  nextChannels[params.channel] = nextChannelConfig;
  return {
    ...params.cfg,
    channels: nextChannels,
  } as ReturnType<typeof loadConfig>;
}

function resolveChannelDefaultTargetFromConfig(params: {
  cfg: ReturnType<typeof loadConfig>;
  channel: string;
  accountId?: string;
}): string | null {
  const channels = asRecord(params.cfg.channels);
  const channelConfig = asRecord(channels?.[params.channel]);
  const rootTarget = stringInput(channelConfig ?? {}, "defaultTo");
  if (params.accountId) {
    const accounts = asRecord(channelConfig?.accounts);
    const accountConfig = asRecord(accounts?.[params.accountId]);
    const accountTarget = stringInput(accountConfig ?? {}, "defaultTo");
    return accountTarget || rootTarget || null;
  }
  const defaultAccountConfig = asRecord(asRecord(channelConfig?.accounts)?.default);
  const defaultAccountTarget = stringInput(defaultAccountConfig ?? {}, "defaultTo");
  return defaultAccountTarget || rootTarget || null;
}

function detectWhatsAppLinkedSelfTarget(params: {
  cfg: ReturnType<typeof loadConfig>;
  accountId?: string;
}): {
  accountId: string;
  target: string;
  e164: string | null;
  jid: string | null;
} | null {
  const account = resolveWhatsAppAccount({
    cfg: params.cfg,
    ...(params.accountId ? { accountId: params.accountId } : {}),
  });
  const { e164, jid } = readWebSelfId(account.authDir);
  const target = (e164 ?? jid ?? "").trim();
  if (!target) {
    return null;
  }
  return {
    accountId: account.accountId || "default",
    target,
    e164,
    jid,
  };
}

function withInferredWhatsAppDefaultTarget(
  cfg: ReturnType<typeof loadConfig>,
): ReturnType<typeof loadConfig> {
  const existingTarget = resolveChannelDefaultTargetFromConfig({
    cfg,
    channel: "whatsapp",
  });
  if (existingTarget) {
    return cfg;
  }
  const detected = detectWhatsAppLinkedSelfTarget({ cfg });
  if (!detected) {
    return cfg;
  }
  return setChannelDefaultTargetInConfig({
    cfg,
    channel: "whatsapp",
    target: detected.target,
  });
}

function setSignalHttpUrlInConfig(params: {
  cfg: ReturnType<typeof loadConfig>;
  httpUrl: string;
  accountId?: string;
}): ReturnType<typeof loadConfig> {
  const channels = asRecord(params.cfg.channels);
  const nextChannels = channels ? { ...channels } : {};
  const signalConfig = asRecord(nextChannels.signal);
  const nextSignalConfig = signalConfig ? { ...signalConfig } : {};
  if (params.accountId) {
    const accounts = asRecord(nextSignalConfig.accounts);
    const nextAccounts = accounts ? { ...accounts } : {};
    const account = asRecord(nextAccounts[params.accountId]);
    const nextAccount = account ? { ...account } : {};
    nextAccount.httpUrl = params.httpUrl;
    nextAccounts[params.accountId] = nextAccount;
    nextSignalConfig.accounts = nextAccounts;
  } else {
    nextSignalConfig.httpUrl = params.httpUrl;
  }
  nextChannels.signal = nextSignalConfig;
  return {
    ...params.cfg,
    channels: nextChannels,
  } as ReturnType<typeof loadConfig>;
}

function parseSlackTargetHint(raw: string): { id?: string; name?: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }
  const mention = trimmed.match(/^<#([A-Z0-9]+)(?:\|([^>]+))?>$/i);
  if (mention?.[1]) {
    return {
      id: mention[1].toUpperCase(),
      ...(mention[2]?.trim() ? { name: mention[2].trim() } : {}),
    };
  }
  const withoutPrefix = trimmed.replace(/^(slack:|channel:)/i, "").trim();
  if (/^[CDG][A-Z0-9]+$/i.test(withoutPrefix)) {
    return { id: withoutPrefix.toUpperCase() };
  }
  const withoutHash = withoutPrefix.replace(/^#/, "").trim();
  return withoutHash ? { name: withoutHash } : {};
}

const SLACK_DISCOVERY_FALLBACK_SCOPES = ["channels:read", "groups:read", "im:read", "mpim:read"];

function normalizeSlackApiErrorMessage(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.replace(/^An API error occurred:\s*/i, "").trim() || trimmed;
}

function extractSlackApiErrorDetails(error: unknown): { error: string; neededScopes: string[] } {
  const errorRecord = asRecord(error);
  const nestedRecord =
    asRecord(errorRecord?.data) ??
    asRecord(errorRecord?.body) ??
    asRecord(errorRecord?.data?.response_metadata) ??
    errorRecord;
  const directMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : stringInput(errorRecord ?? {}, "message");
  const code =
    normalizeSlackApiErrorMessage(stringInput(nestedRecord ?? {}, "error")) ||
    normalizeSlackApiErrorMessage(stringInput(errorRecord ?? {}, "code")) ||
    normalizeSlackApiErrorMessage(directMessage);
  const neededRaw = stringInput(nestedRecord ?? {}, "needed");
  const neededScopes = (neededRaw || "")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
  return {
    error: code || "unknown error",
    neededScopes,
  };
}

function formatSlackDiscoveryFailure(error: unknown): string {
  const details = extractSlackApiErrorDetails(error);
  if (details.error !== "missing_scope") {
    return `Slack channel discovery failed: ${details.error}`;
  }
  const scopes =
    details.neededScopes.length > 0 ? details.neededScopes : SLACK_DISCOVERY_FALLBACK_SCOPES;
  return `Slack channel discovery failed: missing_scope. Add Slack bot scopes ${scopes.join(
    ", ",
  )}, reinstall the app to the workspace, then rerun auto-detect.`;
}

function parseDiscordIdHint(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  const mention = trimmed.match(/^<#(\d+)>$/);
  if (mention?.[1]) {
    return mention[1];
  }
  const prefixed = trimmed.replace(/^(discord:|channel:|guild:|server:)/i, "").trim();
  return /^\d+$/.test(prefixed) ? prefixed : undefined;
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

async function installChannelPluginForBuilder(params: { connectorId: string; actionId: string }) {
  const cfg = loadConfig();
  const inspection = inspectConnectorSetupState({
    connectorId: params.connectorId,
    cfg,
    workspaceDir: process.cwd(),
  });
  if (!inspection) {
    throw new Error(`Unknown connector: ${params.connectorId}`);
  }
  if (inspection.connector.source.kind !== "channel_catalog") {
    return buildGenericSetupRunPayload({
      connectorId: params.connectorId,
      inspection,
    });
  }

  const entry = getChannelPluginCatalogEntry(inspection.connector.source.id, {
    workspaceDir: process.cwd(),
  });
  if (!entry) {
    return {
      connectorId: params.connectorId,
      actionId: params.actionId,
      status: "needs_setup" as const,
      message: `OpenClaw could not find a plugin catalog entry for ${inspection.connector.label}.`,
      updatedRefs: [],
      resume: {
        connectorId: params.connectorId,
        actionId: params.actionId,
        label: `Install ${inspection.connector.label}`,
        detail: "Refresh the plugin catalog or install the plugin manually, then retry.",
        inputs: {},
      },
    };
  }

  const result = await installPluginFromNpmSpec({
    spec: entry.install.npmSpec,
    logger: {
      info: () => {},
      warn: () => {},
    },
  });
  if (!result.ok) {
    return {
      connectorId: params.connectorId,
      actionId: params.actionId,
      status: "needs_setup" as const,
      message: `Plugin install failed for ${inspection.connector.label}: ${result.error}`,
      updatedRefs: [],
      resume: {
        connectorId: params.connectorId,
        actionId: params.actionId,
        label: `Install ${inspection.connector.label}`,
        detail: `Retry the npm install for ${entry.install.npmSpec} after fixing the install error.`,
        inputs: {},
      },
      summary: {
        command: `npm install ${entry.install.npmSpec}`,
      },
    };
  }

  let nextConfig = enablePluginInConfig(cfg, result.pluginId).config;
  nextConfig = recordPluginInstall(nextConfig, {
    pluginId: result.pluginId,
    source: "npm",
    spec: entry.install.npmSpec,
    installPath: result.targetDir,
    version: result.version,
    ...buildNpmResolutionInstallFields(result.npmResolution),
  });
  await writeConfigFile(nextConfig);
  clearPluginDiscoveryCache();

  const nextInspection = inspectConnectorSetupState({
    connectorId: params.connectorId,
    cfg: nextConfig,
    workspaceDir: process.cwd(),
  });
  if (!nextInspection) {
    return {
      connectorId: params.connectorId,
      actionId: params.actionId,
      status: "configured" as const,
      message: `${inspection.connector.label} plugin installed.`,
      updatedRefs: ["plugins.enabled", `plugins.installs.${result.pluginId}`],
      summary: {
        command: `npm install ${entry.install.npmSpec}`,
      },
    };
  }

  const followUp = buildGenericSetupRunPayload({
    connectorId: params.connectorId,
    inspection: nextInspection,
  });
  return {
    ...followUp,
    actionId: params.actionId,
    message:
      followUp.status === "configured"
        ? `${inspection.connector.label} plugin installed and enabled.`
        : `${inspection.connector.label} plugin installed. ${followUp.message}`,
    updatedRefs: dedupeStrings([
      "plugins.enabled",
      `plugins.installs.${result.pluginId}`,
      ...followUp.updatedRefs,
    ]),
    summary: {
      command: `npm install ${entry.install.npmSpec}`,
      pluginId: result.pluginId,
      version: result.version,
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
      const cfg = withInferredWhatsAppDefaultTarget(loadConfig());
      const modelId = normalizeBuilderModelId(parsed.modelId, cfg);
      const result = await compileAgentBlueprintBuilderPlan({
        brief: parsed.brief,
        ...(parsed.templateId ? { templateId: parsed.templateId } : {}),
        ...(modelId ? { modelId } : {}),
        ...(parsed.agentName ? { agentName: parsed.agentName } : {}),
        ...(parsed.workspaceDocEdits ? { workspaceDocEdits: parsed.workspaceDocEdits } : {}),
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

  "agents.builder.apply": async ({ params, respond, context }) => {
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
      const cfg = withInferredWhatsAppDefaultTarget(loadConfig());
      const modelId = normalizeBuilderModelId(parsed.modelId, cfg);
      const result = await applyAgentBlueprintBuilderPlan({
        brief: parsed.brief,
        ...(parsed.templateId ? { templateId: parsed.templateId } : {}),
        ...(modelId ? { modelId } : {}),
        ...(parsed.agentName ? { agentName: parsed.agentName } : {}),
        ...(parsed.workspaceDocEdits ? { workspaceDocEdits: parsed.workspaceDocEdits } : {}),
        cfg,
        cron: context.cron,
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
      const cfg = withInferredWhatsAppDefaultTarget(loadConfig());
      const modelId = normalizeBuilderModelId(parsed.modelId, cfg);
      const result = await verifyAgentBlueprintBuilderPlan({
        brief: parsed.brief,
        ...(parsed.templateId ? { templateId: parsed.templateId } : {}),
        ...(modelId ? { modelId } : {}),
        ...(parsed.agentName ? { agentName: parsed.agentName } : {}),
        ...(parsed.workspaceDocEdits ? { workspaceDocEdits: parsed.workspaceDocEdits } : {}),
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
    const actionId = parsed.actionId || parsed.connectorId;
    const connectorId = deriveBuilderSetupConnectorId(actionId, parsed.connectorId);
    if (!actionId || !connectorId) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "agents.builder.setup.run requires an `actionId` or `connectorId` param.",
        ),
      );
      return;
    }
    try {
      switch (actionId) {
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
          respond(true, gmailConfiguredPayload(connectorId, summary), undefined);
          return;
        }
        case "tools:web":
        case "tools:web:configure": {
          const cfg = loadConfig();
          const providerInput = normalizeWebSearchProvider(
            firstStringInput(parsed.inputs, [
              "provider",
              "web.provider",
              "tools.web.search.provider",
            ]),
          );
          const configuredProvider = resolveConfiguredWebSearchProvider(cfg);
          const provider = providerInput || configuredProvider;
          const apiKey = normalizeSetupSecret(
            firstStringInput(parsed.inputs, ["apiKey", "web.apiKey", "tools.web.search.apiKey"]),
          );

          if (!provider) {
            respond(
              true,
              {
                connectorId,
                actionId,
                status: "needs_setup",
                message:
                  "Select a web search provider first (brave, gemini, grok, kimi, or perplexity), then run setup again.",
                updatedRefs: [],
                resume: {
                  connectorId,
                  actionId,
                  label: "Configure web search",
                  detail:
                    "Pick a provider and optionally paste an API key. You can also keep credentials in environment variables.",
                  inputs: {
                    provider: configuredProvider ?? "brave",
                  },
                },
              },
              undefined,
            );
            return;
          }

          const nextConfig = setWebSearchConfigInConfig({
            cfg,
            provider,
            ...(apiKey ? { apiKey } : {}),
          });
          await writeConfigFile(nextConfig);

          const inspection = inspectConnectorSetupState({
            connectorId,
            cfg: nextConfig,
            workspaceDir: process.cwd(),
          });
          if (!inspection) {
            respond(
              false,
              undefined,
              errorShape(
                ErrorCodes.INVALID_REQUEST,
                `agents.builder.setup.run received unknown connectorId: ${connectorId}.`,
              ),
            );
            return;
          }

          const hasCredential = hasWebSearchProviderCredential(nextConfig, provider);
          const keyRef =
            provider === "brave"
              ? "tools.web.search.apiKey"
              : `tools.web.search.${provider}.apiKey`;
          respond(
            true,
            inspection.setupTask.status === "completed"
              ? {
                  connectorId,
                  actionId,
                  status: "configured",
                  message: hasCredential
                    ? `Web search is configured with provider "${provider}".`
                    : `Web search provider "${provider}" saved. Add credentials via ${keyRef} or environment variables to complete readiness.`,
                  updatedRefs: dedupeStrings([
                    "tools.web.search.provider",
                    ...(apiKey ? [keyRef] : []),
                  ]),
                }
              : {
                  connectorId,
                  actionId,
                  status: "needs_auth",
                  message:
                    inspection.integration.issues[0] ??
                    `Web search provider "${provider}" still needs credentials.`,
                  updatedRefs: dedupeStrings([
                    "tools.web.search.provider",
                    ...(apiKey ? [keyRef] : []),
                  ]),
                  resume: {
                    connectorId,
                    actionId,
                    label: "Re-check web search setup",
                    detail:
                      "After setting credentials, run setup again so EasyClaw can verify web tools readiness.",
                    inputs: {
                      provider,
                    },
                  },
                },
            undefined,
          );
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
        case "channel:whatsapp:auto-default-target": {
          const cfg = loadConfig();
          const requestedAccountId = firstStringInput(parsed.inputs, ["accountId", "account"]);
          const accountId = requestedAccountId ? normalizeAccountId(requestedAccountId) : "";
          const requestedTargetRaw = firstStringInput(parsed.inputs, [
            "whatsapp.target",
            "whatsapp.defaultTo",
            "target",
            "defaultTo",
            "to",
          ]);
          if (requestedTargetRaw) {
            const normalizedTarget = normalizeWhatsAppTarget(requestedTargetRaw);
            if (!normalizedTarget) {
              respond(
                true,
                {
                  connectorId: parsed.connectorId,
                  status: "needs_setup",
                  message:
                    'Invalid WhatsApp destination. Use E.164 like "+15551234567" or a group JID like "120363025391234567@g.us".',
                  updatedRefs: [],
                  summary: {
                    command: "normalizeWhatsAppTarget",
                    accountId: accountId || "default",
                    input: requestedTargetRaw,
                  },
                },
                undefined,
              );
              return;
            }
            const nextConfig = setChannelDefaultTargetInConfig({
              cfg,
              channel: "whatsapp",
              target: normalizedTarget,
              ...(accountId ? { accountId } : {}),
            });
            await writeConfigFile(nextConfig);
            const updatedRef = accountId
              ? `channels.whatsapp.accounts.${accountId}.defaultTo`
              : "channels.whatsapp.defaultTo";
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "configured",
                message: `WhatsApp default target set to ${normalizedTarget}.`,
                updatedRefs: [updatedRef],
                summary: {
                  command: "normalizeWhatsAppTarget",
                  accountId: accountId || "default",
                  defaultTo: normalizedTarget,
                },
              },
              undefined,
            );
            return;
          }
          const existingTarget = resolveChannelDefaultTargetFromConfig({
            cfg,
            channel: "whatsapp",
            ...(accountId ? { accountId } : {}),
          });
          if (existingTarget) {
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "configured",
                message: `WhatsApp default target is already set to ${existingTarget}.`,
                updatedRefs: [],
                summary: {
                  command: "readWebSelfId",
                  accountId: accountId || "default",
                  defaultTo: existingTarget,
                },
              },
              undefined,
            );
            return;
          }
          const detected = detectWhatsAppLinkedSelfTarget({
            cfg,
            ...(accountId ? { accountId } : {}),
          });
          if (!detected) {
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "needs_setup",
                message:
                  "WhatsApp auto-detect could not find a linked account identity yet. Link WhatsApp first (Show QR + Wait for scan), then run auto-detect again.",
                updatedRefs: [],
                summary: {
                  command: "readWebSelfId",
                  accountId: accountId || "default",
                },
                resume: {
                  connectorId: parsed.connectorId,
                  label: "Auto-detect WhatsApp target",
                  detail: "After WhatsApp is linked, run auto-detect again to set defaultTo.",
                  inputs: accountId ? { accountId } : {},
                },
              },
              undefined,
            );
            return;
          }
          const nextConfig = setChannelDefaultTargetInConfig({
            cfg,
            channel: "whatsapp",
            target: detected.target,
            ...(accountId ? { accountId } : {}),
          });
          await writeConfigFile(nextConfig);
          const updatedRef = accountId
            ? `channels.whatsapp.accounts.${accountId}.defaultTo`
            : "channels.whatsapp.defaultTo";
          respond(
            true,
            {
              connectorId: parsed.connectorId,
              status: "configured",
              message: `WhatsApp default target set to ${detected.target}.`,
              updatedRefs: [updatedRef],
              summary: {
                command: "readWebSelfId",
                accountId: detected.accountId,
                defaultTo: detected.target,
                selfE164: detected.e164,
                selfJid: detected.jid,
              },
            },
            undefined,
          );
          return;
        }
        case "channel:slack:auto-default-target": {
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
          const botToken =
            normalizeSetupSecret(
              firstStringInput(parsed.inputs, ["slack.botToken", "botToken", "token"]),
            ) || normalizeSetupSecret(account.botToken?.trim() ?? "");
          if (!botToken) {
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "needs_setup",
                message: `Slack bot token is missing for account "${resolvedAccountId}". Save Bot Token, then run Auto-detect Slack target.`,
                updatedRefs: [],
                summary: {
                  command: "conversations.list",
                  accountId: resolvedAccountId,
                },
                resume: {
                  connectorId: parsed.connectorId,
                  label: "Auto-detect Slack target",
                  detail: "After saving Bot Token, run auto-detect again.",
                  inputs: accountId ? { accountId } : {},
                },
              },
              undefined,
            );
            return;
          }
          const requestedTarget = firstStringInput(parsed.inputs, [
            "slack.target",
            "slack.defaultTo",
            "defaultTo",
            "target",
            "channel",
          ]);
          const targetHint = parseSlackTargetHint(requestedTarget);
          const client = createSlackWebClient(botToken, { timeout: 5000 });
          let conversationResponse: Record<string, unknown> | null = null;
          try {
            conversationResponse = asRecord(
              await client.apiCall("conversations.list", {
                types: "public_channel,private_channel,im,mpim",
                exclude_archived: true,
                limit: 200,
              }),
            );
          } catch (error) {
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "needs_setup",
                message: formatSlackDiscoveryFailure(error),
                updatedRefs: [],
                summary: {
                  command: "conversations.list",
                  accountId: resolvedAccountId,
                },
                resume: {
                  connectorId: parsed.connectorId,
                  label: "Auto-detect Slack target",
                  detail:
                    "Update the Slack app scopes or reinstall it to the workspace, then rerun auto-detect.",
                  inputs: accountId ? { accountId } : {},
                },
              },
              undefined,
            );
            return;
          }
          if (conversationResponse?.ok === false) {
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "needs_setup",
                message: formatSlackDiscoveryFailure(conversationResponse),
                updatedRefs: [],
                summary: {
                  command: "conversations.list",
                  accountId: resolvedAccountId,
                },
                resume: {
                  connectorId: parsed.connectorId,
                  label: "Auto-detect Slack target",
                  detail: "Fix Slack permissions/tokens, then rerun auto-detect.",
                  inputs: accountId ? { accountId } : {},
                },
              },
              undefined,
            );
            return;
          }
          const discoveredConversations = Array.isArray(conversationResponse?.channels)
            ? conversationResponse.channels
                .map((entry) => asRecord(entry))
                .filter((entry): entry is Record<string, unknown> => Boolean(entry))
                .map((entry) => {
                  const id = stringInput(entry, "id").toUpperCase();
                  if (!id) {
                    return null;
                  }
                  return {
                    id,
                    name: stringInput(entry, "name"),
                    archived: entry.is_archived === true,
                    member: entry.is_member === true,
                  };
                })
                .filter(
                  (
                    entry,
                  ): entry is { id: string; name: string; archived: boolean; member: boolean } =>
                    Boolean(entry),
                )
            : [];
          if (discoveredConversations.length === 0) {
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "needs_setup",
                message:
                  "Slack auto-detect did not find any visible conversations for this bot. Invite the app to at least one channel, then rerun auto-detect.",
                updatedRefs: [],
                summary: {
                  command: "conversations.list",
                  accountId: resolvedAccountId,
                },
                resume: {
                  connectorId: parsed.connectorId,
                  label: "Auto-detect Slack target",
                  detail: "After inviting the bot to a channel, run auto-detect again.",
                  inputs: accountId ? { accountId } : {},
                },
              },
              undefined,
            );
            return;
          }
          const byHint = targetHint.id
            ? discoveredConversations.find((conversation) => conversation.id === targetHint.id)
            : targetHint.name
              ? discoveredConversations.find(
                  (conversation) =>
                    conversation.name.toLowerCase() === targetHint.name?.toLowerCase(),
                )
              : undefined;
          if (requestedTarget && !byHint) {
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "needs_setup",
                message: `Slack could not find a conversation matching "${requestedTarget}".`,
                updatedRefs: [],
                summary: {
                  command: "conversations.list",
                  accountId: resolvedAccountId,
                },
                resume: {
                  connectorId: parsed.connectorId,
                  label: "Auto-detect Slack target",
                  detail:
                    "Use a channel ID (channel:C...) or exact channel name, then rerun auto-detect.",
                  inputs: accountId
                    ? { accountId, target: requestedTarget }
                    : { target: requestedTarget },
                },
              },
              undefined,
            );
            return;
          }
          if (byHint && !byHint.member) {
            const destinationLabel = byHint.name ? `#${byHint.name}` : byHint.id;
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "needs_setup",
                message: `Slack found ${destinationLabel}, but the bot is not a member. Invite the app to that conversation, then rerun auto-detect.`,
                updatedRefs: [],
                summary: {
                  command: "conversations.list",
                  accountId: resolvedAccountId,
                  defaultTo: `channel:${byHint.id}`,
                  conversationName: byHint.name || null,
                },
                resume: {
                  connectorId: parsed.connectorId,
                  label: "Auto-detect Slack target",
                  detail:
                    "After inviting the bot to that Slack conversation, run auto-detect again.",
                  inputs: accountId
                    ? { accountId, target: requestedTarget }
                    : { target: requestedTarget },
                },
              },
              undefined,
            );
            return;
          }
          const selected =
            byHint ??
            discoveredConversations.toSorted((left, right) => {
              const leftRank = (left.member ? 0 : 1) + (left.id.startsWith("C") ? 0 : 1);
              const rightRank = (right.member ? 0 : 1) + (right.id.startsWith("C") ? 0 : 1);
              if (leftRank !== rightRank) {
                return leftRank - rightRank;
              }
              return left.name.localeCompare(right.name);
            })[0];
          if (!selected) {
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "needs_setup",
                message: "Slack auto-detect could not choose a default target.",
                updatedRefs: [],
                summary: {
                  command: "conversations.list",
                  accountId: resolvedAccountId,
                },
              },
              undefined,
            );
            return;
          }
          if (!selected.member) {
            const destinationLabel = selected.name ? `#${selected.name}` : selected.id;
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "needs_setup",
                message: `Slack can see ${destinationLabel}, but the bot is not joined to any deliverable conversation yet. Invite the app to a channel or DM, then rerun auto-detect.`,
                updatedRefs: [],
                summary: {
                  command: "conversations.list",
                  accountId: resolvedAccountId,
                  defaultTo: `channel:${selected.id}`,
                  conversationName: selected.name || null,
                },
                resume: {
                  connectorId: parsed.connectorId,
                  label: "Auto-detect Slack target",
                  detail:
                    "After inviting the bot to a Slack conversation it can post into, run auto-detect again.",
                  inputs: accountId ? { accountId } : {},
                },
              },
              undefined,
            );
            return;
          }
          const nextConfig = setChannelDefaultTargetInConfig({
            cfg,
            channel: "slack",
            target: `channel:${selected.id}`,
            ...(accountId ? { accountId } : {}),
          });
          await writeConfigFile(nextConfig);
          const updatedRef = accountId
            ? `channels.slack.accounts.${accountId}.defaultTo`
            : "channels.slack.defaultTo";
          const destinationLabel = selected.name ? `#${selected.name}` : selected.id;
          respond(
            true,
            {
              connectorId: parsed.connectorId,
              status: "configured",
              message: `Slack default target set to ${destinationLabel} (channel:${selected.id}) for account ${resolvedAccountId}.`,
              updatedRefs: [updatedRef],
              summary: {
                command: "conversations.list",
                accountId: resolvedAccountId,
                defaultTo: `channel:${selected.id}`,
                conversationName: selected.name || null,
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
        case "channel:discord:auto-default-target": {
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
          const token =
            normalizeDiscordToken(
              firstStringInput(parsed.inputs, ["discord.token", "token", "botToken"]),
              "agents.builder.setup.run.inputs.discord.token",
            ) || normalizeDiscordToken(account.token, "channels.discord.token");
          if (!token) {
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "needs_setup",
                message: `Discord bot token is missing for account "${resolvedAccountId}". Save Token, then run Auto-detect Discord target.`,
                updatedRefs: [],
                summary: {
                  command: "GET /users/@me/guilds",
                  accountId: resolvedAccountId,
                },
                resume: {
                  connectorId: parsed.connectorId,
                  label: "Auto-detect Discord target",
                  detail: "After saving Token, run auto-detect again.",
                  inputs: accountId ? { accountId } : {},
                },
              },
              undefined,
            );
            return;
          }
          const requestedGuild = firstStringInput(parsed.inputs, [
            "discord.guild",
            "discord.guildId",
            "guild",
            "guildId",
          ]);
          const requestedChannel = firstStringInput(parsed.inputs, [
            "discord.channel",
            "discord.channelId",
            "channel",
            "channelId",
            "target",
            "defaultTo",
          ]);
          const guildIdHint = parseDiscordIdHint(requestedGuild);
          const channelIdHint = parseDiscordIdHint(requestedChannel);
          const guildNameHint = requestedGuild.trim().toLowerCase();
          const channelNameHint = requestedChannel
            .replace(/^(channel:|discord:)/i, "")
            .replace(/^#/, "")
            .trim()
            .toLowerCase();
          const guilds = await listGuilds(token, fetch);
          if (guilds.length === 0) {
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "needs_setup",
                message:
                  "Discord auto-detect did not find any guilds for this bot. Invite the bot to at least one server, then rerun auto-detect.",
                updatedRefs: [],
                summary: {
                  command: "GET /users/@me/guilds",
                  accountId: resolvedAccountId,
                },
                resume: {
                  connectorId: parsed.connectorId,
                  label: "Auto-detect Discord target",
                  detail: "After inviting the bot to a server, run auto-detect again.",
                  inputs: accountId ? { accountId } : {},
                },
              },
              undefined,
            );
            return;
          }
          const candidateGuilds = guildIdHint
            ? guilds.filter((guild) => guild.id === guildIdHint)
            : guildNameHint
              ? guilds.filter((guild) => guild.name.trim().toLowerCase() === guildNameHint)
              : guilds;
          if ((guildIdHint || guildNameHint) && candidateGuilds.length === 0) {
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "needs_setup",
                message: `Discord auto-detect could not find a guild matching "${requestedGuild}".`,
                updatedRefs: [],
                summary: {
                  command: "GET /users/@me/guilds",
                  accountId: resolvedAccountId,
                },
              },
              undefined,
            );
            return;
          }
          let selectedGuild: { id: string; name: string } | undefined;
          let selectedChannel: { id: string; name: string } | undefined;
          for (const guild of candidateGuilds) {
            const rawChannels = await fetchDiscord<
              Array<{ id?: string; name?: string; type?: number }>
            >(`/guilds/${guild.id}/channels`, token);
            const textChannels = rawChannels
              .map((channel) => ({
                id: typeof channel.id === "string" ? channel.id.trim() : "",
                name: typeof channel.name === "string" ? channel.name.trim() : "",
                type: channel.type,
              }))
              .filter((channel) => {
                if (!channel.id) {
                  return false;
                }
                if (typeof channel.type !== "number") {
                  return false;
                }
                return channel.type === 0 || channel.type === 5;
              });
            if (textChannels.length === 0) {
              continue;
            }
            const byHint = channelIdHint
              ? textChannels.find((channel) => channel.id === channelIdHint)
              : channelNameHint
                ? textChannels.find((channel) => channel.name.toLowerCase() === channelNameHint)
                : undefined;
            const picked = byHint ?? textChannels[0];
            if (!picked) {
              continue;
            }
            selectedGuild = guild;
            selectedChannel = picked;
            if (byHint || !requestedChannel) {
              break;
            }
          }
          if (!selectedGuild || !selectedChannel || (requestedChannel && !selectedChannel)) {
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "needs_setup",
                message: requestedChannel
                  ? `Discord auto-detect could not find a text channel matching "${requestedChannel}".`
                  : "Discord auto-detect could not find any text channels where this bot can post.",
                updatedRefs: [],
                summary: {
                  command: "GET /users/@me/guilds + GET /guilds/{guildId}/channels",
                  accountId: resolvedAccountId,
                },
                resume: {
                  connectorId: parsed.connectorId,
                  label: "Auto-detect Discord target",
                  detail:
                    "Provide a specific guild/channel hint or invite the bot to a text channel, then rerun auto-detect.",
                  inputs: accountId ? { accountId } : {},
                },
              },
              undefined,
            );
            return;
          }
          const target = `channel:${selectedChannel.id}`;
          const nextConfig = setChannelDefaultTargetInConfig({
            cfg,
            channel: "discord",
            target,
            ...(accountId ? { accountId } : {}),
          });
          await writeConfigFile(nextConfig);
          const updatedRef = accountId
            ? `channels.discord.accounts.${accountId}.defaultTo`
            : "channels.discord.defaultTo";
          respond(
            true,
            {
              connectorId: parsed.connectorId,
              status: "configured",
              message: `Discord default target set to #${selectedChannel.name || selectedChannel.id} in ${selectedGuild.name} (${target}) for account ${resolvedAccountId}.`,
              updatedRefs: [updatedRef],
              summary: {
                command: "GET /users/@me/guilds + GET /guilds/{guildId}/channels",
                accountId: resolvedAccountId,
                guildId: selectedGuild.id,
                guildName: selectedGuild.name,
                channelId: selectedChannel.id,
                channelName: selectedChannel.name || null,
                defaultTo: target,
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
        case "channel:signal:auto-detect-http-url": {
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
          const requestedHttpUrl = normalizeSetupSecret(
            firstStringInput(parsed.inputs, ["signal.httpUrl", "httpUrl", "baseUrl"]),
          );
          const requestedHost = firstStringInput(parsed.inputs, ["signal.httpHost", "httpHost"]);
          const requestedPortRaw = firstStringInput(parsed.inputs, ["signal.httpPort", "httpPort"]);
          const requestedPort = Number.parseInt(requestedPortRaw, 10);
          const hostCandidate = requestedHost
            ? `http://${requestedHost.trim()}:${Number.isFinite(requestedPort) ? requestedPort : 8080}`
            : "";
          const candidates = dedupeStrings(
            [
              requestedHttpUrl,
              hostCandidate,
              account.baseUrl,
              "http://127.0.0.1:8080",
              "http://localhost:8080",
            ]
              .map((value) => value.trim())
              .filter((value) => value.length > 0),
          );
          const attempts: Array<{
            url: string;
            ok: boolean;
            error?: string | null;
            version?: string | null;
          }> = [];
          let selected: { url: string; version?: string | null } | null = null;
          for (const url of candidates) {
            const probe = await probeSignal(url, 3000);
            attempts.push({
              url,
              ok: probe.ok,
              error: probe.error,
              version: probe.version,
            });
            if (probe.ok) {
              selected = { url, version: probe.version };
              break;
            }
          }
          if (!selected) {
            respond(
              true,
              {
                connectorId: parsed.connectorId,
                status: "needs_setup",
                message:
                  "Signal auto-detect could not reach signal-cli on common local endpoints. Start signal-cli HTTP mode (or provide signal.httpUrl), then retry.",
                updatedRefs: [],
                summary: {
                  command: "signal-cli version",
                  accountId: resolvedAccountId,
                  attemptedUrls: attempts.map((attempt) => attempt.url),
                },
                resume: {
                  connectorId: parsed.connectorId,
                  label: "Auto-detect Signal URL",
                  detail:
                    "After signal-cli HTTP is running (or you set signal.httpUrl), run auto-detect again.",
                  inputs: accountId ? { accountId } : {},
                },
              },
              undefined,
            );
            return;
          }
          const nextConfig = setSignalHttpUrlInConfig({
            cfg,
            httpUrl: selected.url,
            ...(accountId ? { accountId } : {}),
          });
          await writeConfigFile(nextConfig);
          const updatedRef = accountId
            ? `channels.signal.accounts.${accountId}.httpUrl`
            : "channels.signal.httpUrl";
          respond(
            true,
            {
              connectorId: parsed.connectorId,
              status: "configured",
              message: `Signal transport URL set to ${selected.url}${selected.version ? ` (signal-cli ${selected.version})` : ""} for account ${resolvedAccountId}.`,
              updatedRefs: [updatedRef],
              summary: {
                command: "signal-cli version",
                accountId: resolvedAccountId,
                httpUrl: selected.url,
                version: selected.version ?? null,
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
          const persistedMSTeamsConfig = asRecord(cfg.channels?.msteams) ?? {};
          const msteamsConfig = {
            ...persistedMSTeamsConfig,
            ...(appId ? { appId } : {}),
            ...(appPassword ? { appPassword } : {}),
            ...(tenantId ? { tenantId } : {}),
          } as {
            enabled?: boolean;
            appId?: string;
            appPassword?: string;
            tenantId?: string;
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
          if (actionId === buildPluginInstallActionId(connectorId)) {
            respond(
              true,
              await installChannelPluginForBuilder({
                connectorId,
                actionId,
              }),
              undefined,
            );
            return;
          }
          const cfg = loadConfig();
          const inspection = inspectConnectorSetupState({
            connectorId,
            cfg,
            workspaceDir: process.cwd(),
          });
          if (!inspection) {
            respond(
              false,
              undefined,
              errorShape(
                ErrorCodes.INVALID_REQUEST,
                `agents.builder.setup.run received unknown connectorId: ${connectorId}.`,
              ),
            );
            return;
          }
          respond(
            true,
            {
              ...buildGenericSetupRunPayload({
                connectorId,
                inspection,
              }),
              actionId,
            },
            undefined,
          );
          return;
        }
      }
    } catch (error) {
      if (connectorId === "platform:gmail-hook" || actionId.startsWith("platform:gmail-hook:")) {
        const account = stringInput(parsed.inputs, "account");
        const authPayload = await buildGmailBlockedPayload(
          account,
          String(error instanceof Error ? error.message : error),
          parsed.inputs,
        );
        if (authPayload) {
          respond(
            true,
            {
              ...authPayload,
              actionId,
              connectorId,
            },
            undefined,
          );
          return;
        }
      }
      if (connectorId === "tools:web") {
        respond(
          true,
          {
            connectorId,
            actionId,
            status: "needs_setup",
            message: `Web search setup is blocked: ${String(error instanceof Error ? error.message : error)}`,
            updatedRefs: [],
            resume: {
              connectorId,
              actionId,
              label: "Configure web search",
              detail:
                "Set a web search provider and credentials, then run this setup action again.",
              inputs: {},
            },
          },
          undefined,
        );
        return;
      }
      if (
        actionId === "channel:telegram:auto-default-target" ||
        actionId === "channel:telegram:verify-token"
      ) {
        const isVerify = actionId === "channel:telegram:verify-token";
        respond(
          true,
          {
            connectorId,
            actionId,
            status: "needs_setup",
            message: isVerify
              ? `Telegram token verification is blocked: ${String(error instanceof Error ? error.message : error)}`
              : `Telegram auto-detect is blocked: ${String(error instanceof Error ? error.message : error)}`,
            updatedRefs: [],
            summary: {
              command: isVerify ? "getMe" : "getUpdates",
            },
            resume: {
              connectorId,
              actionId,
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
        actionId === "channel:slack:auto-default-target" ||
        actionId === "channel:whatsapp:auto-default-target" ||
        actionId === "channel:slack:verify-credentials" ||
        actionId === "channel:discord:auto-default-target" ||
        actionId === "channel:discord:verify-token" ||
        actionId === "channel:signal:auto-detect-http-url" ||
        actionId === "channel:signal:verify-transport" ||
        actionId === "channel:googlechat:verify-auth" ||
        actionId === "channel:matrix:verify-credentials" ||
        actionId === "channel:msteams:verify-credentials" ||
        actionId === "channel:imessage:verify-transport"
      ) {
        const label =
          actionId === "channel:slack:auto-default-target"
            ? "Auto-detect Slack target"
            : actionId === "channel:whatsapp:auto-default-target"
              ? "Auto-detect WhatsApp target"
              : actionId === "channel:slack:verify-credentials"
                ? "Verify Slack credentials"
                : actionId === "channel:discord:auto-default-target"
                  ? "Auto-detect Discord target"
                  : actionId === "channel:discord:verify-token"
                    ? "Verify Discord token"
                    : actionId === "channel:signal:auto-detect-http-url"
                      ? "Auto-detect Signal URL"
                      : actionId === "channel:signal:verify-transport"
                        ? "Verify Signal transport"
                        : actionId === "channel:googlechat:verify-auth"
                          ? "Verify Google Chat auth"
                          : actionId === "channel:matrix:verify-credentials"
                            ? "Verify Matrix credentials"
                            : actionId === "channel:msteams:verify-credentials"
                              ? "Verify Teams credentials"
                              : "Verify iMessage transport";
        respond(
          true,
          {
            connectorId,
            actionId,
            status: "needs_setup",
            message: `${label} is blocked: ${String(error instanceof Error ? error.message : error)}`,
            updatedRefs: [],
            resume: {
              connectorId,
              actionId,
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
