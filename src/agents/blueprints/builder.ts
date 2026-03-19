import { loadConfig, type OpenClawConfig } from "../../config/config.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import {
  applyRequirementGaps,
  applyRequirementQuestions,
  buildRequirementPlannerResult,
  hydrateRequirementPlannerIntegrationState,
  hydrateRequirementPlannerVerificationState,
  type PlannedSetupTask,
  type PlannedVerificationResult,
  buildRequirementSet,
  type PlannedIntegrationInstance,
  runRequirementPlannerLiveVerification,
  type RequirementPlannerResult,
  type RequirementPlannerVerificationRun,
  type RequirementPlannerSelection,
  type RequirementGap,
  type RequirementSet,
  writePlannerIntegrations,
} from "../capabilities/index.js";
import type { PlannerStatus } from "../capabilities/schema.js";
import { compileAgentBlueprintPlan, type AgentBlueprintPlan } from "./compiler.js";
import { researchAgentBlueprint } from "./examples.js";
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
    alternatives: RequirementPlannerResult["alternatives"];
    variants: RequirementPlannerResult["variants"];
    integrations: PlannedIntegrationInstance[];
    setupTasks: PlannedSetupTask[];
    verifications: PlannedVerificationResult[];
    topology: RequirementPlannerResult["topology"];
    graph: AgentBlueprintBuilderRuntimeGraphSummary;
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
  runtimeGraph: AgentBlueprintBuilderRuntimeGraphDraft;
};

export type AgentBlueprintBuilderRuntimeGraphNodeSummary = {
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
};

export type AgentBlueprintBuilderRuntimeGraphEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  kind: "delegates" | "reports";
  label: string;
};

export type AgentBlueprintBuilderRuntimeGraphSummary = {
  mode: RequirementPlannerResult["topology"]["mode"];
  entryNodeId: string;
  nodes: AgentBlueprintBuilderRuntimeGraphNodeSummary[];
  edges: AgentBlueprintBuilderRuntimeGraphEdge[];
};

type AgentBlueprintBuilderRuntimeGraphNodeDraft = AgentBlueprintBuilderRuntimeGraphNodeSummary & {
  bundle: AgentBlueprintBundle;
};

type AgentBlueprintBuilderRuntimeGraphDraft = {
  mode: RequirementPlannerResult["topology"]["mode"];
  entryNodeId: string;
  nodes: AgentBlueprintBuilderRuntimeGraphNodeDraft[];
  edges: AgentBlueprintBuilderRuntimeGraphEdge[];
};

export type AgentBlueprintBuilderPlan = {
  draft: AgentBlueprintBuilderDraftSummary;
  plan: AgentBlueprintPlan;
  graphPlans: Array<{
    nodeId: string;
    roleId: string;
    entry: boolean;
    templateId: string;
    plan: AgentBlueprintPlan;
  }>;
};

export type AgentBlueprintBuilderApplyResult = {
  draft: AgentBlueprintBuilderDraftSummary;
  result: AgentBlueprintApplyResult;
  graphResults: Array<{
    nodeId: string;
    roleId: string;
    entry: boolean;
    result: AgentBlueprintApplyResult;
  }>;
};

