import { afterEach, describe, expect, it, vi } from "vitest";
import { setActiveWebListener } from "../../../extensions/whatsapp/src/active-listener.js";
import { whatsappPlugin } from "../../../extensions/whatsapp/src/channel.js";
import {
  getWhatsAppRuntime,
  setWhatsAppRuntime,
} from "../../../extensions/whatsapp/src/runtime.js";
import { getActivePluginRegistry, setActivePluginRegistry } from "../../plugins/runtime.js";
import { createTestRegistry } from "../../test-utils/channel-plugins.js";
import { __testing as plannerAgentTesting } from "../planning/planner-agent.js";
import {
  applyAgentBlueprintBuilderPlan,
  buildAgentBlueprintDraft,
  compileAgentBlueprintBuilderPlan,
  verifyAgentBlueprintBuilderPlan,
  __testing,
} from "./builder.js";

afterEach(() => {
  plannerAgentTesting.setPlannerModelRunnerForTest();
  plannerAgentTesting.setResolvePlannerModelForTest();
  setActiveWebListener("default", null);
});

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

  it("enables source-fetch runtime capabilities for Gmail briefing workflows", async () => {
    const draft = await buildAgentBlueprintDraft({
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

  it("includes managed workspace previews in compiled builder plans", async () => {
    const result = await compileAgentBlueprintBuilderPlan({
      brief: "Create a daily Telegram briefing from my Gmail every morning at 9am PST.",
      cfg: {
        hooks: {
          token: "hook-token",
          gmail: {
            account: "user@example.com",
            topic: "projects/test/topics/watch",
            pushToken: "push-token",
          },
        },
        channels: {
          telegram: {
            botToken: "123:abc",
            defaultTo: "-1001234567890",
          },
        },
        agents: {
          defaults: {
            model: "openai/gpt-4o",
          },
        },
      },
    });

    const entryPreview = result.workspacePreviews.find((preview) => preview.entry);
    expect(entryPreview?.files.map((file) => file.name)).toEqual(
      expect.arrayContaining(["AGENTS.md", "MEMORY.md"]),
    );
    expect(entryPreview?.files.find((file) => file.name === "MEMORY.md")?.content).toContain(
      "## Easyclaw Blueprint Memory Strategy",
    );
  });

  it("propagates explicit runtime model selections to worker nodes", async () => {
    const draft = await buildAgentBlueprintDraft({
      brief:
        "Create a webhook-driven agent that reads PDFs from my workspace and spawns a subagent to summarize them.",
      modelId: "google/gemini-3-flash",
      cfg: {
        agents: {
          defaults: {
            model: "google/gemini-3-flash",
          },
        },
      },
    });

    expect(draft.planning.topology.mode).toBe("multi-agent");
    const entryNode = draft.runtimeGraph.nodes.find((node) => node.entry);
    const workerNode = draft.runtimeGraph.nodes.find((node) => !node.entry);
    expect(entryNode?.bundle.runtime.model).toBe("google/gemini-3-flash");
    expect(workerNode?.bundle.runtime.model).toBe("google/gemini-3-flash");
  });

  it("uses an explicit builder agent name override", async () => {
    const draft = await buildAgentBlueprintDraft({
      brief: "Create a daily digest from my email and send it every morning.",
      agentName: "podcast ideas bot",
      cfg: {
        agents: {
          defaults: {
            model: "openai/gpt-4o",
          },
        },
      },
    });

    expect(draft.extracted.name).toBe("Podcast Ideas Bot");
    expect(draft.extracted.agentId).toBe("podcast-ideas-bot");
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

  it("blocks apply when a required channel is not live-runnable", async () => {
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
    ).rejects.toThrow(/Builder planner is needs_setup\./i);
  });

  it("marks WhatsApp delivery plans as needs_setup when the live listener is unavailable", async () => {
    const previousRegistry = getActivePluginRegistry();
    let previousRuntime: unknown;
    try {
      previousRuntime = getWhatsAppRuntime();
    } catch {
      previousRuntime = null;
    }
    setActivePluginRegistry(
      createTestRegistry([{ pluginId: "whatsapp", plugin: whatsappPlugin, source: "test" }]),
    );
    setWhatsAppRuntime({
      channel: {
        whatsapp: {
          webAuthExists: vi.fn(async () => true),
          readWebSelfId: vi.fn(() => ({ e164: "+15551234567", jid: "15551234567@s.whatsapp.net" })),
        },
      },
    } as never);

    try {
      const result = await verifyAgentBlueprintBuilderPlan({
        brief:
          "Read my Gmail AI newsletters every day at 9am PST and send the digest to my WhatsApp.",
        modelId: "openai/gpt-4o",
        cfg: {
          hooks: {
            token: "hook-token",
            gmail: {
              account: "user@example.com",
              topic: "projects/test/topics/watch",
              pushToken: "push-token",
            },
          },
          channels: {
            whatsapp: {
              authDir: "/tmp/wa-auth",
              defaultTo: "+15551234567",
            },
          },
          agents: {
            defaults: {
              model: "openai/gpt-4o",
            },
          },
        },
      });
      expect(result.draft.plannerStatus).toBe("needs_setup");
      const verification = result.draft.planning.verifications.find(
        (entry) => entry.id === "channel:whatsapp:status",
      );
      expect(verification).toBeTruthy();
      expect(["failed", "blocked"]).toContain(verification?.status);
      expect(verification?.detail).toMatch(
        /no active listener is running for this account|not active in this runtime yet/i,
      );
    } finally {
      if (previousRegistry) {
        setActivePluginRegistry(previousRegistry);
      }
      if (previousRuntime) {
        setWhatsAppRuntime(previousRuntime as never);
      }
    }
  });

  it("asks for a support channel when the request is support-shaped but underspecified", async () => {
    const draft = await buildAgentBlueprintDraft({
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

  it("uses channel-level Telegram bindings for support responders", async () => {
    const draft = await buildAgentBlueprintDraft({
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

  it("uses configured direct-channel defaults instead of @me", async () => {
    const draft = await buildAgentBlueprintDraft({
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

  it("uses configured Slack default targets and clears the pending delivery question", async () => {
    const draft = await buildAgentBlueprintDraft({
      brief: "Create a daily briefing and deliver it to Slack every weekday morning.",
      cfg: {
        channels: {
          slack: {
            botToken: "xoxb-test-token",
            appToken: "xapp-test-token",
            defaultTo: "channel:C0AK6RU9FFS",
          },
        },
      },
    });

    expect(draft.extracted.deliveryTarget).toBe("slack channel:C0AK6RU9FFS");
    expect(draft.questions.map((question) => question.id)).not.toContain("delivery-target");
    expect(draft.buildSpec.setupActions.map((action) => action.id)).not.toContain(
      "channel:slack:auto-default-target",
    );
    expect(draft.assumptions).toEqual(
      expect.arrayContaining(["Used configured slack default target."]),
    );
  });

  it("uses configured Slack default targets for slack-channel phrasing", async () => {
    const draft = await buildAgentBlueprintDraft({
      brief:
        "Create a research agent that uses web search for latest news on AI and send me a daily report on a slack channel at 8am PST.",
      cfg: {
        channels: {
          slack: {
            botToken: "xoxb-test-token",
            appToken: "xapp-test-token",
            defaultTo: "channel:C0AK6RU9FFS",
          },
        },
      },
    });

    expect(draft.extracted.deliveryTarget).toBe("slack channel:C0AK6RU9FFS");
    expect(draft.questions.map((question) => question.id)).not.toContain("delivery-target");
    expect(draft.buildSpec.setupActions.map((action) => action.id)).not.toContain(
      "channel:slack:auto-default-target",
    );
    expect(draft.extracted.deliveryTarget ?? "").not.toContain("{{owner_target}}");
    expect(draft.assumptions).toEqual(
      expect.arrayContaining(["Used configured slack default target."]),
    );
  });

  it("asks for an explicit destination when direct-channel defaults are missing", async () => {
    const draft = await buildAgentBlueprintDraft({
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

  it("uses explicit WhatsApp phone destination from the brief", async () => {
    const draft = await buildAgentBlueprintDraft({
      brief:
        "Create a daily briefing and deliver it to WhatsApp +14155551234 every weekday morning.",
      cfg: {
        channels: {
          whatsapp: {
            enabled: true,
          },
        },
      },
    });

    expect(draft.extracted.deliveryTarget).toBe("whatsapp +14155551234");
    expect(draft.questions.map((question) => question.id)).not.toContain("delivery-target");
    expect(draft.assumptions).toEqual(
      expect.arrayContaining(["Used explicit WhatsApp destination from your brief."]),
    );
  });

  it("keeps Gmail newsletter briefs on the Gmail plus WhatsApp path", async () => {
    const draft = await buildAgentBlueprintDraft({
      brief:
        "Read my Gmail AI newsletters, give me business ideas every day at 9am PST, and send it to WhatsApp.",
      cfg: {
        hooks: {
          token: "hook-token",
          gmail: {
            account: "user@example.com",
            topic: "projects/test/topics/watch",
            pushToken: "push-token",
          },
        },
        channels: {
          whatsapp: {
            enabled: true,
          },
        },
        agents: {
          defaults: {
            model: "openai/gpt-4o",
          },
        },
      },
    });

    expect(draft.extracted.sourceChannels).toContain("gmail");
    expect(draft.requirements.inputs.map((entry) => entry.id)).not.toContain("feed-source");
    expect(draft.planning.setupTasks.map((task) => task.connectorId)).not.toContain("tools:web");
    expect(draft.planning.selections.map((selection) => selection.connectorId)).toContain(
      "channel:whatsapp",
    );
  });

  it("adds a BuildSpec and complete managed workspace docs to builder drafts", async () => {
    const draft = await buildAgentBlueprintDraft({
      brief: "Create a daily Telegram briefing from my Gmail every morning at 9am PST.",
      cfg: {
        hooks: {
          token: "hook-token",
          gmail: {
            account: "user@example.com",
            topic: "projects/test/topics/watch",
            pushToken: "push-token",
          },
        },
        channels: {
          telegram: {
            botToken: "123:abc",
            defaultTo: "-1001234567890",
          },
        },
        agents: {
          defaults: {
            model: "openai/gpt-4o",
          },
        },
      },
    });

    expect(draft.buildSpec.contract.id).toBe("easyclaw-hybrid-planner");
    expect(draft.buildSpec.template.templateId).toBe(draft.templateId);
    expect(draft.buildSpec.workspaceArtifacts.map((artifact) => artifact.fileName)).toEqual(
      expect.arrayContaining([
        "AGENTS.md",
        "SOUL.md",
        "TOOLS.md",
        "IDENTITY.md",
        "USER.md",
        "HEARTBEAT.md",
        "MEMORY.md",
      ]),
    );
    expect(draft.bundle.workspace.bootstrapFiles ?? []).toEqual(
      expect.arrayContaining([
        "AGENTS.md",
        "SOUL.md",
        "TOOLS.md",
        "IDENTITY.md",
        "USER.md",
        "HEARTBEAT.md",
        "MEMORY.md",
      ]),
    );
  });

  it("derives first-class setup actions from pending Builder questions", async () => {
    const draft = await buildAgentBlueprintDraft({
      brief: "Create a daily Telegram briefing from my Gmail every morning at 9am PST.",
      cfg: {
        hooks: {
          token: "hook-token",
          gmail: {
            account: "user@example.com",
            topic: "projects/test/topics/watch",
            pushToken: "push-token",
          },
        },
        channels: {
          telegram: {
            botToken: "123:abc",
          },
        },
        agents: {
          defaults: {
            model: "openai/gpt-4o",
          },
        },
      },
    });

    const telegramQuestionAction = draft.buildSpec.setupActions.find(
      (action) => action.id === "channel:telegram:auto-default-target",
    );
    expect(telegramQuestionAction).toMatchObject({
      id: "channel:telegram:auto-default-target",
      connectorId: "channel:telegram",
      kind: "question",
      source: "planner-question",
      blocking: true,
    });
    expect(telegramQuestionAction?.requiredFields).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "destination" })]),
    );
    expect(telegramQuestionAction?.completionSignal).toMatchObject({
      kind: "builder-check",
      target: "delivery-target",
    });
  });

  it("hydrates a swarm runtime graph when the planner emits one", async () => {
    plannerAgentTesting.setResolvePlannerModelForTest(async () => ({
      provider: "openai",
      model: "gpt-5.4",
      modelRef: "openai/gpt-5.4",
      source: "preferred-configured-reasoning-model",
      resolvedModel: {} as never,
      apiKey: "sk-test",
    }));
    plannerAgentTesting.setPlannerModelRunnerForTest(async () =>
      JSON.stringify({
        graph: {
          mode: "swarm",
          entryNodeId: "orchestrator",
          nodes: [
            {
              id: "orchestrator",
              roleId: "orchestrator",
              label: "Opportunity Orchestrator",
              entry: true,
              contractIds: ["agent.manage", "delivery.report", "message.send"],
              connectorIds: ["channel:whatsapp", "tools:sessions"],
              responsibilities: ["Coordinate scouts and analysts."],
            },
            {
              id: "scout",
              roleId: "scout",
              label: "Signal Scout",
              entry: false,
              contractIds: ["ingest.email"],
              connectorIds: ["platform:gmail-hook"],
              responsibilities: ["Read Gmail newsletters and collect signals."],
            },
            {
              id: "analyst",
              roleId: "analyst",
              label: "Opportunity Analyst",
              entry: false,
              contractIds: ["transform.summarize"],
              connectorIds: ["platform:core-model"],
              responsibilities: ["Turn signals into ranked business opportunities."],
            },
          ],
          edges: [
            {
              id: "orchestrator->scout",
              fromNodeId: "orchestrator",
              toNodeId: "scout",
              kind: "delegates",
              label: "Scout for signals",
            },
            {
              id: "scout->analyst",
              fromNodeId: "scout",
              toNodeId: "analyst",
              kind: "feeds",
              label: "Feed candidate signals",
            },
            {
              id: "orchestrator->analyst",
              fromNodeId: "orchestrator",
              toNodeId: "analyst",
              kind: "delegates",
              label: "Hand off the final ranking task",
            },
          ],
        },
      }),
    );

    const draft = await buildAgentBlueprintDraft({
      brief:
        "Read my Gmail AI newsletters, give me business ideas every day at 9am PST, and send it to WhatsApp.",
      cfg: {
        hooks: {
          token: "hook-token",
          gmail: {
            account: "user@example.com",
            topic: "projects/test/topics/watch",
            pushToken: "push-token",
          },
        },
        channels: {
          whatsapp: {
            enabled: true,
          },
        },
        agents: {
          defaults: {
            model: "openai/gpt-4o",
          },
        },
      },
    });

    expect(draft.buildSpec.planner.mode).toBe("model-backed");
    expect(draft.planning.graph.mode).toBe("swarm");
    expect(draft.runtimeGraph.nodes).toHaveLength(3);
    expect(draft.runtimeGraph.edges.map((edge) => edge.kind)).toEqual(
      expect.arrayContaining(["delegates", "feeds"]),
    );
  });

  it("captures mixed-source builder requirements for messy real-world briefs", async () => {
    const draft = await buildAgentBlueprintDraft({
      brief:
        "Every weekday at 9am PST, read my Gmail AI newsletters and the PDF notes in my workspace, extract startup ideas, and send me the best ones on WhatsApp.",
      cfg: {
        hooks: {
          token: "hook-token",
          gmail: {
            account: "user@example.com",
            topic: "projects/test/topics/watch",
            pushToken: "push-token",
          },
        },
        channels: {
          whatsapp: {
            enabled: true,
          },
        },
        agents: {
          defaults: {
            model: "openai/gpt-4o",
          },
        },
      },
    });

    expect(draft.requirements.inputs.map((entry) => entry.id)).toEqual(
      expect.arrayContaining(["email-source", "file-source"]),
    );
    expect(draft.planning.selections.map((selection) => selection.connectorId)).toEqual(
      expect.arrayContaining(["platform:gmail-hook", "tools:fs", "channel:whatsapp"]),
    );
    expect(["configured", "authenticated", "verified"]).toContain(
      draft.planning.integrations.find(
        (integration) => integration.connectorId === "channel:whatsapp",
      )?.status,
    );
    expect(draft.buildSpec.schedule.timezone).toBe("America/Los_Angeles");
  });

  it("defaults to the personal assistant template and creates a dedicated agent", async () => {
    const draft = await buildAgentBlueprintDraft({
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

  it("reports risky browser actions as unsafe without approval routing", async () => {
    const draft = await buildAgentBlueprintDraft({
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

  it("shapes webhook-driven operator workflows from extracted requirements", async () => {
    const draft = await buildAgentBlueprintDraft({
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

  it("normalizes PST schedule requests to the Pacific timezone", () => {
    expect(
      __testing.inferSchedule("Read my Gmail newsletter every day at 9am PST and send me a brief"),
    ).toEqual({
      cron: "0 9 * * *",
      description: "Daily at 9:00 AM Pacific Time",
      timezone: "America/Los_Angeles",
      timezoneLabel: "Pacific Time",
      assumed: false,
    });
  });
});
