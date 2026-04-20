import { html } from "lit";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "../../../../src/agents/defaults.js";
import {
  expandToolGroups,
  normalizeToolName,
  resolveToolProfilePolicy,
} from "../../../../src/agents/tool-policy-shared.js";
import { resolveAgentModelPrimaryValue } from "../../../../src/config/model-input.js";
import type {
  AgentIdentityResult,
  AgentsFilesListResult,
  AgentsListResult,
  ModelCatalogEntry,
  ToolCatalogProfile,
  ToolsCatalogResult,
} from "../types.ts";

export type AgentToolEntry = {
  id: string;
  label: string;
  description: string;
  source?: "core" | "plugin";
  pluginId?: string;
  optional?: boolean;
  defaultProfiles?: string[];
};

export type AgentToolSection = {
  id: string;
  label: string;
  source?: "core" | "plugin";
  pluginId?: string;
  tools: AgentToolEntry[];
};

export const FALLBACK_TOOL_SECTIONS: AgentToolSection[] = [
  {
    id: "fs",
    label: "Files",
    tools: [
      { id: "read", label: "read", description: "Read file contents" },
      { id: "write", label: "write", description: "Create or overwrite files" },
      { id: "edit", label: "edit", description: "Make precise edits" },
      { id: "apply_patch", label: "apply_patch", description: "Patch files (OpenAI)" },
    ],
  },
  {
    id: "runtime",
    label: "Runtime",
    tools: [
      { id: "exec", label: "exec", description: "Run shell commands" },
      { id: "process", label: "process", description: "Manage background processes" },
    ],
  },
  {
    id: "web",
    label: "Web",
    tools: [
      { id: "web_search", label: "web_search", description: "Search the web" },
      { id: "web_fetch", label: "web_fetch", description: "Fetch web content" },
    ],
  },
  {
    id: "memory",
    label: "Memory",
    tools: [
      { id: "memory_search", label: "memory_search", description: "Semantic search" },
      { id: "memory_get", label: "memory_get", description: "Read memory files" },
    ],
  },
  {
    id: "sessions",
    label: "Sessions",
    tools: [
      { id: "sessions_list", label: "sessions_list", description: "List sessions" },
      { id: "sessions_history", label: "sessions_history", description: "Session history" },
      { id: "sessions_send", label: "sessions_send", description: "Send to session" },
      { id: "sessions_spawn", label: "sessions_spawn", description: "Spawn sub-agent" },
      { id: "session_status", label: "session_status", description: "Session status" },
    ],
  },
  {
    id: "ui",
    label: "UI",
    tools: [
      { id: "browser", label: "browser", description: "Control web browser" },
      { id: "canvas", label: "canvas", description: "Control canvases" },
    ],
  },
  {
    id: "messaging",
    label: "Messaging",
    tools: [{ id: "message", label: "message", description: "Send messages" }],
  },
  {
    id: "automation",
    label: "Automation",
    tools: [
      { id: "cron", label: "cron", description: "Schedule tasks" },
      { id: "gateway", label: "gateway", description: "Gateway control" },
    ],
  },
  {
    id: "nodes",
    label: "Nodes",
    tools: [{ id: "nodes", label: "nodes", description: "Nodes + devices" }],
  },
  {
    id: "agents",
    label: "Agents",
    tools: [{ id: "agents_list", label: "agents_list", description: "List agents" }],
  },
  {
    id: "media",
    label: "Media",
    tools: [{ id: "image", label: "image", description: "Image understanding" }],
  },
];

export const PROFILE_OPTIONS = [
  { id: "minimal", label: "Minimal" },
  { id: "coding", label: "Coding" },
  { id: "messaging", label: "Messaging" },
  { id: "full", label: "Full" },
] as const;

export function resolveToolSections(
  toolsCatalogResult: ToolsCatalogResult | null,
): AgentToolSection[] {
  if (toolsCatalogResult?.groups?.length) {
    return toolsCatalogResult.groups.map((group) => ({
      id: group.id,
      label: group.label,
      source: group.source,
      pluginId: group.pluginId,
      tools: group.tools.map((tool) => ({
        id: tool.id,
        label: tool.label,
        description: tool.description,
        source: tool.source,
        pluginId: tool.pluginId,
        optional: tool.optional,
        defaultProfiles: [...tool.defaultProfiles],
      })),
    }));
  }
  return FALLBACK_TOOL_SECTIONS;
}

