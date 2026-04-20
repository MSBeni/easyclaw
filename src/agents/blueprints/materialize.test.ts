import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearConfigCache, readConfigFileSnapshot } from "../../config/config.js";
import type { CronService } from "../../cron/service.js";
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
          agents: {
            defaults: {
              model: {
                primary: "openai/gpt-4o",
              },
            },
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
    const bundle = structuredClone(dailyBriefingBlueprint) as AgentBlueprintBundle;
    bundle.agent.agentId = "day-schedule-ai";
    bundle.agent.name = "Day-schedule-ai";

    const result = await applyAgentBlueprint({
      loaded: {
        kind: "template",
        source: "daily-briefing",
        format: null,
        bundle,
      },
      variables: {
        owner_target: "@owner",
      },
    });

    clearConfigCache();
    const snapshot = await readConfigFileSnapshot();
    const agent = snapshot.config.agents?.list?.find((entry) => entry.id === "day-schedule-ai");
    if (!agent) {
      throw new Error("missing applied agent");
    }

    expect(result.agent.agentId).toBe("day-schedule-ai");
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
      jobs: Array<{
        name: string;
        payload?: { model?: string; message?: string };
        delivery?: { to?: string };
      }>;
    };
    expect(cronStore.jobs).toHaveLength(1);
    expect(cronStore.jobs[0]?.name).toBe("easyclaw:day-schedule-ai:weekday-morning-brief");
    expect(cronStore.jobs[0]?.payload?.model).toBeTypeOf("string");
    expect(cronStore.jobs[0]?.delivery?.to).toBe("@owner");
    expect(cronStore.jobs[0]?.payload?.message).toContain(
      'Complete the scheduled task for "Day-schedule-ai" now.',
    );
    expect(cronStore.jobs[0]?.payload?.message).not.toContain(
      'Run the "Daily Briefing Agent" workflow now.',
    );
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

  it("uses an injected cron service when provided", async () => {
    const listMock = vi.fn(async () => []);
    const addMock = vi.fn(async (input: { name: string }) => ({ id: "job-1", name: input.name }));
    const cron = {
      list: listMock,
      add: addMock,
      update: vi.fn(),
      remove: vi.fn(),
    } as unknown as CronService;

    await applyAgentBlueprint({
      loaded: {
        kind: "template",
        source: "daily-briefing",
        format: null,
        bundle: dailyBriefingBlueprint,
      },
      variables: {
        owner_target: "@owner",
      },
      cron,
    });

    expect(listMock).toHaveBeenCalled();
    expect(addMock).toHaveBeenCalled();
  });

  it("writes cron timezone and managed memory docs when present in the plan", async () => {
    const timezoneBundle = structuredClone(dailyBriefingBlueprint) as AgentBlueprintBundle;
    timezoneBundle.automation = {
      schedules: [
        {
          name: "weekday-morning-brief",
          schedule: "0 9 * * 1-5",
          timezone: "America/Los_Angeles",
          purpose: "Send the morning digest.",
        },
      ],
    };
    timezoneBundle.workspace = {
      ...timezoneBundle.workspace,
      bootstrapFiles: [
        ...(timezoneBundle.workspace.bootstrapFiles ?? []),
        "IDENTITY.md",
        "USER.md",
        "MEMORY.md",
      ],
    };

    const result = await applyAgentBlueprint({
      loaded: {
        kind: "template",
        source: "daily-briefing",
        format: null,
        bundle: timezoneBundle,
      },
      variables: {
        owner_target: "@owner",
      },
    });

    const memoryFile = await fs.readFile(
      path.join(result.agent.workspaceDir, "MEMORY.md"),
      "utf-8",
    );
    expect(memoryFile).toContain("## Easyclaw Blueprint Memory Strategy");

    const cronStore = JSON.parse(await fs.readFile(cronStorePath, "utf-8")) as {
      jobs: Array<{ schedule?: { tz?: string } }>;
    };
    expect(cronStore.jobs[0]?.schedule?.tz).toBe("America/Los_Angeles");
  });

  it("writes explicit managed workspace section overrides when provided", async () => {
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
      workspaceManagedSections: {
        "AGENTS.md":
          "## Custom Planner Instructions\n\n- Use the reviewed managed section override.",
      },
    });

    const agentsFile = await fs.readFile(
      path.join(result.agent.workspaceDir, "AGENTS.md"),
      "utf-8",
    );
    expect(agentsFile).toContain("## Custom Planner Instructions");
    expect(agentsFile).toContain("Use the reviewed managed section override.");
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

  it("inherits main auth profiles into the applied agent dir", async () => {
    const mainAgentDir = path.join(stateDir, "agents", "main", "agent");
    await fs.mkdir(mainAgentDir, { recursive: true });
    await fs.writeFile(
      path.join(mainAgentDir, "auth-profiles.json"),
      `${JSON.stringify(
        {
          version: 1,
          profiles: {
            "openai:default": {
              type: "api_key",
              provider: "openai",
              key: "main-openai-key",
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );

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

    const agentAuthPath = path.join(result.agent.agentDir, "auth-profiles.json");
    const store = JSON.parse(await fs.readFile(agentAuthPath, "utf-8")) as {
      profiles?: Record<string, { provider?: string }>;
    };
    expect(store.profiles?.["openai:default"]?.provider).toBe("openai");
  });

  it("pins cron payload model from resolved agent defaults", async () => {
    await fs.writeFile(
      configPath,
      `${JSON.stringify(
        {
          cron: {
            store: cronStorePath,
          },
          agents: {
            defaults: {
              model: {
                primary: "openai-codex/gpt-5.4",
              },
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );
    clearConfigCache();

    await applyAgentBlueprint({
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

    const cronStore = JSON.parse(await fs.readFile(cronStorePath, "utf-8")) as {
      jobs: Array<{ payload?: { model?: string } }>;
    };
    expect(cronStore.jobs[0]?.payload?.model).toBe("openai-codex/gpt-5.4");
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
