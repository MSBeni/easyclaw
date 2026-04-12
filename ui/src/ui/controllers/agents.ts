import type { GatewayBrowserClient } from "../gateway.ts";
import type { AgentsListResult, CronJob, ToolsCatalogResult } from "../types.ts";
import { saveConfig } from "./config.ts";
import type { ConfigState } from "./config.ts";

export type AgentsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  agentsLoading: boolean;
  agentsError: string | null;
  agentsList: AgentsListResult | null;
  agentsSelectedId: string | null;
  toolsCatalogLoading: boolean;
  toolsCatalogLoadingAgentId?: string | null;
  toolsCatalogError: string | null;
  toolsCatalogResult: ToolsCatalogResult | null;
};

export type AgentsConfigSaveState = AgentsState & ConfigState;

export type AgentsDeleteState = AgentsState & {
  cronJobs: CronJob[];
};

export async function loadAgents(state: AgentsState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.agentsLoading) {
    return;
  }
  state.agentsLoading = true;
  state.agentsError = null;
  try {
    const res = await state.client.request<AgentsListResult>("agents.list", {});
    if (res) {
      state.agentsList = res;
      const selected = state.agentsSelectedId;
      const known = res.agents.some((entry) => entry.id === selected);
      if (!selected || !known) {
        state.agentsSelectedId = res.defaultId ?? res.agents[0]?.id ?? null;
      }
    }
  } catch (err) {
    state.agentsError = String(err);
  } finally {
    state.agentsLoading = false;
  }
}

export async function loadToolsCatalog(state: AgentsState, agentId: string) {
  const resolvedAgentId = agentId.trim();
  if (!state.client || !state.connected || !resolvedAgentId) {
    return;
  }
  if (state.toolsCatalogLoading && state.toolsCatalogLoadingAgentId === resolvedAgentId) {
    return;
  }
  state.toolsCatalogLoading = true;
  state.toolsCatalogLoadingAgentId = resolvedAgentId;
  state.toolsCatalogError = null;
  state.toolsCatalogResult = null;
  try {
    const res = await state.client.request<ToolsCatalogResult>("tools.catalog", {
      agentId: resolvedAgentId,
      includePlugins: true,
    });
    if (state.toolsCatalogLoadingAgentId !== resolvedAgentId) {
      return;
    }
    if (state.agentsSelectedId && state.agentsSelectedId !== resolvedAgentId) {
      return;
    }
    state.toolsCatalogResult = res;
  } catch (err) {
    if (state.toolsCatalogLoadingAgentId !== resolvedAgentId) {
      return;
    }
    if (state.agentsSelectedId && state.agentsSelectedId !== resolvedAgentId) {
      return;
    }
    state.toolsCatalogResult = null;
    state.toolsCatalogError = String(err);
  } finally {
    if (state.toolsCatalogLoadingAgentId === resolvedAgentId) {
      state.toolsCatalogLoadingAgentId = null;
      state.toolsCatalogLoading = false;
    }
  }
}

export async function saveAgentsConfig(state: AgentsConfigSaveState) {
  const selectedBefore = state.agentsSelectedId;
  await saveConfig(state);
  await loadAgents(state);
  if (selectedBefore && state.agentsList?.agents.some((entry) => entry.id === selectedBefore)) {
    state.agentsSelectedId = selectedBefore;
  }
}

export async function deleteAgentWithFullCleanup(
  state: AgentsDeleteState,
  agentId: string,
): Promise<boolean> {
  const normalizedAgentId = agentId.trim();
  if (!state.client || !state.connected || !normalizedAgentId || state.agentsLoading) {
    return false;
  }

  const relatedCronJobs = state.cronJobs.filter((job) => job.agentId === normalizedAgentId).length;
  const confirmDelete =
    typeof globalThis.confirm === "function" ? globalThis.confirm.bind(globalThis) : () => true;
  const confirmed = confirmDelete(
    [
      `Delete agent "${normalizedAgentId}"?`,
      "",
      "This will permanently remove:",
      "\u2022 Agent settings, files, and conversation history",
      "\u2022 All scheduled tasks for this agent" +
        (relatedCronJobs > 0 ? ` (${relatedCronJobs} found)` : ""),
      "",
      "Your messaging channels, AI provider keys, and other integrations will not be affected.",
    ].join("\n"),
  );
  if (!confirmed) {
    return false;
  }

  state.agentsLoading = true;
  state.agentsError = null;
  try {
    await state.client.request("agents.delete", {
      agentId: normalizedAgentId,
      deleteFiles: true,
      deleteCronJobs: true,
    });
    return true;
  } catch (err) {
    state.agentsError = String(err);
    return false;
  } finally {
    state.agentsLoading = false;
  }
}
