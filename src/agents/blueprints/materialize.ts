import fs from "node:fs/promises";
import path from "node:path";
import {
  applyAgentBindings,
  describeBinding,
  removeAgentBindings,
} from "../../commands/agents.bindings.js";
import {
  applyAgentConfig,
  findAgentEntryIndex,
  listAgentEntries,
} from "../../commands/agents.config.js";
import {
  readConfigFileSnapshotForWrite,
  type OpenClawConfig,
  writeConfigFile,
} from "../../config/config.js";
import { resolveSessionTranscriptsDirForAgent } from "../../config/sessions.js";
import type { AgentRouteBinding } from "../../config/types.js";
import { CronService } from "../../cron/service.js";
import { resolveCronStorePath } from "../../cron/store.js";
import type { CronJobCreate, CronJobPatch } from "../../cron/types.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { resolveDefaultAgentId } from "../agent-scope.js";
import { ensureAuthProfileStore } from "../auth-profiles/store.js";
import { resolveDefaultModelForAgent } from "../model-selection.js";
import { resolveWorkspaceTemplateDir } from "../workspace-templates.js";
import { ensureAgentWorkspace } from "../workspace.js";
import type { AgentBlueprintPlan } from "./compiler.js";
import { compileAgentBlueprintPlan } from "./compiler.js";
import type { LoadedAgentBlueprint } from "./files.js";
import type { AgentBlueprintBundle } from "./schema.js";
import { resolveAgentBlueprintVariables, type AgentBlueprintVariableMap } from "./variables.js";

const BLUEPRINT_MANAGED_START = "<!-- easyclaw:blueprint:start -->";
const BLUEPRINT_MANAGED_END = "<!-- easyclaw:blueprint:end -->";
const BLUEPRINT_METADATA_FILENAME = "easyclaw-blueprint.json";
const MEMORY_DIRNAME = "memory";

type BlueprintSourceEntry = NonNullable<
  NonNullable<AgentBlueprintBundle["ingress"]>["sources"]
>[number];
type BlueprintScheduleEntry = NonNullable<
  NonNullable<AgentBlueprintBundle["automation"]>["schedules"]
>[number];
type AgentEntry = NonNullable<NonNullable<OpenClawConfig["agents"]>["list"]>[number];

type ManagedBlueprintMetadata = {
  version: 1;
  manifest: AgentBlueprintBundle["manifest"];
  source: {
    kind: LoadedAgentBlueprint["kind"];
    value: string;
    format: LoadedAgentBlueprint["format"];
  };
  appliedAt: string;
  templateVariables: {
    values: AgentBlueprintVariableMap;
    resolved: string[];
  };
  managedBindings: AgentRouteBinding[];
  cronJobs: Array<{ name: string; id?: string }>;
  workspaceFiles: string[];
};

export type AgentBlueprintApplyWarning = {
  code:
    | "binding-conflict"
    | "binding-default-skipped"
    | "binding-thread-skipped"
    | "cron-disabled"
    | "delivery-target-session-only"
    | "ingress-sources-not-materialized"
    | "sandbox-not-materialized"
    | "subagent-mode-not-materialized";
  message: string;
};

export type AgentBlueprintWorkspaceFileResult = {
  name: string;
  path: string;
  status: "created" | "updated" | "unchanged";
};

export type AgentBlueprintManagedWorkspaceDocPreview = {
  name: string;
  content: string;
};

export type AgentBlueprintApplyResult = {
  status: "applied";
  source: AgentBlueprintPlan["source"];
  plan: AgentBlueprintPlan;
  templateVariables: {
    values: AgentBlueprintVariableMap;
    resolved: string[];
  };
  configPath: string;
  agent: {
    agentId: string;
    name: string;
    workspaceDir: string;
    agentDir: string;
  };
  workspace: {
    metadataPath: string;
    files: AgentBlueprintWorkspaceFileResult[];
  };
  bindings: {
    removed: string[];
    added: string[];
    updated: string[];
    skipped: string[];
    conflicts: string[];
    ignored: string[];
  };
  automation: {
    jobs: Array<{
      name: string;
      id: string;
      status: "created" | "updated" | "removed";
    }>;
  };
  warnings: AgentBlueprintApplyWarning[];
};

