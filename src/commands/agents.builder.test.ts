import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentsBuilderApplyCommand, agentsBuilderPlanCommand } from "./agents.js";
import { createTestRuntime } from "./test-runtime-config-helpers.js";

const readConfigFileSnapshotMock = vi.hoisted(() => vi.fn());
const compileAgentBlueprintBuilderPlanMock = vi.hoisted(() => vi.fn());
const applyAgentBlueprintBuilderPlanMock = vi.hoisted(() => vi.fn());

vi.mock("../config/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config/config.js")>()),
  readConfigFileSnapshot: readConfigFileSnapshotMock,
}));

vi.mock("../agents/blueprints/builder.js", () => ({
  compileAgentBlueprintBuilderPlan: compileAgentBlueprintBuilderPlanMock,
  applyAgentBlueprintBuilderPlan: applyAgentBlueprintBuilderPlanMock,
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
});