export type AgentBlueprintBuilderVerifyResult = {
  draft: AgentBlueprintBuilderDraftSummary;
  plan: AgentBlueprintPlan;
  graphPlans: AgentBlueprintBuilderPlan["graphPlans"];
  verification: RequirementPlannerVerificationRun;
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

type InferredWorkflowShape = {
  bundle: AgentBlueprintBundle;
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

  const hasSupport = requirements.workflow.primaryGoal === "support";
  if (hasSupport) {
    addScore("support-responder", 5, "Detected an inbound support or customer-response workflow.");
  }

  const hasBriefing =
    requirements.workflow.primaryGoal === "briefing" ||
    requirements.workflow.executionMode === "scheduled" ||
    requirements.workflow.executionMode === "hybrid";
  if (hasBriefing) {
    addScore("daily-briefing", 4, "Detected a scheduled digest, briefing, or summary workflow.");
  }
  if (requirements.requestedContractIds.includes("schedule.trigger")) {
    addScore("daily-briefing", 2, "Matched recurring schedule language.");
  }

  const hasResearch = requirements.workflow.primaryGoal === "research";
  if (hasResearch) {
    addScore("research-agent", 4, "Detected research, analysis, or web-synthesis requirements.");
  }

  const hasPersonal =
    requirements.workflow.primaryGoal === "assistant" ||
    requirements.workflow.primaryGoal === "operator";
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

function inferDelivery(
  brief: string,
  outputChannels: string[],
  requirements: RequirementSet,
): InferredDelivery {
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

  if (outputChannels.length > 0) {
    const channel = outputChannels[0] ?? "telegram";
    const explicitTarget = brief.match(/(?:^|\s)([#@][\w./-]+)/)?.[1];
    if (explicitTarget) {
      return {
        channel,
        to: explicitTarget,
        assumptions,
        questions,
      };
    }
    if (DIRECT_DELIVERY_CHANNELS.has(channel)) {
      assumptions.push(`Defaulted ${channel} delivery to ${DEFAULT_DIRECT_TARGET}.`);
      return {
        channel,
        to: DEFAULT_DIRECT_TARGET,
        assumptions,
        questions,
      };
    }
    questions.push({
      id: "delivery-target",
      prompt: `Which ${channel} destination should receive the result?`,
      required: true,
    });
    return { channel, assumptions, questions };
  }

  if (/\b(send|deliver|post).*\b(me|for me)\b/i.test(brief)) {
    assumptions.push("Defaulted delivery to Telegram @me.");
    return {
      channel: "telegram",
      to: DEFAULT_DIRECT_TARGET,
      assumptions,
      questions,
    };
  }

  if (requirements.workflow.primaryGoal === "briefing") {
    assumptions.push("Defaulted delivery to Telegram @me.");
  }
  return {
    ...(requirements.workflow.primaryGoal === "briefing"
      ? {
          channel: "telegram",
          to: DEFAULT_DIRECT_TARGET,
        }
      : {}),
    assumptions,
    questions,
  };
}

function inferBindings(channels: string[], requirements: RequirementSet): InferredBindings {
  const assumptions: string[] = [];
  const questions: AgentBlueprintBuilderQuestion[] = [];

  if (
    requirements.workflow.executionMode === "bound-channel" ||
    requirements.workflow.executionMode === "hybrid"
  ) {
    if (channels.length === 0) {
      questions.push({
        id: "binding-channel",
        prompt:
          requirements.workflow.primaryGoal === "support"
            ? "Which channel should this support responder watch?"
            : "Which channel should this workflow watch?",
        required: true,
      });
      return { channels: [], assumptions, questions };
    }
    assumptions.push(
      "Used channel-level bindings. Room-specific routing can be refined later if needed.",
    );
    return { channels, assumptions, questions };
  }

  if (
    requirements.workflow.executionMode === "direct" ||
    requirements.workflow.primaryGoal === "assistant" ||
    requirements.workflow.primaryGoal === "research"
  ) {
    return { channels: channels.slice(0, 1), assumptions, questions };
  }

  return { channels: [], assumptions, questions };
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

function connectorChannelId(connectorId: string): string | null {
  if (!connectorId.startsWith("channel:")) {
    return null;
  }
  return connectorId.replace(/^channel:/, "");
}

function dedupeChannels(values: string[]): string[] {
  return values.filter((value, index, all) => all.indexOf(value) === index);
}

function inferPlannerIngressChannels(planning: RequirementPlannerResult): string[] {
  return dedupeChannels(
    planning.selections
      .filter((selection) => selection.contractIds.includes("ingress.chat"))
      .map((selection) => connectorChannelId(selection.connectorId))
      .filter((value): value is string => Boolean(value)),
  );
}

function inferPlannerDeliveryChannels(planning: RequirementPlannerResult): string[] {
  return dedupeChannels(
    planning.selections
      .filter(
        (selection) =>
          selection.requirementId === "message-output" ||
          selection.contractIds.includes("message.send"),
      )
      .map((selection) => connectorChannelId(selection.connectorId))
      .filter((value): value is string => Boolean(value)),
  );
}

function inferPlannerSourceChannels(
  requirements: RequirementSet,
  planning: RequirementPlannerResult,
): string[] {
  const sources: string[] = [];
  if (requirements.inputs.some((entry) => entry.contractIds.includes("ingest.email"))) {
    sources.push("gmail");
  }
  if (requirements.inputs.some((entry) => entry.contractIds.includes("ingest.feed"))) {
    sources.push(
      ...planning.selections
        .filter((selection) => selection.requirementId === "feed-source")
        .map((selection) => connectorChannelId(selection.connectorId))
        .filter((value): value is string => Boolean(value)),
    );
  }
  return dedupeChannels(sources);
}

function applyPlannerWorkflowShape(
  bundle: AgentBlueprintBundle,
  params: {
    brief: string;
    templateId: string;
    requirements: RequirementSet;
    planning: RequirementPlannerResult;
  },
): InferredWorkflowShape {
  const next = structuredClone(bundle);
  const assumptions: string[] = [];
  const questions: AgentBlueprintBuilderQuestion[] = [];
  const ingressChannels = inferPlannerIngressChannels(params.planning);
  const outputChannels = inferPlannerDeliveryChannels(params.planning);
  const sourceChannels = inferPlannerSourceChannels(params.requirements, params.planning);
  const bindings = inferBindings(ingressChannels, params.requirements);
  assumptions.push(...bindings.assumptions);
  questions.push(...bindings.questions);

  const scheduleRequested = params.requirements.requestedContractIds.includes("schedule.trigger");
  const schedule = scheduleRequested ? inferSchedule(params.brief) : null;
  if (scheduleRequested && schedule) {
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
  } else if (scheduleRequested) {
    assumptions.push("Kept the starter weekday morning schedule.");
  }

  const delivery = inferDelivery(params.brief, outputChannels, params.requirements);
  questions.push(...delivery.questions);
  assumptions.push(...delivery.assumptions);
  if (delivery.channel || delivery.to) {
    next.delivery = {
      ...next.delivery,
      target: {
        ...next.delivery?.target,
        ...(delivery.channel ? { channel: delivery.channel } : {}),
        ...(delivery.to ? { to: delivery.to } : {}),
      },
    };
  }

  const interactionMode =
    params.requirements.workflow.executionMode === "hybrid"
      ? "hybrid"
      : params.requirements.workflow.executionMode === "scheduled"
        ? "scheduled"
        : params.requirements.workflow.executionMode === "webhook"
          ? "bound-channel"
          : bindings.channels.length > 0
            ? "bound-channel"
            : params.requirements.workflow.executionMode === "direct"
              ? "direct"
              : next.ingress?.interactionMode;

  if (interactionMode || bindings.channels.length > 0 || sourceChannels.length > 0) {
    next.ingress = {
      interactionMode: interactionMode ?? "direct",
      ...(bindings.channels.length > 0
        ? {
            bindings: bindings.channels.map((channel) => ({ channel })),
          }
        : {}),
      ...(sourceChannels.length > 0
        ? {
            sources: sourceChannels.map((channel) => ({
              kind: "channel" as const,
              value: channel,
            })),
          }
        : {}),
    };
  }

  if (sourceChannels.length > 0) {
    assumptions.push(`Used sources inferred from the planner: ${sourceChannels.join(", ")}.`);
  }

  if (params.requirements.policyGaps.some((gap) => gap.contractIds.includes("approval.request"))) {
    next.safety = {
      ...next.safety,
      externalActionPolicy: "ask-first",
    };
  }

  if (
    params.templateId === researchAgentBlueprint.manifest.templateId &&
    /\bno subagents\b/i.test(params.brief)
  ) {
    next.runtime.subagents = {
      enabled: false,
    };
  } else if (params.planning.topology.mode === "multi-agent") {
    next.runtime.subagents = {
      enabled: true,
    };
    assumptions.push(`Planned a multi-agent runtime: ${params.planning.topology.reason}`);
  }

  return { bundle: next, assumptions, questions };
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

function summarizeRuntimeGraphNode(
  node: AgentBlueprintBuilderRuntimeGraphNodeDraft,
): AgentBlueprintBuilderRuntimeGraphNodeSummary {
  const { bundle: _bundle, ...summary } = node;
  return summary;
}

function summarizeRuntimeGraph(
  graph: AgentBlueprintBuilderRuntimeGraphDraft,
): AgentBlueprintBuilderRuntimeGraphSummary {
  return {
    mode: graph.mode,
    entryNodeId: graph.entryNodeId,
    nodes: graph.nodes.map((node) => summarizeRuntimeGraphNode(node)),
    edges: graph.edges,
  };
}

function roleTemplateId(params: {
  roleId: string;
  planning: RequirementPlannerResult;
  requirements: RequirementSet;
  fallbackTemplateId: string;
}): string {
  if (params.roleId === "coordinator") {
    return params.fallbackTemplateId;
  }
  if (
    params.requirements.workflow.primaryGoal === "research" ||
    params.requirements.inputs.length > 0 ||
    params.requirements.transforms.length > 0
  ) {
    return "research-agent";
  }
  return "personal-assistant";
}

function createRuntimeGraphRoleBundle(params: {
  role: RequirementPlannerResult["topology"]["roles"][number];
  baseBundle: AgentBlueprintBundle;
  fallbackTemplateId: string;
  planning: RequirementPlannerResult;
  requirements: RequirementSet;
  entry: boolean;
}): AgentBlueprintBundle {
  if (params.entry) {
    const next = structuredClone(params.baseBundle);
    if (params.planning.topology.mode === "multi-agent") {
      next.runtime.subagents = {
        enabled: true,
        mode: "inherit",
      };
      next.workspace.notes = [
        ...(next.workspace.notes ?? []),
        `Coordinate delegated work for the ${params.baseBundle.agent.name} workflow.`,
      ];
    }
    return next;
  }

  const templateId = roleTemplateId({
    roleId: params.role.id,
    planning: params.planning,
    requirements: params.requirements,
    fallbackTemplateId: params.fallbackTemplateId,
  });
  const template = getAgentBlueprintTemplate(templateId);
  const next = structuredClone(template ?? params.baseBundle);
  next.agent.agentId = normalizeAgentId(`${params.baseBundle.agent.agentId}-${params.role.id}`);
  next.agent.name = `${params.baseBundle.agent.name} ${params.role.label}`;
  next.runtime.subagents = {
    enabled: false,
  };
  next.ingress = {
    interactionMode: "direct",
    ...(params.baseBundle.ingress?.sources?.length
      ? {
          sources: structuredClone(params.baseBundle.ingress.sources),
        }
      : {}),
  };
  next.automation = undefined;
  next.delivery = undefined;
  next.workspace.notes = [
    ...(next.workspace.notes ?? []),
    `Act as the ${params.role.label.toLowerCase()} for ${params.baseBundle.agent.name}.`,
    ...params.role.responsibilities,
  ];
  next.validation = {
    ...next.validation,
    successCriteria: [
      ...(next.validation?.successCriteria ?? []),
      `Supports the coordinator agent ${params.baseBundle.agent.name}.`,
    ],
  };
  return next;
}

function buildRuntimeGraphDraft(params: {
  bundle: AgentBlueprintBundle;
  templateId: string;
  planning: RequirementPlannerResult;
  requirements: RequirementSet;
}): AgentBlueprintBuilderRuntimeGraphDraft {
  if (params.planning.topology.mode === "single-agent") {
    const node: AgentBlueprintBuilderRuntimeGraphNodeDraft = {
      id: "primary",
      roleId: "primary",
      label: "Primary Agent",
      templateId: params.templateId,
      entry: true,
      agentId: normalizeAgentId(params.bundle.agent.agentId),
      name: params.bundle.agent.name,
      interactionMode: params.bundle.ingress?.interactionMode ?? "direct",
      connectorIds: dedupeChannels(
        params.planning.selections.map((selection) => selection.connectorId),
      ),
      responsibilities: ["Handle the workflow end to end in one agent runtime."],
      deliveryTarget: summarizeDeliveryTarget(params.bundle),
      schedule: summarizeSchedule(params.bundle),
      bundle: structuredClone(params.bundle),
    };
    return {
      mode: "single-agent",
      entryNodeId: node.id,
      nodes: [node],
      edges: [],
    };
  }

  const roles = params.planning.topology.roles;
  const entryRoleId =
    roles.find((role) => role.id === "coordinator")?.id ?? roles[0]?.id ?? "primary";
  const nodes = roles.map((role) => {
    const entry = role.id === entryRoleId;
    const roleBundle = createRuntimeGraphRoleBundle({
      role,
      baseBundle: params.bundle,
      fallbackTemplateId: params.templateId,
      planning: params.planning,
      requirements: params.requirements,
      entry,
    });
    return {
      id: role.id,
      roleId: role.id,
      label: role.label,
      templateId: entry
        ? params.templateId
        : roleTemplateId({
            roleId: role.id,
            planning: params.planning,
            requirements: params.requirements,
            fallbackTemplateId: params.templateId,
          }),
      entry,
      agentId: normalizeAgentId(roleBundle.agent.agentId),
      name: roleBundle.agent.name,
      interactionMode: roleBundle.ingress?.interactionMode ?? "direct",
      connectorIds: role.connectorIds,
      responsibilities: role.responsibilities,
      deliveryTarget: summarizeDeliveryTarget(roleBundle),
      schedule: summarizeSchedule(roleBundle),
      bundle: roleBundle,
    } satisfies AgentBlueprintBuilderRuntimeGraphNodeDraft;
  });

  const edges = nodes
    .filter((node) => !node.entry)
    .flatMap((node) => [
      {
        id: `${entryRoleId}->${node.id}:delegates`,
        fromNodeId: entryRoleId,
        toNodeId: node.id,
        kind: "delegates" as const,
        label: `Delegate ${node.label.toLowerCase()} work`,
      },
      {
        id: `${node.id}->${entryRoleId}:reports`,
        fromNodeId: node.id,
        toNodeId: entryRoleId,
        kind: "reports" as const,
        label: `Report results back to ${entryRoleId}`,
      },
    ]);

  return {
    mode: params.planning.topology.mode,
    entryNodeId: entryRoleId,
    nodes,
    edges,
  };
}

async function compileRuntimeGraphPlans(params: {
  graph: AgentBlueprintBuilderRuntimeGraphDraft;
  cfg?: OpenClawConfig;
  templateId: string;
}): Promise<AgentBlueprintBuilderPlan["graphPlans"]> {
  return Promise.all(
    params.graph.nodes.map(async (node) => ({
      nodeId: node.id,
      roleId: node.roleId,
      entry: node.entry,
      templateId: node.templateId,
      plan: await compileAgentBlueprintPlan({
        bundle: node.bundle,
        cfg: params.cfg,
        source: {
          kind: "builder",
          value: `${params.templateId}:${node.roleId}`,
          format: null,
        },
      }),
    })),
  );
}

function withDraftPlanning(
  draft: AgentBlueprintBuilderDraft,
  planning: RequirementPlannerResult,
): AgentBlueprintBuilderDraft {
  return {
    ...draft,
    plannerStatus: planning.status,
    ready: planning.status === "ready",
    planning: {
      selections: planning.selections,
      alternatives: planning.alternatives,
      variants: planning.variants,
      integrations: planning.integrations,
      setupTasks: planning.setupTasks,
      verifications: planning.verifications,
      topology: planning.topology,
      graph: summarizeRuntimeGraph(draft.runtimeGraph),
    },
  };
}

async function hydratePersistedPlanningState(
  planning: RequirementPlannerResult,
  env?: NodeJS.ProcessEnv,
): Promise<RequirementPlannerResult> {
  const withIntegrationState = await hydrateRequirementPlannerIntegrationState(planning, env);
  const withVerificationState = await hydrateRequirementPlannerVerificationState(
    withIntegrationState,
    env,
  );
  await writePlannerIntegrations({
    integrations: withVerificationState.integrations,
    env,
  });
  return withVerificationState;
}

function buildAgentBlueprintDraftInternal(params: {
  brief: string;
  templateId?: string;
  cfg?: OpenClawConfig;
}): {
  draft: AgentBlueprintBuilderDraft;
  planning: RequirementPlannerResult;
} {
  const brief = params.brief.trim();
  if (!brief) {
    throw new Error("A builder brief is required.");
  }

  const extractedRequirements = buildRequirementSet({
    brief,
    cfg: params.cfg,
  });
  const selection = selectTemplate(extractedRequirements, params.templateId);
  const initialPlanning = buildRequirementPlannerResult({
    requirements: extractedRequirements,
    cfg: params.cfg,
  });
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

  const customized = applyPlannerWorkflowShape(bundle, {
    brief,
    templateId: selection.templateId,
    requirements: extractedRequirements,
    planning: initialPlanning,
  });
  bundle = customized.bundle;
  assumptions.push(...customized.assumptions);
  questions.push(...customized.questions);

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
  const runtimeGraph = buildRuntimeGraphDraft({
    bundle,
    templateId: selection.templateId,
    planning,
    requirements,
  });

  const draft: AgentBlueprintBuilderDraft = {
    brief,
    templateId: selection.templateId,
    displayName: bundle.manifest.displayName,
    confidence: selection.confidence,
    plannerStatus: planning.status,
    reasons: selection.reasons,
    assumptions,
    questions: uniqueQuestions,
    ready: planning.status === "ready",
    requirements,
    planning: {
      selections: planning.selections,
      alternatives: planning.alternatives,
      variants: planning.variants,
      integrations: planning.integrations,
      setupTasks: planning.setupTasks,
      verifications: planning.verifications,
      topology: planning.topology,
      graph: summarizeRuntimeGraph(runtimeGraph),
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
    runtimeGraph,
  };

  return { draft, planning };
}

export function buildAgentBlueprintDraft(params: {
  brief: string;
  templateId?: string;
  cfg?: OpenClawConfig;
}): AgentBlueprintBuilderDraft {
  return buildAgentBlueprintDraftInternal(params).draft;
}

function stripBundleFromDraft(
  draft: AgentBlueprintBuilderDraft,
): AgentBlueprintBuilderDraftSummary {
  const { bundle: _bundle, runtimeGraph: _runtimeGraph, ...summary } = draft;
  return summary;
}

export async function compileAgentBlueprintBuilderPlan(params: {
  brief: string;
  templateId?: string;
  cfg?: OpenClawConfig;
}): Promise<AgentBlueprintBuilderPlan> {
  const built = buildAgentBlueprintDraftInternal({
    ...params,
    cfg: params.cfg,
  });
  const planning = await hydratePersistedPlanningState(built.planning);
  const draft = withDraftPlanning(built.draft, planning);
  const graphPlans = await compileRuntimeGraphPlans({
    graph: draft.runtimeGraph,
    cfg: params.cfg,
    templateId: draft.templateId,
  });
  const entryGraphPlan =
    graphPlans.find((node) => node.entry) ??
    graphPlans.find((node) => node.nodeId === draft.runtimeGraph.entryNodeId);
  return {
    draft: stripBundleFromDraft(draft),
    plan:
      entryGraphPlan?.plan ??
      (() => {
        throw new Error("Builder runtime graph did not produce an entry plan.");
      })(),
    graphPlans,
  };
}

export async function applyAgentBlueprintBuilderPlan(params: {
  brief: string;
  templateId?: string;
  cfg?: OpenClawConfig;
}): Promise<AgentBlueprintBuilderApplyResult> {
  const cfg = params.cfg ?? loadConfig();
  const built = buildAgentBlueprintDraftInternal({
    ...params,
    cfg,
  });
  const draft = withDraftPlanning(built.draft, await hydratePersistedPlanningState(built.planning));
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
  const graphPlans = await compileRuntimeGraphPlans({
    graph: draft.runtimeGraph,
    cfg,
    templateId: draft.templateId,
  });
  const notReadyNode = graphPlans.find((entry) => entry.plan.status !== "ready");
  if (notReadyNode) {
    const reasons = notReadyNode.plan.issues.map((issue) => issue.message).join(" ");
    throw new Error(
      `Builder runtime graph is not ready for node ${notReadyNode.nodeId}. ${reasons}`.trim(),
    );
  }
  const orderedNodes = draft.runtimeGraph.nodes.toSorted((left, right) => {
    if (left.entry === right.entry) {
      return left.id.localeCompare(right.id);
    }
    return left.entry ? 1 : -1;
  });
  const graphResults: AgentBlueprintBuilderApplyResult["graphResults"] = [];
  for (const node of orderedNodes) {
    const result = await applyAgentBlueprint({
      loaded: {
        kind: "builder",
        source: `${draft.templateId}:${node.roleId}`,
        format: null,
        bundle: node.bundle,
      },
    });
    graphResults.push({
      nodeId: node.id,
      roleId: node.roleId,
      entry: node.entry,
      result,
    });
  }
  const result =
    graphResults.find((entry) => entry.entry)?.result ??
    graphResults[0]?.result ??
    (await applyAgentBlueprint({
      loaded: createBuilderLoadedBlueprint(draft),
    }));
  return {
    draft: stripBundleFromDraft(draft),
    result,
    graphResults,
  };
}

export async function verifyAgentBlueprintBuilderPlan(params: {
  brief: string;
  templateId?: string;
  cfg?: OpenClawConfig;
}): Promise<AgentBlueprintBuilderVerifyResult> {
  const cfg = params.cfg ?? loadConfig();
  const built = buildAgentBlueprintDraftInternal({
    ...params,
    cfg,
  });
  const verificationResult = await runRequirementPlannerLiveVerification({
    planning: built.planning,
    cfg,
  });
  const draft = withDraftPlanning(built.draft, verificationResult.planning);
  const graphPlans = await compileRuntimeGraphPlans({
    graph: draft.runtimeGraph,
    cfg,
    templateId: draft.templateId,
  });
  const entryGraphPlan =
    graphPlans.find((node) => node.entry) ??
    graphPlans.find((node) => node.nodeId === draft.runtimeGraph.entryNodeId);
  return {
    draft: stripBundleFromDraft(draft),
    plan:
      entryGraphPlan?.plan ??
      (() => {
        throw new Error("Builder runtime graph did not produce an entry plan.");
      })(),
    graphPlans,
    verification: verificationResult.run,
  };
}

export const __testing = {
  applyPlannerWorkflowShape,
  inferBindings,
  inferDelivery,
  inferSchedule,
  selectTemplate,
};
