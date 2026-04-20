import type { OpenClawConfig } from "../../config/config.js";
import { formatApprovalPostureLabel } from "../capabilities/approval-posture.js";
import { buildOpenClawCapabilityRegistry } from "../capabilities/openclaw.js";
import type {
  PlannedIntegrationInstance,
  PlannedSetupTaskKind,
  PlannedVerificationResult,
  RequirementPlannerResult,
} from "../capabilities/planner.js";
import type {
  RequirementApprovalPosture,
  RequirementGap,
  RequirementQuestion,
  RequirementSet,
} from "../capabilities/requirements.js";
import { hasApprovalRoute } from "../capabilities/requirements.js";
import type { RiskClass } from "../capabilities/schema.js";
import type { BuildSpec } from "./build-spec.js";

type SetupFieldKind =
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

type SetupFieldInputType = "text" | "secret" | "select";
type SetupField = NonNullable<BuildSpec["setupActions"][number]["requiredFields"]>[number];
type SetupAction = BuildSpec["setupActions"][number];
type SetupActionKind = NonNullable<SetupAction["kind"]>;
type SetupActionSource = NonNullable<SetupAction["source"]>;
type SetupActionUiVariant = NonNullable<NonNullable<SetupAction["uiSchema"]>["variant"]>;
type BuildSpecPolicySummary = NonNullable<BuildSpec["policy"]>;
type BuildSpecApprovalPosture = BuildSpecPolicySummary["approval"]["posture"];

type SetupActionDraft = {
  id: string;
  connectorId: string;
  connectorLabel: string;
  title: string;
  detailParts: string[];
  kind: SetupActionKind;
  source: SetupActionSource;
  blocking: boolean;
  refs: Set<string>;
  requiredFields: Map<string, SetupField>;
  workflowRoles: Set<string>;
  uiSchema?: SetupAction["uiSchema"];
  guidedLauncher?: SetupAction["guidedLauncher"];
  completionSignal: NonNullable<SetupAction["completionSignal"]>;
};

const ACTION_SOURCE_PRIORITY: Record<SetupActionSource, number> = {
  "runtime-auth": 5,
  verification: 4,
  "planner-question": 3,
  "requirement-gap": 2,
  "setup-task": 1,
};

const ACTION_KIND_PRIORITY: Record<SetupActionKind, number> = {
  install: 0,
  connect: 1,
  configure: 2,
  policy: 3,
  verify: 4,
  question: 5,
  enable: 6,
};
const RISK_CLASS_PRIORITY: Record<RiskClass, number> = {
  read_only: 0,
  communicative: 1,
  operator: 2,
  externally_mutating: 3,
  config_mutating: 4,
};

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function sortStrings(values: Iterable<string>): string[] {
  return Array.from(values).toSorted((left, right) => left.localeCompare(right));
}

function sortRiskClasses(values: Iterable<RiskClass>): RiskClass[] {
  return Array.from(new Set(values)).toSorted(
    (left, right) => RISK_CLASS_PRIORITY[left] - RISK_CLASS_PRIORITY[right],
  );
}

function recommendedApprovalPostureForRisk(
  highestRisk: RiskClass,
): BuildSpecPolicySummary["approval"]["recommendedPosture"] {
  switch (highestRisk) {
    case "config_mutating":
      return "draft_only";
    case "operator":
    case "externally_mutating":
      return "ask_every_time";
    case "communicative":
    case "read_only":
      return "always_auto";
  }
}

function riskClassLabel(value: RiskClass): string {
  switch (value) {
    case "read_only":
      return "Read Only";
    case "communicative":
      return "Communication";
    case "operator":
      return "Operator";
    case "externally_mutating":
      return "Externally Mutating";
    case "config_mutating":
      return "Config Mutating";
  }
}

function approvalPostureLabel(value: RequirementApprovalPosture): string {
  return formatApprovalPostureLabel(value);
}

