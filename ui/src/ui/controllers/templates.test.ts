import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CRON_FORM } from "../app-defaults.ts";
import type { AgentsState } from "./agents.ts";
import type { CronState } from "./cron.ts";
import {
  applyTemplate,
  loadTemplateCatalog,
  loadTemplatePlan,
  type TemplatesState,
} from "./templates.ts";

type ControllerState = TemplatesState & AgentsState & CronState;

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
    templatesCatalog: null,
    templatesCatalogLoading: false,
    templatesCatalogError: null,
    templatesPlan: null,
    templatesPlanLoading: false,
    templatesPlanError: null,
    templatesApplyResult: null,
    templatesApplying: false,
    templatesApplyError: null,
    templatesVariables: {},
    templatesConfirmApply: false,
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

describe("templates controller", () => {
  it("loads the template catalog", async () => {
    const { state, request } = createState();
    request.mockResolvedValue({
      catalog: [
        {
          templateId: "daily-briefing",
          displayName: "Daily Briefing Agent",
          summary: "Start the day with a digest.",
          tags: ["starter"],
          tier: "starter",
          bundle: null,
          variables: ["owner_target"],
        },
      ],
    });

    await loadTemplateCatalog(state);

    expect(request).toHaveBeenCalledWith("agents.templates.catalog", {});
    expect(state.templatesCatalog).toEqual([
      expect.objectContaining({
        templateId: "daily-briefing",
        variables: ["owner_target"],
      }),
    ]);
    expect(state.templatesCatalogError).toBeNull();
  });

  it("loads a compiled plan with template variables", async () => {
    const { state, request } = createState();
    state.templatesVariables = { owner_target: "@me" };
    request.mockResolvedValue({
      plan: { status: "ready", agent: { agentId: "daily-briefing" } },
      unresolved: [],
      resolved: ["owner_target"],
    });

    await loadTemplatePlan(state, "daily-briefing");

    expect(request).toHaveBeenCalledWith("agents.templates.plan", {
      input: "daily-briefing",
      variables: { owner_target: "@me" },
    });
    expect(state.templatesPlan).toEqual(
      expect.objectContaining({
        plan: expect.objectContaining({
          agent: expect.objectContaining({ agentId: "daily-briefing" }),
        }),
        resolved: ["owner_target"],
      }),
    );
    expect(state.templatesPlanError).toBeNull();
  });

  it("applies a template and refreshes agents and cron state", async () => {
    const { state, request } = createState();
    state.templatesVariables = { owner_target: "@me" };
    state.templatesConfirmApply = true;
    request
      .mockResolvedValueOnce({
        status: "applied",
        agent: {
          agentId: "daily-briefing",
          name: "Daily Briefing Agent",
          workspaceDir: "/tmp/workspace",
          agentDir: "/tmp/agent",
        },
        workspace: { metadataPath: "/tmp/workspace/easyclaw-blueprint.json", files: [] },
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
      })
      .mockResolvedValueOnce({
        defaultId: "main",
        mainKey: "agent:main:main",
        scope: "per-sender",
        agents: [
          { id: "main", name: "Main" },
          { id: "daily-briefing", name: "Daily Briefing Agent" },
        ],
      })
      .mockResolvedValueOnce({
        jobs: [{ id: "cron-1", name: "Daily Briefing", enabled: true, schedule: { kind: "cron" } }],
        total: 1,
        limit: 25,
        offset: 0,
        hasMore: false,
        nextOffset: null,
      })
      .mockResolvedValueOnce({
        enabled: true,
        count: 1,
      });

    await applyTemplate(state, "daily-briefing");

    expect(request.mock.calls).toEqual([
      [
        "agents.templates.apply",
        {
          input: "daily-briefing",
          variables: { owner_target: "@me" },
        },
      ],
      ["agents.list", {}],
      [
        "cron.list",
        {
          includeDisabled: true,
          limit: 25,
          offset: 0,
          query: undefined,
          enabled: "all",
          sortBy: "updatedAt",
          sortDir: "desc",
        },
      ],
      ["cron.status", {}],
    ]);
    expect(state.templatesApplyResult).toEqual(
      expect.objectContaining({
        status: "applied",
        agent: expect.objectContaining({ agentId: "daily-briefing" }),
      }),
    );
    expect(state.templatesConfirmApply).toBe(false);
    expect(state.agentsList?.agents).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "daily-briefing" })]),
    );
    expect(state.cronJobs).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "cron-1", name: "Daily Briefing" })]),
    );
    expect(state.cronStatus).toEqual(expect.objectContaining({ enabled: true, count: 1 }));
  });
});
