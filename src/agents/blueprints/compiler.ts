import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawConfig } from "../../config/config.js";
import type { AgentRouteBinding } from "../../config/types.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { resolveAgentDir, resolveAgentWorkspaceDir } from "../agent-scope.js";
import { isKnownCoreToolId } from "../tool-catalog.js";
import { resolveToolProfilePolicy, expandToolGroups } from "../tool-policy.js";
import { resolveWorkspaceTemplateDir } from "../workspace-templates.js";
import {
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_BOOTSTRAP_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_MEMORY_ALT_FILENAME,
  DEFAULT_MEMORY_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_USER_FILENAME,
  type WorkspaceBootstrapFileName,
} from "../workspace.js";
import type { AgentBlueprintBundle } from "./schema.js";

type BlueprintBinding = NonNullable<
  NonNullable<AgentBlueprintBundle["ingress"]>["bindings"]
>[number];
type BlueprintSource = NonNullable<NonNullable<AgentBlueprintBundle["ingress"]>["sources"]>[number];
type BlueprintSchedule = NonNullable<
  NonNullable<AgentBlueprintBundle["automation"]>["schedules"]
>[number];
type BlueprintDeliveryTarget = NonNullable<NonNullable<AgentBlueprintBundle["delivery"]>["target"]>;

const RECOGNIZED_BOOTSTRAP_FILES = new Set<WorkspaceBootstrapFileName>([
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_BOOTSTRAP_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_MEMORY_ALT_FILENAME,
  DEFAULT_MEMORY_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_USER_FILENAME,
]);

export type AgentBlueprintPlanIssue = {
  severity: "error" | "warning";
  code:
    | "delivery-target-missing"
    | "invalid-bootstrap-file"
    | "scheduled-without-schedule"
    | "bound-channel-without-binding"
    | "schedule-without-scheduled-mode"
    | "source-without-scheduled-mode"
    | "thread-binding-not-yet-materialized"
    | "subagent-mode-ignored";
  message: string;
};

export type CompiledBlueprintToolPolicy = {
  profile: string;
  allow: string[] | null;
  deny: string[];
  customAllow: string[];
  customDeny: string[];
  byProvider: Record<
    string,
    {
      profile?: string;
      allow: string[] | null;
      deny: string[];
      customAllow: string[];
      customDeny: string[];
    }
  >;
};

export type AgentBlueprintWorkspaceFilePlan = {
  name: string;
  templatePath: string;
  title: string | null;
  prefill: string[];
};

export type AgentBlueprintPlan = {
  source?: {
    kind: "template" | "file" | "builder";
    value: string;
    format: "json" | "yaml" | null;
  };
  manifest: AgentBlueprintBundle["manifest"];
  status: "ready" | "invalid";
  issues: AgentBlueprintPlanIssue[];
  agent: {
    agentId: string;
    name: string;
    workspaceDir: string;
    agentDir: string;
    modelSelection: {
      mode: "prompt-user" | "explicit";
      value?: string;
    };
    identity: AgentBlueprintBundle["agent"]["identity"];
  };
  workspace: {
    template?: string;
    memoryMode?: string;
    notes: string[];
    heartbeatInstructions?: string;
    bootstrapFiles: AgentBlueprintWorkspaceFilePlan[];
  };
  runtime: {
    thinking?: string;
    skills: string[];
    tools: CompiledBlueprintToolPolicy;
    subagents?: AgentBlueprintBundle["runtime"]["subagents"];
    sandbox?: AgentBlueprintBundle["runtime"]["sandbox"];
  };
  routing: {
    interactionMode?: string;
    bindings: Array<{
      requested: BlueprintBinding;
      routeBinding?: AgentRouteBinding;
      description: string;
    }>;
    sources: BlueprintSource[];
  };
  automation: {
    schedules: BlueprintSchedule[];
  };
  delivery: {
    mode?: string;
    format?: string;
    target?: BlueprintDeliveryTarget;
    targetSummary: string | null;
  };
  validation: {
    prerequisites: string[];
    readinessChecks: string[];
    smokePrompts: string[];
    successCriteria: string[];
  };
};

