import { describe, expect, it } from "vitest";
import {
  applyAgentBlueprintBuilderPlan,
  buildAgentBlueprintDraft,
  compileAgentBlueprintBuilderPlan,
  __testing,
} from "./builder.js";

describe("agent blueprint builder", () => {
  it("selects the daily briefing template for scheduled digest requests", async () => {
    const result = await compileAgentBlueprintBuilderPlan({
      brief:
        "Create a bot that summarizes my daily emails and posts them to Slack #ops every morning at 9am.",
      cfg: {},
    });

    expect(result.draft.templateId).toBe("daily-briefing");
    expect(result.draft.plannerStatus).toBe("needs_setup");
    expect(result.draft.ready).toBe(false);
    expect(result.draft.extracted.sourceChannels).toContain("gmail");
    expect(result.draft.extracted.deliveryTarget).toContain("slack");
    expect(result.draft.extracted.schedule).toContain("0 9");
    expect(result.draft.requirements.setupGaps.map((gap) => gap.code)).toEqual(
      expect.arrayContaining(["gmail-hook", "channel:slack", "runtime-model-unresolved"]),
    );
    expect(result.draft.planning.selections.map((selection) => selection.connectorId)).toEqual(
      expect.arrayContaining([
        "channel:slack",
        "platform:core-model",
        "platform:gmail-hook",
        "tools:automation",
      ]),
    );
    expect(result.draft.planning.setupTasks.map((task) => task.connectorId)).toEqual(
      expect.arrayContaining(["channel:slack", "platform:gmail-hook"]),
    );
    expect(result.draft.planning.variants.length).toBeGreaterThan(0);
    expect(result.draft.planning.graph.nodes).toHaveLength(1);
    expect(
      result.draft.planning.verifications.find(
        (probe) => probe.connectorId === "platform:gmail-hook" && probe.probeKind === "status",
      )?.status,
    ).toBe("blocked");
    expect(result.plan.source?.kind).toBe("builder");
    expect(result.plan.status).toBe("invalid");
    expect(result.plan.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "model-selection-unresolved",
        }),
      ]),
    );
    expect(result.graphPlans).toHaveLength(1);
  });

  it("enables source-fetch runtime capabilities for Gmail briefing workflows", () => {
    const draft = buildAgentBlueprintDraft({
      brief: "Create a daily Telegram briefing from my Gmail inbox every morning at 9am.",
      cfg: {
        channels: {
          telegram: {
            botToken: "123:abc",
            defaultTo: "-1001234567890",
          },
        },
      },
    });

    expect(draft.extracted.sourceChannels).toContain("gmail");
    expect(draft.bundle.runtime.tools.profile).toBe("coding");
    expect(draft.bundle.runtime.tools.alsoAllow ?? []).toEqual(
      expect.arrayContaining(["cron", "message"]),
    );
    expect(draft.bundle.runtime.skills ?? []).toContain("gog");
  });

  it("pins an explicit runtime model when one is provided", async () => {
    const result = await compileAgentBlueprintBuilderPlan({
      brief: "Create a daily digest from my Gmail and send it to me on Telegram.",
      modelId: "openai/gpt-4o",
      cfg: {
        channels: {
          telegram: {
            botToken: "123:abc",
            defaultTo: "-1001234567890",
          },
        },
      },
    });

    expect(result.plan.agent.modelSelection).toEqual({
      mode: "explicit",
      value: "openai/gpt-4o",
    });
    expect(result.draft.assumptions).toEqual(
      expect.arrayContaining(["Pinned runtime model to openai/gpt-4o."]),
    );
  });

  it("blocks apply when runtime model selection is unresolved", async () => {
    await expect(
      applyAgentBlueprintBuilderPlan({
        brief: "I want an assistant that keeps me organized.",
        cfg: {},
      }),
    ).rejects.toThrow(/choose a runtime model/i);
  });

  it("blocks apply when model provider auth is not runnable", async () => {
    await expect(
      applyAgentBlueprintBuilderPlan({
        brief: "I want an assistant that keeps me organized.",
        modelId: "builder-auth-runnable-test/model-x",
        cfg: {
          agents: {
            defaults: {
              model: "builder-auth-runnable-test/model-x",
            },
          },
        },
      }),
    ).rejects.toThrow(/OpenClaw Core Model Runtime auth is not runnable/i);
  });

  it("blocks apply when required channel auth is not runnable", async () => {
    await expect(
      applyAgentBlueprintBuilderPlan({
        brief: "Create a support bot on Telegram for customer questions.",
        modelId: "amazon-bedrock/claude-sonnet",
        cfg: {
          agents: {
            defaults: {
              model: "amazon-bedrock/claude-sonnet",
            },
          },
          channels: {
            telegram: {
              enabled: false,
              botToken: "123:abc",
            },
          },
        },
      }),
    ).rejects.toThrow(/Telegram auth is not runnable/i);
  });

  it("asks for a support channel when the request is support-shaped but underspecified", () => {
    const draft = buildAgentBlueprintDraft({
      brief: "I want a customer support responder for billing questions.",
    });

    expect(draft.templateId).toBe("support-responder");
    expect(draft.plannerStatus).toBe("needs_input");
    expect(draft.ready).toBe(false);
    expect(draft.questions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "binding-channel",
          required: true,
        }),
      ]),
    );
  });

  it("uses channel-level Telegram bindings for support responders", () => {
    const draft = buildAgentBlueprintDraft({
      brief: "Create a support bot on Telegram for customer questions.",
    });

    expect(draft.templateId).toBe("support-responder");
    expect(draft.plannerStatus).toBe("needs_setup");
    expect(draft.ready).toBe(false);
    expect(draft.extracted.ingressChannels).toEqual(["telegram"]);
    expect(
      draft.planning.integrations.find(
        (integration) => integration.connectorId === "channel:telegram",
      )?.status,
    ).toBe("discovered");
    expect(draft.planning.setupTasks.map((task) => task.connectorId)).toContain("channel:telegram");
  });

  it("uses configured direct-channel defaults instead of @me", () => {
    const draft = buildAgentBlueprintDraft({
      brief: "Create a daily briefing and deliver it to Telegram every weekday morning.",
      cfg: {
        channels: {
          telegram: {
            botToken: "123:abc",
            defaultTo: "-1001234567890",
          },
        },
      },
    });

    expect(draft.extracted.deliveryTarget).toBe("telegram -1001234567890");
    expect(draft.questions.map((question) => question.id)).not.toContain("delivery-target");
    expect(draft.assumptions).toEqual(
      expect.arrayContaining(["Used configured telegram default target."]),
    );
  });

  it("asks for an explicit destination when direct-channel defaults are missing", () => {
    const draft = buildAgentBlueprintDraft({
      brief: "Create a daily briefing and deliver it to Telegram every weekday morning.",
      cfg: {
        channels: {
          telegram: {
            botToken: "123:abc",
          },
        },
      },
    });

    expect(draft.ready).toBe(false);
    expect(draft.questions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "delivery-target",
          required: true,
        }),
      ]),
    );
    expect(draft.extracted.deliveryTarget ?? "").not.toContain("@me");
    expect(draft.extracted.deliveryTarget ?? "").not.toContain("{{owner_target}}");
  });

  it("defaults to the personal assistant template and creates a dedicated agent", () => {
    const draft = buildAgentBlueprintDraft({
      brief: "I want an assistant that keeps me organized.",
      cfg: {
        agents: {
          defaults: {
            model: "openai/gpt-4o",
          },
        },
      },
    });

    expect(draft.templateId).toBe("personal-assistant");
    expect(draft.ready).toBe(true);
    expect(draft.questions).toEqual([]);
    expect(draft.extracted.agentId).toBe("personal-assistant");
    expect(draft.extracted.name).toBe("Personal Assistant");
  });

  it("reports risky browser actions as unsafe without approval routing", () => {
    const draft = buildAgentBlueprintDraft({
      brief:
        "Create a bot on Telegram that opens links on X, follows the account, and comments on my behalf.",
      cfg: {
        channels: {
          telegram: {
            botToken: "123:abc",
          },
        },
      },
    });

    expect(draft.templateId).toBe("personal-assistant");
    expect(draft.plannerStatus).toBe("unsafe_without_policy");
    expect(draft.requirements.policyGaps.map((gap) => gap.code)).toContain("approval-route");
    expect(draft.planning.selections.map((selection) => selection.connectorId)).toEqual(
      expect.arrayContaining(["platform:exec-approvals", "tools:ui"]),
    );
    expect(
      draft.planning.setupTasks.find((task) => task.connectorId === "platform:exec-approvals")
        ?.kind,
    ).toBe("policy");
  });

  it("shapes webhook-driven operator workflows from extracted requirements", () => {
    const draft = buildAgentBlueprintDraft({
      brief:
        "Create a webhook-driven agent that reads PDFs from my workspace, checks memory for prior context, and spawns a subagent to summarize them.",
      cfg: {
        hooks: {
          token: "hook-token",
        },
      },
    });

    expect(draft.templateId).toBe("personal-assistant");
    expect(draft.requirements.workflow.executionMode).toBe("webhook");
    expect(draft.requirements.workflow.sourceKinds).toEqual(
      expect.arrayContaining(["file-source", "memory-source"]),
    );
    expect(draft.planning.topology.mode).toBe("multi-agent");
    expect(draft.bundle.runtime.subagents?.enabled).toBe(true);
    expect(draft.planning.graph.nodes.map((node) => node.roleId)).toEqual(
      expect.arrayContaining(["coordinator", "worker"]),
    );
    expect(draft.planning.selections.map((selection) => selection.connectorId)).toEqual(
      expect.arrayContaining([
        "platform:webhook-runtime",
        "tools:fs",
        "tools:memory",
        "tools:sessions",
      ]),
    );
  });
});

describe("builder schedule inference", () => {
  it("defaults weekly schedules to Monday mornings when no exact day or time is given", () => {
    expect(__testing.inferSchedule("Create a weekly digest agent")).toEqual({
      cron: "0 9 * * 1",
      description: "Mondays at 9:00 AM",
      assumed: true,
    });
  });
});