function summarizeBuildSpecPolicy(params: {
  requirements: RequirementSet;
  planning: RequirementPlannerResult;
  cfg?: OpenClawConfig;
}): BuildSpecPolicySummary {
  const registry = buildOpenClawCapabilityRegistry();
  const riskyContractIds = sortStrings(
    params.requirements.requestedContractIds.filter((contractId) =>
      registry.contractsById.has(contractId),
    ),
  );
  const riskyConnectorIds = sortStrings(
    params.planning.integrations
      .map((integration) => integration.connectorId)
      .filter((connectorId) => registry.connectorsById.has(connectorId)),
  );
  const riskTiers = sortRiskClasses([
    ...riskyContractIds.flatMap((contractId) => registry.contractsById.get(contractId)?.risk ?? []),
    ...params.planning.selections.flatMap((selection) =>
      selection.contractIds
        .map((contractId) => registry.contractsById.get(contractId)?.risk)
        .filter((risk): risk is RiskClass => Boolean(risk)),
    ),
    ...params.planning.integrations.flatMap((integration) =>
      integration.contracts.length === 0
        ? (registry.connectorsById.get(integration.connectorId)?.riskClasses ?? [])
        : [],
    ),
  ]);
  const highestRisk = riskTiers.at(-1) ?? "read_only";
  const approvalRequired = params.requirements.workflow.requiresApproval;
  const explicitPosture = approvalRequired ? params.requirements.approvalPosture : null;
  const routeConfigured = approvalRequired ? hasApprovalRoute(params.cfg) : false;
  const recommendedPosture = recommendedApprovalPostureForRisk(highestRisk);
  const blockers: string[] = [];

  if (approvalRequired && !routeConfigured) {
    blockers.push("Configure an approval route before apply is allowed.");
  }
  if (approvalRequired && !explicitPosture) {
    blockers.push("Choose an approval posture in Builder or the brief before apply is allowed.");
  }

  const posture: BuildSpecApprovalPosture =
    explicitPosture ?? (approvalRequired ? "unresolved" : "always_auto");
  const postureSource: BuildSpecPolicySummary["approval"]["postureSource"] = explicitPosture
    ? params.requirements.approvalPostureSource === "builder"
      ? "builder"
      : "brief"
    : approvalRequired
      ? "missing"
      : "defaulted";
  const routeStatus: BuildSpecPolicySummary["approval"]["routeStatus"] = approvalRequired
    ? routeConfigured
      ? "configured"
      : "missing"
    : "not_required";
  const summary = approvalRequired
    ? blockers.length > 0
      ? `${riskClassLabel(highestRisk)} risk. Builder still needs an approval route or posture before activation.`
      : `${riskClassLabel(highestRisk)} risk. Approval route is configured and ${
          postureSource === "builder" ? "Builder selected" : "the brief selected"
        } ${approvalPostureLabel(explicitPosture ?? recommendedPosture)}.`
    : `${riskClassLabel(highestRisk)} risk. No explicit approval route is required for this plan.`;

  return {
    highestRisk,
    riskTiers,
    summary,
    riskyContractIds,
    riskyConnectorIds,
    approval: {
      required: approvalRequired,
      routeStatus,
      posture,
      postureSource,
      recommendedPosture,
      unresolved: blockers.length > 0,
      blockers,
    },
  };
}

function normalizePrompt(value: string): string {
  return value.trim().toLowerCase();
}

function selectOptions(
  entries: Array<{ value: string; label: string }>,
): NonNullable<SetupField["options"]> {
  return entries.map((entry) => ({
    value: entry.value,
    label: entry.label,
  }));
}

function buildField(params: {
  key: string;
  label: string;
  kind: SetupFieldKind;
  required?: boolean;
  inputKey?: string;
  configPath?: string;
  inputType?: SetupFieldInputType;
  placeholder?: string;
  help?: string;
  options?: Array<{ value: string; label: string }>;
}): SetupField {
  return {
    key: params.key,
    label: params.label,
    kind: params.kind,
    required: params.required ?? true,
    ...(params.inputKey ? { inputKey: params.inputKey } : {}),
    ...(params.configPath ? { configPath: params.configPath } : {}),
    ...(params.inputType ? { inputType: params.inputType } : {}),
    ...(params.placeholder ? { placeholder: params.placeholder } : {}),
    ...(params.help ? { help: params.help } : {}),
    ...(params.options ? { options: selectOptions(params.options) } : {}),
  };
}

function addRequiredField(draft: SetupActionDraft, field: SetupField) {
  const existing = draft.requiredFields.get(field.key);
  if (!existing) {
    draft.requiredFields.set(field.key, field);
    return;
  }
  draft.requiredFields.set(field.key, {
    ...existing,
    ...field,
    required: existing.required || field.required,
    options: field.options ?? existing.options,
  });
}

function findSetupActionDescriptor(params: {
  integration: PlannedIntegrationInstance | undefined;
  actionId: string;
  kind: SetupActionKind;
}) {
  const descriptors = params.integration?.setupActionDescriptors ?? [];
  return (
    descriptors.find(
      (descriptor) => descriptor.actionId?.trim() && descriptor.actionId.trim() === params.actionId,
    ) ??
    descriptors.find((descriptor) => descriptor.kind === params.kind) ??
    null
  );
}

function applySetupActionDescriptor(params: {
  draft: SetupActionDraft;
  descriptor: NonNullable<ReturnType<typeof findSetupActionDescriptor>>;
}) {
  if (params.descriptor.title?.trim()) {
    params.draft.title = params.descriptor.title.trim();
  }
  if (params.descriptor.detail?.trim()) {
    params.draft.detailParts.push(params.descriptor.detail.trim());
  }
  if (params.descriptor.blocking !== undefined) {
    params.draft.blocking = params.descriptor.blocking;
  }
  for (const ref of params.descriptor.refs ?? []) {
    if (ref.trim()) {
      params.draft.refs.add(ref.trim());
    }
  }
  for (const field of params.descriptor.requiredFields ?? []) {
    addRequiredField(params.draft, field);
  }
  if (params.descriptor.uiSchema) {
    params.draft.uiSchema = {
      variant: params.descriptor.uiSchema.variant ?? "guided-setup",
      ...(params.descriptor.uiSchema.section?.trim()
        ? { section: params.descriptor.uiSchema.section.trim() }
        : {}),
      fieldKeys: params.descriptor.uiSchema.fieldKeys?.filter((key) => key.trim().length > 0) ?? [],
    };
  }
  if (params.descriptor.guidedLauncher) {
    params.draft.guidedLauncher = {
      available: params.descriptor.guidedLauncher.available,
      target: params.descriptor.guidedLauncher.target,
      ...(params.descriptor.guidedLauncher.connectorId?.trim()
        ? { connectorId: params.descriptor.guidedLauncher.connectorId.trim() }
        : {}),
    };
  }
  if (params.descriptor.completionSignal) {
    params.draft.completionSignal = params.descriptor.completionSignal;
  }
}

