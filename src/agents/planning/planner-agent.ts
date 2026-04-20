import {
  streamSimple,
  type Api,
  type AssistantMessageEvent,
  type Model,
} from "@mariozechner/pi-ai";
import { Value } from "@sinclair/typebox/value";
import type { OpenClawConfig } from "../../config/config.js";
import { resolveOpenClawAgentDir } from "../agent-paths.js";
import type { AgentBlueprintCatalogEntry } from "../blueprints/registry.js";
import type { AgentBlueprintBundle } from "../blueprints/schema.js";
import type { RequirementPlannerResult } from "../capabilities/planner.js";
import type { RequirementSet } from "../capabilities/requirements.js";
import type { CapabilityRegistry } from "../capabilities/schema.js";
import { normalizeTimeZoneInput } from "../date-time.js";
import { getApiKeyForModel, requireApiKey } from "../model-auth.js";
import { ensureOpenClawModelsJson } from "../models-config.js";
import { resolveModelWithRegistry } from "../pi-embedded-runner/model.js";
import { discoverAuthStorage, discoverModels } from "../pi-model-discovery.js";
import type { BuildSpec } from "./build-spec.js";
import { BuildSpecSchema } from "./build-spec.js";

export type BuilderPlannerAgentGraphMode = "single-agent" | "multi-agent" | "swarm";

export type BuilderPlannerAgentGraphInput = {
  mode: BuilderPlannerAgentGraphMode;
  entryNodeId: string;
  nodes: Array<{
    id: string;
    roleId: string;
    label: string;
    entry: boolean;
    connectorIds: string[];
    responsibilities: string[];
  }>;
  edges: Array<{
    id: string;
    fromNodeId: string;
    toNodeId: string;
    kind: string;
    label: string;
  }>;
};

export type BuilderPlannerAgentInput = {
  brief: string;
  cfg?: OpenClawConfig;
  bundle: AgentBlueprintBundle;
  requirements: RequirementSet;
  planning: RequirementPlannerResult;
  templateId: string;
  templateDisplayName: string;
  templateConfidence: "low" | "medium" | "high";
  templateReasons: string[];
  assumptions: string[];
  questions: Array<{ prompt: string }>;
  capabilityRegistry: CapabilityRegistry;
  templateExemplars: AgentBlueprintCatalogEntry[];
  runtimeGraph: BuilderPlannerAgentGraphInput;
};

export type BuilderPlannerAgentContract = {
  id: "easyclaw-hybrid-planner";
  version: "0.2.0";
  kind: "hybrid-deterministic" | "model-backed-hybrid";
  deterministicValidationRequired: true;
  plannerModelPolicy: "separate-control-plane-model";
};

export type BuilderPlannerAgentOutput = {
  contract: BuilderPlannerAgentContract;
  buildSpec: BuildSpec;
};

type PlannerModelCandidate = {
  provider: string;
  model: string;
  source: "preferred-configured-reasoning-model" | "builder-runtime-model" | "agent-default-model";
};

type PlannerModelResolution = {
  provider: string;
  model: string;
  modelRef: string;
  source: PlannerModelCandidate["source"];
  resolvedModel: Model<Api>;
  apiKey: string;
};

type PlannerModelRunnerParams = {
  model: PlannerModelResolution;
  systemPrompt: string;
  prompt: string;
};

type BuildSpecValidationIssue = {
  path: string;
  message: string;
};

type CandidateGraphNode = BuildSpec["graph"]["nodes"][number];
type CandidateIntegration = BuildSpec["integrations"][number];
type CandidateSetupAction = BuildSpec["setupActions"][number];
type CandidateWorkspaceArtifact = BuildSpec["workspaceArtifacts"][number];
type RelevantConnectorSummaryEntry = {
  id: string;
  label: string;
  kind: string;
  sourceKind: string;
  contracts: string[];
  onboarding: boolean;
  requiresConfig: boolean;
  requiresAuth: boolean;
  installRequired: boolean;
  installStrategy: string;
};

const PLANNER_REPAIR_ATTEMPTS = 2;
const BUILDER_PLANNER_CONTRACT_ID = "easyclaw-hybrid-planner";
const BUILDER_PLANNER_CONTRACT_VERSION = "0.2.0";

const PREFERRED_PLANNER_MODELS: PlannerModelCandidate[] = [
  {
    provider: "anthropic",
    model: "claude-opus-4-6",
    source: "preferred-configured-reasoning-model",
  },
  {
    provider: "openai",
    model: "gpt-5.4",
    source: "preferred-configured-reasoning-model",
  },
  {
    provider: "openai-codex",
    model: "gpt-5.4",
    source: "preferred-configured-reasoning-model",
  },
  {
    provider: "google",
    model: "gemini-2.5-pro",
    source: "preferred-configured-reasoning-model",
  },
  {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    source: "preferred-configured-reasoning-model",
  },
] as const;

