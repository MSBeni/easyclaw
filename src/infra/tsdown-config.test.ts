import { describe, expect, it } from "vitest";

describe("tsdown config", () => {
  it("keeps the CLI entry build on stable chunk filenames", async () => {
    const mod = await import("../../tsdown.config.ts");
    const configs = Array.isArray(mod.default) ? mod.default : [mod.default];

    const entryBuild = configs.find((config) => config?.entry === "src/entry.ts");
    expect(entryBuild).toBeTruthy();
    expect(entryBuild).toMatchObject({ hash: false });
  });
});
