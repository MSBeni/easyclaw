import { createHash } from "node:crypto";
import type { OpenClawConfig } from "../../config/config.js";
import { stableStringify } from "../stable-stringify.js";
import { buildOpenClawCapabilityRegistry } from "./openclaw.js";
import { listConnectorsForContract } from "./registry.js";
import type { RequirementDescriptor, RequirementSet } from "./requirements.js";
import type {
  CapabilityRegistry,
  ConnectorDefinition,
  IntegrationInstance,
  PlannerStatus,
  VerificationProbe,
} from "./schema.js";

export type RequirementPlannerSelectionSource = "explicit" | "preferred" | "fallback";

export type RequirementPlannerSelection = {
  requirementId: string;
  requirementLabel: string;
  contractIds: string[];
  connectorId: string;
  connectorLabel: string;
  source: RequirementPlannerSelectionSource;
};

export type PlannedIntegrationInstance = IntegrationInstance & {
  label: string;
  kind: ConnectorDefinition["kind"];
  sourceKind: ConnectorDefinition["source"]["kind"];
  contracts: string[];
  verification: VerificationProbe[];
};

export type PlannedSetupTaskStatus = "completed" | "pending";

export type PlannedSetupTaskKind = "install" | "connect" | "configure" | "enable" | "policy";

export type PlannedSetupTask = {
  id: string;
  connectorId: string;
  connectorLabel: string;
  kind: PlannedSetupTaskKind;
  status: PlannedSetupTaskStatus;
  title: string;
  detail: string;
  refs: string[];
};

export type PlannedVerificationStatus = "passed" | "failed" | "blocked" | "needs_live_check";

export type PlannedVerificationSource = "preflight" | "persisted" | "live";

export type PlannedVerificationResult = {
  id: string;
  connectorId: string;
  connectorLabel: string;
  probeKind: VerificationProbe["kind"];
  probeLabel: string;
  status: PlannedVerificationStatus;
  detail: string;
  source: PlannedVerificationSource;
  checkedAt?: string;
};

export type RequirementPlannerResult = {
  status: PlannerStatus;
  verificationFingerprint: string;
  selections: RequirementPlannerSelection[];
  integrations: PlannedIntegrationInstance[];
  setupTasks: PlannedSetupTask[];
  verifications: PlannedVerificationResult[];
};

type RequirementPlannerParams = {
  requirements: RequirementSet;
  cfg?: OpenClawConfig;
  registry?: CapabilityRegistry;
};

function dedupeStrings(values: string[]): string[] {
  return values.filter((value, index, all) => all.indexOf(value) === index);
}

function buildVerificationFingerprint(params: {
  status: PlannerStatus;
  selections: RequirementPlannerSelection[];
  integrations: PlannedIntegrationInstance[];
}): string {
  return createHash("sha256")
    .update(
      stableStringify({
        status: params.status,
        selections: params.selections.map((selection) => ({
          requirementId: selection.requirementId,
          contractIds: selection.contractIds,
          connectorId: selection.connectorId,
          source: selection.source,
        })),
        integrations: params.integrations.map((integration) => ({
          connectorId: integration.connectorId,
          instanceId: integration.instanceId,
          status: integration.status,
          configRefs: integration.configRefs,
          authRefs: integration.authRefs,
          contracts: integration.contracts,
          sourceKind: integration.sourceKind,
        })),
      }),
    )
    .digest("hex");
}

function sortSelections(selections: RequirementPlannerSelection[]): RequirementPlannerSelection[] {
  return selections.toSorted((left, right) =>
    `${left.requirementLabel}:${left.connectorLabel}`.localeCompare(
      `${right.requirementLabel}:${right.connectorLabel}`,
    ),
  );
}

function sortSetupTasks(tasks: PlannedSetupTask[]): PlannedSetupTask[] {
  return tasks.toSorted((left, right) =>
    `${left.status}:${left.title}`.localeCompare(`${right.status}:${right.title}`),
  );
}