function createPlannerContract(
  kind: BuilderPlannerAgentContract["kind"],
): BuilderPlannerAgentContract {
  return {
    id: BUILDER_PLANNER_CONTRACT_ID,
    version: BUILDER_PLANNER_CONTRACT_VERSION,
    kind,
    deterministicValidationRequired: true,
    plannerModelPolicy: "separate-control-plane-model",
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function dedupeStrings(values: string[]): string[] {
  return values.filter((value, index, all) => all.indexOf(value) === index);
}

function normalizeScheduleTimeZone(params: {
  timeZone?: string;
  timeZoneLabel?: string;
  fallbackTimeZone?: string;
  fallbackTimeZoneLabel?: string;
}): Pick<BuildSpec["schedule"], "timezone" | "timezoneLabel"> {
  const resolveNormalized = (
    timeZone?: string,
    timeZoneLabel?: string,
  ): Pick<BuildSpec["schedule"], "timezone" | "timezoneLabel"> | null => {
    const normalized = normalizeTimeZoneInput(timeZone);
    if (!normalized) {
      return null;
    }
    const trimmedTimeZone = timeZone?.trim();
    const trimmedLabel = timeZoneLabel?.trim();
    return {
      timezone: normalized.timeZone,
      ...((trimmedLabel && trimmedLabel.toLowerCase() !== trimmedTimeZone?.toLowerCase()) ||
      (!trimmedLabel && normalized.label)
        ? { timezoneLabel: trimmedLabel || normalized.label }
        : normalized.label
          ? { timezoneLabel: normalized.label }
          : trimmedLabel
            ? { timezoneLabel: trimmedLabel }
            : {}),
    };
  };

  return (
    resolveNormalized(params.timeZone, params.timeZoneLabel) ??
    resolveNormalized(params.fallbackTimeZone, params.fallbackTimeZoneLabel) ??
    {}
  );
}

function resolveWorkspaceArtifactPurpose(fileName: string): string {
  switch (fileName) {
    case "AGENTS.md":
      return "Working agreement and generated agent operating instructions.";
    case "SOUL.md":
      return "Persona, tone, and behavioral defaults.";
    case "TOOLS.md":
      return "Tool, skill, and access posture.";
    case "IDENTITY.md":
      return "Identity and presentation details.";
    case "USER.md":
      return "Owner and end-user context.";
    case "HEARTBEAT.md":
      return "Recurring operating checklist and cadence notes.";
    case "MEMORY.md":
      return "Durable memory and recall strategy.";
    default:
      return "Managed workspace artifact for this planned agent.";
  }
}

function summarizeWorkspaceArtifact(fileName: string): string {
  switch (fileName) {
    case "AGENTS.md":
      return "Blueprint summary, routing posture, safety defaults, and success criteria.";
    case "SOUL.md":
      return "Role, name, vibe, and persona notes.";
    case "TOOLS.md":
      return "Tool profile, thinking level, skills, and delegation posture.";
    case "IDENTITY.md":
      return "Name, creature, vibe, emoji, and avatar.";
    case "USER.md":
      return "Intended role and user-context placeholders.";
    case "HEARTBEAT.md":
      return "Checklist-style recurring instructions.";
    case "MEMORY.md":
      return "Memory mode guidance and capture expectations.";
    default:
      return "Managed preview available during review.";
  }
}

function resolveGraphMode(params: BuilderPlannerAgentInput): BuildSpec["graph"]["mode"] {
  if (params.runtimeGraph.mode === "single-agent") {
    return "single-agent";
  }
  return params.runtimeGraph.nodes.length > 2 ? "swarm" : "multi-agent";
}

function buildTemplateExemplarSummary(
  entries: AgentBlueprintCatalogEntry[],
): Array<Record<string, unknown>> {
  return entries.slice(0, 6).map((entry) => ({
    templateId: entry.templateId,
    displayName: entry.displayName,
    summary: entry.summary,
    tags: entry.tags,
    tier: entry.tier,
  }));
}

function buildContractCatalogSummary(registry: CapabilityRegistry): Array<Record<string, unknown>> {
  return registry.contracts.map((contract) => ({
    id: contract.id,
    label: contract.label,
    family: contract.family,
    summary: contract.summary,
    risk: contract.risk,
  }));
}

function buildConnectorCatalogSummary(
  registry: CapabilityRegistry,
): Array<Record<string, unknown>> {
  return registry.connectors.map((connector) => ({
    id: connector.id,
    label: connector.label,
    kind: connector.kind,
    sourceKind: connector.source.kind,
    contracts: connector.contracts,
    requiresConfig: connector.setup.requiresConfig,
    requiresAuth: connector.setup.requiresAuth,
    installRequired: connector.install.required,
  }));
}

function buildRelevantConnectorSummary(
  params: BuilderPlannerAgentInput,
): RelevantConnectorSummaryEntry[] {
  const relevantConnectorIds = dedupeStrings([
    ...params.planning.alternatives.flatMap((alternative) => [
      ...alternative.selectedConnectorIds,
      ...alternative.candidates.map((candidate) => candidate.connectorId),
    ]),
    ...params.planning.integrations.map((integration) => integration.connectorId),
    ...params.planning.setupTasks.map((task) => task.connectorId),
    ...params.runtimeGraph.nodes.flatMap((node) => node.connectorIds),
  ]);
  const summaries: RelevantConnectorSummaryEntry[] = [];
  for (const connectorId of relevantConnectorIds) {
    const connector = params.capabilityRegistry.connectorsById.get(connectorId);
    if (!connector) {
      continue;
    }
    summaries.push({
      id: connector.id,
      label: connector.label,
      kind: connector.kind,
      sourceKind: connector.source.kind,
      contracts: connector.contracts,
      onboarding: connector.setup.onboarding,
      requiresConfig: connector.setup.requiresConfig,
      requiresAuth: connector.setup.requiresAuth,
      installRequired: connector.install.required,
      installStrategy: connector.install.strategy,
    });
  }
  return summaries;
}

function buildBaselineBuildSpec(params: {
  input: BuilderPlannerAgentInput;
  contract: BuilderPlannerAgentContract;
  planner: BuildSpec["planner"];
}): BuildSpec {
  const readyIntegrationCount = params.input.planning.integrations.filter((integration) =>
    ["configured", "authenticated", "verified"].includes(integration.status),
  ).length;
  const unresolvedIntegrationCount =
    params.input.planning.integrations.length - readyIntegrationCount;
  const schedule = params.input.bundle.automation?.schedules?.[0];
  const normalizedScheduleTimeZone = normalizeScheduleTimeZone({
    timeZone: schedule?.timezone,
  });
  const exemplarNames = params.input.templateExemplars
    .slice(0, 4)
    .map((entry) => `${entry.displayName} (${entry.templateId})`);

  return {
    version: 1,
    brief: params.input.brief,
    status: params.input.planning.status,
    contract: params.contract,
    planner: params.planner,
    context: {
      capabilityContractCount: params.input.capabilityRegistry.contracts.length,
      connectorCount: params.input.capabilityRegistry.connectors.length,
      templateExemplarCount: params.input.templateExemplars.length,
      readyIntegrationCount,
      unresolvedIntegrationCount,
    },
    goal: {
      primaryGoal: params.input.requirements.workflow.primaryGoal,
      executionMode: params.input.requirements.workflow.executionMode,
      confidence: params.input.requirements.confidence,
    },
    template: {
      templateId: params.input.templateId,
      displayName: params.input.templateDisplayName,
      confidence: params.input.templateConfidence,
      reasons: [...params.input.templateReasons],
    },
    schedule: {
      ...(schedule?.schedule ? { cron: schedule.schedule } : {}),
      ...(schedule?.purpose ? { description: schedule.purpose } : {}),
      ...normalizedScheduleTimeZone,
    },
    graph: {
      mode: resolveGraphMode(params.input),
      entryNodeId: params.input.runtimeGraph.entryNodeId,
      nodes: params.input.runtimeGraph.nodes.map((node) => ({
        id: node.id,
        roleId: node.roleId,
        label: node.label,
        entry: node.entry,
        contractIds:
          params.input.planning.topology.roles.find((role) => role.id === node.roleId)
            ?.contractIds ?? [],
        connectorIds: [...node.connectorIds],
        responsibilities: [...node.responsibilities],
      })),
      edges: params.input.runtimeGraph.edges.map((edge) => ({
        id: edge.id,
        fromNodeId: edge.fromNodeId,
        toNodeId: edge.toNodeId,
        kind: edge.kind,
        label: edge.label,
      })),
    },
    integrations: params.input.planning.integrations.map((integration) => ({
      connectorId: integration.connectorId,
      label: integration.label,
      status: integration.status,
      kind: integration.kind,
      sourceKind: integration.sourceKind,
      issues: [...integration.issues],
    })),
    setupActions: params.input.planning.setupTasks.map((task) => ({
      connectorId: task.connectorId,
      title: task.title,
      detail: task.detail,
      status: task.status,
      refs: [...task.refs],
    })),
    workspaceArtifacts: (params.input.bundle.workspace.bootstrapFiles ?? []).map((fileName) => ({
      fileName,
      purpose: resolveWorkspaceArtifactPurpose(fileName),
      status: "planned",
      previewSummary: summarizeWorkspaceArtifact(fileName),
    })),
    assumptions: [...params.input.assumptions],
    questions: params.input.questions.map((question) => question.prompt),
    notes: [
      "Planner input included capability registry data, connector readiness, auth state, and template exemplars.",
      "This BuildSpec remains advisory until deterministic validation and compilation succeed.",
      exemplarNames.length > 0
        ? `Template exemplars considered: ${exemplarNames.join(", ")}.`
        : "No template exemplars were available.",
    ],
  };
}

function buildAllowedContractIdSet(params: BuilderPlannerAgentInput): Set<string> {
  return new Set(params.capabilityRegistry.contracts.map((contract) => contract.id));
}

function canonicalizeGraphNode(value: unknown): CandidateGraphNode | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const id = readOptionalString(record.id);
  const roleId = readOptionalString(record.roleId);
  const label = readOptionalString(record.label);
  const entry = readOptionalBoolean(record.entry);
  if (!id || !roleId || !label || entry === undefined) {
    return null;
  }
  const templateId = readOptionalString(record.templateId);
  const goal = readOptionalString(record.goal);
  const upstreamNodeIds = readStringArray(record.upstreamNodeIds);
  return {
    id,
    roleId,
    label,
    entry,
    ...(templateId ? { templateId } : {}),
    ...(goal ? { goal } : {}),
    contractIds: readStringArray(record.contractIds),
    connectorIds: readStringArray(record.connectorIds),
    ...(upstreamNodeIds.length > 0 ? { upstreamNodeIds } : {}),
    responsibilities: readStringArray(record.responsibilities),
  };
}

function canonicalizeGraph(value: unknown, fallback: BuildSpec["graph"]): BuildSpec["graph"] {
  const record = asRecord(value);
  if (!record) {
    return fallback;
  }
  const modeRaw = readOptionalString(record.mode);
  const mode =
    modeRaw === "single-agent" || modeRaw === "multi-agent" || modeRaw === "swarm"
      ? modeRaw
      : fallback.mode;
  const entryNodeId = readOptionalString(record.entryNodeId) ?? fallback.entryNodeId;
  const nodesRaw = Array.isArray(record.nodes) ? record.nodes.map(canonicalizeGraphNode) : [];
  const nodes = nodesRaw.filter((node): node is CandidateGraphNode => Boolean(node));
  const edges = Array.isArray(record.edges)
    ? record.edges
        .map((entry) => {
          const item = asRecord(entry);
          if (!item) {
            return null;
          }
          const id = readOptionalString(item.id);
          const fromNodeId = readOptionalString(item.fromNodeId);
          const toNodeId = readOptionalString(item.toNodeId);
          const kind = readOptionalString(item.kind);
          const label = readOptionalString(item.label);
          if (!id || !fromNodeId || !toNodeId || !kind || !label) {
            return null;
          }
          return { id, fromNodeId, toNodeId, kind, label };
        })
        .filter((entry): entry is BuildSpec["graph"]["edges"][number] => Boolean(entry))
    : [];

  return {
    mode,
    entryNodeId,
    nodes: nodes.length > 0 ? nodes : fallback.nodes,
    edges: nodes.length > 0 ? edges : fallback.edges,
  };
}

function canonicalizeIntegrations(
  value: unknown,
  fallback: BuildSpec["integrations"],
): BuildSpec["integrations"] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const next = value
    .map((entry) => {
      const record = asRecord(entry);
      if (!record) {
        return null;
      }
      const connectorId = readOptionalString(record.connectorId);
      const label = readOptionalString(record.label);
      const status = readOptionalString(record.status);
      const kind = readOptionalString(record.kind);
      const sourceKind = readOptionalString(record.sourceKind);
      if (!connectorId || !label || !status || !kind || !sourceKind) {
        return null;
      }
      return {
        connectorId,
        label,
        status,
        kind,
        sourceKind,
        issues: readStringArray(record.issues),
      };
    })
    .filter((entry): entry is CandidateIntegration => Boolean(entry));
  return next.length > 0 ? next : fallback;
}