export function resolveToolProfileOptions(
  toolsCatalogResult: ToolsCatalogResult | null,
): readonly ToolCatalogProfile[] | typeof PROFILE_OPTIONS {
  if (toolsCatalogResult?.profiles?.length) {
    return toolsCatalogResult.profiles;
  }
  return PROFILE_OPTIONS;
}

type ToolPolicy = {
  allow?: string[];
  deny?: string[];
};

type AgentConfigEntry = {
  id: string;
  name?: string;
  workspace?: string;
  agentDir?: string;
  model?: unknown;
  skills?: string[];
  tools?: {
    profile?: string;
    allow?: string[];
    alsoAllow?: string[];
    deny?: string[];
  };
};

type ConfigSnapshot = {
  agents?: {
    defaults?: { workspace?: string; model?: unknown; models?: Record<string, { alias?: string }> };
    list?: AgentConfigEntry[];
  };
  models?: {
    providers?: Record<
      string,
      {
        models?: Array<{
          id?: string;
          name?: string;
        }>;
      }
    >;
  };
  tools?: {
    profile?: string;
    allow?: string[];
    alsoAllow?: string[];
    deny?: string[];
  };
};

export function normalizeAgentLabel(agent: {
  id: string;
  name?: string;
  identity?: { name?: string };
}) {
  return agent.name?.trim() || agent.identity?.name?.trim() || agent.id;
}

const AVATAR_URL_RE = /^(https?:\/\/|data:image\/|\/)/i;

export function resolveAgentAvatarUrl(
  agent: { identity?: { avatar?: string; avatarUrl?: string } },
  agentIdentity?: AgentIdentityResult | null,
): string | null {
  const candidates = [
    agentIdentity?.avatar?.trim(),
    agent.identity?.avatarUrl?.trim(),
    agent.identity?.avatar?.trim(),
  ];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (AVATAR_URL_RE.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function agentLogoUrl(basePath: string): string {
  const base = basePath?.trim() ? basePath.replace(/\/$/, "") : "";
  return base ? `${base}/favicon.svg` : "favicon.svg";
}

function isLikelyEmoji(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.length > 16) {
    return false;
  }
  let hasNonAscii = false;
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed.charCodeAt(i) > 127) {
      hasNonAscii = true;
      break;
    }
  }
  if (!hasNonAscii) {
    return false;
  }
  if (trimmed.includes("://") || trimmed.includes("/") || trimmed.includes(".")) {
    return false;
  }
  return true;
}

export function resolveAgentEmoji(
  agent: { identity?: { emoji?: string; avatar?: string } },
  agentIdentity?: AgentIdentityResult | null,
) {
  const identityEmoji = agentIdentity?.emoji?.trim();
  if (identityEmoji && isLikelyEmoji(identityEmoji)) {
    return identityEmoji;
  }
  const agentEmoji = agent.identity?.emoji?.trim();
  if (agentEmoji && isLikelyEmoji(agentEmoji)) {
    return agentEmoji;
  }
  const identityAvatar = agentIdentity?.avatar?.trim();
  if (identityAvatar && isLikelyEmoji(identityAvatar)) {
    return identityAvatar;
  }
  const avatar = agent.identity?.avatar?.trim();
  if (avatar && isLikelyEmoji(avatar)) {
    return avatar;
  }
  return "";
}

export function agentBadgeText(agentId: string, defaultId: string | null) {
  return defaultId && agentId === defaultId ? "default" : null;
}

export function agentAvatarHue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return ((hash % 360) + 360) % 360;
}

