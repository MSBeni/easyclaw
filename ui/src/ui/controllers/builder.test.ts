import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CRON_FORM } from "../app-defaults.ts";
import type { AgentsState } from "./agents.ts";
import { applyBuilderPlan, loadBuilderPlan, type BuilderState } from "./builder.ts";
import type { CronState } from "./cron.ts";

type ControllerState = BuilderState & AgentsState & CronState;

function createState(): {
  state: ControllerState;
  request: ReturnType<typeof vi.fn>;
} {
  const request = vi.fn();
  const state: ControllerState = {
    client: {
      request,
    } as unknown as ControllerState["client"],
    connected: true,
    builderBrief: "",
    builderTemplateId: "",
    builderPlan: null,
    builderPlanLoading: false,
    builderPlanError: null,
    builderApplyResult: null,
    builderApplying: false,
    builderApplyError: null,
    builderConfirmApply: false,
    agentsLoading: false,
    agentsError: null,
    agentsList: null,
    agentsSelectedId: "main",
    toolsCatalogLoading: false,
    toolsCatalogLoadingAgentId: null,
    toolsCatalogError: null,
    toolsCatalogResult: null,
    cronLoading: false,
    cronJobsLoadingMore: false,
    cronJobs: [],
    cronJobsTotal: 0,
    cronJobsHasMore: false,
    cronJobsNextOffset: null,
    cronJobsLimit: 25,
    cronJobsQuery: "",
    cronJobsEnabledFilter: "all",
    cronJobsScheduleKindFilter: "all",
    cronJobsLastStatusFilter: "all",
    cronJobsSortBy: "updatedAtMs",
    cronJobsSortDir: "desc",
    cronStatus: null,
    cronError: null,
    cronForm: { ...DEFAULT_CRON_FORM },
    cronFieldErrors: {},
    cronEditingJobId: null,
    cronRunsJobId: null,
    cronRunsLoadingMore: false,
    cronRuns: [],
    cronRunsTotal: 0,
    cronRunsHasMore: false,
    cronRunsNextOffset: null,
    cronRunsLimit: 25,
    cronRunsScope: "all",
    cronRunsStatuses: [],
    cronRunsDeliveryStatuses: [],
    cronRunsStatusFilter: "all",
    cronRunsQuery: "",
    cronRunsSortDir: "desc",
    cronBusy: false,
  };
  return { state, request };
}

describe("builder controller", () => {
  it("loads the builder plan", async () => {
    const { state, request } = createState();
    state.builderBrief = "Create a daily digest";
    state.builderTemplateId = "daily-briefing";
    request.mockResolvedValue({
      draft: {
        templateId: "daily-briefing",
      },
      plan: { status: "ready" },
    });

    await loadBuilderPlan(state);

    expect(request).toHaveBeenCalledWith("agents.builder.plan", {
      brief: "Create a daily digest",
      templateId: "daily-briefing",
    });
    expect(state.builderPlan).toEqual(
      expect.objectContaining({
        draft: expect.objectContaining({ templateId: "daily-briefing" }),
      }),
    );
  });

  it("applies the builder plan and refreshes agents and cron state", async () => {
    const { state, request } = createState();
    state.builderBrief = "Create a daily digest";
    state.builderConfirmApply = true;
    request
      .mockResolvedValueOnce({
        draft: {
          templateId: "daily-briefing",
        },
        result: {
          status: "applied",
          agent: {
            agentId: "daily-briefing",
            name: "Morning Brief",
            workspaceDir: "/tmp/workspace",
            agentDir: "/tmp/agent",
          },
          workspace: { metadataPath: "/tmp/agent/easyclaw-blueprint.json", files: [] },
          bindings: {
            added: [],
            removed: [],
            updated: [],
            skipped: [],
            conflicts: [],
            ignored: [],
          },
          automation: { jobs: [] },
          warnings: [],
        },
      })
      .mockResolvedValueOnce({
        defaultId: "main",
        mainKey: "agent:main:main",
        scope: "per-sender",
        agents: [{ id: "daily-briefing", name: "Morning Brief" }],
      })
      .mockResolvedValueOnce({
        jobs: [],
        total: 0,
        limit: 25,
        offset: 0,
        hasMore: false,
        nextOffset: null,
      })
      .mockResolvedValueOnce({
        enabled: true,
        count: 0,
      });

    await applyBuilderPlan(state);

    expect(request.mock.calls).toEqual([
      ["agents.builder.apply", { brief: "Create a daily digest" }],
      ["agents.list", {}],
      [
        "cron.list",
        {
          includeDisabled: true,
          limit: 25,
          offset: 0,
          query: undefined,
          enabled: "all",
          sortBy: "updatedAtMs",
          sortDir: "desc",
        },
      ],
      ["cron.status", {}],
    ]);
    expect(state.builderApplyResult).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({
          agent: expect.objectContaining({ agentId: "daily-briefing" }),
        }),
      }),
    );
    expect(state.builderConfirmApply).toBe(false);
  });
});