function canonicalizeSetupActions(
  value: unknown,
  fallback: BuildSpec["setupActions"],
): BuildSpec["setupActions"] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const next = value
    .map((entry) => {
      const record = asRecord(entry);
      if (!record) {
        return null;
      }
      const connectorId = readOptionalString(record.connectorId);
      const title = readOptionalString(record.title);
      const detail = readOptionalString(record.detail);
      const status = readOptionalString(record.status);
      if (!connectorId || !title || !detail || (status !== "completed" && status !== "pending")) {
        return null;
      }
      return {
        connectorId,
        title,
        detail,
        status,
        refs: readStringArray(record.refs),
      };
    })
    .filter((entry): entry is CandidateSetupAction => Boolean(entry));
  return next.length > 0 ? next : fallback;
}

function canonicalizeWorkspaceArtifacts(
  value: unknown,
  fallback: BuildSpec["workspaceArtifacts"],
): BuildSpec["workspaceArtifacts"] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const byFileName = new Map<string, CandidateWorkspaceArtifact>(
    fallback.map((artifact) => [artifact.fileName, artifact]),
  );

  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) {
      continue;
    }
    const fileName = readOptionalString(record.fileName);
    if (!fileName) {
      continue;
    }
    const fallbackEntry = byFileName.get(fileName);
    const purpose = readOptionalString(record.purpose) ?? fallbackEntry?.purpose;
    const previewSummary =
      readOptionalString(record.previewSummary) ?? fallbackEntry?.previewSummary;
    const statusRaw = readOptionalString(record.status);
    const status =
      statusRaw === "planned" || statusRaw === "suggested" || statusRaw === "generated"
        ? statusRaw
        : (fallbackEntry?.status ?? "planned");
    if (!purpose || !previewSummary) {
      continue;
    }
    byFileName.set(fileName, {
      fileName,
      purpose,
      status,
      previewSummary,
      ...(readOptionalString(record.managedSection)
        ? { managedSection: readOptionalString(record.managedSection) }
        : fallbackEntry?.managedSection
          ? { managedSection: fallbackEntry.managedSection }
          : {}),
    });
  }

  return Array.from(byFileName.values());
}

