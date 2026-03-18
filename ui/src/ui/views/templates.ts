import { html, nothing } from "lit";
import type { AppViewState } from "../app-view-state.ts";
import {
  applyTemplate,
  loadTemplateCatalog,
  loadTemplatePlan,
  type TemplateCatalogEntry,
  type TemplateApplyResult,
  type TemplatesState,
} from "../controllers/templates.ts";

// ---------------------------------------------------------------------------
// Public API consumed by app-render.ts
// ---------------------------------------------------------------------------

export type TemplatesProps = {
  state: AppViewState;
  onSelectTemplate: (templateId: string) => void;
  onSelectPanel: (panel: "gallery" | "detail" | "plan") => void;
  onBackToGallery: () => void;
  onSetVariable: (key: string, value: string) => void;
  onApply: (templateId: string) => void;
  onConfirmApply: () => void;
  onCancelApply: () => void;
};

/** Called from app-render when switching to Plan panel */
export function triggerPlanLoad(state: TemplatesState, templateId: string) {
  void loadTemplatePlan(state, templateId);
}

/** Called from app-render when user confirms Apply */
export function triggerApply(state: TemplatesState, templateId: string) {
  void applyTemplate(state, templateId);
}

export function renderTemplates(props: TemplatesProps) {
  const { state } = props;

  // Auto-load catalog on first render when connected
  if (!state.templatesCatalog && !state.templatesCatalogLoading && state.connected) {
    void loadTemplateCatalog(state);
  }

  const catalog = state.templatesCatalog ?? [];
  const selected = catalog.find((e) => e.templateId === state.templatesSelectedId) ?? null;
  const panel = state.templatesPanel;

  return html`
    <div class="templates-layout">
      ${
        !selected || panel === "gallery"
          ? renderGallery(
              catalog,
              state.templatesCatalogLoading,
              state.templatesCatalogError,
              props,
            )
          : html`
              <div class="tpl-detail-nav">
                <button class="btn btn--sm" @click=${props.onBackToGallery}>
                  &larr; All templates
                </button>
                <div class="tpl-detail-nav__tabs">
                  ${(["detail", "plan"] as const).map(
                    (p) => html`
                      <button
                        class="btn btn--sm ${panel === p ? "active" : ""}"
                        @click=${() => props.onSelectPanel(p)}
                      >
                        ${p === "detail" ? "Details" : "Plan & Apply"}
                      </button>
                    `,
                  )}
                </div>
              </div>
              ${panel === "detail" ? renderDetail(selected) : nothing}
              ${panel === "plan" ? renderPlan(selected, state, props) : nothing}
            `
      }
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------

function renderGallery(
  catalog: TemplateCatalogEntry[],
  loading: boolean,
  error: string | null,
  props: TemplatesProps,
) {
  if (loading && catalog.length === 0) {
    return html`
      <div class="card">
        <div class="loading-spinner" style="padding: 32px">Loading templates...</div>
      </div>
    `;
  }
  if (error) {
    return html`<div class="callout danger">${error}</div>`;
  }
  if (catalog.length === 0) {
    return html`
      <div class="card">
        <div class="empty-state">
          <div class="empty-state__icon">\u{1F4E6}</div>
          <div class="empty-state__title">No templates available</div>
          <div class="empty-state__sub">Agent blueprint templates will appear here once registered.</div>
        </div>
      </div>
    `;
  }

  const starters = catalog.filter((e) => e.tier === "starter");
  const stretch = catalog.filter((e) => e.tier === "stretch");

  return html`
    ${starters.length ? renderTierSection("Starter Templates", starters, props) : nothing}
    ${stretch.length ? renderTierSection("Stretch Templates", stretch, props) : nothing}
  `;
}

function renderTierSection(title: string, entries: TemplateCatalogEntry[], props: TemplatesProps) {
  return html`
    <div class="label" style="margin-bottom: 8px; margin-top: 16px;">${title}</div>
    <div class="tpl-gallery">
      ${entries.map((entry) => renderCard(entry, props))}
    </div>
  `;
}

function renderCard(entry: TemplateCatalogEntry, props: TemplatesProps) {
  const bundle = asObject(entry.bundle);
  const agent = readObject(bundle, "agent");
  const identity = readObject(agent, "identity");

  return html`
    <button class="tpl-card" @click=${() => props.onSelectTemplate(entry.templateId)}>
      <div class="tpl-card-header">
        <span class="tpl-card-emoji">${emojiForIdentity(identity)}</span>
        <span class="tpl-card-name">${entry.displayName}</span>
      </div>
      <div class="tpl-card-summary">${entry.summary}</div>
      <div class="tpl-card-meta">
        ${entry.tags.map((tag) => html`<span class="tpl-pill tpl-pill--muted">${tag}</span>`)}
        ${
          entry.variables.length > 0
            ? html`<span class="tpl-pill tpl-pill--muted">${entry.variables.length} var${entry.variables.length > 1 ? "s" : ""}</span>`
            : nothing
        }
      </div>
    </button>
  `;
}

// ---------------------------------------------------------------------------
// Detail view
// ---------------------------------------------------------------------------

function renderDetail(entry: TemplateCatalogEntry) {
  const bundle = asObject(entry.bundle);
  if (!bundle) {
    return html`
      <div class="card">No bundle data available.</div>
    `;
  }

  const agent = readObject(bundle, "agent");
  const identity = readObject(agent, "identity");
  const workspace = readObject(bundle, "workspace");
  const runtime = readObject(bundle, "runtime");
  const tools = readObject(runtime, "tools");
  const ingress = readObject(bundle, "ingress");
  const ingressBindings = readObjectArray(ingress, "bindings");
  const automation = readObject(bundle, "automation");
  const automationSchedules = readObjectArray(automation, "schedules");
  const delivery = readObject(bundle, "delivery");
  const deliveryTarget = readObject(delivery, "target");
  const safety = readObject(bundle, "safety");
  const validation = readObject(bundle, "validation");
  const workspaceNotes = readStringArray(workspace, "notes");
  const workspaceBootstrapFiles = readStringArray(workspace, "bootstrapFiles");
  const extraTools = readStringArray(tools, "alsoAllow");
  const runtimeSkills = readStringArray(runtime, "skills");
  const validationPrerequisites = readStringArray(validation, "prerequisites");
  const validationSmokePrompts = readStringArray(validation, "smokePrompts");

  return html`
    <section class="card">
      <div class="tpl-detail-header">
        <span class="tpl-detail-emoji">${emojiForIdentity(identity)}</span>
        <div>
          <div class="card-title" style="margin-bottom:2px;">${entry.displayName}</div>
          <div class="card-sub">${entry.summary}</div>
        </div>
      </div>
      <div class="tpl-detail-tags">
        ${entry.tags.map((tag) => html`<span class="tpl-pill tpl-pill--muted">${tag}</span>`)}
      </div>
    </section>

    <section class="card">
      <div class="card-title" style="font-size:14px;">Agent Identity</div>
      <div class="agents-overview-grid" style="margin-top:8px;">
        ${kv("Agent ID", readString(agent, "agentId"))}
        ${kv("Name", readString(agent, "name"))}
        ${kv("Vibe", readString(identity, "vibe"))}
        ${kv("Emoji", readString(identity, "emoji"))}
      </div>
    </section>

    <section class="card">
      <div class="card-title" style="font-size:14px;">Workspace</div>
      <div class="agents-overview-grid" style="margin-top:8px;">
        ${kv("Template", readString(workspace, "template"))}
        ${kv("Memory Mode", readString(workspace, "memoryMode"))}
        ${kv("Bootstrap Files", joinOrDash(workspaceBootstrapFiles))}
      </div>
      ${
        workspaceNotes.length > 0
          ? html`
            <div style="margin-top:12px;">
              <div class="label">Notes</div>
              ${workspaceNotes.map((note) => html`<div class="tpl-note">${note}</div>`)}
            </div>
          `
          : nothing
      }
    </section>

    <section class="card">
      <div class="card-title" style="font-size:14px;">Runtime</div>
      <div class="agents-overview-grid" style="margin-top:8px;">
        ${kv("Model", readString(runtime, "model"))}
        ${kv("Thinking", readString(runtime, "thinking"))}
        ${kv("Tool Profile", readString(tools, "profile"))}
        ${extraTools.length > 0 ? kv("Extra Tools", extraTools.join(", ")) : nothing}
        ${kv("Skills", joinOrDash(runtimeSkills))}
      </div>
    </section>

    ${
      ingress
        ? html`
          <section class="card">
            <div class="card-title" style="font-size:14px;">Routing</div>
            <div class="agents-overview-grid" style="margin-top:8px;">
              ${kv("Interaction Mode", modeLabel(readString(ingress, "interactionMode", "")))}
            </div>
            ${
              ingressBindings.length > 0
                ? html`
                  <div style="margin-top:12px;">
                    <div class="label">Bindings</div>
                    ${ingressBindings.map(
                      (binding) => html`
                        <div class="tpl-binding">
                          <span class="mono">${readString(binding, "channel")}</span>
                          ${
                            hasText(readString(binding, "accountId", ""))
                              ? html`
                                  <span class="tpl-pill tpl-pill--muted">
                                    ${readString(binding, "accountId", "")}
                                  </span>
                                `
                              : nothing
                          }
                          ${
                            hasText(readString(binding, "peer", ""))
                              ? html`
                                  <span class="tpl-pill tpl-pill--muted">
                                    peer=${readString(binding, "peer", "")}
                                  </span>
                                `
                              : nothing
                          }
                        </div>
                      `,
                    )}
                  </div>
                `
                : nothing
            }
          </section>
        `
        : nothing
    }

    ${
      automationSchedules.length > 0
        ? html`
          <section class="card">
            <div class="card-title" style="font-size:14px;">Automation</div>
            ${automationSchedules.map(
              (sched) => html`
                <div class="tpl-schedule">
                  <div class="tpl-schedule-name">${readString(sched, "name")}</div>
                  <div class="mono" style="font-size:13px;">${readString(sched, "schedule")}</div>
                  <div class="tpl-schedule-purpose">${readString(sched, "purpose")}</div>
                </div>
              `,
            )}
          </section>
        `
        : nothing
    }

    ${
      delivery
        ? html`
          <section class="card">
            <div class="card-title" style="font-size:14px;">Delivery</div>
            <div class="agents-overview-grid" style="margin-top:8px;">
              ${kv("Mode", readString(delivery, "mode"))}
              ${kv("Format", readString(delivery, "format"))}
              ${hasText(readString(deliveryTarget, "channel", "")) ? kv("Channel", readString(deliveryTarget, "channel", "")) : nothing}
              ${hasText(readString(deliveryTarget, "to", "")) ? kv("To", readString(deliveryTarget, "to", "")) : nothing}
            </div>
          </section>
        `
        : nothing
    }

    ${
      safety
        ? html`
          <section class="card">
            <div class="card-title" style="font-size:14px;">Safety</div>
            <div class="agents-overview-grid" style="margin-top:8px;">
              ${kv("External Actions", readString(safety, "externalActionPolicy"))}
              ${kv("Config Write", readString(safety, "configWritePolicy"))}
              ${kv("Response Scope", readString(safety, "responseScope"))}
            </div>
          </section>
        `
        : nothing
    }

    ${
      validation
        ? html`
          <section class="card">
            <div class="card-title" style="font-size:14px;">Validation</div>
            ${
              validationPrerequisites.length > 0
                ? html`
                  <div class="label" style="margin-top:8px;">Prerequisites</div>
                  ${validationPrerequisites.map(
                    (prerequisite) => html`<div class="tpl-note">${prerequisite}</div>`,
                  )}
                `
                : nothing
            }
            ${
              validationSmokePrompts.length > 0
                ? html`
                  <div class="label" style="margin-top:12px;">Smoke Prompts</div>
                  ${validationSmokePrompts.map(
                    (prompt) => html`
                      <div class="tpl-note mono" style="font-size:13px;">${prompt}</div>
                    `,
                  )}
                `
                : nothing
            }
          </section>
        `
        : nothing
    }
  `;
}

// ---------------------------------------------------------------------------
// Plan & Apply view (server-compiled plan + apply button)
// ---------------------------------------------------------------------------

function renderPlan(entry: TemplateCatalogEntry, state: AppViewState, props: TemplatesProps) {
  const planResult = state.templatesPlan;
  const planLoading = state.templatesPlanLoading;
  const planError = state.templatesPlanError;
  const applyResult = state.templatesApplyResult;
  const applying = state.templatesApplying;
  const applyError = state.templatesApplyError;
  const confirmApply = state.templatesConfirmApply;

  // Variable input section
  const variables = entry.variables ?? [];
  const variablesSection =
    variables.length > 0
      ? html`
        <section class="card">
          <div class="card-title" style="font-size:14px;">Template Variables</div>
          <div class="card-sub" style="margin-bottom:12px;">
            Fill in these values before planning or applying.
          </div>
          ${variables.map(
            (name) => html`
              <label class="field" style="margin-bottom:8px;">
                <span class="mono" style="font-size:13px;">${name}</span>
                <input
                  type="text"
                  .value=${state.templatesVariables[name] ?? ""}
                  @input=${(e: Event) =>
                    props.onSetVariable(name, (e.target as HTMLInputElement).value)}
                  placeholder="value for {{${name}}}"
                />
              </label>
            `,
          )}
          <button
            class="btn btn--sm"
            style="margin-top:4px;"
            @click=${() => {
              if (state.templatesSelectedId) {
                triggerPlanLoad(state, state.templatesSelectedId);
              }
            }}
          >
            Re-plan with variables
          </button>
        </section>
      `
      : nothing;

  // Plan loading / error
  if (planLoading) {
    return html`
      ${variablesSection}
      <div class="card">
        <div class="loading-spinner" style="padding:32px;">Compiling execution plan...</div>
      </div>
    `;
  }
  if (planError) {
    return html`
      ${variablesSection}
      <div class="callout danger">${planError}</div>
    `;
  }
  if (!planResult) {
    return html`
      ${variablesSection}
      <div class="card" style="text-align:center; padding:40px;">
        <button
          class="btn primary"
          @click=${() => {
            if (state.templatesSelectedId) {
              triggerPlanLoad(state, state.templatesSelectedId);
            }
          }}
        >
          Generate Plan
        </button>
      </div>
    `;
  }

  const plan = asObject(planResult.plan) ?? {};
  const planStatus = readString(plan, "status", "ready");
  const issues = readObjectArray(plan, "issues");
  const agent = readObject(plan, "agent");
  const workspace = readObject(plan, "workspace");
  const runtime = readObject(plan, "runtime");
  const routing = readObject(plan, "routing");
  const automation = readObject(plan, "automation");
  const validation = readObject(plan, "validation");
  const toolPolicy = readObject(runtime, "tools");
  const bootstrapFiles = readObjectArray(workspace, "bootstrapFiles");
  const bindings = readObjectArray(routing, "bindings");
  const schedules = readObjectArray(automation, "schedules");
  const prerequisites = readStringArray(validation, "prerequisites");

  // Unresolved variables warning
  const unresolvedSection =
    planResult.unresolved.length > 0
      ? html`
        <div class="callout warn" style="margin-bottom:12px;">
          Unresolved variables: ${planResult.unresolved.map((v) => html`<code>{{${v}}}</code> `)}
          — fill in values above and re-plan.
        </div>
      `
      : nothing;

  return html`
    ${variablesSection}
    ${unresolvedSection}

    <section class="card">
      <div class="tpl-plan-header">
        <div class="card-title" style="font-size:14px;">Execution Plan</div>
        <span class="tpl-pill ${planStatus === "ready" ? "tpl-pill--ok" : "tpl-pill--error"}">
          ${planStatus}
        </span>
      </div>
      <div class="card-sub">
        Server-compiled plan for what this template will configure.
      </div>
      ${
        issues.length > 0
          ? html`
            <div class="tpl-plan-issues">
              ${issues.map(
                (issue) => html`
                  <div
                    class="callout ${
                      readString(issue, "severity", "warn") === "error" ? "danger" : "warn"
                    }"
                  >
                    ${readString(issue, "message")}
                  </div>
                `,
              )}
            </div>
          `
          : nothing
      }
    </section>

    <section class="card">
      <div class="card-title" style="font-size:14px;">Agent</div>
      <div class="agents-overview-grid" style="margin-top:8px;">
        ${kv("Agent ID", readString(agent, "agentId"))}
        ${kv("Display Name", readString(agent, "name"))}
        ${kv("Workspace", readString(agent, "workspaceDir"))}
        ${kv("Agent Dir", readString(agent, "agentDir"))}
      </div>
    </section>

    <section class="card">
      <div class="card-title" style="font-size:14px;">Workspace Files</div>
      <div class="tpl-plan-files">
        ${bootstrapFiles.map(
          (file) => html`
            <div class="tpl-plan-file">
              <span class="mono">${readString(file, "name")}</span>
              <span class="tpl-pill tpl-pill--muted">create</span>
            </div>
          `,
        )}
      </div>
    </section>

    ${
      toolPolicy
        ? html`
          <section class="card">
            <div class="card-title" style="font-size:14px;">Tool Policy</div>
            <div class="agents-overview-grid" style="margin-top:8px;">
              ${kv("Base Profile", readString(toolPolicy, "profile"))}
              ${
                readStringArray(toolPolicy, "customAllow").length > 0
                  ? kv("Custom Allow", readStringArray(toolPolicy, "customAllow").join(", "))
                  : nothing
              }
              ${
                readStringArray(toolPolicy, "deny").length > 0
                  ? kv("Deny", readStringArray(toolPolicy, "deny").join(", "))
                  : nothing
              }
            </div>
          </section>
        `
        : nothing
    }

    ${
      bindings.length > 0
        ? html`
          <section class="card">
            <div class="card-title" style="font-size:14px;">Routing Bindings</div>
            ${bindings.map(
              (binding) => html`
                <div class="tpl-plan-file">
                  <span class="mono">${describeBinding(binding)}</span>
                  <span class="tpl-pill tpl-pill--muted">bind</span>
                </div>
              `,
            )}
          </section>
        `
        : nothing
    }

    ${
      schedules.length > 0
        ? html`
          <section class="card">
            <div class="card-title" style="font-size:14px;">Schedules</div>
            ${schedules.map(
              (sched) => html`
                <div class="tpl-plan-file">
                  <span class="mono">${readString(sched, "schedule")}</span>
                  <span style="margin-left:8px; color:var(--muted);">
                    ${readString(sched, "purpose")}
                  </span>
                </div>
              `,
            )}
          </section>
        `
        : nothing
    }

    ${
      prerequisites.length > 0
        ? html`
          <section class="card">
            <div class="card-title" style="font-size:14px;">Prerequisites</div>
            ${prerequisites.map((p) => html`<div class="tpl-note">${p}</div>`)}
          </section>
        `
        : nothing
    }

    <!-- Apply section -->
    ${renderApplySection(entry, planStatus, state, props, applyResult, applying, applyError, confirmApply)}
  `;
}

// ---------------------------------------------------------------------------
// Apply section
// ---------------------------------------------------------------------------

function renderApplySection(
  entry: TemplateCatalogEntry,
  planStatus: string,
  state: AppViewState,
  props: TemplatesProps,
  applyResult: TemplateApplyResult | null,
  applying: boolean,
  applyError: string | null,
  confirmApply: boolean,
) {
  // Already applied successfully
  if (applyResult) {
    return html`
      <section class="card applied-banner">
        <div class="card-title section-title" style="color:var(--ok);">
          Blueprint Applied
        </div>
        <div class="agents-overview-grid" style="margin-top:8px;">
          ${kv("Agent ID", applyResult.agent.agentId)}
          ${kv("Name", applyResult.agent.name)}
          ${kv("Workspace", applyResult.agent.workspaceDir)}
        </div>

        ${
          applyResult.workspace.files.length > 0
            ? html`
              <div class="label" style="margin-top:12px;">Workspace Files</div>
              ${applyResult.workspace.files.map(
                (f) => html`
                  <div class="tpl-plan-file">
                    <span class="mono">${f.name}</span>
                    <span class="tpl-pill ${f.status === "created" ? "tpl-pill--ok" : "tpl-pill--muted"}">${f.status}</span>
                  </div>
                `,
              )}
            `
            : nothing
        }

        ${
          applyResult.bindings.added.length > 0
            ? html`
              <div class="label" style="margin-top:12px;">Bindings Added</div>
              ${applyResult.bindings.added.map(
                (b) => html`<div class="tpl-note mono" style="font-size:13px;">${b}</div>`,
              )}
            `
            : nothing
        }

        ${
          applyResult.automation.jobs.length > 0
            ? html`
              <div class="label" style="margin-top:12px;">Cron Jobs</div>
              ${applyResult.automation.jobs.map(
                (j) => html`
                  <div class="tpl-plan-file">
                    <span class="mono">${j.name}</span>
                    <span class="tpl-pill ${j.status === "created" ? "tpl-pill--ok" : "tpl-pill--muted"}">${j.status}</span>
                  </div>
                `,
              )}
            `
            : nothing
        }

        ${
          applyResult.warnings.length > 0
            ? html`
              <div class="label" style="margin-top:12px;">Warnings</div>
              ${applyResult.warnings.map((w) => html`<div class="callout warn">${w.message}</div>`)}
            `
            : nothing
        }
      </section>
    `;
  }

  // Apply error
  if (applyError) {
    return html`
      <section class="card">
        <div class="callout danger">${applyError}</div>
        <button
          class="btn primary"
          style="margin-top:12px;"
          @click=${() => props.onApply(entry.templateId)}
        >
          Retry Apply
        </button>
      </section>
    `;
  }

  // Applying in progress
  if (applying) {
    return html`
      <section class="card">
        <div class="loading-spinner" style="padding: 24px">Applying blueprint...</div>
      </section>
    `;
  }

  // Confirm dialog
  if (confirmApply) {
    return html`
      <section class="card confirm-banner">
        <div class="card-title" style="font-size:14px;">Confirm Apply</div>
        <div class="card-sub" style="margin-bottom:12px;">
          This will create or update the agent <strong>${entry.displayName}</strong>,
          write workspace files, configure routing bindings, and set up cron jobs.
          Existing agent config will be modified.
        </div>
        <div style="display:flex; gap:8px;">
          <button
            class="btn primary"
            @click=${() => props.onApply(entry.templateId)}
          >
            Yes, Apply Blueprint
          </button>
          <button class="btn" @click=${props.onCancelApply}>Cancel</button>
        </div>
      </section>
    `;
  }

  // Apply button (disabled if plan is invalid)
  const disabled = planStatus !== "ready";
  return html`
    <section class="card" style="text-align:center; padding:24px;">
      <button
        class="btn primary"
        ?disabled=${disabled}
        @click=${() => props.onConfirmApply()}
        style="font-size:15px; padding:10px 32px;"
      >
        Apply Blueprint
      </button>
      ${
        disabled
          ? html`
              <div class="card-sub" style="margin-top: 8px">Fix plan issues before applying.</div>
            `
          : html`
              <div class="card-sub" style="margin-top: 8px">Creates the agent and configures everything.</div>
            `
      }
    </section>
  `;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emojiForIdentity(identity: Record<string, unknown> | undefined): string {
  const emoji = readString(identity, "emoji", "");
  if (!emoji) {
    return "\u{1F916}";
  }
  const map: Record<string, string> = {
    compass: "\u{1F9ED}",
    sunrise: "\u{1F305}",
    lifering: "\u{1F6DF}",
    search: "\u{1F50D}",
    tools: "\u{1F6E0}",
    megaphone: "\u{1F4E3}",
  };
  return map[emoji] ?? "\u{1F916}";
}

function modeLabel(mode?: string): string {
  switch (mode) {
    case "direct":
      return "Direct";
    case "scheduled":
      return "Scheduled";
    case "bound-channel":
      return "Bound Channel";
    case "hybrid":
      return "Hybrid";
    default:
      return mode ?? "-";
  }
}

function kv(label: string, value: string) {
  return html`
    <div class="agent-kv">
      <div class="label">${label}</div>
      <div>${value}</div>
    </div>
  `;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asObjectArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => asObject(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function readObject(record: Record<string, unknown> | undefined, key: string) {
  return asObject(record?.[key]);
}

function readObjectArray(record: Record<string, unknown> | undefined, key: string) {
  return asObjectArray(record?.[key]);
}

function readStringArray(record: Record<string, unknown> | undefined, key: string) {
  return asStringArray(record?.[key]);
}

function readString(
  record: Record<string, unknown> | undefined,
  key: string,
  fallback = "-",
): string {
  return formatUnknownValue(record?.[key], fallback);
}

function formatUnknownValue(value: unknown, fallback = "-"): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

function joinOrDash(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "-";
}

function hasText(value: string): boolean {
  return value.trim().length > 0;
}

function describeBinding(binding: Record<string, unknown>): string {
  const description = readString(binding, "description", "");
  if (description) {
    return description;
  }
  const requested = binding.requested ?? binding;
  try {
    const serialized = JSON.stringify(requested);
    return typeof serialized === "string" ? serialized : "-";
  } catch {
    return "-";
  }
}