function mergeWorkspaceArtifacts(params: {
  buildSpec: BuildSpec;
  planning: RequirementPlannerResult;
}): BuildSpec["workspaceArtifacts"] {
  const merged = new Map(
    params.buildSpec.workspaceArtifacts.map((artifact) => [artifact.fileName, artifact] as const),
  );

  for (const integration of params.planning.integrations) {
    for (const artifact of integration.workspaceArtifacts ?? []) {
      const existing = merged.get(artifact.fileName);
      merged.set(artifact.fileName, {
        fileName: artifact.fileName,
        purpose: artifact.purpose || existing?.purpose || artifact.fileName,
        status: artifact.status ?? existing?.status ?? "suggested",
        previewSummary: artifact.previewSummary || existing?.previewSummary || artifact.purpose,
        ...(artifact.managedSection?.trim()
          ? { managedSection: artifact.managedSection.trim() }
          : existing?.managedSection
            ? { managedSection: existing.managedSection }
            : {}),
      });
    }
  }

  return Array.from(merged.values()).toSorted((left, right) =>
    left.fileName.localeCompare(right.fileName),
  );
}

function actionSpecificIds(connectorId: string): {
  configure?: string;
  connect?: string;
  verify?: string;
  question?: string;
  destination?: string;
  install?: string;
} {
  switch (connectorId) {
    case "platform:core-model":
      return {
        configure: "platform:core-model:configure",
        question: "platform:core-model:configure",
      };
    case "platform:exec-approvals":
      return {
        configure: "platform:exec-approvals:configure",
        question: "platform:exec-approvals:configure",
      };
    case "platform:gmail-hook":
      return {
        configure: "platform:gmail-hook",
        connect: "platform:gmail-hook",
        verify: "platform:gmail-hook",
        question: "platform:gmail-hook",
      };
    case "tools:web":
      return {
        configure: "tools:web:configure",
        verify: "tools:web:configure",
        question: "tools:web:configure",
      };
    case "channel:telegram":
      return {
        connect: "channel:telegram:verify-token",
        verify: "channel:telegram:verify-token",
        destination: "channel:telegram:auto-default-target",
        question: "channel:telegram:auto-default-target",
      };
    case "channel:whatsapp":
      return {
        connect: "channel:whatsapp",
        verify: "channel:whatsapp",
        destination: "channel:whatsapp:auto-default-target",
        question: "channel:whatsapp:auto-default-target",
      };
    case "channel:slack":
      return {
        connect: "channel:slack:verify-credentials",
        verify: "channel:slack:verify-credentials",
        destination: "channel:slack:auto-default-target",
        question: "channel:slack:auto-default-target",
      };
    case "channel:discord":
      return {
        connect: "channel:discord:verify-token",
        verify: "channel:discord:verify-token",
        destination: "channel:discord:auto-default-target",
        question: "channel:discord:auto-default-target",
      };
    case "channel:signal":
      return {
        connect: "channel:signal:auto-detect-http-url",
        verify: "channel:signal:verify-transport",
      };
    case "channel:googlechat":
      return {
        connect: "channel:googlechat:verify-auth",
        verify: "channel:googlechat:verify-auth",
      };
    case "channel:matrix":
      return {
        connect: "channel:matrix:verify-credentials",
        verify: "channel:matrix:verify-credentials",
      };
    case "channel:msteams":
      return {
        connect: "channel:msteams:verify-credentials",
        verify: "channel:msteams:verify-credentials",
      };
    case "channel:imessage":
      return {
        connect: "channel:imessage:verify-transport",
        verify: "channel:imessage:verify-transport",
      };
    default:
      return connectorId.startsWith("channel:")
        ? {
            install: `${connectorId}:install`,
            connect: `${connectorId}:connect`,
            verify: `${connectorId}:verify`,
            destination: `${connectorId}:configure`,
            question: `${connectorId}:configure`,
            configure: `${connectorId}:configure`,
          }
        : {
            install: `${connectorId}:install`,
            connect: `${connectorId}:connect`,
            verify: `${connectorId}:verify`,
            question: `${connectorId}:configure`,
            configure: `${connectorId}:configure`,
          };
  }
}

function actionIdForSetupTask(params: { connectorId: string; kind: PlannedSetupTaskKind }): string {
  const ids = actionSpecificIds(params.connectorId);
  switch (params.kind) {
    case "install":
      return ids.install ?? `${params.connectorId}:install`;
    case "connect":
      return ids.connect ?? `${params.connectorId}:connect`;
    case "configure":
      return ids.configure ?? `${params.connectorId}:configure`;
    case "policy":
      return ids.configure ?? `${params.connectorId}:configure`;
    case "enable":
      return ids.configure ?? `${params.connectorId}:enable`;
    case "verify":
      return ids.verify ?? ids.connect ?? `${params.connectorId}:verify`;
  }
}

