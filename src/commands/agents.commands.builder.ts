import {
  compileAgentBlueprintBuilderPlan,
  applyAgentBlueprintBuilderPlan,
  verifyAgentBlueprintBuilderPlan,
  type AgentBlueprintBuilderDraftSummary,
} from "../agents/blueprints/builder.js";
import { readConfigFileSnapshot } from "../config/config.js";
import type { OpenClawConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import { formatAgentBlueprintPlan, formatApplySummary } from "./agents.commands.templates.js";

type AgentsBuilderPlanOptions = {
  brief: string;
  template?: string;
  json?: boolean;
};

type AgentsBuilderApplyOptions = {
  brief: string;
  template?: string;
  yes?: boolean;
  json?: boolean;
};

type AgentsBuilderVerifyOptions = {
  brief: string;
  template?: string;
  json?: boolean;
};

async function loadPlanningConfig(): Promise<OpenClawConfig> {
  const snapshot = await readConfigFileSnapshot();
  return snapshot.valid ? snapshot.config : {};
}

function formatBuilderDraft(draft: AgentBlueprintBuilderDraftSummary): string {
  const lines = [
    `Builder selection: ${draft.displayName} (${draft.templateId})`,
    `Confidence: ${draft.confidence}`,
    `Planner status: ${draft.plannerStatus}`,
    `Requirement confidence: ${draft.requirements.confidence}`,
  ];
  if (draft.requirements.intentTags.length > 0) {
    lines.push(`Intent tags: ${draft.requirements.intentTags.join(", ")}`);
  }
  if (draft.reasons.length > 0) {
    lines.push("Reasons:");
    for (const reason of draft.reasons) {
      lines.push(`- ${reason}`);
    }
  }
  if (draft.assumptions.length > 0) {
    lines.push("Assumptions:");
    for (const assumption of draft.assumptions) {
      lines.push(`- ${assumption}`);
    }
  }
  if (draft.questions.length > 0) {
    lines.push("Questions:");
    for (const question of draft.questions) {
      lines.push(`- ${question.required ? "[required]" : "[optional]"} ${question.prompt}`);
    }
  }
  const requirementSections: Array<[string, string[]]> = [
    ["Triggers", draft.requirements.triggers.map((entry) => entry.detail)],
    ["Inputs", draft.requirements.inputs.map((entry) => entry.detail)],
    ["Transforms", draft.requirements.transforms.map((entry) => entry.detail)],
    ["Actions", draft.requirements.actions.map((entry) => entry.detail)],
    ["Outputs", draft.requirements.outputs.map((entry) => entry.detail)],
    ["Policies", draft.requirements.policies.map((entry) => entry.detail)],
    ["Constraints", draft.requirements.constraints.map((entry) => entry.detail)],
    ["Ambiguities", draft.requirements.ambiguities],
    ["Missing data", draft.requirements.missingDataFields],
    ["Needs input", draft.requirements.missingInputs.map((entry) => entry.message)],
    ["Needs setup", draft.requirements.setupGaps.map((entry) => entry.message)],
    ["Needs policy", draft.requirements.policyGaps.map((entry) => entry.message)],
    ["Unsupported requests", draft.requirements.unsupportedRequests],
    ["Unsupported", draft.requirements.unsupportedGaps.map((entry) => entry.message)],
  ];
  for (const [label, values] of requirementSections) {
    if (values.length === 0) {
      continue;
    }
    lines.push(`${label}:`);
    for (const value of values) {
      lines.push(`- ${value}`);
    }
  }
  if (draft.planning.selections.length > 0) {
    lines.push("Connector selections:");
    for (const selection of draft.planning.selections) {
      lines.push(
        `- ${selection.requirementLabel}: ${selection.connectorLabel} (${selection.connectorId}, ${selection.source})`,
      );
    }
  }
  if (draft.planning.integrations.length > 0) {
    lines.push("Integrations:");
    for (const integration of draft.planning.integrations) {
      lines.push(`- ${integration.label}: ${integration.status}`);
      if (integration.lastVerifiedAt) {
        lines.push(`  last verified: ${integration.lastVerifiedAt}`);
      }
      for (const issue of integration.issues) {
        lines.push(`  - ${issue}`);
      }
    }
  }
  if (draft.planning.setupTasks.length > 0) {
    lines.push("Setup tasks:");
    for (const task of draft.planning.setupTasks) {
      lines.push(`- [${task.status}] ${task.title}`);
      lines.push(`  ${task.detail}`);
      if (task.refs.length > 0) {
        lines.push(`  refs: ${task.refs.join(", ")}`);
      }
    }
  }
  if (draft.planning.verifications.length > 0) {
    lines.push("Verification:");
    for (const result of draft.planning.verifications) {
      const suffix = result.checkedAt ? ` @ ${result.checkedAt}` : "";
      const source = result.source ?? "preflight";
      lines.push(
        `- ${result.connectorLabel} / ${result.probeLabel}: ${result.status} (${source}${suffix})`,
      );
      lines.push(`  ${result.detail}`);
    }
  }
  lines.push("Extracted:");
  lines.push(`- agent: ${draft.extracted.name} (${draft.extracted.agentId})`);
  if (draft.extracted.ingressChannels.length > 0) {
    lines.push(`- ingress: ${draft.extracted.ingressChannels.join(", ")}`);
  }
  if (draft.extracted.sourceChannels.length > 0) {
    lines.push(`- sources: ${draft.extracted.sourceChannels.join(", ")}`);
  }
  if (draft.extracted.deliveryTarget) {
    lines.push(`- delivery: ${draft.extracted.deliveryTarget}`);
  }
  if (draft.extracted.schedule) {
    lines.push(`- schedule: ${draft.extracted.schedule}`);
  }
  lines.push(`- ready: ${draft.ready ? "yes" : "no"}`);
  return lines.join("\n");
}

function formatVerificationSummary(run: {
  checkedAt: string;
  passedCount: number;
  failedCount: number;
  blockedCount: number;
  unresolvedCount: number;
}): string {
  return [
    "Live verification:",
    `- checked at: ${run.checkedAt}`,
    `- passed: ${run.passedCount}`,
    `- failed: ${run.failedCount}`,
    `- blocked: ${run.blockedCount}`,
    `- unresolved: ${run.unresolvedCount}`,
  ].join("\n");
}

export async function agentsBuilderPlanCommand(
  opts: AgentsBuilderPlanOptions,
  runtime: RuntimeEnv = defaultRuntime,
) {
  try {
    const cfg = await loadPlanningConfig();
    const result = await compileAgentBlueprintBuilderPlan({
      brief: opts.brief,
      ...(opts.template ? { templateId: opts.template } : {}),
      cfg,
    });
    if (opts.json) {
      runtime.log(JSON.stringify(result, null, 2));
      return;
    }
    runtime.log(
      [formatBuilderDraft(result.draft), "", formatAgentBlueprintPlan(result.plan)].join("\n"),
    );
    if (result.draft.plannerStatus !== "ready" || result.plan.status !== "ready") {
      runtime.exit(1);
    }
  } catch (error) {
    runtime.error(error instanceof Error ? error.message : String(error));
    runtime.exit(1);
  }
}

export async function agentsBuilderApplyCommand(
  opts: AgentsBuilderApplyOptions,
  runtime: RuntimeEnv = defaultRuntime,
) {
  try {
    if (!opts.yes) {
      runtime.error(
        'Apply requires --yes. Use "openclaw agents builder plan \\"...brief...\\"" to preview first.',
      );
      runtime.exit(1);
      return;
    }
    const cfg = await loadPlanningConfig();
    const result = await applyAgentBlueprintBuilderPlan({
      brief: opts.brief,
      ...(opts.template ? { templateId: opts.template } : {}),
      cfg,
    });
    if (opts.json) {
      runtime.log(JSON.stringify(result, null, 2));
      return;
    }
    runtime.log(
      [formatBuilderDraft(result.draft), "", formatApplySummary(result.result)].join("\n"),
    );
  } catch (error) {
    runtime.error(error instanceof Error ? error.message : String(error));
    runtime.exit(1);
  }
}

export async function agentsBuilderVerifyCommand(
  opts: AgentsBuilderVerifyOptions,
  runtime: RuntimeEnv = defaultRuntime,
) {
  try {
    const cfg = await loadPlanningConfig();
    const result = await verifyAgentBlueprintBuilderPlan({
      brief: opts.brief,
      ...(opts.template ? { templateId: opts.template } : {}),
      cfg,
    });
    if (opts.json) {
      runtime.log(JSON.stringify(result, null, 2));
      return;
    }
    runtime.log(
      [
        formatBuilderDraft(result.draft),
        "",
        formatVerificationSummary(result.verification),
        "",
        formatAgentBlueprintPlan(result.plan),
      ].join("\n"),
    );
    if (result.verification.failedCount > 0 || result.verification.blockedCount > 0) {
      runtime.exit(1);
    }
  } catch (error) {
    runtime.error(error instanceof Error ? error.message : String(error));
    runtime.exit(1);
  }
}
