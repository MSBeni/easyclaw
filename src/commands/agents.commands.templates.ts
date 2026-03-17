import {
  compileAgentBlueprintPlan,
  type AgentBlueprintPlan,
} from "../agents/blueprints/compiler.js";
import { loadAgentBlueprint, serializeAgentBlueprintBundle } from "../agents/blueprints/files.js";
import { applyAgentBlueprint } from "../agents/blueprints/materialize.js";
import {
  listAgentBlueprintCatalog,
  requireAgentBlueprintTemplate,
  type AgentBlueprintCatalogEntry,
} from "../agents/blueprints/registry.js";
import type { AgentBlueprintVariableMap } from "../agents/blueprints/variables.js";
import { resolveAgentBlueprintVariables } from "../agents/blueprints/variables.js";
import { readConfigFileSnapshot } from "../config/config.js";
import type { OpenClawConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import { shortenHomePath } from "../utils.js";

type AgentsTemplatesListOptions = {
  json?: boolean;
};

type AgentsTemplatesShowOptions = {
  templateId: string;
  json?: boolean;
};

type AgentsTemplatesPlanOptions = {
  input: string;
  set?: string[];
  json?: boolean;
};

type AgentsTemplatesApplyOptions = {
  input: string;
  set?: string[];
  yes?: boolean;
  json?: boolean;
};

type DisplayableBlueprintPlan = AgentBlueprintPlan & {
  templateVariables?: {
    resolved: string[];
    unresolved: string[];
  };
};

function formatCatalogSection(label: string, entries: AgentBlueprintCatalogEntry[]): string[] {
  if (entries.length === 0) {
    return [];
  }
  return [
    `${label}:`,
    ...entries.map(
      (entry) =>
        `- ${entry.templateId} (${entry.displayName})${entry.tags.length > 0 ? ` [${entry.tags.join(", ")}]` : ""}\n  ${entry.summary}`,
    ),
  ];
}

function formatListOutput(entries: AgentBlueprintCatalogEntry[]): string {
  const starters = entries.filter((entry) => entry.tier === "starter");
  const stretch = entries.filter((entry) => entry.tier === "stretch");
  return [
    "Agent blueprint templates:",
    ...formatCatalogSection("Starter", starters),
    ...formatCatalogSection("Stretch", stretch),
    'Use "openclaw agents templates show <template-id>" to inspect a starter blueprint.',
    'Use "openclaw agents templates plan <template-id|file>" for a dry-run execution plan.',
    'Use "openclaw agents templates apply <template-id|file> --yes" to materialize a blueprint.',
  ].join("\n");
}

function formatPlanIssues(plan: DisplayableBlueprintPlan): string[] {
  if (plan.issues.length === 0) {
    return ["Issues: none"];
  }
  return [
    "Issues:",
    ...plan.issues.map(
      (issue) => `- ${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`,
    ),
  ];
}

function formatPlanList(label: string, values: string[]): string[] {
  if (values.length === 0) {
    return [];
  }
  return [label, ...values.map((value) => `- ${value}`)];
}

export function formatAgentBlueprintPlan(plan: DisplayableBlueprintPlan): string {
  const lines = [
    `Blueprint plan: ${plan.manifest.displayName} (${plan.manifest.templateId})`,
    `Status: ${plan.status}`,
    `Summary: ${plan.manifest.summary}`,
  ];

  if (plan.source) {
    lines.push(
      `Source: ${plan.source.kind === "file" ? shortenHomePath(plan.source.value) : plan.source.value}`,
    );
  }
  if (plan.templateVariables) {
    const resolved =
      plan.templateVariables.resolved.length > 0
        ? plan.templateVariables.resolved.join(", ")
        : "none";
    const unresolved =
      plan.templateVariables.unresolved.length > 0
        ? plan.templateVariables.unresolved.join(", ")
        : "none";
    lines.push(`Template vars: resolved=${resolved}; unresolved=${unresolved}`);
  }

  lines.push(...formatPlanIssues(plan));

  lines.push("Agent:");
  lines.push(`- id: ${plan.agent.agentId}`);
  lines.push(`- name: ${plan.agent.name}`);
  lines.push(`- workspace: ${shortenHomePath(plan.agent.workspaceDir)}`);
  lines.push(`- agent dir: ${shortenHomePath(plan.agent.agentDir)}`);
  lines.push(
    `- model: ${
      plan.agent.modelSelection.mode === "explicit"
        ? plan.agent.modelSelection.value
        : "prompt user during apply"
    }`,
  );

  if (plan.agent.identity?.emoji || plan.agent.identity?.vibe || plan.agent.identity?.avatar) {
    lines.push("Identity:");
    if (plan.agent.identity.emoji) {
      lines.push(`- emoji: ${plan.agent.identity.emoji}`);
    }
    if (plan.agent.identity.vibe) {
      lines.push(`- vibe: ${plan.agent.identity.vibe}`);
    }
    if (plan.agent.identity.avatar) {
      lines.push(`- avatar: ${plan.agent.identity.avatar}`);
    }
  }

  lines.push("Runtime:");
  lines.push(`- thinking: ${plan.runtime.thinking ?? "default"}`);
  lines.push(`- tool profile: ${plan.runtime.tools.profile}`);
  if (plan.runtime.tools.allow) {
    lines.push(`- allow: ${plan.runtime.tools.allow.join(", ")}`);
  } else {
    lines.push("- allow: unrestricted");
  }
  if (plan.runtime.tools.customAllow.length > 0) {
    lines.push(`- custom allow: ${plan.runtime.tools.customAllow.join(", ")}`);
  }
  if (plan.runtime.tools.deny.length > 0) {
    lines.push(`- deny: ${plan.runtime.tools.deny.join(", ")}`);
  }
  if (plan.runtime.tools.customDeny.length > 0) {
    lines.push(`- custom deny: ${plan.runtime.tools.customDeny.join(", ")}`);
  }
  if (plan.runtime.skills.length > 0) {
    lines.push(`- skills: ${plan.runtime.skills.join(", ")}`);
  }
  if (plan.runtime.subagents) {
    lines.push(
      `- subagents: ${plan.runtime.subagents.enabled ? "enabled" : "disabled"}${
        plan.runtime.subagents.mode ? ` (${plan.runtime.subagents.mode})` : ""
      }`,
    );
  }
  if (plan.runtime.sandbox?.enabled !== undefined) {
    lines.push(`- sandbox: ${plan.runtime.sandbox.enabled ? "enabled" : "disabled"}`);
  }

  lines.push("Routing:");
  lines.push(`- interaction mode: ${plan.routing.interactionMode ?? "unspecified"}`);
  if (plan.routing.bindings.length > 0) {
    lines.push(
      `- bindings: ${plan.routing.bindings.map((binding) => binding.description).join(", ")}`,
    );
  }
  if (plan.routing.sources.length > 0) {
    lines.push(
      `- sources: ${plan.routing.sources.map((source) => `${source.kind}:${source.value}`).join(", ")}`,
    );
  }

  if (plan.automation.schedules.length > 0) {
    lines.push("Schedules:");
    for (const schedule of plan.automation.schedules) {
      lines.push(`- ${schedule.name}: ${schedule.schedule} (${schedule.purpose})`);
    }
  }

  lines.push("Delivery:");
  lines.push(`- mode: ${plan.delivery.mode ?? "unspecified"}`);
  lines.push(`- format: ${plan.delivery.format ?? "unspecified"}`);
  if (plan.delivery.targetSummary) {
    lines.push(`- target: ${plan.delivery.targetSummary}`);
  }

  lines.push("Workspace:");
  lines.push(`- template: ${plan.workspace.template ?? "none"}`);
  lines.push(`- memory mode: ${plan.workspace.memoryMode ?? "default"}`);
  if (plan.workspace.heartbeatInstructions) {
    lines.push(`- heartbeat: ${plan.workspace.heartbeatInstructions}`);
  }
  if (plan.workspace.notes.length > 0) {
    lines.push(`- notes: ${plan.workspace.notes.join(" | ")}`);
  }
  if (plan.workspace.bootstrapFiles.length > 0) {
    lines.push("Bootstrap files:");
    for (const file of plan.workspace.bootstrapFiles) {
      const title = file.title ? ` (${file.title})` : "";
      lines.push(`- ${file.name}${title}`);
      if (file.prefill.length > 0) {
        lines.push(`  prefill: ${file.prefill.join(" | ")}`);
      }
    }
  }

  lines.push(...formatPlanList("Prerequisites:", plan.validation.prerequisites));
  lines.push(...formatPlanList("Readiness checks:", plan.validation.readinessChecks));
  lines.push(...formatPlanList("Smoke prompts:", plan.validation.smokePrompts));
  lines.push(...formatPlanList("Success criteria:", plan.validation.successCriteria));

  return lines.join("\n");
}

async function loadPlanningConfig(): Promise<OpenClawConfig> {
  const snapshot = await readConfigFileSnapshot();
  return snapshot.valid ? snapshot.config : {};
}

function parseTemplateVariableAssignments(values: string[] | undefined): AgentBlueprintVariableMap {
  const map: AgentBlueprintVariableMap = {};
  for (const raw of values ?? []) {
    const trimmed = raw.trim();
    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      throw new Error(`Invalid --set value "${raw}". Use key=value.`);
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!key) {
      throw new Error(`Invalid --set value "${raw}". Use key=value.`);
    }
    map[key] = value;
  }
  return map;
}