function canonicalizeSchedule(
  value: unknown,
  fallback: BuildSpec["schedule"],
): BuildSpec["schedule"] {
  const record = asRecord(value);
  if (!record) {
    return {
      ...fallback,
      ...normalizeScheduleTimeZone({
        fallbackTimeZone: fallback.timezone,
        fallbackTimeZoneLabel: fallback.timezoneLabel,
      }),
    };
  }
  const normalizedScheduleTimeZone = normalizeScheduleTimeZone({
    timeZone: readOptionalString(record.timezone),
    timeZoneLabel: readOptionalString(record.timezoneLabel),
    fallbackTimeZone: fallback.timezone,
    fallbackTimeZoneLabel: fallback.timezoneLabel,
  });
  return {
    ...((readOptionalString(record.cron) ?? fallback.cron)
      ? { cron: readOptionalString(record.cron) ?? fallback.cron }
      : {}),
    ...((readOptionalString(record.description) ?? fallback.description)
      ? { description: readOptionalString(record.description) ?? fallback.description }
      : {}),
    ...normalizedScheduleTimeZone,
    ...((readOptionalBoolean(record.assumed) ?? fallback.assumed)
      ? { assumed: readOptionalBoolean(record.assumed) ?? fallback.assumed }
      : {}),
  };
}

