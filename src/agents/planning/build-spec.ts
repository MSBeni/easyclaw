import { Type, type Static } from "@sinclair/typebox";
import { PLANNER_STATUSES } from "../capabilities/schema.js";

const BUILD_SPEC_TOPOLOGY_MODES = ["single-agent", "multi-agent", "swarm"] as const;
const BUILD_SPEC_WORKSPACE_ARTIFACT_STATUSES = ["planned", "suggested", "generated"] as const;
const BUILD_SPEC_SETUP_ACTION_STATUSES = ["completed", "pending"] as const;
const BUILD_SPEC_SETUP_ACTION_KINDS = [
  "install",
  "connect",
  "configure",
  "enable",
  "policy",
  "verify",
  "question",
] as const;
const BUILD_SPEC_SETUP_ACTION_SOURCES = [
  "setup-task",
  "verification",
  "requirement-gap",
  "planner-question",
  "runtime-auth",
] as const;
const BUILD_SPEC_SETUP_ACTION_FIELD_KINDS = [
  "account",
  "destination",
  "sender",
  "filter",
  "session",
  "auth",
  "approval",
  "schedule",
  "model",
  "provider",
  "plugin",
  "generic",
] as const;
const BUILD_SPEC_SETUP_ACTION_FIELD_INPUT_TYPES = ["text", "secret", "select"] as const;
const BUILD_SPEC_SETUP_ACTION_UI_VARIANTS = [
  "guided-setup",
  "inline-question",
  "expert-config",
] as const;
const BUILD_SPEC_SETUP_ACTION_LAUNCHER_TARGETS = ["builder-quick-setup", "config-tab"] as const;
const BUILD_SPEC_SETUP_ACTION_COMPLETION_KINDS = [
  "integration-status",
  "verification",
  "builder-check",
] as const;
const BUILD_SPEC_PLANNER_KINDS = ["hybrid-deterministic", "model-backed-hybrid"] as const;
const BUILD_SPEC_PLANNER_MODES = ["model-backed", "fallback-deterministic"] as const;

function enumString<T extends readonly string[]>(values: T) {
  const enumLike = Object.fromEntries(values.map((value) => [value, value])) as {
    [K in T[number]]: K;
  };
  return Type.Enum(enumLike);
}

const BuildSpecPlannerContractSchema = Type.Object(
  {
    id: Type.String(),
    version: Type.String(),
    kind: enumString(BUILD_SPEC_PLANNER_KINDS),
    deterministicValidationRequired: Type.Boolean(),
    plannerModelPolicy: Type.String(),
  },
  { additionalProperties: false },
);

