import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dailyBriefingBlueprint } from "../agents/blueprints/examples.js";
import { serializeAgentBlueprintBundle } from "../agents/blueprints/files.js";
import type { AgentBlueprintBundle } from "../agents/blueprints/schema.js";
import {
  agentsTemplatesApplyCommand,
  agentsTemplatesListCommand,
  agentsTemplatesPlanCommand,
  agentsTemplatesShowCommand,
} from "./agents.js";
import { baseConfigSnapshot, createTestRuntime } from "./test-runtime-config-helpers.js";

const readConfigFileSnapshotMock = vi.hoisted(() => vi.fn());
const applyAgentBlueprintMock = vi.hoisted(() => vi.fn());

vi.mock("../config/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config/config.js")>()),
  readConfigFileSnapshot: readConfigFileSnapshotMock,
}));

vi.mock("../agents/blueprints/materialize.js", () => ({
  applyAgentBlueprint: applyAgentBlueprintMock,
}));

const runtime = createTestRuntime();

describe("agents templates commands", () => {
  const tempPaths: string[] = [];

  beforeEach(() => {
    readConfigFileSnapshotMock.mockReset();
    readConfigFileSnapshotMock.mockResolvedValue({ ...baseConfigSnapshot });
    applyAgentBlueprintMock.mockReset();
    runtime.log.mockClear();
    runtime.error.mockClear();
    runtime.exit.mockClear();
  });

  afterEach(async () => {
    await Promise.all(tempPaths.map((filePath) => fs.rm(filePath, { force: true })));
    tempPaths.length = 0;
  });

  it("lists bundled templates", async () => {
    await agentsTemplatesListCommand({}, runtime);

    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("daily-briefing"));
    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("Starter:"));
  });

  it("shows bundled templates as YAML by default", async () => {
    await agentsTemplatesShowCommand({ templateId: "daily-briefing" }, runtime);

    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("templateId: daily-briefing"));
    expect(runtime.exit).not.toHaveBeenCalled();
  });

  it("plans bundled templates as JSON and resolves template variables", async () => {
    await agentsTemplatesPlanCommand(
      { input: "daily-briefing", set: ["owner_target=@owner"], json: true },
      runtime,
    );

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] as string) as {
      status: string;
      manifest: { templateId: string };
      routing: { interactionMode?: string };
      templateVariables?: { resolved: string[]; unresolved: string[] };
      delivery: { target?: { to?: string } };
    };
    expect(payload.status).toBe("ready");
    expect(payload.manifest.templateId).toBe("daily-briefing");
    expect(payload.routing.interactionMode).toBe("scheduled");
    expect(payload.templateVariables?.resolved).toEqual(["owner_target"]);
    expect(payload.templateVariables?.unresolved).toEqual([]);
    expect(payload.delivery.target?.to).toBe("@owner");
  });

  it("exits non-zero when a blueprint plan is invalid", async () => {
    const invalid: AgentBlueprintBundle = structuredClone(dailyBriefingBlueprint);
    delete invalid.automation;
    const filePath = await writeTempBlueprint(serializeAgentBlueprintBundle(invalid), "yaml");

    await agentsTemplatesPlanCommand({ input: filePath }, runtime);

    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("scheduled-without-schedule"));
    expect(runtime.exit).toHaveBeenCalledWith(1);
  });

  it("requires --yes before apply", async () => {
    await agentsTemplatesApplyCommand({ input: "daily-briefing" }, runtime);

    expect(runtime.error).toHaveBeenCalledWith(expect.stringContaining("Apply requires --yes"));
    expect(runtime.exit).toHaveBeenCalledWith(1);
    expect(applyAgentBlueprintMock).not.toHaveBeenCalled();
  });

  it("applies a blueprint and logs the summary", async () => {
    applyAgentBlueprintMock.mockResolvedValue({
      status: "applied",
      source: { kind: "template", value: "daily-briefing", format: null },
      plan: {
        manifest: dailyBriefingBlueprint.manifest,
      },
      templateVariables: {
        values: { owner_target: "@owner" },
        resolved: ["owner_target"],
      },
      configPath: "/tmp/openclaw.json",
      agent: {
        agentId: "daily-briefing",
        name: "Morning Brief",
        workspaceDir: "/tmp/workspace-daily-briefing",
        agentDir: "/tmp/agents/daily-briefing/agent",
      },
      workspace: {
        metadataPath: "/tmp/agents/daily-briefing/agent/easyclaw-blueprint.json",
        files: [
          { name: "AGENTS.md", path: "/tmp/workspace-daily-briefing/AGENTS.md", status: "created" },
        ],
      },
      bindings: {
        removed: [],
        added: [],
        updated: [],
        skipped: [],
        conflicts: [],
        ignored: [],
      },
      automation: {
        jobs: [
          { name: "easyclaw:daily-briefing:weekday-morning-brief", id: "job-1", status: "created" },
        ],
      },
      warnings: [],
    });

    await agentsTemplatesApplyCommand(
      { input: "daily-briefing", set: ["owner_target=@owner"], yes: true },
      runtime,
    );

    expect(applyAgentBlueprintMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: {
          owner_target: "@owner",
        },
      }),
    );
    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("Applied blueprint"));
  });

  async function writeTempBlueprint(content: string, format: "yaml" | "json"): Promise<string> {
    const filePath = path.join(
      os.tmpdir(),
      `openclaw-agents-templates-${process.pid}-${tempPaths.length}.${format}`,
    );
    await fs.writeFile(filePath, content, "utf-8");
    tempPaths.push(filePath);
    return filePath;
  }
});
