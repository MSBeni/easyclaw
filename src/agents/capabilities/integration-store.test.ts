import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  hydrateRequirementPlannerIntegrationState,
  writePlannerIntegrations,
} from "./integration-store.js";
import { buildRequirementPlannerResult } from "./planner.js";
import { buildRequirementSet } from "./requirements.js";

function createTestEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "easyclaw-capability-integrations-"));
  return {
    root,
    env: {
      ...process.env,
      OPENCLAW_STATE_DIR: path.join(root, "state"),
      OPENCLAW_TEST_FAST: "1",
      HOME: root,
    } as NodeJS.ProcessEnv,
  };
}

describe("capability integration store", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("hydrates persisted integration state back into later planner runs", async () => {
    const { root, env } = createTestEnv();
    roots.push(root);
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
    const basePlan = buildRequirementPlannerResult({
      requirements,
      cfg,
    });
    const updatedIntegrations = basePlan.integrations.map((integration) =>
      integration.connectorId === "channel:telegram"
        ? {
            ...integration,
            status: "verified" as const,
            lastVerifiedAt: "2026-03-18T12:00:00.000Z",
            issues: [],
          }
        : integration,
    );

    await writePlannerIntegrations({
      integrations: updatedIntegrations,
      env,
    });

    const hydrated = await hydrateRequirementPlannerIntegrationState(basePlan, env);

    expect(
      hydrated.integrations.find((integration) => integration.connectorId === "channel:telegram")
        ?.status,
    ).toBe("verified");
    expect(
      hydrated.verifications.find(
        (result) => result.connectorId === "channel:telegram" && result.probeKind === "status",
      )?.status,
    ).toBe("passed");
    expect(
      hydrated.integrations.find((integration) => integration.connectorId === "channel:telegram")
        ?.lastVerifiedAt,
    ).toBe("2026-03-18T12:00:00.000Z");
  });
});
