import { html, nothing } from "lit";
import type { AppViewState } from "../app-view-state.ts";
import { applyBuilderPlan, loadBuilderPlan, type BuilderState } from "../controllers/builder.ts";

const BUILDER_TEMPLATE_OPTIONS = [
  { value: "", label: "Auto select" },
  { value: "personal-assistant", label: "Personal Assistant" },
  { value: "daily-briefing", label: "Daily Briefing Agent" },
  { value: "support-responder", label: "Support Responder" },
  { value: "research-agent", label: "Research Agent" },
] as const;

export type BuilderProps = {
  state: AppViewState;
  onSetBrief: (brief: string) => void;
  onSetTemplate: (templateId: string) => void;
  onPlan: () => void;
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
        <div class="card-title" style="font-size:14px;">Describe The Agent</div>
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

        <div style="display:flex; gap:8px; margin-top:16px;">
          <button
            class="btn primary"
            ?disabled=${!state.builderBrief.trim() || state.builderPlanLoading}
            @click=${props.onPlan}
          >
            ${state.builderPlanLoading ? "Planning..." : "Build Plan"}
          </button>
          ${
            planResult
              ? html`
                  <button
                    class="btn"
                    ?disabled=${state.builderPlanLoading}
                    @click=${props.onPlan}
                  >
                    Rebuild
                  </button>
                `
              : nothing
          }
        </div>

        ${
          state.builderPlanError
            ? html`<div class="callout danger" style="margin-top:12px;">${state.builderPlanError}</div>`
            : nothing
        }
      </section>

      ${
        draft
          ? html`
              <section class="card">
                <div class="builder-header">
                  <div>
                    <div class="card-title" style="font-size:14px;">Suggested Template</div>
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
                  <div class="card-title" style="font-size:14px;">Workflow Status</div>
                  <span class="tpl-pill ${plannerStatusPillClass(draft.plannerStatus)}">
                    ${draft.plannerStatus}
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
                  ${builderGapList("Needs Input", draft.requirements.missingInputs, "warn")}
                  ${builderGapList("Needs Setup", draft.requirements.setupGaps, "warn")}
                  ${builderGapList("Needs Policy", draft.requirements.policyGaps, "danger")}
                  ${builderGapList("Unsupported", draft.requirements.unsupportedGaps, "danger")}
                </div>
                ${
                  draft.requirements.intentTags.length > 0
                    ? html`
                        <div class="card-sub" style="margin-top:12px;">
                          Intent tags: ${draft.requirements.intentTags.join(", ")}
                        </div>
                      `
                    : nothing
                }
              </section>

              <section class="card">
                <div class="builder-header">
                  <div class="card-title" style="font-size:14px;">Connector Plan</div>
                  <span class="tpl-pill ${plannerStatusPillClass(draft.plannerStatus)}">
                    ${draft.plannerStatus}
                  </span>
                </div>
                <div class="builder-grid">
                  ${builderSelectionList(draft.planning.selections)}
                  ${builderIntegrationList(draft.planning.integrations)}
                  ${builderSetupTaskList(draft.planning.setupTasks)}
                  ${builderVerificationList(draft.planning.verifications)}
                </div>
              </section>

              <section class="card">
                <div class="builder-header">
                  <div class="card-title" style="font-size:14px;">Blueprint Plan</div>
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
  values: Array<{ message: string }>,
  tone: "warn" | "danger",
) {
  if (values.length === 0) {
    return nothing;
  }
  return html`
    <div>
      <div class="label" style="margin-bottom:8px;">${title}</div>
      ${values.map((value) => html`<div class="callout ${tone}">${value.message}</div>`)}
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

function builderIntegrationList(
  values: Array<{
    label: string;
    status: string;
    connectorId: string;
    issues: string[];
  }>,
) {
  if (values.length === 0) {
    return nothing;
  }
  return html`
    <div>
      <div class="label" style="margin-bottom:8px;">Integrations</div>
      ${values.map(
        (value) => html`
          <div class="tpl-plan-file">
            <span>
              ${value.label}
              <span class="mono">(${value.connectorId})</span>
            </span>
            <span class="tpl-pill ${integrationStatusPillClass(value.status)}">${value.status}</span>
          </div>
          ${value.issues.map((issue) => html`<div class="callout warn">${issue}</div>`)}
        `,
      )}
    </div>
  `;
}

function builderSetupTaskList(
  values: Array<{
    title: string;
    detail: string;
    status: string;
    refs: string[];
  }>,
) {
  if (values.length === 0) {
    return nothing;
  }
  return html`
    <div>
      <div class="label" style="margin-bottom:8px;">Setup Tasks</div>
      ${values.map(
        (value) => html`
          <div class="tpl-plan-file">
            <span>${value.title}</span>
            <span class="tpl-pill ${value.status === "completed" ? "tpl-pill--ok" : "tpl-pill--muted"}">${value.status}</span>
          </div>
          <div class="tpl-note">${value.detail}</div>
          ${
            value.refs.length > 0
              ? html`<div class="tpl-note mono">${value.refs.join(", ")}</div>`
              : nothing
          }
        `,
      )}
    </div>
  `;
}

function builderVerificationList(
  values: Array<{
    connectorLabel: string;
    probeLabel: string;
    status: string;
    detail: string;
  }>,
) {
  if (values.length === 0) {
    return nothing;
  }
  return html`
    <div>
      <div class="label" style="margin-bottom:8px;">Verification</div>
      ${values.map(
        (value) => html`
          <div class="tpl-plan-file">
            <span>${value.connectorLabel}: ${value.probeLabel}</span>
            <span class="tpl-pill ${verificationStatusPillClass(value.status)}">${value.status}</span>
          </div>
          <div class="tpl-note">${value.detail}</div>
        `,
      )}
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
