import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  agentsBuilderApplyCommand,
  agentsBuilderPlanCommand,
  agentsBuilderVerifyCommand,
} from "./agents.js";
import { createTestRuntime } from "./test-runtime-config-helpers.js";

const readConfigFileSnapshotMock = vi.hoisted(() => vi.fn());
const compileAgentBlueprintBuilderPlanMock = vi.hoisted(() => vi.fn());
const applyAgentBlueprintBuilderPlanMock = vi.hoisted(() => vi.fn());
const verifyAgentBlueprintBuilderPlanMock = vi.hoisted(() => vi.fn());

vi.mock("../config/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config/config.js")>()),
  readConfigFileSnapshot: readConfigFileSnapshotMock,
}));

vi.mock("../agents/blueprints/builder.js", () => ({
  compileAgentBlueprintBuilderPlan: compileAgentBlueprintBuilderPlanMock,
  applyAgentBlueprintBuilderPlan: applyAgentBlueprintBuilderPlanMock,
  verifyAgentBlueprintBuilderPlan: verifyAgentBlueprintBuilderPlanMock,
}));

const runtime = createTestRuntime();

describe("agents builder commands", () => {
  beforeEach(() => {
    runtime.log.mockClear();
    runtime.error.mockClear();
    runtime.exit.mockClear();
    readConfigFileSnapshotMock.mockReset();
    compileAgentBlueprintBuilderPlanMock.mockReset();
    applyAgentBlueprintBuilderPlanMock.mockReset();
    verifyAgentBlueprintBuilderPlanMock.mockReset();
    readConfigFileSnapshotMock.mockResolvedValue({
      valid: true,
      config: {},
    });
  });

  it("prints the builder plan and exits non-zero when follow-up answers are required", async () => {
    compileAgentBlueprintBuilderPlanMock.mockResolvedValue({
      draft: {
        brief: "Build me a support bot",
        templateId: "support-responder",
        displayName: "Support Responder",
        confidence: "high",
        plannerStatus: "needs_input",
        reasons: ["Matched support language."],
        assumptions: [],
        questions: [
          {
            id: "binding-channel",
            prompt: "Which channel should this support responder watch?",
            required: true,
          },
        ],
        ready: false,
        requirements: {
          confidence: "medium",
          workflow: {
            primaryGoal: "support",
            executionMode: "bound-channel",
            triggerKinds: ["chat-ingress"],
            sourceKinds: [],
            transformKinds: [],
            actionKinds: [],
            deliveryKinds: [],
            requiresApproval: false,
          },
          intentTags: ["support"],
          triggers: [],
          inputs: [],
          transforms: [],
          decisions: [],
          actions: [],
          outputs: [],
          policies: [],
          constraints: [],
          missingInputs: [
            {
              code: "question:binding-channel",
              message: "Which channel should this support responder watch?",
            },
          ],
          setupGaps: [],
          policyGaps: [],
          unsupportedGaps: [],
          ambiguities: ["The workflow looks support-oriented, but no inbound channel was named."],
          unsupportedRequests: [],
          unsupportedClassifications: [],
          missingDataFields: ["binding-channel"],
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
          alternatives: [],
          variants: [],
          integrations: [
            {
              connectorId: "channel:telegram",
              instanceId: "channel:telegram",
              status: "discovered",
              configRefs: ["channels.telegram"],
              authRefs: ["channels.telegram"],
              issues: ["channel telegram is not configured"],
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
              status: "pending",
              title: "Connect Telegram",
              detail: "channel telegram is not configured",
              refs: ["channels.telegram"],
            },
          ],
          verifications: [
            {
              id: "channel:telegram:status",
              connectorId: "channel:telegram",
              connectorLabel: "Telegram",
              probeKind: "status",
              probeLabel: "Status probe",
              status: "blocked",
              detail: "channel telegram is not configured",
            },
          ],
          topology: {
            mode: "single-agent",
            reason: "Current constraints fit a single coordinating agent.",
            roles: [],
          },
          graph: {
            mode: "single-agent",
            entryNodeId: "primary",
            nodes: [],
            edges: [],
          },
        },
        extracted: {
          agentId: "support",
          name: "Support",
          ingressChannels: [],
          sourceChannels: [],
          deliveryTarget: null,
          schedule: null,
        },
      },
      plan: {
        manifest: {
          templateId: "support-responder",
          displayName: "Support Responder",
          version: "0.1.0",
          summary: "Support",
        },
        status: "ready",
        issues: [],
        agent: {
          agentId: "support",
          name: "Support",
          workspaceDir: "/tmp/workspace",
          agentDir: "/tmp/agent",
          modelSelection: { mode: "prompt-user" },
        },
        workspace: { notes: [], bootstrapFiles: [] },
        runtime: {
          skills: [],
          tools: {
            profile: "messaging",
            allow: null,
            deny: [],
            customAllow: [],
            customDeny: [],
            byProvider: {},
          },
        },
        routing: { bindings: [], sources: [] },
        automation: { schedules: [] },
        delivery: { targetSummary: null },
        validation: {
          prerequisites: [],
          readinessChecks: [],
          smokePrompts: [],
          successCriteria: [],
        },
      },
      graphPlans: [],
    });

    await agentsBuilderPlanCommand({ brief: "Build me a support bot" }, runtime);

    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("Builder selection:"));
    expect(runtime.exit).toHaveBeenCalledWith(1);
  });

  it("requires --yes before apply", async () => {
    await agentsBuilderApplyCommand({ brief: "Create me a daily digest" }, runtime);

    expect(runtime.error).toHaveBeenCalledWith(expect.stringContaining("Apply requires --yes"));
    expect(applyAgentBlueprintBuilderPlanMock).not.toHaveBeenCalled();
  });

  it("applies a builder-generated blueprint and logs the summary", async () => {
    applyAgentBlueprintBuilderPlanMock.mockResolvedValue({
      draft: {
        brief: "Create me a daily digest",
        templateId: "daily-briefing",
        displayName: "Daily Briefing Agent",
        confidence: "high",
        plannerStatus: "ready",
        reasons: ["Matched digest language."],
        assumptions: ["Defaulted digest delivery to Telegram @me."],
        questions: [],
        ready: true,
        requirements: {
          confidence: "high",
          workflow: {
            primaryGoal: "briefing",
            executionMode: "scheduled",
            triggerKinds: ["schedule"],
            sourceKinds: ["email-source"],
            transformKinds: ["summary-transform"],
            actionKinds: [],
            deliveryKinds: ["report-output"],
            requiresApproval: false,
          },
          intentTags: ["scheduled", "summary"],
          triggers: [{ detail: "Run on a recurring schedule." }],
          inputs: [{ detail: "Read messages from a configured Gmail or inbox hook." }],
          transforms: [{ detail: "Condense source material into a digest or briefing." }],
          decisions: [],
          actions: [],
          outputs: [{ detail: "Deliver the result as a digest or briefing." }],
          policies: [],
          constraints: [],
          missingInputs: [],
          setupGaps: [],
          policyGaps: [],
          unsupportedGaps: [],
          ambiguities: [],
          unsupportedRequests: [],
          unsupportedClassifications: [],
          missingDataFields: [],
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
          alternatives: [],
          variants: [],
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
          topology: {
            mode: "single-agent",
            reason: "Current constraints fit a single coordinating agent.",
            roles: [],
          },
          graph: {
            mode: "single-agent",
            entryNodeId: "primary",
            nodes: [],
            edges: [],
          },
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
      result: {
        status: "applied",
        source: { kind: "builder", value: "daily-briefing", format: null },
        plan: {
          manifest: {
            templateId: "daily-briefing",
            displayName: "Daily Briefing Agent",
            version: "0.1.0",
            summary: "Digest",
          },
        },
        templateVariables: {
          values: {},
          resolved: [],
        },
        configPath: "/tmp/openclaw.json",
        agent: {
          agentId: "daily-briefing",
          name: "Morning Brief",
          workspaceDir: "/tmp/workspace",
          agentDir: "/tmp/agent",
        },
        workspace: {
          metadataPath: "/tmp/agent/easyclaw-blueprint.json",
          files: [],
        },
        bindings: {
          removed: [],
          added: [],
          updated: [],
          skipped: [],
          conflicts: [],
          ignored: [],
        },
        automation: { jobs: [] },
        warnings: [],
      },
      graphResults: [],
    });

    await agentsBuilderApplyCommand(
      {
        brief: "Create me a daily digest",
        yes: true,
      },
      runtime,
    );

    expect(applyAgentBlueprintBuilderPlanMock).toHaveBeenCalledWith({
      brief: "Create me a daily digest",
      cfg: {},
    });
    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("Applied blueprint"));
  });

  it("runs live verification and exits non-zero when probes fail", async () => {
    verifyAgentBlueprintBuilderPlanMock.mockResolvedValue({
      draft: {
        brief: "Create a support bot on Telegram",
        templateId: "support-responder",
        displayName: "Support Responder",
        confidence: "high",
        plannerStatus: "needs_setup",
        reasons: ["Matched support language."],
        assumptions: [],
        questions: [],
        ready: false,
        requirements: {
          confidence: "medium",
          workflow: {
            primaryGoal: "support",
            executionMode: "bound-channel",
            triggerKinds: ["chat-ingress"],
            sourceKinds: [],
            transformKinds: [],
            actionKinds: [],
            deliveryKinds: [],
            requiresApproval: false,
          },
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
          ambiguities: [],
          unsupportedRequests: [],
          unsupportedClassifications: [],
          missingDataFields: [],
        },
        planning: {
          selections: [],
          alternatives: [],
          variants: [],
          integrations: [
            {
              connectorId: "channel:telegram",
              instanceId: "channel:telegram",
              status: "degraded",
              configRefs: ["channels.telegram"],
              authRefs: ["channels.telegram"],
              issues: ["Live verification failed for Status probe: unauthorized"],
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
              status: "failed",
              detail: "unauthorized",
              source: "live",
              checkedAt: "2026-03-18T12:00:00.000Z",
            },
          ],
          topology: {
            mode: "single-agent",
            reason: "Current constraints fit a single coordinating agent.",
            roles: [],
          },
          graph: {
            mode: "single-agent",
            entryNodeId: "primary",
            nodes: [],
            edges: [],
          },
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
        passedCount: 0,
        failedCount: 1,
        blockedCount: 0,
        unresolvedCount: 0,
        results: [],
      },
      plan: {
        manifest: {
          templateId: "support-responder",
          displayName: "Support Responder",
          version: "0.1.0",
          summary: "Support",
        },
        status: "ready",
        issues: [],
        agent: {
          agentId: "support",
          name: "Support",
          workspaceDir: "/tmp/workspace",
          agentDir: "/tmp/agent",
          modelSelection: { mode: "prompt-user" },
        },
        workspace: { notes: [], bootstrapFiles: [] },
        runtime: {
          skills: [],
          tools: {
            profile: "messaging",
            allow: null,
            deny: [],
            customAllow: [],
            customDeny: [],
            byProvider: {},
          },
        },
        routing: { bindings: [], sources: [] },
        automation: { schedules: [] },
        delivery: { targetSummary: null },
        validation: {
          prerequisites: [],
          readinessChecks: [],
          smokePrompts: [],
          successCriteria: [],
        },
      },
      graphPlans: [],
    });

    await agentsBuilderVerifyCommand({ brief: "Create a support bot on Telegram" }, runtime);

    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("Live verification:"));
    expect(runtime.exit).toHaveBeenCalledWith(1);
  });
});
