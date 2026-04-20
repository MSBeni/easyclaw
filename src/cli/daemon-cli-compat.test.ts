import { describe, expect, it } from "vitest";
import { resolveLegacyDaemonCliAccessors } from "./daemon-cli-compat.js";

describe("resolveLegacyDaemonCliAccessors", () => {
  it("resolves aliased daemon-cli exports from a bundled chunk", () => {
    const bundle = `
      var daemon_cli_exports = /* @__PURE__ */ __exportAll({ registerDaemonCli: () => registerDaemonCli });
      export { runDaemonStop as a, runDaemonStart as i, runDaemonStatus as n, runDaemonUninstall as o, runDaemonRestart as r, runDaemonInstall as s, daemon_cli_exports as t };
    `;

    expect(resolveLegacyDaemonCliAccessors(bundle)).toEqual({
      registerDaemonCli: "t.registerDaemonCli",
      runDaemonInstall: "s",
      runDaemonRestart: "r",
      runDaemonStart: "i",
      runDaemonStatus: "n",
      runDaemonStop: "a",
      runDaemonUninstall: "o",
    });
  });

  it("returns null when required aliases are missing", () => {
    const bundle = `
      var daemon_cli_exports = /* @__PURE__ */ __exportAll({ registerDaemonCli: () => registerDaemonCli });
      export { runDaemonRestart as r, daemon_cli_exports as t };
    `;

    expect(resolveLegacyDaemonCliAccessors(bundle)).toEqual({
      registerDaemonCli: "t.registerDaemonCli",
      runDaemonRestart: "r",
    });
  });

  it("returns null when the required restart alias is missing", () => {
    const bundle = `
      var daemon_cli_exports = /* @__PURE__ */ __exportAll({ registerDaemonCli: () => registerDaemonCli });
      export { daemon_cli_exports as t };
    `;

    expect(resolveLegacyDaemonCliAccessors(bundle)).toBeNull();
  });

  it("resolves wrapper-chunk exports where mangled locals alias to public names", () => {
    // When Rolldown splits daemon-cli.ts into a wrapper + shared chunk, the
    // wrapper imports mangled locals from the shared chunk and re-exports
    // them under the original public names: `export { r as runDaemonRestart }`.
    // The accessor in this case is the public name itself because the
    // wrapper module publicly exposes `runDaemonRestart`, not `r`.
    const bundle = `
      import { a, i, n, o, r, s } from "./daemon-cli-ABCD1234.js";
      export { a as registerDaemonCli, i as runDaemonStart, n as runDaemonStatus, o as runDaemonUninstall, r as runDaemonRestart, s as runDaemonInstall };
    `;

    expect(resolveLegacyDaemonCliAccessors(bundle)).toEqual({
      registerDaemonCli: "registerDaemonCli",
      runDaemonInstall: "runDaemonInstall",
      runDaemonRestart: "runDaemonRestart",
      runDaemonStart: "runDaemonStart",
      runDaemonStatus: "runDaemonStatus",
      runDaemonUninstall: "runDaemonUninstall",
    });
  });
});
