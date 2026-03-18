export const CAPABILITY_FAMILIES = [
  "ingress",
  "ingest",
  "fetch",
  "read",
  "transform",
  "memory",
  "message",
  "delivery",
  "action",
  "schedule",
  "session",
  "agent",
  "approval",
  "observability",
] as const;

export type CapabilityFamily = (typeof CAPABILITY_FAMILIES)[number];

export const RISK_CLASSES = [
  "read_only",
  "communicative",
  "operator",
  "externally_mutating",
  "config_mutating",
] as const;

export type RiskClass = (typeof RISK_CLASSES)[number];

export const PLANNER_STATUSES = [
  "ready",
  "needs_input",
  "needs_setup",
  "partial",
  "unsupported",
  "unsafe_without_policy",
  "blocked",
] as const;

export type PlannerStatus = (typeof PLANNER_STATUSES)[number];

export const VERIFICATION_PROBE_KINDS = [
  "none",
  "status",
  "read_test",
  "send_test",
  "browser_session",
  "custom",
] as const;

export type VerificationProbeKind = (typeof VERIFICATION_PROBE_KINDS)[number];

export const INTEGRATION_INSTANCE_STATUSES = [
  "discovered",
  "install_required",
  "installed",
  "configured",
  "authenticated",
  "verified",
  "degraded",
  "failed",
] as const;

export type IntegrationInstanceStatus = (typeof INTEGRATION_INSTANCE_STATUSES)[number];

export type VerificationProbe = {
  kind: VerificationProbeKind;
  label: string;
  successDescription: string;
};

export type CapabilityContract = {
  id: string;
  label: string;
  summary: string;
  family: CapabilityFamily;
  semanticVerbs: string[];
  requiredInputs: string[];
  producedOutputs: string[];
  requiresTools: string[];
  requiresToolSections: string[];
  configRequirements: string[];
  authRequirements: string[];
  setupHints: string[];
  risk: RiskClass;
  verification: VerificationProbe[];
  compatibility?: {
    requires?: string[];
    conflicts?: string[];
  };
};

export type ConnectorSourceKind =
  | "core_tool_section"
  | "core_platform"
  | "builtin_channel"
  | "channel_catalog"
  | "external";

export type ConnectorDefinition = {
  id: string;
  label: string;
  kind: "tooling" | "channel" | "integration" | "plugin";
  summary: string;
  contracts: string[];
  riskClasses: RiskClass[];
  source: {
    kind: ConnectorSourceKind;
    id: string;
  };
  install: {
    required: boolean;
    strategy: "none" | "bundled" | "npm" | "local" | "external";
    defaultChoice?: "npm" | "local";
  };
  setup: {
    onboarding: boolean;
    requiresConfig: boolean;
    requiresAuth: boolean;
  };
  verification: {
    supported: boolean;
    probes: VerificationProbe[];
  };
  metadata: {
    docsPath?: string;
    selectionLabel?: string;
    detailLabel?: string;
    systemImage?: string;
    toolSectionId?: string;
    toolIds?: string[];
  };
};

export type IntegrationInstance = {
  connectorId: string;
  instanceId: string;
  status: IntegrationInstanceStatus;
  configRefs: string[];
  authRefs: string[];
  issues: string[];
  lastVerifiedAt?: string;
};

export type CapabilityRegistry = {
  contracts: CapabilityContract[];
  connectors: ConnectorDefinition[];
  contractsById: Map<string, CapabilityContract>;
  connectorsById: Map<string, ConnectorDefinition>;
  connectorsByContractId: Map<string, ConnectorDefinition[]>;
};