function isDestinationQuestion(question: RequirementQuestion): boolean {
  const prompt = normalizePrompt(question.prompt);
  return (
    question.id === "delivery-target" ||
    prompt.includes("destination") ||
    prompt.includes("deliver")
  );
}

function actionIdForQuestion(params: {
  connectorId: string;
  question: RequirementQuestion;
}): string {
  const ids = actionSpecificIds(params.connectorId);
  if (isDestinationQuestion(params.question)) {
    return ids.destination ?? ids.question ?? `${params.connectorId}:question`;
  }
  return ids.question ?? `${params.connectorId}:question`;
}

function actionIdForGap(params: { connectorId: string; gap: RequirementGap }): string {
  const ids = actionSpecificIds(params.connectorId);
  if (params.gap.kind === "policy") {
    return ids.configure ?? `${params.connectorId}:configure`;
  }
  return ids.configure ?? `${params.connectorId}:configure`;
}

function actionIdForVerification(
  verification: Pick<PlannedVerificationResult, "connectorId" | "probeKind">,
): string {
  const ids = actionSpecificIds(verification.connectorId);
  if (verification.probeKind === "send_test") {
    return ids.destination ?? ids.verify ?? ids.connect ?? `${verification.connectorId}:verify`;
  }
  return ids.verify ?? ids.connect ?? `${verification.connectorId}:verify`;
}

function defaultRequiredFieldsForAction(params: {
  actionId: string;
  connectorId: string;
}): SetupField[] {
  switch (params.actionId) {
    case "platform:gmail-hook":
      return [
        buildField({
          key: "account",
          label: "Gmail account",
          kind: "account",
          inputKey: "account",
          configPath: "hooks.gmail.account",
          inputType: "text",
          placeholder: "automation@example.com",
          help: "Mailbox address that owns the Gmail watch.",
        }),
        buildField({
          key: "project",
          label: "Google Cloud project",
          kind: "generic",
          required: false,
          inputKey: "project",
          inputType: "text",
          placeholder: "my-project",
        }),
        buildField({
          key: "topic",
          label: "Pub/Sub topic",
          kind: "generic",
          required: false,
          inputKey: "topic",
          configPath: "hooks.gmail.topic",
          inputType: "text",
          placeholder: "projects/my-project/topics/gmail-push",
        }),
        buildField({
          key: "subscription",
          label: "Pub/Sub subscription",
          kind: "generic",
          required: false,
          inputKey: "subscription",
          inputType: "text",
          placeholder: "gmail-push-subscription",
        }),
        buildField({
          key: "pushEndpoint",
          label: "Public push endpoint",
          kind: "destination",
          required: false,
          inputKey: "pushEndpoint",
          inputType: "text",
          placeholder: "https://your-host.example/gmail-pubsub",
          help: "Optional when Tailscale Funnel is available.",
        }),
      ];
    case "platform:core-model:configure":
      return [
        buildField({
          key: "model",
          label: "Default model",
          kind: "model",
          configPath: "agents.defaults.model",
          inputType: "select",
          options: [
            { value: "openai/gpt-5.4", label: "OpenAI (GPT-5.4)" },
            { value: "anthropic/claude-sonnet-4-6", label: "Anthropic (Claude Sonnet 4.6)" },
            { value: "google/gemini-2.5-pro", label: "Google (Gemini 2.5 Pro)" },
            { value: "xai/grok-4", label: "xAI (Grok 4)" },
            { value: "ollama/llama3.3:8b", label: "Ollama (llama3.3:8b)" },
          ],
          help: "Choose the runtime model this workflow will use by default.",
        }),
      ];
    case "platform:exec-approvals:configure":
      return [
        buildField({
          key: "approval-enabled",
          label: "Forward exec approvals",
          kind: "approval",
          configPath: "approvals.exec.enabled",
          inputType: "select",
          options: [
            { value: "true", label: "Enabled" },
            { value: "false", label: "Disabled" },
          ],
        }),
        buildField({
          key: "approval-mode",
          label: "Approval forwarding mode",
          kind: "approval",
          configPath: "approvals.exec.mode",
          inputType: "select",
          options: [
            { value: "session", label: "Session only" },
            { value: "targets", label: "Explicit targets only" },
            { value: "both", label: "Session and targets" },
          ],
        }),
        buildField({
          key: "approval-target-channel",
          label: "Approval target channel",
          kind: "destination",
          required: false,
          configPath: "approvals.exec.targets.0.channel",
          inputType: "text",
          placeholder: "telegram",
        }),
        buildField({
          key: "approval-target",
          label: "Approval target destination",
          kind: "destination",
          required: false,
          configPath: "approvals.exec.targets.0.to",
          inputType: "text",
          placeholder: "123456789",
        }),
      ];
    case "tools:web:configure":
      return [
        buildField({
          key: "provider",
          label: "Web search provider",
          kind: "provider",
          inputKey: "provider",
          configPath: "tools.web.search.provider",
          inputType: "select",
          options: [
            { value: "brave", label: "Brave" },
            { value: "gemini", label: "Gemini" },
            { value: "grok", label: "Grok" },
            { value: "kimi", label: "Kimi" },
            { value: "perplexity", label: "Perplexity" },
          ],
          help: "Provider used by web_search for latest-news and research requests.",
        }),
        buildField({
          key: "apiKey",
          label: "API key",
          kind: "auth",
          required: false,
          inputKey: "apiKey",
          inputType: "secret",
          placeholder: "Paste provider API key",
          help: "Leave blank to keep an existing config or environment credential.",
        }),
      ];
    case "channel:telegram:verify-token":
      return [
        buildField({
          key: "auth",
          label: "Bot token",
          kind: "auth",
          inputKey: "token",
          configPath: "channels.telegram.botToken",
          inputType: "secret",
          placeholder: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
        }),
      ];
    case "channel:telegram:auto-default-target":
      return [
        buildField({
          key: "destination",
          label: "Delivery target",
          kind: "destination",
          required: false,
          inputKey: "target",
          configPath: "channels.telegram.defaultTo",
          inputType: "text",
          placeholder: "123456789 or -1001234567890:topic:42",
        }),
      ];
    case "channel:slack:verify-credentials":
      return [
        buildField({
          key: "bot-token",
          label: "Bot token",
          kind: "auth",
          required: true,
          inputKey: "slack.botToken",
          configPath: "channels.slack.botToken",
          inputType: "secret",
        }),
        buildField({
          key: "app-token",
          label: "App token",
          kind: "auth",
          required: false,
          inputKey: "slack.appToken",
          configPath: "channels.slack.appToken",
          inputType: "secret",
        }),
      ];
    case "channel:discord:verify-token":
      return [
        buildField({
          key: "token",
          label: "Bot token",
          kind: "auth",
          inputKey: "discord.token",
          configPath: "channels.discord.token",
          inputType: "secret",
        }),
      ];
    case "channel:signal:verify-transport":
      return [
        buildField({
          key: "signal-account",
          label: "Signal account",
          kind: "account",
          inputKey: "signal.account",
          configPath: "channels.signal.account",
          inputType: "text",
        }),
        buildField({
          key: "signal-http-url",
          label: "Signal HTTP URL",
          kind: "destination",
          required: false,
          inputKey: "signal.httpUrl",
          configPath: "channels.signal.httpUrl",
          inputType: "text",
          placeholder: "http://127.0.0.1:8080",
        }),
      ];
    case "channel:msteams:verify-credentials":
      return [
        buildField({
          key: "teams-app-id",
          label: "App ID",
          kind: "auth",
          configPath: "channels.msteams.appId",
          inputType: "text",
        }),
        buildField({
          key: "teams-app-password",
          label: "App password",
          kind: "auth",
          configPath: "channels.msteams.appPassword",
          inputType: "secret",
        }),
        buildField({
          key: "teams-tenant-id",
          label: "Tenant ID",
          kind: "auth",
          configPath: "channels.msteams.tenantId",
          inputType: "text",
        }),
      ];
    default:
      if (params.actionId.endsWith(":install")) {
        return [];
      }
      if (params.connectorId === "channel:whatsapp") {
        return [
          buildField({
            key: "session",
            label: "Linked session",
            kind: "session",
            required: true,
          }),
          buildField({
            key: "destination",
            label: "Delivery target",
            kind: "destination",
            required: false,
            inputKey: "whatsapp.target",
            configPath: "channels.whatsapp.defaultTo",
            inputType: "text",
            placeholder: "+15551234567 or 120363025391234567@g.us",
          }),
        ];
      }
      if (params.connectorId.startsWith("channel:")) {
        return [
          buildField({
            key: "auth",
            label: "Account or token",
            kind: "auth",
            required: true,
          }),
          buildField({
            key: "destination",
            label: "Delivery target",
            kind: "destination",
            required: false,
          }),
        ];
      }
      return [];
  }
}