function sortVerificationResults(
  results: PlannedVerificationResult[],
): PlannedVerificationResult[] {
  return results.toSorted((left, right) =>
    `${left.connectorLabel}:${left.probeLabel}`.localeCompare(
      `${right.connectorLabel}:${right.probeLabel}`,
    ),
  );
}

function listRequirementDescriptors(requirements: RequirementSet): RequirementDescriptor[] {
  return [
    ...requirements.triggers,
    ...requirements.inputs,
    ...requirements.transforms,
    ...requirements.decisions,
    ...requirements.actions,
    ...requirements.outputs,
    ...requirements.policies,
    ...requirements.constraints,
  ];
}

function isChannelConfigured(cfg: OpenClawConfig | undefined, channel: string): boolean {
  const channels = cfg?.channels as Record<string, unknown> | undefined;
  const entry = channels?.[channel];
  return Boolean(entry && typeof entry === "object");
}

function isGmailHookConfigured(cfg: OpenClawConfig | undefined): boolean {
  const gmail = cfg?.hooks?.gmail;
  return Boolean(cfg?.hooks?.token && gmail?.account && gmail?.topic && gmail?.pushToken);
}

function hasExecApprovalsConfigured(cfg: OpenClawConfig | undefined): boolean {
  const exec = cfg?.approvals?.exec;
  return Boolean(exec?.enabled && ((exec.targets?.length ?? 0) > 0 || exec.mode));
}