const BuildSpecPlannerSchema = Type.Object(
  {
    mode: enumString(BUILD_SPEC_PLANNER_MODES),
    attempts: Type.Number(),
    repairCount: Type.Number(),
    usedModelRef: Type.Optional(Type.String()),
    usedModelSource: Type.Optional(Type.String()),
    fallbackReason: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

const BuildSpecGoalSchema = Type.Object(
  {
    primaryGoal: Type.String(),
    executionMode: Type.String(),
    confidence: Type.String(),
  },
  { additionalProperties: false },
);

const BuildSpecTemplateSchema = Type.Object(
  {
    templateId: Type.String(),
    displayName: Type.String(),
    confidence: Type.String(),
    reasons: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);

const BuildSpecScheduleSchema = Type.Object(
  {
    cron: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    timezone: Type.Optional(Type.String()),
    timezoneLabel: Type.Optional(Type.String()),
    assumed: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

const BuildSpecGraphNodeSchema = Type.Object(
  {
    id: Type.String(),
    roleId: Type.String(),
    label: Type.String(),
    entry: Type.Boolean(),
    templateId: Type.Optional(Type.String()),
    goal: Type.Optional(Type.String()),
    contractIds: Type.Array(Type.String()),
    connectorIds: Type.Array(Type.String()),
    upstreamNodeIds: Type.Optional(Type.Array(Type.String())),
    responsibilities: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);

const BuildSpecGraphEdgeSchema = Type.Object(
  {
    id: Type.String(),
    fromNodeId: Type.String(),
    toNodeId: Type.String(),
    kind: Type.String(),
    label: Type.String(),
  },
  { additionalProperties: false },
);

const BuildSpecGraphSchema = Type.Object(
  {
    mode: enumString(BUILD_SPEC_TOPOLOGY_MODES),
    entryNodeId: Type.String(),
    nodes: Type.Array(BuildSpecGraphNodeSchema),
    edges: Type.Array(BuildSpecGraphEdgeSchema),
  },
  { additionalProperties: false },
);

const BuildSpecIntegrationSchema = Type.Object(
  {
    connectorId: Type.String(),
    label: Type.String(),
    status: Type.String(),
    kind: Type.String(),
    sourceKind: Type.String(),
    issues: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);

const BuildSpecSetupActionSchema = Type.Object(
  {
    id: Type.Optional(Type.String()),
    connectorId: Type.String(),
    connectorLabel: Type.Optional(Type.String()),
    title: Type.String(),
    detail: Type.String(),
    status: enumString(BUILD_SPEC_SETUP_ACTION_STATUSES),
    kind: Type.Optional(enumString(BUILD_SPEC_SETUP_ACTION_KINDS)),
    source: Type.Optional(enumString(BUILD_SPEC_SETUP_ACTION_SOURCES)),
    blocking: Type.Optional(Type.Boolean()),
    refs: Type.Array(Type.String()),
    requiredFields: Type.Optional(
      Type.Array(
        Type.Object(
          {
            key: Type.String(),
            label: Type.String(),
            kind: enumString(BUILD_SPEC_SETUP_ACTION_FIELD_KINDS),
            required: Type.Boolean(),
            inputKey: Type.Optional(Type.String()),
            configPath: Type.Optional(Type.String()),
            inputType: Type.Optional(enumString(BUILD_SPEC_SETUP_ACTION_FIELD_INPUT_TYPES)),
            placeholder: Type.Optional(Type.String()),
            help: Type.Optional(Type.String()),
            options: Type.Optional(
              Type.Array(
                Type.Object(
                  {
                    value: Type.String(),
                    label: Type.String(),
                  },
                  { additionalProperties: false },
                ),
              ),
            ),
          },
          { additionalProperties: false },
        ),
      ),
    ),
    workflowRoles: Type.Optional(Type.Array(Type.String())),
    uiSchema: Type.Optional(
      Type.Object(
        {
          variant: enumString(BUILD_SPEC_SETUP_ACTION_UI_VARIANTS),
          section: Type.Optional(Type.String()),
          fieldKeys: Type.Array(Type.String()),
        },
        { additionalProperties: false },
      ),
    ),
    guidedLauncher: Type.Optional(
      Type.Object(
        {
          available: Type.Boolean(),
          target: enumString(BUILD_SPEC_SETUP_ACTION_LAUNCHER_TARGETS),
          connectorId: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
    ),
    fallbackTarget: Type.Optional(
      Type.Object(
        {
          refs: Type.Array(Type.String()),
          label: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
    ),
    completionSignal: Type.Optional(
      Type.Object(
        {
          kind: enumString(BUILD_SPEC_SETUP_ACTION_COMPLETION_KINDS),
          target: Type.String(),
          detail: Type.String(),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

const BuildSpecWorkspaceArtifactSchema = Type.Object(
  {
    fileName: Type.String(),
    purpose: Type.String(),
    status: enumString(BUILD_SPEC_WORKSPACE_ARTIFACT_STATUSES),
    previewSummary: Type.String(),
    managedSection: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

const BuildSpecContextSchema = Type.Object(
  {
    capabilityContractCount: Type.Number(),
    connectorCount: Type.Number(),
    templateExemplarCount: Type.Number(),
    readyIntegrationCount: Type.Number(),
    unresolvedIntegrationCount: Type.Number(),
  },
  { additionalProperties: false },
);

export const BuildSpecSchema = Type.Object(
  {
    version: Type.Literal(1),
    brief: Type.String(),
    status: enumString(PLANNER_STATUSES),
    contract: BuildSpecPlannerContractSchema,
    planner: BuildSpecPlannerSchema,
    context: BuildSpecContextSchema,
    goal: BuildSpecGoalSchema,
    template: BuildSpecTemplateSchema,
    schedule: BuildSpecScheduleSchema,
    graph: BuildSpecGraphSchema,
    integrations: Type.Array(BuildSpecIntegrationSchema),
    setupActions: Type.Array(BuildSpecSetupActionSchema),
    workspaceArtifacts: Type.Array(BuildSpecWorkspaceArtifactSchema),
    assumptions: Type.Array(Type.String()),
    questions: Type.Array(Type.String()),
    notes: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);

export type BuildSpec = Static<typeof BuildSpecSchema>;
