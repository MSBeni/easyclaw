import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearConfigCache, readConfigFileSnapshot } from "../../config/config.js";
import { dailyBriefingBlueprint, supportResponderBlueprint } from "./examples.js";
import { applyAgentBlueprint } from "./materialize.js";
import type { AgentBlueprintBundle } from "./schema.js";

describe("agent blueprint materializer", () => {
  const envBackup = { ...process.env };
  let tempDir = "";
  let configPath = "";
  let stateDir = "";
  let cronStorePath = "";

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-blueprints-"));
    configPath = path.join(tempDir, "openclaw.json");
    stateDir = path.join(tempDir, "state");
    cronStorePath = path.join(tempDir, "cron", "jobs.json");
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    process.env.OPENCLAW_STATE_DIR = stateDir;
    process.env.OPENCLAW_TEST_FAST = "1";
    clearConfigCache();
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(
      configPath,
      `${JSON.stringify(
        {
          cron: {
            store: cronStorePath,
          },
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );
  });

  afterEach(async () => {
    clearConfigCache();
    for (const key of Object.keys(process.env)) {
      if (!(key in envBackup)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, envBackup);
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("applies a daily briefing blueprint into config, workspace, and cron", async () => {
    const result = await applyAgentBlueprint({
      loaded: {
        kind: "template",
        source: "daily-briefing",
        format: null,
        bundle: dailyBriefingBlueprint,
      },
      variables: {
        owner_target: "@owner",
      },
    });

    clearConfigCache();
    const snapshot = await readConfigFileSnapshot();
    const agent = snapshot.config.agents?.list?.find((entry) => entry.id === "daily-briefing");
    if (!agent) {
      throw new Error("missing applied agent");
    }

    expect(result.agent.agentId).toBe("daily-briefing");
    expect(agent.skills).toEqual(["summarization"]);
    expect(agent.tools?.profile).toBe("messaging");
    expect(agent.tools?.alsoAllow).toEqual(["cron"]);

    const agentsFile = await fs.readFile(
      path.join(result.agent.workspaceDir, "AGENTS.md"),
      "utf-8",
    );
    expect(agentsFile).toContain("## Easyclaw Blueprint");
    expect(agentsFile).toContain("Daily Briefing Agent");

    const metadata = JSON.parse(
      await fs.readFile(path.join(result.agent.agentDir, "easyclaw-blueprint.json"), "utf-8"),
    ) as { manifest: { templateId: string } };
    expect(metadata.manifest.templateId).toBe("daily-briefing");

    const cronStore = JSON.parse(await fs.readFile(cronStorePath, "utf-8")) as {
      jobs: Array<{ name: string; delivery?: { to?: string } }>;
    };
    expect(cronStore.jobs).toHaveLength(1);
    expect(cronStore.jobs[0]?.name).toBe("easyclaw:daily-briefing:weekday-morning-brief");
    expect(cronStore.jobs[0]?.delivery?.to).toBe("@owner");
  });

  it("updates an existing cron job instead of duplicating it", async () => {
    await applyAgentBlueprint({
      loaded: {
        kind: "template",
        source: "daily-briefing",
        format: null,
        bundle: dailyBriefingBlueprint,
      },
      variables: {
        owner_target: "@first",
      },
    });

    await applyAgentBlueprint({
      loaded: {
        kind: "template",
        source: "daily-briefing",
        format: null,
        bundle: dailyBriefingBlueprint,
      },
      variables: {
        owner_target: "@second",
      },
    });

    const cronStore = JSON.parse(await fs.readFile(cronStorePath, "utf-8")) as {
      jobs: Array<{ name: string; delivery?: { to?: string } }>;
    };
    expect(cronStore.jobs).toHaveLength(1);
    expect(cronStore.jobs[0]?.delivery?.to).toBe("@second");
  });

  it("removes stale managed bindings when the blueprint changes", async () => {
    await applyAgentBlueprint({
      loaded: {
        kind: "template",
        source: "support-responder",
        format: null,
        bundle: supportResponderBlueprint,
      },
    });

    const narrowed = structuredClone(supportResponderBlueprint) as AgentBlueprintBundle;
    narrowed.ingress = {
      interactionMode: "bound-channel",
      bindings: [{ channel: "slack", accountId: "support" }],
    };

    await applyAgentBlueprint({
      loaded: {
        kind: "file",
        source: path.join(tempDir, "support-responder.json"),
        format: "json",
        bundle: narrowed,
      },
    });

    clearConfigCache();
    const snapshot = await readConfigFileSnapshot();
    const bindings = snapshot.config.bindings?.filter(
      (binding) => binding.type === "route" && binding.agentId === "support",
    );
    expect(bindings).toHaveLength(1);
    expect(bindings?.[0]?.match.channel).toBe("slack");
  });

  it("fails fast when required template variables are missing", async () => {
    await expect(
      applyAgentBlueprint({
        loaded: {
          kind: "template",
          source: "daily-briefing",
          format: null,
          bundle: dailyBriefingBlueprint,
        },
      }),
    ).rejects.toThrow('Blueprint requires values for: "owner_target".');
  });
});