function stripFrontMatter(content: string): string {
  if (!content.startsWith("---")) {
    return content;
  }
  const endIndex = content.indexOf("\n---", 3);
  if (endIndex === -1) {
    return content;
  }
  return content.slice(endIndex + "\n---".length).replace(/^\s+/, "");
}

function managedSection(content: string): string {
  return `${BLUEPRINT_MANAGED_START}\n${content.trimEnd()}\n${BLUEPRINT_MANAGED_END}\n`;
}

function upsertManagedSection(base: string, nextSection: string): string {
  const trimmedBase = base.trimEnd();
  const replacement = managedSection(nextSection).trimEnd();
  if (
    trimmedBase.includes(BLUEPRINT_MANAGED_START) &&
    trimmedBase.includes(BLUEPRINT_MANAGED_END)
  ) {
    const start = trimmedBase.indexOf(BLUEPRINT_MANAGED_START);
    const end = trimmedBase.indexOf(BLUEPRINT_MANAGED_END);
    const after = end >= 0 ? trimmedBase.slice(end + BLUEPRINT_MANAGED_END.length) : "";
    const before = start >= 0 ? trimmedBase.slice(0, start).trimEnd() : trimmedBase;
    return `${before}\n\n${replacement}${after ? `\n${after.trimStart()}` : ""}\n`;
  }
  return trimmedBase ? `${trimmedBase}\n\n${replacement}\n` : `${replacement}\n`;
}

function buildBulletList(values: string[]): string[] {
  return values.map((value) => `- ${value}`);
}

function summarizeSourceEntry(source: BlueprintSourceEntry) {
  return `${source.kind}: ${source.value}`;
}

function buildAgentsSection(bundle: AgentBlueprintBundle, plan: AgentBlueprintPlan): string {
  const lines = [
    "## Easyclaw Blueprint",
    "",
    `- Template: ${bundle.manifest.displayName} (\`${bundle.manifest.templateId}\`)`,
    `- Summary: ${bundle.manifest.summary}`,
    `- Interaction mode: ${plan.routing.interactionMode ?? "unspecified"}`,
    `- Delivery: ${plan.delivery.mode ?? "unspecified"}${plan.delivery.targetSummary ? ` -> ${plan.delivery.targetSummary}` : ""}`,
    `- Memory mode: ${plan.workspace.memoryMode ?? "default"}`,
  ];

  if (plan.routing.sources.length > 0) {
    lines.push(
      "",
      "### Scheduled Sources",
      ...buildBulletList(plan.routing.sources.map(summarizeSourceEntry)),
    );
  }
  if (bundle.safety) {
    lines.push(
      "",
      "### Safety Defaults",
      ...buildBulletList(
        [
          bundle.safety.externalActionPolicy
            ? `External actions: ${bundle.safety.externalActionPolicy}`
            : "",
          bundle.safety.configWritePolicy
            ? `Config writes: ${bundle.safety.configWritePolicy}`
            : "",
          bundle.safety.responseScope ? `Response scope: ${bundle.safety.responseScope}` : "",
          ...(bundle.safety.escalationRules ?? []).map((rule) => `Escalation: ${rule}`),
        ].filter(Boolean),
      ),
    );
  }
  if (plan.validation.successCriteria.length > 0) {
    lines.push("", "### Success Criteria", ...buildBulletList(plan.validation.successCriteria));
  }
  return lines.join("\n");
}

function buildSoulSection(bundle: AgentBlueprintBundle): string {
  const lines = [
    "## Easyclaw Blueprint Persona",
    "",
    `- Role: ${bundle.manifest.summary}`,
    `- Name: ${bundle.agent.name}`,
  ];
  if (bundle.agent.identity?.vibe) {
    lines.push(`- Vibe: ${bundle.agent.identity.vibe}`);
  }
  if (bundle.agent.identity?.emoji) {
    lines.push(`- Emoji: ${bundle.agent.identity.emoji}`);
  }
  return lines.join("\n");
}

