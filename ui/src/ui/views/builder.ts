import { html, nothing } from "lit";
import {
  APPROVAL_POSTURES,
  formatApprovalPostureLabel,
  type ApprovalPosture,
} from "../../../../src/agents/capabilities/approval-posture.js";
import type { AppViewState } from "../app-view-state.ts";
import {
  applyBuilderPlan,
  loadBuilderPlan,
  resetBuilderWorkspaceDocEdit,
  type BuilderState,
  updateBuilderWorkspaceDocEdit,
  verifyBuilderPlan,
} from "../controllers/builder.ts";
import { normalizePath, pathForTab, type Tab } from "../navigation.ts";
import { saveBuilderDraft, saveBuilderSetupSession } from "../storage.ts";
import {
  resolveBuilderDefaultModelLabel,
  resolveBuilderModelOverrideOptions,
} from "./agents-utils.ts";

const BUILDER_TEMPLATE_OPTIONS = [
  { value: "", label: "Auto select" },
  { value: "personal-assistant", label: "Personal Assistant" },
  { value: "daily-briefing", label: "Daily Briefing Agent" },
  { value: "support-responder", label: "Support Responder" },
  { value: "research-agent", label: "Research Agent" },
] as const;

// ---------------------------------------------------------------------------
// Config ref → settings tab + section mapping
// ---------------------------------------------------------------------------

type ConfigTarget = {
  tab: Tab;
  section?: string;
  /** The state property to set (e.g. "communicationsActiveSection") */
  sectionKey?: string;
};

/**
 * Maps config sections to their settings tab and section state property.
 * The key is the first segment of a config ref (e.g. "channels" from "channels.telegram").
 */
const CONFIG_SECTION_MAP: Record<string, ConfigTarget> = {
  // Dedicated setup views
  channels: {
    tab: "channels",
  },
  nodes: {
    tab: "nodes",
  },
  logs: {
    tab: "logs",
  },
  // Communications tab
  messages: {
    tab: "communications",
    section: "messages",
    sectionKey: "communicationsActiveSection",
  },
  broadcast: {
    tab: "communications",
    section: "broadcast",
    sectionKey: "communicationsActiveSection",
  },
  talk: { tab: "communications", section: "talk", sectionKey: "communicationsActiveSection" },
  audio: { tab: "communications", section: "audio", sectionKey: "communicationsActiveSection" },
  // AI & Agents tab
  agents: { tab: "aiAgents", section: "agents", sectionKey: "aiAgentsActiveSection" },
  models: { tab: "aiAgents", section: "models", sectionKey: "aiAgentsActiveSection" },
  skills: { tab: "aiAgents", section: "skills", sectionKey: "aiAgentsActiveSection" },
  tools: { tab: "aiAgents", section: "tools", sectionKey: "aiAgentsActiveSection" },
  memory: { tab: "aiAgents", section: "memory", sectionKey: "aiAgentsActiveSection" },
  session: { tab: "aiAgents", section: "session", sectionKey: "aiAgentsActiveSection" },
  // Automation tab
  commands: { tab: "automation", section: "commands", sectionKey: "automationActiveSection" },
  hooks: { tab: "automation", section: "hooks", sectionKey: "automationActiveSection" },
  bindings: { tab: "automation", section: "bindings", sectionKey: "automationActiveSection" },
  cron: { tab: "automation", section: "cron", sectionKey: "automationActiveSection" },
  approvals: { tab: "automation", section: "approvals", sectionKey: "automationActiveSection" },
  plugins: { tab: "automation", section: "plugins", sectionKey: "automationActiveSection" },
  // Infrastructure tab
  gateway: { tab: "infrastructure", section: "gateway", sectionKey: "infrastructureActiveSection" },
  web: { tab: "infrastructure", section: "web", sectionKey: "infrastructureActiveSection" },
  browser: { tab: "infrastructure", section: "browser", sectionKey: "infrastructureActiveSection" },
  nodeHost: {
    tab: "infrastructure",
    section: "nodeHost",
    sectionKey: "infrastructureActiveSection",
  },
  canvasHost: {
    tab: "infrastructure",
    section: "canvasHost",
    sectionKey: "infrastructureActiveSection",
  },
  discovery: {
    tab: "infrastructure",
    section: "discovery",
    sectionKey: "infrastructureActiveSection",
  },
  media: { tab: "infrastructure", section: "media", sectionKey: "infrastructureActiveSection" },
  // Core config tab
  env: { tab: "config", section: "env", sectionKey: "configActiveSection" },
  auth: { tab: "config", section: "auth", sectionKey: "configActiveSection" },
  update: { tab: "config", section: "update", sectionKey: "configActiveSection" },
  meta: { tab: "config", section: "meta", sectionKey: "configActiveSection" },
  logging: { tab: "config", section: "logging", sectionKey: "configActiveSection" },
};

const CONNECTOR_SETUP_REF_MAP: Record<string, string> = {
  "platform:core-model": "models",
  "platform:exec-approvals": "approvals.exec",
  "platform:gmail-hook": "hooks.gmail",
  "platform:observability": "logs",
  "platform:webhook-runtime": "hooks",
  "tools:agents": "agents",
  "tools:automation": "cron",
  "tools:fs": "tools",
  "tools:media": "media",
  "tools:memory": "memory",
  "tools:messaging": "messages",
  "tools:nodes": "nodes",
  "tools:runtime": "tools",
  "tools:sessions": "session",
  "tools:ui": "browser",
  "tools:web": "web",
};

const CONNECTOR_SETUP_LABEL_MAP: Record<string, string> = {
  "platform:core-model": "Open model setup",
  "platform:exec-approvals": "Open approvals setup",
  "platform:gmail-hook": "Open Gmail hook setup",
  "platform:observability": "Open logs and debug setup",
  "platform:webhook-runtime": "Open webhook runtime setup",
  "tools:agents": "Open agent runtime setup",
  "tools:automation": "Open automation setup",
  "tools:fs": "Open file access setup",
  "tools:media": "Open media setup",
  "tools:memory": "Open memory setup",
  "tools:messaging": "Open messaging setup",
  "tools:nodes": "Open nodes setup",
  "tools:runtime": "Open runtime tools setup",
  "tools:sessions": "Open session and subagent setup",
  "tools:ui": "Open browser and canvas setup",
  "tools:web": "Open web tools setup",
};

const REF_SETUP_LABEL_MAP: Record<string, string> = {
  agents: "Open agent runtime setup",
  approvals: "Open approvals setup",
  auth: "Open auth setup",
  audio: "Open audio setup",
  bindings: "Open bindings setup",
  browser: "Open browser setup",
  broadcast: "Open broadcast setup",
  channels: "Open channel setup",
  commands: "Open commands setup",
  cron: "Open cron setup",
  env: "Open environment setup",
  hooks: "Open webhook setup",
  logging: "Open logging setup",
  logs: "Open logs and debug setup",
  memory: "Open memory setup",
  messages: "Open messaging setup",
  models: "Open model setup",
  nodes: "Open nodes setup",
  session: "Open session and subagent setup",
  skills: "Open skills setup",
  talk: "Open voice setup",
  tools: "Open tool access setup",
  web: "Open web setup",
};

/**
 * Map a connectorId like "platform:gmail-hook" or "channel:telegram" to a config ref
 * like "hooks" or "channels.telegram" that can be resolved to a settings section.
 */
export function connectorIdToConfigRef(connectorId: string): string | null {
  if (!connectorId) {
    return null;
  }

  if (connectorId.startsWith("channel:")) {
    return `channels.${connectorId.slice("channel:".length)}`;
  }
  const explicitRef = CONNECTOR_SETUP_REF_MAP[connectorId];
  if (explicitRef) {
    return explicitRef;
  }
  if (connectorId.includes("gmail") || connectorId.includes("hook")) {
    return "hooks";
  }
  if (
    connectorId.includes("model") ||
    connectorId.includes("openai") ||
    connectorId.includes("anthropic") ||
    connectorId.includes("ollama") ||
    connectorId.includes("groq")
  ) {
    return "models";
  }
  if (connectorId.includes("approval")) {
    return "approvals";
  }
  const parts = connectorId.split(":");
  if (parts.length >= 2) {
    const section = parts[1].split("-")[0];
    if (CONFIG_SECTION_MAP[section]) {
      return section;
    }
  }
  return null;
}

/** Resolve the first config ref from a list to a navigable config target, or null. */
function resolveConfigTarget(refs: string[]): ConfigTarget | null {
  for (const ref of refs) {
    const firstSegment = ref.split(".")[0];
    const target = CONFIG_SECTION_MAP[firstSegment];
    if (target) {
      return target;
    }
  }
  return null;
}

function normalizeModelProvider(modelRefRaw: string | null | undefined): string | null {
  const modelRef = modelRefRaw?.trim();
  if (!modelRef) {
    return null;
  }
  const slashIndex = modelRef.indexOf("/");
  if (slashIndex <= 0) {
    return null;
  }
  const provider = modelRef.slice(0, slashIndex).trim().toLowerCase();
  return provider || null;
}

const GUIDED_BUILDER_SETUP_CONNECTOR_IDS = new Set([
  "channel:whatsapp",
  "platform:exec-approvals",
  "platform:gmail-hook",
  "platform:core-model",
  "tools:web",
]);

export function shouldOpenBuilderQuickSetup(connectorId: string | null): boolean {
  if (!connectorId) {
    return false;
  }
  if (GUIDED_BUILDER_SETUP_CONNECTOR_IDS.has(connectorId)) {
    return true;
  }
  // Prefer guided onboarding for all messaging channels so setup stays in one flow.
  return connectorId.startsWith("channel:");
}

function normalizeBuilderApprovalPosture(
  value: string | null | undefined,
): ApprovalPosture | undefined {
  const trimmed = value?.trim();
  return trimmed && APPROVAL_POSTURES.includes(trimmed as ApprovalPosture)
    ? (trimmed as ApprovalPosture)
    : undefined;
}

function setOptionalBuilderSetupParam(
  searchParams: URLSearchParams,
  key: string,
  value: string | null | undefined,
) {
  const trimmed = value?.trim() ?? "";
  if (trimmed) {
    searchParams.set(key, trimmed);
    return;
  }
  searchParams.delete(key);
}

