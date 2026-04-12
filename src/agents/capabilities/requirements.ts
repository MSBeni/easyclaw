import type { OpenClawConfig } from "../../config/config.js";
import { isChannelConfigured as isConfiguredChannelRef } from "../../config/plugin-auto-enable.js";
import { hasConfiguredExecApprovalDmRoute } from "../../infra/exec-approval-surface.js";
import {
  APPROVAL_POSTURES,
  resolveApprovalPostureFromText,
  type ApprovalPosture,
} from "./approval-posture.js";
import { buildOpenClawCapabilityRegistry } from "./openclaw.js";
import { listConnectorsForContract } from "./registry.js";
import type { CapabilityRegistry, ConnectorDefinition, PlannerStatus } from "./schema.js";

export const REQUIREMENT_CONFIDENCES = ["low", "medium", "high"] as const;
export const REQUIREMENT_WORKFLOW_GOALS = [
  "assistant",
  "briefing",
  "operator",
  "research",
  "support",
] as const;
export const REQUIREMENT_EXECUTION_MODES = [
  "bound-channel",
  "direct",
  "hybrid",
  "scheduled",
  "webhook",
] as const;
export const REQUIREMENT_UNSUPPORTED_KINDS = [
  "action",
  "capability",
  "connector",
  "delivery",
  "policy",
] as const;
export const REQUIREMENT_APPROVAL_POSTURES = APPROVAL_POSTURES;

export type RequirementConfidence = (typeof REQUIREMENT_CONFIDENCES)[number];
export type RequirementWorkflowGoal = (typeof REQUIREMENT_WORKFLOW_GOALS)[number];
export type RequirementExecutionMode = (typeof REQUIREMENT_EXECUTION_MODES)[number];
export type RequirementUnsupportedKind = (typeof REQUIREMENT_UNSUPPORTED_KINDS)[number];
export type RequirementApprovalPosture = ApprovalPosture;

export type RequirementDescriptor = {
  id: string;
  label: string;
  detail: string;
  contractIds: string[];
  connectorIds: string[];
  confidence: RequirementConfidence;
};

export type RequirementGapKind = "input" | "setup" | "policy" | "unsupported";

export type RequirementGap = {
  kind: RequirementGapKind;
  code: string;
  message: string;
  contractIds: string[];
  connectorIds: string[];
};

export type RequirementQuestion = {
  id: string;
  prompt: string;
  required: boolean;
};

export type RequirementConstraint = {
  id: string;
  label: string;
  detail: string;
  contractIds: string[];
  connectorIds: string[];
  values: string[];
};

export type RequirementUnsupportedClassification = {
  code: string;
  kind: RequirementUnsupportedKind;
  label: string;
  detail: string;
  contractIds: string[];
  connectorIds: string[];
};

export type RequirementWorkflowSummary = {
  primaryGoal: RequirementWorkflowGoal;
  executionMode: RequirementExecutionMode;
  triggerKinds: string[];
  sourceKinds: string[];
  transformKinds: string[];
  actionKinds: string[];
  deliveryKinds: string[];
  requiresApproval: boolean;
};

export type RequirementSet = {
  brief: string;
  approvalPosture: RequirementApprovalPosture | null;
  approvalPostureSource: "brief" | "builder" | "missing";
  confidence: RequirementConfidence;
  workflow: RequirementWorkflowSummary;
  intentTags: string[];
  requestedContractIds: string[];
  supportedContractIds: string[];
  unsupportedContractIds: string[];
  recommendedConnectorIds: string[];
  triggers: RequirementDescriptor[];
  inputs: RequirementDescriptor[];
  transforms: RequirementDescriptor[];
  decisions: RequirementDescriptor[];
  actions: RequirementDescriptor[];
  outputs: RequirementDescriptor[];
  policies: RequirementDescriptor[];
  constraints: RequirementDescriptor[];
  sourceConstraints: RequirementConstraint[];
  actionConstraints: RequirementConstraint[];
  missingInputs: RequirementGap[];
  setupGaps: RequirementGap[];
  policyGaps: RequirementGap[];
  unsupportedGaps: RequirementGap[];
  ambiguities: string[];
  unsupportedRequests: string[];
  unsupportedClassifications: RequirementUnsupportedClassification[];
  missingDataFields: string[];
  plannerStatus: PlannerStatus;
};

type RequirementExtractionParams = {
  brief: string;
  approvalPosture?: RequirementApprovalPosture;
  cfg?: OpenClawConfig;
  registry?: CapabilityRegistry;
};

type RequirementGapPatch = Partial<
  Pick<RequirementSet, "missingInputs" | "setupGaps" | "policyGaps" | "unsupportedGaps">
>;

function dedupeStrings(values: string[]): string[] {
  return values.filter((value, index, all) => all.indexOf(value) === index);
}

function dedupeDescriptors(values: RequirementDescriptor[]): RequirementDescriptor[] {
  const seen = new Set<string>();
  const next: RequirementDescriptor[] = [];
  for (const value of values) {
    const key = `${value.id}:${value.detail}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    next.push(value);
  }
  return next;
}

function dedupeConstraints(values: RequirementConstraint[]): RequirementConstraint[] {
  const seen = new Set<string>();
  const next: RequirementConstraint[] = [];
  for (const value of values) {
    const key = `${value.id}:${value.detail}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    next.push(value);
  }
  return next;
}

