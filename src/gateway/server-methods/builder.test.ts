import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../protocol/index.js";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(() => ({ agents: { default: "main" } })),
  compileAgentBlueprintBuilderPlan: vi.fn(),
  applyAgentBlueprintBuilderPlan: vi.fn(),
  verifyAgentBlueprintBuilderPlan: vi.fn(),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock("../../agents/blueprints/builder.js", () => ({
  compileAgentBlueprintBuilderPlan: mocks.compileAgentBlueprintBuilderPlan,
  applyAgentBlueprintBuilderPlan: mocks.applyAgentBlueprintBuilderPlan,
  verifyAgentBlueprintBuilderPlan: mocks.verifyAgentBlueprintBuilderPlan,
}));

const { builderHandlers } = await import("./builder.js");

type RespondCall = [boolean, unknown?, { code: number; message: string }?];

function createInvokeParams(method: keyof typeof builderHandlers, params: Record<string, unknown>) {
  const respond = vi.fn();
  return {
    respond,
    invoke: async () =>
      await builderHandlers[method]({
        params,
        respond: respond as never,
        context: {} as never,
        client: null,
        req: { type: "req", id: "req-1", method },
        isWebchatConnect: () => false,
      }),
  };
}

describe("builder gateway handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects plans without a brief", async () => {
    const { respond, invoke } = createInvokeParams("agents.builder.plan", {});
    await invoke();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(false);
    expect(call?.[2]?.code).toBe(ErrorCodes.INVALID_REQUEST);
  });

  it("returns a builder plan", async () => {
    mocks.compileAgentBlueprintBuilderPlan.mockResolvedValue({
      draft: {
        brief: "Create me a daily digest",
        templateId: "daily-briefing",
        displayName: "Daily Briefing Agent",
        confidence: "high",
        plannerStatus: "ready",
        reasons: ["Matched digest language."],
        assumptions: [],
        questions: [],
        ready: true,
        requirements: {
          intentTags: ["scheduled", "summary"],
          triggers: [],
          inputs: [],
          transforms: [],
          decisions: [],
          actions: [],
          outputs: [],
          policies: [],
          constraints: [],
          missingInputs: [],
          setupGaps: [],
          policyGaps: [],
          unsupportedGaps: [],
        },
        planning: {
          selections: [
            {
              requirementId: "schedule",
              requirementLabel: "Scheduled Trigger",
              contractIds: ["schedule.trigger"],
              connectorId: "tools:automation",
              connectorLabel: "OpenClaw Automation Tools",
              source: "explicit",
            },
          ],
          integrations: [
            {
              connectorId: "tools:automation",
              instanceId: "tools:automation",
              status: "installed",
              configRefs: ["cron.enabled"],
              authRefs: [],
              issues: [],
              label: "OpenClaw Automation Tools",
              kind: "tooling",
              sourceKind: "core_tool_section",
              contracts: ["schedule.trigger"],
              verification: [],
            },
          ],
          setupTasks: [
            {
              id: "tools:automation:setup",
              connectorId: "tools:automation",
              connectorLabel: "OpenClaw Automation Tools",
              kind: "configure",
              status: "completed",
              title: "OpenClaw Automation Tools configured",
              detail: "OpenClaw Automation Tools is ready for this workflow.",
              refs: ["cron.enabled"],
            },
          ],
          verifications: [],
        },
        extracted: {
          agentId: "daily-briefing",
          name: "Morning Brief",
          ingressChannels: [],
          sourceChannels: ["gmail"],
          deliveryTarget: "telegram @me",
          schedule: "weekday-morning-brief: 0 9 * * 1-5",
        },
      },
      plan: {
        status: "ready",
      },
    });

    const { respond, invoke } = createInvokeParams("agents.builder.plan", {
      brief: "Create me a daily digest",
      templateId: "daily-briefing",
    });
    await invoke();

    expect(mocks.compileAgentBlueprintBuilderPlan).toHaveBeenCalledWith({
      brief: "Create me a daily digest",
      templateId: "daily-briefing",
      cfg: { agents: { default: "main" } },
    });
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        draft: expect.objectContaining({ templateId: "daily-briefing" }),
      }),
    );
  });

  it("applies a builder-generated blueprint", async () => {
    mocks.applyAgentBlueprintBuilderPlan.mockResolvedValue({
      draft: {
        brief: "Create a support bot on Telegram",
        templateId: "support-responder",
        displayName: "Support Responder",
        confidence: "high",
        plannerStatus: "ready",
        reasons: ["Matched support language."],
        assumptions: [],
        questions: [],
        ready: true,
        requirements: {
          intentTags: ["support"],
          triggers: [],
          inputs: [],
          transforms: [],
          decisions: [],
          actions: [],
          outputs: [],
          policies: [],
          constraints: [],
          missingInputs: [],
          setupGaps: [],
          policyGaps: [],
          unsupportedGaps: [],
        },
        planning: {
          selections: [
            {
              requirementId: "chat-ingress",
              requirementLabel: "Chat Ingress",
              contractIds: ["ingress.chat"],
              connectorId: "channel:telegram",
              connectorLabel: "Telegram",
              source: "explicit",
            },
          ],
          integrations: [
            {
              connectorId: "channel:telegram",
              instanceId: "channel:telegram",
              status: "authenticated",
              configRefs: ["channels.telegram"],
              authRefs: ["channels.telegram"],
              issues: [],
              label: "Telegram",
              kind: "channel",
              sourceKind: "builtin_channel",
              contracts: ["ingress.chat", "delivery.chat", "message.send"],
              verification: [],
            },
          ],
          setupTasks: [
            {
              id: "channel:telegram:setup",
              connectorId: "channel:telegram",
              connectorLabel: "Telegram",
              kind: "connect",
              status: "completed",
              title: "Telegram connected",
              detail: "Telegram is connected and available to this workflow.",
              refs: ["channels.telegram"],
            },
          ],
          verifications: [],
        },
        extracted: {
          agentId: "support",
          name: "Support",
          ingressChannels: ["telegram"],
          sourceChannels: [],
          deliveryTarget: null,
          schedule: null,
        },
      },
      result: {
        status: "applied",
        agent: {
          agentId: "support",
          name: "Support",
        },
      },
    });

    const { respond, invoke } = createInvokeParams("agents.builder.apply", {
      brief: "Create a support bot on Telegram",
    });
    await invoke();

    expect(mocks.applyAgentBlueprintBuilderPlan).toHaveBeenCalledWith({
      brief: "Create a support bot on Telegram",
      cfg: { agents: { default: "main" } },
    });
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({
          agent: expect.objectContaining({ agentId: "support" }),
        }),
      }),
    );
  });

  it("runs live verification for a builder plan", async () => {
    mocks.verifyAgentBlueprintBuilderPlan.mockResolvedValue({
      draft: {
        brief: "Create a support bot on Telegram",
        templateId: "support-responder",
        displayName: "Support Responder",
        confidence: "high",
        plannerStatus: "ready",
        reasons: ["Matched support language."],
        assumptions: [],
        questions: [],
        ready: true,
        requirements: {
          intentTags: ["support"],
          triggers: [],
          inputs: [],
          transforms: [],
          decisions: [],
          actions: [],
          outputs: [],
          policies: [],
          constraints: [],
          missingInputs: [],
          setupGaps: [],
          policyGaps: [],
          unsupportedGaps: [],
        },
        planning: {
          selections: [],
          integrations: [
            {
              connectorId: "channel:telegram",
              instanceId: "channel:telegram",
              status: "verified",
              configRefs: ["channels.telegram"],
              authRefs: ["channels.telegram"],
              issues: [],
              lastVerifiedAt: "2026-03-18T12:00:00.000Z",
              label: "Telegram",
              kind: "channel",
              sourceKind: "builtin_channel",
              contracts: ["ingress.chat", "delivery.chat", "message.send"],
              verification: [],
            },
          ],
          setupTasks: [],
          verifications: [
            {
              id: "channel:telegram:status",
              connectorId: "channel:telegram",
              connectorLabel: "Telegram",
              probeKind: "status",
              probeLabel: "Status probe",
              status: "passed",
              detail: "Telegram responded to a live account probe successfully.",
              source: "live",
              checkedAt: "2026-03-18T12:00:00.000Z",
            },
          ],
        },
        extracted: {
          agentId: "support",
          name: "Support",
          ingressChannels: ["telegram"],
          sourceChannels: [],
          deliveryTarget: null,
          schedule: null,
        },
      },
      verification: {
        fingerprint: "abc123",
        checkedAt: "2026-03-18T12:00:00.000Z",
        passedCount: 1,
        failedCount: 0,
        blockedCount: 0,
        unresolvedCount: 0,
        results: [],
      },
      plan: {
        status: "ready",
      },
    });

    const { respond, invoke } = createInvokeParams("agents.builder.verify", {
      brief: "Create a support bot on Telegram",
    });
    await invoke();

    expect(mocks.verifyAgentBlueprintBuilderPlan).toHaveBeenCalledWith({
      brief: "Create a support bot on Telegram",
      cfg: { agents: { default: "main" } },
    });
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        verification: expect.objectContaining({
          passedCount: 1,
        }),
      }),
    );
  });
});