function isGuidedBuilderAction(params: { connectorId: string; actionId: string }): boolean {
  return (
    params.connectorId.startsWith("channel:") ||
    params.connectorId === "platform:core-model" ||
    params.connectorId === "platform:exec-approvals" ||
    params.connectorId === "platform:gmail-hook" ||
    params.connectorId === "tools:web"
  );
}

function inferConnectorIdFromGap(gap: RequirementGap): string | null {
  if (gap.connectorIds[0]) {
    return gap.connectorIds[0];
  }
  switch (gap.code) {
    case "approval-route":
      return "platform:exec-approvals";
    case "cron-disabled":
      return "tools:automation";
    case "runtime-model-unresolved":
      return "platform:core-model";
    case "gmail-hook":
      return "platform:gmail-hook";
    default:
      return null;
  }
}

function inferConnectorIdFromQuestion(params: {
  question: RequirementQuestion;
  planning: RequirementPlannerResult;
  requirements: RequirementSet;
}): string | null {
  const prompt = normalizePrompt(params.question.prompt);
  if (prompt.includes("whatsapp")) {
    return "channel:whatsapp";
  }
  if (prompt.includes("telegram")) {
    return "channel:telegram";
  }
  if (prompt.includes("gmail")) {
    return "platform:gmail-hook";
  }
  if (prompt.includes("approval")) {
    return "platform:exec-approvals";
  }
  if (prompt.includes("model") || prompt.includes("provider")) {
    return "platform:core-model";
  }
  if (prompt.includes("schedule") || prompt.includes("timezone")) {
    return "tools:automation";
  }
  if (params.question.id === "delivery-target") {
    const selectedChannel =
      params.planning.selections.find((selection) => selection.connectorId.startsWith("channel:"))
        ?.connectorId ??
      params.requirements.outputs
        .flatMap((entry) => entry.connectorIds)
        .find((connectorId) => connectorId.startsWith("channel:")) ??
      params.planning.integrations.find((integration) =>
        integration.connectorId.startsWith("channel:"),
      )?.connectorId;
    return selectedChannel ?? null;
  }
  return null;
}

