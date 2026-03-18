import { loadConfig, type OpenClawConfig } from "../../config/config.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import {
  applyRequirementGaps,
  applyRequirementQuestions,
  buildRequirementPlannerResult,
  type PlannedSetupTask,
  type PlannedVerificationResult,
  buildRequirementSet,
  type PlannedIntegrationInstance,
  type RequirementPlannerSelection,
  type RequirementGap,
  type RequirementSet,
} from "../capabilities/index.js";
import type { PlannerStatus } from "../capabilities/schema.js";
import { compileAgentBlueprintPlan, type AgentBlueprintPlan } from "./compiler.js";
import {
  dailyBriefingBlueprint,
  researchAgentBlueprint,
  supportResponderBlueprint,
} from "./examples.js";
import type { LoadedAgentBlueprint } from "./files.js";
import { applyAgentBlueprint, type AgentBlueprintApplyResult } from "./materialize.js";
import { getAgentBlueprintTemplate } from "./registry.js";
import type { AgentBlueprintBundle } from "./schema.js";

const DIRECT_DELIVERY_CHANNELS = new Set(["telegram", "discord", "signal", "whatsapp"]);
const WEEKDAY_CRON = "1-5";
const DEFAULT_DIRECT_TARGET = "@me";

const DAY_SPECS: Array<{ pattern: RegExp; day: string; label: string }> = [
  { pattern: /\bmonday\b/i, day: "1", label: "Mondays" },
  { pattern: /\btuesday\b/i, day: "2", label: "Tuesdays" },
  { pattern: /\bwednesday\b/i, day: "3", label: "Wednesdays" },
  { pattern: /\bthursday\b/i, day: "4", label: "Thursdays" },
  { pattern: /\bfriday\b/i, day: "5", label: "Fridays" },
  { pattern: /\bsaturday\b/i, day: "6", label: "Saturdays" },
  { pattern: /\bsunday\b/i, day: "0", label: "Sundays" },
];

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

export type AgentBlueprintBuilderConfidence = "low" | "medium" | "high";

export type AgentBlueprintBuilderQuestion = {
  id: "binding-channel" | "delivery-target" | "schedule";
  prompt: string;
  required: boolean;
};