function canonicalizeCandidateBuildSpec(params: {
  candidate: unknown;
  fallback: BuildSpec;
  contract: BuilderPlannerAgentContract;
  planner: BuildSpec["planner"];
}): BuildSpec {
  const record = asRecord(params.candidate) ?? {};
  const assumptions = readStringArray(record.assumptions);
  const questions = readStringArray(record.questions);
  const notes = readStringArray(record.notes);

  return {
    ...params.fallback,
    contract: params.contract,
    planner: params.planner,
    schedule: canonicalizeSchedule(record.schedule, params.fallback.schedule),
    graph: canonicalizeGraph(record.graph, params.fallback.graph),
    integrations: canonicalizeIntegrations(record.integrations, params.fallback.integrations),
    setupActions: canonicalizeSetupActions(record.setupActions, params.fallback.setupActions),
    workspaceArtifacts: canonicalizeWorkspaceArtifacts(
      record.workspaceArtifacts,
      params.fallback.workspaceArtifacts,
    ),
    assumptions: assumptions.length > 0 ? assumptions : params.fallback.assumptions,
    questions: questions.length > 0 ? questions : params.fallback.questions,
    notes: notes.length > 0 ? notes : params.fallback.notes,
  };
}

function collectSchemaValidationIssues(value: unknown): BuildSpecValidationIssue[] {
  return [...Value.Errors(BuildSpecSchema, value)].map((error) => ({
    path: error.path || "/",
    message: error.message,
  }));
}

function collectRuntimeValidationIssues(params: {
  buildSpec: BuildSpec;
  input: BuilderPlannerAgentInput;
  requiredWorkspaceFiles: string[];
}): BuildSpecValidationIssue[] {
  const issues: BuildSpecValidationIssue[] = [];
  const graph = params.buildSpec.graph;
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const allowedContractIds = buildAllowedContractIdSet(params.input);
  const requiredFiles = new Set(params.requiredWorkspaceFiles);

  if (graph.nodes.length === 0) {
    issues.push({
      path: "/graph/nodes",
      message: "Planner graph must contain at least one node.",
    });
    return issues;
  }

  for (let index = 0; index < graph.nodes.length; index += 1) {
    const node = graph.nodes[index];
    if (nodeIds.has(node.id)) {
      issues.push({
        path: `/graph/nodes/${index}/id`,
        message: `Duplicate node id "${node.id}".`,
      });
    }
    nodeIds.add(node.id);

    for (const contractId of node.contractIds) {
      if (!allowedContractIds.has(contractId)) {
        issues.push({
          path: `/graph/nodes/${index}/contractIds`,
          message: `Unknown contract "${contractId}".`,
        });
      }
    }

    for (const connectorId of node.connectorIds) {
      if (!params.input.capabilityRegistry.connectorsById.has(connectorId)) {
        issues.push({
          path: `/graph/nodes/${index}/connectorIds`,
          message: `Unknown connector "${connectorId}".`,
        });
      }
    }

    if (node.responsibilities.length === 0) {
      issues.push({
        path: `/graph/nodes/${index}/responsibilities`,
        message: `Node "${node.id}" must declare at least one responsibility.`,
      });
    }

    for (const upstreamNodeId of node.upstreamNodeIds ?? []) {
      if (!graph.nodes.some((candidate) => candidate.id === upstreamNodeId)) {
        issues.push({
          path: `/graph/nodes/${index}/upstreamNodeIds`,
          message: `Node "${node.id}" references unknown upstream node "${upstreamNodeId}".`,
        });
      }
    }
  }

  const entryNodes = graph.nodes.filter((node) => node.entry);
  if (!nodeIds.has(graph.entryNodeId)) {
    issues.push({
      path: "/graph/entryNodeId",
      message: `Entry node "${graph.entryNodeId}" does not exist in the graph.`,
    });
  }
  if (entryNodes.length !== 1) {
    issues.push({
      path: "/graph/nodes",
      message: `Planner graph must have exactly one entry node, found ${entryNodes.length}.`,
    });
  }
  if (entryNodes[0] && entryNodes[0].id !== graph.entryNodeId) {
    issues.push({
      path: "/graph/entryNodeId",
      message: "entryNodeId must match the node marked as entry.",
    });
  }

  if (graph.mode === "single-agent" && (graph.nodes.length !== 1 || graph.edges.length !== 0)) {
    issues.push({
      path: "/graph/mode",
      message: "single-agent mode must have exactly one node and no edges.",
    });
  }
  if (graph.mode === "multi-agent" && graph.nodes.length < 2) {
    issues.push({
      path: "/graph/mode",
      message: "multi-agent mode must contain at least two nodes.",
    });
  }
  if (graph.mode === "swarm" && graph.nodes.length < 3) {
    issues.push({
      path: "/graph/mode",
      message: "swarm mode must contain at least three nodes.",
    });
  }

  const adjacency = new Map<string, string[]>();
  for (let index = 0; index < graph.edges.length; index += 1) {
    const edge = graph.edges[index];
    if (edgeIds.has(edge.id)) {
      issues.push({
        path: `/graph/edges/${index}/id`,
        message: `Duplicate edge id "${edge.id}".`,
      });
    }
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.fromNodeId)) {
      issues.push({
        path: `/graph/edges/${index}/fromNodeId`,
        message: `Edge references unknown source node "${edge.fromNodeId}".`,
      });
    }
    if (!nodeIds.has(edge.toNodeId)) {
      issues.push({
        path: `/graph/edges/${index}/toNodeId`,
        message: `Edge references unknown target node "${edge.toNodeId}".`,
      });
    }
    adjacency.set(edge.fromNodeId, [...(adjacency.get(edge.fromNodeId) ?? []), edge.toNodeId]);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const hasCycle = (nodeId: string): boolean => {
    if (visited.has(nodeId)) {
      return false;
    }
    if (visiting.has(nodeId)) {
      return true;
    }
    visiting.add(nodeId);
    for (const neighbor of adjacency.get(nodeId) ?? []) {
      if (hasCycle(neighbor)) {
        return true;
      }
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  };

  if (graph.nodes.some((node) => hasCycle(node.id))) {
    issues.push({
      path: "/graph/edges",
      message: "Planner graph must be acyclic.",
    });
  }

  for (let index = 0; index < params.buildSpec.integrations.length; index += 1) {
    const integration = params.buildSpec.integrations[index];
    if (!params.input.capabilityRegistry.connectorsById.has(integration.connectorId)) {
      issues.push({
        path: `/integrations/${index}/connectorId`,
        message: `Unknown integration connector "${integration.connectorId}".`,
      });
    }
  }

  for (let index = 0; index < params.buildSpec.setupActions.length; index += 1) {
    const action = params.buildSpec.setupActions[index];
    if (!params.input.capabilityRegistry.connectorsById.has(action.connectorId)) {
      issues.push({
        path: `/setupActions/${index}/connectorId`,
        message: `Unknown setup action connector "${action.connectorId}".`,
      });
    }
  }

  for (const fileName of requiredFiles) {
    if (!params.buildSpec.workspaceArtifacts.some((artifact) => artifact.fileName === fileName)) {
      issues.push({
        path: "/workspaceArtifacts",
        message: `Required managed workspace file "${fileName}" is missing from the BuildSpec.`,
      });
    }
  }

  return issues;
}

