import { buildAgentMainSessionKey } from "../../../../src/routing/session-key.js";
import type { GatewayBrowserClient } from "../gateway.ts";
import { clearBuilderSetupSession, saveBuilderSetupSession } from "../storage.ts";
import { loadAgents, type AgentsState } from "./agents.ts";
import { loadConfig, type ConfigState } from "./config.ts";
import { loadCronStatus, reloadCronJobs, type CronState } from "./cron.ts";

export type BuilderDraftSummary = {
  brief: string;
  templateId: string;
  displayName: string;
  confidence: "low" | "medium" | "high";
  plannerStatus:
    | "ready"
    | "needs_input"
    | "needs_setup"
    | "partial"
    | "unsupported"
    | "unsafe_without_policy"
    | "blocked";
  reasons: string[];
  assumptions: string[];
  questions: Array<{
    id: string;
    prompt: string;
    required: boolean;
  }>;
  ready: boolean;
  buildSpec: {
    version: number;
    status: string;
    contract: {
      id: string;
      version: string;
      kind: string;
      deterministicValidationRequired: boolean;
      plannerModelPolicy: string;
    };
    planner: {
      mode: "model-backed" | "fallback-deterministic";
      attempts: number;
      repairCount: number;
      usedModelRef?: string;
      usedModelSource?: string;
      fallbackReason?: string;
    };
    context: {
      capabilityContractCount: number;
      connectorCount: number;
      templateExemplarCount: number;
      readyIntegrationCount: number;
      unresolvedIntegrationCount: number;
    };
    goal: {
      primaryGoal: string;
      executionMode: string;
      confidence: string;
    };
    template: {
      templateId: string;
      displayName: string;
      confidence: string;
      reasons: string[];
    };
    schedule: {
      cron?: string;
      description?: string;
      timezone?: string;
      timezoneLabel?: string;
      assumed?: boolean;
    };
    graph: {
      mode: "single-agent" | "multi-agent" | "swarm";
      entryNodeId: string;
      nodes: Array<{
        id: string;
        roleId: string;
        label: string;
        entry: boolean;
        templateId?: string;
        goal?: string;
        contractIds: string[];
        connectorIds: string[];
        upstreamNodeIds?: string[];
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
    integrations: Array<{
      connectorId: string;
      label: string;
      status: string;
      kind: string;
      sourceKind: string;
      issues: string[];
    }>;
    policy?: {
      highestRisk:
        | "read_only"
        | "communicative"
        | "operator"
        | "externally_mutating"
        | "config_mutating";
      riskTiers: Array<
        "read_only" | "communicative" | "operator" | "externally_mutating" | "config_mutating"
      >;
      summary: string;
      riskyContractIds: string[];
      riskyConnectorIds: string[];
      approval: {
        required: boolean;
        routeStatus: "not_required" | "configured" | "missing";
        posture:
          | "always_auto"
          | "ask_once"
          | "ask_every_time"
          | "draft_only"
          | "never"
          | "unresolved";
        postureSource: "brief" | "builder" | "defaulted" | "missing";
        recommendedPosture: "always_auto" | "ask_once" | "ask_every_time" | "draft_only" | "never";
        unresolved: boolean;
        blockers: string[];
      };
    };
    setupActions: Array<{
      id?: string;
      connectorId: string;
      connectorLabel?: string;
      title: string;
      detail: string;
      status: "completed" | "pending";
      kind?: "install" | "connect" | "configure" | "enable" | "policy" | "verify" | "question";
      source?:
        | "setup-task"
        | "verification"
        | "requirement-gap"
        | "planner-question"
        | "runtime-auth";
      blocking?: boolean;
      refs: string[];
      requiredFields?: Array<{
        key: string;
        label: string;
        kind:
          | "account"
          | "destination"
          | "sender"
          | "filter"
          | "session"
          | "auth"
          | "approval"
          | "schedule"
          | "model"
          | "provider"
          | "plugin"
          | "generic";
        required: boolean;
        inputKey?: string;
        configPath?: string;
        inputType?: "text" | "secret" | "select";
        placeholder?: string;
        help?: string;
        options?: Array<{
          value: string;
          label: string;
        }>;
      }>;
      workflowRoles?: string[];
      uiSchema?: {
        variant: "guided-setup" | "inline-question" | "expert-config";
        section?: string;
        fieldKeys: string[];
      };
      guidedLauncher?: {
        available: boolean;
        target: "builder-quick-setup" | "config-tab";
        connectorId?: string;
      };
      fallbackTarget?: {
        refs: string[];
        label?: string;
      };
      completionSignal?: {
        kind: "integration-status" | "verification" | "builder-check";
        target: string;
        detail: string;
      };
    }>;
    workspaceArtifacts: Array<{
      fileName: string;
      purpose: string;
      status: "planned" | "suggested" | "generated";
      previewSummary: string;
      managedSection?: string;
    }>;
    assumptions: string[];
    questions: string[];
    notes: string[];
  };
  requirements: {
    confidence: "low" | "medium" | "high";
    workflow: {
      primaryGoal: "assistant" | "briefing" | "operator" | "research" | "support";
      executionMode: "bound-channel" | "direct" | "hybrid" | "scheduled" | "webhook";
      triggerKinds: string[];
      sourceKinds: string[];
      transformKinds: string[];
      actionKinds: string[];
      deliveryKinds: string[];
      requiresApproval: boolean;
    };
    intentTags: string[];
    triggers: Array<{ detail: string }>;
    inputs: Array<{ detail: string }>;
    transforms: Array<{ detail: string }>;
    decisions: Array<{ detail: string }>;
    actions: Array<{ detail: string }>;
    outputs: Array<{ detail: string }>;
    policies: Array<{ detail: string }>;
    constraints: Array<{ detail: string }>;
    missingInputs: Array<{ code: string; message: string }>;
    setupGaps: Array<{ code: string; message: string }>;
    policyGaps: Array<{ code: string; message: string }>;
    unsupportedGaps: Array<{ code: string; message: string }>;
    ambiguities: string[];
    unsupportedRequests: string[];
    unsupportedClassifications: Array<{
      code: string;
      kind: "action" | "capability" | "connector" | "delivery" | "policy";
      label: string;
      detail: string;
    }>;
    missingDataFields: string[];
  };
  planning: {
    selections: Array<{
      requirementId: string;
      requirementLabel: string;
      contractIds: string[];
      connectorId: string;
      connectorLabel: string;
      source: "explicit" | "preferred" | "fallback";
    }>;
    alternatives: Array<{
      requirementId: string;
      requirementLabel: string;
      contractIds: string[];
      selectedConnectorIds: string[];
      candidates: Array<{
        connectorId: string;
        connectorLabel: string;
        source: "explicit" | "preferred" | "fallback";
        selected: boolean;
        readiness:
          | "discovered"
          | "install_required"
          | "installed"
          | "configured"
          | "authenticated"
          | "verified"
          | "degraded"
          | "failed";
        reason: string;
      }>;
    }>;
    variants: Array<{
      id: string;
      label: string;
      reason: string;
      selected: boolean;
      status:
        | "ready"
        | "needs_input"
        | "needs_setup"
        | "partial"
        | "unsupported"
        | "unsafe_without_policy"
        | "blocked";
      score: number;
      selections: Array<{
        requirementId: string;
        requirementLabel: string;
        contractIds: string[];
        connectorId: string;
        connectorLabel: string;
        source: "explicit" | "preferred" | "fallback";
      }>;
      connectorIds: string[];
      topology: {
        mode: "single-agent" | "multi-agent";
        reason: string;
        roles: Array<{
          id: string;
          label: string;
          contractIds: string[];
          connectorIds: string[];
          responsibilities: string[];
        }>;
      };
    }>;
    integrations: Array<{
      connectorId: string;
      instanceId: string;
      status:
        | "discovered"
        | "install_required"
        | "installed"
        | "configured"
        | "authenticated"
        | "verified"
        | "degraded"
        | "failed";
      configRefs: string[];
      authRefs: string[];
      issues: string[];
      lastVerifiedAt?: string;
      label: string;
      kind: string;
      sourceKind: string;
      contracts: string[];
      verification: Array<{ kind: string; label: string; successDescription: string }>;
      docsPath?: string;
      selectionLabel?: string;
      detailLabel?: string;
      onboarding: boolean;
      requiresConfig: boolean;
      requiresAuth: boolean;
      installRequired: boolean;
      installStrategy: "none" | "bundled" | "npm" | "local" | "external";
    }>;
    setupTasks: Array<{
      id: string;
      connectorId: string;
      connectorLabel: string;
      kind: "install" | "connect" | "configure" | "enable" | "policy";
      status: "completed" | "pending";
      title: string;
      detail: string;
      refs: string[];
    }>;
    verifications: Array<{
      id: string;
      connectorId: string;
      connectorLabel: string;
      probeKind: string;
      probeLabel: string;
      status: "passed" | "failed" | "blocked" | "needs_live_check";
      detail: string;
      source: "preflight" | "persisted" | "live";
      checkedAt?: string;
    }>;
    topology: {
      mode: "single-agent" | "multi-agent";
      reason: string;
      roles: Array<{
        id: string;
        label: string;
        contractIds: string[];
        connectorIds: string[];
        responsibilities: string[];
      }>;
    };
    graph: {
      mode: "single-agent" | "multi-agent" | "swarm";
      entryNodeId: string;
      nodes: Array<{
        id: string;
        roleId: string;
        label: string;
        templateId: string;
        entry: boolean;
        agentId: string;
        name: string;
        interactionMode: string;
        connectorIds: string[];
        responsibilities: string[];
        deliveryTarget: string | null;
        schedule: string | null;
      }>;
      edges: Array<{
        id: string;
        fromNodeId: string;
        toNodeId: string;
        kind: string;
        label: string;
      }>;
    };
  };
  extracted: {
    agentId: string;
    name: string;
    ingressChannels: string[];
    sourceChannels: string[];
    deliveryTarget: string | null;
    schedule: string | null;
  };
};

export type BuilderPlanResult = {
  draft: BuilderDraftSummary;
  workspacePreviews: Array<{
    nodeId: string;
    roleId: string;
    entry: boolean;
    files: Array<{
      name: string;
      content: string;
    }>;
  }>;
  plan: Record<string, unknown>;
  graphPlans: Array<{
    nodeId: string;
    roleId: string;
    entry: boolean;
    templateId: string;
    plan: Record<string, unknown>;
  }>;
};

export type BuilderApplyResult = {
  draft: BuilderDraftSummary;
  result: {
    status: "applied";
    agent: { agentId: string; name: string; workspaceDir: string; agentDir: string };
    workspace: { metadataPath: string; files: Array<{ name: string; status: string }> };
    bindings: {
      added: string[];
      removed: string[];
      updated: string[];
      skipped: string[];
      conflicts: string[];
      ignored: string[];
    };
    automation: { jobs: Array<{ name: string; id: string; status: string }> };
    warnings: Array<{ code: string; message: string }>;
  };
  graphResults: Array<{
    nodeId: string;
    roleId: string;
    entry: boolean;
    result: BuilderApplyResult["result"];
  }>;
};

export type BuilderVerifyResult = {
  draft: BuilderDraftSummary;
  workspacePreviews: BuilderPlanResult["workspacePreviews"];
  plan: Record<string, unknown>;
  graphPlans: BuilderPlanResult["graphPlans"];
  verification: {
    fingerprint: string;
    checkedAt: string;
    passedCount: number;
    failedCount: number;
    blockedCount: number;
    unresolvedCount: number;
    results: BuilderDraftSummary["planning"]["verifications"];
  };
};

export type BuilderSetupRunResult = {
  actionId?: string;
  connectorId: string;
  status: "configured" | "needs_auth" | "needs_credentials" | "needs_setup" | "started";
  message: string;
  updatedRefs: string[];
  summary?: {
    projectId?: string;
    topic?: string;
    subscription?: string;
    pushEndpoint?: string;
    hookUrl?: string;
    command?: string;
    serve?: {
      bind: string;
      port: number;
      path: string;
    };
  };
  authSteps?: Array<{
    id: string;
    actionId?: string;
    label: string;
    detail: string;
    command: string;
    connectorId: string;
    inputs: Record<string, string>;
  }>;
  credentialImport?: {
    actionId?: string;
    connectorId: string;
    label: string;
    detail: string;
    consoleUrl: string;
    autoDetect?: {
      actionId?: string;
      connectorId: string;
      label: string;
      detail: string;
    };
  };
  resume?: {
    actionId?: string;
    connectorId: string;
    label: string;
    detail: string;
    inputs: Record<string, string>;
  };
};

export type BuilderState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  setTab?: (tab: import("../navigation.ts").Tab) => void;
  applySettings?: (settings: Record<string, unknown>) => void;
  settings?: Record<string, unknown>;
  sessionKey?: string;
  loadAssistantIdentity?: () => Promise<void> | void;
  builderBrief: string;
  builderApprovalPosture:
    | ""
    | "always_auto"
    | "ask_once"
    | "ask_every_time"
    | "draft_only"
    | "never";
  builderTemplateId: string;
  builderModelId: string;
  builderAgentName: string;
  builderWorkspaceDocEdits: Record<string, string>;
  builderSetupInputs: Record<string, string>;
  builderSetupRunningConnectorId: string | null;
  builderSetupError: string | null;
  builderSetupResult: BuilderSetupRunResult | null;
  builderPlan: BuilderPlanResult | null;
  builderPlanLoading: boolean;
  builderPlanError: string | null;
  builderApplyResult: BuilderApplyResult | null;
  builderApplying: boolean;
  builderApplyError: string | null;
  builderConfirmApply: boolean;
  builderVerifyResult: BuilderVerifyResult | null;
  builderVerifying: boolean;
  builderVerifyError: string | null;
};

type BuilderApplyState = BuilderState & AgentsState & CronState;
type BuilderSetupState = BuilderState & ConfigState;

function formatBuilderSetupError(error: unknown): string {
  const raw = String(error instanceof Error ? error.message : error).trim();
  const withoutGatewayPrefix = raw.startsWith("GatewayRequestError: ")
    ? raw.slice("GatewayRequestError: ".length).trim()
    : raw;
  if (withoutGatewayPrefix.length <= 1200) {
    return withoutGatewayPrefix;
  }
  return `${withoutGatewayPrefix.slice(0, 1200).trimEnd()}…`;
}

function buildGmailLoginCommand(account: string): string {
  return `gog login ${account} --client openclaw-gmail-hook --services gmail --gmail-scope full --force-consent`;
}

function buildGmailCredentialConsoleUrl(project: string | undefined): string {
  const trimmed = project?.trim();
  if (!trimmed) {
    return "https://console.cloud.google.com/apis/credentials";
  }
  return `https://console.cloud.google.com/apis/credentials?project=${encodeURIComponent(trimmed)}`;
}

function buildGmailSetupResume(inputs: Record<string, string>): BuilderSetupRunResult["resume"] {
  return {
    actionId: "platform:gmail-hook",
    connectorId: "platform:gmail-hook",
    label: "Retry Gmail setup",
    detail: "Run Gmail auto-setup again after the setup steps are complete.",
    inputs: {
      account: inputs.account ?? "",
      project: inputs.project ?? "",
      topic: inputs.topic ?? "",
      subscription: inputs.subscription ?? "",
      pushEndpoint: inputs.pushEndpoint ?? "",
    },
  };
}

function deriveBuilderSetupConnectorId(actionId: string | undefined, connectorId?: string): string {
  const normalizedConnectorId = connectorId?.trim() ?? "";
  if (normalizedConnectorId && normalizedConnectorId.split(":").filter(Boolean).length <= 2) {
    return normalizedConnectorId;
  }
  const normalizedActionId = actionId?.trim() ?? "";
  if (!normalizedActionId) {
    return "";
  }
  const segments = normalizedActionId.split(":").filter(Boolean);
  if (segments.length >= 2) {
    return `${segments[0]}:${segments[1]}`;
  }
  return normalizedActionId;
}

function normalizeBuilderSetupActionRef(params: { actionId?: string; connectorId?: string }): {
  actionId: string;
  connectorId: string;
} {
  const actionId = params.actionId?.trim() || params.connectorId?.trim() || "";
  const connectorId = deriveBuilderSetupConnectorId(actionId, params.connectorId);
  return {
    actionId,
    connectorId,
  };
}

function normalizeBuilderSetupResult(
  result: BuilderSetupRunResult,
  params: { actionId: string; connectorId: string },
): BuilderSetupRunResult {
  const normalizeNestedRef = (value: { actionId?: string; connectorId: string }) => {
    const actionRef = normalizeBuilderSetupActionRef({
      actionId: value.actionId ?? value.connectorId,
      connectorId: value.connectorId,
    });
    return {
      ...value,
      actionId: actionRef.actionId,
      connectorId: actionRef.connectorId,
    };
  };

  return {
    ...result,
    actionId: result.actionId?.trim() || params.actionId,
    connectorId: deriveBuilderSetupConnectorId(
      result.actionId,
      result.connectorId || params.connectorId,
    ),
    authSteps: result.authSteps?.map((step) => normalizeNestedRef(step)),
    credentialImport: result.credentialImport
      ? {
          ...normalizeNestedRef(result.credentialImport),
          autoDetect: result.credentialImport.autoDetect
            ? normalizeNestedRef(result.credentialImport.autoDetect)
            : undefined,
        }
      : undefined,
    resume: result.resume ? normalizeNestedRef(result.resume) : undefined,
  };
}

function persistBuilderSetupSessionState(state: {
  builderSetupInputs: Record<string, string>;
  builderSetupResult: BuilderSetupRunResult | null;
  builderSetupFocus?: unknown;
}) {
  const focus = state.builderSetupFocus;
  saveBuilderSetupSession({
    focus:
      focus && typeof focus === "object" && !Array.isArray(focus)
        ? (focus as Record<string, unknown>)
        : null,
    inputs: state.builderSetupInputs,
    result: state.builderSetupResult,
  });
}

function clearBuilderSetupState(
  state: BuilderState & {
    builderSetupFocus?: unknown;
  },
) {
  state.builderSetupInputs = {};
  state.builderSetupError = null;
  state.builderSetupResult = null;
  state.builderSetupRunningConnectorId = null;
  if ("builderSetupFocus" in state) {
    state.builderSetupFocus = null;
  }
  clearBuilderSetupSession();
}

function builderSetupFocusMatchesPlan(
  focus: unknown,
  plan: BuilderPlanResult | Pick<BuilderVerifyResult, "draft"> | null | undefined,
): boolean {
  if (!focus || typeof focus !== "object" || Array.isArray(focus) || !plan) {
    return false;
  }
  const focusRecord = focus as {
    actionId?: unknown;
    connectorId?: unknown;
  };
  const connectorId =
    typeof focusRecord.connectorId === "string" ? focusRecord.connectorId.trim() : "";
  const actionId = typeof focusRecord.actionId === "string" ? focusRecord.actionId.trim() : "";
  if (!connectorId) {
    return false;
  }
  const draft = plan.draft;
  if (
    draft.buildSpec.setupActions.some((action) => {
      const actionRef = action.id?.trim() ?? action.connectorId.trim();
      return actionRef === actionId || action.connectorId.trim() === connectorId;
    })
  ) {
    return true;
  }
  return draft.planning.integrations.some((integration) => integration.connectorId.trim() === connectorId);
}

function reconcileBuilderSetupFocus(
  state: BuilderState & {
    builderSetupFocus?: unknown;
  },
  plan: BuilderPlanResult | Pick<BuilderVerifyResult, "draft"> | null | undefined,
) {
  if (!state.builderSetupFocus) {
    return;
  }
  if (builderSetupFocusMatchesPlan(state.builderSetupFocus, plan)) {
    persistBuilderSetupSessionState(state);
    return;
  }
  clearBuilderSetupState(state);
}

function findPendingSetupAction(
  state: BuilderState,
  params: { actionId: string; connectorId: string },
) {
  const actions = state.builderVerifyResult?.draft.buildSpec.setupActions ?? [];
  return (
    actions.find((action) => {
      const actionRef = action.id?.trim() ?? action.connectorId.trim();
      return (
        action.status !== "completed" &&
        (actionRef === params.actionId || action.connectorId.trim() === params.connectorId)
      );
    }) ?? null
  );
}

function buildWorkspaceDocEditsPayload(state: BuilderState): Array<{
  nodeId: string;
  fileName: string;
  content: string;
}> {
  return Object.entries(state.builderWorkspaceDocEdits)
    .map(([key, content]) => {
      const separatorIndex = key.indexOf(":");
      if (separatorIndex <= 0) {
        return null;
      }
      const nodeId = key.slice(0, separatorIndex).trim();
      const fileName = key.slice(separatorIndex + 1).trim();
      const trimmedContent = content.trim();
      if (!nodeId || !fileName || !trimmedContent) {
        return null;
      }
      return {
        nodeId,
        fileName,
        content,
      };
    })
    .filter(
      (
        entry,
      ): entry is {
        nodeId: string;
        fileName: string;
        content: string;
      } => Boolean(entry),
    );
}

export function updateBuilderWorkspaceDocEdit(
  state: BuilderState,
  params: {
    nodeId: string;
    fileName: string;
    content: string;
  },
) {
  const key = `${params.nodeId}:${params.fileName}`;
  state.builderWorkspaceDocEdits = {
    ...state.builderWorkspaceDocEdits,
    [key]: params.content,
  };
}

export function resetBuilderWorkspaceDocEdit(
  state: BuilderState,
  params: {
    nodeId: string;
    fileName: string;
  },
) {
  const key = `${params.nodeId}:${params.fileName}`;
  const { [key]: _ignored, ...rest } = state.builderWorkspaceDocEdits;
  state.builderWorkspaceDocEdits = rest;
}

function buildGmailSetupFallback(
  inputs: Record<string, string>,
  formattedError: string,
): BuilderSetupRunResult | null {
  const lower = formattedError.toLowerCase();
  const account = inputs.account?.trim() ?? "";
  const project = inputs.project?.trim() ?? "";
  const needsScopes =
    lower.includes("insufficientpermissions") ||
    lower.includes("insufficient authentication scopes") ||
    lower.includes("access_token_scope_insufficient");
  const needsCredentials = lower.includes("gog oauth client credentials missing");
  const needsGcloud = lower.includes("gcloud login required");
  const needsGogLogin =
    lower.includes("gog login required") || lower.includes("gog is signed in as");

  if (needsScopes) {
    return {
      connectorId: "platform:gmail-hook",
      status: "needs_auth",
      message:
        "Gmail setup reached the Gmail API, but the current gog token is missing Gmail scopes. Re-consent with Gmail access, then retry.",
      updatedRefs: [],
      authSteps: account
        ? [
            {
              id: "gog-auth",
              label: "Grant Gmail access in gog",
              detail:
                "Re-consent in gog with Gmail access so EasyClaw can create the Gmail watch subscription.",
              command: buildGmailLoginCommand(account),
              connectorId: "platform:gmail-hook:gog-auth",
              inputs: { account },
            },
          ]
        : [],
      resume: buildGmailSetupResume(inputs),
    };
  }

  if (needsCredentials) {
    return {
      connectorId: "platform:gmail-hook",
      status: "needs_credentials",
      message:
        "Gmail setup needs a Google OAuth client JSON before gog can sign in to this mailbox.",
      updatedRefs: [],
      credentialImport: {
        connectorId: "platform:gmail-hook:gog-credentials",
        label: "Import OAuth client JSON",
        detail:
          "Upload the Desktop app OAuth client JSON downloaded from Google Cloud so EasyClaw can import it into gog.",
        consoleUrl: buildGmailCredentialConsoleUrl(project),
        autoDetect: {
          connectorId: "platform:gmail-hook:gog-credentials-auto",
          label: "Import from Downloads and continue",
          detail:
            "If the Desktop app OAuth client JSON was downloaded to Downloads, EasyClaw can import it and continue into gog login automatically.",
        },
      },
      resume: buildGmailSetupResume(inputs),
    };
  }

  if (!needsGcloud && !needsGogLogin) {
    return null;
  }

  const authSteps: NonNullable<BuilderSetupRunResult["authSteps"]> = [];
  if (needsGcloud) {
    authSteps.push({
      id: "gcloud-auth",
      label: "Sign in to Google Cloud",
      detail: "Log in to the Google Cloud CLI so EasyClaw can enable APIs and manage Pub/Sub.",
      command: "gcloud auth login",
      connectorId: "platform:gmail-hook:gcloud-auth",
      inputs: {},
    });
  }
  if (needsGogLogin && account) {
    authSteps.push({
      id: "gog-auth",
      label: "Sign in to gog",
      detail:
        "Authorize the Gmail helper with your mailbox so EasyClaw can create the Gmail watch subscription.",
      command: buildGmailLoginCommand(account),
      connectorId: "platform:gmail-hook:gog-auth",
      inputs: { account },
    });
  }

  if (authSteps.length === 0) {
    return null;
  }

  return {
    connectorId: "platform:gmail-hook",
    status: "needs_auth",
    message: "Gmail setup needs sign-in before EasyClaw can finish the remaining steps.",
    updatedRefs: [],
    authSteps,
    resume: buildGmailSetupResume(inputs),
  };
}

export function updateBuilderSetupInput(state: BuilderState, key: string, value: string) {
  state.builderSetupInputs = {
    ...state.builderSetupInputs,
    [key]: value,
  };
  state.builderSetupError = null;
  persistBuilderSetupSessionState(
    state as BuilderState & {
      builderSetupFocus?: unknown;
    },
  );
}

export async function runBuilderSetupAction(
  state: BuilderState,
  params: { actionId?: string; connectorId?: string; inputs: Record<string, string> },
) {
  const actionRef = normalizeBuilderSetupActionRef(params);
  if (!state.client || !state.connected || !actionRef.actionId) {
    return;
  }
  state.builderSetupRunningConnectorId = actionRef.actionId;
  state.builderSetupError = null;
  state.builderSetupResult = null;
  persistBuilderSetupSessionState(
    state as BuilderState & {
      builderSetupFocus?: unknown;
    },
  );
  try {
    const result = await state.client.request<BuilderSetupRunResult>("agents.builder.setup.run", {
      actionId: actionRef.actionId,
      connectorId: actionRef.connectorId,
      inputs: params.inputs,
    });
    const normalizedResult = result ? normalizeBuilderSetupResult(result, actionRef) : null;
    state.builderSetupResult = normalizedResult;
    persistBuilderSetupSessionState(
      state as BuilderState & {
        builderSetupFocus?: unknown;
      },
    );
    const shouldRefresh =
      normalizedResult?.status === "configured" || (normalizedResult?.updatedRefs.length ?? 0) > 0;
    if (shouldRefresh) {
      const refreshState = state as BuilderSetupState;
      await loadConfig(refreshState);
      if (state.builderBrief.trim()) {
        await verifyBuilderPlan(state);
      }
      const pendingAction =
        normalizedResult?.status === "configured"
          ? findPendingSetupAction(state, actionRef)
          : null;
      if (normalizedResult?.status === "configured" && pendingAction) {
        state.builderSetupResult = {
          ...normalizedResult,
          status: "needs_setup",
          message: pendingAction.detail?.trim() || normalizedResult.message,
        };
        persistBuilderSetupSessionState(
          state as BuilderState & {
            builderSetupFocus?: unknown;
          },
        );
        return;
      }
      if (normalizedResult?.status === "configured" && typeof state.setTab === "function") {
        state.setTab("builder");
      }
    }
  } catch (error) {
    const formatted = formatBuilderSetupError(error);
    const gmailFallback = actionRef.connectorId.startsWith("platform:gmail-hook")
      ? buildGmailSetupFallback(params.inputs, formatted)
      : null;
    if (gmailFallback) {
      state.builderSetupResult = normalizeBuilderSetupResult(gmailFallback, actionRef);
      state.builderSetupError = null;
      persistBuilderSetupSessionState(
        state as BuilderState & {
          builderSetupFocus?: unknown;
        },
      );
      return;
    }
    state.builderSetupError = formatted;
  } finally {
    state.builderSetupRunningConnectorId = null;
  }
}

export async function loadBuilderPlan(state: BuilderState) {
  if (!state.client || !state.connected || !state.builderBrief.trim()) {
    return;
  }
  state.builderPlanLoading = true;
  state.builderPlanError = null;
  state.builderPlan = null;
  state.builderVerifyResult = null;
  state.builderVerifyError = null;
  try {
    const result = await state.client.request<BuilderPlanResult>("agents.builder.plan", {
      brief: state.builderBrief,
      ...(state.builderApprovalPosture ? { approvalPosture: state.builderApprovalPosture } : {}),
      ...(state.builderTemplateId ? { templateId: state.builderTemplateId } : {}),
      ...(state.builderModelId ? { modelId: state.builderModelId } : {}),
      ...(state.builderAgentName ? { agentName: state.builderAgentName } : {}),
    });
    state.builderPlan = result ?? null;
    reconcileBuilderSetupFocus(
      state as BuilderState & {
        builderSetupFocus?: unknown;
      },
      state.builderPlan,
    );
  } catch (error) {
    state.builderPlanError = String(error);
  } finally {
    state.builderPlanLoading = false;
  }
}

export async function applyBuilderPlan(state: BuilderState) {
  if (!state.client || !state.connected || !state.builderBrief.trim()) {
    return;
  }
  state.builderApplying = true;
  state.builderApplyError = null;
  state.builderApplyResult = null;
  try {
    const workspaceDocEdits = buildWorkspaceDocEditsPayload(state);
    const result = await state.client.request<BuilderApplyResult>("agents.builder.apply", {
      brief: state.builderBrief,
      ...(state.builderApprovalPosture ? { approvalPosture: state.builderApprovalPosture } : {}),
      ...(state.builderTemplateId ? { templateId: state.builderTemplateId } : {}),
      ...(state.builderModelId ? { modelId: state.builderModelId } : {}),
      ...(state.builderAgentName ? { agentName: state.builderAgentName } : {}),
      ...(workspaceDocEdits.length > 0 ? { workspaceDocEdits } : {}),
    });
    state.builderApplyResult = result ?? null;
    state.builderConfirmApply = false;
    const refreshState = state as BuilderApplyState;
    await Promise.allSettled([
      loadAgents(refreshState),
      reloadCronJobs(refreshState),
      loadCronStatus(refreshState),
    ]);
    const agentId = result?.result.agent.agentId?.trim();
    if (agentId && typeof state.setTab === "function") {
      const sessionKey = buildAgentMainSessionKey({ agentId });
      state.sessionKey = sessionKey;
      state.applySettings?.({
        ...(state.settings ?? {}),
        sessionKey,
        lastActiveSessionKey: sessionKey,
      });
      await state.loadAssistantIdentity?.();
      state.setTab("chat");
    }
  } catch (error) {
    state.builderApplyError = String(error);
  } finally {
    state.builderApplying = false;
  }
}

export async function verifyBuilderPlan(state: BuilderState) {
  if (!state.client || !state.connected || !state.builderBrief.trim()) {
    return;
  }
  state.builderVerifying = true;
  state.builderVerifyError = null;
  state.builderVerifyResult = null;
  try {
    const result = await state.client.request<BuilderVerifyResult>("agents.builder.verify", {
      brief: state.builderBrief,
      ...(state.builderApprovalPosture ? { approvalPosture: state.builderApprovalPosture } : {}),
      ...(state.builderTemplateId ? { templateId: state.builderTemplateId } : {}),
      ...(state.builderModelId ? { modelId: state.builderModelId } : {}),
      ...(state.builderAgentName ? { agentName: state.builderAgentName } : {}),
    });
    state.builderVerifyResult = result ?? null;
    if (result) {
      state.builderPlan = {
        draft: result.draft,
        workspacePreviews: result.workspacePreviews,
        plan: result.plan,
        graphPlans: result.graphPlans,
      };
    }
    reconcileBuilderSetupFocus(
      state as BuilderState & {
        builderSetupFocus?: unknown;
      },
      state.builderPlan,
    );
  } catch (error) {
    state.builderVerifyError = String(error);
  } finally {
    state.builderVerifying = false;
  }
}
