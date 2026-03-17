import { Value } from "@sinclair/typebox/value";
import type { AgentBlueprintBundle } from "./schema.js";
import { AgentBlueprintBundleSchema } from "./schema.js";

export type AgentBlueprintValidationIssue = {
  path: string;
  message: string;
};

export function collectAgentBlueprintValidationIssues(
  value: unknown,
): AgentBlueprintValidationIssue[] {
  return [...Value.Errors(AgentBlueprintBundleSchema, value)].map((error) => ({
    path: error.path || "/",
    message: error.message,
  }));
}

export function isAgentBlueprintBundle(value: unknown): value is AgentBlueprintBundle {
  return Value.Check(AgentBlueprintBundleSchema, value);
}

export function assertValidAgentBlueprintBundle(
  value: unknown,
): asserts value is AgentBlueprintBundle {
  const issues = collectAgentBlueprintValidationIssues(value);
  if (issues.length === 0) {
    return;
  }
  const rendered = issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n");
  throw new Error(`Invalid agent blueprint bundle:\n${rendered}`);
}