export function buildBuilderSetupUrl(
  currentUrl: string,
  basePath: string,
  focus: NonNullable<AppViewState["builderSetupFocus"]>,
): string {
  const url = new URL(currentUrl);
  url.pathname = normalizePath(pathForTab(focus.targetTab, basePath));
  url.searchParams.delete("session");
  for (const key of [
    "builderSetupActionId",
    "builderSetupConnectorId",
    "builderSetupLabel",
    "builderSetupKind",
    "builderSetupSourceKind",
    "builderSetupDocsPath",
    "builderSetupSelectionLabel",
    "builderSetupDetailLabel",
    "builderSetupOnboarding",
    "builderSetupRequiresConfig",
    "builderSetupRequiresAuth",
    "builderSetupInstallRequired",
    "builderSetupInstallStrategy",
    "builderSetupTitle",
    "builderSetupDetail",
    "builderSetupTargetTab",
    "builderSetupRef",
  ]) {
    url.searchParams.delete(key);
  }
  setOptionalBuilderSetupParam(url.searchParams, "builderSetupActionId", focus.actionId);
  setOptionalBuilderSetupParam(url.searchParams, "builderSetupConnectorId", focus.connectorId);
  setOptionalBuilderSetupParam(url.searchParams, "builderSetupLabel", focus.connectorLabel);
  setOptionalBuilderSetupParam(url.searchParams, "builderSetupKind", focus.connectorKind);
  setOptionalBuilderSetupParam(
    url.searchParams,
    "builderSetupSourceKind",
    focus.connectorSourceKind,
  );
  setOptionalBuilderSetupParam(url.searchParams, "builderSetupDocsPath", focus.connectorDocsPath);
  setOptionalBuilderSetupParam(
    url.searchParams,
    "builderSetupSelectionLabel",
    focus.connectorSelectionLabel,
  );
  setOptionalBuilderSetupParam(
    url.searchParams,
    "builderSetupDetailLabel",
    focus.connectorDetailLabel,
  );
  if (typeof focus.connectorOnboarding === "boolean") {
    url.searchParams.set("builderSetupOnboarding", String(focus.connectorOnboarding));
  }
  if (typeof focus.connectorRequiresConfig === "boolean") {
    url.searchParams.set("builderSetupRequiresConfig", String(focus.connectorRequiresConfig));
  }
  if (typeof focus.connectorRequiresAuth === "boolean") {
    url.searchParams.set("builderSetupRequiresAuth", String(focus.connectorRequiresAuth));
  }
  if (typeof focus.connectorInstallRequired === "boolean") {
    url.searchParams.set("builderSetupInstallRequired", String(focus.connectorInstallRequired));
  }
  setOptionalBuilderSetupParam(
    url.searchParams,
    "builderSetupInstallStrategy",
    focus.connectorInstallStrategy,
  );
  setOptionalBuilderSetupParam(url.searchParams, "builderSetupTitle", focus.title);
  setOptionalBuilderSetupParam(url.searchParams, "builderSetupDetail", focus.detail);
  url.searchParams.set("builderSetupTargetTab", focus.targetTab);
  for (const ref of focus.refs) {
    const trimmed = ref.trim();
    if (trimmed) {
      url.searchParams.append("builderSetupRef", trimmed);
    }
  }
  return url.toString();
}