export type AgentBlueprintBuilderDraftSummary = {
  brief: string;
  templateId: string;
  displayName: string;
  confidence: AgentBlueprintBuilderConfidence;
  plannerStatus: PlannerStatus;
  reasons: string[];
  assumptions: string[];
  questions: AgentBlueprintBuilderQuestion[];
  ready: boolean;
  requirements: RequirementSet;
  planning: {
    selections: RequirementPlannerSelection[];
    integrations: PlannedIntegrationInstance[];
    setupTasks: PlannedSetupTask[];
    verifications: PlannedVerificationResult[];
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

export type AgentBlueprintBuilderDraft = AgentBlueprintBuilderDraftSummary & {
  bundle: AgentBlueprintBundle;
};

export type AgentBlueprintBuilderPlan = {
  draft: AgentBlueprintBuilderDraftSummary;
  plan: AgentBlueprintPlan;
};

export type AgentBlueprintBuilderApplyResult = {
  draft: AgentBlueprintBuilderDraftSummary;
  result: AgentBlueprintApplyResult;
};

type TemplateSelection = {
  templateId: string;
  confidence: AgentBlueprintBuilderConfidence;
  reasons: string[];
};

type InferredSchedule = {
  cron: string;
  description: string;
  assumed: boolean;
};

type InferredDelivery = {
  channel?: string;
  to?: string;
  assumptions: string[];
  questions: AgentBlueprintBuilderQuestion[];
};

type InferredBindings = {
  channels: string[];
  assumptions: string[];
  questions: AgentBlueprintBuilderQuestion[];
};

function containsAny(text: string, patterns: Array<string | RegExp>): boolean {
  return patterns.some((pattern) =>
    typeof pattern === "string" ? text.includes(pattern) : pattern.test(text),
  );
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function extractRequestedName(brief: string): string | null {
  const match = brief.match(
    /\b(?:call|name)\s+(?:it|this|the (?:agent|bot|assistant))\s+"?([a-z0-9][a-z0-9 _-]{1,39})"?/i,
  );
  if (match?.[1]) {
    return titleCase(match[1].trim());
  }
  const namedMatch = brief.match(/\bnamed\s+"?([a-z0-9][a-z0-9 _-]{1,39})"?/i);
  if (namedMatch?.[1]) {
    return titleCase(namedMatch[1].trim());
  }
  return null;
}

function slugifyName(value: string): string {
  return normalizeAgentId(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, ""),
  );
}

function selectTemplate(
  requirements: RequirementSet,
  forcedTemplateId?: string,
): TemplateSelection {
  if (forcedTemplateId) {
    const forced = getAgentBlueprintTemplate(forcedTemplateId);
    if (!forced) {
      throw new Error(`Unknown builder template "${forcedTemplateId}".`);
    }
    return {
      templateId: forcedTemplateId,
      confidence: "high",
      reasons: [`Template forced to ${forced.manifest.displayName}.`],
    };
  }

  const scores = new Map<string, number>([
    ["personal-assistant", 1],
    ["daily-briefing", 0],
    ["support-responder", 0],
    ["research-agent", 0],
  ]);
  const reasons = new Map<string, string[]>(
    Array.from(scores.keys()).map((templateId) => [templateId, []]),
  );

  const addScore = (templateId: string, amount: number, reason: string) => {
    scores.set(templateId, (scores.get(templateId) ?? 0) + amount);
    reasons.get(templateId)?.push(reason);
  };

  const hasSupport = requirements.intentTags.includes("support");
  if (hasSupport) {
    addScore("support-responder", 5, "Detected an inbound support or customer-response workflow.");
  }

  const hasBriefing =
    requirements.requestedContractIds.includes("schedule.trigger") ||
    requirements.transforms.some((entry) => entry.contractIds.includes("transform.summarize")) ||
    requirements.inputs.some((entry) =>
      entry.contractIds.some(
        (contractId) => contractId === "ingest.email" || contractId === "ingest.feed",
      ),
    );
  if (hasBriefing) {
    addScore("daily-briefing", 4, "Detected a scheduled digest, briefing, or summary workflow.");
  }
  if (requirements.requestedContractIds.includes("schedule.trigger")) {
    addScore("daily-briefing", 2, "Matched recurring schedule language.");
  }

  const hasResearch =
    requirements.intentTags.includes("research") ||
    requirements.inputs.some((entry) => entry.contractIds.includes("fetch.web"));
  if (hasResearch) {
    addScore("research-agent", 4, "Detected research, analysis, or web-synthesis requirements.");
  }

  const hasPersonal =
    requirements.intentTags.includes("assistant") ||
    requirements.actions.some((entry) => entry.contractIds.includes("browser.operate"));
  if (hasPersonal) {
    addScore("personal-assistant", 3, "Detected a general assistant or operator workflow.");
  }

  const ranked = Array.from(scores.entries()).toSorted((a, b) => b[1] - a[1]);
  const [winnerId, winnerScore] = ranked[0] ?? ["personal-assistant", 1];
  const runnerUpScore = ranked[1]?.[1] ?? 0;
  const margin = winnerScore - runnerUpScore;
  const confidence: AgentBlueprintBuilderConfidence =
    winnerScore >= 4 && margin >= 2 ? "high" : winnerScore >= 2 ? "medium" : "low";

  return {
    templateId: winnerId,
    confidence,
    reasons: reasons.get(winnerId)?.length
      ? (reasons.get(winnerId) ?? [])
      : ["No strong template signals were found; defaulted to Personal Assistant."],
  };
}

function detectChannels(brief: string): string[] {
  return CHANNEL_PATTERNS.filter((entry) => entry.pattern.test(brief))
    .map((entry) => entry.channel)
    .filter((channel, index, all) => all.indexOf(channel) === index);
}

function parseTime(brief: string): { hour: number; minute: number; assumed: boolean } | null {
  const match = brief.match(/\b(?:at|@)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (match) {
    let hour = Number.parseInt(match[1] ?? "0", 10);
    const minute = Number.parseInt(match[2] ?? "0", 10);
    const meridian = match[3]?.toLowerCase();
    if (Number.isNaN(hour) || Number.isNaN(minute)) {
      return null;
    }
    if (meridian === "pm" && hour < 12) {
      hour += 12;
    }
    if (meridian === "am" && hour === 12) {
      hour = 0;
    }
    return { hour, minute, assumed: false };
  }

  if (/\bmorning\b/i.test(brief)) {
    return { hour: 9, minute: 0, assumed: true };
  }
  if (/\bafternoon\b/i.test(brief)) {
    return { hour: 14, minute: 0, assumed: true };
  }
  if (/\b(evening|tonight)\b/i.test(brief)) {
    return { hour: 18, minute: 0, assumed: true };
  }
  if (/\bnight\b/i.test(brief)) {
    return { hour: 21, minute: 0, assumed: true };
  }
  return null;
}

function formatTime(hour: number, minute: number): string {
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minute.toString().padStart(2, "0")} ${suffix}`;
}

function inferSchedule(brief: string): InferredSchedule | null {
  const text = brief.toLowerCase();
  const scheduleRequested = containsAny(text, [
    "daily",
    "every day",
    "every morning",
    "each morning",
    "weekly",
    "weekdays",
    "weekday",
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
  ]);
  if (!scheduleRequested) {
    return null;
  }

  const time = parseTime(brief) ?? { hour: 9, minute: 0, assumed: true };
  const explicitDays = DAY_SPECS.filter((entry) => entry.pattern.test(brief));
  const daySpec = /\bweekday(s)?\b/i.test(brief)
    ? WEEKDAY_CRON
    : explicitDays.length > 0
      ? explicitDays.map((entry) => entry.day).join(",")
      : /\bweekly\b/i.test(brief)
        ? "1"
        : "*";
  const dayLabel =
    daySpec === WEEKDAY_CRON
      ? "Weekdays"
      : explicitDays.length > 0
        ? explicitDays.map((entry) => entry.label).join(", ")
        : /\bweekly\b/i.test(brief)
          ? "Mondays"
          : "Daily";

  return {
    cron: `${time.minute} ${time.hour} * * ${daySpec}`,
    description: `${dayLabel} at ${formatTime(time.hour, time.minute)}`,
    assumed: time.assumed || (/\bweekly\b/i.test(brief) && explicitDays.length === 0),
  };
}

function inferDelivery(brief: string, templateId: string): InferredDelivery {
  if (templateId !== "daily-briefing") {
    return { assumptions: [], questions: [] };
  }

  const assumptions: string[] = [];
  const questions: AgentBlueprintBuilderQuestion[] = [];
  const deliveryMatch = brief.match(
    /\b(?:send|deliver|post|publish|share)[^.!?\n]*?\b(?:to|into|in)\s+(?:my\s+)?(discord|matrix|msteams|signal|slack|telegram|whatsapp)\b(?:\s+(?:channel|dm|group|chat))?\s*([#@][\w./-]+)?/i,
  );
  if (deliveryMatch?.[1]) {
    const channel = deliveryMatch[1].toLowerCase();
    const to = deliveryMatch[2];
    if (to) {
      return { channel, to, assumptions, questions };
    }
    if (DIRECT_DELIVERY_CHANNELS.has(channel)) {
      assumptions.push(`Defaulted ${channel} delivery to ${DEFAULT_DIRECT_TARGET}.`);
      return { channel, to: DEFAULT_DIRECT_TARGET, assumptions, questions };
    }
    questions.push({
      id: "delivery-target",
      prompt: `Which ${channel} destination should receive the digest?`,
      required: true,
    });
    return { channel, assumptions, questions };
  }

  if (/\b(send|deliver|post).*\b(me|for me)\b/i.test(brief)) {
    assumptions.push("Defaulted digest delivery to Telegram @me.");
    return {
      channel: "telegram",
      to: DEFAULT_DIRECT_TARGET,
      assumptions,
      questions,
    };
  }

  assumptions.push("Defaulted digest delivery to Telegram @me.");
  return {
    channel: "telegram",
    to: DEFAULT_DIRECT_TARGET,
    assumptions,
    questions,
  };
}

function inferBindings(brief: string, templateId: string): InferredBindings {
  const channels = detectChannels(brief).filter((channel) => channel !== "email");
  const assumptions: string[] = [];
  const questions: AgentBlueprintBuilderQuestion[] = [];

  if (templateId === "support-responder") {
    if (channels.length === 0) {
      questions.push({
        id: "binding-channel",
        prompt: "Which channel should this support responder watch?",
        required: true,
      });
      return { channels: [], assumptions, questions };
    }
    assumptions.push(
      "Used channel-level bindings. Room-specific routing can be refined later if needed.",
    );
    return { channels, assumptions, questions };
  }

  if (templateId === "personal-assistant" || templateId === "research-agent") {
    return { channels: channels.slice(0, 1), assumptions, questions };
  }

  return { channels: [], assumptions, questions };
}

function inferSourceChannels(brief: string): string[] {
  const sources: string[] = [];
  if (/\b(email|emails|gmail|mailbox|inbox)\b/i.test(brief)) {
    sources.push("gmail");
  }
  if (/\bslack\b/i.test(brief) && !sources.includes("slack")) {
    sources.push("slack");
  }
  if (/\btelegram\b/i.test(brief) && !sources.includes("telegram")) {
    sources.push("telegram");
  }
  if (/\bdiscord\b/i.test(brief) && !sources.includes("discord")) {
    sources.push("discord");
  }
  return sources;
}

function withAgentIdentity(
  bundle: AgentBlueprintBundle,
  requestedName: string | null,
): { bundle: AgentBlueprintBundle; assumptions: string[] } {
  if (!requestedName) {
    return { bundle, assumptions: [] };
  }
  const next = structuredClone(bundle);
  next.agent.name = requestedName;
  if (next.agent.agentId === "main") {
    next.agent.agentId = slugifyName(requestedName) || "assistant";
  } else {
    next.agent.agentId = slugifyName(requestedName) || next.agent.agentId;
  }
  return {
    bundle: next,
    assumptions: [`Renamed the agent to ${requestedName}.`],
  };
}

function ensureBuilderOwnedAgent(bundle: AgentBlueprintBundle): {
  bundle: AgentBlueprintBundle;
  assumptions: string[];
} {
  if (bundle.agent.agentId !== "main") {
    return { bundle, assumptions: [] };
  }
  const next = structuredClone(bundle);
  next.agent.agentId = "personal-assistant";
  next.agent.name = next.manifest.displayName;
  return {
    bundle: next,
    assumptions: ["Created a dedicated agent instead of overwriting the default main agent."],
  };
}

function customizeDailyBriefing(
  bundle: AgentBlueprintBundle,
  brief: string,
): {
  bundle: AgentBlueprintBundle;
  assumptions: string[];
  questions: AgentBlueprintBuilderQuestion[];
} {
  const next = structuredClone(bundle);
  const assumptions: string[] = [];
  const questions: AgentBlueprintBuilderQuestion[] = [];
  const schedule = inferSchedule(brief);
  if (schedule) {
    next.automation = {
      schedules: [
        {
          name: "builder-schedule",
          schedule: schedule.cron,
          purpose: "Run the requested digest cadence.",
        },
      ],
    };
    if (schedule.assumed) {
      assumptions.push(
        `Used ${schedule.description} because the brief did not specify an exact schedule.`,
      );
    }
  } else {
    assumptions.push("Kept the starter weekday morning schedule.");
  }

  const delivery = inferDelivery(brief, "daily-briefing");
  questions.push(...delivery.questions);
  assumptions.push(...delivery.assumptions);
  next.delivery = {
    mode: "digest",
    format: "brief",
    ...(delivery.channel || delivery.to
      ? {
          target: {
            ...(delivery.channel ? { channel: delivery.channel } : {}),
            ...(delivery.to ? { to: delivery.to } : {}),
          },
        }
      : {}),
  };

  const sourceChannels = inferSourceChannels(brief);
  if (sourceChannels.length > 0) {
    next.ingress = {
      interactionMode: "scheduled",
      sources: sourceChannels.map((channel) => ({ kind: "channel" as const, value: channel })),
    };
    assumptions.push(`Used sources inferred from the brief: ${sourceChannels.join(", ")}.`);
  }

  return { bundle: next, assumptions, questions };
}

function customizeSupportResponder(
  bundle: AgentBlueprintBundle,
  brief: string,
): {
  bundle: AgentBlueprintBundle;
  assumptions: string[];
  questions: AgentBlueprintBuilderQuestion[];
} {
  const next = structuredClone(bundle);
  const bindings = inferBindings(brief, "support-responder");
  if (bindings.channels.length > 0) {
    next.ingress = {
      interactionMode: "bound-channel",
      bindings: bindings.channels.map((channel) => ({ channel })),
    };
  }
  return { bundle: next, assumptions: bindings.assumptions, questions: bindings.questions };
}

function customizePersonalAgent(
  bundle: AgentBlueprintBundle,
  brief: string,
): {
  bundle: AgentBlueprintBundle;
  assumptions: string[];
  questions: AgentBlueprintBuilderQuestion[];
} {
  const next = structuredClone(bundle);
  const bindings = inferBindings(brief, "personal-assistant");
  if (bindings.channels.length > 0) {
    next.ingress = {
      interactionMode: "direct",
      bindings: bindings.channels.map((channel) => ({ channel })),
    };
  }
  return { bundle: next, assumptions: bindings.assumptions, questions: bindings.questions };
}

function customizeResearchAgent(
  bundle: AgentBlueprintBundle,
  brief: string,
): {
  bundle: AgentBlueprintBundle;
  assumptions: string[];
  questions: AgentBlueprintBuilderQuestion[];
} {
  const next = structuredClone(bundle);
  const bindings = inferBindings(brief, "research-agent");
  if (bindings.channels.length > 0) {
    next.ingress = {
      interactionMode: "direct",
      bindings: bindings.channels.map((channel) => ({ channel })),
    };
  }
  if (/\bno subagents\b/i.test(brief)) {
    next.runtime.subagents = {
      enabled: false,
    };
  }
  return { bundle: next, assumptions: bindings.assumptions, questions: bindings.questions };
}

function summarizeDeliveryTarget(bundle: AgentBlueprintBundle): string | null {
  const target = bundle.delivery?.target;
  if (!target) {
    return null;
  }
  const parts = [target.channel, target.to, target.session].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(" ") : null;
}

function summarizeSchedule(bundle: AgentBlueprintBundle): string | null {
  const first = bundle.automation?.schedules?.[0];
  if (!first) {
    return null;
  }
  return `${first.name}: ${first.schedule}`;
}

function summarizeIngressChannels(bundle: AgentBlueprintBundle): string[] {
  return (bundle.ingress?.bindings ?? []).map((binding) => binding.channel);
}

function summarizeSourceChannels(bundle: AgentBlueprintBundle): string[] {
  return (bundle.ingress?.sources ?? []).map((source) => source.value);
}

function createBundleSetupGaps(
  bundle: AgentBlueprintBundle,
  cfg?: OpenClawConfig,
): RequirementGap[] {
  const gaps: RequirementGap[] = [];
  const channels = new Set<string>();

  for (const binding of bundle.ingress?.bindings ?? []) {
    if (binding.channel && binding.channel !== "default") {
      channels.add(binding.channel);
    }
  }
  const deliveryChannel = bundle.delivery?.target?.channel;
  if (deliveryChannel && deliveryChannel !== "default") {
    channels.add(deliveryChannel);
  }

  for (const channel of channels) {
    const entry = (cfg?.channels as Record<string, unknown> | undefined)?.[channel];
    if (!entry || typeof entry !== "object") {
      gaps.push({
        kind: "setup",
        code: `channel:${channel}`,
        message: `Configure the ${channel} channel before applying this agent.`,
        contractIds: ["ingress.chat", "message.send"],
        connectorIds: [`channel:${channel}`],
      });
    }
  }

  const sources = summarizeSourceChannels(bundle);
  if (sources.includes("gmail")) {
    const gmail = cfg?.hooks?.gmail;
    if (!(cfg?.hooks?.token && gmail?.account && gmail?.topic && gmail?.pushToken)) {
      gaps.push({
        kind: "setup",
        code: "gmail-hook",
        message: "Configure the Gmail hook before using Gmail as a builder source.",
        contractIds: ["ingest.email", "ingress.webhook"],
        connectorIds: ["platform:gmail-hook", "platform:webhook-runtime"],
      });
    }
  }

  if (bundle.automation?.schedules?.length && cfg?.cron?.enabled === false) {
    gaps.push({
      kind: "setup",
      code: "cron-disabled",
      message: "Enable cron before applying a scheduled builder workflow.",
      contractIds: ["schedule.trigger"],
      connectorIds: ["tools:automation"],
    });
  }

  return gaps;
}

function createBuilderLoadedBlueprint(draft: AgentBlueprintBuilderDraft): LoadedAgentBlueprint {
  return {
    kind: "builder",
    source: draft.templateId,
    format: null,
    bundle: draft.bundle,
  };
}

export function buildAgentBlueprintDraft(params: {
  brief: string;
  templateId?: string;
  cfg?: OpenClawConfig;
}): AgentBlueprintBuilderDraft {
  const brief = params.brief.trim();
  if (!brief) {
    throw new Error("A builder brief is required.");
  }

  const extractedRequirements = buildRequirementSet({
    brief,
    cfg: params.cfg,
  });
  const selection = selectTemplate(extractedRequirements, params.templateId);
  const baseTemplate =
    getAgentBlueprintTemplate(selection.templateId) ??
    (() => {
      throw new Error(`Unknown builder template "${selection.templateId}".`);
    })();

  let bundle = structuredClone(baseTemplate);
  const assumptions: string[] = [];
  const questions: AgentBlueprintBuilderQuestion[] = [];

  const owned = ensureBuilderOwnedAgent(bundle);
  bundle = owned.bundle;
  assumptions.push(...owned.assumptions);

  const renamed = withAgentIdentity(bundle, extractRequestedName(brief));
  bundle = renamed.bundle;
  assumptions.push(...renamed.assumptions);

  if (selection.templateId === dailyBriefingBlueprint.manifest.templateId) {
    const customized = customizeDailyBriefing(bundle, brief);
    bundle = customized.bundle;
    assumptions.push(...customized.assumptions);
    questions.push(...customized.questions);
  } else if (selection.templateId === supportResponderBlueprint.manifest.templateId) {
    const customized = customizeSupportResponder(bundle, brief);
    bundle = customized.bundle;
    assumptions.push(...customized.assumptions);
    questions.push(...customized.questions);
  } else if (selection.templateId === researchAgentBlueprint.manifest.templateId) {
    const customized = customizeResearchAgent(bundle, brief);
    bundle = customized.bundle;
    assumptions.push(...customized.assumptions);
    questions.push(...customized.questions);
  } else {
    const customized = customizePersonalAgent(bundle, brief);
    bundle = customized.bundle;
    assumptions.push(...customized.assumptions);
    questions.push(...customized.questions);
  }

  const uniqueQuestions = questions.filter(
    (question, index, all) => all.findIndex((entry) => entry.id === question.id) === index,
  );
  const requirements = applyRequirementGaps(
    applyRequirementQuestions(extractedRequirements, uniqueQuestions),
    {
      setupGaps: createBundleSetupGaps(bundle, params.cfg),
    },
  );
  const planning = buildRequirementPlannerResult({
    requirements,
    cfg: params.cfg,
  });

  return {
    brief,
    templateId: selection.templateId,
    displayName: bundle.manifest.displayName,
    confidence: selection.confidence,
    plannerStatus: requirements.plannerStatus,
    reasons: selection.reasons,
    assumptions,
    questions: uniqueQuestions,
    ready: requirements.plannerStatus === "ready",
    requirements,
    planning: {
      selections: planning.selections,
      integrations: planning.integrations,
      setupTasks: planning.setupTasks,
      verifications: planning.verifications,
    },
    extracted: {
      agentId: normalizeAgentId(bundle.agent.agentId),
      name: bundle.agent.name,
      ingressChannels: summarizeIngressChannels(bundle),
      sourceChannels: summarizeSourceChannels(bundle),
      deliveryTarget: summarizeDeliveryTarget(bundle),
      schedule: summarizeSchedule(bundle),
    },
    bundle,
  };
}

function stripBundleFromDraft(
  draft: AgentBlueprintBuilderDraft,
): AgentBlueprintBuilderDraftSummary {
  const { bundle: _bundle, ...summary } = draft;
  return summary;
}

export async function compileAgentBlueprintBuilderPlan(params: {
  brief: string;
  templateId?: string;
  cfg?: OpenClawConfig;
}): Promise<AgentBlueprintBuilderPlan> {
  const draft = buildAgentBlueprintDraft({
    ...params,
    cfg: params.cfg,
  });
  const plan = await compileAgentBlueprintPlan({
    bundle: draft.bundle,
    cfg: params.cfg,
    source: {
      kind: "builder",
      value: draft.templateId,
      format: null,
    },
  });
  return {
    draft: stripBundleFromDraft(draft),
    plan,
  };
}

export async function applyAgentBlueprintBuilderPlan(params: {
  brief: string;
  templateId?: string;
  cfg?: OpenClawConfig;
}): Promise<AgentBlueprintBuilderApplyResult> {
  const cfg = params.cfg ?? loadConfig();
  const draft = buildAgentBlueprintDraft({
    ...params,
    cfg,
  });
  if (draft.plannerStatus !== "ready") {
    const blockers = [
      ...draft.requirements.missingInputs,
      ...draft.requirements.setupGaps,
      ...draft.requirements.policyGaps,
      ...draft.requirements.unsupportedGaps,
    ]
      .map((gap) => gap.message)
      .join(" ");
    throw new Error(`Builder planner is ${draft.plannerStatus}. ${blockers}`.trim());
  }
  const plan = await compileAgentBlueprintPlan({
    bundle: draft.bundle,
    cfg,
    source: {
      kind: "builder",
      value: draft.templateId,
      format: null,
    },
  });
  if (plan.status !== "ready") {
    const reasons = plan.issues.map((issue) => issue.message).join(" ");
    throw new Error(`Builder plan is not ready to apply. ${reasons}`);
  }
  const result = await applyAgentBlueprint({
    loaded: createBuilderLoadedBlueprint(draft),
  });
  return {
    draft: stripBundleFromDraft(draft),
    result,
  };
}

export const __testing = {
  customizeDailyBriefing,
  inferBindings,
  inferDelivery,
  inferSchedule,
  selectTemplate,
};
