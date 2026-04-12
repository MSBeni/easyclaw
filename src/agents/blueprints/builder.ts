import { getChannelDock } from "../../channels/dock.js";
import { resolveChannelDefaultAccountId } from "../../channels/plugins/helpers.js";
import { getChannelPlugin } from "../../channels/plugins/index.js";
import type { ChannelId } from "../../channels/plugins/types.js";
import { loadConfig, type OpenClawConfig } from "../../config/config.js";
import { resolveAgentModelPrimaryValue } from "../../config/model-input.js";
import type { CronService } from "../../cron/service.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { normalizeWhatsAppTarget } from "../../whatsapp/normalize.js";
import {
  applyRequirementGaps,
  applyRequirementQuestions,
  buildOpenClawCapabilityRegistry,
  buildRequirementPlannerResult,
  hydrateRequirementPlannerIntegrationState,
  hydrateRequirementPlannerVerificationState,
  type PlannedSetupTask,
  type PlannedVerificationResult,
  buildRequirementSet,
  type PlannedIntegrationInstance,
  runRequirementPlannerLiveVerification,
  type RequirementApprovalPosture,
  type RequirementPlannerResult,
  type RequirementPlannerVerificationRun,
  type RequirementPlannerSelection,
  type RequirementGap,
  type RequirementSet,
  writePlannerIntegrations,
} from "../capabilities/index.js";
import type { PlannerStatus } from "../capabilities/schema.js";
import { DEFAULT_PROVIDER } from "../defaults.js";
import { ensureAuthProfileStore, resolveApiKeyForProvider } from "../model-auth.js";
import { parseModelRef } from "../model-selection.js";
import type { BuildSpec } from "../planning/build-spec.js";
import { runBuilderPlannerAgent } from "../planning/planner-agent.js";
import { hasBlockingSetupActions, synchronizeBuildSpec } from "../planning/setup-actions.js";
import {
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_MEMORY_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_USER_FILENAME,
} from "../workspace.js";
import { compileAgentBlueprintPlan, type AgentBlueprintPlan } from "./compiler.js";
import { researchAgentBlueprint } from "./examples.js";
import type { LoadedAgentBlueprint } from "./files.js";
import {
  applyAgentBlueprint,
  previewAgentBlueprintManagedWorkspaceDocs,
  type AgentBlueprintApplyResult,
  type AgentBlueprintManagedWorkspaceDocPreview,
} from "./materialize.js";
import { getAgentBlueprintTemplate, listAgentBlueprintCatalog } from "./registry.js";
import type { AgentBlueprintBundle } from "./schema.js";

const WEEKDAY_CRON = "1-5";

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

export type AgentBlueprintBuilderManagedDocEdit = {
  nodeId: string;
  fileName: string;
  content: string;
};

type AgentBlueprintBuilderGraphMode = "single-agent" | "multi-agent" | "swarm";

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
  buildSpec: BuildSpec;
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
  kind: string;
  label: string;
};

export type AgentBlueprintBuilderRuntimeGraphSummary = {
  mode: AgentBlueprintBuilderGraphMode;
  entryNodeId: string;
  nodes: AgentBlueprintBuilderRuntimeGraphNodeSummary[];
  edges: AgentBlueprintBuilderRuntimeGraphEdge[];
};

type AgentBlueprintBuilderRuntimeGraphNodeDraft = AgentBlueprintBuilderRuntimeGraphNodeSummary & {
  bundle: AgentBlueprintBundle;
};

type AgentBlueprintBuilderRuntimeGraphDraft = {
  mode: AgentBlueprintBuilderGraphMode;
  entryNodeId: string;
  nodes: AgentBlueprintBuilderRuntimeGraphNodeDraft[];
  edges: AgentBlueprintBuilderRuntimeGraphEdge[];
};

export type AgentBlueprintBuilderPlan = {
  draft: AgentBlueprintBuilderDraftSummary;
  workspacePreviews: Array<{
    nodeId: string;
    roleId: string;
    entry: boolean;
    files: AgentBlueprintManagedWorkspaceDocPreview[];
  }>;
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
  workspacePreviews: AgentBlueprintBuilderPlan["workspacePreviews"];
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
  timezone?: string;
  timezoneLabel?: string;
  assumed: boolean;
};

const PACIFIC_TIMEZONE = "America/Los_Angeles";
const MOUNTAIN_TIMEZONE = "America/Denver";
const CENTRAL_TIMEZONE = "America/Chicago";
const EASTERN_TIMEZONE = "America/New_York";
const ALASKA_TIMEZONE = "America/Anchorage";
const HAWAII_TIMEZONE = "Pacific/Honolulu";

const MANAGED_WORKSPACE_BOOTSTRAP_FILES = [
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_USER_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_MEMORY_FILENAME,
] as const;

