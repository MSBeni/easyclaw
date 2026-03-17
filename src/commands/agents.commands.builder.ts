import {
  compileAgentBlueprintBuilderPlan,
  applyAgentBlueprintBuilderPlan,
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

async function loadPlanningConfig(): Promise<OpenClawConfig> {
  const snapshot = await readConfigFileSnapshot();
  return snapshot.valid ? snapshot.config : {};
}

function formatBuilderDraft(draft: AgentBlueprintBuilderDraftSummary): string {
  const lines = [
    `Builder selection: ${draft.displayName} (${draft.templateId})`,
    `Confidence: ${draft.confidence}`,
  ];
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
    if (!result.draft.ready || result.plan.status !== "ready") {
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
    const result = await applyAgentBlueprintBuilderPlan({
      brief: opts.brief,
      ...(opts.template ? { templateId: opts.template } : {}),
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
