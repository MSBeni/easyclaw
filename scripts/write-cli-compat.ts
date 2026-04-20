import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LEGACY_DAEMON_CLI_EXPORTS } from "../src/cli/daemon-cli-compat.ts";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const cliDir = path.join(distDir, "cli");

const EXPORT_SPEC_RE = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/;

function parseExportAliases(bundleSource: string): Map<string, string> | null {
  const matches = [...bundleSource.matchAll(/export\s*\{([^}]+)\}\s*;?/g)];
  if (matches.length === 0) {
    return null;
  }
  const body = matches.at(-1)?.[1];
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

function resolvePublicExportAccessor(
  aliases: Map<string, string>,
  targetName: string,
): string | undefined {
  if (aliases.has(targetName)) {
    return aliases.get(targetName);
  }
  for (const alias of aliases.values()) {
    if (alias === targetName) {
      return targetName;
    }
  }
  return undefined;
}

const findCandidates = (prefixes: string[]) =>
  fs.readdirSync(distDir).filter((entry) => {
    const isMatch = prefixes.some(
      (prefix) =>
        entry === `${prefix}.js` || entry === `${prefix}.mjs` || entry.startsWith(`${prefix}-`),
    );
    if (!isMatch) {
      return false;
    }
    return entry.endsWith(".js") || entry.endsWith(".mjs");
  });

function rankEntries(entries: string[], preferredBaseName: string): string[] {
  return entries.toSorted((left, right) => {
    const leftBase = left === preferredBaseName ? 0 : 1;
    const rightBase = right === preferredBaseName ? 0 : 1;
    if (leftBase !== rightBase) {
      return leftBase - rightBase;
    }
    return left.localeCompare(right);
  });
}

function resolveBundleAccessors(params: {
  prefixes: string[];
  preferredBaseName: string;
  targets: string[];
  requiredTargets: string[];
}): { entry: string; accessors: Partial<Record<string, string>> } | null {
  const orderedCandidates = rankEntries(findCandidates(params.prefixes), params.preferredBaseName);
  for (const entry of orderedCandidates) {
    const source = fs.readFileSync(path.join(distDir, entry), "utf8");
    const aliases = parseExportAliases(source);
    if (!aliases) {
      continue;
    }
    const accessors = Object.fromEntries(
      params.targets
        .map((target) => [target, resolvePublicExportAccessor(aliases, target)])
        .filter(([, accessor]) => Boolean(accessor)),
    );
    const hasRequiredTargets = params.requiredTargets.every((target) => Boolean(accessors[target]));
    if (hasRequiredTargets) {
      return { entry, accessors };
    }
  }
  return null;
}

// In rare cases, build output can land slightly after this script starts (depending on FS timing).
// Retry briefly to avoid flaky builds.
let daemonCliCandidates = findCandidates(["daemon-cli"]);
for (let i = 0; i < 10 && daemonCliCandidates.length === 0; i++) {
  await new Promise((resolve) => setTimeout(resolve, 50));
  daemonCliCandidates = findCandidates(["daemon-cli"]);
}

if (daemonCliCandidates.length === 0) {
  throw new Error("No daemon-cli bundle found in dist; cannot write legacy CLI shim.");
}

const registerBundle = resolveBundleAccessors({
  prefixes: ["daemon-cli"],
  preferredBaseName: "daemon-cli.js",
  targets: ["registerDaemonCli"],
  requiredTargets: ["registerDaemonCli"],
});
const lifecycleBundle = resolveBundleAccessors({
  prefixes: ["lifecycle"],
  preferredBaseName: "lifecycle.js",
  targets: [
    "runDaemonInstall",
    "runDaemonRestart",
    "runDaemonStart",
    "runDaemonStop",
    "runDaemonUninstall",
  ],
  requiredTargets: ["runDaemonRestart"],
});
const statusBundle = resolveBundleAccessors({
  prefixes: ["register-service-commands"],
  preferredBaseName: "register-service-commands.js",
  targets: ["runDaemonStatus"],
  requiredTargets: ["runDaemonStatus"],
});

if (!registerBundle || !lifecycleBundle || !statusBundle) {
  throw new Error(
    `Could not resolve daemon-cli export aliases from dist bundles: ${[
      ...rankEntries(daemonCliCandidates, "daemon-cli.js"),
      ...rankEntries(findCandidates(["lifecycle"]), "lifecycle.js"),
      ...rankEntries(findCandidates(["register-service-commands"]), "register-service-commands.js"),
    ].join(", ")}`,
  );
}

const relImports = {
  register: `../${registerBundle.entry}`,
  lifecycle: `../${lifecycleBundle.entry}`,
  status: `../${statusBundle.entry}`,
} as const;
const accessors = {
  registerDaemonCli: {
    moduleVar: "daemonCliRegister",
    accessor: registerBundle.accessors.registerDaemonCli,
  },
  runDaemonInstall: {
    moduleVar: "daemonCliLifecycle",
    accessor: lifecycleBundle.accessors.runDaemonInstall,
  },
  runDaemonRestart: {
    moduleVar: "daemonCliLifecycle",
    accessor: lifecycleBundle.accessors.runDaemonRestart,
  },
  runDaemonStart: {
    moduleVar: "daemonCliLifecycle",
    accessor: lifecycleBundle.accessors.runDaemonStart,
  },
  runDaemonStatus: {
    moduleVar: "daemonCliStatus",
    accessor: statusBundle.accessors.runDaemonStatus,
  },
  runDaemonStop: {
    moduleVar: "daemonCliLifecycle",
    accessor: lifecycleBundle.accessors.runDaemonStop,
  },
  runDaemonUninstall: {
    moduleVar: "daemonCliLifecycle",
    accessor: lifecycleBundle.accessors.runDaemonUninstall,
  },
} as const;
const missingExportError = (name: string) =>
  `Legacy daemon CLI export "${name}" is unavailable in this build. Please upgrade EasyClaw.`;
const buildExportLine = (name: (typeof LEGACY_DAEMON_CLI_EXPORTS)[number]) => {
  const exportBinding = accessors[name];
  const accessor = exportBinding?.accessor;
  if (accessor) {
    return `export const ${name} = ${exportBinding.moduleVar}.${accessor};`;
  }
  if (name === "registerDaemonCli") {
    return `export const ${name} = () => { throw new Error(${JSON.stringify(missingExportError(name))}); };`;
  }
  return `export const ${name} = async () => { throw new Error(${JSON.stringify(missingExportError(name))}); };`;
};

const contents =
  "// Legacy shim for pre-tsdown update-cli imports.\n" +
  `import * as daemonCliRegister from "${relImports.register}";\n` +
  `import * as daemonCliLifecycle from "${relImports.lifecycle}";\n` +
  `import * as daemonCliStatus from "${relImports.status}";\n` +
  LEGACY_DAEMON_CLI_EXPORTS.map(buildExportLine).join("\n") +
  "\n";

fs.mkdirSync(cliDir, { recursive: true });
fs.writeFileSync(path.join(cliDir, "daemon-cli.js"), contents);
