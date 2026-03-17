import { Type, type Static } from "@sinclair/typebox";

export const BLUEPRINT_TOOL_PROFILES = ["minimal", "messaging", "coding", "full"] as const;
export const BLUEPRINT_INTERACTION_MODES = [
  "direct",
  "scheduled",
  "bound-channel",
  "hybrid",
] as const;
export const BLUEPRINT_SOURCE_KINDS = ["session", "binding", "channel"] as const;
export const BLUEPRINT_DELIVERY_MODES = ["reply", "announce", "digest", "report"] as const;
export const BLUEPRINT_DELIVERY_FORMATS = ["chat", "brief", "report"] as const;
export const BLUEPRINT_MEMORY_MODES = ["personal", "shared", "minimal"] as const;
export const BLUEPRINT_THINKING_LEVELS = ["low", "medium", "high"] as const;
export const BLUEPRINT_SUBAGENT_MODES = ["inherit", "require"] as const;
export const BLUEPRINT_EXTERNAL_ACTION_POLICIES = ["ask-first", "limited-auto", "allowed"] as const;
export const BLUEPRINT_CONFIG_WRITE_POLICIES = [
  "never",
  "approval-required",
  "owner-only",
] as const;
export const BLUEPRINT_RESPONSE_SCOPES = ["broad", "narrow"] as const;

function enumString<T extends readonly string[]>(values: T) {
  const enumLike = Object.fromEntries(values.map((value) => [value, value])) as {
    [K in T[number]]: K;
  };
  return Type.Enum(enumLike);
}

function optionalEnumString<T extends readonly string[]>(values: T) {
  return Type.Optional(enumString(values));
}

const BlueprintIdentitySchema = Type.Object(
  {
    vibe: Type.Optional(Type.String()),
    emoji: Type.Optional(Type.String()),
    avatar: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

const BlueprintManifestSchema = Type.Object(
  {
    templateId: Type.String(),
    displayName: Type.String(),
    version: Type.String(),
    summary: Type.String(),
    tags: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

const BlueprintAgentSchema = Type.Object(
  {
    agentId: Type.String(),
    name: Type.String(),
    identity: Type.Optional(BlueprintIdentitySchema),
  },
  { additionalProperties: false },
);

const BlueprintWorkspaceSchema = Type.Object(
  {
    template: Type.Optional(Type.String()),
    bootstrapFiles: Type.Optional(Type.Array(Type.String())),
    memoryMode: optionalEnumString(BLUEPRINT_MEMORY_MODES),
    heartbeatInstructions: Type.Optional(Type.String()),
    notes: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

const BlueprintProviderToolOverrideSchema = Type.Object(
  {
    profile: optionalEnumString(BLUEPRINT_TOOL_PROFILES),
    alsoAllow: Type.Optional(Type.Array(Type.String())),
    deny: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

const BlueprintRuntimeSchema = Type.Object(
  {
    model: Type.Optional(Type.String()),
    thinking: optionalEnumString(BLUEPRINT_THINKING_LEVELS),
    skills: Type.Optional(Type.Array(Type.String())),
    tools: Type.Object(
      {
        profile: enumString(BLUEPRINT_TOOL_PROFILES),
        alsoAllow: Type.Optional(Type.Array(Type.String())),
        byProvider: Type.Optional(Type.Record(Type.String(), BlueprintProviderToolOverrideSchema)),
      },
      { additionalProperties: false },
    ),
    subagents: Type.Optional(
      Type.Object(
        {
          enabled: Type.Boolean(),
          mode: optionalEnumString(BLUEPRINT_SUBAGENT_MODES),
        },
        { additionalProperties: false },
      ),
    ),
    sandbox: Type.Optional(
      Type.Object(
        {
          enabled: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

const BlueprintBindingSchema = Type.Object(
  {
    channel: Type.String(),
    accountId: Type.Optional(Type.String()),
    peer: Type.Optional(Type.String()),
    thread: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

const BlueprintSourceSchema = Type.Object(
  {
    kind: enumString(BLUEPRINT_SOURCE_KINDS),
    value: Type.String(),
  },
  { additionalProperties: false },
);

const BlueprintIngressSchema = Type.Object(
  {
    interactionMode: enumString(BLUEPRINT_INTERACTION_MODES),
    bindings: Type.Optional(Type.Array(BlueprintBindingSchema)),
    sources: Type.Optional(Type.Array(BlueprintSourceSchema)),
  },
  { additionalProperties: false },
);

const BlueprintScheduleSchema = Type.Object(
  {
    name: Type.String(),
    schedule: Type.String(),
    purpose: Type.String(),
  },
  { additionalProperties: false },
);

const BlueprintAutomationSchema = Type.Object(
  {
    schedules: Type.Optional(Type.Array(BlueprintScheduleSchema)),
  },
  { additionalProperties: false },
);

const BlueprintDeliverySchema = Type.Object(
  {
    mode: optionalEnumString(BLUEPRINT_DELIVERY_MODES),
    target: Type.Optional(
      Type.Object(
        {
          channel: Type.Optional(Type.String()),
          to: Type.Optional(Type.String()),
          session: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
    ),
    format: optionalEnumString(BLUEPRINT_DELIVERY_FORMATS),
  },
  { additionalProperties: false },
);

const BlueprintSafetySchema = Type.Object(
  {
    externalActionPolicy: optionalEnumString(BLUEPRINT_EXTERNAL_ACTION_POLICIES),
    configWritePolicy: optionalEnumString(BLUEPRINT_CONFIG_WRITE_POLICIES),
    responseScope: optionalEnumString(BLUEPRINT_RESPONSE_SCOPES),
    escalationRules: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

const BlueprintValidationSchema = Type.Object(
  {
    prerequisites: Type.Optional(Type.Array(Type.String())),
    readinessChecks: Type.Optional(Type.Array(Type.String())),
    smokePrompts: Type.Optional(Type.Array(Type.String())),
    successCriteria: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

export const AgentBlueprintBundleSchema = Type.Object(
  {
    manifest: BlueprintManifestSchema,
    agent: BlueprintAgentSchema,
    workspace: BlueprintWorkspaceSchema,
    runtime: BlueprintRuntimeSchema,
    ingress: Type.Optional(BlueprintIngressSchema),
    automation: Type.Optional(BlueprintAutomationSchema),
    delivery: Type.Optional(BlueprintDeliverySchema),
    safety: Type.Optional(BlueprintSafetySchema),
    validation: Type.Optional(BlueprintValidationSchema),
  },
  { additionalProperties: false },
);

export type AgentBlueprintBundle = Static<typeof AgentBlueprintBundleSchema>;
