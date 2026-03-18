import type { OpenClawConfig } from "../../config/config.js";
import { hasConfiguredExecApprovalDmRoute } from "../../infra/exec-approval-surface.js";
import { buildOpenClawCapabilityRegistry } from "./openclaw.js";
import { listConnectorsForContract } from "./registry.js";
import type { CapabilityRegistry, PlannerStatus } from "./schema.js";

export const REQUIREMENT_CONFIDENCES = ["low", "medium", "high"] as const;

export type RequirementConfidence = (typeof REQUIREMENT_CONFIDENCES)[number];

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

export type RequirementSet = {
  brief: string;
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
  missingInputs: RequirementGap[];
  setupGaps: RequirementGap[];
  policyGaps: RequirementGap[];
  unsupportedGaps: RequirementGap[];
  plannerStatus: PlannerStatus;
};

type RequirementExtractionParams = {
  brief: string;
  cfg?: OpenClawConfig;
  registry?: CapabilityRegistry;
};

type RequirementGapPatch = Partial<
  Pick<RequirementSet, "missingInputs" | "setupGaps" | "policyGaps" | "unsupportedGaps">
>;

const CHANNEL_PATTERNS: Array<{ channel: string; pattern: RegExp }> = [
  { channel: "discord", pattern: /\bdiscord\b/i },
  { channel: "email", pattern: /\b(email|emails|gmail|mailbox|inbox)\b/i },
  { channel: "matrix", pattern: /\bmatrix\b/i },
  { channel: "slack", pattern: /\bslack\b/i },
  { channel: "signal", pattern: /\bsignal\b/i },
  { channel: "telegram", pattern: /\btelegram\b/i },
  { channel: "msteams", pattern: /\b(microsoft teams|ms teams|msteams)\b/i },
  { channel: "whatsapp", pattern: /\b(whatsapp|whats app)\b/i },
];

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

function detectMentionedChannels(brief: string): string[] {
  return CHANNEL_PATTERNS.filter((entry) => entry.pattern.test(brief))
    .map((entry) => entry.channel)
    .filter((channel, index, all) => all.indexOf(channel) === index);
}

