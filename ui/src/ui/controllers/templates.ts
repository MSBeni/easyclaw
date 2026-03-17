import type { GatewayBrowserClient } from "../gateway.ts";
import { loadAgents, type AgentsState } from "./agents.ts";
import { loadCronStatus, reloadCronJobs, type CronState } from "./cron.ts";

// ---------------------------------------------------------------------------
// Types matching the RPC response shapes
// ---------------------------------------------------------------------------

export type TemplateCatalogEntry = {
  templateId: string;
  displayName: string;
  summary: string;
  tags: string[];
  tier: "starter" | "stretch";
  bundle: Record<string, unknown> | null;
  variables: string[];
};

export type TemplatePlanResult = {
  plan: Record<string, unknown>;
  unresolved: string[];
  resolved: string[];
};

export type TemplateApplyResult = {
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

// ---------------------------------------------------------------------------
// State shape used by the templates view
// ---------------------------------------------------------------------------

export type TemplatesState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  templatesCatalog: TemplateCatalogEntry[] | null;
  templatesCatalogLoading: boolean;
  templatesCatalogError: string | null;
  templatesPlan: TemplatePlanResult | null;
  templatesPlanLoading: boolean;
  templatesPlanError: string | null;
  templatesApplyResult: TemplateApplyResult | null;
  templatesApplying: boolean;
  templatesApplyError: string | null;
  templatesVariables: Record<string, string>;
  templatesConfirmApply: boolean;
};

type TemplatesApplyState = TemplatesState & AgentsState & CronState;

// ---------------------------------------------------------------------------
// RPC actions
// ---------------------------------------------------------------------------

export async function loadTemplateCatalog(state: TemplatesState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.templatesCatalogLoading) {
    return;
  }
  state.templatesCatalogLoading = true;
  state.templatesCatalogError = null;
  try {
    const res = await state.client.request<{ catalog: TemplateCatalogEntry[] }>(
      "agents.templates.catalog",
      {},
    );
    state.templatesCatalog = res?.catalog ?? [];
  } catch (err) {
    state.templatesCatalogError = String(err);
  } finally {
    state.templatesCatalogLoading = false;
  }
}

export async function loadTemplatePlan(state: TemplatesState, templateId: string) {
  if (!state.client || !state.connected || !templateId) {
    return;
  }
  state.templatesPlanLoading = true;
  state.templatesPlanError = null;
  state.templatesPlan = null;
  try {
    const res = await state.client.request<TemplatePlanResult>("agents.templates.plan", {
      input: templateId,
      variables: state.templatesVariables,
    });
    state.templatesPlan = res ?? null;
  } catch (err) {
    state.templatesPlanError = String(err);
  } finally {
    state.templatesPlanLoading = false;
  }
}

export async function applyTemplate(state: TemplatesState, templateId: string) {
  if (!state.client || !state.connected || !templateId) {
    return;
  }
  state.templatesApplying = true;
  state.templatesApplyError = null;
  state.templatesApplyResult = null;
  try {
    const res = await state.client.request<TemplateApplyResult>("agents.templates.apply", {
      input: templateId,
      variables: state.templatesVariables,
    });
    state.templatesApplyResult = res ?? null;
    state.templatesConfirmApply = false;
    const refreshState = state as TemplatesApplyState;
    await Promise.allSettled([
      loadAgents(refreshState),
      reloadCronJobs(refreshState),
      loadCronStatus(refreshState),
    ]);
  } catch (err) {
    state.templatesApplyError = String(err);
  } finally {
    state.templatesApplying = false;
  }
}
