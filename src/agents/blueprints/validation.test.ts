import { describe, expect, it } from "vitest";
import { dailyBriefingBlueprint } from "./examples.js";
import {
  assertValidAgentBlueprintBundle,
  collectAgentBlueprintValidationIssues,
  isAgentBlueprintBundle,
} from "./validation.js";

describe("agent blueprint validation", () => {
  it("accepts a valid starter blueprint", () => {
    expect(isAgentBlueprintBundle(dailyBriefingBlueprint)).toBe(true);
    expect(collectAgentBlueprintValidationIssues(dailyBriefingBlueprint)).toEqual([]);
  });

  it("rejects unknown top-level fields", () => {
    const invalid = {
      ...dailyBriefingBlueprint,
      extra: true,
    };

    expect(isAgentBlueprintBundle(invalid)).toBe(false);
    expect(collectAgentBlueprintValidationIssues(invalid)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/extra",
        }),
      ]),
    );
  });

  it("rejects invalid enum values", () => {
    const invalid = {
      ...dailyBriefingBlueprint,
      runtime: {
        ...dailyBriefingBlueprint.runtime,
        tools: {
          ...dailyBriefingBlueprint.runtime.tools,
          profile: "operator",
        },
      },
    };

    const issues = collectAgentBlueprintValidationIssues(invalid);
    expect(isAgentBlueprintBundle(invalid)).toBe(false);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/runtime/tools/profile",
        }),
      ]),
    );
  });

  it("throws a readable error from the assertion helper", () => {
    expect(() =>
      assertValidAgentBlueprintBundle({
        manifest: {},
      }),
    ).toThrowError(/Invalid agent blueprint bundle:/);
  });
});
