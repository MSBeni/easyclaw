import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CRON_FORM } from "../app-defaults.ts";
import type { AgentsState } from "./agents.ts";
import {
  applyBuilderPlan,
  loadBuilderPlan,
  runBuilderSetupAction,
  type BuilderState,
  updateBuilderSetupInput,
  verifyBuilderPlan,
} from "./builder.ts";
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
    builderApprovalPosture: "",
    builderTemplateId: "",
    builderModelId: "",
    builderAgentName: "",
    builderWorkspaceDocEdits: {},
    builderSetupInputs: {},
    builderSetupRunningConnectorId: null,
    builderSetupError: null,
    builderSetupResult: null,
    builderPlan: null,
    builderPlanLoading: false,
    builderPlanError: null,
    builderApplyResult: null,
    builderApplying: false,
    builderApplyError: null,
    builderConfirmApply: false,
    builderVerifyResult: null,
    builderVerifying: false,
    builderVerifyError: null,
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
    cronNotice: null,
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

  it("includes a model override in builder requests when selected", async () => {
    const { state, request } = createState();
    state.builderBrief = "Create a daily digest";
    state.builderModelId = "openai/gpt-4o";
    request.mockResolvedValue({
      draft: {
        templateId: "daily-briefing",
      },
      plan: { status: "ready" },
    });

    await loadBuilderPlan(state);

    expect(request).toHaveBeenCalledWith("agents.builder.plan", {
      brief: "Create a daily digest",
      modelId: "openai/gpt-4o",
    });
  });

  it("includes builder agent name override in plan requests", async () => {
    const { state, request } = createState();
    state.builderBrief = "Create a daily digest";
    state.builderAgentName = "Podcast Ideas Bot";
    request.mockResolvedValue({
      draft: {
        templateId: "daily-briefing",
      },
      plan: { status: "ready" },
    });

    await loadBuilderPlan(state);

    expect(request).toHaveBeenCalledWith("agents.builder.plan", {
      brief: "Create a daily digest",
      agentName: "Podcast Ideas Bot",
    });
  });

  it("includes the explicit approval posture in builder requests", async () => {
    const { state, request } = createState();
    state.builderBrief = "Open links on X and comment on my behalf.";
    state.builderApprovalPosture = "ask_every_time";
    request
      .mockResolvedValueOnce({
        draft: {
          templateId: "research-agent",
        },
        plan: { status: "ready" },
      })
      .mockResolvedValueOnce({
        draft: {
          templateId: "research-agent",
        },
        verification: {
          fingerprint: "approval-posture",
          checkedAt: "2026-04-12T00:00:00.000Z",
          passedCount: 1,
          failedCount: 0,
          blockedCount: 0,
          unresolvedCount: 0,
          results: [],
        },
        plan: { status: "ready" },
      })
      .mockResolvedValueOnce({
        draft: {
          templateId: "research-agent",
        },
        result: {
          status: "applied",
          agent: {
            agentId: "research-agent",
            name: "Research Agent",
            workspaceDir: "/tmp/research-agent",
            agentDir: "/tmp/research-agent",
          },
          workspace: { metadataPath: "/tmp/research-agent/easyclaw-blueprint.json", files: [] },
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
        agents: [{ id: "research-agent", name: "Research Agent" }],
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

    await loadBuilderPlan(state);
    await verifyBuilderPlan(state);
    await applyBuilderPlan(state);

    expect(request.mock.calls.slice(0, 3)).toEqual([
      [
        "agents.builder.plan",
        {
          brief: "Open links on X and comment on my behalf.",
          approvalPosture: "ask_every_time",
        },
      ],
      [
        "agents.builder.verify",
        {
          brief: "Open links on X and comment on my behalf.",
          approvalPosture: "ask_every_time",
        },
      ],
      [
        "agents.builder.apply",
        {
          brief: "Open links on X and comment on my behalf.",
          approvalPosture: "ask_every_time",
        },
      ],
    ]);
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

  it("includes edited managed workspace docs when applying a builder plan", async () => {
    const { state, request } = createState();
    state.builderBrief = "Create a daily digest";
    state.builderWorkspaceDocEdits = {
      "primary:AGENTS.md": "## Reviewed Instructions\n\n- Deliver only the final summary.",
    };
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

    expect(request).toHaveBeenCalledWith("agents.builder.apply", {
      brief: "Create a daily digest",
      workspaceDocEdits: [
        {
          nodeId: "primary",
          fileName: "AGENTS.md",
          content: "## Reviewed Instructions\n\n- Deliver only the final summary.",
        },
      ],
    });
  });

  it("runs live verification and updates the current builder plan", async () => {
    const { state, request } = createState();
    state.builderBrief = "Create a daily digest";
    request.mockResolvedValue({
      draft: {
        templateId: "daily-briefing",
        planning: {
          integrations: [],
          verifications: [],
        },
      },
      plan: { status: "ready" },
      verification: {
        fingerprint: "abc123",
        checkedAt: "2026-03-18T12:00:00.000Z",
        passedCount: 1,
        failedCount: 0,
        blockedCount: 0,
        unresolvedCount: 0,
        results: [],
      },
    });

    await verifyBuilderPlan(state);

    expect(request).toHaveBeenCalledWith("agents.builder.verify", {
      brief: "Create a daily digest",
    });
    expect(state.builderVerifyResult).toEqual(
      expect.objectContaining({
        verification: expect.objectContaining({ passedCount: 1 }),
      }),
    );
    expect(state.builderPlan).toEqual(
      expect.objectContaining({
        draft: expect.objectContaining({ templateId: "daily-briefing" }),
      }),
    );
  });

  it("replaces stale duplicate Slack blockers with the latest verification-backed setup action", async () => {
    const { state, request } = createState();
    state.builderBrief = "Create a research agent and send the result to Slack every morning.";
    state.builderPlan = {
      draft: {
        templateId: "research-agent",
        buildSpec: {
          setupActions: [
            { id: "channel:slack:enable" },
            { id: "channel:slack:auto-default-target" },
          ],
        },
      } as never,
      workspacePreviews: [],
      plan: { status: "needs_setup" } as never,
      graphPlans: [],
    };
    request.mockResolvedValue({
      draft: {
        templateId: "research-agent",
        buildSpec: {
          setupActions: [
            {
              id: "channel:slack:auto-default-target",
              connectorId: "channel:slack",
              title: "Verify Slack delivery target",
            },
          ],
        },
        planning: {
          integrations: [],
          verifications: [],
        },
      },
      plan: { status: "needs_setup" },
      verification: {
        fingerprint: "verify-slack-123",
        checkedAt: "2026-04-09T22:19:00.528Z",
        passedCount: 1,
        failedCount: 1,
        blockedCount: 0,
        unresolvedCount: 0,
        results: [],
      },
    });

    await verifyBuilderPlan(state);

    expect(state.builderPlan?.draft.buildSpec.setupActions.map((action) => action.id)).toEqual([
      "channel:slack:auto-default-target",
    ]);
    expect(state.builderVerifyResult).toEqual(
      expect.objectContaining({
        verification: expect.objectContaining({ fingerprint: "verify-slack-123" }),
      }),
    );
  });

  it("updates local quick-setup input state", () => {
    const { state } = createState();
    updateBuilderSetupInput(state, "gmail.account", "automation@example.com");

    expect(state.builderSetupInputs).toEqual({ "gmail.account": "automation@example.com" });
    expect(state.builderSetupError).toBe(null);
  });

  it("runs a builder setup action and refreshes config and live verification", async () => {
    const { state, request } = createState();
    state.builderBrief = "Create a daily Telegram briefing from my Gmail every morning at 9am.";
    request
      .mockResolvedValueOnce({
        connectorId: "platform:gmail-hook",
        status: "configured",
        message: "Gmail hook configured.",
        updatedRefs: ["hooks.gmail", "hooks.token"],
        summary: {
          projectId: "project-123",
          topic: "projects/project-123/topics/gmail-push",
        },
      })
      .mockResolvedValueOnce({
        hash: "config-hash",
        valid: true,
        config: { hooks: { gmail: { account: "automation@example.com" } } },
        raw: '{\n  "hooks": {}\n}',
        issues: [],
      })
      .mockResolvedValueOnce({
        draft: {
          templateId: "daily-briefing",
        },
        workspacePreviews: [],
        plan: { status: "needs_setup" },
        graphPlans: [],
        verification: {
          fingerprint: "verify-123",
          checkedAt: "2026-04-08T12:00:00.000Z",
          passedCount: 0,
          failedCount: 0,
          blockedCount: 1,
          unresolvedCount: 0,
          results: [],
        },
      });

    await runBuilderSetupAction(state, {
      connectorId: "platform:gmail-hook",
      inputs: {
        account: "automation@example.com",
        project: "project-123",
      },
    });

    expect(request.mock.calls).toEqual([
      [
        "agents.builder.setup.run",
        {
          actionId: "platform:gmail-hook",
          connectorId: "platform:gmail-hook",
          inputs: {
            account: "automation@example.com",
            project: "project-123",
          },
        },
      ],
      ["config.get", {}],
      [
        "agents.builder.verify",
        {
          brief: "Create a daily Telegram briefing from my Gmail every morning at 9am.",
        },
      ],
    ]);
    expect(state.builderSetupResult).toEqual(
      expect.objectContaining({
        connectorId: "platform:gmail-hook",
        status: "configured",
      }),
    );
    expect(state.builderSetupRunningConnectorId).toBe(null);
    expect(state.builderVerifyResult).toEqual(
      expect.objectContaining({
        verification: expect.objectContaining({ fingerprint: "verify-123" }),
      }),
    );
  });

  it("keeps an auth handoff result without refreshing config or plan", async () => {
    const { state, request } = createState();
    state.builderBrief = "Create a daily Telegram briefing from my Gmail every morning at 9am.";
    request.mockResolvedValueOnce({
      connectorId: "platform:gmail-hook",
      status: "needs_auth",
      message: "Gmail setup needs sign-in before EasyClaw can finish the remaining steps.",
      updatedRefs: [],
      authSteps: [
        {
          id: "gcloud-auth",
          label: "Sign in to Google Cloud",
          detail: "Log in to the Google Cloud CLI.",
          command: "gcloud auth login",
          connectorId: "platform:gmail-hook:gcloud-auth",
          inputs: {},
        },
      ],
    });

    await runBuilderSetupAction(state, {
      connectorId: "platform:gmail-hook",
      inputs: {
        account: "automation@example.com",
      },
    });

    expect(request.mock.calls).toEqual([
      [
        "agents.builder.setup.run",
        {
          actionId: "platform:gmail-hook",
          connectorId: "platform:gmail-hook",
          inputs: {
            account: "automation@example.com",
          },
        },
      ],
    ]);
    expect(state.builderSetupResult).toEqual(
      expect.objectContaining({
        status: "needs_auth",
      }),
    );
    expect(state.builderSetupRunningConnectorId).toBe(null);
  });

  it("keeps a credentials handoff result without refreshing config or plan", async () => {
    const { state, request } = createState();
    state.builderBrief = "Create a daily Telegram briefing from my Gmail every morning at 9am.";
    request.mockResolvedValueOnce({
      connectorId: "platform:gmail-hook",
      status: "needs_credentials",
      message: "Gmail setup needs a Google OAuth client JSON before gog can sign in.",
      updatedRefs: [],
      credentialImport: {
        connectorId: "platform:gmail-hook:gog-credentials",
        label: "Import OAuth client JSON",
        detail: "Upload the JSON file.",
        consoleUrl: "https://console.cloud.google.com/apis/credentials",
      },
    });

    await runBuilderSetupAction(state, {
      connectorId: "platform:gmail-hook",
      inputs: {
        account: "automation@example.com",
      },
    });

    expect(request.mock.calls).toEqual([
      [
        "agents.builder.setup.run",
        {
          actionId: "platform:gmail-hook",
          connectorId: "platform:gmail-hook",
          inputs: {
            account: "automation@example.com",
          },
        },
      ],
    ]);
    expect(state.builderSetupResult).toEqual(
      expect.objectContaining({
        status: "needs_credentials",
      }),
    );
  });

  it("refreshes config and verification after action-native partial setup progress", async () => {
    const { state, request } = createState();
    state.builderBrief = "Use web research in this workflow.";
    request
      .mockResolvedValueOnce({
        connectorId: "tools:web",
        actionId: "tools:web:configure",
        status: "needs_auth",
        message: "Provider saved, but credentials are still missing.",
        updatedRefs: ["tools.web.search.provider"],
      })
      .mockResolvedValueOnce({
        hash: "config-hash",
        valid: true,
        config: { tools: { web: { search: { provider: "brave" } } } },
        raw: '{\n  "tools": {}\n}',
        issues: [],
      })
      .mockResolvedValueOnce({
        draft: {
          templateId: "research-agent",
        },
        workspacePreviews: [],
        plan: { status: "needs_setup" },
        graphPlans: [],
        verification: {
          fingerprint: "verify-web-123",
          checkedAt: "2026-04-08T13:00:00.000Z",
          passedCount: 0,
          failedCount: 0,
          blockedCount: 1,
          unresolvedCount: 0,
          results: [],
        },
      });

    await runBuilderSetupAction(state, {
      actionId: "tools:web:configure",
      connectorId: "tools:web",
      inputs: {
        provider: "brave",
      },
    });

    expect(request.mock.calls).toEqual([
      [
        "agents.builder.setup.run",
        {
          actionId: "tools:web:configure",
          connectorId: "tools:web",
          inputs: {
            provider: "brave",
          },
        },
      ],
      ["config.get", {}],
      [
        "agents.builder.verify",
        {
          brief: "Use web research in this workflow.",
        },
      ],
    ]);
    expect(state.builderSetupResult).toEqual(
      expect.objectContaining({
        actionId: "tools:web:configure",
        connectorId: "tools:web",
        status: "needs_auth",
      }),
    );
  });

  it("keeps a setup action open when verification still reports the same blocker after refresh", async () => {
    const { state, request } = createState();
    state.builderBrief =
      "Search public event sites and send the schedule to Telegram every morning at 8am.";
    state.setTab = vi.fn();
    request
      .mockResolvedValueOnce({
        connectorId: "tools:ui",
        actionId: "tools:ui:configure",
        status: "configured",
        message: "OpenClaw UI Tools is ready for this workflow.",
        updatedRefs: ["browser.enabled"],
      })
      .mockResolvedValueOnce({
        hash: "config-hash",
        valid: true,
        config: { browser: { enabled: true } },
        raw: '{\n  "browser": { "enabled": true }\n}',
        issues: [],
      })
      .mockResolvedValueOnce({
        draft: {
          buildSpec: {
            setupActions: [
              {
                id: "tools:ui:configure",
                connectorId: "tools:ui",
                status: "pending",
                title: "OpenClaw UI Tools configured",
                detail:
                  "Connect and authenticate a browser-backed session for the target site before activation.",
              },
            ],
          },
        },
        workspacePreviews: [],
        plan: { status: "needs_setup" },
        graphPlans: [],
        verification: {
          fingerprint: "verify-ui-123",
          checkedAt: "2026-04-15T15:51:44.632Z",
          passedCount: 2,
          failedCount: 0,
          blockedCount: 0,
          unresolvedCount: 1,
          results: [],
        },
      });

    await runBuilderSetupAction(state, {
      actionId: "tools:ui:configure",
      connectorId: "tools:ui",
      inputs: {},
    });

    expect(request.mock.calls).toEqual([
      [
        "agents.builder.setup.run",
        {
          actionId: "tools:ui:configure",
          connectorId: "tools:ui",
          inputs: {},
        },
      ],
      ["config.get", {}],
      [
        "agents.builder.verify",
        {
          brief:
            "Search public event sites and send the schedule to Telegram every morning at 8am.",
        },
      ],
    ]);
    expect(state.builderSetupResult).toEqual(
      expect.objectContaining({
        actionId: "tools:ui:configure",
        connectorId: "tools:ui",
        status: "needs_setup",
        message:
          "Connect and authenticate a browser-backed session for the target site before activation.",
      }),
    );
    expect(state.setTab).not.toHaveBeenCalled();
  });

  it("falls back to a Gmail scope re-consent handoff when the gateway returns a raw auth error", async () => {
    const { state, request } = createState();
    request.mockRejectedValueOnce(
      new Error(
        "GatewayRequestError: Google API error (403 insufficientPermissions): Request had insufficient authentication scopes.",
      ),
    );

    await runBuilderSetupAction(state, {
      connectorId: "platform:gmail-hook",
      inputs: {
        account: "automation@example.com",
      },
    });

    expect(state.builderSetupError).toBe(null);
    expect(state.builderSetupResult).toEqual(
      expect.objectContaining({
        actionId: "platform:gmail-hook",
        connectorId: "platform:gmail-hook",
        status: "needs_auth",
        authSteps: expect.arrayContaining([
          expect.objectContaining({
            actionId: "platform:gmail-hook:gog-auth",
            connectorId: "platform:gmail-hook",
            label: "Grant Gmail access in gog",
            command:
              "gog login automation@example.com --client openclaw-gmail-hook --services gmail --gmail-scope full --force-consent",
          }),
        ]),
      }),
    );
  });

  it("falls back to a Gmail credentials import handoff when the gateway returns a raw credentials error", async () => {
    const { state, request } = createState();
    request.mockRejectedValueOnce(
      new Error(
        "GatewayRequestError: gog OAuth client credentials missing. Import them with `gog auth credentials set --client openclaw-gmail-hook <credentials.json>` and retry.",
      ),
    );

    await runBuilderSetupAction(state, {
      connectorId: "platform:gmail-hook",
      inputs: {
        account: "automation@example.com",
        project: "project-123",
      },
    });

    expect(state.builderSetupError).toBe(null);
    expect(state.builderSetupResult).toEqual(
      expect.objectContaining({
        actionId: "platform:gmail-hook",
        connectorId: "platform:gmail-hook",
        status: "needs_credentials",
        credentialImport: expect.objectContaining({
          actionId: "platform:gmail-hook:gog-credentials",
          connectorId: "platform:gmail-hook",
          consoleUrl: "https://console.cloud.google.com/apis/credentials?project=project-123",
        }),
      }),
    );
  });
});
