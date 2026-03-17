import { describe, expect, it } from "vitest";
import {
  buildAgentBlueprintDraft,
  compileAgentBlueprintBuilderPlan,
  __testing,
} from "./builder.js";

describe("agent blueprint builder", () => {
  it("selects the daily briefing template for scheduled digest requests", async () => {
    const result = await compileAgentBlueprintBuilderPlan({
      brief:
        "Create a bot that summarizes my daily emails and posts them to Slack #ops every morning at 9am.",
      cfg: {},
    });

    expect(result.draft.templateId).toBe("daily-briefing");
    expect(result.draft.ready).toBe(true);
    expect(result.draft.extracted.sourceChannels).toContain("gmail");
    expect(result.draft.extracted.deliveryTarget).toContain("slack");
    expect(result.draft.extracted.schedule).toContain("0 9");
    expect(result.plan.source?.kind).toBe("builder");
    expect(result.plan.status).toBe("ready");
  });

  it("asks for a support channel when the request is support-shaped but underspecified", () => {
    const draft = buildAgentBlueprintDraft({
      brief: "I want a customer support responder for billing questions.",
    });

    expect(draft.templateId).toBe("support-responder");
    expect(draft.ready).toBe(false);
    expect(draft.questions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "binding-channel",
          required: true,
        }),
      ]),
    );
  });

  it("uses channel-level Telegram bindings for support responders", () => {
    const draft = buildAgentBlueprintDraft({
      brief: "Create a support bot on Telegram for customer questions.",
    });

    expect(draft.templateId).toBe("support-responder");
    expect(draft.ready).toBe(true);
    expect(draft.extracted.ingressChannels).toEqual(["telegram"]);
  });

  it("defaults to the personal assistant template when the brief is broad", () => {
    const draft = buildAgentBlueprintDraft({
      brief: "I want an assistant that keeps me organized.",
    });

    expect(draft.templateId).toBe("personal-assistant");
    expect(draft.ready).toBe(true);
    expect(draft.questions).toEqual([]);
  });
});

describe("builder schedule inference", () => {
  it("defaults weekly schedules to Monday mornings when no exact day or time is given", () => {
    expect(__testing.inferSchedule("Create a weekly digest agent")).toEqual({
      cron: "0 9 * * 1",
      description: "Mondays at 9:00 AM",
      assumed: true,
    });
  });
});
