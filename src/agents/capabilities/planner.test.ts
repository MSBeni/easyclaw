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
  });
});
