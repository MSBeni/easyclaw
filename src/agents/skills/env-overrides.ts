import fs from "node:fs";
import path from "node:path";
import type { OpenClawConfig } from "../../config/config.js";
import { resolveOAuthDir } from "../../config/paths.js";
import { normalizeResolvedSecretInputString } from "../../config/types.secrets.js";
import { OPENCLAW_GOG_CLIENT } from "../../hooks/gmail.js";
import { isDangerousHostEnvVarName } from "../../infra/host-env-security.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { sanitizeEnvVars, validateEnvVarValue } from "../sandbox/sanitize-env-vars.js";
import { resolveSkillConfig } from "./config.js";
import { resolveSkillKey } from "./frontmatter.js";
import type { SkillEntry, SkillSnapshot } from "./types.js";

const log = createSubsystemLogger("env-overrides");
const GOG_KEYRING_PASSWORD_FILENAME = "gog-keyring-password";

type EnvUpdate = { key: string };
type SkillConfig = NonNullable<ReturnType<typeof resolveSkillConfig>>;
type ActiveSkillEnvEntry = {
  baseline: string | undefined;
  value: string;
  count: number;
};

/**
 * Tracks env var keys that are currently injected by skill overrides.
 * Used by ACP harness spawn to strip skill-injected keys so they don't
 * leak to child processes (e.g., OPENAI_API_KEY leaking to Codex CLI).
 * @see https://github.com/openclaw/openclaw/issues/36280
 */
const activeSkillEnvEntries = new Map<string, ActiveSkillEnvEntry>();

/** Returns a snapshot of env var keys currently injected by skill overrides. */
export function getActiveSkillEnvKeys(): ReadonlySet<string> {
  return new Set(activeSkillEnvEntries.keys());
}

function acquireActiveSkillEnvKey(key: string, value: string): boolean {
  const active = activeSkillEnvEntries.get(key);
  if (active) {
    active.count += 1;
    if (process.env[key] === undefined) {
      process.env[key] = active.value;
    }
    return true;
  }
  if (process.env[key] !== undefined) {
    return false;
  }
  activeSkillEnvEntries.set(key, {
    baseline: process.env[key],
    value,
    count: 1,
  });
  return true;
}

function releaseActiveSkillEnvKey(key: string) {
  const active = activeSkillEnvEntries.get(key);
  if (!active) {
    return;
  }
  active.count -= 1;
  if (active.count > 0) {
    if (process.env[key] === undefined) {
      process.env[key] = active.value;
    }
    return;
  }
  activeSkillEnvEntries.delete(key);
  if (active.baseline === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = active.baseline;
  }
}

type SanitizedSkillEnvOverrides = {
  allowed: Record<string, string>;
  blocked: string[];
  warnings: string[];
};

// Always block skill env overrides that can alter runtime loading or host execution behavior.
const SKILL_ALWAYS_BLOCKED_ENV_PATTERNS: ReadonlyArray<RegExp> = [/^OPENSSL_CONF$/i];