export async function agentsTemplatesListCommand(
  opts: AgentsTemplatesListOptions,
  runtime: RuntimeEnv = defaultRuntime,
) {
  const entries = listAgentBlueprintCatalog();
  if (opts.json) {
    runtime.log(JSON.stringify(entries, null, 2));
    return;
  }
  runtime.log(formatListOutput(entries));
}

export async function agentsTemplatesShowCommand(
  opts: AgentsTemplatesShowOptions,
  runtime: RuntimeEnv = defaultRuntime,
) {
  try {
    const bundle = requireAgentBlueprintTemplate(opts.templateId);
    runtime.log(serializeAgentBlueprintBundle(bundle, opts.json ? "json" : "yaml"));
  } catch (error) {
    runtime.error(error instanceof Error ? error.message : String(error));
    runtime.exit(1);
  }
}

export async function agentsTemplatesPlanCommand(
  opts: AgentsTemplatesPlanOptions,
  runtime: RuntimeEnv = defaultRuntime,
) {
  try {
    const loaded = await loadAgentBlueprint(opts.input);
    const templateVariables = parseTemplateVariableAssignments(opts.set);
    const resolved = resolveAgentBlueprintVariables({
      bundle: loaded.bundle,
      variables: templateVariables,
    });
    const cfg = await loadPlanningConfig();
    const plan = await compileAgentBlueprintPlan({
      bundle: resolved.bundle,
      cfg,
      source: {
        kind: loaded.kind,
        value: loaded.source,
        format: loaded.format,
      },
    });
    const output: DisplayableBlueprintPlan = {
      ...plan,
      templateVariables: {
        resolved: resolved.resolved,
        unresolved: resolved.unresolved,
      },
    };

    runtime.log(opts.json ? JSON.stringify(output, null, 2) : formatAgentBlueprintPlan(output));
    if (plan.status === "invalid") {
      runtime.exit(1);
    }
  } catch (error) {
    runtime.error(error instanceof Error ? error.message : String(error));
    runtime.exit(1);
  }
}