function titleCaseWords(value: string): string {
  return value
    .split(/[\s._:-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function setupActionLabel(params: {
  connectorId?: string;
  connectorLabel?: string;
  refs?: string[];
  title?: string;
}): string {
  const connectorId = params.connectorId?.trim() ?? "";
  const connectorLabel = params.connectorLabel?.trim() ?? "";
  const refs = params.refs ?? [];
  const explicitLabel = connectorId ? CONNECTOR_SETUP_LABEL_MAP[connectorId] : null;
  if (explicitLabel) {
    return explicitLabel;
  }
  if (connectorId.startsWith("channel:")) {
    return `Open ${connectorLabel || titleCaseWords(connectorId.slice("channel:".length))} setup`;
  }
  const firstRef = refs[0]?.split(".")[0];
  if (firstRef && REF_SETUP_LABEL_MAP[firstRef]) {
    return REF_SETUP_LABEL_MAP[firstRef];
  }
  if (connectorLabel) {
    return `Open ${connectorLabel} setup`;
  }
  return params.title?.trim() ? `Open ${params.title.trim()}` : "Open setup";
}

export function hasPendingSetupTask(
  tasks: Array<{ connectorId: string; status: string }>,
  connectorId: string | undefined,
): boolean {
  const normalized = connectorId?.trim();
  if (!normalized) {
    return false;
  }
  return tasks.some((task) => task.connectorId === normalized && task.status !== "completed");
}

/** Navigate to a config section. Sets the tab and the active section. */
function navigateToConfig(
  state: AppViewState,
  refs: string[],
  params?: {
    actionId?: string;
    connectorId?: string;
    connectorLabel?: string;
    connectorKind?: string;
    connectorSourceKind?: string;
    connectorDocsPath?: string;
    connectorSelectionLabel?: string;
    connectorDetailLabel?: string;
    connectorOnboarding?: boolean;
    connectorRequiresConfig?: boolean;
    connectorRequiresAuth?: boolean;
    connectorInstallRequired?: boolean;
    connectorInstallStrategy?: "none" | "bundled" | "npm" | "local" | "external";
    actionKind?: "install" | "connect" | "configure" | "enable" | "policy" | "verify" | "question";
    actionSource?:
      | "setup-task"
      | "verification"
      | "requirement-gap"
      | "planner-question"
      | "runtime-auth";
    requiredFields?: NonNullable<
      NonNullable<
        AppViewState["builderPlan"]
      >["draft"]["buildSpec"]["setupActions"][number]["requiredFields"]
    >;
    uiSchema?: NonNullable<
      NonNullable<
        AppViewState["builderPlan"]
      >["draft"]["buildSpec"]["setupActions"][number]["uiSchema"]
    >;
    completionSignal?: NonNullable<
      NonNullable<
        AppViewState["builderPlan"]
      >["draft"]["buildSpec"]["setupActions"][number]["completionSignal"]
    >;
    title?: string;
    detail?: string;
  },
) {
  const connectorId = params?.connectorId?.trim() || null;
  const actionTitle = setupActionLabel({
    connectorId: connectorId ?? undefined,
    connectorLabel: params?.connectorLabel,
    refs,
    title: params?.title,
  });
  const focusTitle = params?.title?.trim() || actionTitle;
  const focusDetail =
    params?.detail?.trim() ||
    "Finish the requested setup here, save or apply your changes, then return to Builder and rebuild or verify.";

  const scrollToTop = () => {
    if (typeof window === "undefined") {
      return;
    }
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  };

  // Guided Builder setup should open the dedicated Setup tab so the user sees
  // the focused assist card rather than landing in a generic config surface.
  if (shouldOpenBuilderQuickSetup(connectorId)) {
    const focus: NonNullable<AppViewState["builderSetupFocus"]> = {
      actionId: params?.actionId?.trim() || null,
      connectorId,
      connectorLabel: params?.connectorLabel?.trim() || null,
      connectorKind: params?.connectorKind?.trim() || null,
      connectorSourceKind: params?.connectorSourceKind?.trim() || null,
      connectorDocsPath: params?.connectorDocsPath?.trim() || null,
      connectorSelectionLabel: params?.connectorSelectionLabel?.trim() || null,
      connectorDetailLabel: params?.connectorDetailLabel?.trim() || null,
      connectorOnboarding: params?.connectorOnboarding,
      connectorRequiresConfig: params?.connectorRequiresConfig,
      connectorRequiresAuth: params?.connectorRequiresAuth,
      connectorInstallRequired: params?.connectorInstallRequired,
      connectorInstallStrategy: params?.connectorInstallStrategy ?? null,
      actionKind: params?.actionKind,
      actionSource: params?.actionSource ?? null,
      requiredFields: params?.requiredFields,
      uiSchema: params?.uiSchema ?? null,
      completionSignal: params?.completionSignal ?? null,
      title: focusTitle,
      detail: focusDetail,
      refs,
      targetTab: "onboarding",
    };
    state.builderSetupFocus = focus;
    state.builderSetupError = null;
    state.builderSetupResult = null;
    saveBuilderDraft({
      brief: state.builderBrief,
      approvalPosture: state.builderApprovalPosture,
      templateId: state.builderTemplateId,
      modelId: state.builderModelId,
      agentName: state.builderAgentName,
    });
    saveBuilderSetupSession({
      focus,
      inputs: state.builderSetupInputs,
      result: null,
    });
    // Guided Builder setup should open the dedicated Setup tab immediately so
    // the user lands on the focused integration surface instead of a Builder
    // banner anchored above the plan.
    state.setTab("onboarding");
    scrollToTop();
    return;
  }

  const target = resolveConfigTarget(refs);
  if (!target) {
    return;
  }
  // Set the section state before navigating so it's ready when the tab renders
  if (target.sectionKey && target.section) {
    (state as Record<string, unknown>)[target.sectionKey] = target.section;
  }
  state.builderSetupFocus = {
    actionId: params?.actionId?.trim() || null,
    connectorId,
    connectorLabel: params?.connectorLabel?.trim() || null,
    connectorKind: params?.connectorKind?.trim() || null,
    connectorSourceKind: params?.connectorSourceKind?.trim() || null,
    connectorDocsPath: params?.connectorDocsPath?.trim() || null,
    connectorSelectionLabel: params?.connectorSelectionLabel?.trim() || null,
    connectorDetailLabel: params?.connectorDetailLabel?.trim() || null,
    connectorOnboarding: params?.connectorOnboarding,
    connectorRequiresConfig: params?.connectorRequiresConfig,
    connectorRequiresAuth: params?.connectorRequiresAuth,
    connectorInstallRequired: params?.connectorInstallRequired,
    connectorInstallStrategy: params?.connectorInstallStrategy ?? null,
    actionKind: params?.actionKind,
    actionSource: params?.actionSource ?? null,
    requiredFields: params?.requiredFields,
    uiSchema: params?.uiSchema ?? null,
    completionSignal: params?.completionSignal ?? null,
    title: focusTitle,
    detail: focusDetail,
    refs,
    targetTab: target.tab,
  };
  saveBuilderSetupSession({
    focus: state.builderSetupFocus,
    inputs: state.builderSetupInputs,
    result: state.builderSetupResult,
  });
  state.setTab(target.tab);
  scrollToTop();
}

export type BuilderProps = {
  state: AppViewState;
  onSetBrief: (brief: string) => void;
  onSetApprovalPosture: (posture: ApprovalPosture) => void;
  onSetTemplate: (templateId: string) => void;
  onSetModel: (modelId: string) => void;
  onSetAgentName: (agentName: string) => void;
  onPlan: () => void;
  onVerify: () => void;
  onConfirmApply: () => void;
  onCancelApply: () => void;
  onApply: () => void;
  onOpenChat?: () => void;
};

export function triggerBuilderPlan(state: BuilderState) {
  void loadBuilderPlan(state);
}

export function triggerBuilderApply(state: BuilderState) {
  void applyBuilderPlan(state);
}

export function triggerBuilderVerify(state: BuilderState) {
  void verifyBuilderPlan(state);
}

export function renderBuilder(props: BuilderProps) {
  const { state } = props;
  const planResult = state.builderPlan;
  const workspacePreviews = planResult?.workspacePreviews ?? [];
  const draft = planResult?.draft ?? null;
  const plan = asObject(planResult?.plan);
  const issues = readObjectArray(plan, "issues");
  const blueprintStatus = readString(plan, "status", "ready");
  const blockingSetupActions =
    draft?.buildSpec.setupActions.filter(
      (action) => (action.blocking ?? false) && action.status !== "completed",
    ).length ?? 0;
  const blockingVerifications =
    draft?.planning.verifications.filter((entry) => ["blocked", "failed"].includes(entry.status))
      .length ?? 0;
  const warningVerifications =
    draft?.planning.verifications.filter((entry) => entry.status === "needs_live_check").length ??
    0;
  const canQuickApply =
    draft?.plannerStatus === "ready" &&
    blueprintStatus === "ready" &&
    blockingSetupActions === 0 &&
    blockingVerifications === 0 &&
    !state.builderApplyResult;
  const integrationByConnectorId = new Map(
    (draft?.planning.integrations ?? []).map(
      (integration) => [integration.connectorId, integration] as const,
    ),
  );
  const modelOverrideOptions = resolveBuilderModelOverrideOptions(
    state.configForm,
    state.builderModelId || undefined,
    state.cronModelSuggestions,
    state.chatModelCatalog,
  );
  const configuredModelOverrideOptions = modelOverrideOptions.filter((option) => option.configured);
  const selectedModelOption = state.builderModelId
    ? (modelOverrideOptions.find((option) => option.value === state.builderModelId) ?? null)
    : null;
  const selectedModelNeedsSetup = Boolean(
    state.builderModelId && selectedModelOption && !selectedModelOption.configured,
  );
  const currentUnconfiguredModelOption = selectedModelNeedsSetup ? selectedModelOption : null;
  const selectedModelProvider =
    selectedModelOption?.provider ?? normalizeModelProvider(state.builderModelId);
  const selectedModelProviderLabel = selectedModelProvider
    ? titleCaseWords(selectedModelProvider)
    : "Selected model provider";
  const builderDefaultModelLabel = resolveBuilderDefaultModelLabel(state.configForm);

  return html`
    <div class="builder-layout">
      <section class="card">
        <div class="card-title section-title">Describe What You Need</div>
        <div class="card-sub" style="margin-bottom:12px;">
          Tell us what you want your agent to do, in your own words. We'll figure out the
          connections, schedule, and setup for you.
        </div>

        <label class="field builder-brief-field" style="margin-bottom:12px;">
          <span>Brief</span>
          <textarea
            rows="5"
            .value=${state.builderBrief}
            placeholder="Example: Every morning at 9am, read my Gmail newsletters about AI and send me a summary of business ideas on WhatsApp."
            @input=${(event: Event) =>
              props.onSetBrief((event.target as HTMLTextAreaElement).value)}
          ></textarea>
        </label>

        <label class="field" style="max-width:360px;">
          <span>Template</span>
          <select
            .value=${state.builderTemplateId}
            @change=${(event: Event) =>
              props.onSetTemplate((event.target as HTMLSelectElement).value)}
          >
            ${BUILDER_TEMPLATE_OPTIONS.map(
              (option) => html`<option value=${option.value}>${option.label}</option>`,
            )}
          </select>
        </label>

        <label class="field" style="max-width:360px; margin-top:12px;">
          <span>Agent Name (optional)</span>
          <input
            type="text"
            .value=${state.builderAgentName}
            placeholder="Use inferred name"
            @input=${(event: Event) =>
              props.onSetAgentName((event.target as HTMLInputElement).value)}
          />
          <span class="card-sub" style="margin-top:6px;">
            Give your agent a custom name, or leave blank to use the default.
          </span>
        </label>

        <label class="field" style="max-width:360px; margin-top:12px;">
          <span>AI Model Override (optional)</span>
          <select
            .value=${state.builderModelId}
            @change=${(event: Event) => props.onSetModel((event.target as HTMLSelectElement).value)}
          >
            <option value="">Use OpenClaw default (${builderDefaultModelLabel})</option>
            ${
              configuredModelOverrideOptions.length > 0
                ? html`
                    <optgroup label="Configured (ready)">
                      ${configuredModelOverrideOptions.map(
                        (option) =>
                          html`<option value=${option.value}>
                            ${option.label} [Configured]
                          </option>`,
                      )}
                    </optgroup>
                  `
                : nothing
            }
            ${
              currentUnconfiguredModelOption
                ? html`
                    <optgroup label="Current selection (needs setup)">
                      <option value=${currentUnconfiguredModelOption.value}>
                        ${currentUnconfiguredModelOption.label} [Not configured]
                      </option>
                    </optgroup>
                  `
                : nothing
            }
          </select>
          <span class="card-sub" style="margin-top:6px;">
            OpenClaw starts from its fixed default model unless you explicitly choose another
            configured model for this agent.
          </span>
          ${
            selectedModelNeedsSetup
              ? html`
                  <div class="callout warn" style="margin-top:8px;">
                    ${selectedModelProviderLabel} credentials are not configured for this model yet.
                    <button
                      type="button"
                      class="builder-config-link"
                      @click=${() =>
                        navigateToConfig(state, ["models"], {
                          connectorId: "platform:core-model",
                          connectorLabel: "OpenClaw Core Model Runtime",
                          title: "Model provider setup",
                          detail: `Configure ${selectedModelProviderLabel} credentials, then rebuild the plan.`,
                        })}
                    >
                      Open model setup &rarr;
                    </button>
                  </div>
                `
              : nothing
          }
        </label>

        <div class="builder-actions" style="margin-top:16px;">
          <button
            type="button"
            class="btn primary"
            ?disabled=${!state.builderBrief.trim() || state.builderPlanLoading}
            @click=${props.onPlan}
          >
            ${
              state.builderPlanLoading
                ? html`
                    <span class="loading-spinner" style="font-size: 13px">Planning...</span>
                  `
                : "Build Plan"
            }
          </button>
          ${
            planResult
              ? html`
                  <div class="builder-actions__secondary">
                    <button
                      type="button"
                      class="btn btn--sm"
                      ?disabled=${state.builderVerifying}
                      @click=${props.onVerify}
                    >
                      ${
                        state.builderVerifying
                          ? html`
                              <span class="loading-spinner" style="font-size: 12px">Verifying...</span>
                            `
                          : "Check Connections"
                      }
                    </button>
                    <button
                      type="button"
                      class="btn btn--sm"
                      ?disabled=${state.builderPlanLoading}
                      @click=${props.onPlan}
                    >
                      Rebuild
                    </button>
                    <button
                      type="button"
                      class="btn btn--sm primary"
                      ?disabled=${!canQuickApply}
                      @click=${props.onConfirmApply}
                    >
                      Apply Plan
                    </button>
                  </div>
                `
              : nothing
          }
        </div>
        ${
          planResult && !state.builderApplyResult
            ? html`
                <div class="card-sub" style="margin-top: 8px">
                  This is a preview. Rebuild as needed, run a smoke test with Check Connections, then apply the plan
                  to activate the agent and its scheduled tasks.
                </div>
              `
            : nothing
        }

        ${
          state.builderPlanError
            ? html`<div class="callout danger" style="margin-top:12px;">${state.builderPlanError}</div>`
            : nothing
        }
        ${
          state.builderVerifyError
            ? html`<div class="callout danger" style="margin-top:12px;">${state.builderVerifyError}</div>`
            : nothing
        }
      </section>

      ${
        draft
          ? html`
              <section class="card">
                <div class="builder-header">
                  <div>
                    <div class="card-title section-title">Suggested Template</div>
                    <div class="card-sub">${draft.displayName} (${draft.templateId})</div>
                  </div>
                  <span class="tpl-pill tpl-pill--muted">${draft.confidence}</span>
                </div>

                <div class="builder-grid">
                  ${builderList("Reasons", draft.reasons)}
                  ${builderList("Assumptions", draft.assumptions)}
                  ${builderQuestionList(state, draft.questions)}
                  ${builderExtracted(draft)}
                </div>
              </section>

              <section class="card">
                <div class="builder-header">
                  <div class="card-title section-title">Workflow Status</div>
                  <span class="tpl-pill ${plannerStatusPillClass(draft.plannerStatus)}">
                    ${formatPlannerStatus(draft.plannerStatus)}
                  </span>
                </div>
                <div class="builder-intent-tags">
                  ${draft.requirements.intentTags.map(
                    (tag) => html`<span class="tpl-pill tpl-pill--muted">${tag}</span>`,
                  )}
                  <span class="tpl-pill tpl-pill--muted">
                    ${draft.requirements.workflow.primaryGoal}
                  </span>
                  <span class="tpl-pill tpl-pill--muted">
                    ${draft.requirements.workflow.executionMode}
                  </span>
                  <span class="tpl-pill tpl-pill--muted">
                    extraction ${draft.requirements.confidence}
                  </span>
                </div>
                <div class="builder-grid">
                  ${builderRequirementList("Triggers", draft.requirements.triggers)}
                  ${builderRequirementList("Inputs", draft.requirements.inputs)}
                  ${builderRequirementList("Transforms", draft.requirements.transforms)}
                  ${builderRequirementList("Actions", draft.requirements.actions)}
                  ${builderRequirementList("Outputs", draft.requirements.outputs)}
                  ${builderRequirementList("Policies", draft.requirements.policies)}
                  ${builderRequirementList("Constraints", draft.requirements.constraints)}
                  ${builderList("Ambiguities", draft.requirements.ambiguities)}
                  ${builderList(
                    "Missing Data",
                    draft.requirements.missingDataFields.map((value) =>
                      formatMissingDataField(value),
                    ),
                  )}
                  ${builderList("Unsupported Requests", draft.requirements.unsupportedRequests)}
                </div>
                ${renderGaps(state, draft)}
              </section>

              <section class="card">
                <div class="builder-header">
                  <div class="card-title section-title">Architecture</div>
                </div>
                <div class="builder-grid builder-grid--2col">
                  ${builderTopologyCard(draft.planning.topology)}
                  ${builderRuntimeGraphList(draft.planning.graph)}
                </div>
                ${
                  draft.planning.variants.length > 0 ||
                  draft.planning.alternatives.some((a) => a.candidates.some((c) => !c.selected))
                    ? html`
                        <div class="builder-grid builder-grid--2col" style="margin-top:4px;">
                          ${builderVariantList(draft.planning.variants)}
                          ${builderAlternativeList(draft.planning.alternatives)}
                        </div>
                      `
                    : nothing
                }
              </section>

              <section class="card">
                <div class="builder-header">
                  <div class="card-title section-title">Planner Spec</div>
                </div>
                <div class="builder-grid builder-grid--2col">
                  ${builderBuildSpecCard(draft.buildSpec)}
                  ${builderWorkspacePreviewList(
                    state,
                    workspacePreviews,
                    draft.buildSpec.workspaceArtifacts,
                  )}
                </div>
              </section>

              ${
                draft.buildSpec.policy
                  ? html`
                      <section class="card">
                        <div class="builder-header">
                          <div class="card-title section-title">Safety &amp; Policy</div>
                        </div>
                        ${builderPolicyCard({
                          policy: draft.buildSpec.policy,
                          currentBuilderPosture: normalizeBuilderApprovalPosture(
                            state.builderApprovalPosture,
                          ),
                          disabled: state.builderPlanLoading || state.builderVerifying,
                          onChoosePosture: (posture) => {
                            props.onSetApprovalPosture(posture);
                            props.onPlan();
                          },
                        })}
                      </section>
                    `
                  : nothing
              }

              <section class="card">
                <div class="builder-header">
                  <div class="card-title section-title">Integrations &amp; Setup</div>
                </div>
                <div class="builder-grid builder-grid--2col">
                  ${builderSelectionList(draft.planning.selections)}
                  ${builderIntegrationList(
                    state,
                    draft.planning.integrations,
                    draft.planning.setupTasks,
                  )}
                </div>
                <div class="builder-grid builder-grid--2col" style="margin-top:4px;">
                  ${builderSetupActionList(
                    state,
                    draft.buildSpec.setupActions.map((action) => ({
                      ...action,
                      connectorLabel:
                        action.connectorLabel ??
                        integrationByConnectorId.get(action.connectorId)?.label ??
                        action.connectorId,
                      connectorKind: integrationByConnectorId.get(action.connectorId)?.kind,
                      connectorSourceKind: integrationByConnectorId.get(action.connectorId)
                        ?.sourceKind,
                      connectorDocsPath: integrationByConnectorId.get(action.connectorId)?.docsPath,
                      connectorSelectionLabel: integrationByConnectorId.get(action.connectorId)
                        ?.selectionLabel,
                      connectorDetailLabel: integrationByConnectorId.get(action.connectorId)
                        ?.detailLabel,
                      connectorOnboarding: integrationByConnectorId.get(action.connectorId)
                        ?.onboarding,
                      connectorRequiresConfig: integrationByConnectorId.get(action.connectorId)
                        ?.requiresConfig,
                      connectorRequiresAuth: integrationByConnectorId.get(action.connectorId)
                        ?.requiresAuth,
                      connectorInstallRequired: integrationByConnectorId.get(action.connectorId)
                        ?.installRequired,
                      connectorInstallStrategy: integrationByConnectorId.get(action.connectorId)
                        ?.installStrategy,
                    })),
                  )}
                  ${builderVerificationList(
                    state,
                    draft.planning.verifications.map((verification) => ({
                      ...verification,
                      connectorKind: verification.connectorId
                        ? integrationByConnectorId.get(verification.connectorId)?.kind
                        : undefined,
                      connectorSourceKind: verification.connectorId
                        ? integrationByConnectorId.get(verification.connectorId)?.sourceKind
                        : undefined,
                      connectorDocsPath: verification.connectorId
                        ? integrationByConnectorId.get(verification.connectorId)?.docsPath
                        : undefined,
                      connectorSelectionLabel: verification.connectorId
                        ? integrationByConnectorId.get(verification.connectorId)?.selectionLabel
                        : undefined,
                      connectorDetailLabel: verification.connectorId
                        ? integrationByConnectorId.get(verification.connectorId)?.detailLabel
                        : undefined,
                      connectorOnboarding: verification.connectorId
                        ? integrationByConnectorId.get(verification.connectorId)?.onboarding
                        : undefined,
                      connectorRequiresConfig: verification.connectorId
                        ? integrationByConnectorId.get(verification.connectorId)?.requiresConfig
                        : undefined,
                      connectorRequiresAuth: verification.connectorId
                        ? integrationByConnectorId.get(verification.connectorId)?.requiresAuth
                        : undefined,
                      connectorInstallRequired: verification.connectorId
                        ? integrationByConnectorId.get(verification.connectorId)?.installRequired
                        : undefined,
                      connectorInstallStrategy: verification.connectorId
                        ? integrationByConnectorId.get(verification.connectorId)?.installStrategy
                        : undefined,
                    })),
                    draft.planning.setupTasks,
                  )}
                </div>
                ${renderVerificationRunSummary(state)}
              </section>

              <section class="card">
                <div class="builder-header">
                  <div class="card-title section-title">Blueprint Plan</div>
                  <span class="tpl-pill ${blueprintStatus === "ready" ? "tpl-pill--ok" : "tpl-pill--error"}">
                    ${blueprintStatus}
                  </span>
                </div>
                ${
                  issues.length > 0
                    ? html`
                        <div class="builder-issues">
                          ${issues.map(
                            (issue) => html`
                              <div
                                class="callout ${
                                  readString(issue, "severity", "warning") === "error"
                                    ? "danger"
                                    : "warn"
                                }"
                              >
                                ${readString(issue, "message")}
                              </div>
                            `,
                          )}
                        </div>
                      `
                    : html`
                        <div class="card-sub">No blueprint compilation issues were detected.</div>
                      `
                }
                ${builderGraphPlanList(planResult?.graphPlans ?? [], workspacePreviews)}
              </section>

              ${renderBuilderApplySection(
                props,
                state,
                draft,
                blueprintStatus,
                workspacePreviews,
                planResult?.graphPlans ?? [],
              )}
            `
          : nothing
      }
    </div>
  `;
}

function renderBuilderApplySection(
  props: BuilderProps,
  state: AppViewState,
  draft: NonNullable<AppViewState["builderPlan"]>["draft"],
  planStatus: string,
  workspacePreviews: NonNullable<AppViewState["builderPlan"]>["workspacePreviews"],
  graphPlans: NonNullable<AppViewState["builderPlan"]>["graphPlans"],
) {
  if (state.builderApplyResult) {
    const result = state.builderApplyResult.result;
    return html`
      <section class="card applied-banner">
        <div class="card-title section-title" style="color:var(--ok);">
          Agent Activated
        </div>
        <div class="card-sub" style="margin-bottom:12px;">
          Your agent is live. Open chat to interact with it, or manage agents to monitor runs,
          schedules, and approvals.
        </div>
        <div class="builder-grid">
          ${kv("Name", result.agent.name)}
          ${kv("Agent ID", result.agent.agentId)}
        </div>
        ${
          state.builderApplyResult.graphResults.length > 1
            ? html`
                <div class="label" style="margin-top:12px;">Workflow Steps</div>
                ${state.builderApplyResult.graphResults.map(
                  (node) => html`
                    <div class="tpl-plan-file">
                      <span>
                        ${node.entry ? "Entry" : "Worker"} ${node.roleId}
                        <span class="mono">(${node.result.agent.agentId})</span>
                      </span>
                      <span class="tpl-pill tpl-pill--ok">${node.result.status}</span>
                    </div>
                  `,
                )}
              `
            : nothing
        }
        ${
          result.workspace.files.length > 0
            ? html`
                <div class="label" style="margin-top:12px;">Agent Files</div>
                ${result.workspace.files.map(
                  (file) => html`
                    <div class="tpl-plan-file">
                      <span class="mono">${file.name}</span>
                      <span class="tpl-pill ${file.status === "created" ? "tpl-pill--ok" : "tpl-pill--muted"}">${file.status}</span>
                    </div>
                  `,
                )}
              `
            : nothing
        }
        ${
          result.automation.jobs.length > 0
            ? html`
                <div class="label" style="margin-top:12px;">Schedule</div>
                ${result.automation.jobs.map(
                  (job) => html`
                    <div class="tpl-plan-file">
                      <span class="mono">${job.name}</span>
                      <span class="tpl-pill tpl-pill--muted">${job.status}</span>
                    </div>
                  `,
                )}
              `
            : nothing
        }
        ${
          result.warnings.length > 0
            ? html`
                <div class="label" style="margin-top:12px;">Warnings</div>
                ${result.warnings.map(
                  (warning) => html`<div class="callout warn">${warning.message}</div>`,
                )}
              `
            : nothing
        }
        <div style="display:flex; gap:8px; margin-top:12px;">
          <button type="button" class="btn primary" @click=${() => props.onOpenChat?.()}>
            Start Chatting
          </button>
          <button type="button" class="btn" @click=${() => state.setTab("agents")}>
            Manage Agents
          </button>
        </div>
      </section>
    `;
  }

  if (state.builderApplyError) {
    return html`
      <section class="card">
        <div class="callout danger">
          Something went wrong while creating your agent. You can try again — your settings are
          saved.
        </div>
        <div class="tpl-note" style="margin-top:4px; margin-bottom:8px;">${state.builderApplyError}</div>
        <button type="button" class="btn primary" style="margin-top:12px;" @click=${props.onApply}>
          Try Again
        </button>
      </section>
    `;
  }

  if (state.builderApplying) {
    return html`
      <section class="card">
        <div class="loading-spinner" style="padding: 24px">Applying builder plan...</div>
      </section>
    `;
  }

  if (state.builderConfirmApply) {
    return html`
      <section class="card confirm-banner">
        <div class="card-title section-title">Activate Your Agent</div>
        <div class="card-sub" style="margin-bottom:12px;">
          This will activate <strong>${draft.displayName}</strong> with its schedule, workspace
          files, and connection settings. You can edit and monitor everything afterward.
        </div>
        <div style="display:flex; gap:8px;">
          <button type="button" class="btn primary" @click=${props.onApply}>Activate Agent</button>
          <button type="button" class="btn" @click=${props.onCancelApply}>Go Back</button>
        </div>
      </section>
    `;
  }

  const canApply = draft.plannerStatus === "ready" && planStatus === "ready";
  const hasPendingBlockingSetupAction = draft.buildSpec.setupActions.some(
    (action) => (action.blocking ?? false) && action.status !== "completed",
  );
  const hasBlockingVerification = draft.planning.verifications.some((entry) =>
    ["blocked", "failed"].includes(entry.status),
  );
  const hasWarningVerification = draft.planning.verifications.some(
    (entry) => entry.status === "needs_live_check",
  );
  const policyReady = isBuilderPolicyReady(draft);
  return html`
    <section class="card" style="padding:24px;">
      ${builderPreApplyChecklist(state, draft, planStatus, workspacePreviews, graphPlans)}
      <div style="text-align:center; margin-top:16px;">
      <button
        type="button"
        class="btn primary"
        ?disabled=${!canApply || hasPendingBlockingSetupAction || hasBlockingVerification || !policyReady}
        @click=${props.onConfirmApply}
      >
        Apply Builder Plan
      </button>
      ${
        canApply && !hasPendingBlockingSetupAction && !hasBlockingVerification && policyReady
          ? hasWarningVerification
            ? html`
                <div class="card-sub" style="margin-top: 8px">
                  Ready to activate your agent. Some optional smoke checks could not run automatically, but they
                  will not block setup.
                </div>
              `
            : html`
                <div class="card-sub" style="margin-top: 8px">
                  Everything looks good. Activate the agent to turn on its schedule and runtime.
                </div>
              `
          : hasPendingBlockingSetupAction
            ? html`
                <div class="card-sub" style="margin-top: 8px">Complete the setup steps above before applying.</div>
              `
            : hasBlockingVerification
              ? html`
                  <div class="card-sub" style="margin-top: 8px">Fix the failed checks above, then try again.</div>
                `
              : !policyReady
                ? html`
                    <div class="card-sub" style="margin-top: 8px">Choose a safety policy before applying.</div>
                  `
                : html`
                    <div class="card-sub" style="margin-top: 8px">
                      Some required settings are still missing. Check the items above.
                    </div>
                  `
      }
      </div>
    </section>
  `;
}

function builderList(title: string, values: string[]) {
  if (values.length === 0) {
    return nothing;
  }
  return html`
    <div>
      <div class="label" style="margin-bottom:8px;">${title}</div>
      ${values.map((value) => html`<div class="tpl-note">${value}</div>`)}
    </div>
  `;
}

function formatMissingDataField(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

type BuilderQuestion = { id?: string; prompt: string; required: boolean };

const DELIVERY_CHANNEL_REF_MAP: Record<string, string> = {
  telegram: "channels.telegram",
  discord: "channels.discord",
  slack: "channels.slack",
  signal: "channels.signal",
  whatsapp: "channels.whatsapp",
  matrix: "channels.matrix",
  msteams: "channels.msteams",
  googlechat: "channels.googlechat",
  imessage: "channels.imessage",
};

function resolveBuilderQuestionChannel(question: BuilderQuestion): string | null {
  if (question.id !== "delivery-target") {
    return null;
  }
  const prompt = question.prompt.toLowerCase();
  const channel = Object.keys(DELIVERY_CHANNEL_REF_MAP).find((key) => prompt.includes(key));
  return channel ?? null;
}

export function resolveBuilderQuestionSetupConnectorId(question: BuilderQuestion): string | null {
  const channel = resolveBuilderQuestionChannel(question);
  return channel ? `channel:${channel}` : null;
}

export function resolveBuilderQuestionConfigRefs(question: BuilderQuestion): string[] {
  const channel = resolveBuilderQuestionChannel(question);
  if (!channel) {
    return [];
  }
  return [DELIVERY_CHANNEL_REF_MAP[channel]];
}

function builderQuestionList(state: AppViewState, questions: BuilderQuestion[]) {
  if (questions.length === 0) {
    return nothing;
  }
  return html`
    <div>
      <div class="label" style="margin-bottom:8px;">Questions</div>
      ${questions.map((question) => {
        const refs = resolveBuilderQuestionConfigRefs(question);
        const channel = resolveBuilderQuestionChannel(question);
        const hasTarget = resolveConfigTarget(refs);
        return html`
            <div class="tpl-note builder-issue-row">
              <span>${question.required ? "[required]" : "[optional]"} ${question.prompt}</span>
              ${
                hasTarget
                  ? html`
                      <button
                        type="button"
                        class="builder-config-link"
                        @click=${() =>
                          navigateToConfig(state, refs, {
                            ...(channel
                              ? {
                                  connectorId:
                                    resolveBuilderQuestionSetupConnectorId(question) ?? undefined,
                                  connectorLabel: titleCaseWords(channel),
                                }
                              : {}),
                            title: "Delivery target setup",
                            detail:
                              "Set the channel default delivery target, save the change, then rebuild the Builder plan.",
                          })}
                      >
                        Open setup &rarr;
                      </button>
                    `
                  : nothing
              }
            </div>
          `;
      })}
    </div>
  `;
}

function builderBuildSpecCard(
  buildSpec: NonNullable<AppViewState["builderPlan"]>["draft"]["buildSpec"],
) {
  const scheduleBits = [
    buildSpec.schedule.description,
    buildSpec.schedule.cron,
    buildSpec.schedule.timezoneLabel ?? buildSpec.schedule.timezone,
  ].filter((value): value is string => Boolean(value && value.trim()));
  return html`
    <div>
      <div class="label" style="margin-bottom:8px;">BuildSpec</div>
      <div class="tpl-note">Planner: ${buildSpec.contract.id} (${buildSpec.contract.kind})</div>
      <div class="tpl-note">
        Planner mode: ${buildSpec.planner.mode}
        ${buildSpec.planner.usedModelRef ? ` · ${buildSpec.planner.usedModelRef}` : ""}
      </div>
      <div class="tpl-note">
        Goal: ${buildSpec.goal.primaryGoal} · ${buildSpec.goal.executionMode} · ${buildSpec.status}
      </div>
      <div class="tpl-note">
        Template: ${buildSpec.template.displayName} (${buildSpec.template.templateId})
      </div>
      <div class="tpl-note">
        Graph: ${buildSpec.graph.mode} with ${buildSpec.graph.nodes.length} node${
          buildSpec.graph.nodes.length === 1 ? "" : "s"
        }
      </div>
      ${
        scheduleBits.length > 0
          ? html`<div class="tpl-note">Schedule: ${scheduleBits.join(" · ")}</div>`
          : nothing
      }
      <div class="tpl-note">
        Planner context: ${buildSpec.context.capabilityContractCount} contracts ·
        ${buildSpec.context.connectorCount} connectors ·
        ${buildSpec.context.templateExemplarCount} exemplars
      </div>
      <div class="tpl-note">Setup actions: ${buildSpec.setupActions.length}</div>
      ${
        buildSpec.planner.fallbackReason
          ? html`<div class="tpl-note">${buildSpec.planner.fallbackReason}</div>`
          : nothing
      }
      ${
        buildSpec.workspaceArtifacts.length > 0
          ? html`
              <div class="tpl-note" style="margin-top:8px;">
                Workspace docs:
                ${buildSpec.workspaceArtifacts.map((artifact) => artifact.fileName).join(", ")}
              </div>
            `
          : nothing
      }
      ${buildSpec.notes.map((note) => html`<div class="tpl-note">${note}</div>`)}
    </div>
  `;
}

function builderWorkspacePreviewList(
  state: AppViewState,
  previews: NonNullable<AppViewState["builderPlan"]>["workspacePreviews"],
  workspaceArtifacts: NonNullable<
    AppViewState["builderPlan"]
  >["draft"]["buildSpec"]["workspaceArtifacts"],
) {
  if (previews.length === 0 && workspaceArtifacts.length === 0) {
    return nothing;
  }
  const artifactByName = new Map(
    workspaceArtifacts.map((artifact) => [artifact.fileName, artifact]),
  );
  const previewFileNames = new Set(
    previews.flatMap((preview) => preview.files.map((file) => file.name)),
  );
  const pendingArtifacts = workspaceArtifacts.filter(
    (artifact) => !previewFileNames.has(artifact.fileName),
  );
  const totalPreviewFiles = previews.reduce((total, preview) => total + preview.files.length, 0);
  const totalEditedFiles = previews.reduce(
    (total, preview) =>
      total +
      preview.files.filter((file) =>
        Object.prototype.hasOwnProperty.call(
          state.builderWorkspaceDocEdits,
          `${preview.nodeId}:${file.name}`,
        ),
      ).length,
    0,
  );
  return html`
    <div>
      <div class="label" style="margin-bottom:8px;">Workspace Authoring Review</div>
      <div class="tpl-note" style="margin-bottom:8px;">
        ${totalPreviewFiles} reviewable file${totalPreviewFiles === 1 ? "" : "s"} across
        ${previews.length} runtime node${previews.length === 1 ? "" : "s"}.
        ${
          totalEditedFiles > 0
            ? html`
                <span class="tpl-pill tpl-pill--muted" style="margin-left:8px;">
                  ${totalEditedFiles} edited in Builder
                </span>
              `
            : nothing
        }
      </div>
      ${previews.map(
        (preview) => html`
          <div class="tpl-plan-file">
            <span>${preview.entry ? "Entry" : "Worker"} ${preview.roleId}</span>
            <span class="tpl-pill tpl-pill--muted">${preview.files.length} files</span>
          </div>
          ${preview.files.map(
            (file) => html`
              <details class="tpl-note" style="margin-bottom:8px;">
                <summary>
                  ${file.name}
                  ${(() => {
                    const meta = artifactByName.get(file.name);
                    const edited = Object.prototype.hasOwnProperty.call(
                      state.builderWorkspaceDocEdits,
                      `${preview.nodeId}:${file.name}`,
                    );
                    return html`
                      ${
                        meta
                          ? html`
                              <span
                                class="tpl-pill ${workspaceArtifactStatusPillClass(meta.status)}"
                                style="margin-left:8px;"
                              >
                                ${meta.status}
                              </span>
                            `
                          : nothing
                      }
                      ${
                        edited
                          ? html`
                              <span class="tpl-pill tpl-pill--muted" style="margin-left: 8px"> edited in Builder </span>
                            `
                          : nothing
                      }
                    `;
                  })()}
                </summary>
                ${(() => {
                  const meta = artifactByName.get(file.name);
                  const key = `${preview.nodeId}:${file.name}`;
                  const edited = Object.prototype.hasOwnProperty.call(
                    state.builderWorkspaceDocEdits,
                    key,
                  );
                  const currentValue = edited
                    ? (state.builderWorkspaceDocEdits[key] ?? "")
                    : file.content;
                  return meta
                    ? html`
                        <div class="card-sub" style="margin-top:8px;">
                          <strong>Purpose:</strong> ${meta.purpose}
                        </div>
                        <div class="card-sub" style="margin-top:6px; margin-bottom:8px;">
                          ${meta.previewSummary}
                        </div>
                        <div class="card-sub" style="margin-top:6px; margin-bottom:8px;">
                          Review summary:
                          ${
                            edited
                              ? `Edited in Builder. ${countTextLines(file.content)} generated lines, ${countTextLines(currentValue)} current lines.`
                              : `Generated preview ready for review with ${countTextLines(file.content)} lines.`
                          }
                        </div>
                      `
                    : nothing;
                })()}
                <div class="card-sub" style="margin-top:8px; margin-bottom:8px;">
                  Review or edit this managed section before apply. Your edits stay local to Builder
                  until you apply the plan.
                </div>
                ${(() => {
                  const key = `${preview.nodeId}:${file.name}`;
                  const edited = Object.prototype.hasOwnProperty.call(
                    state.builderWorkspaceDocEdits,
                    key,
                  );
                  const value = edited ? (state.builderWorkspaceDocEdits[key] ?? "") : file.content;
                  return html`
                    <textarea
                      class="mono"
                      style="width:100%; min-height:220px; white-space:pre; resize:vertical;"
                      .value=${value}
                      @input=${(event: Event) =>
                        updateBuilderWorkspaceDocEdit(state, {
                          nodeId: preview.nodeId,
                          fileName: file.name,
                          content: (event.target as HTMLTextAreaElement).value,
                        })}
                    ></textarea>
                    ${
                      edited
                        ? html`
                            <div style="display:flex; justify-content:flex-end; margin-top:8px;">
                              <button
                                type="button"
                                class="builder-config-link"
                                @click=${() =>
                                  resetBuilderWorkspaceDocEdit(state, {
                                    nodeId: preview.nodeId,
                                    fileName: file.name,
                                  })}
                              >
                                Reset to generated text
                              </button>
                            </div>
                          `
                        : nothing
                    }
                  `;
                })()}
              </details>
            `,
          )}
        `,
      )}
      ${
        pendingArtifacts.length > 0
          ? html`
              <div class="label" style="margin:12px 0 8px;">Planned Workspace Docs</div>
              <div class="card-sub" style="margin-bottom:8px;">
                These docs are already part of the BuildSpec, but their generated review text is
                not available in Builder yet.
              </div>
              ${pendingArtifacts.map(
                (artifact) => html`
                  <div class="tpl-note">
                    <div>
                      <strong>${artifact.fileName}</strong>
                      <span
                        class="tpl-pill ${workspaceArtifactStatusPillClass(artifact.status)}"
                        style="margin-left:8px;"
                      >
                        ${artifact.status}
                      </span>
                    </div>
                    <div style="margin-top:6px;">${artifact.purpose}</div>
                    <div class="card-sub" style="margin-top:6px;">${artifact.previewSummary}</div>
                  </div>
                `,
              )}
            `
          : nothing
      }
    </div>
  `;
}

function builderPolicyCard(params: {
  policy: NonNullable<NonNullable<AppViewState["builderPlan"]>["draft"]["buildSpec"]["policy"]>;
  currentBuilderPosture?: ApprovalPosture;
  disabled: boolean;
  onChoosePosture: (posture: ApprovalPosture) => void;
}) {
  const { policy } = params;
  const selectedPosture =
    params.currentBuilderPosture ??
    (policy.approval.posture === "unresolved" ? undefined : policy.approval.posture);
  return html`
    <div class="builder-grid builder-grid--2col">
      <div>
        <div class="label" style="margin-bottom:8px;">Risk Review</div>
        <div class="tpl-note">
          Highest risk:
          <span class="tpl-pill ${policyRiskPillClass(policy.highestRisk)}">
            ${formatRiskClass(policy.highestRisk)}
          </span>
        </div>
        <div class="tpl-note">${policy.summary}</div>
        <div class="tpl-note">
          Risk tiers:
          ${policy.riskTiers.map(
            (tier) => html`
              <span class="tpl-pill ${policyRiskPillClass(tier)}" style="margin-left:8px;">
                ${formatRiskClass(tier)}
              </span>
            `,
          )}
        </div>
        ${
          policy.riskyContractIds.length > 0
            ? html`
                <div class="tpl-note">
                  Risky contracts:
                  <span class="mono">${policy.riskyContractIds.slice(0, 4).join(", ")}</span>
                </div>
              `
            : nothing
        }
        ${
          policy.riskyConnectorIds.length > 0
            ? html`
                <div class="tpl-note">
                  Risky connectors:
                  <span class="mono">${policy.riskyConnectorIds.slice(0, 4).join(", ")}</span>
                </div>
              `
            : nothing
        }
      </div>
      <div>
        <div class="label" style="margin-bottom:8px;">Approval Posture</div>
        <div class="tpl-note">
          Approval route:
          <span class="tpl-pill ${policyRoutePillClass(policy.approval.routeStatus)}">
            ${formatPolicyRouteStatus(policy.approval.routeStatus)}
          </span>
        </div>
        <div class="tpl-note">
          Approval posture:
          <span class="tpl-pill ${policyApprovalPillClass(policy.approval.posture)}">
            ${formatApprovalPosture(policy.approval.posture)}
          </span>
        </div>
        <div class="tpl-note">
          Posture source:
          <span class="tpl-pill tpl-pill--muted">
            ${formatPolicyApprovalPostureSource(policy.approval.postureSource)}
          </span>
        </div>
        <div class="tpl-note">
          Recommended posture:
          <span class="tpl-pill tpl-pill--muted">
            ${formatApprovalPosture(policy.approval.recommendedPosture)}
          </span>
        </div>
        <div class="card-sub" style="margin-top:8px;">
          Supported postures: Always Auto, Ask Once, Ask Every Time, Draft Only, Never.
        </div>
        ${
          policy.approval.required
            ? html`
                <div class="label" style="margin:12px 0 8px;">Choose in Builder</div>
                <div class="builder-actions__secondary">
                  ${APPROVAL_POSTURES.map((posture) => {
                    const selected = selectedPosture === posture;
                    return html`
                      <button
                        type="button"
                        class=${selected ? "btn btn--sm primary" : "btn btn--sm"}
                        ?disabled=${params.disabled}
                        @click=${() => params.onChoosePosture(posture)}
                      >
                        Use ${formatApprovalPostureLabel(posture)}
                      </button>
                    `;
                  })}
                </div>
                <div class="card-sub" style="margin-top:8px;">
                  Builder keeps this posture choice across plan, verify, apply, and refresh.
                </div>
              `
            : nothing
        }
        ${
          policy.approval.postureSource === "missing"
            ? html`
                <div class="card-sub" style="margin-top: 8px">
                  Builder still needs an explicit posture choice before risky actions can be activated.
                </div>
              `
            : nothing
        }
      </div>
      ${
        policy.approval.blockers.length > 0
          ? html`
              <div style="grid-column:1 / -1;">
                ${policy.approval.blockers.map(
                  (blocker) => html`<div class="callout danger">${blocker}</div>`,
                )}
              </div>
            `
          : nothing
      }
    </div>
  `;
}

/** Render gap callouts (warnings/errors) grouped together below the requirement grid */
function renderGaps(state: AppViewState, draft: NonNullable<AppViewState["builderPlan"]>["draft"]) {
  const { missingInputs, setupGaps, policyGaps, unsupportedGaps } = draft.requirements;
  const hasGaps =
    missingInputs.length > 0 ||
    setupGaps.length > 0 ||
    policyGaps.length > 0 ||
    unsupportedGaps.length > 0;
  if (!hasGaps) {
    return nothing;
  }
  return html`
    <div class="builder-gaps">
      ${builderGapList("Needs Input", missingInputs, "warn", state)}
      ${builderGapList("Needs Setup", setupGaps, "warn", state)}
      ${builderGapList("Needs Policy", policyGaps, "danger", state)}
      ${builderGapList("Unsupported", unsupportedGaps, "danger", state)}
    </div>
  `;
}

function builderRequirementList(title: string, values: Array<{ detail: string }>) {
  if (values.length === 0) {
    return nothing;
  }
  return html`
    <div>
      <div class="label" style="margin-bottom:8px;">${title}</div>
      ${values.map((value) => html`<div class="tpl-note">${value.detail}</div>`)}
    </div>
  `;
}

function builderGapList(
  title: string,
  values: Array<{ code: string; message: string }>,
  tone: "warn" | "danger",
  state?: AppViewState,
) {
  if (values.length === 0) {
    return nothing;
  }
  return html`
    <div>
      <div class="label" style="margin-bottom:8px;">${title}</div>
      ${values.map((value) => {
        // Try to resolve a config target from the gap code (e.g. "hooks.gmail_missing" → "hooks")
        const codeRef = value.code?.split("_")[0]; // take part before first underscore
        const configRef = codeRef ? resolveConfigTarget([codeRef]) : null;
        return html`
          <div class="callout ${tone} builder-issue-row">
            <span>${value.message}</span>
            ${
              state && configRef
                ? html`
                    <button
                      type="button"
                      class="builder-config-link"
                      @click=${() =>
                        navigateToConfig(state, [codeRef], {
                          title: value.message,
                          detail: value.message,
                        })}
                    >
                      ${setupActionLabel({ refs: [codeRef] })} &rarr;
                    </button>
                  `
                : nothing
            }
          </div>
        `;
      })}
    </div>
  `;
}

function builderSelectionList(
  values: Array<{
    requirementLabel: string;
    connectorLabel: string;
    connectorId: string;
    source: string;
  }>,
) {
  if (values.length === 0) {
    return nothing;
  }
  return html`
    <div>
      <div class="label" style="margin-bottom:8px;">Selections</div>
      ${values.map(
        (value) => html`
          <div class="tpl-note">
            ${value.requirementLabel}: ${value.connectorLabel}
            <span class="mono">(${value.connectorId})</span>
            <span class="tpl-pill tpl-pill--muted">${value.source}</span>
          </div>
        `,
      )}
    </div>
  `;
}

function builderTopologyCard(topology: {
  mode: string;
  reason: string;
  roles: Array<{ label: string; responsibilities: string[] }>;
}) {
  return html`
    <div>
      <div class="label" style="margin-bottom:8px;">Runtime Topology</div>
      <div class="tpl-note">
        <span class="tpl-pill tpl-pill--muted">${topology.mode}</span>
        ${topology.reason}
      </div>
      ${topology.roles.map(
        (role) => html`
          <div class="tpl-note">
            <strong>${role.label}:</strong> ${role.responsibilities.join(" ")}
          </div>
        `,
      )}
    </div>
  `;
}

function builderAlternativeList(
  values: Array<{
    requirementLabel: string;
    candidates: Array<{
      connectorLabel: string;
      connectorId: string;
      source: string;
      selected: boolean;
      readiness: string;
    }>;
  }>,
) {
  const interesting = values.filter((value) =>
    value.candidates.some((candidate) => !candidate.selected),
  );
  if (interesting.length === 0) {
    return nothing;
  }
  return html`
    <div>
      <div class="label" style="margin-bottom:8px;">Fallbacks</div>
      ${interesting.map((value) => {
        const fallbacks = value.candidates.filter((candidate) => !candidate.selected);
        // Show top 3 inline, rest as a count
        const visible = fallbacks.slice(0, 3);
        const hiddenCount = fallbacks.length - visible.length;
        return html`
          <div class="tpl-note">
            <strong>${value.requirementLabel}:</strong>
            ${visible.map(
              (candidate) => html`
                <span>
                  ${candidate.connectorLabel}
                  <span class="tpl-pill tpl-pill--muted">${candidate.readiness}</span>
                </span>
              `,
            )}
            ${
              hiddenCount > 0
                ? html`<span class="tpl-pill tpl-pill--muted">+${hiddenCount} more</span>`
                : nothing
            }
          </div>
        `;
      })}
    </div>
  `;
}

function builderVariantList(
  values: Array<{
    label: string;
    selected: boolean;
    status: string;
    reason: string;
    connectorIds: string[];
    topology: { mode: string };
  }>,
) {
  if (values.length === 0) {
    return nothing;
  }
  return html`
    <div>
      <div class="label" style="margin-bottom:8px;">Plan Variants</div>
      ${values.map(
        (value) => html`
          <div class="tpl-note">
            <strong>${value.selected ? "Selected" : value.label}:</strong>
            ${value.selected ? value.label : ""}
            <span class="tpl-pill ${plannerStatusPillClass(value.status)}">${formatPlannerStatus(value.status)}</span>
            <span class="tpl-pill tpl-pill--muted">${value.topology.mode}</span>
          </div>
          <div class="tpl-note">${value.reason}</div>
          ${
            value.connectorIds.length > 0
              ? html`
                  <div class="tpl-note">
                    <span class="mono">${value.connectorIds.slice(0, 4).join(", ")}${value.connectorIds.length > 4 ? ` +${value.connectorIds.length - 4} more` : ""}</span>
                  </div>
                `
              : nothing
          }
        `,
      )}
    </div>
  `;
}

function builderRuntimeGraphList(graph: {
  mode: string;
  nodes: Array<{
    id: string;
    label: string;
    entry: boolean;
    templateId: string;
    agentId: string;
    interactionMode: string;
    connectorIds: string[];
    responsibilities: string[];
    deliveryTarget: string | null;
    schedule: string | null;
  }>;
  edges: Array<{ fromNodeId: string; toNodeId: string; kind: string; label: string }>;
}) {
  if (graph.nodes.length === 0) {
    return nothing;
  }
  return html`
    <div>
      <div class="label" style="margin-bottom:8px;">Runtime Graph</div>
      <div class="tpl-note">
        <span class="tpl-pill tpl-pill--muted">${graph.mode}</span>
        ${graph.nodes.length} node${graph.nodes.length === 1 ? "" : "s"}
      </div>
      ${graph.nodes.map(
        (node) => html`
          <div class="tpl-note">
            <strong>${node.entry ? "Entry" : node.label}:</strong>
            ${node.agentId}
            <span class="tpl-pill tpl-pill--muted">${node.templateId}</span>
            <span class="tpl-pill tpl-pill--muted">${node.interactionMode}</span>
          </div>
          ${
            node.responsibilities.length > 0
              ? html`<div class="tpl-note">${node.responsibilities.join(" ")}</div>`
              : nothing
          }
          ${
            node.connectorIds.length > 0
              ? html`<div class="tpl-note"><span class="mono">${node.connectorIds.slice(0, 4).join(", ")}${node.connectorIds.length > 4 ? ` +${node.connectorIds.length - 4} more` : ""}</span></div>`
              : nothing
          }
          ${
            node.deliveryTarget || node.schedule
              ? html`
                  <div class="tpl-note">
                    ${node.deliveryTarget ? `delivery ${node.deliveryTarget}` : ""}
                    ${node.deliveryTarget && node.schedule ? " · " : ""}
                    ${node.schedule ? `schedule ${node.schedule}` : ""}
                  </div>
                `
              : nothing
          }
        `,
      )}
      ${
        graph.edges.length > 0
          ? html`
              <div class="label" style="margin:8px 0 4px;">Edges</div>
              ${graph.edges.map(
                (edge) => html`
                  <div class="tpl-note">
                    <span class="mono">${edge.fromNodeId}</span> ${edge.kind}
                    <span class="mono">${edge.toNodeId}</span> ${edge.label}
                  </div>
                `,
              )}
            `
          : nothing
      }
    </div>
  `;
}

function builderGraphPlanList(
  graphPlans: Array<{
    nodeId: string;
    roleId: string;
    entry: boolean;
    templateId: string;
    plan: Record<string, unknown>;
  }>,
  workspacePreviews: NonNullable<AppViewState["builderPlan"]>["workspacePreviews"],
) {
  if (graphPlans.length === 0) {
    return nothing;
  }
  const workspacePreviewByNodeId = new Map(
    workspacePreviews.map((preview) => [preview.nodeId, preview] as const),
  );
  return html`
    <div class="builder-grid" style="margin-top:12px;">
      <div>
        <div class="label" style="margin-bottom:8px;">Runtime Node Plans</div>
        ${graphPlans.map((node) => {
          const status = readString(asObject(node.plan), "status", "ready");
          const preview = workspacePreviewByNodeId.get(node.nodeId) ?? null;
          const issues = readObjectArray(asObject(node.plan), "issues");
          return html`
            <div class="tpl-plan-file">
              <span>
                ${node.entry ? "Entry" : "Worker"} ${node.roleId}
                <span class="mono">(${node.templateId})</span>
              </span>
              <span class="tpl-pill ${status === "ready" ? "tpl-pill--ok" : "tpl-pill--error"}">${status}</span>
            </div>
            ${
              preview
                ? html`
                    <div class="tpl-note">
                      ${preview.files.length} workspace doc${preview.files.length === 1 ? "" : "s"}
                      ready for review before apply.
                    </div>
                  `
                : html`
                    <div class="tpl-note">Workspace docs are not generated for review yet for this node.</div>
                  `
            }
            ${
              issues.length > 0
                ? html`
                    <div class="tpl-note">
                      ${issues.length} node issue${issues.length === 1 ? "" : "s"} still need
                      review before apply.
                    </div>
                  `
                : nothing
            }
          `;
        })}
      </div>
    </div>
  `;
}

function workspaceArtifactStatusPillClass(status: "planned" | "suggested" | "generated") {
  if (status === "generated") {
    return "tpl-pill--ok";
  }
  return "tpl-pill--muted";
}

function countTextLines(value: string): number {
  if (value.length === 0) {
    return 0;
  }
  return value.split(/\r?\n/).length;
}

function builderPreApplyChecklist(
  state: AppViewState,
  draft: NonNullable<AppViewState["builderPlan"]>["draft"],
  planStatus: string,
  workspacePreviews: NonNullable<AppViewState["builderPlan"]>["workspacePreviews"],
  graphPlans: NonNullable<AppViewState["builderPlan"]>["graphPlans"],
) {
  const blockingSetupActions = draft.buildSpec.setupActions.filter(
    (action) => (action.blocking ?? false) && action.status !== "completed",
  ).length;
  const blockedVerifications = draft.planning.verifications.filter((entry) =>
    ["blocked", "failed"].includes(entry.status),
  ).length;
  const warningVerifications = draft.planning.verifications.filter(
    (entry) => entry.status === "needs_live_check",
  ).length;
  const readyGraphPlans = graphPlans.filter(
    (entry) => readString(asObject(entry.plan), "status", "ready") === "ready",
  ).length;
  const pendingGraphPlans = graphPlans.length - readyGraphPlans;
  const totalWorkspaceFiles = workspacePreviews.reduce(
    (total, preview) => total + preview.files.length,
    0,
  );
  const editedWorkspaceFiles = workspacePreviews.reduce(
    (total, preview) =>
      total +
      preview.files.filter((file) =>
        Object.prototype.hasOwnProperty.call(
          state.builderWorkspaceDocEdits,
          `${preview.nodeId}:${file.name}`,
        ),
      ).length,
    0,
  );
  const generatedArtifactNames = new Set(
    workspacePreviews.flatMap((preview) => preview.files.map((file) => file.name)),
  );
  const pendingWorkspaceArtifacts = draft.buildSpec.workspaceArtifacts.filter(
    (artifact) => !generatedArtifactNames.has(artifact.fileName),
  ).length;
  const policyReady = isBuilderPolicyReady(draft);
  const policy = draft.buildSpec.policy;

  const items = [
    {
      label: "Setup and verification",
      status:
        blockingSetupActions === 0 && blockedVerifications === 0
          ? warningVerifications > 0
            ? "ready"
            : "ready"
          : "blocked",
      detail:
        blockingSetupActions > 0 || blockedVerifications > 0
          ? `${blockingSetupActions > 0 ? `${blockingSetupActions} setup step${blockingSetupActions === 1 ? " needs" : "s need"} to be completed` : ""}${blockingSetupActions > 0 && blockedVerifications > 0 ? " and " : ""}${blockedVerifications > 0 ? `${blockedVerifications} check${blockedVerifications === 1 ? "" : "s"} failed` : ""}.`
          : warningVerifications > 0
            ? `All required setup is done. ${warningVerifications} optional check${warningVerifications === 1 ? "" : "s"} could not run automatically — this is normal and won't block your agent.`
            : "All setup steps and checks passed.",
    },
    {
      label: "Agent workflow",
      status: graphPlans.length > 0 && pendingGraphPlans === 0 ? "ready" : "pending",
      detail:
        graphPlans.length > 0
          ? `${readyGraphPlans} workflow step${readyGraphPlans === 1 ? "" : "s"} configured and ready.`
          : "Your agent's workflow steps are still being set up.",
    },
    {
      label: "Safety policy",
      status: policyReady ? "ready" : "blocked",
      detail: policy
        ? `${policy.summary}${policy.approval.blockers.length > 0 ? ` ${policy.approval.blockers.join(" ")}` : ""}`
        : draft.plannerStatus === "unsafe_without_policy"
          ? "Choose a safety policy before the agent can be created."
          : "Safety policy is set — your agent will follow safe defaults.",
    },
    {
      label: "Agent files",
      status: totalWorkspaceFiles > 0 && pendingWorkspaceArtifacts === 0 ? "ready" : "pending",
      detail:
        totalWorkspaceFiles > 0
          ? `${totalWorkspaceFiles} file${totalWorkspaceFiles === 1 ? "" : "s"} ready${editedWorkspaceFiles > 0 ? `, ${editedWorkspaceFiles} customized` : ""}${pendingWorkspaceArtifacts > 0 ? `, ${pendingWorkspaceArtifacts} still generating` : ""}.`
          : draft.buildSpec.workspaceArtifacts.length > 0
            ? `${draft.buildSpec.workspaceArtifacts.length} file${draft.buildSpec.workspaceArtifacts.length === 1 ? "" : "s"} planned, still generating.`
            : "No extra files needed for this agent.",
    },
    {
      label: "Ready to apply",
      status: draft.plannerStatus === "ready" && planStatus === "ready" ? "ready" : "blocked",
      detail:
        draft.plannerStatus === "ready" && planStatus === "ready"
          ? "Your agent blueprint is compiled and ready to go."
          : `Still working on the blueprint (planner: ${titleCaseWords(draft.plannerStatus)}, blueprint: ${titleCaseWords(planStatus)}).`,
    },
  ] as const;

  return html`
    <div style="text-align:left;">
      <div class="label" style="margin-bottom:8px;">Readiness Checklist</div>
      ${items.map(
        (item) => html`
          <div class="tpl-plan-file">
            <span>${item.label}</span>
            <span class="tpl-pill ${builderChecklistPillClass(item.status)}">
              ${titleCaseWords(item.status)}
            </span>
          </div>
          <div class="tpl-note" style="margin-bottom:8px;">${item.detail}</div>
        `,
      )}
    </div>
  `;
}

function builderChecklistPillClass(status: "ready" | "pending" | "blocked") {
  if (status === "ready") {
    return "tpl-pill--ok";
  }
  if (status === "pending") {
    return "tpl-pill--muted";
  }
  return "tpl-pill--error";
}

function isBuilderPolicyReady(draft: NonNullable<AppViewState["builderPlan"]>["draft"]) {
  if (draft.plannerStatus === "unsafe_without_policy") {
    return false;
  }
  return !(draft.buildSpec.policy?.approval.unresolved ?? false);
}

function formatRiskClass(value: string): string {
  const labels: Record<string, string> = {
    read_only: "Read Only",
    communicative: "Communication",
    operator: "Operator",
    externally_mutating: "Externally Mutating",
    config_mutating: "Config Mutating",
  };
  return labels[value] ?? value;
}

function formatApprovalPosture(value: string): string {
  const labels: Record<string, string> = {
    always_auto: "Always Auto",
    ask_once: "Ask Once",
    ask_every_time: "Ask Every Time",
    draft_only: "Draft Only",
    never: "Never",
    unresolved: "Unresolved",
  };
  return labels[value] ?? value;
}

function formatPolicyRouteStatus(value: string): string {
  const labels: Record<string, string> = {
    not_required: "Not Required",
    configured: "Configured",
    missing: "Missing",
  };
  return labels[value] ?? value;
}

function formatPolicyApprovalPostureSource(value: string): string {
  const labels: Record<string, string> = {
    brief: "Brief",
    builder: "Builder",
    defaulted: "Defaulted",
    missing: "Missing",
  };
  return labels[value] ?? value;
}

function policyRiskPillClass(value: string) {
  switch (value) {
    case "read_only":
      return "tpl-pill--ok";
    case "communicative":
      return "tpl-pill--muted";
    case "operator":
      return "tpl-pill--warn";
    case "externally_mutating":
    case "config_mutating":
      return "tpl-pill--error";
    default:
      return "tpl-pill--muted";
  }
}

function policyApprovalPillClass(value: string) {
  return value === "unresolved" ? "tpl-pill--error" : "tpl-pill--muted";
}

function policyRoutePillClass(value: string) {
  switch (value) {
    case "configured":
      return "tpl-pill--ok";
    case "missing":
      return "tpl-pill--error";
    default:
      return "tpl-pill--muted";
  }
}

function builderIntegrationList(
  state: AppViewState,
  values: Array<{
    label: string;
    status: string;
    connectorId: string;
    issues: string[];
    lastVerifiedAt?: string;
    kind?: string;
    sourceKind?: string;
    docsPath?: string;
    selectionLabel?: string;
    detailLabel?: string;
    onboarding?: boolean;
    requiresConfig?: boolean;
    requiresAuth?: boolean;
    installRequired?: boolean;
    installStrategy?: "none" | "bundled" | "npm" | "local" | "external";
  }>,
  setupTasks: Array<{ connectorId: string; status: string }>,
) {
  if (values.length === 0) {
    return nothing;
  }
  const OK_STATUSES = new Set(["verified", "authenticated", "configured"]);
  return html`
    <div>
      <div class="label" style="margin-bottom:8px;">Integrations</div>
      ${values.map((value) => {
        const configRef = connectorIdToConfigRef(value.connectorId);
        const hasLink = configRef && resolveConfigTarget([configRef]);
        const needsAction = !OK_STATUSES.has(value.status);
        const hasPendingTask = hasPendingSetupTask(setupTasks, value.connectorId);
        return html`
          <div class="tpl-plan-file">
            <span>
              ${value.label}
              <span class="mono">(${value.connectorId})</span>
            </span>
            <span class="tpl-pill ${integrationStatusPillClass(value.status)}">${formatIntegrationStatus(value.status)}</span>
            ${
              hasLink && needsAction && hasPendingTask && value.issues.length === 0
                ? html`
                    <button
                      type="button"
                      class="builder-config-link"
                      @click=${() =>
                        navigateToConfig(state, [configRef], {
                          connectorId: value.connectorId,
                          connectorLabel: value.label,
                          connectorKind: value.kind,
                          connectorSourceKind: value.sourceKind,
                          connectorDocsPath: value.docsPath,
                          connectorSelectionLabel: value.selectionLabel,
                          connectorDetailLabel: value.detailLabel,
                          connectorOnboarding: value.onboarding,
                          connectorRequiresConfig: value.requiresConfig,
                          connectorRequiresAuth: value.requiresAuth,
                          connectorInstallRequired: value.installRequired,
                          connectorInstallStrategy: value.installStrategy,
                          title: value.label,
                          detail: `${value.label} still needs setup or verification before this workflow can run cleanly.`,
                        })}
                    >
                      ${setupActionLabel({
                        connectorId: value.connectorId,
                        connectorLabel: value.label,
                        refs: [configRef],
                      })}
                      &rarr;
                    </button>
                  `
                : nothing
            }
          </div>
          ${
            value.lastVerifiedAt
              ? html`<div class="tpl-note">Last verified: ${value.lastVerifiedAt}</div>`
              : nothing
          }
          ${value.issues.map(
            (issue) => html`
              <div class="callout warn builder-issue-row">
                <span>${issue}</span>
                ${
                  // Always offer a one-click fix when there's a config page to
                  // jump to. Previously this button was gated on
                  // `hasPendingTask`, but the planner doesn't always register
                  // a task for at-runtime failures (e.g., Gmail keyring
                  // corruption) — so failures surfaced without any actionable
                  // button, leaving the user staring at a terminal command.
                  hasLink
                    ? html`
                        <button
                          type="button"
                          class="builder-config-link"
                          @click=${() =>
                            navigateToConfig(state, [configRef], {
                              connectorId: value.connectorId,
                              connectorLabel: value.label,
                              connectorKind: value.kind,
                              connectorSourceKind: value.sourceKind,
                              connectorDocsPath: value.docsPath,
                              connectorSelectionLabel: value.selectionLabel,
                              connectorDetailLabel: value.detailLabel,
                              connectorOnboarding: value.onboarding,
                              connectorRequiresConfig: value.requiresConfig,
                              connectorRequiresAuth: value.requiresAuth,
                              connectorInstallRequired: value.installRequired,
                              connectorInstallStrategy: value.installStrategy,
                              title: value.label,
                              detail: issue,
                            })}
                        >
                          ${setupActionLabel({
                            connectorId: value.connectorId,
                            connectorLabel: value.label,
                            refs: [configRef],
                          })}
                          &rarr;
                        </button>
                      `
                    : nothing
                }
              </div>
            `,
          )}
        `;
      })}
    </div>
  `;
}

function builderSetupActionList(
  state: AppViewState,
  values: Array<{
    id?: string;
    title: string;
    detail: string;
    status: string;
    connectorId: string;
    connectorLabel: string;
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
      options?: Array<{ value: string; label: string }>;
    }>;
    workflowRoles?: string[];
    uiSchema?: {
      variant: "guided-setup" | "inline-question" | "expert-config";
      section?: string;
      fieldKeys: string[];
    };
    completionSignal?: {
      kind: "integration-status" | "verification" | "builder-check";
      target: string;
      detail: string;
    };
    connectorKind?: string;
    connectorSourceKind?: string;
    connectorDocsPath?: string;
    connectorSelectionLabel?: string;
    connectorDetailLabel?: string;
    connectorOnboarding?: boolean;
    connectorRequiresConfig?: boolean;
    connectorRequiresAuth?: boolean;
    connectorInstallRequired?: boolean;
    connectorInstallStrategy?: "none" | "bundled" | "npm" | "local" | "external";
  }>,
) {
  if (values.length === 0) {
    return nothing;
  }
  return html`
    <div>
      <div class="label" style="margin-bottom:8px;">Setup Steps</div>
      ${values.map((value) => {
        const refsTarget = value.refs.length > 0 ? resolveConfigTarget(value.refs) : null;
        const connectorRef = connectorIdToConfigRef(value.connectorId);
        const fallbackTarget = connectorRef ? resolveConfigTarget([connectorRef]) : null;
        const canNavigate = value.status !== "completed" && (refsTarget || fallbackTarget);
        const navRefs = refsTarget ? value.refs : connectorRef ? [connectorRef] : [];
        return html`
          <div class="tpl-plan-file">
            <span>
              ${value.title}
            </span>
            <span class="tpl-pill ${value.status === "completed" ? "tpl-pill--ok" : "tpl-pill--error"}">${value.status === "completed" ? "Done" : "To Do"}</span>
          </div>
          <div class="tpl-note builder-issue-row">
            <span>${value.detail}</span>
            ${
              canNavigate
                ? html`
                    <button
                      type="button"
                      class="builder-config-link"
                      @click=${() =>
                        navigateToConfig(state, navRefs, {
                          actionId: value.id,
                          connectorId: value.connectorId,
                          connectorLabel: value.connectorLabel,
                          connectorKind: value.connectorKind,
                          connectorSourceKind: value.connectorSourceKind,
                          connectorDocsPath: value.connectorDocsPath,
                          connectorSelectionLabel: value.connectorSelectionLabel,
                          connectorDetailLabel: value.connectorDetailLabel,
                          connectorOnboarding: value.connectorOnboarding,
                          connectorRequiresConfig: value.connectorRequiresConfig,
                          connectorRequiresAuth: value.connectorRequiresAuth,
                          connectorInstallRequired: value.connectorInstallRequired,
                          connectorInstallStrategy: value.connectorInstallStrategy,
                          actionKind: value.kind,
                          actionSource: value.source,
                          requiredFields: value.requiredFields,
                          uiSchema: value.uiSchema,
                          completionSignal: value.completionSignal,
                          title: value.title,
                          detail: value.detail,
                        })}
                    >
                      ${setupActionLabel({
                        connectorId: value.connectorId,
                        connectorLabel: value.connectorLabel,
                        refs: navRefs,
                        title: value.title,
                      })} &rarr;
                    </button>
                  `
                : nothing
            }
          </div>
          ${
            value.workflowRoles && value.workflowRoles.length > 0
              ? html`<div class="tpl-note">Roles: ${value.workflowRoles.join(", ")}</div>`
              : nothing
          }
          ${
            value.requiredFields && value.requiredFields.length > 0
              ? html`
                  <div class="tpl-note">
                    Required fields: ${value.requiredFields.map((field) => field.label).join(", ")}
                  </div>
                `
              : nothing
          }
          ${
            value.completionSignal
              ? html`<div class="tpl-note">Complete when: ${value.completionSignal.detail}</div>`
              : nothing
          }
          ${
            value.connectorId === "channel:whatsapp" && canNavigate
              ? html`
                  <div class="tpl-note">
                    Link your WhatsApp by scanning a QR code. You can also choose which number or group receives
                    messages.
                  </div>
                `
              : nothing
          }
          ${
            value.refs.length > 0
              ? html`<div class="tpl-note mono">${value.refs.join(", ")}</div>`
              : nothing
          }
        `;
      })}
    </div>
  `;
}

function builderVerificationList(
  state: AppViewState,
  values: Array<{
    connectorId?: string;
    connectorLabel: string;
    probeLabel: string;
    status: string;
    detail: string;
    source?: string;
    checkedAt?: string;
    connectorKind?: string;
    connectorSourceKind?: string;
    connectorDocsPath?: string;
    connectorSelectionLabel?: string;
    connectorDetailLabel?: string;
    connectorOnboarding?: boolean;
    connectorRequiresConfig?: boolean;
    connectorRequiresAuth?: boolean;
    connectorInstallRequired?: boolean;
    connectorInstallStrategy?: "none" | "bundled" | "npm" | "local" | "external";
  }>,
  setupTasks: Array<{ connectorId: string; status: string }>,
) {
  if (values.length === 0) {
    return nothing;
  }
  return html`
    <div>
      <div class="label" style="margin-bottom:8px;">Connection Checks</div>
      ${values.map((value) => {
        const isBlocked = value.status === "blocked" || value.status === "failed";
        const isSkipped = value.status === "needs_live_check";
        const configRef = value.connectorId ? connectorIdToConfigRef(value.connectorId) : null;
        const hasPendingTask = hasPendingSetupTask(setupTasks, value.connectorId);
        const hasLink =
          isBlocked && hasPendingTask && configRef && resolveConfigTarget([configRef]);
        return html`
          <div class="tpl-plan-file">
            <span>${value.connectorLabel}: ${value.probeLabel}</span>
            <span class="tpl-pill ${verificationStatusPillClass(value.status)}">${formatVerificationStatus(value.status)}</span>
          </div>
          ${
            !isSkipped && (value.source || value.checkedAt)
              ? html`
                  <div class="tpl-note">
                    ${value.source ?? "preflight"}${value.checkedAt ? ` @ ${value.checkedAt}` : ""}
                  </div>
                `
              : nothing
          }
          <div class="tpl-note builder-issue-row">
            <span>${isSkipped ? "This check will run automatically when the agent executes. It does not block setup." : value.detail}</span>
            ${
              hasLink
                ? html`
                    <button
                      type="button"
                      class="builder-config-link"
                      @click=${() =>
                        navigateToConfig(state, [configRef], {
                          connectorId: value.connectorId,
                          connectorLabel: value.connectorLabel,
                          connectorKind: value.connectorKind,
                          connectorSourceKind: value.connectorSourceKind,
                          connectorDocsPath: value.connectorDocsPath,
                          connectorSelectionLabel: value.connectorSelectionLabel,
                          connectorDetailLabel: value.connectorDetailLabel,
                          connectorOnboarding: value.connectorOnboarding,
                          connectorRequiresConfig: value.connectorRequiresConfig,
                          connectorRequiresAuth: value.connectorRequiresAuth,
                          connectorInstallRequired: value.connectorInstallRequired,
                          connectorInstallStrategy: value.connectorInstallStrategy,
                          title: value.probeLabel,
                          detail: value.detail,
                        })}
                    >
                      ${setupActionLabel({
                        connectorId: value.connectorId,
                        connectorLabel: value.connectorLabel,
                        refs: [configRef],
                      })}
                      &rarr;
                    </button>
                  `
                : nothing
            }
          </div>
        `;
      })}
    </div>
  `;
}

function renderVerificationRunSummary(state: AppViewState) {
  const run = state.builderVerifyResult?.verification;
  if (!run) {
    return nothing;
  }
  const allPassed = run.failedCount === 0 && run.blockedCount === 0 && run.unresolvedCount === 0;
  return html`
    <div class="builder-verify-summary ${allPassed ? "builder-verify-summary--ok" : "builder-verify-summary--warn"}">
      <div class="builder-header" style="margin-bottom:8px;">
        <div class="label">Latest Live Verification</div>
        <span class="tpl-pill ${allPassed ? "tpl-pill--ok" : "tpl-pill--error"}">
          ${allPassed ? "All Passed" : "Issues Found"}
        </span>
      </div>
      <div class="builder-verify-counts">
        <span class="builder-verify-count builder-verify-count--ok">${run.passedCount} passed</span>
        ${run.failedCount > 0 ? html`<span class="builder-verify-count builder-verify-count--error">${run.failedCount} failed</span>` : nothing}
        ${run.blockedCount > 0 ? html`<span class="builder-verify-count builder-verify-count--warn">${run.blockedCount} blocked</span>` : nothing}
        ${run.unresolvedCount > 0 ? html`<span class="builder-verify-count builder-verify-count--muted">${run.unresolvedCount} unresolved</span>` : nothing}
      </div>
      <div class="card-sub" style="margin-top:4px;">Checked ${run.checkedAt}</div>
    </div>
  `;
}

function builderExtracted(draft: NonNullable<AppViewState["builderPlan"]>["draft"]) {
  return html`
    <div>
      <div class="label" style="margin-bottom:8px;">Extracted</div>
      <div class="builder-grid">
        ${kv("Agent", `${draft.extracted.name} (${draft.extracted.agentId})`)}
        ${kv(
          "Ingress",
          draft.extracted.ingressChannels.length > 0
            ? draft.extracted.ingressChannels.join(", ")
            : "-",
        )}
        ${kv(
          "Sources",
          draft.extracted.sourceChannels.length > 0
            ? draft.extracted.sourceChannels.join(", ")
            : "-",
        )}
        ${kv("Delivery", draft.extracted.deliveryTarget ?? "-")}
        ${kv("Schedule", draft.extracted.schedule ?? "-")}
      </div>
    </div>
  `;
}

function kv(label: string, value: string) {
  return html`
    <div class="agent-kv">
      <div class="label">${label}</div>
      <div>${value}</div>
    </div>
  `;
}

/** Map snake_case planner status to human-readable label */
function formatPlannerStatus(status: string): string {
  const labels: Record<string, string> = {
    ready: "Ready",
    needs_input: "Needs Input",
    needs_setup: "Needs Setup",
    partial: "Partial",
    unsupported: "Unsupported",
    unsafe_without_policy: "Needs Policy",
    blocked: "Blocked",
  };
  return labels[status] ?? status;
}

/** Map snake_case integration status to human-readable label */
function formatIntegrationStatus(status: string): string {
  const labels: Record<string, string> = {
    discovered: "Discovered",
    install_required: "Install Required",
    installed: "Installed",
    configured: "Configured",
    authenticated: "Authenticated",
    verified: "Verified",
    degraded: "Degraded",
    failed: "Failed",
  };
  return labels[status] ?? status;
}

/** Map snake_case verification status to human-readable label */
function formatVerificationStatus(status: string): string {
  const labels: Record<string, string> = {
    passed: "Passed",
    failed: "Failed",
    blocked: "Blocked",
    needs_live_check: "Skipped (OK)",
  };
  return labels[status] ?? status;
}

function plannerStatusPillClass(status: string): string {
  if (status === "ready") {
    return "tpl-pill--ok";
  }
  if (status === "needs_input" || status === "needs_setup") {
    return "tpl-pill--muted";
  }
  return "tpl-pill--error";
}

function integrationStatusPillClass(status: string): string {
  if (status === "verified" || status === "authenticated" || status === "configured") {
    return "tpl-pill--ok";
  }
  if (status === "install_required" || status === "discovered" || status === "installed") {
    return "tpl-pill--muted";
  }
  return "tpl-pill--error";
}

function verificationStatusPillClass(status: string): string {
  if (status === "passed") {
    return "tpl-pill--ok";
  }
  if (status === "needs_live_check") {
    return "tpl-pill--muted";
  }
  return "tpl-pill--error";
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readObjectArray(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => asObject(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

function readString(
  record: Record<string, unknown> | undefined,
  key: string,
  fallback = "-",
): string {
  const value = record?.[key];
  return typeof value === "string"
    ? value
    : typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : fallback;
}
