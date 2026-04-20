import { describe, expect, it } from "vitest";
import { replaceCliName, resolveCliName } from "./cli-name.js";

describe("resolveCliName", () => {
  it("defaults to easyclaw when argv does not contain a known binary", () => {
    expect(resolveCliName(["node", "scripts/run-node.mjs"])).toBe("easyclaw");
  });

  it("detects the easyclaw binary", () => {
    expect(resolveCliName(["node", "/usr/local/bin/easyclaw"])).toBe("easyclaw");
  });

  it("detects the legacy openclaw binary", () => {
    expect(resolveCliName(["node", "C:/Users/test/AppData/Roaming/npm/openclaw.cmd"])).toBe(
      "openclaw",
    );
  });
});

describe("replaceCliName", () => {
  it("rewrites easyclaw examples for legacy openclaw invocations", () => {
    expect(replaceCliName("easyclaw dashboard", "openclaw")).toBe("openclaw dashboard");
  });

  it("keeps unknown commands unchanged", () => {
    expect(replaceCliName("pnpm test", "easyclaw")).toBe("pnpm test");
  });
});