export function formatBytes(bytes?: number) {
  if (bytes == null || !Number.isFinite(bytes)) {
    return "-";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

export function resolveAgentConfig(config: Record<string, unknown> | null, agentId: string) {
  const cfg = config as ConfigSnapshot | null;
  const list = cfg?.agents?.list ?? [];
  const entry = list.find((agent) => agent?.id === agentId);
  return {
    entry,
    defaults: cfg?.agents?.defaults,
    globalTools: cfg?.tools,
  };
}

export type AgentContext = {
  workspace: string;
  model: string;
  identityName: string;
  identityAvatar: string;
  skillsLabel: string;
  isDefault: boolean;
};

export function buildAgentContext(
  agent: AgentsListResult["agents"][number],
  configForm: Record<string, unknown> | null,
  agentFilesList: AgentsFilesListResult | null,
  defaultId: string | null,
  agentIdentity?: AgentIdentityResult | null,
): AgentContext {
  const config = resolveAgentConfig(configForm, agent.id);
  const workspaceFromFiles =
    agentFilesList && agentFilesList.agentId === agent.id ? agentFilesList.workspace : null;
  const workspace =
    workspaceFromFiles || config.entry?.workspace || config.defaults?.workspace || "default";
  const modelLabel = config.entry?.model
    ? resolveModelLabel(config.entry?.model)
    : resolveModelLabel(config.defaults?.model);
  const identityName =
    agentIdentity?.name?.trim() ||
    agent.identity?.name?.trim() ||
    agent.name?.trim() ||
    config.entry?.name ||
    agent.id;
  const identityAvatar = resolveAgentAvatarUrl(agent, agentIdentity) ? "custom" : "—";
  const skillFilter = Array.isArray(config.entry?.skills) ? config.entry?.skills : null;
  const skillCount = skillFilter?.length ?? null;
  return {
    workspace,
    model: modelLabel,
    identityName,
    identityAvatar,
    skillsLabel: skillFilter ? `${skillCount} selected` : "all skills",
    isDefault: Boolean(defaultId && agent.id === defaultId),
  };
}

export function resolveModelLabel(model?: unknown): string {
  if (!model) {
    return "-";
  }
  if (typeof model === "string") {
    return model.trim() || "-";
  }
  if (typeof model === "object" && model) {
    const record = model as { primary?: string; fallbacks?: string[] };
    const primary = record.primary?.trim();
    if (primary) {
      const fallbackCount = Array.isArray(record.fallbacks) ? record.fallbacks.length : 0;
      return fallbackCount > 0 ? `${primary} (+${fallbackCount} fallback)` : primary;
    }
  }
  return "-";
}

export function normalizeModelValue(label: string): string {
  const match = label.match(/^(.+) \(\+\d+ fallback\)$/);
  return match ? match[1] : label;
}

export function resolveModelPrimary(model?: unknown): string | null {
  if (!model) {
    return null;
  }
  if (typeof model === "string") {
    const trimmed = model.trim();
    return trimmed || null;
  }
  if (typeof model === "object" && model) {
    const record = model as Record<string, unknown>;
    const candidate =
      typeof record.primary === "string"
        ? record.primary
        : typeof record.model === "string"
          ? record.model
          : typeof record.id === "string"
            ? record.id
            : typeof record.value === "string"
              ? record.value
              : null;
    const primary = candidate?.trim();
    return primary || null;
  }
  return null;
}

export function resolveModelFallbacks(model?: unknown): string[] | null {
  if (!model || typeof model === "string") {
    return null;
  }
  if (typeof model === "object" && model) {
    const record = model as Record<string, unknown>;
    const fallbacks = Array.isArray(record.fallbacks)
      ? record.fallbacks
      : Array.isArray(record.fallback)
        ? record.fallback
        : null;
    return fallbacks
      ? fallbacks.filter((entry): entry is string => typeof entry === "string")
      : null;
  }
  return null;
}

export function resolveEffectiveModelFallbacks(
  entryModel?: unknown,
  defaultModel?: unknown,
): string[] | null {
  return resolveModelFallbacks(entryModel) ?? resolveModelFallbacks(defaultModel);
}

function addModelId(target: Set<string>, value: unknown) {
  if (typeof value !== "string") {
    return;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return;
  }
  target.add(trimmed);
}

function addModelConfigIds(target: Set<string>, modelConfig: unknown) {
  if (!modelConfig) {
    return;
  }
  if (typeof modelConfig === "string") {
    addModelId(target, modelConfig);
    return;
  }
  if (typeof modelConfig !== "object") {
    return;
  }
  const record = modelConfig as Record<string, unknown>;
  addModelId(target, record.primary);
  addModelId(target, record.model);
  addModelId(target, record.id);
  addModelId(target, record.value);
  const fallbacks = Array.isArray(record.fallbacks)
    ? record.fallbacks
    : Array.isArray(record.fallback)
      ? record.fallback
      : [];
  for (const fallback of fallbacks) {
    addModelId(target, fallback);
  }
}

export function sortLocaleStrings(values: Iterable<string>): string[] {
  const sorted = Array.from(values);
  const buffer = Array.from({ length: sorted.length }, () => "");

  const merge = (left: number, middle: number, right: number): void => {
    let i = left;
    let j = middle;
    let k = left;
    while (i < middle && j < right) {
      buffer[k++] = sorted[i].localeCompare(sorted[j]) <= 0 ? sorted[i++] : sorted[j++];
    }
    while (i < middle) {
      buffer[k++] = sorted[i++];
    }
    while (j < right) {
      buffer[k++] = sorted[j++];
    }
    for (let idx = left; idx < right; idx += 1) {
      sorted[idx] = buffer[idx];
    }
  };

  const sortRange = (left: number, right: number): void => {
    if (right - left <= 1) {
      return;
    }

    const middle = (left + right) >>> 1;
    sortRange(left, middle);
    sortRange(middle, right);
    merge(left, middle, right);
  };

  sortRange(0, sorted.length);
  return sorted;
}

export function resolveConfiguredCronModelSuggestions(
  configForm: Record<string, unknown> | null,
): string[] {
  if (!configForm || typeof configForm !== "object") {
    return [];
  }
  const agents = (configForm as { agents?: unknown }).agents;
  if (!agents || typeof agents !== "object") {
    return [];
  }
  const out = new Set<string>();
  const defaults = (agents as { defaults?: unknown }).defaults;
  if (defaults && typeof defaults === "object") {
    const defaultsRecord = defaults as Record<string, unknown>;
    addModelConfigIds(out, defaultsRecord.model);
    const defaultsModels = defaultsRecord.models;
    if (defaultsModels && typeof defaultsModels === "object") {
      for (const modelId of Object.keys(defaultsModels as Record<string, unknown>)) {
        addModelId(out, modelId);
      }
    }
  }
  const list = (agents as { list?: unknown }).list;
  if (list && typeof list === "object") {
    for (const entry of Object.values(list as Record<string, unknown>)) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      addModelConfigIds(out, (entry as Record<string, unknown>).model);
    }
  }
  return sortLocaleStrings(out);
}

export function parseFallbackList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

type ConfiguredModelOption = {
  value: string;
  label: string;
};

export type BuilderModelOverrideOption = {
  value: string;
  label: string;
  configured: boolean;
  provider: string | null;
};

function normalizeModelRefProvider(valueRaw: unknown): string | null {
  if (typeof valueRaw !== "string") {
    return null;
  }
  const value = valueRaw.trim();
  if (!value) {
    return null;
  }
  const slashIndex = value.indexOf("/");
  if (slashIndex <= 0) {
    return null;
  }
  const provider = value.slice(0, slashIndex).trim().toLowerCase();
  return provider || null;
}

function readProviderConfigRecord(
  configForm: Record<string, unknown> | null,
  providerRaw: string | null | undefined,
): Record<string, unknown> | null {
  const provider = providerRaw?.trim().toLowerCase();
  if (!provider) {
    return null;
  }
  const providers = (configForm as ConfigSnapshot | null)?.models?.providers;
  if (!providers || typeof providers !== "object") {
    return null;
  }
  for (const [key, value] of Object.entries(providers)) {
    if (key.trim().toLowerCase() !== provider) {
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }
  return null;
}

function hasConfiguredSecretLike(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const source = typeof record.source === "string" ? record.source.trim() : "";
  const id = typeof record.id === "string" ? record.id.trim() : "";
  return source.length > 0 && id.length > 0;
}

function hasConfiguredModelProviderInConfig(
  configForm: Record<string, unknown> | null,
  providerRaw: string | null | undefined,
): boolean {
  const providerConfig = readProviderConfigRecord(configForm, providerRaw);
  if (!providerConfig) {
    return false;
  }
  if (hasConfiguredSecretLike(providerConfig.apiKey)) {
    return true;
  }
  const auth = typeof providerConfig.auth === "string" ? providerConfig.auth.trim() : "";
  if (auth === "aws-sdk") {
    return true;
  }
  const baseUrl = typeof providerConfig.baseUrl === "string" ? providerConfig.baseUrl.trim() : "";
  const api = typeof providerConfig.api === "string" ? providerConfig.api.trim() : "";
  const models = Array.isArray(providerConfig.models) ? providerConfig.models : [];
  return Boolean(baseUrl && api && models.length > 0);
}

function buildProviderScopedModelRef(params: {
  modelId: string;
  provider?: string | null;
}): string {
  const modelId = params.modelId.trim();
  if (!modelId) {
    return "";
  }
  if (modelId.includes("/")) {
    return modelId;
  }
  const provider = params.provider?.trim();
  return provider ? `${provider}/${modelId}` : modelId;
}

function addBuilderModelOption(
  out: Map<string, BuilderModelOverrideOption>,
  params: {
    valueRaw: unknown;
    labelHint?: string;
    configured: boolean;
    providerHint?: string | null;
  },
) {
  if (typeof params.valueRaw !== "string") {
    return;
  }
  const value = params.valueRaw.trim();
  if (!value) {
    return;
  }
  const key = value.toLowerCase();
  const label = params.labelHint?.trim() || value;
  const provider = params.providerHint?.trim().toLowerCase() || normalizeModelRefProvider(value);
  const incoming: BuilderModelOverrideOption = {
    value,
    label,
    configured: params.configured,
    provider,
  };
  const existing = out.get(key);
  if (!existing) {
    out.set(key, incoming);
    return;
  }
  if (!existing.configured && incoming.configured) {
    out.set(key, incoming);
    return;
  }
  if (
    existing.configured === incoming.configured &&
    existing.label === existing.value &&
    incoming.label !== incoming.value
  ) {
    out.set(key, incoming);
    return;
  }
  if (
    existing.configured === incoming.configured &&
    !existing.provider &&
    incoming.provider &&
    incoming.label === existing.label
  ) {
    out.set(key, incoming);
  }
}

function addConfiguredModelOption(
  out: Map<string, ConfiguredModelOption>,
  valueRaw: unknown,
  labelHint?: string,
) {
  if (typeof valueRaw !== "string") {
    return;
  }
  const value = valueRaw.trim();
  if (!value) {
    return;
  }
  const hinted = labelHint?.trim();
  const label = hinted && hinted.length > 0 ? hinted : value;
  const existing = out.get(value);
  if (!existing) {
    out.set(value, { value, label });
    return;
  }
  if (existing.label === existing.value && label !== value) {
    out.set(value, { value, label });
  }
}

function resolveConfiguredModels(
  configForm: Record<string, unknown> | null,
): ConfiguredModelOption[] {
  const cfg = configForm as ConfigSnapshot | null;
  const out = new Map<string, ConfiguredModelOption>();

  const allowlistModels = cfg?.agents?.defaults?.models;
  if (allowlistModels && typeof allowlistModels === "object") {
    for (const [modelId, modelRaw] of Object.entries(allowlistModels)) {
      const trimmed = modelId.trim();
      if (!trimmed) {
        continue;
      }
      const alias =
        modelRaw && typeof modelRaw === "object" && "alias" in modelRaw
          ? typeof (modelRaw as { alias?: unknown }).alias === "string"
            ? (modelRaw as { alias?: string }).alias?.trim()
            : undefined
          : undefined;
      addConfiguredModelOption(
        out,
        trimmed,
        alias && alias !== trimmed ? `${alias} (${trimmed})` : trimmed,
      );
    }
  }

  const discovered = new Set<string>();
  addModelConfigIds(discovered, cfg?.agents?.defaults?.model);
  const agentList = cfg?.agents?.list;
  if (Array.isArray(agentList)) {
    for (const entry of agentList) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      addModelConfigIds(discovered, (entry as Record<string, unknown>).model);
    }
  }
  for (const modelId of sortLocaleStrings(discovered)) {
    addConfiguredModelOption(out, modelId);
  }

  const providers = cfg?.models?.providers;
  if (providers && typeof providers === "object") {
    for (const [providerId, providerRaw] of Object.entries(providers)) {
      const provider = providerId.trim();
      if (!provider || !providerRaw || typeof providerRaw !== "object") {
        continue;
      }
      const modelsRaw = (providerRaw as { models?: unknown }).models;
      if (!Array.isArray(modelsRaw)) {
        continue;
      }
      for (const modelRaw of modelsRaw) {
        if (!modelRaw || typeof modelRaw !== "object") {
          continue;
        }
        const model = modelRaw as { id?: unknown; name?: unknown };
        const modelId = typeof model.id === "string" ? model.id.trim() : "";
        if (!modelId) {
          continue;
        }
        const ref = modelId.includes("/") ? modelId : `${provider}/${modelId}`;
        const name = typeof model.name === "string" ? model.name.trim() : "";
        addConfiguredModelOption(
          out,
          ref,
          name && name !== ref && name !== modelId ? `${name} (${ref})` : ref,
        );
      }
    }
  }

  return sortLocaleStrings(new Set(out.values().map((option) => option.value))).map(
    (value) => out.get(value) ?? { value, label: value },
  );
}

export function buildModelOptions(
  configForm: Record<string, unknown> | null,
  current?: string | null,
  suggestedModelIds?: Iterable<string>,
) {
  const options = resolveModelOptions(configForm, suggestedModelIds, current);
  if (options.length === 0) {
    return html`
      <option value="" disabled>No configured models</option>
    `;
  }
  return options.map((option) => html`<option value=${option.value}>${option.label}</option>`);
}

export function resolveModelOptions(
  configForm: Record<string, unknown> | null,
  suggestedModelIds?: Iterable<string>,
  current?: string | null,
) {
  const byValue = new Map<string, ConfiguredModelOption>(
    resolveConfiguredModels(configForm).map((option) => [option.value, option] as const),
  );
  if (suggestedModelIds) {
    for (const suggestion of suggestedModelIds) {
      addConfiguredModelOption(byValue, suggestion);
    }
  }
  const options = sortLocaleStrings(new Set(byValue.keys())).map(
    (value) => byValue.get(value) ?? { value, label: value },
  );
  const hasCurrent = current ? options.some((option) => option.value === current) : false;
  if (current && !hasCurrent) {
    options.unshift({ value: current, label: `Current (${current})` });
  }
  return options;
}

export function resolveBuilderModelOverrideOptions(
  configForm: Record<string, unknown> | null,
  current?: string | null,
  suggestedModelIds?: Iterable<string>,
  modelCatalog?: readonly ModelCatalogEntry[] | null,
): BuilderModelOverrideOption[] {
  const byValue = new Map<string, BuilderModelOverrideOption>();
  const exactConfigured = new Map<string, boolean>();
  const configuredProviders = new Set<string>();
  const configuredProvidersFromConfig = new Set<string>();
  const catalogProvided = Array.isArray(modelCatalog) && modelCatalog.length > 0;

  const providerRecords = (configForm as ConfigSnapshot | null)?.models?.providers;
  if (providerRecords && typeof providerRecords === "object") {
    for (const providerId of Object.keys(providerRecords)) {
      const normalized = providerId.trim().toLowerCase();
      if (!normalized || !hasConfiguredModelProviderInConfig(configForm, normalized)) {
        continue;
      }
      configuredProvidersFromConfig.add(normalized);
    }
  }

  if (catalogProvided) {
    for (const entry of modelCatalog) {
      const modelId = entry?.id?.trim();
      if (!modelId) {
        continue;
      }
      const provider = entry.provider?.trim();
      const value = buildProviderScopedModelRef({ modelId, provider });
      if (!value) {
        continue;
      }
      const configured = entry.configured !== false;
      exactConfigured.set(value.toLowerCase(), configured);
      if (configured && provider) {
        configuredProviders.add(provider.toLowerCase());
      }
      const baseLabel = provider ? `${modelId} · ${provider}` : modelId;
      addBuilderModelOption(byValue, {
        valueRaw: value,
        labelHint: baseLabel,
        configured,
        providerHint: provider ?? null,
      });
    }
  }

  for (const option of resolveConfiguredModels(configForm)) {
    const provider = normalizeModelRefProvider(option.value);
    const key = option.value.toLowerCase();
    const configured =
      exactConfigured.get(key) ??
      ((provider
        ? configuredProviders.has(provider) || configuredProvidersFromConfig.has(provider)
        : false) ||
        !catalogProvided);
    addBuilderModelOption(byValue, {
      valueRaw: option.value,
      labelHint: option.label,
      configured,
      providerHint: provider,
    });
  }

  if (suggestedModelIds) {
    for (const suggestion of suggestedModelIds) {
      const provider = normalizeModelRefProvider(suggestion);
      const configured =
        exactConfigured.get(suggestion.trim().toLowerCase()) ??
        (provider
          ? configuredProviders.has(provider) || configuredProvidersFromConfig.has(provider)
          : false);
      addBuilderModelOption(byValue, {
        valueRaw: suggestion,
        configured,
        providerHint: provider,
      });
    }
  }

  const currentValue = current?.trim();
  if (currentValue && !byValue.has(currentValue.toLowerCase())) {
    const provider = normalizeModelRefProvider(currentValue);
    const configured =
      exactConfigured.get(currentValue.toLowerCase()) ??
      (provider
        ? configuredProviders.has(provider) || configuredProvidersFromConfig.has(provider)
        : false);
    addBuilderModelOption(byValue, {
      valueRaw: currentValue,
      labelHint: `Current (${currentValue})`,
      configured,
      providerHint: provider,
    });
  }

  const sortOptions = (a: BuilderModelOverrideOption, b: BuilderModelOverrideOption) =>
    a.label.localeCompare(b.label) || a.value.localeCompare(b.value);
  const configured = Array.from(byValue.values())
    .filter((option) => option.configured)
    .toSorted(sortOptions);
  const unconfigured = Array.from(byValue.values())
    .filter((option) => !option.configured)
    .toSorted(sortOptions);
  return [...configured, ...unconfigured];
}

export function resolveBuilderDefaultModelLabel(
  configForm: Record<string, unknown> | null,
): string {
  const configuredDefault = resolveAgentModelPrimaryValue(
    (configForm as ConfigSnapshot | null)?.agents?.defaults?.model,
  )?.trim();
  if (!configuredDefault) {
    return `${DEFAULT_MODEL} · ${DEFAULT_PROVIDER}`;
  }
  const provider = normalizeModelRefProvider(configuredDefault);
  if (!provider) {
    return configuredDefault;
  }
  return `${configuredDefault.slice(provider.length + 1)} · ${provider}`;
}

type CompiledPattern =
  | { kind: "all" }
  | { kind: "exact"; value: string }
  | { kind: "regex"; value: RegExp };

function compilePattern(pattern: string): CompiledPattern {
  const normalized = normalizeToolName(pattern);
  if (!normalized) {
    return { kind: "exact", value: "" };
  }
  if (normalized === "*") {
    return { kind: "all" };
  }
  if (!normalized.includes("*")) {
    return { kind: "exact", value: normalized };
  }
  const escaped = normalized.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
  return { kind: "regex", value: new RegExp(`^${escaped.replaceAll("\\*", ".*")}$`) };
}

function compilePatterns(patterns?: string[]): CompiledPattern[] {
  if (!Array.isArray(patterns)) {
    return [];
  }
  return expandToolGroups(patterns)
    .map(compilePattern)
    .filter((pattern) => {
      return pattern.kind !== "exact" || pattern.value.length > 0;
    });
}

function matchesAny(name: string, patterns: CompiledPattern[]) {
  for (const pattern of patterns) {
    if (pattern.kind === "all") {
      return true;
    }
    if (pattern.kind === "exact" && name === pattern.value) {
      return true;
    }
    if (pattern.kind === "regex" && pattern.value.test(name)) {
      return true;
    }
  }
  return false;
}

export function isAllowedByPolicy(name: string, policy?: ToolPolicy) {
  if (!policy) {
    return true;
  }
  const normalized = normalizeToolName(name);
  const deny = compilePatterns(policy.deny);
  if (matchesAny(normalized, deny)) {
    return false;
  }
  const allow = compilePatterns(policy.allow);
  if (allow.length === 0) {
    return true;
  }
  if (matchesAny(normalized, allow)) {
    return true;
  }
  if (normalized === "apply_patch" && matchesAny("exec", allow)) {
    return true;
  }
  return false;
}

export function matchesList(name: string, list?: string[]) {
  if (!Array.isArray(list) || list.length === 0) {
    return false;
  }
  const normalized = normalizeToolName(name);
  const patterns = compilePatterns(list);
  if (matchesAny(normalized, patterns)) {
    return true;
  }
  if (normalized === "apply_patch" && matchesAny("exec", patterns)) {
    return true;
  }
  return false;
}

export function resolveToolProfile(profile: string) {
  return resolveToolProfilePolicy(profile) ?? undefined;
}