function hasScheduleLanguage(brief: string): boolean {
  return /\b(daily|every day|each day|every morning|each morning|weekly|weekday|weekdays|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(
    brief,
  );
}

function hasSummaryLanguage(brief: string): boolean {
  return /\b(summariz(?:e|es|ed|ing)?|summary|digest|briefing|brief|recap)\b/i.test(brief);
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

function hasWebLanguage(brief: string): boolean {
  return /https?:\/\/|\b(web|website|url|page|pages|article|articles|link|links)\b/i.test(brief);
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

function isChannelConfigured(cfg: OpenClawConfig | undefined, channel: string): boolean {
  const channels = cfg?.channels as Record<string, unknown> | undefined;
  if (!channels) {
    return false;
  }
  const entry = channels[channel];
  return Boolean(entry && typeof entry === "object");
}

function isGmailHookConfigured(cfg: OpenClawConfig | undefined): boolean {
  const gmail = cfg?.hooks?.gmail;
  return Boolean(cfg?.hooks?.token && gmail?.account && gmail?.topic && gmail?.pushToken);
}

function hasApprovalRoute(cfg: OpenClawConfig | undefined): boolean {
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

  const registry = params.registry ?? buildOpenClawCapabilityRegistry({ includeCatalog: false });
  const text = brief.toLowerCase();
  const mentionedChannels = detectMentionedChannels(brief);
  const intentTags = dedupeStrings(
    [
      hasAssistantLanguage(text) ? "assistant" : null,
      hasAudioLanguage(text) ? "audio" : null,
      hasFeedLanguage(text) ? "feed" : null,
      /\b(email|emails|gmail|mailbox|inbox)\b/i.test(brief) ? "email" : null,
      hasResearchLanguage(text) ? "research" : null,
      hasScheduleLanguage(text) ? "scheduled" : null,
      hasSupportLanguage(text) ? "support" : null,
      hasSummaryLanguage(text) ? "summary" : null,
      hasBrowserLanguage(text) || hasSocialActionLanguage(text) ? "browser" : null,
      hasSocialActionLanguage(text) ? "social-action" : null,
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
  const missingInputs: RequirementGap[] = [];
  const setupGaps: RequirementGap[] = [];
  const policyGaps: RequirementGap[] = [];
  const unsupportedGaps: RequirementGap[] = [];

  const supportRequest = hasSupportLanguage(text);
  const scheduleRequest = hasScheduleLanguage(text);
  const summaryRequest = hasSummaryLanguage(text);
  const researchRequest = hasResearchLanguage(text);
  const emailRequest = /\b(email|emails|gmail|mailbox|inbox)\b/i.test(brief);
  const feedRequest = hasFeedLanguage(text);
  const webRequest = hasWebLanguage(text) || researchRequest;
  const audioRequest = hasAudioLanguage(text);
  const browserRequest =
    hasBrowserLanguage(text) || hasSocialActionLanguage(text) || /\b(x|twitter)\b/i.test(brief);
  const riskyActionRequest =
    hasOnBehalfLanguage(text) ||
    /\b(follow|comment|post|retweet|like)\b/i.test(brief) ||
    (/\breply\b/i.test(brief) && hasOnBehalfLanguage(text));
  const deliveryRequest =
    /\b(send|deliver|post|share|publish)\b/i.test(brief) || summaryRequest || supportRequest;

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
  }

  if (
    supportRequest ||
    (mentionedChannels.length > 0 && /\b(bot|responder|questions?)\b/i.test(brief))
  ) {
    triggers.push(
      createDescriptor({
        id: "chat-ingress",
        label: "Chat Ingress",
        detail:
          mentionedChannels.length > 0
            ? `Receive inbound chat messages from ${mentionedChannels
                .filter((channel) => channel !== "email")
                .join(", ")}.`
            : "Receive inbound chat messages.",
        contractIds: ["ingress.chat"],
        connectorIds: mentionedChannels
          .filter((channel) => channel !== "email")
          .map((channel) => `channel:${channel}`),
        confidence: supportRequest ? "high" : "medium",
      }),
    );
    if (supportRequest && mentionedChannels.filter((channel) => channel !== "email").length === 0) {
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
  }

  if (feedRequest) {
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

    const outputChannels = mentionedChannels.filter((channel) => channel !== "email");
    if (outputChannels.length > 0 || /\b(send|deliver|post|share).*\b(me|for me)\b/i.test(brief)) {
      outputs.push(
        createDescriptor({
          id: "message-output",
          label: "Message Send",
          detail:
            outputChannels.length > 0
              ? `Send the result through ${outputChannels.join(", ")}.`
              : "Send the result to an owner-facing chat destination.",
          contractIds: ["message.send"],
          connectorIds: outputChannels.map((channel) => `channel:${channel}`),
          confidence: outputChannels.length > 0 ? "high" : "medium",
        }),
      );
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

  if (/\b(email|mail)\b/i.test(brief) && /\b(send|deliver|post)\b/i.test(brief) && !emailRequest) {
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

  for (const channel of mentionedChannels.filter((value) => value !== "email")) {
    const connectorId = `channel:${channel}`;
    if (!registry.connectorsById.has(connectorId)) {
      unsupportedGaps.push(
        createGap({
          kind: "unsupported",
          code: `connector:${channel}`,
          message: `No current connector matches the requested ${channel} surface.`,
          contractIds: ["message.send", "ingress.chat"],
          connectorIds: [connectorId],
        }),
      );
      continue;
    }
    if (!isChannelConfigured(params.cfg, channel)) {
      setupGaps.push(
        createGap({
          kind: "setup",
          code: `channel:${channel}`,
          message: `Configure the ${channel} channel before using it in this workflow.`,
          contractIds: ["ingress.chat", "message.send"],
          connectorIds: [connectorId],
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

  return {
    brief,
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
    missingInputs: normalizedMissingInputs,
    setupGaps: normalizedSetupGaps,
    policyGaps: normalizedPolicyGaps,
    unsupportedGaps: normalizedUnsupportedGaps,
    plannerStatus: resolvePlannerStatusFromGaps({
      missingInputs: normalizedMissingInputs,
      setupGaps: normalizedSetupGaps,
      policyGaps: normalizedPolicyGaps,
      unsupportedGaps: normalizedUnsupportedGaps,
    }),
  };
}