function addQuestionFields(draft: SetupActionDraft, question: RequirementQuestion) {
  const prompt = normalizePrompt(question.prompt);
  if (isDestinationQuestion(question)) {
    addRequiredField(
      draft,
      buildField({
        key: "destination",
        label: "Delivery target",
        kind: "destination",
        required: true,
      }),
    );
  }
  if (prompt.includes("approval")) {
    addRequiredField(
      draft,
      buildField({
        key: "approval-mode",
        label: "Approval mode",
        kind: "approval",
        required: true,
      }),
    );
  }
  if (prompt.includes("account") || prompt.includes("mailbox")) {
    addRequiredField(
      draft,
      buildField({
        key: "account",
        label: "Account",
        kind: "account",
        required: true,
      }),
    );
  }
  if (prompt.includes("schedule") || prompt.includes("timezone") || prompt.includes("time")) {
    addRequiredField(
      draft,
      buildField({
        key: "schedule",
        label: "Schedule",
        kind: "schedule",
        required: true,
      }),
    );
  }
  if (prompt.includes("model") || prompt.includes("provider")) {
    addRequiredField(
      draft,
      buildField({
        key: "model",
        label: "Model",
        kind: "model",
        required: true,
      }),
    );
  }
}

function addGapFields(draft: SetupActionDraft, gap: RequirementGap) {
  switch (gap.code) {
    case "approval-posture":
      addRequiredField(
        draft,
        buildField({
          key: "approval-posture",
          label: "Approval posture",
          kind: "approval",
          required: true,
        }),
      );
      return;
    case "approval-route":
      addRequiredField(
        draft,
        buildField({
          key: "approval-mode",
          label: "Approval mode",
          kind: "approval",
          required: true,
        }),
      );
      addRequiredField(
        draft,
        buildField({
          key: "approval-target",
          label: "Approval destination",
          kind: "destination",
          required: true,
        }),
      );
      return;
    case "runtime-model-unresolved":
      addRequiredField(
        draft,
        buildField({
          key: "model",
          label: "Runtime model",
          kind: "model",
          required: true,
        }),
      );
      addRequiredField(
        draft,
        buildField({
          key: "provider",
          label: "Model provider",
          kind: "provider",
          required: true,
        }),
      );
      return;
    case "cron-disabled":
      addRequiredField(
        draft,
        buildField({
          key: "schedule",
          label: "Schedule",
          kind: "schedule",
          required: true,
        }),
      );
      return;
    case "gmail-hook":
      addRequiredField(
        draft,
        buildField({
          key: "account",
          label: "Gmail account",
          kind: "account",
          required: true,
        }),
      );
      addRequiredField(
        draft,
        buildField({
          key: "auth",
          label: "Google auth",
          kind: "auth",
          required: true,
        }),
      );
      return;
    default:
      return;
  }
}

function unresolvedVerificationResults(params: {
  planning: RequirementPlannerResult;
  connectorId: string;
}) {
  return params.planning.verifications.filter(
    (verification) =>
      verification.connectorId === params.connectorId &&
      (verification.status === "failed" || verification.status === "blocked"),
  );
}

function completionSignalForConnector(params: {
  connectorId: string;
  connectorLabel: string;
  integration: PlannedIntegrationInstance | undefined;
  planning: RequirementPlannerResult;
}) {
  const failingVerifications = unresolvedVerificationResults({
    planning: params.planning,
    connectorId: params.connectorId,
  });
  if (failingVerifications.length > 0) {
    return {
      kind: "verification" as const,
      target: failingVerifications.map((verification) => verification.id).join(","),
      detail: `Pass ${failingVerifications.map((verification) => verification.probeLabel).join(", ")} for ${params.connectorLabel}.`,
    };
  }

  const integration = params.integration;
  if (integration?.installRequired && integration.status === "install_required") {
    return {
      kind: "integration-status" as const,
      target: "installed",
      detail: `${params.connectorLabel} must be installed before apply is allowed.`,
    };
  }
  if (integration?.requiresAuth) {
    return {
      kind: "integration-status" as const,
      target: "authenticated",
      detail: `${params.connectorLabel} must authenticate successfully before apply is allowed.`,
    };
  }
  return {
    kind: "integration-status" as const,
    target: "configured",
    detail: `${params.connectorLabel} must be configured before apply is allowed.`,
  };
}

function sourceWithPriority(
  current: SetupActionSource,
  next: SetupActionSource,
): SetupActionSource {
  return ACTION_SOURCE_PRIORITY[next] >= ACTION_SOURCE_PRIORITY[current] ? next : current;
}

function actionUiVariant(kind: SetupActionKind, guided: boolean): SetupActionUiVariant {
  if (kind === "question") {
    return "inline-question";
  }
  return guided ? "guided-setup" : "expert-config";
}