function formatValidationIssues(issues: BuildSpecValidationIssue[]): string {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n");
}

function buildPlannerSystemPrompt(): string {
  return [
    "You are the EasyClaw hybrid planning agent for Builder.",
    "Convert the user brief and deterministic planner context into a stronger BuildSpec.",
    "Rules:",
    "- Return JSON only. No markdown fences.",
    "- Keep status aligned with the deterministic planner status.",
    "- Use only connector IDs from the provided connector catalog.",
    "- Use only contract IDs from the provided contract catalog.",
    "- Prefer the simplest graph that satisfies the request.",
    "- Use multi-agent when there are clearly distinct worker roles.",
    "- Use swarm only when three or more cooperating roles materially improve the plan.",
    "- The graph must be a directed acyclic graph with exactly one entry node.",
    "- workspaceArtifacts.managedSection should contain the managed markdown section body for that file, not the whole file shell.",
    "- Keep doc content concise, specific, and operational.",
  ].join("\n");
}

function buildPlannerPrompt(params: {
  input: BuilderPlannerAgentInput;
  baseline: BuildSpec;
  previousIssues?: BuildSpecValidationIssue[];
  previousCandidate?: unknown;
}): string {
  const promptPayload = {
    brief: params.input.brief,
    workflow: params.input.requirements.workflow,
    intentTags: params.input.requirements.intentTags,
    triggers: params.input.requirements.triggers.map((entry) => entry.detail),
    inputs: params.input.requirements.inputs.map((entry) => entry.detail),
    transforms: params.input.requirements.transforms.map((entry) => entry.detail),
    actions: params.input.requirements.actions.map((entry) => entry.detail),
    outputs: params.input.requirements.outputs.map((entry) => entry.detail),
    policies: params.input.requirements.policies.map((entry) => entry.detail),
    constraints: params.input.requirements.constraints.map((entry) => entry.detail),
    ambiguities: params.input.requirements.ambiguities,
    missingInputs: params.input.requirements.missingInputs,
    setupGaps: params.input.requirements.setupGaps,
    policyGaps: params.input.requirements.policyGaps,
    unsupportedGaps: params.input.requirements.unsupportedGaps,
    planning: {
      status: params.input.planning.status,
      alternatives: params.input.planning.alternatives.map((alternative) => ({
        requirementId: alternative.requirementId,
        requirementLabel: alternative.requirementLabel,
        selectedConnectorIds: alternative.selectedConnectorIds,
        candidates: alternative.candidates.map((candidate) => ({
          connectorId: candidate.connectorId,
          connectorLabel: candidate.connectorLabel,
          source: candidate.source,
          selected: candidate.selected,
          readiness: candidate.readiness,
          reason: candidate.reason,
        })),
      })),
      integrations: params.input.planning.integrations.map((integration) => ({
        connectorId: integration.connectorId,
        label: integration.label,
        status: integration.status,
        kind: integration.kind,
        sourceKind: integration.sourceKind,
        issues: integration.issues,
      })),
      setupTasks: params.input.planning.setupTasks,
      topology: params.input.planning.topology,
      deterministicGraph: params.input.runtimeGraph,
    },
    contractCatalog: buildContractCatalogSummary(params.input.capabilityRegistry),
    connectorCatalog: buildConnectorCatalogSummary(params.input.capabilityRegistry),
    relevantConnectors: buildRelevantConnectorSummary(params.input),
    templateExemplars: buildTemplateExemplarSummary(params.input.templateExemplars),
    requiredWorkspaceFiles: params.input.bundle.workspace.bootstrapFiles ?? [],
    baselineBuildSpec: params.baseline,
    ...(params.previousIssues?.length
      ? {
          previousValidationErrors: params.previousIssues,
          previousCandidate: params.previousCandidate ?? null,
          repairDirective:
            "Repair the invalid parts and return a full corrected JSON object with the same schema.",
        }
      : {}),
  };

  return [
    "Produce one BuildSpec JSON object.",
    "The deterministic planner draft is a safe baseline. Improve it where helpful, but do not invent unsupported connectors.",
    "Focus on:",
    "- cleaner source/delivery/tool mapping",
    "- better node decomposition when multiple cooperating roles help",
    "- better setup actions and doc guidance",
    "",
    JSON.stringify(promptPayload, null, 2),
  ].join("\n");
}

