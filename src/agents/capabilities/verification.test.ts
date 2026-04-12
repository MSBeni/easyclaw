import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PluginRuntime } from "openclaw/plugin-sdk/telegram";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { slackPlugin } from "../../../extensions/slack/src/channel.js";
import { setSlackRuntime } from "../../../extensions/slack/src/runtime.js";
import { telegramPlugin } from "../../../extensions/telegram/src/channel.js";
import { setActiveWebListener } from "../../../extensions/whatsapp/src/active-listener.js";
import { whatsappPlugin } from "../../../extensions/whatsapp/src/channel.js";
import { setWhatsAppRuntime } from "../../../extensions/whatsapp/src/runtime.js";
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

const slackConversationsInfoMock = vi.hoisted(() => vi.fn());

vi.mock("../../../extensions/slack/src/client.js", () => ({
  createSlackWebClient: () => ({
    conversations: {
      info: slackConversationsInfoMock,
    },
  }),
}));

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

function installSlackProbeRuntime() {
  const probeSlack = vi.fn(async () => ({
    ok: true,
    bot: { id: "U0AL5NWUF4Z", name: "openclaw" },
    team: { id: "T0AHX4DFHPZ", name: "Vole AI" },
    elapsedMs: 1,
  }));
  setSlackRuntime({
    channel: {
      slack: {
        probeSlack,
      },
    },
    logging: {
      shouldLogVerbose: () => false,
    },
  } as never);
  return { probeSlack };
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
    setActiveWebListener("default", null);
    slackConversationsInfoMock.mockReset();
  });

  afterEach(() => {
    setActivePluginRegistry(
      createTestRegistry([{ pluginId: "telegram", plugin: telegramPlugin, source: "test" }]),
    );
    setActiveWebListener("default", null);
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

  it("marks WhatsApp delivery verification as failed when the listener is not active", async () => {
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

    const cfg = {
      channels: {
        whatsapp: {
          authDir: "/tmp/wa-auth",
          defaultTo: "+15551234567",
        },
      },
    };
    const requirements = buildRequirementSet({
      brief: "Create a daily Gmail briefing and send it to my WhatsApp.",
      cfg,
    });
    const planning = buildRequirementPlannerResult({
      requirements,
      cfg,
    });

    const run = await runRequirementPlannerLiveVerification({
      planning,
      cfg,
    });

    expect(run.run.results.find((result) => result.id === "channel:whatsapp:status")).toEqual(
      expect.objectContaining({
        status: "failed",
        detail: "WhatsApp Web is linked, but no active listener is running for this account.",
      }),
    );
  });

  it("fails Slack send verification when the bot is not in the configured channel target", async () => {
    const { probeSlack } = installSlackProbeRuntime();
    slackConversationsInfoMock.mockResolvedValue({
      ok: true,
      channel: {
        id: "C0AK6RU9FFS",
        name: "engineering",
        is_member: false,
      },
    });
    setActivePluginRegistry(
      createTestRegistry([{ pluginId: "slack", plugin: slackPlugin, source: "test" }]),
    );

    const cfg = {
      channels: {
        slack: {
          botToken: "xoxb-test",
          appToken: "xapp-test",
          defaultTo: "channel:C0AK6RU9FFS",
        },
      },
    };
    const requirements = buildRequirementSet({
      brief: "Create a daily AI briefing and send it to my Slack channel every morning.",
      cfg,
    });
    const planning = buildRequirementPlannerResult({
      requirements,
      cfg,
    });

    const run = await runRequirementPlannerLiveVerification({
      planning,
      cfg,
    });

    expect(probeSlack).toHaveBeenCalled();
    expect(slackConversationsInfoMock).toHaveBeenCalledWith({ channel: "C0AK6RU9FFS" });
    expect(run.run.results.find((result) => result.id === "channel:slack:status")).toEqual(
      expect.objectContaining({
        status: "passed",
      }),
    );
    expect(run.run.results.find((result) => result.id === "channel:slack:send_test")).toEqual(
      expect.objectContaining({
        status: "failed",
        detail:
          "Slack workspace auth is ready, but the bot is not a member of #engineering. Invite the app to that conversation, then rerun verification.",
      }),
    );
  });
});