type InferredDelivery = {
  channel?: string;
  to?: string | null;
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

function parseTimezone(brief: string): { timezone: string; label: string } | null {
  const normalized = brief.toUpperCase();
  if (/\b(PST|PDT|PT)\b/.test(normalized)) {
    return { timezone: PACIFIC_TIMEZONE, label: "Pacific Time" };
  }
  if (/\b(MST|MDT|MT)\b/.test(normalized)) {
    return { timezone: MOUNTAIN_TIMEZONE, label: "Mountain Time" };
  }
  if (/\b(CST|CDT|CT)\b/.test(normalized)) {
    return { timezone: CENTRAL_TIMEZONE, label: "Central Time" };
  }
  if (/\b(EST|EDT|ET)\b/.test(normalized)) {
    return { timezone: EASTERN_TIMEZONE, label: "Eastern Time" };
  }
  if (/\b(AKST|AKDT|AKT)\b/.test(normalized)) {
    return { timezone: ALASKA_TIMEZONE, label: "Alaska Time" };
  }
  if (/\b(HST|HDT|HT)\b/.test(normalized)) {
    return { timezone: HAWAII_TIMEZONE, label: "Hawaii Time" };
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
  const timezone = parseTimezone(brief);
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
    description: `${dayLabel} at ${formatTime(time.hour, time.minute)}${
      timezone ? ` ${timezone.label}` : ""
    }`,
    ...(timezone ? { timezone: timezone.timezone, timezoneLabel: timezone.label } : {}),
    assumed: time.assumed || (/\bweekly\b/i.test(brief) && explicitDays.length === 0),
  };
}

function inferDelivery(
  brief: string,
  outputChannels: string[],
  requirements: RequirementSet,
  cfg?: OpenClawConfig,
): InferredDelivery {
  const requiresExplicitDeliveryTarget =
    requirements.workflow.primaryGoal === "briefing" ||
    requirements.workflow.executionMode === "scheduled";
  const resolveConfiguredDefaultTarget = (channel: string): string | null => {
    if (!cfg) {
      return null;
    }
    const dock = getChannelDock(channel as ChannelId);
    const resolveDefaultTo = dock?.config?.resolveDefaultTo;
    if (typeof resolveDefaultTo !== "function") {
      return null;
    }
    const resolved = resolveDefaultTo({ cfg })?.trim();
    return resolved ? resolved : null;
  };

  const assumptions: string[] = [];
  const questions: AgentBlueprintBuilderQuestion[] = [];
  const inferExplicitWhatsAppTarget = (): string | null => {
    if (!/\bwhatsapp\b/i.test(brief)) {
      return null;
    }
    const candidates = new Set<string>();
    for (const match of brief.matchAll(/\+\d[\d()\s.-]{6,}\d/g)) {
      const value = match[0]?.trim();
      if (value) {
        candidates.add(value);
      }
    }
    for (const match of brief.matchAll(/\d+(?::\d+)?@s\.whatsapp\.net/gi)) {
      const value = match[0]?.trim();
      if (value) {
        candidates.add(value);
      }
    }
    for (const match of brief.matchAll(/\d+(?:-\d+)*@g\.us/gi)) {
      const value = match[0]?.trim();
      if (value) {
        candidates.add(value);
      }
    }
    for (const candidate of candidates) {
      const normalized = normalizeWhatsAppTarget(candidate);
      if (normalized) {
        return normalized;
      }
    }
    return null;
  };
  const deliveryMatch = brief.match(
    /\b(?:send|deliver|post|publish|share)[^.!?\n]*?\b(?:to|into|in)\s+(?:my\s+)?(discord|matrix|msteams|signal|slack|telegram|whatsapp)\b(?:\s+(?:channel|dm|group|chat))?\s*([#@][\w./-]+)?/i,
  );
  if (deliveryMatch?.[1]) {
    const channel = deliveryMatch[1].toLowerCase();
    const to = deliveryMatch[2];
    if (!to && channel === "whatsapp") {
      const explicitWhatsAppTarget = inferExplicitWhatsAppTarget();
      if (explicitWhatsAppTarget) {
        assumptions.push("Used explicit WhatsApp destination from your brief.");
        return { channel, to: explicitWhatsAppTarget, assumptions, questions };
      }
    }
    if (to) {
      return { channel, to, assumptions, questions };
    }
    const configuredTarget = resolveConfiguredDefaultTarget(channel);
    if (configuredTarget) {
      assumptions.push(`Used configured ${channel} default target.`);
      return { channel, to: configuredTarget, assumptions, questions };
    }
    questions.push({
      id: "delivery-target",
      prompt: `Which ${channel} destination should receive the digest?`,
      required: true,
    });
    return { channel, to: null, assumptions, questions };
  }

  if (outputChannels.length > 0) {
    const channel = outputChannels[0] ?? "telegram";
    const explicitTarget = brief.match(/(?:^|\s)([#@][\w./-]+)/)?.[1];
    if (!explicitTarget && channel === "whatsapp") {
      const explicitWhatsAppTarget = inferExplicitWhatsAppTarget();
      if (explicitWhatsAppTarget) {
        assumptions.push("Used explicit WhatsApp destination from your brief.");
        return {
          channel,
          to: explicitWhatsAppTarget,
          assumptions,
          questions,
        };
      }
    }
    if (explicitTarget) {
      return {
        channel,
        to: explicitTarget,
        assumptions,
        questions,
      };
    }
    const configuredTarget = resolveConfiguredDefaultTarget(channel);
    if (configuredTarget) {
      assumptions.push(`Used configured ${channel} default target.`);
      return {
        channel,
        to: configuredTarget,
        assumptions,
        questions,
      };
    }
    if (!requiresExplicitDeliveryTarget) {
      return { assumptions, questions };
    }
    questions.push({
      id: "delivery-target",
      prompt: `Which ${channel} destination should receive the result?`,
      required: true,
    });
    return { channel, to: null, assumptions, questions };
  }

  if (/\b(send|deliver|post).*\b(me|for me)\b/i.test(brief)) {
    const configuredTelegramTarget = resolveConfiguredDefaultTarget("telegram");
    if (configuredTelegramTarget) {
      assumptions.push("Used configured telegram default target.");
      return {
        channel: "telegram",
        to: configuredTelegramTarget,
        assumptions,
        questions,
      };
    }
    questions.push({
      id: "delivery-target",
      prompt: "Which Telegram destination should receive the digest?",
      required: true,
    });
    return {
      channel: "telegram",
      to: null,
      assumptions,
      questions,
    };
  }

  if (requirements.workflow.primaryGoal === "briefing") {
    const configuredTelegramTarget = resolveConfiguredDefaultTarget("telegram");
    if (configuredTelegramTarget) {
      assumptions.push("Used configured telegram default target.");
      return {
        channel: "telegram",
        to: configuredTelegramTarget,
        assumptions,
        questions,
      };
    }
    questions.push({
      id: "delivery-target",
      prompt: "Which Telegram destination should receive the digest?",
      required: true,
    });
    assumptions.push("Delivery target needs confirmation before scheduling.");
    return {
      channel: "telegram",
      to: null,
      assumptions,
      questions,
    };
  }
  return {
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

function normalizeBuilderAgentName(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized ? titleCase(normalized) : null;
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

function ensureManagedWorkspaceBootstrapFiles(bundle: AgentBlueprintBundle): {
  bundle: AgentBlueprintBundle;
  assumptions: string[];
} {
  const existing = bundle.workspace.bootstrapFiles ?? [];
  const combined = [...existing];
  for (const fileName of MANAGED_WORKSPACE_BOOTSTRAP_FILES) {
    if (!combined.includes(fileName)) {
      combined.push(fileName);
    }
  }
  const added = combined.filter((fileName) => !existing.includes(fileName));
  if (added.length === 0) {
    return { bundle, assumptions: [] };
  }
  const next = structuredClone(bundle);
  next.workspace.bootstrapFiles = combined;
  return {
    bundle: next,
    assumptions: [
      `Added managed workspace docs for review before activation: ${added.join(", ")}.`,
    ],
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

function includesContract(requirements: RequirementSet, contractId: string): boolean {
  return requirements.inputs.some((entry) => entry.contractIds.includes(contractId));
}

function ensureSourceRuntimeCapabilities(params: {
  bundle: AgentBlueprintBundle;
  requirements: RequirementSet;
  sourceChannels: string[];
}): { bundle: AgentBlueprintBundle; assumptions: string[] } {
  const next = structuredClone(params.bundle);
  const assumptions: string[] = [];
  const requiresExpandedTooling =
    params.sourceChannels.includes("gmail") ||
    includesContract(params.requirements, "ingest.feed") ||
    includesContract(params.requirements, "fetch.web") ||
    includesContract(params.requirements, "fs.read") ||
    includesContract(params.requirements, "memory.search");

  if (requiresExpandedTooling) {
    if (next.runtime.tools.profile !== "coding" && next.runtime.tools.profile !== "full") {
      next.runtime.tools.profile = "coding";
      assumptions.push(
        "Enabled the coding tool profile so this workflow can gather source data before summarizing.",
      );
    }

    const alsoAllow = new Set(next.runtime.tools.alsoAllow ?? []);
    alsoAllow.add("cron");
    alsoAllow.add("message");
    next.runtime.tools.alsoAllow = Array.from(alsoAllow);
  }

  if (params.sourceChannels.includes("gmail")) {
    const skills = new Set(next.runtime.skills ?? []);
    if (!skills.has("gog")) {
      skills.add("gog");
      next.runtime.skills = Array.from(skills);
      assumptions.push(
        "Enabled the gog skill so Gmail digests can pull mailbox data during scheduled runs.",
      );
    }
  }

  return { bundle: next, assumptions };
}

function applyPlannerWorkflowShape(
  bundle: AgentBlueprintBundle,
  params: {
    brief: string;
    templateId: string;
    requirements: RequirementSet;
    planning: RequirementPlannerResult;
    cfg?: OpenClawConfig;
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
          ...(schedule.timezone ? { timezone: schedule.timezone } : {}),
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

  const delivery = inferDelivery(params.brief, outputChannels, params.requirements, params.cfg);
  questions.push(...delivery.questions);
  assumptions.push(...delivery.assumptions);
  if (delivery.channel || delivery.to !== undefined) {
    const nextTarget = { ...next.delivery?.target };
    if (delivery.channel) {
      nextTarget.channel = delivery.channel;
    }
    if (delivery.to === null) {
      delete nextTarget.to;
    } else if (delivery.to) {
      nextTarget.to = delivery.to;
    }
    next.delivery = {
      ...next.delivery,
      target: nextTarget,
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

  const withSourceCapabilities = ensureSourceRuntimeCapabilities({
    bundle: next,
    requirements: params.requirements,
    sourceChannels,
  });
  assumptions.push(...withSourceCapabilities.assumptions);
  next.runtime = withSourceCapabilities.bundle.runtime;

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
  return `${first.name}: ${first.schedule}${
    first.timezone?.trim() ? ` (${first.timezone.trim()})` : ""
  }`;
}

function summarizeIngressChannels(bundle: AgentBlueprintBundle): string[] {
  return (bundle.ingress?.bindings ?? []).map((binding) => binding.channel);
}

function summarizeSourceChannels(bundle: AgentBlueprintBundle): string[] {
  return (bundle.ingress?.sources ?? []).map((source) => source.value);
}

function resolveConfiguredBundleModel(params: {
  bundle: AgentBlueprintBundle;
  cfg?: OpenClawConfig;
}): string | undefined {
  const runtimeModel = params.bundle.runtime.model?.trim();
  if (runtimeModel && runtimeModel !== "user-selected") {
    return runtimeModel;
  }
  const defaultModel = resolveAgentModelPrimaryValue(params.cfg?.agents?.defaults?.model);
  if (defaultModel && defaultModel !== "user-selected") {
    return defaultModel;
  }
  const agentId = normalizeAgentId(params.bundle.agent.agentId);
  const existingAgent = (params.cfg?.agents?.list ?? []).find(
    (agent) => normalizeAgentId(agent.id) === agentId,
  );
  const existingModel = resolveAgentModelPrimaryValue(existingAgent?.model);
  if (existingModel && existingModel !== "user-selected") {
    return existingModel;
  }
  return undefined;
}

function normalizeAuthRunnableError(value: unknown): string {
  if (value instanceof Error) {
    const message = value.message.trim();
    return message || value.name;
  }
  if (typeof value === "string") {
    const message = value.trim();
    return message || "unknown error";
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return `${value}`;
  }
  if (typeof value === "symbol") {
    return value.description ? `symbol:${value.description}` : "symbol";
  }
  if (value && typeof value === "object") {
    try {
      const serialized = JSON.stringify(value);
      if (serialized && serialized !== "{}") {
        return serialized;
      }
    } catch {
      // fall through to constructor-name fallback
    }
    const constructorName =
      typeof value.constructor?.name === "string" ? value.constructor.name : "";
    if (constructorName && constructorName !== "Object") {
      return constructorName;
    }
  }
  return "unknown error";
}

async function checkModelAuthRunnable(params: {
  bundle: AgentBlueprintBundle;
  cfg: OpenClawConfig;
}): Promise<string | null> {
  const selectedModel = resolveConfiguredBundleModel({
    bundle: params.bundle,
    cfg: params.cfg,
  });
  if (!selectedModel) {
    return "OpenClaw Core Model Runtime auth is not runnable: choose a runtime model.";
  }

  const parsed = parseModelRef(selectedModel, DEFAULT_PROVIDER);
  if (!parsed) {
    return `OpenClaw Core Model Runtime auth is not runnable: "${selectedModel}" is not a valid model reference.`;
  }

  try {
    await resolveApiKeyForProvider({
      provider: parsed.provider,
      cfg: params.cfg,
      store: ensureAuthProfileStore(undefined, { allowKeychainPrompt: false }),
    });
  } catch (error) {
    return `OpenClaw Core Model Runtime auth is not runnable for ${parsed.provider}/${parsed.model}: ${normalizeAuthRunnableError(error)}`;
  }

  return null;
}

async function checkChannelAuthRunnable(params: {
  integration: PlannedIntegrationInstance;
  cfg: OpenClawConfig;
  timeoutMs: number;
}): Promise<string | null> {
  const channelId = params.integration.connectorId.replace(/^channel:/, "");
  const plugin = getChannelPlugin(channelId);
  if (!plugin) {
    return `${params.integration.label} auth is not runnable: plugin "${channelId}" is not active in this runtime.`;
  }

  const accountIds = plugin.config.listAccountIds(params.cfg);
  const defaultAccountId = resolveChannelDefaultAccountId({
    plugin,
    cfg: params.cfg,
    accountIds,
  });
  const account = plugin.config.resolveAccount(params.cfg, defaultAccountId);
  const accountId =
    typeof account.accountId === "string" && account.accountId.trim()
      ? account.accountId.trim()
      : defaultAccountId || "default";
  const enabled =
    plugin.config.isEnabled?.(account, params.cfg) ??
    (typeof account.enabled === "boolean" ? account.enabled : true);
  if (!enabled) {
    return `${params.integration.label} auth is not runnable: account "${accountId}" is disabled.`;
  }
  const configured = plugin.config.isConfigured
    ? await plugin.config.isConfigured(account, params.cfg)
    : true;
  if (!configured) {
    return `${params.integration.label} auth is not runnable: account "${accountId}" is missing required credentials.`;
  }

  if (!plugin.status?.probeAccount) {
    return null;
  }

  try {
    const probe = await plugin.status.probeAccount({
      account,
      timeoutMs: params.timeoutMs,
      cfg: params.cfg,
    });
    const record = probe && typeof probe === "object" ? (probe as Record<string, unknown>) : null;
    if (record && record.ok === false) {
      const detail =
        typeof record.error === "string" && record.error.trim().length > 0
          ? record.error.trim()
          : "live probe returned an unhealthy response";
      return `${params.integration.label} auth is not runnable: ${detail}.`;
    }
  } catch (error) {
    return `${params.integration.label} auth is not runnable: ${normalizeAuthRunnableError(error)}.`;
  }

  return null;
}

async function collectApplyAuthRunnableBlockers(params: {
  draft: AgentBlueprintBuilderDraft;
  cfg: OpenClawConfig;
  timeoutMs?: number;
}): Promise<string[]> {
  const blockers: string[] = [];
  const timeoutMs = Math.max(1_000, params.timeoutMs ?? 5_000);
  const seenConnectorIds = new Set<string>();
  const modelIssue = await checkModelAuthRunnable({
    bundle: params.draft.bundle,
    cfg: params.cfg,
  });
  if (modelIssue) {
    blockers.push(modelIssue);
  }
  seenConnectorIds.add("platform:core-model");

  for (const integration of params.draft.planning.integrations) {
    if (!integration.requiresAuth || seenConnectorIds.has(integration.connectorId)) {
      continue;
    }
    seenConnectorIds.add(integration.connectorId);

    if (integration.connectorId === "platform:core-model") {
      const issue = await checkModelAuthRunnable({
        bundle: params.draft.bundle,
        cfg: params.cfg,
      });
      if (issue) {
        blockers.push(issue);
      }
      continue;
    }

    if (
      integration.sourceKind === "builtin_channel" ||
      integration.sourceKind === "channel_catalog"
    ) {
      const issue = await checkChannelAuthRunnable({
        integration,
        cfg: params.cfg,
        timeoutMs,
      });
      if (issue) {
        blockers.push(issue);
      }
    }
  }

  return blockers;
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

  if (!resolveConfiguredBundleModel({ bundle, cfg })) {
    gaps.push({
      kind: "setup",
      code: "runtime-model-unresolved",
      message: "Choose a runtime model before applying this agent.",
      contractIds: ["transform.summarize"],
      connectorIds: ["platform:core-model"],
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
  if (params.baseBundle.runtime.model?.trim()) {
    next.runtime.model = params.baseBundle.runtime.model;
  }
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

function buildDeterministicRuntimeGraphDraft(params: {
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
    .map((node) => ({
      id: `${entryRoleId}->${node.id}:delegates`,
      fromNodeId: entryRoleId,
      toNodeId: node.id,
      kind: "delegates" as const,
      label: `Delegate ${node.label.toLowerCase()} work`,
    }));

  return {
    mode: params.planning.topology.mode,
    entryNodeId: entryRoleId,
    nodes,
    edges,
  };
}

function inferPlannerNodeTemplateId(params: {
  node: BuildSpec["graph"]["nodes"][number];
  fallbackTemplateId: string;
}): string {
  const explicitTemplateId = params.node.templateId?.trim();
  if (explicitTemplateId && getAgentBlueprintTemplate(explicitTemplateId)) {
    return explicitTemplateId;
  }
  if (params.node.entry) {
    return params.fallbackTemplateId;
  }
  const text = [
    params.node.roleId,
    params.node.label,
    params.node.goal ?? "",
    ...params.node.responsibilities,
    ...params.node.connectorIds,
  ]
    .join(" ")
    .toLowerCase();
  if (/\bsupport|responder|triage|reply|customer\b/.test(text)) {
    return "support-responder";
  }
  if (/\bresearch|analy|summar|source|brief|opportunit|competitor\b/.test(text)) {
    return "research-agent";
  }
  if (/\bdigest|newsletter|briefing|daily\b/.test(text)) {
    return "daily-briefing";
  }
  return "personal-assistant";
}

function buildPlannerNodeWorkspaceNotes(params: {
  node: BuildSpec["graph"]["nodes"][number];
  graph: BuildSpec["graph"];
  baseAgentName: string;
}): string[] {
  const incoming = params.graph.edges
    .filter((edge) => edge.toNodeId === params.node.id)
    .map((edge) => `${edge.fromNodeId} -> ${edge.kind}`);
  const outgoing = params.graph.edges
    .filter((edge) => edge.fromNodeId === params.node.id)
    .map((edge) => `${edge.kind} -> ${edge.toNodeId}`);

  return [
    `Act as the ${params.node.label.toLowerCase()} for ${params.baseAgentName}.`,
    ...(params.node.goal ? [`Primary goal: ${params.node.goal}.`] : []),
    ...params.node.responsibilities,
    ...(params.node.connectorIds.length > 0
      ? [`Planner connector scope: ${params.node.connectorIds.join(", ")}.`]
      : []),
    ...(incoming.length > 0 ? [`Receives work from: ${incoming.join("; ")}.`] : []),
    ...(outgoing.length > 0 ? [`Delegates or routes work to: ${outgoing.join("; ")}.`] : []),
  ];
}

function createRuntimeGraphBundleFromBuildSpecNode(params: {
  node: BuildSpec["graph"]["nodes"][number];
  graph: BuildSpec["graph"];
  baseBundle: AgentBlueprintBundle;
  fallbackTemplateId: string;
}): AgentBlueprintBundle {
  const templateId = inferPlannerNodeTemplateId({
    node: params.node,
    fallbackTemplateId: params.fallbackTemplateId,
  });
  const hasOutgoingEdges = params.graph.edges.some((edge) => edge.fromNodeId === params.node.id);
  const next = params.node.entry
    ? structuredClone(params.baseBundle)
    : structuredClone(getAgentBlueprintTemplate(templateId) ?? params.baseBundle);

  next.agent.agentId = params.node.entry
    ? normalizeAgentId(params.baseBundle.agent.agentId)
    : normalizeAgentId(`${params.baseBundle.agent.agentId}-${params.node.id}`);
  next.agent.name = params.node.entry
    ? params.baseBundle.agent.name
    : `${params.baseBundle.agent.name} ${params.node.label}`;
  if (params.baseBundle.runtime.model?.trim()) {
    next.runtime.model = params.baseBundle.runtime.model;
  }
  next.runtime.subagents =
    params.graph.nodes.length > 1 && hasOutgoingEdges
      ? {
          enabled: true,
          mode: "inherit",
        }
      : { enabled: false };

  next.workspace.notes = [
    ...(next.workspace.notes ?? []),
    ...buildPlannerNodeWorkspaceNotes({
      node: params.node,
      graph: params.graph,
      baseAgentName: params.baseBundle.agent.name,
    }),
  ];
  next.validation = {
    ...next.validation,
    successCriteria: [
      ...(next.validation?.successCriteria ?? []),
      `Node ${params.node.label} satisfies its assigned planner role.`,
    ],
  };

  if (!params.node.entry) {
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
  }

  return next;
}

function buildRuntimeGraphDraftFromBuildSpec(params: {
  buildSpec: BuildSpec;
  bundle: AgentBlueprintBundle;
  templateId: string;
}): AgentBlueprintBuilderRuntimeGraphDraft {
  const entryNodeId =
    params.buildSpec.graph.nodes.find((node) => node.entry)?.id ??
    params.buildSpec.graph.entryNodeId;
  const nodes = params.buildSpec.graph.nodes.map((node) => {
    const bundle = createRuntimeGraphBundleFromBuildSpecNode({
      node: {
        ...node,
        entry: node.id === entryNodeId,
      },
      graph: {
        ...params.buildSpec.graph,
        entryNodeId,
      },
      baseBundle: params.bundle,
      fallbackTemplateId: params.templateId,
    });
    return {
      id: node.id,
      roleId: node.roleId,
      label: node.label,
      templateId: inferPlannerNodeTemplateId({
        node: {
          ...node,
          entry: node.id === entryNodeId,
        },
        fallbackTemplateId: params.templateId,
      }),
      entry: node.id === entryNodeId,
      agentId: normalizeAgentId(bundle.agent.agentId),
      name: bundle.agent.name,
      interactionMode: bundle.ingress?.interactionMode ?? "direct",
      connectorIds: [...node.connectorIds],
      responsibilities: [...node.responsibilities],
      deliveryTarget: summarizeDeliveryTarget(bundle),
      schedule: summarizeSchedule(bundle),
      bundle,
    } satisfies AgentBlueprintBuilderRuntimeGraphNodeDraft;
  });

  return {
    mode: params.buildSpec.graph.mode,
    entryNodeId,
    nodes,
    edges: params.buildSpec.graph.edges.map((edge) => ({
      id: edge.id,
      fromNodeId: edge.fromNodeId,
      toNodeId: edge.toNodeId,
      kind: edge.kind,
      label: edge.label,
    })),
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

function buildRuntimeGraphWorkspacePreviews(params: {
  graph: AgentBlueprintBuilderRuntimeGraphDraft;
  graphPlans: AgentBlueprintBuilderPlan["graphPlans"];
  buildSpec?: BuildSpec;
  workspaceDocEdits?: AgentBlueprintBuilderManagedDocEdit[];
}): AgentBlueprintBuilderPlan["workspacePreviews"] {
  const docEditMap = new Map(
    (params.workspaceDocEdits ?? []).map((entry) => [
      `${entry.nodeId}:${entry.fileName}`,
      entry.content,
    ]),
  );
  const plannerManagedSections = new Map(
    (params.buildSpec?.workspaceArtifacts ?? [])
      .filter((artifact) => artifact.managedSection?.trim())
      .map((artifact) => [artifact.fileName, artifact.managedSection?.trim() ?? ""]),
  );

  return params.graphPlans.map((entry) => ({
    nodeId: entry.nodeId,
    roleId: entry.roleId,
    entry: entry.entry,
    files: (() => {
      const previewFiles = previewAgentBlueprintManagedWorkspaceDocs({
        bundle:
          params.graph.nodes.find((node) => node.id === entry.nodeId)?.bundle ??
          (() => {
            throw new Error(`Missing runtime graph bundle for node ${entry.nodeId}.`);
          })(),
        plan: entry.plan,
        managedSectionOverrides: Object.fromEntries(
          entry.plan.workspace.bootstrapFiles
            .map((file) => {
              const edited = docEditMap.get(`${entry.nodeId}:${file.name}`)?.trim();
              if (edited) {
                return [file.name, edited] as const;
              }
              if (entry.entry) {
                const plannerManagedSection = plannerManagedSections.get(file.name)?.trim();
                if (plannerManagedSection) {
                  return [file.name, plannerManagedSection] as const;
                }
              }
              return null;
            })
            .filter((value): value is readonly [string, string] => Boolean(value)),
        ),
      });
      const bootstrapFileNames = new Set(
        entry.plan.workspace.bootstrapFiles.map((file) => file.name),
      );
      const extraManagedDocs =
        entry.entry && params.buildSpec
          ? params.buildSpec.workspaceArtifacts
              .filter(
                (artifact) =>
                  artifact.managedSection?.trim() && !bootstrapFileNames.has(artifact.fileName),
              )
              .map((artifact) => ({
                name: artifact.fileName,
                content:
                  docEditMap.get(`${entry.nodeId}:${artifact.fileName}`)?.trim() ??
                  artifact.managedSection?.trim() ??
                  "",
              }))
              .filter((artifact) => artifact.content.length > 0)
          : [];
      return [...previewFiles, ...extraManagedDocs];
    })(),
  }));
}

function buildRuntimeGraphManagedSectionOverrides(params: {
  draft: AgentBlueprintBuilderDraft;
  nodeId: string;
  workspaceDocEdits?: AgentBlueprintBuilderManagedDocEdit[];
}): Record<string, string> {
  const plannerManagedSections =
    params.draft.runtimeGraph.entryNodeId === params.nodeId
      ? Object.fromEntries(
          (params.draft.buildSpec.workspaceArtifacts ?? [])
            .filter((artifact) => artifact.managedSection?.trim())
            .map((artifact) => [artifact.fileName, artifact.managedSection?.trim() ?? ""]),
        )
      : {};
  const userEdits = Object.fromEntries(
    (params.workspaceDocEdits ?? [])
      .filter((entry) => entry.nodeId === params.nodeId && entry.content.trim())
      .map((entry) => [entry.fileName, entry.content.trim()]),
  );
  return {
    ...plannerManagedSections,
    ...userEdits,
  };
}

function buildRuntimeGraphExtraManagedWorkspaceDocs(params: {
  draft: AgentBlueprintBuilderDraft;
  nodeId: string;
  bootstrapFileNames: string[];
  workspaceDocEdits?: AgentBlueprintBuilderManagedDocEdit[];
}): AgentBlueprintManagedWorkspaceDocPreview[] {
  if (params.draft.runtimeGraph.entryNodeId !== params.nodeId) {
    return [];
  }
  const bootstrapFiles = new Set(params.bootstrapFileNames);
  return (params.draft.buildSpec.workspaceArtifacts ?? [])
    .filter((artifact) => artifact.managedSection?.trim() && !bootstrapFiles.has(artifact.fileName))
    .map((artifact) => {
      const edited = params.workspaceDocEdits
        ?.find((entry) => entry.nodeId === params.nodeId && entry.fileName === artifact.fileName)
        ?.content.trim();
      return {
        name: artifact.fileName,
        content: edited || artifact.managedSection?.trim() || "",
      } satisfies AgentBlueprintManagedWorkspaceDocPreview;
    })
    .filter((artifact) => artifact.content.length > 0);
}

function withDraftPlanning(
  draft: AgentBlueprintBuilderDraft,
  planning: RequirementPlannerResult,
  cfg?: OpenClawConfig,
): AgentBlueprintBuilderDraft {
  const buildSpec = synchronizeBuildSpec({
    buildSpec: draft.buildSpec,
    requirements: draft.requirements,
    planning,
    questions: draft.questions,
    cfg,
  });
  return {
    ...draft,
    plannerStatus: planning.status,
    ready: planning.status === "ready",
    buildSpec,
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

function describeBuilderPlannerBlockers(draft: AgentBlueprintBuilderDraft): string {
  const blockers = [
    ...draft.requirements.missingInputs.map((gap) => gap.message),
    ...draft.requirements.setupGaps.map((gap) => gap.message),
    ...draft.requirements.policyGaps.map((gap) => gap.message),
    ...draft.requirements.unsupportedGaps.map((gap) => gap.message),
    ...draft.planning.integrations.flatMap((integration) => integration.issues),
    ...draft.planning.verifications
      .filter(
        (verification) => verification.status === "failed" || verification.status === "blocked",
      )
      .map((verification) => `${verification.connectorLabel}: ${verification.detail}`),
  ]
    .map((value) => value.trim())
    .filter(Boolean);
  return blockers.join(" ");
}

function collectBuildSpecPolicyBlockers(buildSpec: Pick<BuildSpec, "policy">): string[] {
  return buildSpec.policy?.approval.blockers.filter((value) => value.trim().length > 0) ?? [];
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

async function buildAgentBlueprintDraftInternal(params: {
  brief: string;
  approvalPosture?: RequirementApprovalPosture;
  templateId?: string;
  modelId?: string;
  agentName?: string;
  cfg?: OpenClawConfig;
}): Promise<{
  draft: AgentBlueprintBuilderDraft;
  planning: RequirementPlannerResult;
}> {
  const brief = params.brief.trim();
  if (!brief) {
    throw new Error("A builder brief is required.");
  }

  const capabilityRegistry = buildOpenClawCapabilityRegistry();
  const extractedRequirements = buildRequirementSet({
    brief,
    approvalPosture: params.approvalPosture,
    cfg: params.cfg,
    registry: capabilityRegistry,
  });
  const selection = selectTemplate(extractedRequirements, params.templateId);
  const initialPlanning = buildRequirementPlannerResult({
    requirements: extractedRequirements,
    cfg: params.cfg,
    registry: capabilityRegistry,
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

  const requestedAgentName =
    normalizeBuilderAgentName(params.agentName) ?? extractRequestedName(brief);
  const renamed = withAgentIdentity(bundle, requestedAgentName);
  bundle = renamed.bundle;
  assumptions.push(...renamed.assumptions);

  const customized = applyPlannerWorkflowShape(bundle, {
    brief,
    templateId: selection.templateId,
    requirements: extractedRequirements,
    planning: initialPlanning,
    cfg: params.cfg,
  });
  bundle = customized.bundle;
  assumptions.push(...customized.assumptions);
  questions.push(...customized.questions);

  const documented = ensureManagedWorkspaceBootstrapFiles(bundle);
  bundle = documented.bundle;
  assumptions.push(...documented.assumptions);

  const explicitModelId = params.modelId?.trim();
  if (explicitModelId) {
    bundle.runtime.model = explicitModelId;
    assumptions.push(`Pinned runtime model to ${explicitModelId}.`);
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
    registry: capabilityRegistry,
  });
  const deterministicRuntimeGraph = buildDeterministicRuntimeGraphDraft({
    bundle,
    templateId: selection.templateId,
    planning,
    requirements,
  });
  const plannerAgent = await runBuilderPlannerAgent({
    brief,
    cfg: params.cfg,
    bundle,
    requirements,
    planning,
    templateId: selection.templateId,
    templateDisplayName: bundle.manifest.displayName,
    templateConfidence: selection.confidence,
    templateReasons: selection.reasons,
    assumptions,
    questions: uniqueQuestions,
    capabilityRegistry,
    templateExemplars: listAgentBlueprintCatalog(),
    runtimeGraph: summarizeRuntimeGraph(deterministicRuntimeGraph),
  });
  const buildSpec = synchronizeBuildSpec({
    buildSpec: plannerAgent.buildSpec,
    requirements,
    planning,
    questions: uniqueQuestions,
    cfg: params.cfg,
  });
  const runtimeGraph = buildRuntimeGraphDraftFromBuildSpec({
    buildSpec,
    bundle,
    templateId: selection.templateId,
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
    buildSpec,
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
  approvalPosture?: RequirementApprovalPosture;
  templateId?: string;
  modelId?: string;
  agentName?: string;
  cfg?: OpenClawConfig;
}): Promise<AgentBlueprintBuilderDraft> {
  return buildAgentBlueprintDraftInternal(params).then((result) => result.draft);
}

function stripBundleFromDraft(
  draft: AgentBlueprintBuilderDraft,
): AgentBlueprintBuilderDraftSummary {
  const { bundle: _bundle, runtimeGraph: _runtimeGraph, ...summary } = draft;
  return summary;
}

export async function compileAgentBlueprintBuilderPlan(params: {
  brief: string;
  approvalPosture?: RequirementApprovalPosture;
  templateId?: string;
  modelId?: string;
  agentName?: string;
  workspaceDocEdits?: AgentBlueprintBuilderManagedDocEdit[];
  cfg?: OpenClawConfig;
}): Promise<AgentBlueprintBuilderPlan> {
  const built = await buildAgentBlueprintDraftInternal({
    ...params,
    cfg: params.cfg,
  });
  const planning = await hydratePersistedPlanningState(built.planning);
  const draft = withDraftPlanning(built.draft, planning, params.cfg);
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
    workspacePreviews: buildRuntimeGraphWorkspacePreviews({
      graph: draft.runtimeGraph,
      graphPlans,
      buildSpec: draft.buildSpec,
      workspaceDocEdits: params.workspaceDocEdits,
    }),
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
  approvalPosture?: RequirementApprovalPosture;
  templateId?: string;
  modelId?: string;
  agentName?: string;
  workspaceDocEdits?: AgentBlueprintBuilderManagedDocEdit[];
  cfg?: OpenClawConfig;
  cron?: CronService;
}): Promise<AgentBlueprintBuilderApplyResult> {
  const cfg = params.cfg ?? loadConfig();
  const built = await buildAgentBlueprintDraftInternal({
    ...params,
    cfg,
  });
  const verification = await runRequirementPlannerLiveVerification({
    planning: built.planning,
    cfg,
  });
  const draft = withDraftPlanning(built.draft, verification.planning, cfg);
  const policyBlockers = collectBuildSpecPolicyBlockers(draft.buildSpec);
  if (
    policyBlockers.length > 0 &&
    (draft.plannerStatus === "unsafe_without_policy" || draft.plannerStatus === "ready")
  ) {
    throw new Error(`Builder safety policy is unresolved. ${policyBlockers.join(" ")}`.trim());
  }
  if (draft.plannerStatus !== "ready") {
    const blockers = describeBuilderPlannerBlockers(draft);
    throw new Error(`Builder planner is ${draft.plannerStatus}. ${blockers}`.trim());
  }
  if (hasBlockingSetupActions(draft.buildSpec)) {
    throw new Error("Builder setup is still incomplete. Finish the pending setup actions first.");
  }
  const authBlockers = await collectApplyAuthRunnableBlockers({
    draft,
    cfg,
  });
  if (authBlockers.length > 0) {
    throw new Error(`Builder auth is not runnable. ${authBlockers.join(" ")}`.trim());
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
      workspaceManagedSections: buildRuntimeGraphManagedSectionOverrides({
        draft,
        nodeId: node.id,
        workspaceDocEdits: params.workspaceDocEdits,
      }),
      extraManagedWorkspaceDocs: buildRuntimeGraphExtraManagedWorkspaceDocs({
        draft,
        nodeId: node.id,
        bootstrapFileNames: node.bundle.workspace.bootstrapFiles ?? [],
        workspaceDocEdits: params.workspaceDocEdits,
      }),
      ...(params.cron ? { cron: params.cron } : {}),
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
      workspaceManagedSections: buildRuntimeGraphManagedSectionOverrides({
        draft,
        nodeId: draft.runtimeGraph.entryNodeId,
        workspaceDocEdits: params.workspaceDocEdits,
      }),
      extraManagedWorkspaceDocs: buildRuntimeGraphExtraManagedWorkspaceDocs({
        draft,
        nodeId: draft.runtimeGraph.entryNodeId,
        bootstrapFileNames:
          draft.runtimeGraph.nodes.find((node) => node.id === draft.runtimeGraph.entryNodeId)
            ?.bundle.workspace.bootstrapFiles ?? [],
        workspaceDocEdits: params.workspaceDocEdits,
      }),
      ...(params.cron ? { cron: params.cron } : {}),
    }));
  return {
    draft: stripBundleFromDraft(draft),
    result,
    graphResults,
  };
}

export async function verifyAgentBlueprintBuilderPlan(params: {
  brief: string;
  approvalPosture?: RequirementApprovalPosture;
  templateId?: string;
  modelId?: string;
  agentName?: string;
  workspaceDocEdits?: AgentBlueprintBuilderManagedDocEdit[];
  cfg?: OpenClawConfig;
}): Promise<AgentBlueprintBuilderVerifyResult> {
  const cfg = params.cfg ?? loadConfig();
  const built = await buildAgentBlueprintDraftInternal({
    ...params,
    cfg,
  });
  const verificationResult = await runRequirementPlannerLiveVerification({
    planning: built.planning,
    cfg,
  });
  const draft = withDraftPlanning(built.draft, verificationResult.planning, cfg);
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
    workspacePreviews: buildRuntimeGraphWorkspacePreviews({
      graph: draft.runtimeGraph,
      graphPlans,
      buildSpec: draft.buildSpec,
      workspaceDocEdits: params.workspaceDocEdits,
    }),
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