function extractJsonObjectCandidate(text: string): string {
  const trimmed = text.trim();
  const withoutFences = trimmed.startsWith("```")
    ? trimmed
        .replace(/^```[a-z0-9_-]*\s*/i, "")
        .replace(/```$/i, "")
        .trim()
    : trimmed;
  const start = withoutFences.indexOf("{");
  const end = withoutFences.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("Planner model did not return a JSON object.");
  }
  return withoutFences.slice(start, end + 1);
}

function collectTextContent(content: Array<{ type?: string; text?: string }>): string {
  return content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}

async function defaultPlannerModelRunner(params: PlannerModelRunnerParams): Promise<string> {
  const stream = streamSimple(
    params.model.resolvedModel,
    {
      systemPrompt: params.systemPrompt,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: params.prompt }],
          timestamp: Date.now(),
        },
      ],
    },
    {
      apiKey: params.model.apiKey,
      reasoning: "high",
    },
  );

  let text = "";
  let finalEvent:
    | Extract<AssistantMessageEvent, { type: "done" }>
    | Extract<AssistantMessageEvent, { type: "error" }>
    | undefined;

  for await (const event of stream) {
    finalEvent = event.type === "done" || event.type === "error" ? event : finalEvent;
    if (event.type === "text_delta") {
      text += event.delta;
    }
  }

  if (finalEvent?.type === "error") {
    throw new Error(
      collectTextContent(finalEvent.error.content) ||
        finalEvent.error.errorMessage ||
        "Planner failed.",
    );
  }
  if (finalEvent?.type === "done" && !text.trim()) {
    text = collectTextContent(finalEvent.message.content);
  }
  if (!text.trim()) {
    throw new Error("Planner returned no text.");
  }
  return text;
}

async function resolvePlannerModel(
  params: BuilderPlannerAgentInput,
): Promise<PlannerModelResolution | null> {
  if (resolvePlannerModelForTest) {
    return resolvePlannerModelForTest(params);
  }

  let agentDir: string;
  let modelRegistry: ReturnType<typeof discoverModels>;
  try {
    agentDir = resolveOpenClawAgentDir();
    await ensureOpenClawModelsJson(params.cfg ?? {}, agentDir);
    const authStorage = discoverAuthStorage(agentDir);
    modelRegistry = discoverModels(authStorage, agentDir);
  } catch {
    return null;
  }

  const configuredRuntimeModel = readOptionalString(params.bundle.runtime.model);
  const agentDefaultModel = readOptionalString(params.cfg?.agents?.defaults?.model);
  const dynamicCandidates: PlannerModelCandidate[] = [
    ...PREFERRED_PLANNER_MODELS,
    ...(configuredRuntimeModel && configuredRuntimeModel !== "user-selected"
      ? [
          {
            provider: configuredRuntimeModel.includes("/")
              ? (configuredRuntimeModel.split("/")[0] ?? "")
              : "",
            model: configuredRuntimeModel.includes("/")
              ? configuredRuntimeModel.slice(configuredRuntimeModel.indexOf("/") + 1)
              : configuredRuntimeModel,
            source: "builder-runtime-model" as const,
          },
        ]
      : []),
    ...(agentDefaultModel && agentDefaultModel !== "user-selected"
      ? [
          {
            provider: agentDefaultModel.includes("/")
              ? (agentDefaultModel.split("/")[0] ?? "")
              : "",
            model: agentDefaultModel.includes("/")
              ? agentDefaultModel.slice(agentDefaultModel.indexOf("/") + 1)
              : agentDefaultModel,
            source: "agent-default-model" as const,
          },
        ]
      : []),
  ];

  for (const candidate of dynamicCandidates) {
    if (!candidate.provider.trim() || !candidate.model.trim()) {
      continue;
    }
    const resolvedModel = resolveModelWithRegistry({
      provider: candidate.provider,
      modelId: candidate.model,
      modelRegistry,
      cfg: params.cfg,
    });
    if (!resolvedModel) {
      continue;
    }
    try {
      const auth = await getApiKeyForModel({
        model: resolvedModel,
        cfg: params.cfg,
        agentDir,
      });
      return {
        provider: candidate.provider,
        model: candidate.model,
        modelRef: `${candidate.provider}/${candidate.model}`,
        source: candidate.source,
        resolvedModel,
        apiKey: requireApiKey(auth, resolvedModel.provider),
      };
    } catch {
      continue;
    }
  }

  return null;
}