function buildToolsSection(bundle: AgentBlueprintBundle, plan: AgentBlueprintPlan): string {
  const lines = [
    "## Easyclaw Blueprint Tooling",
    "",
    `- Profile: ${bundle.runtime.tools.profile}`,
    `- Thinking: ${bundle.runtime.thinking ?? "default"}`,
  ];
  if (bundle.runtime.skills?.length) {
    lines.push(`- Skills: ${bundle.runtime.skills.join(", ")}`);
  }
  if (bundle.runtime.tools.alsoAllow?.length) {
    lines.push(`- Additional allow: ${bundle.runtime.tools.alsoAllow.join(", ")}`);
  }
  if (bundle.runtime.subagents) {
    lines.push(
      `- Subagents: ${bundle.runtime.subagents.enabled ? "enabled" : "disabled"}${
        bundle.runtime.subagents.mode ? ` (${bundle.runtime.subagents.mode})` : ""
      }`,
    );
  }
  if (plan.runtime.tools.customAllow.length > 0) {
    lines.push(`- Custom allow: ${plan.runtime.tools.customAllow.join(", ")}`);
  }
  return lines.join("\n");
}

function buildIdentitySection(bundle: AgentBlueprintBundle): string {
  const lines = [
    "## Easyclaw Blueprint Identity",
    "",
    `- **Name:** ${bundle.agent.name}`,
    "- **Creature:** OpenClaw agent",
  ];
  if (bundle.agent.identity?.vibe) {
    lines.push(`- **Vibe:** ${bundle.agent.identity.vibe}`);
  }
  if (bundle.agent.identity?.emoji) {
    lines.push(`- **Emoji:** ${bundle.agent.identity.emoji}`);
  }
  if (bundle.agent.identity?.avatar) {
    lines.push(`- **Avatar:** ${bundle.agent.identity.avatar}`);
  }
  return lines.join("\n");
}

function buildHeartbeatSection(bundle: AgentBlueprintBundle): string | null {
  const instructions = bundle.workspace.heartbeatInstructions?.trim();
  if (!instructions) {
    return null;
  }
  return ["## Easyclaw Blueprint Checklist", "", `- ${instructions}`].join("\n");
}

function buildUserSection(bundle: AgentBlueprintBundle): string {
  return [
    "## Easyclaw Blueprint Context",
    "",
    `- Intended role: ${bundle.manifest.displayName}`,
    "- Fill this file in with real owner or team context as you learn it.",
  ].join("\n");
}

function buildMemorySection(plan: AgentBlueprintPlan): string {
  const lines = [
    "## Easyclaw Blueprint Memory Strategy",
    "",
    `- Memory mode: ${plan.workspace.memoryMode ?? "default"}`,
  ];
  if (plan.routing.sources.length > 0) {
    lines.push(`- Source context: ${plan.routing.sources.map(summarizeSourceEntry).join(", ")}`);
  }
  if (plan.validation.successCriteria.length > 0) {
    lines.push(`- Success criteria to remember: ${plan.validation.successCriteria.join("; ")}`);
  }
  return lines.join("\n");
}

function defaultWorkspaceFileContent(name: string): string {
  if (name === "MEMORY.md") {
    return "# MEMORY.md\n\nCapture durable, curated memory here.\n";
  }
  if (name === "memory.md") {
    return "# memory.md\n\nScratchpad memory.\n";
  }
  if (name === "BOOTSTRAP.md") {
    return "# BOOTSTRAP.md\n\nGenerated by easyclaw blueprint apply.\n";
  }
  return `# ${name}\n`;
}

async function loadTemplateFileContent(name: string): Promise<string> {
  const templateDir = await resolveWorkspaceTemplateDir();
  const templatePath = path.join(templateDir, name);
  try {
    return stripFrontMatter(await fs.readFile(templatePath, "utf-8"));
  } catch {
    return defaultWorkspaceFileContent(name);
  }
}

function buildWorkspaceManagedSection(params: {
  fileName: string;
  bundle: AgentBlueprintBundle;
  plan: AgentBlueprintPlan;
}): string | null {
  if (params.fileName === "AGENTS.md") {
    return buildAgentsSection(params.bundle, params.plan);
  }
  if (params.fileName === "SOUL.md") {
    return buildSoulSection(params.bundle);
  }
  if (params.fileName === "TOOLS.md") {
    return buildToolsSection(params.bundle, params.plan);
  }
  if (params.fileName === "IDENTITY.md") {
    return buildIdentitySection(params.bundle);
  }
  if (params.fileName === "HEARTBEAT.md") {
    return buildHeartbeatSection(params.bundle);
  }
  if (params.fileName === "USER.md") {
    return buildUserSection(params.bundle);
  }
  if (params.fileName === "MEMORY.md") {
    return buildMemorySection(params.plan);
  }
  return null;
}