function sortActions(actions: SetupAction[]): SetupAction[] {
  return actions.toSorted((left, right) => {
    const label = (left.connectorLabel ?? left.title).localeCompare(
      right.connectorLabel ?? right.title,
    );
    if (label !== 0) {
      return label;
    }
    const leftRank = ACTION_KIND_PRIORITY[left.kind ?? "configure"] ?? 99;
    const rightRank = ACTION_KIND_PRIORITY[right.kind ?? "configure"] ?? 99;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return left.title.localeCompare(right.title);
  });
}

export function synchronizeBuildSpec(params: {
  buildSpec: BuildSpec;
  requirements: RequirementSet;
  planning: RequirementPlannerResult;
  questions: RequirementQuestion[];
  cfg?: OpenClawConfig;
}): BuildSpec {
  const integrationsById = new Map(
    params.planning.integrations.map(
      (integration) => [integration.connectorId, integration] as const,
    ),
  );
  const readyIntegrationCount = params.planning.integrations.filter((integration) =>
    ["configured", "authenticated", "verified"].includes(integration.status),
  ).length;
  const setupActionDrafts = new Map<string, SetupActionDraft>();
  const existingActionsById = new Map(
    params.buildSpec.setupActions.map((action) => {
      const fallbackId = `${action.connectorId}:${action.kind ?? "configure"}`;
      return [action.id ?? fallbackId, action] as const;
    }),
  );

  const ensureAction = (paramsForAction: {
    actionId: string;
    connectorId: string;
    kind: SetupActionKind;
    source: SetupActionSource;
    title?: string;
  }): SetupActionDraft => {
    const existingDraft = setupActionDrafts.get(paramsForAction.actionId);
    if (existingDraft) {
      existingDraft.kind = paramsForAction.kind;
      existingDraft.source = sourceWithPriority(existingDraft.source, paramsForAction.source);
      if (paramsForAction.title) {
        existingDraft.title = paramsForAction.title;
      }
      return existingDraft;
    }
    const integration = integrationsById.get(paramsForAction.connectorId);
    const plannerAction =
      existingActionsById.get(paramsForAction.actionId) ??
      existingActionsById.get(`${paramsForAction.connectorId}:${paramsForAction.kind}`);
    const connectorLabel =
      integration?.label ??
      plannerAction?.connectorLabel ??
      plannerAction?.title ??
      paramsForAction.connectorId;
    const draft: SetupActionDraft = {
      id: paramsForAction.actionId,
      connectorId: paramsForAction.connectorId,
      connectorLabel,
      title: paramsForAction.title ?? plannerAction?.title ?? `Configure ${connectorLabel}`,
      detailParts: [],
      kind: paramsForAction.kind,
      source: paramsForAction.source,
      blocking: true,
      refs: new Set([
        ...(integration?.configRefs ?? []),
        ...(integration?.authRefs ?? []),
        ...(plannerAction?.refs ?? []),
      ]),
      requiredFields: new Map(
        defaultRequiredFieldsForAction({
          actionId: paramsForAction.actionId,
          connectorId: paramsForAction.connectorId,
        }).map((field) => [field.key, field] as const),
      ),
      workflowRoles: new Set(
        params.planning.topology.roles
          .filter((role) => role.connectorIds.includes(paramsForAction.connectorId))
          .map((role) => role.label),
      ),
      completionSignal: completionSignalForConnector({
        connectorId: paramsForAction.connectorId,
        connectorLabel,
        integration,
        planning: params.planning,
      }),
    };
    const descriptor = findSetupActionDescriptor({
      integration,
      actionId: paramsForAction.actionId,
      kind: paramsForAction.kind,
    });
    if (descriptor) {
      applySetupActionDescriptor({ draft, descriptor });
    }
    setupActionDrafts.set(paramsForAction.actionId, draft);
    return draft;
  };

  for (const task of params.planning.setupTasks) {
    if (task.status === "completed") {
      continue;
    }
    if (
      task.kind === "enable" &&
      unresolvedVerificationResults({
        planning: params.planning,
        connectorId: task.connectorId,
      }).length > 0
    ) {
      continue;
    }
    const actionId = actionIdForSetupTask({
      connectorId: task.connectorId,
      kind: task.kind,
    });
    const draft = ensureAction({
      actionId,
      connectorId: task.connectorId,
      kind: task.kind,
      source: "setup-task",
      title: task.title,
    });
    draft.title = task.title;
    draft.detailParts.push(task.detail);
    for (const ref of task.refs) {
      draft.refs.add(ref);
    }
  }

  for (const gap of [
    ...params.requirements.missingInputs,
    ...params.requirements.setupGaps,
    ...params.requirements.policyGaps,
  ]) {
    const connectorId = inferConnectorIdFromGap(gap);
    if (!connectorId) {
      continue;
    }
    const actionId = actionIdForGap({
      connectorId,
      gap,
    });
    const kind: SetupActionKind = gap.kind === "policy" ? "policy" : "configure";
    const draft = ensureAction({
      actionId,
      connectorId,
      kind,
      source: "requirement-gap",
    });
    draft.detailParts.push(gap.message);
    if (gap.kind === "policy") {
      draft.title = `Configure ${draft.connectorLabel}`;
      draft.completionSignal = {
        kind: "integration-status",
        target: "configured",
        detail: `${draft.connectorLabel} must have a valid approval route before apply is allowed.`,
      };
    }
    if (gap.kind === "input") {
      draft.completionSignal = {
        kind: "builder-check",
        target: gap.code,
        detail: `Provide the missing ${gap.code.replace(/-/g, " ")} information for ${draft.connectorLabel}.`,
      };
    }
    addGapFields(draft, gap);
  }

  for (const question of params.questions.filter((entry) => entry.required)) {
    const connectorId = inferConnectorIdFromQuestion({
      question,
      planning: params.planning,
      requirements: params.requirements,
    });
    if (!connectorId) {
      continue;
    }
    const actionId = actionIdForQuestion({
      connectorId,
      question,
    });
    const draft = ensureAction({
      actionId,
      connectorId,
      kind: "question",
      source: "planner-question",
    });
    if (draft.title.startsWith("Configure ")) {
      draft.title = `Finish ${draft.connectorLabel} setup`;
    }
    draft.detailParts.push(question.prompt);
    draft.completionSignal = {
      kind: "builder-check",
      target: question.id,
      detail: `Answer the missing Builder question for ${draft.connectorLabel}.`,
    };
    addQuestionFields(draft, question);
  }

  for (const verification of params.planning.verifications) {
    if (verification.status !== "failed" && verification.status !== "blocked") {
      continue;
    }
    const actionId = actionIdForVerification(verification);
    const draft = ensureAction({
      actionId,
      connectorId: verification.connectorId,
      kind: "verify",
      source: "verification",
    });
    draft.kind = draft.kind === "install" || draft.kind === "policy" ? draft.kind : "verify";
    if (draft.kind === "verify") {
      draft.title =
        verification.probeKind === "send_test"
          ? `Verify ${draft.connectorLabel} delivery target`
          : `Verify ${draft.connectorLabel}`;
    }
    draft.detailParts.push(verification.detail);
    draft.completionSignal = {
      kind: "verification",
      target: verification.id,
      detail: `Pass ${verification.probeLabel} for ${draft.connectorLabel}.`,
    };
  }

  for (const draft of setupActionDrafts.values()) {
    const descriptor = findSetupActionDescriptor({
      integration: integrationsById.get(draft.connectorId),
      actionId: draft.id,
      kind: draft.kind,
    });
    if (descriptor) {
      applySetupActionDescriptor({ draft, descriptor });
    }
  }

  const setupActions = sortActions(
    Array.from(setupActionDrafts.values()).map((draft) => {
      const refs = sortStrings(draft.refs);
      const guided = isGuidedBuilderAction({
        connectorId: draft.connectorId,
        actionId: draft.id,
      });
      return {
        id: draft.id,
        connectorId: draft.connectorId,
        connectorLabel: draft.connectorLabel,
        title: draft.title,
        detail: dedupeStrings(draft.detailParts).join(" ") || draft.completionSignal.detail,
        status: "pending" as const,
        kind: draft.kind,
        source: draft.source,
        blocking: draft.blocking,
        refs,
        requiredFields: Array.from(draft.requiredFields.values()),
        workflowRoles: sortStrings(draft.workflowRoles),
        uiSchema: {
          variant: draft.uiSchema?.variant ?? actionUiVariant(draft.kind, guided),
          ...(draft.uiSchema?.section?.trim()
            ? { section: draft.uiSchema.section.trim() }
            : refs[0]
              ? { section: refs[0] }
              : {}),
          fieldKeys:
            draft.uiSchema?.fieldKeys && draft.uiSchema.fieldKeys.length > 0
              ? draft.uiSchema.fieldKeys
              : Array.from(draft.requiredFields.keys()),
        },
        guidedLauncher:
          draft.guidedLauncher ??
          ({
            available: guided,
            target: guided ? "builder-quick-setup" : "config-tab",
            connectorId: draft.connectorId,
          } satisfies NonNullable<SetupAction["guidedLauncher"]>),
        fallbackTarget: {
          refs,
          label: "Open expert setup",
        },
        completionSignal: draft.completionSignal,
      } satisfies SetupAction;
    }),
  );

  return {
    ...params.buildSpec,
    status: params.planning.status,
    context: {
      ...params.buildSpec.context,
      readyIntegrationCount,
      unresolvedIntegrationCount: Math.max(
        0,
        params.planning.integrations.length - readyIntegrationCount,
      ),
    },
    workspaceArtifacts: mergeWorkspaceArtifacts(params),
    integrations: params.planning.integrations.map((integration) => ({
      connectorId: integration.connectorId,
      label: integration.label,
      status: integration.status,
      kind: integration.kind,
      sourceKind: integration.sourceKind,
      issues: [...integration.issues],
    })),
    policy: summarizeBuildSpecPolicy({
      requirements: params.requirements,
      planning: params.planning,
      cfg: params.cfg,
    }),
    setupActions,
    questions: params.questions.map((question) => question.prompt),
  };
}

export function hasBlockingSetupActions(buildSpec: Pick<BuildSpec, "setupActions">): boolean {
  return buildSpec.setupActions.some(
    (action) => (action.blocking ?? false) && action.status !== "completed",
  );
}