type BlueprintSourceInput = {
  kind: "template" | "file" | "builder";
  value: string;
  format: "json" | "yaml" | null;
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

function extractMarkdownTitle(content: string): string | null {
  const stripped = stripFrontMatter(content);
  for (const line of stripped.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("#")) {
      continue;
    }
    return trimmed.replace(/^#+\s*/, "") || null;
  }
  return null;
}

function summarizeTarget(target: BlueprintDeliveryTarget | undefined): string | null {
  if (!target) {
    return null;
  }
  if (target.session?.trim()) {
    return `session=${target.session.trim()}`;
  }
  const parts: string[] = [];
  if (target.channel?.trim()) {
    parts.push(`channel=${target.channel.trim()}`);
  }
  if (target.to?.trim()) {
    parts.push(`to=${target.to.trim()}`);
  }
  return parts.length > 0 ? parts.join(", ") : null;
}

function buildBindingDescription(binding: BlueprintBinding): string {
  const parts = [binding.channel];
  if (binding.accountId) {
    parts.push(`accountId=${binding.accountId}`);
  }
  if (binding.peer) {
    parts.push(`peer=${binding.peer}`);
  }
  if (binding.thread) {
    parts.push("thread=true");
  }
  return parts.join(" ");
}

function buildRouteBinding(agentId: string, binding: BlueprintBinding): AgentRouteBinding {
  return {
    type: "route",
    agentId,
    match: {
      channel: binding.channel,
      ...(binding.accountId ? { accountId: binding.accountId } : {}),
      ...(binding.peer ? { peer: { kind: "direct", id: binding.peer } } : {}),
    },
  };
}

function splitKnownTools(list: string[] | undefined): { core: string[]; custom: string[] } {
  const expanded = expandToolGroups(list);
  const core: string[] = [];
  const custom: string[] = [];
  for (const entry of expanded) {
    if (isKnownCoreToolId(entry)) {
      core.push(entry);
      continue;
    }
    custom.push(entry);
  }
  return {
    core: Array.from(new Set(core)),
    custom: Array.from(new Set(custom)),
  };
}

function compileToolPolicy(runtime: AgentBlueprintBundle["runtime"]): CompiledBlueprintToolPolicy {
  const basePolicy = resolveToolProfilePolicy(runtime.tools.profile);
  const allow =
    basePolicy?.allow || runtime.tools.alsoAllow?.length
      ? splitKnownTools([...(basePolicy?.allow ?? []), ...(runtime.tools.alsoAllow ?? [])])
      : { core: [], custom: [] };
  const deny = splitKnownTools(basePolicy?.deny);

  const byProvider = Object.fromEntries(
    Object.entries(runtime.tools.byProvider ?? {}).map(([provider, override]) => {
      const policy = resolveToolProfilePolicy(override.profile);
      const overrideAllow =
        policy?.allow || override.alsoAllow?.length
          ? splitKnownTools([...(policy?.allow ?? []), ...(override.alsoAllow ?? [])])
          : { core: [], custom: [] };
      const overrideDeny = splitKnownTools(policy?.deny ?? override.deny);
      return [
        provider,
        {
          ...(override.profile ? { profile: override.profile } : {}),
          allow: policy?.allow || override.alsoAllow?.length ? overrideAllow.core : null,
          deny: overrideDeny.core,
          customAllow: overrideAllow.custom,
          customDeny: overrideDeny.custom,
        },
      ];
    }),
  );

  return {
    profile: runtime.tools.profile,
    allow: basePolicy?.allow || runtime.tools.alsoAllow?.length ? allow.core : null,
    deny: deny.core,
    customAllow: allow.custom,
    customDeny: deny.custom,
    byProvider,
  };
}

function collectPlanIssues(bundle: AgentBlueprintBundle): AgentBlueprintPlanIssue[] {
  const issues: AgentBlueprintPlanIssue[] = [];
  const interactionMode = bundle.ingress?.interactionMode;
  const schedules = bundle.automation?.schedules ?? [];
  const bindings = bundle.ingress?.bindings ?? [];
  const sources = bundle.ingress?.sources ?? [];
  const needsDeliveryTarget =
    interactionMode === "scheduled" &&
    bundle.delivery?.mode &&
    bundle.delivery.mode !== "reply" &&
    !bundle.delivery.target;

  for (const fileName of bundle.workspace.bootstrapFiles ?? []) {
    if (!RECOGNIZED_BOOTSTRAP_FILES.has(fileName as WorkspaceBootstrapFileName)) {
      issues.push({
        severity: "error",
        code: "invalid-bootstrap-file",
        message: `Unsupported workspace bootstrap file "${fileName}".`,
      });
    }
  }

  if (interactionMode === "scheduled" && schedules.length === 0) {
    issues.push({
      severity: "error",
      code: "scheduled-without-schedule",
      message: "Scheduled agents need at least one automation schedule.",
    });
  }

  if (interactionMode === "bound-channel" && bindings.length === 0) {
    issues.push({
      severity: "error",
      code: "bound-channel-without-binding",
      message: "Bound-channel agents need at least one routing binding.",
    });
  }

  if (schedules.length > 0 && interactionMode !== "scheduled" && interactionMode !== "hybrid") {
    issues.push({
      severity: "warning",
      code: "schedule-without-scheduled-mode",
      message: "Schedules are configured, but the interaction mode is not scheduled or hybrid.",
    });
  }

  if (sources.length > 0 && interactionMode !== "scheduled" && interactionMode !== "hybrid") {
    issues.push({
      severity: "warning",
      code: "source-without-scheduled-mode",
      message: "Sources are configured, but the interaction mode is not scheduled or hybrid.",
    });
  }

  if (needsDeliveryTarget) {
    issues.push({
      severity: "error",
      code: "delivery-target-missing",
      message:
        "Scheduled digest/report/announce agents need an explicit delivery target in the blueprint.",
    });
  }

  for (const binding of bindings) {
    if (binding.thread) {
      issues.push({
        severity: "warning",
        code: "thread-binding-not-yet-materialized",
        message:
          "Thread-aware bindings are preserved in the plan but do not yet map to route config output.",
      });
      break;
    }
  }

  if (bundle.runtime.subagents?.enabled === false && bundle.runtime.subagents.mode) {
    issues.push({
      severity: "warning",
      code: "subagent-mode-ignored",
      message: "Subagent mode is set even though subagents are disabled.",
    });
  }

  return issues;
}

function buildWorkspacePrefill(bundle: AgentBlueprintBundle, fileName: string): string[] {
  if (fileName === DEFAULT_IDENTITY_FILENAME) {
    const lines = [`Name: ${bundle.agent.name}`];
    if (bundle.agent.identity?.vibe) {
      lines.push(`Vibe: ${bundle.agent.identity.vibe}`);
    }
    if (bundle.agent.identity?.emoji) {
      lines.push(`Emoji: ${bundle.agent.identity.emoji}`);
    }
    if (bundle.agent.identity?.avatar) {
      lines.push(`Avatar: ${bundle.agent.identity.avatar}`);
    }
    return lines;
  }

  if (fileName === DEFAULT_HEARTBEAT_FILENAME && bundle.workspace.heartbeatInstructions?.trim()) {
    return [bundle.workspace.heartbeatInstructions.trim()];
  }

  if (fileName === DEFAULT_AGENTS_FILENAME && bundle.workspace.notes?.length) {
    return [...bundle.workspace.notes];
  }

  return [];
}

async function buildWorkspaceFilePlans(
  bundle: AgentBlueprintBundle,
): Promise<AgentBlueprintWorkspaceFilePlan[]> {
  const templateDir = await resolveWorkspaceTemplateDir();
  const bootstrapFiles = bundle.workspace.bootstrapFiles ?? [];

  return await Promise.all(
    bootstrapFiles.map(async (fileName) => {
      const templatePath = path.join(templateDir, fileName);
      let title: string | null = null;
      try {
        const raw = await fs.readFile(templatePath, "utf-8");
        title = extractMarkdownTitle(raw);
      } catch {
        title = null;
      }
      return {
        name: fileName,
        templatePath,
        title,
        prefill: buildWorkspacePrefill(bundle, fileName),
      };
    }),
  );
}

export async function compileAgentBlueprintPlan(params: {
  bundle: AgentBlueprintBundle;
  cfg?: OpenClawConfig;
  source?: BlueprintSourceInput;
}): Promise<AgentBlueprintPlan> {
  const bundle = structuredClone(params.bundle);
  const agentId = normalizeAgentId(bundle.agent.agentId);
  const cfg = params.cfg ?? {};
  const issues = collectPlanIssues(bundle);
  const bindings = (bundle.ingress?.bindings ?? []).map((binding) => ({
    requested: binding,
    routeBinding: binding.thread ? undefined : buildRouteBinding(agentId, binding),
    description: buildBindingDescription(binding),
  }));
  const workspaceFiles = await buildWorkspaceFilePlans(bundle);
  const explicitModel = bundle.runtime.model?.trim();

  return {
    ...(params.source ? { source: params.source } : {}),
    manifest: bundle.manifest,
    status: issues.some((issue) => issue.severity === "error") ? "invalid" : "ready",
    issues,
    agent: {
      agentId,
      name: bundle.agent.name,
      workspaceDir: resolveAgentWorkspaceDir(cfg, agentId),
      agentDir: resolveAgentDir(cfg, agentId),
      modelSelection:
        explicitModel && explicitModel !== "user-selected"
          ? { mode: "explicit", value: explicitModel }
          : { mode: "prompt-user" },
      identity: bundle.agent.identity,
    },
    workspace: {
      template: bundle.workspace.template,
      memoryMode: bundle.workspace.memoryMode,
      notes: [...(bundle.workspace.notes ?? [])],
      heartbeatInstructions: bundle.workspace.heartbeatInstructions,
      bootstrapFiles: workspaceFiles,
    },
    runtime: {
      thinking: bundle.runtime.thinking,
      skills: [...(bundle.runtime.skills ?? [])],
      tools: compileToolPolicy(bundle.runtime),
      subagents: bundle.runtime.subagents,
      sandbox: bundle.runtime.sandbox,
    },
    routing: {
      interactionMode: bundle.ingress?.interactionMode,
      bindings,
      sources: [...(bundle.ingress?.sources ?? [])],
    },
    automation: {
      schedules: [...(bundle.automation?.schedules ?? [])],
    },
    delivery: {
      mode: bundle.delivery?.mode,
      format: bundle.delivery?.format,
      target: bundle.delivery?.target,
      targetSummary: summarizeTarget(bundle.delivery?.target),
    },
    validation: {
      prerequisites: [...(bundle.validation?.prerequisites ?? [])],
      readinessChecks: [...(bundle.validation?.readinessChecks ?? [])],
      smokePrompts: [...(bundle.validation?.smokePrompts ?? [])],
      successCriteria: [...(bundle.validation?.successCriteria ?? [])],
    },
  };
}
