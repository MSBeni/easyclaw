import { describe, expect, it } from "vitest";
import { dailyBriefingBlueprint } from "./examples.js";
import {
  listAgentBlueprintTemplateVariables,
  resolveAgentBlueprintVariables,
} from "./variables.js";

describe("agent blueprint variables", () => {
  it("lists blueprint placeholders", () => {
    expect(listAgentBlueprintTemplateVariables(dailyBriefingBlueprint)).toEqual(["owner_target"]);
  });

  it("resolves provided variables", () => {
    const result = resolveAgentBlueprintVariables({
      bundle: dailyBriefingBlueprint,
      variables: {
        owner_target: "@owner",
      },
    });

    expect(result.unresolved).toEqual([]);
    expect(result.resolved).toEqual(["owner_target"]);
    expect(result.bundle.delivery?.target?.to).toBe("@owner");
  });
});
