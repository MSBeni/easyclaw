import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PluginRuntime } from "openclaw/plugin-sdk/telegram";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { telegramPlugin } from "../../../extensions/telegram/src/channel.js";
import { setActivePluginRegistry } from "../../plugins/runtime.js";
import { createTestRegistry } from "../../test-utils/channel-plugins.js";
import { buildRequirementPlannerResult } from "./planner.js";
import { buildRequirementSet } from "./requirements.js";
import { readPlannerVerificationResults } from "./verification-store.js";
import {
  __testing,
  hydrateRequirementPlannerVerificationState,
  runRequirementPlannerLiveVerification,
} from "./verification.js";

let createPluginRuntime: typeof import("../../plugins/runtime/index.js").createPluginRuntime;
let setTelegramRuntime: typeof import("../../../extensions/telegram/src/runtime.js").setTelegramRuntime;

function installTelegramProbeRuntime() {
  const probeTelegram = vi.fn(async () => ({
    ok: true,
    bot: { username: "builder_bot" },
    elapsedMs: 1,
  }));
  setTelegramRuntime({
    channel: {
      telegram: {
        probeTelegram,
      },
    },
    logging: {
      shouldLogVerbose: () => false,
    },
  } as unknown as PluginRuntime);
  return { probeTelegram };
}

describe("capability verification", () => {
  beforeAll(async () => {
    ({ createPluginRuntime } = await import("../../plugins/runtime/index.js"));
    ({ setTelegramRuntime } = await import("../../../extensions/telegram/src/runtime.js"));
  });

  beforeEach(() => {
    setActivePluginRegistry(
      createTestRegistry([{ pluginId: "telegram", plugin: telegramPlugin, source: "test" }]),
    );
    setTelegramRuntime(createPluginRuntime());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("persists live verification results for internal runtime connectors", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-capability-live-"));
    const env = {
      ...process.env,
      OPENCLAW_TEST_FAST: "1",
      OPENCLAW_STATE_DIR: stateDir,
    };
    const requirements = buildRequirementSet({
      brief: "Create a weekly digest agent that summarizes updates every Monday morning.",
      cfg: {},
    });
    const planning = buildRequirementPlannerResult({
      requirements,
      cfg: {},
    });

    const result = await runRequirementPlannerLiveVerification({
      planning,
      cfg: {},
      env,
    });

    expect(result.run.passedCount).toBeGreaterThan(0);
    expect(result.run.unresolvedCount).toBeGreaterThan(0);
    expect(
      result.planning.integrations.find(
        (integration) => integration.connectorId === "tools:automation",
      )?.status,
    ).toBe("verified");

    const fingerprint = __testing.buildVerificationFingerprint(planning);
    const persisted = await readPlannerVerificationResults({ fingerprint, env });
    expect(persisted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          connectorId: "tools:automation",
          status: "passed",
          source: "persisted",
        }),
      ]),
    );
  });

  it("reuses persisted live channel verification results on the next plan build", async () => {
    const { probeTelegram } = installTelegramProbeRuntime();
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-capability-channel-"));
    const env = {
      ...process.env,
      OPENCLAW_TEST_FAST: "1",
      OPENCLAW_STATE_DIR: stateDir,
    };
    const cfg = {
      channels: {
        telegram: {
          botToken: "123:abc",
        },
      },
    };
    const requirements = buildRequirementSet({
      brief: "Create a support bot on Telegram for customer questions.",
      cfg,
    });
    const planning = buildRequirementPlannerResult({
      requirements,
      cfg,
    });

    const run = await runRequirementPlannerLiveVerification({
      planning,
      cfg,
      env,
    });

    expect(run.run.results.find((result) => result.id === "channel:telegram:status")?.status).toBe(
      "passed",
    );
    expect(
      run.run.results.find((result) => result.id === "channel:telegram:send_test")?.status,
    ).toBe("needs_live_check");
    expect(probeTelegram).toHaveBeenCalled();

    const hydrated = await hydrateRequirementPlannerVerificationState(planning, env);
    expect(
      hydrated.verifications.find((result) => result.id === "channel:telegram:status"),
    ).toEqual(
      expect.objectContaining({
        status: "passed",
        source: "persisted",
      }),
    );
    expect(
      hydrated.integrations.find((integration) => integration.connectorId === "channel:telegram")
        ?.lastVerifiedAt,
    ).toBeTruthy();
  });
});