export function previewAgentBlueprintManagedWorkspaceDocs(params: {
  bundle: AgentBlueprintBundle;
  plan: AgentBlueprintPlan;
  managedSectionOverrides?: Record<string, string>;
}): AgentBlueprintManagedWorkspaceDocPreview[] {
  return params.plan.workspace.bootstrapFiles
    .map((file) => {
      const content =
        params.managedSectionOverrides?.[file.name] ??
        buildWorkspaceManagedSection({
          fileName: file.name,
          bundle: params.bundle,
          plan: params.plan,
        });
      return content ? { name: file.name, content } : null;
    })
    .filter((entry): entry is AgentBlueprintManagedWorkspaceDocPreview => Boolean(entry));
}

function pickAgentEntry(cfg: OpenClawConfig, agentId: string) {
  const list = listAgentEntries(cfg);
  const index = findAgentEntryIndex(list, agentId);
  return {
    list,
    index,
    entry: index >= 0 ? list[index] : undefined,
  };
}

function buildBlueprintAgentEntry(params: {
  entry?: AgentEntry;
  bundle: AgentBlueprintBundle;
  plan: AgentBlueprintPlan;
}): AgentEntry {
  const { entry, bundle, plan } = params;
  const preservedTools = entry?.tools
    ? {
        ...(entry.tools.elevated ? { elevated: entry.tools.elevated } : {}),
        ...(entry.tools.exec ? { exec: entry.tools.exec } : {}),
        ...(entry.tools.fs ? { fs: entry.tools.fs } : {}),
        ...(entry.tools.loopDetection ? { loopDetection: entry.tools.loopDetection } : {}),
        ...(entry.tools.sandbox ? { sandbox: entry.tools.sandbox } : {}),
      }
    : undefined;

  return {
    ...(entry ?? { id: plan.agent.agentId }),
    id: plan.agent.agentId,
    name: plan.agent.name,
    workspace: plan.agent.workspaceDir,
    agentDir: plan.agent.agentDir,
    ...(plan.agent.modelSelection.mode === "explicit" && plan.agent.modelSelection.value
      ? { model: plan.agent.modelSelection.value }
      : {}),
    skills: bundle.runtime.skills?.length ? [...bundle.runtime.skills] : undefined,
    identity: {
      ...(bundle.agent.name ? { name: bundle.agent.name } : {}),
      ...(bundle.agent.identity?.emoji ? { emoji: bundle.agent.identity.emoji } : {}),
      ...(bundle.agent.identity?.avatar ? { avatar: bundle.agent.identity.avatar } : {}),
    },
    tools: {
      ...preservedTools,
      profile: bundle.runtime.tools.profile,
      ...(bundle.runtime.tools.alsoAllow?.length
        ? { alsoAllow: [...bundle.runtime.tools.alsoAllow] }
        : {}),
      ...(bundle.runtime.tools.byProvider
        ? { byProvider: structuredClone(bundle.runtime.tools.byProvider) }
        : {}),
    },
    subagents: bundle.runtime.subagents?.enabled ? { allowAgents: ["*"] } : undefined,
  };
}

function applyBlueprintManagedAgentFields(params: {
  cfg: OpenClawConfig;
  bundle: AgentBlueprintBundle;
  plan: AgentBlueprintPlan;
  warnings: AgentBlueprintApplyWarning[];
}): OpenClawConfig {
  const { cfg, bundle, plan, warnings } = params;
  let next = applyAgentConfig(cfg, {
    agentId: plan.agent.agentId,
    name: plan.agent.name,
    workspace: plan.agent.workspaceDir,
    agentDir: plan.agent.agentDir,
    ...(plan.agent.modelSelection.mode === "explicit" && plan.agent.modelSelection.value
      ? { model: plan.agent.modelSelection.value }
      : {}),
  });

  const { list, index, entry } = pickAgentEntry(next, plan.agent.agentId);
  const nextEntry = buildBlueprintAgentEntry({
    entry,
    bundle,
    plan,
  });

  if (bundle.runtime.subagents?.mode) {
    warnings.push({
      code: "subagent-mode-not-materialized",
      message:
        "Blueprint subagent mode is recorded in workspace instructions, but agent config only materializes the allowlist.",
    });
  }
  if (bundle.runtime.sandbox?.enabled !== undefined) {
    warnings.push({
      code: "sandbox-not-materialized",
      message:
        "Blueprint sandbox intent is not yet mapped into agent sandbox config and was left unchanged.",
    });
  }

  const nextList = [...list];
  if (index >= 0) {
    nextList[index] = nextEntry;
  } else {
    nextList.push(nextEntry);
  }
  next = {
    ...next,
    agents: {
      ...next.agents,
      list: nextList,
    },
  };

  return next;
}

