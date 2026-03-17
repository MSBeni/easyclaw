import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dailyBriefingBlueprint } from "./examples.js";
import {
  loadAgentBlueprint,
  serializeAgentBlueprintBundle,
  type AgentBlueprintDocumentFormat,
} from "./files.js";

describe("agent blueprint files", () => {
  const tempPaths: string[] = [];

  afterEach(async () => {
    await Promise.all(tempPaths.map((filePath) => fs.rm(filePath, { force: true })));
    tempPaths.length = 0;
  });

  it("loads bundled templates by template id", async () => {
    const loaded = await loadAgentBlueprint("daily-briefing");

    expect(loaded.kind).toBe("template");
    expect(loaded.bundle.manifest.templateId).toBe("daily-briefing");
    expect(loaded.format).toBeNull();
  });

  it("loads YAML blueprint files from disk", async () => {
    const filePath = await writeTempBlueprint(
      serializeAgentBlueprintBundle(dailyBriefingBlueprint, "yaml"),
      "yaml",
    );

    const loaded = await loadAgentBlueprint(filePath);

    expect(loaded.kind).toBe("file");
    expect(loaded.source).toBe(path.resolve(filePath));
    expect(loaded.bundle.manifest.templateId).toBe("daily-briefing");
  });

  it("serializes JSON blueprints with a trailing newline", () => {
    const rendered = serializeAgentBlueprintBundle(dailyBriefingBlueprint, "json");

    expect(rendered.endsWith("\n")).toBe(true);
    expect(JSON.parse(rendered) as { manifest: { templateId: string } }).toMatchObject({
      manifest: { templateId: "daily-briefing" },
    });
  });

  async function writeTempBlueprint(
    content: string,
    format: AgentBlueprintDocumentFormat,
  ): Promise<string> {
    const filePath = path.join(
      os.tmpdir(),
      `openclaw-blueprint-${process.pid}-${tempPaths.length}.${format === "yaml" ? "yaml" : "json"}`,
    );
    await fs.writeFile(filePath, content, "utf-8");
    tempPaths.push(filePath);
    return filePath;
  }
});
