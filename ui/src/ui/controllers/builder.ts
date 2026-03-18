import type { GatewayBrowserClient } from "../gateway.ts";
import { loadAgents, type AgentsState } from "./agents.ts";
import { loadCronStatus, reloadCronJobs, type CronState } from "./cron.ts";

export type BuilderDraftSummary = {
  brief: string;
  templateId: string;
  displayName: string;
  confidence: "low" | "medium" | "high";
  plannerStatus:
    | "ready"
    | "needs_input"
    | "needs_setup"
    | "partial"
    | "unsupported"
    | "unsafe_without_policy"
    | "blocked";
  reasons: string[];
  assumptions: string[];
  questions: Array<{
    id: string;
    prompt: string;
    required: boolean;
  }>;
  ready: boolean;
  requirements: {
    intentTags: string[];
    triggers: Array<{ detail: string }>;
    inputs: Array<{ detail: string }>;
    transforms: Array<{ detail: string }>;
    decisions: Array<{ detail: string }>;
    actions: Array<{ detail: string }>;
    outputs: Array<{ detail: string }>;
    policies: Array<{ detail: string }>;
    constraints: Array<{ detail: string }>;
    missingInputs: Array<{ code: string; message: string }>;
    setupGaps: Array<{ code: string; message: string }>;
    policyGaps: Array<{ code: string; message: string }>;
    unsupportedGaps: Array<{ code: string; message: string }>;
  };
  planning: {
    selections: Array<{
      requirementId: string;
      requirementLabel: string;
      contractIds: string[];
      connectorId: string;
      connectorLabel: string;
      source: "explicit" | "preferred" | "fallback";
    }>;
    integrations: Array<{
      connectorId: string;
      instanceId: string;
      status:
        | "discovered"
        | "install_required"
        | "installed"
        | "configured"
        | "authenticated"
        | "verified"
        | "degraded"
        | "failed";
      configRefs: string[];
      authRefs: string[];
      issues: string[];
      label: string;
      kind: string;
      sourceKind: string;
      contracts: string[];
      verification: Array<{ kind: string; label: string; successDescription: string }>;
    }>;
    setupTasks: Array<{
      id: string;
      connectorId: string;
      connectorLabel: string;
      kind: "install" | "connect" | "configure" | "enable" | "policy";
      status: "completed" | "pending";
      title: string;
      detail: string;
      refs: string[];
    }>;
    verifications: Array<{
      id: string;
      connectorId: string;
      connectorLabel: string;
      probeKind: string;
      probeLabel: string;
      status: "passed" | "blocked" | "needs_live_check";
      detail: string;
    }>;
  };
  extracted: {
    agentId: string;
    name: string;
    ingressChannels: string[];
    sourceChannels: string[];
    deliveryTarget: string | null;
    schedule: string | null;
  };
};

export type BuilderPlanResult = {
  draft: BuilderDraftSummary;
  plan: Record<string, unknown>;
};

export type BuilderApplyResult = {
  draft: BuilderDraftSummary;
  result: {
    status: "applied";
    agent: { agentId: string; name: string; workspaceDir: string; agentDir: string };
    workspace: { metadataPath: string; files: Array<{ name: string; status: string }> };
    bindings: {
      added: string[];
      removed: string[];
      updated: string[];
      skipped: string[];
      conflicts: string[];
      ignored: string[];
    };
    automation: { jobs: Array<{ name: string; id: string; status: string }> };
    warnings: Array<{ code: string; message: string }>;
  };
};

export type BuilderState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  builderBrief: string;
  builderTemplateId: string;
  builderPlan: BuilderPlanResult | null;
  builderPlanLoading: boolean;
  builderPlanError: string | null;
  builderApplyResult: BuilderApplyResult | null;
  builderApplying: boolean;
  builderApplyError: string | null;
  builderConfirmApply: boolean;
};

type BuilderApplyState = BuilderState & AgentsState & CronState;

export async function loadBuilderPlan(state: BuilderState) {
  if (!state.client || !state.connected || !state.builderBrief.trim()) {
    return;
  }
  state.builderPlanLoading = true;
  state.builderPlanError = null;
  state.builderPlan = null;
  try {
    const result = await state.client.request<BuilderPlanResult>("agents.builder.plan", {
      brief: state.builderBrief,
      ...(state.builderTemplateId ? { templateId: state.builderTemplateId } : {}),
    });
    state.builderPlan = result ?? null;
  } catch (error) {
    state.builderPlanError = String(error);
  } finally {
    state.builderPlanLoading = false;
  }
}

export async function applyBuilderPlan(state: BuilderState) {
  if (!state.client || !state.connected || !state.builderBrief.trim()) {
    return;
  }
  state.builderApplying = true;
  state.builderApplyError = null;
  state.builderApplyResult = null;
  try {
    const result = await state.client.request<BuilderApplyResult>("agents.builder.apply", {
      brief: state.builderBrief,
      ...(state.builderTemplateId ? { templateId: state.builderTemplateId } : {}),
    });
    state.builderApplyResult = result ?? null;
    state.builderConfirmApply = false;
    const refreshState = state as BuilderApplyState;
    await Promise.allSettled([
      loadAgents(refreshState),
      reloadCronJobs(refreshState),
      loadCronStatus(refreshState),
    ]);
  } catch (error) {
    state.builderApplyError = String(error);
  } finally {
    state.builderApplying = false;
  }
}
