import { html, nothing } from "lit";
import type { AppViewState } from "../app-view-state.ts";
import {
  applyBuilderPlan,
  loadBuilderPlan,
  type BuilderState,
  verifyBuilderPlan,
} from "../controllers/builder.ts";
import type { Tab } from "../navigation.ts";

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
  section: string;
  /** The state property to set (e.g. "communicationsActiveSection") */
  sectionKey: string;
};

/**
 * Maps config sections to their settings tab and section state property.
 * The key is the first segment of a config ref (e.g. "channels" from "channels.telegram").
 */
const CONFIG_SECTION_MAP: Record<string, ConfigTarget> = {
  // Communications tab
  channels: {
    tab: "communications",
    section: "channels",
    sectionKey: "communicationsActiveSection",
  },
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

/**
 * Map a connectorId like "platform:gmail-hook" or "channel:telegram" to a config ref
 * like "hooks" or "channels.telegram" that can be resolved to a settings section.
 */
function connectorIdToConfigRef(connectorId: string): string | null {
  if (!connectorId) {
    return null;
  }

  // channel:telegram → channels.telegram
  if (connectorId.startsWith("channel:")) {
    return `channels.${connectorId.slice("channel:".length)}`;
  }
  // platform:gmail-hook, platform:gmail → hooks
  if (connectorId.includes("gmail") || connectorId.includes("hook")) {
    return "hooks";
  }
  // platform:core-model, platform:openai, platform:anthropic → models
  if (
    connectorId.includes("model") ||
    connectorId.includes("openai") ||
    connectorId.includes("anthropic") ||
    connectorId.includes("ollama") ||
    connectorId.includes("groq")
  ) {
    return "models";
  }
  // tools:automation, tools:cron → cron
  if (connectorId.includes("automation") || connectorId.includes("cron")) {
    return "cron";
  }
  // tools:messaging → channels
  if (connectorId.includes("messaging")) {
    return "channels";
  }
  // tools:browser → browser
  if (connectorId.includes("browser")) {
    return "browser";
  }
  // tools:memory → memory
  if (connectorId.includes("memory")) {
    return "memory";
  }
  // tools:skill → skills
  if (connectorId.includes("skill")) {
    return "skills";
  }
  // tools:command → commands
  if (connectorId.includes("command")) {
    return "commands";
  }
  // platform:web → web
  if (connectorId.includes("web")) {
    return "web";
  }
  // platform:signal → channels.signal, platform:discord → channels.discord, etc.
  const knownChannels = [
    "telegram",
    "discord",
    "slack",
    "signal",
    "whatsapp",
    "imessage",
    "matrix",
    "msteams",
  ];
  for (const ch of knownChannels) {
    if (connectorId.includes(ch)) {
      return `channels.${ch}`;
    }
  }
  // generic: try to extract a section from the id after ":"
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

/** Navigate to a config section. Sets the tab and the active section. */
function navigateToConfig(state: AppViewState, refs: string[]) {
  const target = resolveConfigTarget(refs);
  if (!target) {
    return;
  }
  // Set the section state before navigating so it's ready when the tab renders
  (state as Record<string, unknown>)[target.sectionKey] = target.section;
  state.setTab(target.tab);
}

export type BuilderProps = {
  state: AppViewState;
  onSetBrief: (brief: string) => void;
  onSetTemplate: (templateId: string) => void;
  onPlan: () => void;
  onVerify: () => void;
  onConfirmApply: () => void;
  onCancelApply: () => void;
  onApply: () => void;
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
  const draft = planResult?.draft ?? null;
  const plan = asObject(planResult?.plan);
  const issues = readObjectArray(plan, "issues");
  const blueprintStatus = readString(plan, "status", "ready");

  return html`
    <div class="builder-layout">
      <section class="card">
        <div class="card-title section-title">Describe The Agent</div>
        <div class="card-sub" style="margin-bottom:12px;">
          Write the job in plain English. The builder will extract requirements, choose the
          closest starter template, and show whether the workflow is ready, needs setup, or still
          needs policy/input before apply.
        </div>

        <label class="field builder-brief-field" style="margin-bottom:12px;">
          <span>Brief</span>
          <textarea
            rows="5"
            .value=${state.builderBrief}
            placeholder="Create a bot on Telegram that summarizes my daily emails and sends me a briefing every morning at 9am."
            @input=${(event: Event) =>
              props.onSetBrief((event.target as HTMLTextAreaElement).value)}
          ></textarea>
        </label>

        <label class="field" style="max-width:360px;">
          <span>Template Override</span>
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

        <div class="builder-actions" style="margin-top:16px;">
          <button
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
                      class="btn btn--sm"
                      ?disabled=${state.builderVerifying}
                      @click=${props.onVerify}
                    >
                      ${
                        state.builderVerifying
                          ? html`
                              <span class="loading-spinner" style="font-size: 12px">Verifying...</span>
                            `
                          : "Run Live Verification"
                      }
                    </button>
                    <button
                      class="btn btn--sm"
                      ?disabled=${state.builderPlanLoading}
                      @click=${props.onPlan}
                    >
                      Rebuild
                    </button>
                  </div>
                `
              : nothing
          }
        </div>

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
                  ${builderQuestionList(draft.questions)}
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
                  <div class="card-title section-title">Connector Plan</div>
                </div>
                <div class="builder-grid">
                  ${builderSelectionList(draft.planning.selections)}
                  ${builderTopologyCard(draft.planning.topology)}
                  ${builderAlternativeList(draft.planning.alternatives)}
                  ${builderVariantList(draft.planning.variants)}
                  ${builderRuntimeGraphList(draft.planning.graph)}
                  ${builderIntegrationList(state, draft.planning.integrations)}
                  ${builderSetupTaskList(state, draft.planning.setupTasks)}
                  ${builderVerificationList(state, draft.planning.verifications)}
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
                ${builderGraphPlanList(planResult?.graphPlans ?? [])}
              </section>

              ${renderBuilderApplySection(props, state, draft, blueprintStatus)}
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
) {
  if (state.builderApplyResult) {
    const result = state.builderApplyResult.result;
    return html`
      <section class="card applied-banner">
        <div class="card-title section-title" style="color:var(--ok);">
          Builder Applied
        </div>
        <div class="builder-grid">
          ${kv("Agent ID", result.agent.agentId)}
          ${kv("Name", result.agent.name)}
          ${kv("Workspace", result.agent.workspaceDir)}
        </div>
        ${
          state.builderApplyResult.graphResults.length > 1
            ? html`
                <div class="label" style="margin-top:12px;">Runtime Graph Nodes</div>
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
                <div class="label" style="margin-top:12px;">Workspace Files</div>
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
                <div class="label" style="margin-top:12px;">Cron Jobs</div>
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
      </section>
    `;
  }

  if (state.builderApplyError) {
    return html`
      <section class="card">
        <div class="callout danger">${state.builderApplyError}</div>
        <button class="btn primary" style="margin-top:12px;" @click=${props.onApply}>
          Retry Apply
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
        <div class="card-title section-title">Confirm Apply</div>
        <div class="card-sub" style="margin-bottom:12px;">
          This will create or update <strong>${draft.displayName}</strong> from the builder
          plan and write config, workspace files, bindings, and cron jobs.
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn primary" @click=${props.onApply}>Yes, Apply</button>
          <button class="btn" @click=${props.onCancelApply}>Cancel</button>
        </div>
      </section>
    `;
  }

  const canApply = draft.plannerStatus === "ready" && planStatus === "ready";
  return html`
    <section class="card" style="text-align:center; padding:24px;">
      <button class="btn primary" ?disabled=${!canApply} @click=${props.onConfirmApply}>
        Apply Builder Plan
      </button>
      ${
        canApply
          ? html`
              <div class="card-sub" style="margin-top: 8px">Creates the agent from the inferred blueprint.</div>
            `
          : html`
              <div class="card-sub" style="margin-top: 8px">
                Resolve planner gaps or blueprint issues before apply.
              </div>
            `
      }
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

function builderQuestionList(questions: Array<{ prompt: string; required: boolean }>) {
  if (questions.length === 0) {
    return nothing;
  }
  return html`
    <div>
      <div class="label" style="margin-bottom:8px;">Questions</div>
      ${questions.map(
        (question) => html`
          <div class="tpl-note">
            ${question.required ? "[required]" : "[optional]"} ${question.prompt}
          </div>
        `,
      )}
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
                      class="builder-config-link"
                      @click=${() => navigateToConfig(state, [codeRef])}
                    >
                      Configure &rarr;
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
        return html`
          <div class="tpl-note">
            <strong>${value.requirementLabel}:</strong>
            ${fallbacks.map(
              (candidate) => html`
                <span>
                  ${candidate.connectorLabel}
                  <span class="mono">(${candidate.connectorId})</span>
                  <span class="tpl-pill tpl-pill--muted">${candidate.source}</span>
                  <span class="tpl-pill tpl-pill--muted">${candidate.readiness}</span>
                </span>
              `,
            )}
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
                    <span class="mono">${value.connectorIds.join(", ")}</span>
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
              ? html`<div class="tpl-note"><span class="mono">${node.connectorIds.join(", ")}</span></div>`
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
) {
  if (graphPlans.length === 0) {
    return nothing;
  }
  return html`
    <div class="builder-grid" style="margin-top:12px;">
      <div>
        <div class="label" style="margin-bottom:8px;">Node Plans</div>
        ${graphPlans.map((node) => {
          const status = readString(asObject(node.plan), "status", "ready");
          return html`
            <div class="tpl-plan-file">
              <span>
                ${node.entry ? "Entry" : "Worker"} ${node.roleId}
                <span class="mono">(${node.templateId})</span>
              </span>
              <span class="tpl-pill ${status === "ready" ? "tpl-pill--ok" : "tpl-pill--error"}">${status}</span>
            </div>
          `;
        })}
      </div>
    </div>
  `;
}

function builderIntegrationList(
  state: AppViewState,
  values: Array<{
    label: string;
    status: string;
    connectorId: string;
    issues: string[];
    lastVerifiedAt?: string;
  }>,
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
        return html`
          <div class="tpl-plan-file">
            <span>
              ${value.label}
              <span class="mono">(${value.connectorId})</span>
            </span>
            <span class="tpl-pill ${integrationStatusPillClass(value.status)}">${formatIntegrationStatus(value.status)}</span>
            ${
              hasLink && needsAction && value.issues.length === 0
                ? html`
                    <button
                      class="builder-config-link"
                      @click=${() => navigateToConfig(state, [configRef])}
                    >
                      Configure &rarr;
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
                  hasLink
                    ? html`
                        <button
                          class="builder-config-link"
                          @click=${() => navigateToConfig(state, [configRef])}
                        >
                          Configure &rarr;
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

function builderSetupTaskList(
  state: AppViewState,
  values: Array<{
    title: string;
    detail: string;
    status: string;
    connectorId: string;
    refs: string[];
  }>,
) {
  if (values.length === 0) {
    return nothing;
  }
  return html`
    <div>
      <div class="label" style="margin-bottom:8px;">Setup Tasks</div>
      ${values.map((value) => {
        // Resolve config target from refs first, fall back to connectorId
        const refsTarget = value.refs.length > 0 ? resolveConfigTarget(value.refs) : null;
        const connectorRef = connectorIdToConfigRef(value.connectorId);
        const fallbackTarget = connectorRef ? resolveConfigTarget([connectorRef]) : null;
        const canNavigate = value.status !== "completed" && (refsTarget || fallbackTarget);
        const navRefs = refsTarget ? value.refs : connectorRef ? [connectorRef] : [];
        return html`
          <div class="tpl-plan-file">
            <span>${value.title}</span>
            <span class="tpl-pill ${value.status === "completed" ? "tpl-pill--ok" : "tpl-pill--muted"}">${value.status}</span>
          </div>
          <div class="tpl-note builder-issue-row">
            <span>${value.detail}</span>
            ${
              canNavigate
                ? html`
                    <button
                      class="builder-config-link"
                      @click=${() => navigateToConfig(state, navRefs)}
                    >
                      Configure &rarr;
                    </button>
                  `
                : nothing
            }
          </div>
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
  }>,
) {
  if (values.length === 0) {
    return nothing;
  }
  return html`
    <div>
      <div class="label" style="margin-bottom:8px;">Verification</div>
      ${values.map((value) => {
        const isBlocked = value.status === "blocked" || value.status === "failed";
        const configRef = value.connectorId ? connectorIdToConfigRef(value.connectorId) : null;
        const hasLink = isBlocked && configRef && resolveConfigTarget([configRef]);
        return html`
          <div class="tpl-plan-file">
            <span>${value.connectorLabel}: ${value.probeLabel}</span>
            <span class="tpl-pill ${verificationStatusPillClass(value.status)}">${formatVerificationStatus(value.status)}</span>
          </div>
          ${
            value.source || value.checkedAt
              ? html`
                  <div class="tpl-note">
                    ${value.source ?? "preflight"}${value.checkedAt ? ` @ ${value.checkedAt}` : ""}
                  </div>
                `
              : nothing
          }
          <div class="tpl-note builder-issue-row">
            <span>${value.detail}</span>
            ${
              hasLink
                ? html`
                    <button
                      class="builder-config-link"
                      @click=${() => navigateToConfig(state, [configRef])}
                    >
                      Configure &rarr;
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
    needs_live_check: "Needs Check",
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
