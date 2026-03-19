import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { readJsonFileWithFallback, writeJsonFileAtomically } from "../../plugin-sdk/json-store.js";
import {
  rebuildRequirementPlannerResult,
  type PlannedIntegrationInstance,
  type PlannedVerificationResult,
  type RequirementPlannerResult,
} from "./planner.js";

type CapabilityIntegrationStoreFile = {
  version: 1;
  updatedAt: string;
  integrations: Array<
    PlannedIntegrationInstance & {
      updatedAt: string;
    }
  >;
};

function resolveCapabilityIntegrationPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), "builder", "integrations.json");
}

function integrationKey(params: { connectorId: string; instanceId: string }): string {
  return `${params.connectorId}::${params.instanceId}`;
}

function dedupeStrings(values: string[]): string[] {
  return values.filter((value, index, all) => all.indexOf(value) === index);
}

function parseTimestamp(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function statusRank(status: PlannedIntegrationInstance["status"]): number {
  switch (status) {
    case "verified":
      return 7;
    case "authenticated":
      return 6;
    case "configured":
      return 5;
    case "installed":
      return 4;
    case "discovered":
      return 3;
    case "install_required":
      return 2;
    case "degraded":
      return 1;
    case "failed":
      return 0;
  }
}

function mergePersistedIntegration(
  integration: PlannedIntegrationInstance,
  persisted: (PlannedIntegrationInstance & { updatedAt?: string }) | undefined,
): PlannedIntegrationInstance {
  if (!persisted) {
    return integration;
  }

  const baseStatus = integration.status;
  let status = baseStatus;
  if (baseStatus === "install_required" || baseStatus === "discovered") {
    status = baseStatus;
  } else if (persisted.status === "verified") {
    status = "verified";
  } else if (persisted.status === "failed") {
    status = "failed";
  } else if (persisted.status === "degraded") {
    status = "degraded";
  } else if (statusRank(persisted.status) > statusRank(baseStatus)) {
    status = persisted.status;
  }

  const lastVerifiedAt = [integration.lastVerifiedAt, persisted.lastVerifiedAt]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .toSorted((left, right) => parseTimestamp(left) - parseTimestamp(right))
    .at(-1);
  const lastObservedAt = [integration.lastObservedAt, persisted.lastObservedAt, persisted.updatedAt]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .toSorted((left, right) => parseTimestamp(left) - parseTimestamp(right))
    .at(-1);

  return {
    ...integration,
    status,
    configRefs: dedupeStrings([...integration.configRefs, ...persisted.configRefs]),
    authRefs: dedupeStrings([...integration.authRefs, ...persisted.authRefs]),
    issues: dedupeStrings(
      status === baseStatus && status !== "failed" && status !== "degraded" && status !== "verified"
        ? integration.issues
        : [...integration.issues, ...persisted.issues],
    ),
    ...(lastVerifiedAt ? { lastVerifiedAt } : {}),
    ...(lastObservedAt ? { lastObservedAt } : {}),
  };
}

export async function readPersistedPlannerIntegrations(params: {
  env?: NodeJS.ProcessEnv;
}): Promise<Array<PlannedIntegrationInstance & { updatedAt?: string }>> {
  const filePath = resolveCapabilityIntegrationPath(params.env);
  const { value } = await readJsonFileWithFallback<CapabilityIntegrationStoreFile>(filePath, {
    version: 1,
    updatedAt: "",
    integrations: [],
  });
  const integrations = Array.isArray(value.integrations) ? value.integrations : [];
  return integrations
    .filter(
      (entry) =>
        typeof entry?.connectorId === "string" &&
        typeof entry.instanceId === "string" &&
        typeof entry.status === "string" &&
        Array.isArray(entry.configRefs) &&
        Array.isArray(entry.authRefs) &&
        Array.isArray(entry.issues),
    )
    .map((entry) => ({
      connectorId: entry.connectorId,
      instanceId: entry.instanceId,
      status: entry.status,
      configRefs: entry.configRefs.filter((value): value is string => typeof value === "string"),
      authRefs: entry.authRefs.filter((value): value is string => typeof value === "string"),
      issues: entry.issues.filter((value): value is string => typeof value === "string"),
      label: entry.label,
      kind: entry.kind,
      sourceKind: entry.sourceKind,
      contracts: Array.isArray(entry.contracts)
        ? entry.contracts.filter((value): value is string => typeof value === "string")
        : [],
      verification: Array.isArray(entry.verification) ? entry.verification : [],
      ...(typeof entry.lastVerifiedAt === "string" ? { lastVerifiedAt: entry.lastVerifiedAt } : {}),
      ...(typeof entry.lastObservedAt === "string" ? { lastObservedAt: entry.lastObservedAt } : {}),
      ...(typeof entry.updatedAt === "string" ? { updatedAt: entry.updatedAt } : {}),
    }));
}

export async function writePlannerIntegrations(params: {
  integrations: PlannedIntegrationInstance[];
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const filePath = resolveCapabilityIntegrationPath(params.env);
  const current = await readPersistedPlannerIntegrations({ env: params.env });
  const byKey = new Map(
    current.map((integration) => [integrationKey(integration), integration] as const),
  );
  const updatedAt = new Date().toISOString();

  for (const integration of params.integrations) {
    const key = integrationKey(integration);
    const merged = mergePersistedIntegration(integration, byKey.get(key));
    byKey.set(key, {
      ...merged,
      updatedAt,
      lastObservedAt: updatedAt,
    });
  }

  await writeJsonFileAtomically(filePath, {
    version: 1,
    updatedAt,
    integrations: Array.from(byKey.values())
      .toSorted((left, right) => integrationKey(left).localeCompare(integrationKey(right)))
      .map((integration) => ({
        ...integration,
        updatedAt: integration.updatedAt ?? updatedAt,
      })),
  } satisfies CapabilityIntegrationStoreFile);
}

export async function hydrateRequirementPlannerIntegrationState(
  planning: RequirementPlannerResult,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RequirementPlannerResult> {
  const persisted = await readPersistedPlannerIntegrations({ env });
  const persistedByKey = new Map(
    persisted.map((integration) => [integrationKey(integration), integration] as const),
  );
  const integrations = planning.integrations.map((integration) =>
    mergePersistedIntegration(integration, persistedByKey.get(integrationKey(integration))),
  );
  const verificationById = new Map(
    planning.verifications.map((result) => [result.id, result] as const),
  );
  const verifications: PlannedVerificationResult[] = planning.verifications.map((result) => {
    const integration = integrations.find((entry) => entry.connectorId === result.connectorId);
    const next = verificationById.get(result.id) ?? result;
    if (!integration) {
      return next;
    }
    if (integration.status === "verified" && next.status === "needs_live_check") {
      return {
        ...next,
        status: "passed",
        detail: `${integration.label} was previously verified successfully.`,
        source: "persisted",
        checkedAt: integration.lastVerifiedAt,
      };
    }
    if (
      (integration.status === "degraded" || integration.status === "failed") &&
      next.status !== "blocked"
    ) {
      return {
        ...next,
        status: "failed",
        detail: integration.issues[0] ?? next.detail,
        source: "persisted",
        checkedAt: integration.lastObservedAt ?? integration.lastVerifiedAt,
      };
    }
    return next;
  });

  return rebuildRequirementPlannerResult({
    status: planning.status,
    selections: planning.selections,
    alternatives: planning.alternatives,
    variants: planning.variants,
    integrations,
    verifications,
    verificationFingerprint: planning.verificationFingerprint,
    topology: planning.topology,
  });
}