function buildFallbackBuildSpec(params: {
  input: BuilderPlannerAgentInput;
  fallbackReason: string;
}): BuildSpec {
  const contract = createPlannerContract("hybrid-deterministic");
  const baseline = buildBaselineBuildSpec({
    input: params.input,
    contract,
    planner: {
      mode: "fallback-deterministic",
      attempts: 0,
      repairCount: 0,
      fallbackReason: params.fallbackReason,
    },
  });
  return {
    ...baseline,
    notes: [...baseline.notes, params.fallbackReason],
  };
}

let plannerModelRunner: (params: PlannerModelRunnerParams) => Promise<string> =
  defaultPlannerModelRunner;
let resolvePlannerModelForTest:
  | ((params: BuilderPlannerAgentInput) => Promise<PlannerModelResolution | null>)
  | null = null;

export async function runBuilderPlannerAgent(
  params: BuilderPlannerAgentInput,
): Promise<BuilderPlannerAgentOutput> {
  const plannerModel = await resolvePlannerModel(params);
  if (!plannerModel) {
    const buildSpec = buildFallbackBuildSpec({
      input: params,
      fallbackReason:
        "No configured high-reasoning planner model was available, so Builder used deterministic planning.",
    });
    return {
      contract: createPlannerContract("hybrid-deterministic"),
      buildSpec,
    };
  }

  const contract = createPlannerContract("model-backed-hybrid");
  const baseline = buildBaselineBuildSpec({
    input: params,
    contract,
    planner: {
      mode: "model-backed",
      attempts: 0,
      repairCount: 0,
      usedModelRef: plannerModel.modelRef,
      usedModelSource: plannerModel.source,
    },
  });

  let previousIssues: BuildSpecValidationIssue[] = [];
  let previousCandidate: unknown;
  for (let attempt = 1; attempt <= PLANNER_REPAIR_ATTEMPTS; attempt += 1) {
    try {
      const completion = await plannerModelRunner({
        model: plannerModel,
        systemPrompt: buildPlannerSystemPrompt(),
        prompt: buildPlannerPrompt({
          input: params,
          baseline,
          ...(previousIssues.length > 0
            ? {
                previousIssues,
                previousCandidate,
              }
            : {}),
        }),
      });
      const json = extractJsonObjectCandidate(completion);
      previousCandidate = JSON.parse(json) as unknown;
      const candidate = canonicalizeCandidateBuildSpec({
        candidate: previousCandidate,
        fallback: baseline,
        contract,
        planner: {
          mode: "model-backed",
          attempts: attempt,
          repairCount: attempt - 1,
          usedModelRef: plannerModel.modelRef,
          usedModelSource: plannerModel.source,
        },
      });
      const issues = [
        ...collectSchemaValidationIssues(candidate),
        ...collectRuntimeValidationIssues({
          buildSpec: candidate,
          input: params,
          requiredWorkspaceFiles: params.bundle.workspace.bootstrapFiles ?? [],
        }),
      ];
      if (issues.length === 0) {
        return {
          contract,
          buildSpec: candidate,
        };
      }
      previousIssues = issues;
    } catch (error) {
      previousIssues = [
        {
          path: "/",
          message: error instanceof Error ? error.message : String(error),
        },
      ];
    }
  }

  const buildSpec = buildFallbackBuildSpec({
    input: params,
    fallbackReason:
      `Planner model ${plannerModel.modelRef} returned an invalid BuildSpec after repair.\n` +
      formatValidationIssues(previousIssues),
  });
  return {
    contract: createPlannerContract("hybrid-deterministic"),
    buildSpec,
  };
}

export const __testing = {
  buildBaselineBuildSpec,
  canonicalizeCandidateBuildSpec,
  collectBuildSpecValidationIssues: (params: {
    buildSpec: BuildSpec;
    input: BuilderPlannerAgentInput;
    requiredWorkspaceFiles: string[];
  }) => [
    ...collectSchemaValidationIssues(params.buildSpec),
    ...collectRuntimeValidationIssues(params),
  ],
  setPlannerModelRunnerForTest(runner?: (params: PlannerModelRunnerParams) => Promise<string>) {
    plannerModelRunner = runner ?? defaultPlannerModelRunner;
  },
  setResolvePlannerModelForTest(
    resolver?: (params: BuilderPlannerAgentInput) => Promise<PlannerModelResolution | null>,
  ) {
    resolvePlannerModelForTest = resolver ?? null;
  },
};