function statusRank(status: IntegrationInstance["status"]): number {
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

function derivePlannerStatus(params: {
  baseStatus: PlannerStatus;
  integrations: PlannedIntegrationInstance[];
  verifications: PlannedVerificationResult[];
}): PlannerStatus {
  if (params.baseStatus !== "ready") {
    return params.baseStatus;
  }
  if (
    params.verifications.some((result) => result.status === "failed") ||
    params.integrations.some(
      (integration) => integration.status === "degraded" || integration.status === "failed",
    )
  ) {
    return "needs_setup";
  }
  return "ready";
}

function connectorConfigRefs(connector: ConnectorDefinition): string[] {
  if (connector.id.startsWith("channel:")) {
    return [`channels.${connector.source.id}`];
  }
  switch (connector.id) {
    case "platform:core-model":
      return ["models"];
    case "platform:exec-approvals":
      return ["approvals.exec"];
    case "platform:gmail-hook":
      return ["hooks.gmail", "hooks.token"];
    case "platform:webhook-runtime":
      return ["hooks", "hooks.token"];
    case "tools:automation":
      return ["cron.enabled"];
    case "tools:ui":
      return ["browser.enabled"];
    default:
      return [];
  }
}

function connectorAuthRefs(connector: ConnectorDefinition): string[] {
  if (connector.id.startsWith("channel:")) {
    return [`channels.${connector.source.id}`];
  }
  switch (connector.id) {
    case "platform:core-model":
      return ["auth", "models"];
    case "platform:gmail-hook":
      return ["hooks.token", "hooks.gmail.pushToken"];
    case "platform:webhook-runtime":
      return ["hooks.token"];
    default:
      return [];
  }
}

function describeIntegrationInstance(
  connector: ConnectorDefinition,
  cfg?: OpenClawConfig,
): PlannedIntegrationInstance {
  let status: IntegrationInstance["status"] = "discovered";
  const issues: string[] = [];

  if (connector.source.kind === "core_tool_section") {
    status = "installed";
    if (connector.id === "tools:automation" && cfg?.cron?.enabled === false) {
      status = "degraded";
      issues.push("cron is disabled");
    }
    if (connector.id === "tools:ui" && cfg?.browser?.enabled === false) {
      status = "degraded";
      issues.push("browser control is disabled");
    }
  } else if (connector.source.kind === "builtin_channel") {
    status = isChannelConfigured(cfg, connector.source.id) ? "authenticated" : "discovered";
    if (status !== "authenticated") {
      issues.push(`channel ${connector.source.id} is not configured`);
    }
  } else if (connector.source.kind === "channel_catalog") {
    status = isChannelConfigured(cfg, connector.source.id) ? "authenticated" : "install_required";
    if (status !== "authenticated") {
      issues.push(`channel plugin ${connector.source.id} still needs install or setup`);
    }
  } else if (connector.source.kind === "core_platform") {
    switch (connector.id) {
      case "platform:core-model":
        status = "configured";
        break;
      case "platform:exec-approvals":
        status = hasExecApprovalsConfigured(cfg) ? "configured" : "discovered";
        if (status !== "configured") {
          issues.push("exec approval routing is not configured");
        }
        break;
      case "platform:gmail-hook":
        status = isGmailHookConfigured(cfg) ? "authenticated" : "discovered";
        if (status !== "authenticated") {
          issues.push("gmail hook is not configured");
        }
        break;
      case "platform:webhook-runtime":
        status = cfg?.hooks?.token ? "configured" : "discovered";
        if (status !== "configured") {
          issues.push("webhook runtime is missing hooks.token");
        }
        break;
      default:
        status = "installed";
        break;
    }
  }

  return {
    connectorId: connector.id,
    instanceId: connector.id,
    status,
    configRefs: connectorConfigRefs(connector),
    authRefs: connectorAuthRefs(connector),
    issues,
    label: connector.label,
    kind: connector.kind,
    sourceKind: connector.source.kind,
    contracts: connector.contracts,
    verification: connector.verification.probes,
  };
}

function describeConnectorAction(
  connector: ConnectorDefinition,
  integration: PlannedIntegrationInstance,
): Pick<PlannedSetupTask, "kind" | "title" | "detail"> {
  if (integration.status === "install_required") {
    return {
      kind: "install",
      title: `Install ${connector.label}`,
      detail:
        connector.install.strategy === "npm"
          ? `Install the ${connector.label} connector from the plugin catalog.`
          : `Install the ${connector.label} connector before activation.`,
    };
  }

  if (
    connector.id === "platform:exec-approvals" ||
    integration.issues.some((issue) => issue.includes("approval"))
  ) {
    return {
      kind: "policy",
      title:
        integration.status === "configured"
          ? `${connector.label} configured`
          : `Configure ${connector.label}`,
      detail:
        integration.status === "configured"
          ? `${connector.label} is configured for this workflow.`
          : "Configure an approval route before letting this workflow act on the user's behalf.",
    };
  }

  if (integration.status === "degraded" && integration.configRefs.length > 0) {
    return {
      kind: "enable",
      title: `Enable ${connector.label}`,
      detail:
        integration.issues[0] ??
        `Enable or repair ${connector.label} before this workflow can run successfully.`,
    };
  }

  if (connector.setup.requiresAuth) {
    return {
      kind: "connect",
      title:
        integration.status === "authenticated" || integration.status === "verified"
          ? `${connector.label} connected`
          : `Connect ${connector.label}`,
      detail:
        integration.status === "authenticated" || integration.status === "verified"
          ? `${connector.label} is connected and available to this workflow.`
          : (integration.issues[0] ??
            `Connect and authenticate ${connector.label} for this workflow.`),
    };
  }

  return {
    kind: "configure",
    title:
      integration.status === "configured" || integration.status === "installed"
        ? `${connector.label} configured`
        : `Configure ${connector.label}`,
    detail:
      integration.status === "configured" || integration.status === "installed"
        ? `${connector.label} is ready for this workflow.`
        : (integration.issues[0] ?? `Configure ${connector.label} for this workflow.`),
  };
}

function buildSetupTask(
  connector: ConnectorDefinition,
  integration: PlannedIntegrationInstance,
): PlannedSetupTask | null {
  const interesting =
    connector.install.required ||
    connector.setup.requiresConfig ||
    connector.setup.requiresAuth ||
    integration.issues.length > 0 ||
    integration.configRefs.length > 0 ||
    integration.authRefs.length > 0;
  if (!interesting) {
    return null;
  }

  const action = describeConnectorAction(connector, integration);
  const status: PlannedSetupTaskStatus =
    integration.status === "authenticated" ||
    integration.status === "verified" ||
    integration.status === "configured" ||
    integration.status === "installed"
      ? "completed"
      : "pending";

  return {
    id: `${connector.id}:setup`,
    connectorId: connector.id,
    connectorLabel: connector.label,
    kind: action.kind,
    status,
    title: action.title,
    detail: action.detail,
    refs: dedupeStrings([...integration.configRefs, ...integration.authRefs]),
  };
}

function buildVerificationResults(
  integration: PlannedIntegrationInstance,
): PlannedVerificationResult[] {
  return integration.verification.map((probe) => {
    const blocked =
      integration.status === "install_required" ||
      integration.status === "discovered" ||
      integration.status === "degraded" ||
      integration.status === "failed";
    if (probe.kind === "status") {
      return {
        id: `${integration.connectorId}:${probe.kind}`,
        connectorId: integration.connectorId,
        connectorLabel: integration.label,
        probeKind: probe.kind,
        probeLabel: probe.label,
        status: blocked ? "blocked" : "passed",
        detail: blocked
          ? (integration.issues[0] ??
            `${integration.label} is not configured enough for a status check.`)
          : probe.successDescription,
        source: "preflight",
      };
    }

    if (blocked) {
      return {
        id: `${integration.connectorId}:${probe.kind}`,
        connectorId: integration.connectorId,
        connectorLabel: integration.label,
        probeKind: probe.kind,
        probeLabel: probe.label,
        status: "blocked",
        detail:
          integration.issues[0] ??
          `${integration.label} still needs setup before ${probe.label.toLowerCase()} can run.`,
        source: "preflight",
      };
    }

    return {
      id: `${integration.connectorId}:${probe.kind}`,
      connectorId: integration.connectorId,
      connectorLabel: integration.label,
      probeKind: probe.kind,
      probeLabel: probe.label,
      status: "needs_live_check",
      detail: `${integration.label} looks configured, but ${probe.label.toLowerCase()} still needs a live runtime check.`,
      source: "preflight",
    };
  });
}

function buildSetupTasksForIntegrations(params: {
  integrations: PlannedIntegrationInstance[];
  registry: CapabilityRegistry;
}): PlannedSetupTask[] {
  return sortSetupTasks(
    params.integrations
      .map((integration) => {
        const connector = params.registry.connectorsById.get(integration.connectorId);
        return connector ? buildSetupTask(connector, integration) : null;
      })
      .filter((task): task is PlannedSetupTask => Boolean(task)),
  );
}

function buildPreflightVerificationResultsForIntegrations(
  integrations: PlannedIntegrationInstance[],
): PlannedVerificationResult[] {
  return sortVerificationResults(
    integrations.flatMap((integration) => buildVerificationResults(integration)),
  );
}

function choosePreferredConnectorId(
  contractId: string,
  registry: CapabilityRegistry,
  cfg?: OpenClawConfig,
): string[] {
  const connectors = listConnectorsForContract(registry, contractId);
  if (connectors.length === 0) {
    return [];
  }
  const ranked = connectors.toSorted((left, right) => {
    const leftRank = statusRank(describeIntegrationInstance(left, cfg).status);
    const rightRank = statusRank(describeIntegrationInstance(right, cfg).status);
    if (leftRank !== rightRank) {
      return rightRank - leftRank;
    }
    return left.label.localeCompare(right.label);
  });
  return ranked[0] ? [ranked[0].id] : [];
}

function resolveConnectorIdsForDescriptor(
  descriptor: RequirementDescriptor,
  requirements: RequirementSet,
  registry: CapabilityRegistry,
  cfg?: OpenClawConfig,
): {
  connectorIds: string[];
  source: RequirementPlannerSelectionSource;
} {
  const hasBlockingInputGap =
    descriptor.connectorIds.length === 0 &&
    requirements.missingInputs.some((gap) =>
      gap.contractIds.some((contractId) => descriptor.contractIds.includes(contractId)),
    );
  if (hasBlockingInputGap) {
    return {
      connectorIds: [],
      source: "fallback",
    };
  }

  const explicitConnectorIds = descriptor.connectorIds.filter((connectorId) =>
    registry.connectorsById.has(connectorId),
  );
  if (explicitConnectorIds.length > 0) {
    return {
      connectorIds: dedupeStrings(explicitConnectorIds),
      source: "explicit",
    };
  }

  const preferredConnectorIds = dedupeStrings(
    descriptor.contractIds.flatMap((contractId) =>
      choosePreferredConnectorId(contractId, registry, cfg),
    ),
  );
  if (preferredConnectorIds.length > 0) {
    return {
      connectorIds: preferredConnectorIds,
      source: "preferred",
    };
  }

  return {
    connectorIds: dedupeStrings(
      descriptor.contractIds.flatMap((contractId) =>
        listConnectorsForContract(registry, contractId).map((connector) => connector.id),
      ),
    ),
    source: "fallback",
  };
}

export function buildRequirementPlannerResult(
  params: RequirementPlannerParams,
): RequirementPlannerResult {
  const registry = params.registry ?? buildOpenClawCapabilityRegistry();
  const selections: RequirementPlannerSelection[] = [];
  const selectedConnectorIds: string[] = [];

  for (const descriptor of listRequirementDescriptors(params.requirements)) {
    if (descriptor.contractIds.length === 0) {
      continue;
    }
    const resolution = resolveConnectorIdsForDescriptor(
      descriptor,
      params.requirements,
      registry,
      params.cfg,
    );
    for (const connectorId of resolution.connectorIds) {
      const connector = registry.connectorsById.get(connectorId);
      if (!connector) {
        continue;
      }
      selections.push({
        requirementId: descriptor.id,
        requirementLabel: descriptor.label,
        contractIds: descriptor.contractIds,
        connectorId,
        connectorLabel: connector.label,
        source: resolution.source,
      });
      selectedConnectorIds.push(connectorId);
    }
  }

  const integrations = dedupeStrings(selectedConnectorIds)
    .map((connectorId) => registry.connectorsById.get(connectorId))
    .filter((connector): connector is ConnectorDefinition => Boolean(connector))
    .map((connector) => describeIntegrationInstance(connector, params.cfg))
    .toSorted((left, right) => left.label.localeCompare(right.label));
  return rebuildRequirementPlannerResult({
    status: params.requirements.plannerStatus,
    selections,
    integrations,
    registry,
  });
}

export function rebuildRequirementPlannerResult(params: {
  status: PlannerStatus;
  selections: RequirementPlannerSelection[];
  integrations: PlannedIntegrationInstance[];
  verifications?: PlannedVerificationResult[];
  registry?: CapabilityRegistry;
  verificationFingerprint?: string;
}): RequirementPlannerResult {
  const registry = params.registry ?? buildOpenClawCapabilityRegistry();
  const selections = sortSelections(params.selections);
  const integrations = params.integrations.toSorted((left, right) =>
    left.label.localeCompare(right.label),
  );
  const setupTasks = buildSetupTasksForIntegrations({
    integrations,
    registry,
  });
  const verifications = params.verifications
    ? sortVerificationResults(params.verifications)
    : buildPreflightVerificationResultsForIntegrations(integrations);
  const status = derivePlannerStatus({
    baseStatus: params.status,
    integrations,
    verifications,
  });

  return {
    status,
    verificationFingerprint:
      params.verificationFingerprint ??
      buildVerificationFingerprint({
        status,
        selections,
        integrations,
      }),
    selections,
    integrations,
    setupTasks,
    verifications,
  };
}
