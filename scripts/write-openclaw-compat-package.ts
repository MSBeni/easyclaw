#!/usr/bin/env -S node --import tsx

import fs from "node:fs";
import path from "node:path";

type RootPackageJson = {
  version?: string;
  description?: string;
  homepage?: string;
  bugs?: unknown;
  license?: string;
  author?: string;
  repository?: unknown;
  exports?: Record<string, unknown>;
};

type CompatPackageJson = {
  name: string;
  version: string;
  description: string;
  homepage?: string;
  bugs?: unknown;
  license: string;
  author?: string;
  repository?: unknown;
  type: "module";
  main: string;
  types: string;
  bin: Record<string, string>;
  files: string[];
  exports: Record<string, string | { types: string; default: string }>;
  dependencies: Record<string, string>;
  publishConfig: {
    access: "public";
  };
};

const rootDir = process.cwd();
const compatDir = path.join(rootDir, "packages", "openclaw");
const compatBinDir = path.join(compatDir, "bin");
const compatPluginSdkDir = path.join(compatDir, "plugin-sdk");

function writeFile(targetPath: string, contents: string) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, contents, "utf8");
}

function normalizePluginSdkEntrypoints(rootPackage: RootPackageJson): string[] {
  const exportKeys = Object.keys(rootPackage.exports ?? {});
  return exportKeys
    .flatMap((key) => {
      if (key === "./plugin-sdk") {
        return ["index"];
      }
      if (key.startsWith("./plugin-sdk/")) {
        return [key.slice("./plugin-sdk/".length)];
      }
      return [];
    })
    .filter(Boolean)
    .toSorted((left, right) => {
      if (left === "index") {
        return -1;
      }
      if (right === "index") {
        return 1;
      }
      return left.localeCompare(right);
    });
}

function buildCompatExports(entrypoints: string[]) {
  const exports: CompatPackageJson["exports"] = {
    ".": {
      types: "./index.d.ts",
      default: "./index.js",
    },
    "./cli-entry": "./bin/openclaw.js",
  };
  for (const entrypoint of entrypoints) {
    const exportKey = entrypoint === "index" ? "./plugin-sdk" : `./plugin-sdk/${entrypoint}`;
    const basePath = entrypoint === "index" ? "./plugin-sdk/index" : `./plugin-sdk/${entrypoint}`;
    exports[exportKey] = {
      types: `${basePath}.d.ts`,
      default: `${basePath}.js`,
    };
  }
  return exports;
}

function buildCompatPackageJson(
  rootPackage: RootPackageJson,
  entrypoints: string[],
): CompatPackageJson {
  const version = rootPackage.version?.trim();
  if (!version) {
    throw new Error("Root package.json is missing a version.");
  }

  return {
    name: "openclaw",
    version,
    description:
      "Compatibility package that re-exports EasyClaw under the legacy OpenClaw npm name",
    ...(rootPackage.homepage ? { homepage: rootPackage.homepage } : {}),
    ...(rootPackage.bugs ? { bugs: rootPackage.bugs } : {}),
    license: rootPackage.license?.trim() || "MIT",
    ...(rootPackage.author ? { author: rootPackage.author } : {}),
    ...(rootPackage.repository ? { repository: rootPackage.repository } : {}),
    type: "module",
    main: "./index.js",
    types: "./index.d.ts",
    bin: {
      openclaw: "./bin/openclaw.js",
    },
    files: ["README.md", "bin/", "plugin-sdk/", "index.js", "index.d.ts"],
    exports: buildCompatExports(entrypoints),
    dependencies: {
      easyclaw: version,
    },
    publishConfig: {
      access: "public",
    },
  };
}

function buildReExportSource(specifier: string): string {
  return `export * from ${JSON.stringify(specifier)};\n`;
}

function buildCompatReadme(version: string): string {
  return `# openclaw

Legacy compatibility package for EasyClaw.

- \`npm install -g openclaw\` keeps the legacy package name working.
- \`openclaw\` runs the EasyClaw CLI through a compatibility entrypoint.
- \`openclaw/plugin-sdk/*\` re-exports the matching \`easyclaw/plugin-sdk/*\` modules.

This package is published from the EasyClaw monorepo and is kept on the same release line as \`easyclaw@${version}\`.
`;
}

function main() {
  const rootPackage = JSON.parse(
    fs.readFileSync(path.join(rootDir, "package.json"), "utf8"),
  ) as RootPackageJson;
  const entrypoints = normalizePluginSdkEntrypoints(rootPackage);
  const compatPackage = buildCompatPackageJson(rootPackage, entrypoints);

  fs.mkdirSync(compatDir, { recursive: true });
  writeFile(path.join(compatDir, "package.json"), `${JSON.stringify(compatPackage, null, 2)}\n`);
  writeFile(path.join(compatDir, "README.md"), buildCompatReadme(compatPackage.version));
  writeFile(path.join(compatDir, "index.js"), buildReExportSource("easyclaw"));
  writeFile(path.join(compatDir, "index.d.ts"), buildReExportSource("easyclaw"));
  writeFile(
    path.join(compatBinDir, "openclaw.js"),
    '#!/usr/bin/env node\nimport "easyclaw/cli-entry";\n',
  );

  for (const entrypoint of entrypoints) {
    const localName = entrypoint === "index" ? "index" : entrypoint;
    const sourceSpecifier =
      entrypoint === "index" ? "easyclaw/plugin-sdk" : `easyclaw/plugin-sdk/${entrypoint}`;
    writeFile(
      path.join(compatPluginSdkDir, `${localName}.js`),
      buildReExportSource(sourceSpecifier),
    );
    writeFile(
      path.join(compatPluginSdkDir, `${localName}.d.ts`),
      buildReExportSource(sourceSpecifier),
    );
  }
}

main();
