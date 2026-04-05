import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  loadConfigSchema: vi.fn(),
}));

vi.mock("../ui/src/ui/controllers/config.ts", () => ({
  loadConfig: mocks.loadConfig,
  loadConfigSchema: mocks.loadConfigSchema,
}));

const { refreshActiveTab } = await import("../ui/src/ui/app-settings.ts");

describe("refreshActiveTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads config state for the onboarding setup route", async () => {
    await refreshActiveTab({ tab: "onboarding" } as never);

    expect(mocks.loadConfigSchema).toHaveBeenCalledTimes(1);
    expect(mocks.loadConfig).toHaveBeenCalledTimes(1);
  });
});