function dedupeGaps(values: RequirementGap[]): RequirementGap[] {
  const seen = new Set<string>();
  const next: RequirementGap[] = [];
  for (const value of values) {
    const key = `${value.kind}:${value.code}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    next.push(value);
  }
  return next;
}

function createDescriptor(params: RequirementDescriptor): RequirementDescriptor {
  return {
    ...params,
    contractIds: dedupeStrings(params.contractIds),
    connectorIds: dedupeStrings(params.connectorIds),
  };
}

function createGap(params: RequirementGap): RequirementGap {
  return {
    ...params,
    contractIds: dedupeStrings(params.contractIds),
    connectorIds: dedupeStrings(params.connectorIds),
  };
}

function createConstraint(params: RequirementConstraint): RequirementConstraint {
  return {
    ...params,
    contractIds: dedupeStrings(params.contractIds),
    connectorIds: dedupeStrings(params.connectorIds),
    values: dedupeStrings(params.values),
  };
}

export function resolveExplicitApprovalPosture(brief: string): RequirementApprovalPosture | null {
  return resolveApprovalPostureFromText(brief);
}

function normalizeWords(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeCompact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function dedupeNonEmptyStrings(values: Array<string | undefined>): string[] {
  return dedupeStrings(
    values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)),
  );
}

function isChatConnector(connector: ConnectorDefinition): boolean {
  const sourceKind = connector.source.kind;
  if (
    sourceKind !== "builtin_channel" &&
    sourceKind !== "channel_catalog" &&
    sourceKind !== "external"
  ) {
    return false;
  }
  return (
    connector.contracts.includes("ingress.chat") || connector.contracts.includes("message.send")
  );
}

function listConnectorMatchTerms(connector: ConnectorDefinition): string[] {
  const metadata = connector.metadata ?? {};
  return dedupeNonEmptyStrings([
    connector.source.id,
    connector.label,
    metadata.selectionLabel,
    metadata.detailLabel,
    ...(metadata.aliases ?? []),
  ]);
}

function connectorMatchesBrief(brief: string, connector: ConnectorDefinition): boolean {
  const normalizedBrief = ` ${normalizeWords(brief)} `;
  const compactBrief = normalizeCompact(brief);
  return listConnectorMatchTerms(connector).some((term) => {
    const normalizedTerm = normalizeWords(term);
    const compactTerm = normalizeCompact(term);
    if (!compactTerm) {
      return false;
    }
    return (
      (normalizedTerm.length > 0 && normalizedBrief.includes(` ${normalizedTerm} `)) ||
      (compactTerm.length > 3 && compactBrief.includes(compactTerm))
    );
  });
}

function detectMentionedChannels(
  brief: string,
  registry: CapabilityRegistry,
): ConnectorDefinition[] {
  return registry.connectors
    .filter((connector) => isChatConnector(connector))
    .filter((connector) => connectorMatchesBrief(brief, connector))
    .filter(
      (connector, index, all) =>
        all.findIndex((entry) => entry.source.id === connector.source.id) === index,
    );
}

function hasScheduleLanguage(brief: string): boolean {
  return /\b(daily|every day|each day|every morning|each morning|weekly|weekday|weekdays|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(
    brief,
  );
}

function hasExactScheduleTime(brief: string): boolean {
  return /\b(?:at|@)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b|\b\d{1,2}:\d{2}\s*(?:am|pm)\b/i.test(
    brief,
  );
}

function hasSummaryLanguage(brief: string): boolean {
  return /\b(summariz(?:e|es|ed|ing)?|summary|digest|briefing|brief|recap)\b/i.test(brief);
}

function hasReportLanguage(brief: string): boolean {
  return /\b(digest|briefing|brief|report|recap)\b/i.test(brief);
}

function hasResearchLanguage(brief: string): boolean {
  return /\b(research|investigate|analysis|analyze|analyse|compare|competitor|sources)\b/i.test(
    brief,
  );
}

function hasSupportLanguage(brief: string): boolean {
  return /\b(support|customer|helpdesk|ticket|billing|faq|responder)\b/i.test(brief);
}

function hasAssistantLanguage(brief: string): boolean {
  return /\b(assistant|organize|organise|planner|remind|personal)\b/i.test(brief);
}

function hasFeedLanguage(brief: string): boolean {
  return /\b(newsletter|feed|rss|substack|beehiiv)\b/i.test(brief);
}

function hasEmailSourceLanguage(brief: string): boolean {
  return (
    /\b(emails|gmail|mailbox|inbox)\b/i.test(brief) ||
    /\bfrom\s+(?:my\s+)?email\b/i.test(brief) ||
    /\b(?:read|check|scan|review|summari[sz]e|pull|fetch|get)\s+(?:my\s+)?email\b/i.test(brief)
  );
}

function hasWebLanguage(brief: string): boolean {
  return /https?:\/\/|\b(web|website|url|page|pages|article|articles|link|links)\b/i.test(brief);
}

function hasWebhookLanguage(brief: string): boolean {
  return /\b(webhook|callback|endpoint|api post|http post|incoming hook)\b/i.test(brief);
}

function hasFileLanguage(brief: string): boolean {
  return /\b(file|files|document|documents|pdf|markdown|csv|spreadsheet|workspace|folder)\b/i.test(
    brief,
  );
}

function hasMemoryLanguage(brief: string): boolean {
  return /\b(memory|remember|history|context|previous conversation|past chats?)\b/i.test(brief);
}

function hasAudioLanguage(brief: string): boolean {
  return /\b(audio|podcast|episode|listen|transcrib|voice|recording)\b/i.test(brief);
}

function hasBrowserLanguage(brief: string): boolean {
  return /\b(browser|open|click|navigate|visit|login|log in)\b/i.test(brief);
}

function hasSocialActionLanguage(brief: string): boolean {
  return /\b(follow|comment|post|reply|retweet|like|tweet)\b/i.test(brief);
}

function hasOnBehalfLanguage(brief: string): boolean {
  return /\bon my behalf\b/i.test(brief);
}

function hasInboundChatLanguage(brief: string): boolean {
  return /\b(watch|monitor|listen|respond|reply|incoming|inbound|questions?|messages?)\b/i.test(
    brief,
  );
}

function hasSessionSpawnLanguage(brief: string): boolean {
  return /\b(subagent|sub-agent|delegate|parallel agent|spawn(?: another)? agent)\b/i.test(brief);
}

function hasNodeLanguage(brief: string): boolean {
  return /\b(node|server|daemon|runtime|service|process)\b/i.test(brief);
}

function hasOutboundEmailDeliveryLanguage(brief: string): boolean {
  return /\b(?:email|mail)\s+(?:me|it|them|the result|the summary)\b|\b(?:by|via)\s+email\b|\bto\s+my\s+email\b/i.test(
    brief,
  );
}

function resolveRequirementConfidence(params: {
  descriptorCount: number;
  ambiguityCount: number;
  missingDataCount: number;
  unsupportedCount: number;
}): RequirementConfidence {
  if (params.descriptorCount === 0 || params.unsupportedCount > 0) {
    return "low";
  }
  if (params.ambiguityCount === 0 && params.missingDataCount === 0 && params.descriptorCount >= 2) {
    return "high";
  }
  if (params.ambiguityCount >= 3 || params.missingDataCount >= 3) {
    return "low";
  }
  return "medium";
}

function classifyUnsupportedGap(gap: RequirementGap): RequirementUnsupportedClassification {
  let kind: RequirementUnsupportedKind = "capability";
  let label = "Unsupported Capability";

  if (gap.code.startsWith("channel:")) {
    kind = "connector";
    label = "Unsupported Connector";
  } else if (gap.code.includes("delivery")) {
    kind = "delivery";
    label = "Unsupported Delivery";
  } else if (gap.code.includes("approval") || gap.code.includes("policy")) {
    kind = "policy";
    label = "Unsupported Policy";
  } else if (gap.code.includes("action")) {
    kind = "action";
    label = "Unsupported Action";
  }

  return {
    code: gap.code,
    kind,
    label,
    detail: gap.message,
    contractIds: gap.contractIds,
    connectorIds: gap.connectorIds,
  };
}

function resolveWorkflowSummary(params: {
  intentTags: string[];
  triggers: RequirementDescriptor[];
  inputs: RequirementDescriptor[];
  transforms: RequirementDescriptor[];
  actions: RequirementDescriptor[];
  outputs: RequirementDescriptor[];
  policies: RequirementDescriptor[];
  sourceConstraints: RequirementConstraint[];
  actionConstraints: RequirementConstraint[];
  unsupportedGaps: RequirementGap[];
}): RequirementWorkflowSummary {
  const triggerKinds = dedupeStrings(params.triggers.map((entry) => entry.id)).toSorted();
  const sourceKinds = dedupeStrings(params.inputs.map((entry) => entry.id)).toSorted();
  const transformKinds = dedupeStrings(params.transforms.map((entry) => entry.id)).toSorted();
  const actionKinds = dedupeStrings(params.actions.map((entry) => entry.id)).toSorted();
  const deliveryKinds = dedupeStrings(params.outputs.map((entry) => entry.id)).toSorted();
  const isBriefingWorkflow =
    params.intentTags.includes("scheduled") ||
    sourceKinds.includes("email-source") ||
    sourceKinds.includes("feed-source") ||
    deliveryKinds.includes("report-output");

  const primaryGoal: RequirementWorkflowGoal = params.intentTags.includes("support")
    ? "support"
    : params.intentTags.includes("research")
      ? "research"
      : isBriefingWorkflow
        ? "briefing"
        : actionKinds.length > 0
          ? "operator"
          : "assistant";

  const executionMode: RequirementExecutionMode =
    triggerKinds.includes("schedule") && triggerKinds.some((kind) => kind !== "schedule")
      ? "hybrid"
      : triggerKinds.includes("schedule")
        ? "scheduled"
        : triggerKinds.includes("webhook-ingress")
          ? "webhook"
          : triggerKinds.includes("chat-ingress")
            ? "bound-channel"
            : "direct";

  return {
    primaryGoal,
    executionMode,
    triggerKinds,
    sourceKinds,
    transformKinds,
    actionKinds,
    deliveryKinds,
    requiresApproval: params.policies.some((entry) =>
      entry.contractIds.includes("approval.request"),
    ),
  };
}

function isChannelConfigured(cfg: OpenClawConfig | undefined, channel: string): boolean {
  if (!cfg) {
    return false;
  }
  return isConfiguredChannelRef(cfg, channel);
}

function isGmailHookConfigured(cfg: OpenClawConfig | undefined): boolean {
  const gmail = cfg?.hooks?.gmail;
  return Boolean(cfg?.hooks?.token && gmail?.account && gmail?.topic && gmail?.pushToken);
}

export function hasApprovalRoute(cfg: OpenClawConfig | undefined): boolean {
  if (!cfg) {
    return false;
  }
  if (hasConfiguredExecApprovalDmRoute(cfg)) {
    return true;
  }
  const exec = cfg.approvals?.exec;
  return Boolean(exec?.enabled && (exec.targets?.length ?? 0) > 0);
}

function resolveRequestedAndSupportedContracts(
  registry: CapabilityRegistry,
  descriptors: RequirementDescriptor[],
): Pick<
  RequirementSet,
  | "requestedContractIds"
  | "supportedContractIds"
  | "unsupportedContractIds"
  | "recommendedConnectorIds"
> {
  const requestedContractIds = dedupeStrings(
    descriptors.flatMap((entry) => entry.contractIds),
  ).toSorted();
  const supportedContractIds = requestedContractIds.filter(
    (contractId) => listConnectorsForContract(registry, contractId).length > 0,
  );
  const unsupportedContractIds = requestedContractIds.filter(
    (contractId) => !supportedContractIds.includes(contractId),
  );
  const recommendedConnectorIds = dedupeStrings(
    descriptors.flatMap((entry) => {
      if (entry.connectorIds.length > 0) {
        return entry.connectorIds;
      }
      return listConnectorsForContract(registry, entry.contractIds[0] ?? "").map(
        (connector) => connector.id,
      );
    }),
  ).toSorted();

  return {
    requestedContractIds,
    supportedContractIds,
    unsupportedContractIds,
    recommendedConnectorIds,
  };
}

function resolvePlannerStatusFromGaps(params: {
  missingInputs: RequirementGap[];
  setupGaps: RequirementGap[];
  policyGaps: RequirementGap[];
  unsupportedGaps: RequirementGap[];
}): PlannerStatus {
  if (params.unsupportedGaps.length > 0) {
    return params.missingInputs.length > 0 ||
      params.setupGaps.length > 0 ||
      params.policyGaps.length > 0
      ? "partial"
      : "unsupported";
  }
  if (params.policyGaps.length > 0) {
    return "unsafe_without_policy";
  }
  if (params.missingInputs.length > 0) {
    return "needs_input";
  }
  if (params.setupGaps.length > 0) {
    return "needs_setup";
  }
  return "ready";
}

export function applyRequirementGaps(
  requirements: RequirementSet,
  patch: RequirementGapPatch,
): RequirementSet {
  const missingInputs = dedupeGaps([
    ...(requirements.missingInputs ?? []),
    ...(patch.missingInputs ?? []),
  ]);
  const setupGaps = dedupeGaps([...(requirements.setupGaps ?? []), ...(patch.setupGaps ?? [])]);
  const policyGaps = dedupeGaps([...(requirements.policyGaps ?? []), ...(patch.policyGaps ?? [])]);
  const unsupportedGaps = dedupeGaps([
    ...(requirements.unsupportedGaps ?? []),
    ...(patch.unsupportedGaps ?? []),
  ]);

  return {
    ...requirements,
    missingInputs,
    setupGaps,
    policyGaps,
    unsupportedGaps,
    plannerStatus: resolvePlannerStatusFromGaps({
      missingInputs,
      setupGaps,
      policyGaps,
      unsupportedGaps,
    }),
  };
}

export function applyRequirementQuestions(
  requirements: RequirementSet,
  questions: RequirementQuestion[],
): RequirementSet {
  const missingInputs = questions
    .filter((question) => question.required)
    .map((question) =>
      createGap({
        kind: "input",
        code: `question:${question.id}`,
        message: question.prompt,
        contractIds: [],
        connectorIds: [],
      }),
    );
  return applyRequirementGaps(requirements, { missingInputs });
}

export function buildRequirementSet(params: RequirementExtractionParams): RequirementSet {
  const brief = params.brief.trim();
  if (!brief) {
    throw new Error("A requirement brief is required.");
  }

  const registry = params.registry ?? buildOpenClawCapabilityRegistry();
  const text = brief.toLowerCase();
  const mentionedChannels = detectMentionedChannels(brief, registry);
  const mentionedChatChannelIds = mentionedChannels.map((connector) => connector.source.id);
  const intentTags = dedupeStrings(
    [
      hasAssistantLanguage(text) ? "assistant" : null,
      hasAudioLanguage(text) ? "audio" : null,
      hasFeedLanguage(text) ? "feed" : null,
      hasEmailSourceLanguage(brief) || hasOutboundEmailDeliveryLanguage(brief) ? "email" : null,
      hasFileLanguage(text) ? "file" : null,
      hasMemoryLanguage(text) ? "memory" : null,
      hasWebhookLanguage(text) ? "webhook" : null,
      hasResearchLanguage(text) ? "research" : null,
      hasScheduleLanguage(text) ? "scheduled" : null,
      hasSupportLanguage(text) ? "support" : null,
      hasSummaryLanguage(text) ? "summary" : null,
      hasBrowserLanguage(text) || hasSocialActionLanguage(text) ? "browser" : null,
      hasSocialActionLanguage(text) ? "social-action" : null,
      hasSessionSpawnLanguage(text) ? "delegation" : null,
      hasNodeLanguage(text) ? "runtime" : null,
    ].filter((value): value is string => Boolean(value)),
  ).toSorted();

  const triggers: RequirementDescriptor[] = [];
  const inputs: RequirementDescriptor[] = [];
  const transforms: RequirementDescriptor[] = [];
  const decisions: RequirementDescriptor[] = [];
  const actions: RequirementDescriptor[] = [];
  const outputs: RequirementDescriptor[] = [];
  const policies: RequirementDescriptor[] = [];
  const constraints: RequirementDescriptor[] = [];
  const sourceConstraints: RequirementConstraint[] = [];
  const actionConstraints: RequirementConstraint[] = [];
  const missingInputs: RequirementGap[] = [];
  const setupGaps: RequirementGap[] = [];
  const policyGaps: RequirementGap[] = [];
  const unsupportedGaps: RequirementGap[] = [];
  const ambiguities: string[] = [];
  const missingDataFields: string[] = [];

  const supportRequest = hasSupportLanguage(text);
  const scheduleRequest = hasScheduleLanguage(text);
  const summaryRequest = hasSummaryLanguage(text);
  const researchRequest = hasResearchLanguage(text);
  const emailRequest = hasEmailSourceLanguage(brief);
  const feedRequest = hasFeedLanguage(text);
  const newsletterViaEmailRequest = emailRequest && feedRequest;
  const fileRequest = hasFileLanguage(text);
  const memoryRequest = hasMemoryLanguage(text);
  const webhookRequest = hasWebhookLanguage(text);
  const webRequest = hasWebLanguage(text) || researchRequest;
  const audioRequest = hasAudioLanguage(text);
  const sessionSpawnRequest = hasSessionSpawnLanguage(text);
  const nodeRequest = hasNodeLanguage(text);
  const browserRequest =
    hasBrowserLanguage(text) || hasSocialActionLanguage(text) || /\b(x|twitter)\b/i.test(brief);
  const riskyActionRequest =
    hasOnBehalfLanguage(text) ||
    /\b(follow|comment|post|retweet|like)\b/i.test(brief) ||
    (/\breply\b/i.test(brief) && hasOnBehalfLanguage(text));
  const deliveryRequest =
    /\b(send|deliver|post|share|publish)\b/i.test(brief) ||
    supportRequest ||
    hasReportLanguage(brief) ||
    (scheduleRequest && summaryRequest);
  const deliveryChannelMentions = deliveryRequest ? mentionedChannels : [];
  const explicitApprovalPosture = params.approvalPosture ?? resolveExplicitApprovalPosture(brief);
  const approvalPostureSource: RequirementSet["approvalPostureSource"] = explicitApprovalPosture
    ? params.approvalPosture
      ? "builder"
      : "brief"
    : "missing";

  if (scheduleRequest) {
    triggers.push(
      createDescriptor({
        id: "schedule",
        label: "Scheduled Trigger",
        detail: "Run on a recurring schedule.",
        contractIds: ["schedule.trigger"],
        connectorIds: ["tools:automation"],
        confidence: "high",
      }),
    );
    if (params.cfg?.cron?.enabled === false) {
      setupGaps.push(
        createGap({
          kind: "setup",
          code: "cron-disabled",
          message: "Enable cron before activating a scheduled workflow.",
          contractIds: ["schedule.trigger"],
          connectorIds: ["tools:automation"],
        }),
      );
    }
    if (!hasExactScheduleTime(brief)) {
      ambiguities.push("A recurring schedule was requested without an exact time.");
      missingDataFields.push("schedule-time");
    }
  }

  if (webhookRequest) {
    triggers.push(
      createDescriptor({
        id: "webhook-ingress",
        label: "Webhook Ingress",
        detail: "Trigger the workflow from an incoming webhook or callback.",
        contractIds: ["ingress.webhook"],
        connectorIds: ["platform:webhook-runtime"],
        confidence: "high",
      }),
    );
    if (!params.cfg?.hooks?.token) {
      setupGaps.push(
        createGap({
          kind: "setup",
          code: "webhook-runtime",
          message: "Configure hooks.token before using webhook-triggered workflows.",
          contractIds: ["ingress.webhook"],
          connectorIds: ["platform:webhook-runtime"],
        }),
      );
    }
  }

  if (supportRequest || (mentionedChatChannelIds.length > 0 && hasInboundChatLanguage(brief))) {
    triggers.push(
      createDescriptor({
        id: "chat-ingress",
        label: "Chat Ingress",
        detail:
          mentionedChatChannelIds.length > 0
            ? `Receive inbound chat messages from ${mentionedChatChannelIds.join(", ")}.`
            : "Receive inbound chat messages.",
        contractIds: ["ingress.chat"],
        connectorIds: mentionedChannels.map((connector) => connector.id),
        confidence: supportRequest ? "high" : "medium",
      }),
    );
    if (supportRequest && mentionedChatChannelIds.length === 0) {
      ambiguities.push("The workflow looks support-oriented, but no inbound channel was named.");
      missingDataFields.push("binding-channel");
      missingInputs.push(
        createGap({
          kind: "input",
          code: "support-channel",
          message: "Choose which channel this support responder should watch.",
          contractIds: ["ingress.chat"],
          connectorIds: [],
        }),
      );
    }
    if (mentionedChatChannelIds.length > 1) {
      ambiguities.push(
        "Multiple chat connectors were mentioned, so ingress and delivery roles may need confirmation.",
      );
    }
  }

  if (emailRequest) {
    inputs.push(
      createDescriptor({
        id: "email-source",
        label: "Email Ingestion",
        detail: "Read messages from a configured Gmail or inbox hook.",
        contractIds: ["ingest.email"],
        connectorIds: ["platform:gmail-hook"],
        confidence: "high",
      }),
    );
    if (!isGmailHookConfigured(params.cfg)) {
      setupGaps.push(
        createGap({
          kind: "setup",
          code: "gmail-hook",
          message: "Configure the Gmail hook before using email as a source.",
          contractIds: ["ingest.email", "ingress.webhook"],
          connectorIds: ["platform:gmail-hook", "platform:webhook-runtime"],
        }),
      );
    }
    sourceConstraints.push(
      createConstraint({
        id: "source:email",
        label: "Email Source",
        detail: "Prefer email-backed ingestion for this workflow.",
        contractIds: ["ingest.email"],
        connectorIds: ["platform:gmail-hook"],
        values: ["email"],
      }),
    );
  }

  if (feedRequest && !newsletterViaEmailRequest) {
    inputs.push(
      createDescriptor({
        id: "feed-source",
        label: "Feed Ingestion",
        detail: "Poll newsletter or feed-style content.",
        contractIds: ["ingest.feed"],
        connectorIds: ["tools:web"],
        confidence: "medium",
      }),
    );
    sourceConstraints.push(
      createConstraint({
        id: "source:feed",
        label: "Feed Source",
        detail: "Use feed or newsletter-backed ingestion.",
        contractIds: ["ingest.feed", "fetch.web"],
        connectorIds: ["tools:web"],
        values: ["feed"],
      }),
    );
  }

  if (fileRequest) {
    inputs.push(
      createDescriptor({
        id: "file-source",
        label: "File Read",
        detail: "Read files or documents from the workspace or local filesystem.",
        contractIds: ["fs.read"],
        connectorIds: ["tools:fs"],
        confidence: "medium",
      }),
    );
    sourceConstraints.push(
      createConstraint({
        id: "source:file",
        label: "File Source",
        detail: "Use local or workspace files as a source.",
        contractIds: ["fs.read"],
        connectorIds: ["tools:fs"],
        values: ["file"],
      }),
    );
  }

  if (memoryRequest) {
    inputs.push(
      createDescriptor({
        id: "memory-source",
        label: "Memory Search",
        detail: "Retrieve saved memory or prior context for this workflow.",
        contractIds: ["memory.search"],
        connectorIds: ["tools:memory"],
        confidence: "medium",
      }),
    );
    sourceConstraints.push(
      createConstraint({
        id: "source:memory",
        label: "Memory Source",
        detail: "Use stored memory or prior context as a source.",
        contractIds: ["memory.search"],
        connectorIds: ["tools:memory"],
        values: ["memory"],
      }),
    );
  }

  if (webRequest) {
    inputs.push(
      createDescriptor({
        id: "web-source",
        label: "Web Fetch",
        detail: "Fetch linked or web-hosted content.",
        contractIds: ["fetch.web"],
        connectorIds: ["tools:web"],
        confidence: researchRequest ? "high" : "medium",
      }),
    );
    sourceConstraints.push(
      createConstraint({
        id: "source:web",
        label: "Web Source",
        detail: "Use web-hosted content or search as a source.",
        contractIds: ["fetch.web"],
        connectorIds: ["tools:web"],
        values: ["web"],
      }),
    );
  }

  if (summaryRequest) {
    transforms.push(
      createDescriptor({
        id: "summary-transform",
        label: "Summarize",
        detail: "Condense source material into a digest or briefing.",
        contractIds: ["transform.summarize"],
        connectorIds: ["platform:core-model"],
        confidence: "high",
      }),
    );
    if (!emailRequest && !feedRequest && !webRequest && !audioRequest) {
      ambiguities.push("A summary was requested without a clearly stated source of material.");
      missingDataFields.push("source-material");
    }
  }

  if (audioRequest) {
    transforms.push(
      createDescriptor({
        id: "transcribe-transform",
        label: "Transcribe",
        detail: "Turn audio or episode content into text.",
        contractIds: ["transform.transcribe"],
        connectorIds: ["tools:media"],
        confidence: "high",
      }),
    );
    actionConstraints.push(
      createConstraint({
        id: "action:transcribe-audio",
        label: "Audio Processing",
        detail: "Process audio or podcast material as part of the workflow.",
        contractIds: ["transform.transcribe"],
        connectorIds: ["tools:media"],
        values: ["audio"],
      }),
    );
  }

  if (nodeRequest) {
    actions.push(
      createDescriptor({
        id: "node-action",
        label: "Node Operate",
        detail: "Run or control a node-backed runtime surface for the workflow.",
        contractIds: ["node.operate"],
        connectorIds: ["tools:nodes"],
        confidence: "medium",
      }),
    );
    actionConstraints.push(
      createConstraint({
        id: "action:node-runtime",
        label: "Node Runtime",
        detail: "Use node-backed runtime execution.",
        contractIds: ["node.operate"],
        connectorIds: ["tools:nodes"],
        values: ["node"],
      }),
    );
  }

  if (sessionSpawnRequest) {
    actions.push(
      createDescriptor({
        id: "session-spawn",
        label: "Session Spawn",
        detail: "Delegate parts of the workflow to spawned sessions or subagents.",
        contractIds: ["session.spawn"],
        connectorIds: ["tools:sessions"],
        confidence: "medium",
      }),
    );
    actionConstraints.push(
      createConstraint({
        id: "action:delegate-subagent",
        label: "Delegation",
        detail: "Delegate part of the workflow to a spawned session or subagent.",
        contractIds: ["session.spawn"],
        connectorIds: ["tools:sessions"],
        values: ["subagent"],
      }),
    );
  }

  if (browserRequest) {
    actions.push(
      createDescriptor({
        id: "browser-action",
        label: "Browser Operate",
        detail: "Use browser-backed actions to open or interact with sites.",
        contractIds: ["browser.operate"],
        connectorIds: ["tools:ui"],
        confidence: hasSocialActionLanguage(text) ? "high" : "medium",
      }),
    );
    actionConstraints.push(
      createConstraint({
        id: /\b(x|twitter)\b/i.test(brief) ? "action:browser-site-x" : "action:browser",
        label: /\b(x|twitter)\b/i.test(brief) ? "X Browser Action" : "Browser Action",
        detail: /\b(x|twitter)\b/i.test(brief)
          ? "Operate on X/Twitter through a browser-backed surface."
          : "Use browser-backed interaction for this workflow.",
        contractIds: ["browser.operate"],
        connectorIds: ["tools:ui"],
        values: /\b(x|twitter)\b/i.test(brief) ? ["browser", "x"] : ["browser"],
      }),
    );
    if (params.cfg?.browser?.enabled === false) {
      setupGaps.push(
        createGap({
          kind: "setup",
          code: "browser-disabled",
          message: "Enable browser control before using browser-backed actions.",
          contractIds: ["browser.operate"],
          connectorIds: ["tools:ui"],
        }),
      );
    }
    if (/\b(x|twitter)\b/i.test(brief) || riskyActionRequest) {
      setupGaps.push(
        createGap({
          kind: "setup",
          code: "browser-site-session",
          message:
            "Connect and authenticate a browser-backed session for the target site before activation.",
          contractIds: ["browser.operate"],
          connectorIds: ["tools:ui"],
        }),
      );
    }
    if (!/\b(x|twitter)\b/i.test(brief) && !/https?:\/\//i.test(brief)) {
      ambiguities.push("Browser-backed actions were requested without a specific site or URL.");
      missingDataFields.push("browser-target");
    }
  }

  if (deliveryRequest) {
    if (summaryRequest) {
      outputs.push(
        createDescriptor({
          id: "report-output",
          label: "Report Delivery",
          detail: "Deliver the result as a digest or briefing.",
          contractIds: ["delivery.report"],
          connectorIds: ["tools:messaging"],
          confidence: "medium",
        }),
      );
    }

    const outputChannels = mentionedChannels;
    if (outputChannels.length > 0 || /\b(send|deliver|post|share).*\b(me|for me)\b/i.test(brief)) {
      outputs.push(
        createDescriptor({
          id: "message-output",
          label: "Message Send",
          detail:
            outputChannels.length > 0
              ? `Send the result through ${outputChannels
                  .map((connector) => connector.source.id)
                  .join(", ")}.`
              : "Send the result to an owner-facing chat destination.",
          contractIds: ["message.send"],
          connectorIds: outputChannels.map((connector) => connector.id),
          confidence: outputChannels.length > 0 ? "high" : "medium",
        }),
      );
    }
    if (
      summaryRequest &&
      outputChannels.length === 0 &&
      !/\b(send|deliver|post|share).*\b(me|for me)\b/i.test(brief) &&
      !supportRequest
    ) {
      ambiguities.push("The workflow implies delivery, but no destination channel was named.");
      missingDataFields.push("delivery-destination");
    }
  }

  if (riskyActionRequest) {
    policies.push(
      createDescriptor({
        id: "approval-policy",
        label: "Approval Gate",
        detail: "Require approval before taking actions on the user's behalf.",
        contractIds: ["approval.request"],
        connectorIds: ["platform:exec-approvals"],
        confidence: "high",
      }),
    );
    if (!hasApprovalRoute(params.cfg)) {
      policyGaps.push(
        createGap({
          kind: "policy",
          code: "approval-route",
          message: "Configure an exec approval route before enabling actions on the user's behalf.",
          contractIds: ["approval.request"],
          connectorIds: ["platform:exec-approvals"],
        }),
      );
    }
    if (!explicitApprovalPosture) {
      ambiguities.push("Risky on-behalf actions were requested without an explicit approval mode.");
      missingDataFields.push("approval-mode");
      policyGaps.push(
        createGap({
          kind: "policy",
          code: "approval-posture",
          message:
            "Choose an approval posture before allowing this workflow to act on your behalf.",
          contractIds: ["approval.request"],
          connectorIds: ["platform:exec-approvals"],
        }),
      );
    }
  }

  if (hasOnBehalfLanguage(text)) {
    constraints.push(
      createDescriptor({
        id: "on-behalf",
        label: "Delegated Action Constraint",
        detail: "The workflow should act on the user's behalf.",
        contractIds: [],
        connectorIds: [],
        confidence: "high",
      }),
    );
  }

  if (hasOutboundEmailDeliveryLanguage(brief)) {
    unsupportedGaps.push(
      createGap({
        kind: "unsupported",
        code: "email-delivery",
        message: "Email delivery is not modeled as a supported outbound connector yet.",
        contractIds: [],
        connectorIds: ["channel:email"],
      }),
    );
  }

  const nonScheduleTriggers = dedupeStrings(
    triggers.filter((entry) => entry.id !== "schedule").map((entry) => entry.id),
  );
  if (nonScheduleTriggers.length > 1) {
    unsupportedGaps.push(
      createGap({
        kind: "unsupported",
        code: "workflow:multi-external-trigger",
        message:
          "This workflow mixes multiple external trigger surfaces. Split webhook and inbound-chat flows into separate agents, or choose one primary trigger.",
        contractIds: dedupeStrings(triggers.flatMap((entry) => entry.contractIds)),
        connectorIds: dedupeStrings(triggers.flatMap((entry) => entry.connectorIds)),
      }),
    );
  }

  if (
    supportRequest &&
    (scheduleRequest ||
      (hasReportLanguage(brief) && deliveryRequest && !hasInboundChatLanguage(brief)))
  ) {
    unsupportedGaps.push(
      createGap({
        kind: "unsupported",
        code: "workflow:mixed-support-briefing",
        message:
          "Support-response flows and scheduled briefing/report flows are not compiled into one workflow yet. Split them into separate agents.",
        contractIds: dedupeStrings([
          ...triggers.flatMap((entry) => entry.contractIds),
          ...outputs.flatMap((entry) => entry.contractIds),
        ]),
        connectorIds: dedupeStrings([
          ...triggers.flatMap((entry) => entry.connectorIds),
          ...outputs.flatMap((entry) => entry.connectorIds),
        ]),
      }),
    );
  }

  if (deliveryChannelMentions.length > 1 && !supportRequest) {
    ambiguities.push(
      "Multiple delivery connectors were mentioned, so the workflow still needs one primary destination.",
    );
    missingDataFields.push("primary-delivery-destination");
    missingInputs.push(
      createGap({
        kind: "input",
        code: "primary-delivery-destination",
        message: "Choose one primary delivery destination for this workflow.",
        contractIds: ["message.send", "delivery.chat", "delivery.report"],
        connectorIds: deliveryChannelMentions.map((connector) => connector.id),
      }),
    );
  }

  for (const connector of mentionedChannels) {
    if (!isChannelConfigured(params.cfg, connector.source.id)) {
      setupGaps.push(
        createGap({
          kind: "setup",
          code: `channel:${connector.source.id}`,
          message: `Configure the ${connector.source.id} channel before using it in this workflow.`,
          contractIds: ["ingress.chat", "message.send"],
          connectorIds: [connector.id],
        }),
      );
    }
  }

  const descriptors = dedupeDescriptors([
    ...triggers,
    ...inputs,
    ...transforms,
    ...decisions,
    ...actions,
    ...outputs,
    ...policies,
    ...constraints,
  ]);
  const contractCoverage = resolveRequestedAndSupportedContracts(registry, descriptors);
  const normalizedUnsupportedGaps = dedupeGaps([
    ...unsupportedGaps,
    ...contractCoverage.unsupportedContractIds.map((contractId) =>
      createGap({
        kind: "unsupported",
        code: `contract:${contractId}`,
        message: `No current connector satisfies the required capability "${contractId}".`,
        contractIds: [contractId],
        connectorIds: [],
      }),
    ),
  ]);
  const normalizedMissingInputs = dedupeGaps(missingInputs);
  const normalizedSetupGaps = dedupeGaps(setupGaps);
  const normalizedPolicyGaps = dedupeGaps(policyGaps);
  const normalizedSourceConstraints = dedupeConstraints(sourceConstraints);
  const normalizedActionConstraints = dedupeConstraints(actionConstraints);
  const normalizedAmbiguities = dedupeStrings(ambiguities);
  const normalizedMissingDataFields = dedupeStrings(missingDataFields).toSorted();
  const unsupportedRequests = dedupeStrings(
    normalizedUnsupportedGaps.map((gap) => gap.message),
  ).toSorted();
  const unsupportedClassifications = normalizedUnsupportedGaps
    .map((gap) => classifyUnsupportedGap(gap))
    .toSorted((left, right) =>
      `${left.kind}:${left.code}`.localeCompare(`${right.kind}:${right.code}`),
    );
  const workflow = resolveWorkflowSummary({
    intentTags,
    triggers,
    inputs,
    transforms,
    actions,
    outputs,
    policies,
    sourceConstraints: normalizedSourceConstraints,
    actionConstraints: normalizedActionConstraints,
    unsupportedGaps: normalizedUnsupportedGaps,
  });
  const confidence = resolveRequirementConfidence({
    descriptorCount: descriptors.length,
    ambiguityCount: normalizedAmbiguities.length,
    missingDataCount: normalizedMissingDataFields.length,
    unsupportedCount: unsupportedRequests.length,
  });

  return {
    brief,
    approvalPosture: explicitApprovalPosture,
    approvalPostureSource,
    confidence,
    workflow,
    intentTags,
    requestedContractIds: contractCoverage.requestedContractIds,
    supportedContractIds: contractCoverage.supportedContractIds,
    unsupportedContractIds: contractCoverage.unsupportedContractIds,
    recommendedConnectorIds: contractCoverage.recommendedConnectorIds,
    triggers: dedupeDescriptors(triggers),
    inputs: dedupeDescriptors(inputs),
    transforms: dedupeDescriptors(transforms),
    decisions: dedupeDescriptors(decisions),
    actions: dedupeDescriptors(actions),
    outputs: dedupeDescriptors(outputs),
    policies: dedupeDescriptors(policies),
    constraints: dedupeDescriptors(constraints),
    sourceConstraints: normalizedSourceConstraints,
    actionConstraints: normalizedActionConstraints,
    missingInputs: normalizedMissingInputs,
    setupGaps: normalizedSetupGaps,
    policyGaps: normalizedPolicyGaps,
    unsupportedGaps: normalizedUnsupportedGaps,
    ambiguities: normalizedAmbiguities,
    unsupportedRequests,
    unsupportedClassifications,
    missingDataFields: normalizedMissingDataFields,
    plannerStatus: resolvePlannerStatusFromGaps({
      missingInputs: normalizedMissingInputs,
      setupGaps: normalizedSetupGaps,
      policyGaps: normalizedPolicyGaps,
      unsupportedGaps: normalizedUnsupportedGaps,
    }),
  };
}