function matchesAnyPattern(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function isAlwaysBlockedSkillEnvKey(key: string): boolean {
  return (
    isDangerousHostEnvVarName(key) || matchesAnyPattern(key, SKILL_ALWAYS_BLOCKED_ENV_PATTERNS)
  );
}

function sanitizeSkillEnvOverrides(params: {
  overrides: Record<string, string>;
  allowedSensitiveKeys: Set<string>;
}): SanitizedSkillEnvOverrides {
  if (Object.keys(params.overrides).length === 0) {
    return { allowed: {}, blocked: [], warnings: [] };
  }

  const result = sanitizeEnvVars(params.overrides);
  const allowed: Record<string, string> = {};
  const blocked = new Set<string>();
  const warnings = [...result.warnings];

  for (const [key, value] of Object.entries(result.allowed)) {
    if (isAlwaysBlockedSkillEnvKey(key)) {
      blocked.add(key);
      continue;
    }
    allowed[key] = value;
  }

  for (const key of result.blocked) {
    if (isAlwaysBlockedSkillEnvKey(key) || !params.allowedSensitiveKeys.has(key)) {
      blocked.add(key);
      continue;
    }
    const value = params.overrides[key];
    if (!value) {
      continue;
    }
    const warning = validateEnvVarValue(value);
    if (warning) {
      if (warning === "Contains null bytes") {
        blocked.add(key);
        continue;
      }
      warnings.push(`${key}: ${warning}`);
    }
    allowed[key] = value;
  }

  return { allowed, blocked: [...blocked], warnings };
}

function applySkillConfigEnvOverrides(params: {
  updates: EnvUpdate[];
  skillConfig: SkillConfig;
  config?: OpenClawConfig;
  primaryEnv?: string | null;
  requiredEnv?: string[] | null;
  skillKey: string;
}) {
  const { updates, skillConfig, config, primaryEnv, requiredEnv, skillKey } = params;
  const allowedSensitiveKeys = new Set<string>();
  const normalizedPrimaryEnv = primaryEnv?.trim();
  if (normalizedPrimaryEnv) {
    allowedSensitiveKeys.add(normalizedPrimaryEnv);
  }
  for (const envName of requiredEnv ?? []) {
    const trimmedEnv = envName.trim();
    if (trimmedEnv) {
      allowedSensitiveKeys.add(trimmedEnv);
    }
  }

  const pendingOverrides: Record<string, string> = {};
  if (skillConfig.env) {
    for (const [rawKey, envValue] of Object.entries(skillConfig.env)) {
      const envKey = rawKey.trim();
      const hasExternallyManagedValue =
        process.env[envKey] !== undefined && !activeSkillEnvEntries.has(envKey);
      if (!envKey || !envValue || hasExternallyManagedValue) {
        continue;
      }
      pendingOverrides[envKey] = envValue;
    }
  }

  const resolvedApiKey =
    normalizeResolvedSecretInputString({
      value: skillConfig.apiKey,
      path: `skills.entries.${skillKey}.apiKey`,
    }) ?? "";
  const canInjectPrimaryEnv =
    normalizedPrimaryEnv &&
    (process.env[normalizedPrimaryEnv] === undefined ||
      activeSkillEnvEntries.has(normalizedPrimaryEnv));
  if (canInjectPrimaryEnv && resolvedApiKey) {
    if (!pendingOverrides[normalizedPrimaryEnv]) {
      pendingOverrides[normalizedPrimaryEnv] = resolvedApiKey;
    }
  }
  applyGogSkillEnvOverrides({
    pendingOverrides,
    allowedSensitiveKeys,
    config,
    skillKey,
  });

  const sanitized = sanitizeSkillEnvOverrides({
    overrides: pendingOverrides,
    allowedSensitiveKeys,
  });

  if (sanitized.blocked.length > 0) {
    log.warn(`Blocked skill env overrides for ${skillKey}: ${sanitized.blocked.join(", ")}`);
  }
  if (sanitized.warnings.length > 0) {
    log.warn(`Suspicious skill env overrides for ${skillKey}: ${sanitized.warnings.join(", ")}`);
  }

  for (const [envKey, envValue] of Object.entries(sanitized.allowed)) {
    if (!acquireActiveSkillEnvKey(envKey, envValue)) {
      continue;
    }
    updates.push({ key: envKey });
    process.env[envKey] = activeSkillEnvEntries.get(envKey)?.value ?? envValue;
  }
}

function createEnvReverter(updates: EnvUpdate[]) {
  return () => {
    for (const update of updates) {
      releaseActiveSkillEnvKey(update.key);
    }
  };
}

function readPersistedGogKeyringPassword(): string | undefined {
  const envPassword = process.env.GOG_KEYRING_PASSWORD?.trim();
  if (envPassword) {
    return envPassword;
  }
  const passwordPath = path.join(resolveOAuthDir(), GOG_KEYRING_PASSWORD_FILENAME);
  try {
    const storedPassword = fs.readFileSync(passwordPath, "utf8").trim();
    return storedPassword || undefined;
  } catch {
    return undefined;
  }
}

function assignSkillEnvOverrideIfUnset(
  pendingOverrides: Record<string, string>,
  key: string,
  value: string | undefined,
) {
  if (!value || pendingOverrides[key]) {
    return;
  }
  pendingOverrides[key] = value;
}

function applyGogSkillEnvOverrides(params: {
  pendingOverrides: Record<string, string>;
  allowedSensitiveKeys: Set<string>;
  config?: OpenClawConfig;
  skillKey: string;
}) {
  if (params.skillKey !== "gog") {
    return;
  }
  const configuredAccount = params.config?.hooks?.gmail?.account?.trim();
  if (!configuredAccount) {
    return;
  }

  assignSkillEnvOverrideIfUnset(params.pendingOverrides, "GOG_CLIENT", OPENCLAW_GOG_CLIENT);
  assignSkillEnvOverrideIfUnset(params.pendingOverrides, "GOG_ACCOUNT", configuredAccount);

  const keyringPassword = readPersistedGogKeyringPassword();
  if (!keyringPassword) {
    return;
  }

  // Password-bearing env vars are blocked by default; explicitly allow this one
  // when it comes from OpenClaw's persisted Gmail setup state.
  params.allowedSensitiveKeys.add("GOG_KEYRING_PASSWORD");
  assignSkillEnvOverrideIfUnset(params.pendingOverrides, "GOG_KEYRING_BACKEND", "file");
  assignSkillEnvOverrideIfUnset(params.pendingOverrides, "GOG_KEYRING_PASSWORD", keyringPassword);
}

export function applySkillEnvOverrides(params: { skills: SkillEntry[]; config?: OpenClawConfig }) {
  const { skills, config } = params;
  const updates: EnvUpdate[] = [];

  for (const entry of skills) {
    const skillKey = resolveSkillKey(entry.skill, entry);
    const skillConfig = resolveSkillConfig(config, skillKey) ?? {};

    applySkillConfigEnvOverrides({
      updates,
      skillConfig,
      config,
      primaryEnv: entry.metadata?.primaryEnv,
      requiredEnv: entry.metadata?.requires?.env,
      skillKey,
    });
  }

  return createEnvReverter(updates);
}

export function applySkillEnvOverridesFromSnapshot(params: {
  snapshot?: SkillSnapshot;
  config?: OpenClawConfig;
}) {
  const { snapshot, config } = params;
  if (!snapshot) {
    return () => {};
  }
  const updates: EnvUpdate[] = [];

  for (const skill of snapshot.skills) {
    const skillConfig = resolveSkillConfig(config, skill.name) ?? {};

    applySkillConfigEnvOverrides({
      updates,
      skillConfig,
      config,
      primaryEnv: skill.primaryEnv,
      requiredEnv: skill.requiredEnv,
      skillKey: skill.name,
    });
  }

  return createEnvReverter(updates);
}
