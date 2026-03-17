import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { isKnownAgentBlueprintTemplate, requireAgentBlueprintTemplate } from "./registry.js";
import type { AgentBlueprintBundle } from "./schema.js";
import { assertValidAgentBlueprintBundle } from "./validation.js";

export type AgentBlueprintDocumentFormat = "json" | "yaml";

export type LoadedAgentBlueprint = {
  kind: "template" | "file" | "builder";
  source: string;
  format: AgentBlueprintDocumentFormat | null;
  bundle: AgentBlueprintBundle;
};

function resolveBlueprintFileFormat(filePath: string): AgentBlueprintDocumentFormat {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".yaml" || extension === ".yml") {
    return "yaml";
  }
  if (extension === ".json") {
    return "json";
  }
  throw new Error(
    `Unsupported blueprint file format for "${filePath}". Use .json, .yaml, or .yml.`,
  );
}

function parseBlueprintDocument(raw: string, format: AgentBlueprintDocumentFormat): unknown {
  if (format === "json") {
    return JSON.parse(raw);
  }
  return parseYaml(raw);
}

export async function loadAgentBlueprint(input: string): Promise<LoadedAgentBlueprint> {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Blueprint input is required.");
  }

  if (isKnownAgentBlueprintTemplate(trimmed)) {
    return {
      kind: "template",
      source: trimmed,
      format: null,
      bundle: requireAgentBlueprintTemplate(trimmed),
    };
  }

  const resolvedPath = path.resolve(trimmed);
  const format = resolveBlueprintFileFormat(resolvedPath);
  let raw: string;
  try {
    raw = await fs.readFile(resolvedPath, "utf-8");
  } catch (error) {
    throw new Error(
      `Unknown blueprint template "${trimmed}" and failed to read file "${resolvedPath}": ${String(error)}`,
      { cause: error },
    );
  }

  let parsed: unknown;
  try {
    parsed = parseBlueprintDocument(raw, format);
  } catch (error) {
    throw new Error(`Failed to parse blueprint file "${resolvedPath}": ${String(error)}`, {
      cause: error,
    });
  }

  assertValidAgentBlueprintBundle(parsed);
  return {
    kind: "file",
    source: resolvedPath,
    format,
    bundle: parsed,
  };
}

export function serializeAgentBlueprintBundle(
  bundle: AgentBlueprintBundle,
  format: AgentBlueprintDocumentFormat = "yaml",
): string {
  return format === "json"
    ? `${JSON.stringify(bundle, null, 2)}\n`
    : stringifyYaml(bundle, {
        lineWidth: 0,
      });
}
