import { describe, expect, it } from "vitest";
import { resolveAgentWorkspaceDir } from "../agent-scope.js";
import { compileAgentBlueprintPlan } from "./compiler.js";
import { dailyBriefingBlueprint, personalAssistantBlueprint } from "./examples.js";
import type { AgentBlueprintBundle } from "./schema.js";

describe("agent blueprint compiler", () => {
  it("builds a ready dry-run plan for the daily briefing template", async () => {
    const plan = await compileAgentBlueprintPlan({
      bundle: dailyBriefingBlueprint,
      cfg: {},
      source: {
        kind: "template",
        value: dailyBriefingBlueprintId(),
        format: null,
      },
    });

    expect(plan.status).toBe("ready");
    expect(plan.agent.agentId).toBe("daily-briefing");
    expect(plan.agent.workspaceDir).toBe(resolveAgentWorkspaceDir({}, "daily-briefing"));
    expect(plan.runtime.tools.profile).toBe("messaging");
    expect(plan.runtime.tools.allow).toContain("message");
    expect(plan.runtime.tools.allow).toContain("cron");
    expect(plan.delivery.targetSummary).toBe("channel=telegram, to={{owner_target}}");
    expect(plan.workspace.bootstrapFiles.map((file) => file.name)).toEqual([
      "AGENTS.md",
      "SOUL.md",
      "TOOLS.md",
      "HEARTBEAT.md",
    ]);
  });

  it("marks scheduled agents without schedules as invalid", async () => {
    const bundle: AgentBlueprintBundle = structuredClone(dailyBriefingBlueprint);
    delete bundle.automation;

    const plan = await compileAgentBlueprintPlan({ bundle, cfg: {} });

    expect(plan.status).toBe("invalid");
    expect(plan.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          code: "scheduled-without-schedule",
        }),
      ]),
    );
  });

  it("warns when a thread binding cannot yet map to route config", async () => {
    const bundle: AgentBlueprintBundle = structuredClone(personalAssistantBlueprint);
    bundle.ingress = {
      interactionMode: "bound-channel",
      bindings: [{ channel: "telegram", thread: true }],
    };

    const plan = await compileAgentBlueprintPlan({ bundle, cfg: {} });

    expect(plan.status).toBe("ready");
    expect(plan.routing.bindings[0]?.routeBinding).toBeUndefined();
    expect(plan.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          code: "thread-binding-not-yet-materialized",
        }),
      ]),
    );
  });

  it("uses prompt-user model selection when the template defers model choice", async () => {
    const plan = await compileAgentBlueprintPlan({
      bundle: personalAssistantBlueprint,
      cfg: {},
    });

    expect(plan.agent.modelSelection).toEqual({ mode: "prompt-user" });
  });
});

function dailyBriefingBlueprintId() {
  return "daily-briefing";
}
