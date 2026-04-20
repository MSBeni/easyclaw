export const LEGACY_DAEMON_CLI_EXPORTS = [
  "registerDaemonCli",
  "runDaemonInstall",
  "runDaemonRestart",
  "runDaemonStart",
  "runDaemonStatus",
  "runDaemonStop",
  "runDaemonUninstall",
] as const;

type LegacyDaemonCliExport = (typeof LEGACY_DAEMON_CLI_EXPORTS)[number];
export type LegacyDaemonCliAccessors = {
  registerDaemonCli: string;
  runDaemonRestart: string;
} & Partial<
  Record<Exclude<LegacyDaemonCliExport, "registerDaemonCli" | "runDaemonRestart">, string>
>;

const EXPORT_SPEC_RE = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/;
const REGISTER_CONTAINER_RE =
  /(?:var|const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\/\*[\s\S]*?\*\/\s*)?__exportAll\(\{\s*registerDaemonCli\s*:\s*\(\)\s*=>\s*registerDaemonCli\s*\}\)/;

function parseExportAliases(bundleSource: string): Map<string, string> | null {
  const matches = [...bundleSource.matchAll(/export\s*\{([^}]+)\}\s*;?/g)];
  if (matches.length === 0) {
    return null;
  }
  const last = matches.at(-1);
  const body = last?.[1];
  if (!body) {
    return null;
  }

  const aliases = new Map<string, string>();
  for (const chunk of body.split(",")) {
    const spec = chunk.trim();
    if (!spec) {
      continue;
    }
    const parsed = spec.match(EXPORT_SPEC_RE);
    if (!parsed) {
      return null;
    }
    const original = parsed[1];
    const alias = parsed[2] ?? original;
    aliases.set(original, alias);
  }
  return aliases;
}

function findRegisterContainerSymbol(bundleSource: string): string | null {
  return bundleSource.match(REGISTER_CONTAINER_RE)?.[1] ?? null;
}

/**
 * Resolve the accessor path the legacy shim should use on the bundled
 * daemon-cli module to reach `targetName`. The shim consumes the module as
 * `import * as daemonCli from "..."` and reads `daemonCli.<accessor>`, so
 * the accessor must be whatever NAME the bundle publicly exports the
 * function under.
 *
 * Rolldown can emit the matching `export {...}` statement in either
 * direction depending on whether the file ended up as a shared chunk or as
 * a wrapper chunk:
 *   - shared chunk:  `export { runDaemonRestart as r }`  (local → mangled public)
 *   - wrapper chunk: `export { r as runDaemonRestart }`  (mangled local → public)
 *   - unmangled:     `export { runDaemonRestart }`       (both the same)
 *
 * In all three cases we want the public name of the matching spec, which is
 * the ALIAS side stored as the Map value. Returns `undefined` when neither
 * side of any spec mentions `targetName`.
 */
function resolvePublicExportAccessor(
  aliases: Map<string, string>,
  targetName: string,
): string | undefined {
  // Local name matches (shared-chunk or unmangled): public is the mapped alias.
  if (aliases.has(targetName)) {
    return aliases.get(targetName);
  }
  // Public name matches (wrapper chunk): accessor is the target itself.
  for (const alias of aliases.values()) {
    if (alias === targetName) {
      return targetName;
    }
  }
  return undefined;
}

export function resolveLegacyDaemonCliAccessors(
  bundleSource: string,
): LegacyDaemonCliAccessors | null {
  const aliases = parseExportAliases(bundleSource);
  if (!aliases) {
    return null;
  }

  const registerContainer = findRegisterContainerSymbol(bundleSource);
  const registerContainerAlias = registerContainer ? aliases.get(registerContainer) : undefined;
  const registerDirectAlias = resolvePublicExportAccessor(aliases, "registerDaemonCli");

  const runDaemonInstall = resolvePublicExportAccessor(aliases, "runDaemonInstall");
  const runDaemonRestart = resolvePublicExportAccessor(aliases, "runDaemonRestart");
  const runDaemonStart = resolvePublicExportAccessor(aliases, "runDaemonStart");
  const runDaemonStatus = resolvePublicExportAccessor(aliases, "runDaemonStatus");
  const runDaemonStop = resolvePublicExportAccessor(aliases, "runDaemonStop");
  const runDaemonUninstall = resolvePublicExportAccessor(aliases, "runDaemonUninstall");
  if (!(registerContainerAlias || registerDirectAlias) || !runDaemonRestart) {
    return null;
  }

  const accessors: LegacyDaemonCliAccessors = {
    registerDaemonCli: registerContainerAlias
      ? `${registerContainerAlias}.registerDaemonCli`
      : registerDirectAlias!,
    runDaemonRestart,
  };
  if (runDaemonInstall) {
    accessors.runDaemonInstall = runDaemonInstall;
  }
  if (runDaemonStart) {
    accessors.runDaemonStart = runDaemonStart;
  }
  if (runDaemonStatus) {
    accessors.runDaemonStatus = runDaemonStatus;
  }
  if (runDaemonStop) {
    accessors.runDaemonStop = runDaemonStop;
  }
  if (runDaemonUninstall) {
    accessors.runDaemonUninstall = runDaemonUninstall;
  }
  return accessors;
}
