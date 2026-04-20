import { describe, expect, it } from "vitest";
import "./test-helpers/fast-core-tools.js";
import { createOpenClawTools } from "./openclaw-tools.js";

describe("createOpenClawTools cron sessions", () => {
  it("omits the cron tool inside cron run sessions", () => {
    const tools = createOpenClawTools({
      agentSessionKey: "agent:day-schedule-ai:cron:job-123:run:run-456",
    });
    expect(tools.some((tool) => tool.name === "cron")).toBe(false);
  });

  it("keeps the cron tool available outside cron run sessions", () => {
    const tools = createOpenClawTools({
      agentSessionKey: "agent:day-schedule-ai:main",
    });
    expect(tools.some((tool) => tool.name === "cron")).toBe(true);
  });
});
