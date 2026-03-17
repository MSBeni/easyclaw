import { describe, expect, it } from "vitest";
import {
  ALL_BLUEPRINT_EXAMPLES,
  dailyBriefingBlueprint,
  projectOperatorBlueprint,
  STARTER_BLUEPRINT_EXAMPLES,
  STARTER_BLUEPRINT_TEMPLATE_IDS,
  STRETCH_BLUEPRINT_EXAMPLES,
  STRETCH_BLUEPRINT_TEMPLATE_IDS,
  supportResponderBlueprint,
  teamStandupReporterBlueprint,
} from "./examples.js";
import { collectAgentBlueprintValidationIssues } from "./validation.js";

describe("agent blueprint examples", () => {
  it("validates all phase-0 blueprint examples against the draft schema", () => {
    const failures = ALL_BLUEPRINT_EXAMPLES.flatMap((example) =>
      collectAgentBlueprintValidationIssues(example).map(
        (error) => `${example.manifest.templateId}: ${error.path}: ${error.message}`,
      ),
    );
    expect(failures).toEqual([]);
  });

  it("keeps the locked starter template set intact", () => {
    expect(STARTER_BLUEPRINT_EXAMPLES).toHaveLength(4);
    expect(
      STARTER_BLUEPRINT_EXAMPLES.map((example) => example.manifest.templateId).toSorted(),
    ).toEqual([...STARTER_BLUEPRINT_TEMPLATE_IDS].toSorted());
  });

  it("keeps the stretch examples separate from the starter set", () => {
    expect(STRETCH_BLUEPRINT_EXAMPLES).toHaveLength(2);
    expect(
      STRETCH_BLUEPRINT_EXAMPLES.map((example) => example.manifest.templateId).toSorted(),
    ).toEqual([...STRETCH_BLUEPRINT_TEMPLATE_IDS].toSorted());
  });

  it("distinguishes digest agents from reply-in-place responders", () => {
    expect(dailyBriefingBlueprint.ingress?.interactionMode).toBe("scheduled");
    expect(dailyBriefingBlueprint.delivery?.mode).toBe("digest");
    expect(supportResponderBlueprint.ingress?.interactionMode).toBe("bound-channel");
    expect(supportResponderBlueprint.delivery?.mode).toBe("reply");
  });

  it("keeps project operator and standup reporter as different stretch cases", () => {
    expect(projectOperatorBlueprint.runtime.tools.profile).toBe("coding");
    expect(projectOperatorBlueprint.runtime.subagents?.enabled).toBe(true);
    expect(teamStandupReporterBlueprint.runtime.tools.profile).toBe("messaging");
    expect(teamStandupReporterBlueprint.automation?.schedules).toHaveLength(1);
  });
});
