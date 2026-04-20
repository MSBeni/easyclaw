import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureEnv } from "../test-utils/env.js";
import {
  cleanupGlobalRenameDirs,
  detectGlobalInstallManagerByPresence,
  detectGlobalInstallManagerForRoot,
  globalInstallArgs,
  globalInstallFallbackArgs,
  resolveGlobalPackageRoot,
  resolveGlobalInstallSpec,
  resolveGlobalRoot,
  type CommandRunner,
} from "./update-global.js";

describe("update global helpers", () => {
  let envSnapshot: ReturnType<typeof captureEnv> | undefined;

  afterEach(() => {
    envSnapshot?.restore();
    envSnapshot = undefined;
  });

  it("prefers explicit package spec overrides", () => {
    envSnapshot = captureEnv(["EASYCLAW_UPDATE_PACKAGE_SPEC", "OPENCLAW_UPDATE_PACKAGE_SPEC"]);
    process.env.EASYCLAW_UPDATE_PACKAGE_SPEC = "file:/tmp/easyclaw.tgz";

    expect(resolveGlobalInstallSpec({ packageName: "easyclaw", tag: "latest" })).toBe(
      "file:/tmp/easyclaw.tgz",
    );
    expect(
      resolveGlobalInstallSpec({
        packageName: "easyclaw",
        tag: "beta",
        env: { EASYCLAW_UPDATE_PACKAGE_SPEC: "easyclaw@next" },
      }),
    ).toBe("easyclaw@next");

    delete process.env.EASYCLAW_UPDATE_PACKAGE_SPEC;
    process.env.OPENCLAW_UPDATE_PACKAGE_SPEC = "file:/tmp/openclaw-compat.tgz";
    expect(resolveGlobalInstallSpec({ packageName: "easyclaw", tag: "latest" })).toBe(
      "file:/tmp/openclaw-compat.tgz",
    );
  });

  it("resolves global roots and package roots from runner output", async () => {
    const runCommand: CommandRunner = async (argv) => {
      if (argv[0] === "npm") {
        return { stdout: "/tmp/npm-root\n", stderr: "", code: 0 };
      }
      if (argv[0] === "pnpm") {
        return { stdout: "", stderr: "", code: 1 };
      }
      throw new Error(`unexpected command: ${argv.join(" ")}`);
    };

    await expect(resolveGlobalRoot("npm", runCommand, 1000)).resolves.toBe("/tmp/npm-root");
    await expect(resolveGlobalRoot("pnpm", runCommand, 1000)).resolves.toBeNull();
    await expect(resolveGlobalRoot("bun", runCommand, 1000)).resolves.toContain(
      path.join(".bun", "install", "global", "node_modules"),
    );
    await expect(resolveGlobalPackageRoot("npm", runCommand, 1000)).resolves.toBe(
      path.join("/tmp/npm-root", "easyclaw"),
    );
  });

  it("detects install managers from resolved roots and on-disk presence", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-update-global-"));
    const npmRoot = path.join(base, "npm-root");
    const pnpmRoot = path.join(base, "pnpm-root");
    const bunRoot = path.join(base, ".bun", "install", "global", "node_modules");
    const pkgRoot = path.join(pnpmRoot, "easyclaw");
    await fs.mkdir(pkgRoot, { recursive: true });
    await fs.mkdir(path.join(npmRoot, "easyclaw"), { recursive: true });
    await fs.mkdir(path.join(bunRoot, "easyclaw"), { recursive: true });

    envSnapshot = captureEnv(["BUN_INSTALL"]);
    process.env.BUN_INSTALL = path.join(base, ".bun");

    const runCommand: CommandRunner = async (argv) => {
      if (argv[0] === "npm") {
        return { stdout: `${npmRoot}\n`, stderr: "", code: 0 };
      }
      if (argv[0] === "pnpm") {
        return { stdout: `${pnpmRoot}\n`, stderr: "", code: 0 };
      }
      throw new Error(`unexpected command: ${argv.join(" ")}`);
    };

    await expect(detectGlobalInstallManagerForRoot(runCommand, pkgRoot, 1000)).resolves.toBe(
      "pnpm",
    );
    await expect(detectGlobalInstallManagerByPresence(runCommand, 1000)).resolves.toBe("npm");

    await fs.rm(path.join(npmRoot, "easyclaw"), { recursive: true, force: true });
    await fs.rm(path.join(pnpmRoot, "easyclaw"), { recursive: true, force: true });
    await expect(detectGlobalInstallManagerByPresence(runCommand, 1000)).resolves.toBe("bun");
  });

  it("builds install argv and npm fallback argv", () => {
    expect(globalInstallArgs("npm", "easyclaw@latest")).toEqual([
      "npm",
      "i",
      "-g",
      "easyclaw@latest",
      "--no-fund",
      "--no-audit",
      "--loglevel=error",
    ]);
    expect(globalInstallArgs("pnpm", "easyclaw@latest")).toEqual([
      "pnpm",
      "add",
      "-g",
      "easyclaw@latest",
    ]);
    expect(globalInstallArgs("bun", "easyclaw@latest")).toEqual([
      "bun",
      "add",
      "-g",
      "easyclaw@latest",
    ]);

    expect(globalInstallFallbackArgs("npm", "easyclaw@latest")).toEqual([
      "npm",
      "i",
      "-g",
      "easyclaw@latest",
      "--omit=optional",
      "--no-fund",
      "--no-audit",
      "--loglevel=error",
    ]);
    expect(globalInstallFallbackArgs("pnpm", "openclaw@latest")).toBeNull();
  });

  it("cleans only renamed package directories", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-update-cleanup-"));
    await fs.mkdir(path.join(root, ".easyclaw-123"), { recursive: true });
    await fs.mkdir(path.join(root, ".easyclaw-456"), { recursive: true });
    await fs.writeFile(path.join(root, ".easyclaw-file"), "nope", "utf8");
    await fs.mkdir(path.join(root, "easyclaw"), { recursive: true });

    await expect(
      cleanupGlobalRenameDirs({
        globalRoot: root,
        packageName: "easyclaw",
      }),
    ).resolves.toEqual({
      removed: [".easyclaw-123", ".easyclaw-456"],
    });
    await expect(fs.stat(path.join(root, "easyclaw"))).resolves.toBeDefined();
    await expect(fs.stat(path.join(root, ".easyclaw-file"))).resolves.toBeDefined();
  });
});
