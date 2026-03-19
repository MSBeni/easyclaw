import { describe, expect, it } from "vitest";
import { buildRequirementPlannerResult } from "./planner.js";
import { buildRequirementSet } from "./requirements.js";

describe("capability planner", () => {
  it("selects concrete connectors for a scheduled digest workflow", () => {
    const requirements = buildRequirementSet({
      brief:
        "Create a bot that summarizes my daily emails and posts them to Slack #ops every morning at 9am.",
      cfg: {},
    });
    const plan = buildRequirementPlannerResult({
      requirements,
      cfg: {},
    });

    expect(plan.selections.map((selection) => selection.connectorId)).toEqual(
      expect.arrayContaining([
        "platform:core-model",
        "platform:gmail-hook",
        "channel:slack",
        "tools:automation",
      ]),
    );
    expect(
      plan.integrations.find((integration) => integration.connectorId === "channel:slack")?.status,
    ).toBe("discovered");
    expect(
      plan.integrations.find((integration) => integration.connectorId === "platform:gmail-hook")
        ?.status,
    ).toBe("discovered");
    expect(plan.setupTasks.map((task) => task.connectorId)).toEqual(
      expect.arrayContaining(["channel:slack", "platform:gmail-hook"]),
    );
    expect(
      plan.verifications.find(
        (result) => result.connectorId === "platform:gmail-hook" && result.probeKind === "status",
      )?.status,
    ).toBe("blocked");
    expect(plan.topology.mode).toBe("single-agent");
    expect(
      plan.alternatives.find((alternative) => alternative.requirementId === "message-output")
        ?.candidates.length,
    ).toBeGreaterThan(0);
  });

  it("marks configured integrations as authenticated or configured", () => {
    const cfg = {
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
    };
    const requirements = buildRequirementSet({
      brief: "Create a daily Telegram briefing from my Gmail every morning at 9am.",
      cfg,
    });
    const plan = buildRequirementPlannerResult({
      requirements,
      cfg,
    });

    expect(
      plan.integrations.find((integration) => integration.connectorId === "channel:telegram")
        ?.status,
    ).toBe("authenticated");
    expect(
      plan.integrations.find((integration) => integration.connectorId === "platform:gmail-hook")
        ?.status,
    ).toBe("authenticated");
    expect(plan.setupTasks.find((task) => task.connectorId === "platform:gmail-hook")?.status).toBe(
      "completed",
    );
    expect(
      plan.verifications.find(
        (result) => result.connectorId === "platform:gmail-hook" && result.probeKind === "status",
      )?.status,
    ).toBe("passed");
    expect(
      plan.alternatives.find((alternative) => alternative.requirementId === "message-output")
        ?.selectedConnectorIds,
    ).toContain("channel:telegram");
  });

  it("selects approval and browser connectors for delegated risky actions", () => {
    const requirements = buildRequirementSet({
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
    const plan = buildRequirementPlannerResult({
      requirements,
      cfg: {
        channels: {
          telegram: {
            botToken: "123:abc",
          },
        },
      },
    });

    expect(plan.selections.map((selection) => selection.connectorId)).toEqual(
      expect.arrayContaining(["platform:exec-approvals", "tools:ui"]),
    );
    expect(
      plan.integrations.find((integration) => integration.connectorId === "platform:exec-approvals")
        ?.status,
    ).toBe("discovered");
    expect(
      plan.setupTasks.find((task) => task.connectorId === "platform:exec-approvals")?.kind,
    ).toBe("policy");
    expect(plan.topology.mode).toBe("multi-agent");
  });

  it("keeps explicit fallback candidates per requirement", () => {
    const requirements = buildRequirementSet({
      brief: "Create a daily summary bot that sends the result to Telegram.",
      cfg: {},
    });
    const plan = buildRequirementPlannerResult({
      requirements,
      cfg: {},
    });

    const outputAlternatives = plan.alternatives.find(
      (alternative) => alternative.requirementId === "message-output",
    );
    expect(outputAlternatives?.selectedConnectorIds).toEqual(["channel:telegram"]);
    expect(outputAlternatives?.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          connectorId: "channel:telegram",
          selected: true,
          source: "explicit",
        }),
      ]),
    );
    expect(plan.variants.length).toBeGreaterThan(0);
    expect(plan.variants[0]?.selected).toBe(true);
  });

  it("switches to a multi-agent topology when delegation is explicit", () => {
    const requirements = buildRequirementSet({
      brief:
        "Create a webhook-driven agent that reads PDFs from my workspace, checks memory for prior context, and spawns a subagent to summarize them.",
      cfg: {
        hooks: {
          token: "hook-token",
        },
      },
    });
    const plan = buildRequirementPlannerResult({
      requirements,
      cfg: {
        hooks: {
          token: "hook-token",
        },
      },
    });

    expect(requirements.sourceConstraints.map((constraint) => constraint.id)).toEqual(
      expect.arrayContaining(["source:file", "source:memory"]),
    );
    expect(requirements.actionConstraints.map((constraint) => constraint.id)).toContain(
      "action:delegate-subagent",
    );
    expect(plan.topology.mode).toBe("multi-agent");
    expect(plan.topology.roles.map((role) => role.id)).toEqual(
      expect.arrayContaining(["coordinator", "worker"]),
    );
  });

  it("builds multiple viable end-to-end plan variants", () => {
    const requirements = buildRequirementSet({
      brief: "Create a daily summary bot that sends the result to Telegram or Slack.",
      cfg: {},
    });
    const plan = buildRequirementPlannerResult({
      requirements,
      cfg: {},
    });

    expect(plan.variants.length).toBeGreaterThan(1);
    expect(plan.variants.map((variant) => variant.connectorIds.join(","))).toEqual(
      expect.arrayContaining([
        expect.stringContaining("channel:telegram"),
        expect.stringContaining("channel:slack"),
      ]),
    );
  });
});