function ensureBlueprintAgentListed(params: {
  cfg: OpenClawConfig;
  bundle: AgentBlueprintBundle;
  plan: AgentBlueprintPlan;
}): OpenClawConfig {
  const { list, index, entry } = pickAgentEntry(params.cfg, params.plan.agent.agentId);
  if (index >= 0 && entry) {
    return params.cfg;
  }

  const nextList = [...list];
  if (nextList.length === 0) {
    const defaultAgentId = normalizeAgentId(resolveDefaultAgentId(params.cfg));
    if (defaultAgentId !== normalizeAgentId(params.plan.agent.agentId)) {
      nextList.push({ id: defaultAgentId });
    }
  }
  nextList.push(
    buildBlueprintAgentEntry({
      bundle: params.bundle,
      plan: params.plan,
    }),
  );
  return {
    ...params.cfg,
    agents: {
      ...params.cfg.agents,
      list: nextList,
    },
  };
}

function bindingKey(binding: AgentRouteBinding): string {
  return `${normalizeAgentId(binding.agentId)}|${describeBinding(binding)}`;
}

function readMetadataBindingKey(binding: AgentRouteBinding): string {
  return bindingKey(binding);
}

async function readBlueprintMetadata(
  metadataPath: string,
): Promise<ManagedBlueprintMetadata | null> {
  try {
    const raw = await fs.readFile(metadataPath, "utf-8");
    const parsed = JSON.parse(raw) as ManagedBlueprintMetadata;
    if (!parsed || typeof parsed !== "object" || parsed.version !== 1) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writeBlueprintMetadata(
  metadataPath: string,
  metadata: ManagedBlueprintMetadata,
): Promise<void> {
  await fs.mkdir(path.dirname(metadataPath), { recursive: true });
  await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf-8");
}

function createCronServiceForApply(cfg: OpenClawConfig) {
  return new CronService({
    storePath: resolveCronStorePath(cfg.cron?.store),
    cronEnabled: cfg.cron?.enabled !== false,
    defaultAgentId: resolveDefaultAgentId(cfg),
    log: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    enqueueSystemEvent: () => {},
    requestHeartbeatNow: () => {},
    runIsolatedAgentJob: async () => ({
      status: "skipped" as const,
    }),
  });
}

function sanitizeCronSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "job";
}

function buildCronMessage(plan: AgentBlueprintPlan, schedule: BlueprintScheduleEntry): string {
  const agentLabel = plan.agent.name?.trim() || plan.manifest.displayName;
  const lines = [
    `Complete the scheduled task for "${agentLabel}" now.`,
    schedule.purpose,
    `Follow the workspace instructions in ${plan.agent.workspaceDir}.`,
  ];
  if (plan.routing.sources.length > 0) {
    lines.push(
      `Review these configured sources before responding: ${plan.routing.sources.map(summarizeSourceEntry).join(", ")}.`,
    );
  }
  if (plan.delivery.targetSummary) {
    lines.push(`Deliver the final result for ${plan.delivery.targetSummary}.`);
  }
  if (plan.validation.successCriteria.length > 0) {
    lines.push(`Success criteria: ${plan.validation.successCriteria.join("; ")}.`);
  }
  return lines.join(" ");
}

function buildCronJobCreate(params: {
  plan: AgentBlueprintPlan;
  schedule: BlueprintScheduleEntry;
  model: string;
}): CronJobCreate {
  const target = params.plan.delivery.target;
  const sessionTarget = target?.session?.trim()
    ? (`session:${target.session.trim()}` as const)
    : "isolated";
  const delivery =
    target?.channel?.trim() || target?.to?.trim()
      ? {
          mode: "announce" as const,
          ...(target?.channel?.trim() ? { channel: target.channel.trim() } : {}),
          ...(target?.to?.trim() ? { to: target.to.trim() } : {}),
        }
      : { mode: "none" as const };

  return {
    name: `easyclaw:${params.plan.agent.agentId}:${sanitizeCronSlug(params.schedule.name)}`,
    description: params.schedule.purpose,
    enabled: true,
    agentId: params.plan.agent.agentId,
    schedule: {
      kind: "cron",
      expr: params.schedule.schedule,
      ...(params.schedule.timezone?.trim() ? { tz: params.schedule.timezone.trim() } : {}),
    },
    sessionTarget,
    wakeMode: "next-heartbeat",
    payload: {
      kind: "agentTurn",
      message: buildCronMessage(params.plan, params.schedule),
      model: params.model,
      ...(params.plan.runtime.thinking ? { thinking: params.plan.runtime.thinking } : {}),
      deliver: delivery.mode === "announce",
      ...(delivery.mode === "announce" && typeof delivery.channel === "string"
        ? { channel: delivery.channel }
        : {}),
      ...(delivery.mode === "announce" && typeof delivery.to === "string"
        ? { to: delivery.to }
        : {}),
    },
    delivery,
  };
}

function toCronPatch(input: CronJobCreate): CronJobPatch {
  return {
    agentId: input.agentId,
    sessionKey: input.sessionKey,
    name: input.name,
    description: input.description,
    enabled: input.enabled,
    deleteAfterRun: input.deleteAfterRun,
    schedule: input.schedule,
    sessionTarget: input.sessionTarget,
    wakeMode: input.wakeMode,
    payload: input.payload,
    delivery: input.delivery,
    failureAlert: input.failureAlert,
  };
}

async function materializeWorkspaceFiles(params: {
  bundle: AgentBlueprintBundle;
  plan: AgentBlueprintPlan;
  managedSectionOverrides?: Record<string, string>;
  extraManagedWorkspaceDocs?: AgentBlueprintManagedWorkspaceDocPreview[];
}): Promise<AgentBlueprintWorkspaceFileResult[]> {
  await ensureAgentWorkspace({
    dir: params.plan.agent.workspaceDir,
    ensureBootstrapFiles: false,
  });
  await fs.mkdir(params.plan.agent.agentDir, { recursive: true });
  await fs.mkdir(resolveSessionTranscriptsDirForAgent(params.plan.agent.agentId), {
    recursive: true,
  });
  await fs.mkdir(path.join(params.plan.agent.workspaceDir, MEMORY_DIRNAME), { recursive: true });

  const results: AgentBlueprintWorkspaceFileResult[] = [];
  const writtenFiles = new Set<string>();
  for (const file of params.plan.workspace.bootstrapFiles) {
    const filePath = path.join(params.plan.agent.workspaceDir, file.name);
    const managed =
      params.managedSectionOverrides?.[file.name] ??
      buildWorkspaceManagedSection({
        fileName: file.name,
        bundle: params.bundle,
        plan: params.plan,
      });
    let existing: string | null = null;
    try {
      existing = await fs.readFile(filePath, "utf-8");
    } catch {
      existing = null;
    }
    const base = existing ?? (await loadTemplateFileContent(file.name));
    const next = managed ? upsertManagedSection(base, managed) : base;
    const status = existing === null ? "created" : existing === next ? "unchanged" : "updated";
    if (existing !== next) {
      await fs.writeFile(filePath, next, "utf-8");
    }
    results.push({
      name: file.name,
      path: filePath,
      status,
    });
    writtenFiles.add(file.name);
  }

  for (const doc of params.extraManagedWorkspaceDocs ?? []) {
    if (!doc.name.trim() || !doc.content.trim() || writtenFiles.has(doc.name)) {
      continue;
    }
    const filePath = path.join(params.plan.agent.workspaceDir, doc.name);
    let existing: string | null = null;
    try {
      existing = await fs.readFile(filePath, "utf-8");
    } catch {
      existing = null;
    }
    const next =
      existing === null
        ? `${managedSection(doc.content).trimEnd()}\n`
        : upsertManagedSection(existing, doc.content);
    const status = existing === null ? "created" : existing === next ? "unchanged" : "updated";
    if (existing !== next) {
      await fs.writeFile(filePath, next, "utf-8");
    }
    results.push({
      name: doc.name,
      path: filePath,
      status,
    });
  }

  return results;
}

export async function applyAgentBlueprint(params: {
  loaded: LoadedAgentBlueprint;
  variables?: AgentBlueprintVariableMap;
  cron?: CronService;
  workspaceManagedSections?: Record<string, string>;
  extraManagedWorkspaceDocs?: AgentBlueprintManagedWorkspaceDocPreview[];
}): Promise<AgentBlueprintApplyResult> {
  const resolved = resolveAgentBlueprintVariables({
    bundle: params.loaded.bundle,
    variables: params.variables,
  });
  if (resolved.unresolved.length > 0) {
    throw new Error(
      `Blueprint requires values for: ${resolved.unresolved.map((name) => `"${name}"`).join(", ")}.`,
    );
  }

  const { snapshot, writeOptions } = await readConfigFileSnapshotForWrite();
  if (snapshot.exists && !snapshot.valid) {
    throw new Error("Config is invalid. Fix it before applying a blueprint.");
  }

  const plan = await compileAgentBlueprintPlan({
    bundle: resolved.bundle,
    cfg: snapshot.config,
    source: {
      kind: params.loaded.kind,
      value: params.loaded.source,
      format: params.loaded.format,
    },
  });
  if (plan.status === "invalid") {
    throw new Error(
      `Blueprint plan is invalid:\n${plan.issues
        .map((issue) => `- ${issue.code}: ${issue.message}`)
        .join("\n")}`,
    );
  }

  const warnings: AgentBlueprintApplyWarning[] = [];
  let nextConfig = applyBlueprintManagedAgentFields({
    cfg: snapshot.config,
    bundle: resolved.bundle,
    plan,
    warnings,
  });

  const metadataPath = path.join(plan.agent.agentDir, BLUEPRINT_METADATA_FILENAME);
  const previousMetadata = await readBlueprintMetadata(metadataPath);
  const ignoredBindings: string[] = [];
  const desiredBindings = plan.routing.bindings.flatMap(({ requested, routeBinding }) => {
    if (requested.channel === "default") {
      ignoredBindings.push(requested.channel);
      warnings.push({
        code: "binding-default-skipped",
        message:
          'Blueprint binding channel "default" is conceptual and was not written into routing config.',
      });
      return [];
    }
    if (!routeBinding) {
      ignoredBindings.push(requested.channel);
      warnings.push({
        code: requested.thread ? "binding-thread-skipped" : "binding-default-skipped",
        message: requested.thread
          ? `Binding "${requested.channel}" requested thread-aware routing, which is not materialized yet.`
          : `Binding "${requested.channel}" could not be converted into a route binding.`,
      });
      return [];
    }
    return [routeBinding];
  });

  const desiredBindingKeys = new Set(desiredBindings.map(bindingKey));
  const staleBindings = (previousMetadata?.managedBindings ?? []).filter(
    (binding) => !desiredBindingKeys.has(readMetadataBindingKey(binding)),
  );
  const removeResult =
    staleBindings.length > 0 ? removeAgentBindings(nextConfig, staleBindings) : undefined;
  if (removeResult) {
    nextConfig = removeResult.config;
  }

  const bindingResult =
    desiredBindings.length > 0
      ? applyAgentBindings(nextConfig, desiredBindings)
      : { config: nextConfig, added: [], updated: [], skipped: [], conflicts: [] };
  nextConfig = bindingResult.config;

  if (plan.routing.sources.length > 0) {
    warnings.push({
      code: "ingress-sources-not-materialized",
      message:
        "Ingress sources are documented in the workspace and cron prompts, but they do not yet create separate source bindings.",
    });
  }

  const workspaceFiles = await materializeWorkspaceFiles({
    bundle: resolved.bundle,
    plan,
    ...(params.workspaceManagedSections
      ? { managedSectionOverrides: params.workspaceManagedSections }
      : {}),
    ...(params.extraManagedWorkspaceDocs?.length
      ? { extraManagedWorkspaceDocs: params.extraManagedWorkspaceDocs }
      : {}),
  });
  // Ensure per-agent auth store is initialized and inherits main credentials when available.
  ensureAuthProfileStore(plan.agent.agentDir, { allowKeychainPrompt: false });
  nextConfig = ensureBlueprintAgentListed({
    cfg: nextConfig,
    bundle: resolved.bundle,
    plan,
  });

  await writeConfigFile(nextConfig, writeOptions);

  const cron = params.cron ?? createCronServiceForApply(nextConfig);
  const existingJobs = await cron.list({ includeDisabled: true });
  const automationJobs: AgentBlueprintApplyResult["automation"]["jobs"] = [];
  const resolvedCronModelRef = resolveDefaultModelForAgent({
    cfg: nextConfig,
    agentId: plan.agent.agentId,
  });
  const pinnedCronModel = `${resolvedCronModelRef.provider}/${resolvedCronModelRef.model}`;
  if (nextConfig.cron?.enabled === false && plan.automation.schedules.length > 0) {
    warnings.push({
      code: "cron-disabled",
      message:
        "Cron is disabled in config. Jobs were written to the cron store but will not run until cron is enabled.",
    });
  }

  for (const schedule of plan.automation.schedules) {
    const input = buildCronJobCreate({ plan, schedule, model: pinnedCronModel });
    if (input.sessionTarget.startsWith("session:") && input.delivery?.mode !== "none") {
      warnings.push({
        code: "delivery-target-session-only",
        message: `Schedule "${schedule.name}" targets a session explicitly. Delivery remains session-local unless a channel target is also configured.`,
      });
    }
    const existing = existingJobs.find((job) => job.name === input.name);
    if (existing) {
      const updated = await cron.update(existing.id, toCronPatch(input));
      automationJobs.push({
        name: updated.name,
        id: updated.id,
        status: "updated",
      });
      continue;
    }
    const created = await cron.add(input);
    automationJobs.push({
      name: created.name,
      id: created.id,
      status: "created",
    });
  }

  const desiredCronJobNames = new Set(automationJobs.map((job) => job.name));
  for (const stale of previousMetadata?.cronJobs ?? []) {
    if (desiredCronJobNames.has(stale.name)) {
      continue;
    }
    const existing = (await cron.list({ includeDisabled: true })).find(
      (job) => job.id === stale.id || job.name === stale.name,
    );
    if (!existing) {
      continue;
    }
    const removed = await cron.remove(existing.id);
    if (removed.ok && removed.removed) {
      automationJobs.push({
        name: existing.name,
        id: existing.id,
        status: "removed",
      });
    }
  }

  const metadata: ManagedBlueprintMetadata = {
    version: 1,
    manifest: resolved.bundle.manifest,
    source: {
      kind: params.loaded.kind,
      value: params.loaded.source,
      format: params.loaded.format,
    },
    appliedAt: new Date().toISOString(),
    templateVariables: {
      values: params.variables ?? {},
      resolved: resolved.resolved,
    },
    managedBindings: desiredBindings,
    cronJobs: automationJobs
      .filter((job) => job.status !== "removed")
      .map((job) => ({ name: job.name, id: job.id })),
    workspaceFiles: workspaceFiles.map((file) => file.name),
  };
  await writeBlueprintMetadata(metadataPath, metadata);

  for (const conflict of bindingResult.conflicts) {
    warnings.push({
      code: "binding-conflict",
      message: `Binding ${describeBinding(conflict.binding)} is already owned by agent "${conflict.existingAgentId}".`,
    });
  }

  return {
    status: "applied",
    source: plan.source,
    plan,
    templateVariables: {
      values: params.variables ?? {},
      resolved: resolved.resolved,
    },
    configPath: snapshot.path,
    agent: {
      agentId: plan.agent.agentId,
      name: plan.agent.name,
      workspaceDir: plan.agent.workspaceDir,
      agentDir: plan.agent.agentDir,
    },
    workspace: {
      metadataPath,
      files: workspaceFiles,
    },
    bindings: {
      removed: removeResult?.removed.map(describeBinding) ?? [],
      added: bindingResult.added.map(describeBinding),
      updated: bindingResult.updated.map(describeBinding),
      skipped: bindingResult.skipped.map(describeBinding),
      conflicts: bindingResult.conflicts.map(
        (conflict) => `${describeBinding(conflict.binding)} (agent=${conflict.existingAgentId})`,
      ),
      ignored: ignoredBindings,
    },
    automation: {
      jobs: automationJobs,
    },
    warnings,
  };
}
