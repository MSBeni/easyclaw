import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { readJsonFileWithFallback, writeJsonFileAtomically } from "../../plugin-sdk/json-store.js";
import type { PlannedVerificationResult } from "./planner.js";

type CapabilityVerificationStoreFile = {
  version: 1;
  fingerprint: string;
  updatedAt: string;
  results: Array<{
    id: string;
    connectorId: string;
    connectorLabel: string;
    probeKind: PlannedVerificationResult["probeKind"];
    probeLabel: string;
    status: PlannedVerificationResult["status"];
    detail: string;
    checkedAt: string;
  }>;
};

function resolveCapabilityVerificationPath(
  fingerprint: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveStateDir(env), "builder", "verifications", `${fingerprint}.json`);
}

export async function readPlannerVerificationResults(params: {
  fingerprint: string;
  env?: NodeJS.ProcessEnv;
}): Promise<PlannedVerificationResult[]> {
  const filePath = resolveCapabilityVerificationPath(params.fingerprint, params.env);
  const { value } = await readJsonFileWithFallback<CapabilityVerificationStoreFile>(filePath, {
    version: 1,
    fingerprint: params.fingerprint,
    updatedAt: "",
    results: [],
  });
  const results = Array.isArray(value.results) ? value.results : [];
  return results
    .filter(
      (entry) =>
        typeof entry?.id === "string" &&
        typeof entry.connectorId === "string" &&
        typeof entry.connectorLabel === "string" &&
        typeof entry.probeKind === "string" &&
        typeof entry.probeLabel === "string" &&
        typeof entry.status === "string" &&
        typeof entry.detail === "string" &&
        typeof entry.checkedAt === "string",
    )
    .map((entry) => ({
      id: entry.id,
      connectorId: entry.connectorId,
      connectorLabel: entry.connectorLabel,
      probeKind: entry.probeKind,
      probeLabel: entry.probeLabel,
      status: entry.status,
      detail: entry.detail,
      source: "persisted" as const,
      checkedAt: entry.checkedAt,
    }));
}

export async function writePlannerVerificationResults(params: {
  fingerprint: string;
  results: PlannedVerificationResult[];
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const filePath = resolveCapabilityVerificationPath(params.fingerprint, params.env);
  const updatedAt =
    params.results
      .map((result) => result.checkedAt)
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .toSorted()
      .at(-1) ?? new Date().toISOString();
  await writeJsonFileAtomically(filePath, {
    version: 1,
    fingerprint: params.fingerprint,
    updatedAt,
    results: params.results.map((result) => ({
      id: result.id,
      connectorId: result.connectorId,
      connectorLabel: result.connectorLabel,
      probeKind: result.probeKind,
      probeLabel: result.probeLabel,
      status: result.status,
      detail: result.detail,
      checkedAt: result.checkedAt ?? updatedAt,
    })),
  } satisfies CapabilityVerificationStoreFile);
}
