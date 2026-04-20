import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type PackageJson = {
  version?: string;
  dependencies?: Record<string, string>;
  exports?: Record<string, unknown>;
};

const rootDir = process.cwd();

function readJson<T>(relativePath: string): T {
  return JSON.parse(fs.readFileSync(path.join(rootDir, relativePath), "utf8")) as T;
}

describe("openclaw compatibility package", () => {
  it("keeps its exported surface aligned with easyclaw", () => {
    const rootPackage = readJson<PackageJson>("package.json");
    const compatPackage = readJson<PackageJson>("packages/openclaw/package.json");

    const expectedExportKeys = Object.keys(rootPackage.exports ?? {})
      .filter((key) => key === "." || key === "./cli-entry" || key.startsWith("./plugin-sdk"))
      .toSorted();
    const actualExportKeys = Object.keys(compatPackage.exports ?? {}).toSorted();

    expect(actualExportKeys).toEqual(expectedExportKeys);
  });

  it("depends on the same easyclaw release line", () => {
    const rootPackage = readJson<PackageJson>("package.json");
    const compatPackage = readJson<PackageJson>("packages/openclaw/package.json");

    expect(compatPackage.dependencies?.easyclaw).toBe(rootPackage.version);
  });
});