export function formatApplySummary(
  result: Awaited<ReturnType<typeof applyAgentBlueprint>>,
): string {
  const lines = [
    `Applied blueprint: ${result.plan.manifest.displayName} (${result.plan.manifest.templateId})`,
    `Config: ${shortenHomePath(result.configPath)}`,
    "Agent:",
    `- id: ${result.agent.agentId}`,
    `- name: ${result.agent.name}`,
    `- workspace: ${shortenHomePath(result.agent.workspaceDir)}`,
    `- agent dir: ${shortenHomePath(result.agent.agentDir)}`,
  ];

  if (result.workspace.files.length > 0) {
    lines.push("Workspace files:");
    for (const file of result.workspace.files) {
      lines.push(`- ${file.status}: ${file.name}`);
    }
  }

  if (
    result.bindings.removed.length > 0 ||
    result.bindings.added.length > 0 ||
    result.bindings.updated.length > 0 ||
    result.bindings.skipped.length > 0 ||
    result.bindings.conflicts.length > 0 ||
    result.bindings.ignored.length > 0
  ) {
    lines.push("Bindings:");
    for (const removed of result.bindings.removed) {
      lines.push(`- removed: ${removed}`);
    }
    for (const added of result.bindings.added) {
      lines.push(`- added: ${added}`);
    }
    for (const updated of result.bindings.updated) {
      lines.push(`- updated: ${updated}`);
    }
    for (const skipped of result.bindings.skipped) {
      lines.push(`- skipped: ${skipped}`);
    }
    for (const ignored of result.bindings.ignored) {
      lines.push(`- ignored: ${ignored}`);
    }
    for (const conflict of result.bindings.conflicts) {
      lines.push(`- conflict: ${conflict}`);
    }
  }

  if (result.automation.jobs.length > 0) {
    lines.push("Automation:");
    for (const job of result.automation.jobs) {
      lines.push(`- ${job.status}: ${job.name}`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push("Warnings:");
    for (const warning of result.warnings) {
      lines.push(`- ${warning.code}: ${warning.message}`);
    }
  }

  return lines.join("\n");
}

export async function agentsTemplatesApplyCommand(
  opts: AgentsTemplatesApplyOptions,
  runtime: RuntimeEnv = defaultRuntime,
) {
  try {
    if (!opts.yes) {
      runtime.error(
        'Apply requires --yes. Use "openclaw agents templates plan <template-id|file>" to preview first.',
      );
      runtime.exit(1);
      return;
    }
    const loaded = await loadAgentBlueprint(opts.input);
    const templateVariables = parseTemplateVariableAssignments(opts.set);
    const result = await applyAgentBlueprint({
      loaded,
      variables: templateVariables,
    });
    runtime.log(opts.json ? JSON.stringify(result, null, 2) : formatApplySummary(result));
  } catch (error) {
    runtime.error(error instanceof Error ? error.message : String(error));
    runtime.exit(1);
  }
}
