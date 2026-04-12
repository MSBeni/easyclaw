import { html, nothing } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";
import { t } from "../../i18n/index.ts";
import type {
  CronFieldErrors,
  CronFieldKey,
  CronJobsLastStatusFilter,
  CronJobsScheduleKindFilter,
} from "../controllers/cron.ts";
import { formatRelativeTimestamp, formatMs } from "../format.ts";
import { pathForTab } from "../navigation.ts";
import { formatCronSchedule, formatNextRun } from "../presenter.ts";
import type {
  ChannelUiMetaEntry,
  CronJob,
  CronRunLogEntry,
  CronStatus,
  CronTraceStep,
} from "../types.ts";
import type {
  CronDeliveryStatus,
  CronJobsEnabledFilter,
  CronRunScope,
  CronRunsStatusValue,
  CronJobsSortBy,
  CronRunsStatusFilter,
  CronSortDir,
} from "../types.ts";
import type { CronFormState } from "../ui-types.ts";

export type CronProps = {
  basePath: string;
  loading: boolean;
  jobsLoadingMore: boolean;
  status: CronStatus | null;
  jobs: CronJob[];
  jobsTotal: number;
  jobsHasMore: boolean;
  jobsQuery: string;
  jobsEnabledFilter: CronJobsEnabledFilter;
  jobsScheduleKindFilter: CronJobsScheduleKindFilter;
  jobsLastStatusFilter: CronJobsLastStatusFilter;
  jobsSortBy: CronJobsSortBy;
  jobsSortDir: CronSortDir;
  error: string | null;
  notice: string | null;
  busy: boolean;
  form: CronFormState;
  fieldErrors: CronFieldErrors;
  canSubmit: boolean;
  editingJobId: string | null;
  channels: string[];
  channelLabels?: Record<string, string>;
  channelMeta?: ChannelUiMetaEntry[];
  runsJobId: string | null;
  runs: CronRunLogEntry[];
  runsTotal: number;
  runsHasMore: boolean;
  runsLoadingMore: boolean;
  runsScope: CronRunScope;
  runsStatuses: CronRunsStatusValue[];
  runsDeliveryStatuses: CronDeliveryStatus[];
  runsStatusFilter: CronRunsStatusFilter;
  runsQuery: string;
  runsSortDir: CronSortDir;
  agentSuggestions: string[];
  modelSuggestions: string[];
  thinkingSuggestions: string[];
  timezoneSuggestions: string[];
  deliveryToSuggestions: string[];
  accountSuggestions: string[];
  execApprovalQueue: Array<{
    id: string;
    createdAtMs: number;
    expiresAtMs: number;
    request: {
      command: string;
      agentId?: string | null;
      sessionKey?: string | null;
    };
  }>;
  onFormChange: (patch: Partial<CronFormState>) => void;
  onRefresh: () => void;
  onAdd: () => void;
  onEdit: (job: CronJob) => void;
  onClone: (job: CronJob) => void;
  onCancelEdit: () => void;
  onToggle: (job: CronJob, enabled: boolean) => void;
  onRun: (job: CronJob, mode?: "force" | "due") => void;
  onRemove: (job: CronJob) => void;
  onLoadRuns: (jobId: string) => void;
  onLoadMoreJobs: () => void;
  onJobsFiltersChange: (patch: {
    cronJobsQuery?: string;
    cronJobsEnabledFilter?: CronJobsEnabledFilter;
    cronJobsScheduleKindFilter?: CronJobsScheduleKindFilter;
    cronJobsLastStatusFilter?: CronJobsLastStatusFilter;
    cronJobsSortBy?: CronJobsSortBy;
    cronJobsSortDir?: CronSortDir;
  }) => void | Promise<void>;
  onJobsFiltersReset: () => void | Promise<void>;
  onLoadMoreRuns: () => void;
  onRunsFiltersChange: (patch: {
    cronRunsScope?: CronRunScope;
    cronRunsStatuses?: CronRunsStatusValue[];
    cronRunsDeliveryStatuses?: CronDeliveryStatus[];
    cronRunsStatusFilter?: CronRunsStatusFilter;
    cronRunsQuery?: string;
    cronRunsSortDir?: CronSortDir;
  }) => void | Promise<void>;
  onRetryRun: (jobId: string) => void;
};

type CronExecutionStatus = "ok" | "error" | "pending" | "skipped" | "ready";

function getRunStatusOptions(): Array<{ value: CronRunsStatusValue; label: string }> {
  return [
    { value: "ok", label: t("cron.runs.runStatusOk") },
    { value: "error", label: t("cron.runs.runStatusError") },
    { value: "skipped", label: t("cron.runs.runStatusSkipped") },
  ];
}

function getRunDeliveryOptions(): Array<{ value: CronDeliveryStatus; label: string }> {
  return [
    { value: "delivered", label: t("cron.runs.deliveryDelivered") },
    { value: "not-delivered", label: t("cron.runs.deliveryNotDelivered") },
    { value: "unknown", label: t("cron.runs.deliveryUnknown") },
    { value: "not-requested", label: t("cron.runs.deliveryNotRequested") },
  ];
}

function toggleSelection<T extends string>(selected: T[], value: T, checked: boolean): T[] {
  const set = new Set(selected);
  if (checked) {
    set.add(value);
  } else {
    set.delete(value);
  }
  return Array.from(set);
}

function summarizeSelection(selectedLabels: string[], allLabel: string) {
  if (selectedLabels.length === 0) {
    return allLabel;
  }
  if (selectedLabels.length <= 2) {
    return selectedLabels.join(", ");
  }
  return `${selectedLabels[0]} +${selectedLabels.length - 1}`;
}

function buildChannelOptions(props: CronProps): string[] {
  const options = ["last", ...props.channels.filter(Boolean)];
  const current = props.form.deliveryChannel?.trim();
  if (current && !options.includes(current)) {
    options.push(current);
  }
  const seen = new Set<string>();
  return options.filter((value) => {
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return true;
  });
}

function resolveChannelLabel(props: CronProps, channel: string): string {
  if (channel === "last") {
    return "last";
  }
  const meta = props.channelMeta?.find((entry) => entry.id === channel);
  if (meta?.label) {
    return meta.label;
  }
  return props.channelLabels?.[channel] ?? channel;
}

function renderRunFilterDropdown(params: {
  id: string;
  title: string;
  summary: string;
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onToggle: (value: string, checked: boolean) => void;
  onClear: () => void;
}) {
  return html`
    <div class="field cron-filter-dropdown" data-filter=${params.id}>
      <span>${params.title}</span>
      <details class="cron-filter-dropdown__details">
        <summary class="btn cron-filter-dropdown__trigger">
          <span>${params.summary}</span>
        </summary>
        <div class="cron-filter-dropdown__panel">
          <div class="cron-filter-dropdown__list">
            ${params.options.map(
              (option) => html`
                <label class="cron-filter-dropdown__option">
                  <input
                    type="checkbox"
                    value=${option.value}
                    .checked=${params.selected.includes(option.value)}
                    @change=${(event: Event) => {
                      const target = event.target as HTMLInputElement;
                      params.onToggle(option.value, target.checked);
                    }}
                  />
                  <span>${option.label}</span>
                </label>
              `,
            )}
          </div>
          <div class="row">
            <button class="btn" type="button" @click=${params.onClear}>${t("cron.runs.clear")}</button>
          </div>
        </div>
      </details>
    </div>
  `;
}

function renderSuggestionList(id: string, options: string[]) {
  const clean = Array.from(new Set(options.map((option) => option.trim()).filter(Boolean)));
  if (clean.length === 0) {
    return nothing;
  }
  return html`<datalist id=${id}>
    ${clean.map((value) => html`<option value=${value}></option> `)}
  </datalist>`;
}

type BlockingField = {
  key: CronFieldKey;
  label: string;
  message: string;
  inputId: string;
};

function errorIdForField(key: CronFieldKey) {
  return `cron-error-${key}`;
}

function inputIdForField(key: CronFieldKey) {
  if (key === "name") {
    return "cron-name";
  }
  if (key === "scheduleAt") {
    return "cron-schedule-at";
  }
  if (key === "everyAmount") {
    return "cron-every-amount";
  }
  if (key === "cronExpr") {
    return "cron-cron-expr";
  }
  if (key === "staggerAmount") {
    return "cron-stagger-amount";
  }
  if (key === "payloadText") {
    return "cron-payload-text";
  }
  if (key === "payloadModel") {
    return "cron-payload-model";
  }
  if (key === "payloadThinking") {
    return "cron-payload-thinking";
  }
  if (key === "timeoutSeconds") {
    return "cron-timeout-seconds";
  }
  if (key === "failureAlertAfter") {
    return "cron-failure-alert-after";
  }
  if (key === "failureAlertCooldownSeconds") {
    return "cron-failure-alert-cooldown-seconds";
  }
  return "cron-delivery-to";
}

function fieldLabelForKey(
  key: CronFieldKey,
  form: CronFormState,
  deliveryMode: CronFormState["deliveryMode"],
) {
  if (key === "payloadText") {
    return form.payloadKind === "systemEvent"
      ? t("cron.form.mainTimelineMessage")
      : t("cron.form.assistantTaskPrompt");
  }
  if (key === "deliveryTo") {
    return deliveryMode === "webhook" ? t("cron.form.webhookUrl") : t("cron.form.to");
  }
  const labels: Record<CronFieldKey, string> = {
    name: t("cron.form.fieldName"),
    scheduleAt: t("cron.form.runAt"),
    everyAmount: t("cron.form.every"),
    cronExpr: t("cron.form.expression"),
    staggerAmount: t("cron.form.staggerWindow"),
    payloadText: t("cron.form.assistantTaskPrompt"),
    payloadModel: t("cron.form.model"),
    payloadThinking: t("cron.form.thinking"),
    timeoutSeconds: t("cron.form.timeoutSeconds"),
    deliveryTo: t("cron.form.to"),
    failureAlertAfter: "Failure alert after",
    failureAlertCooldownSeconds: "Failure alert cooldown",
  };
  return labels[key];
}

function collectBlockingFields(
  errors: CronFieldErrors,
  form: CronFormState,
  deliveryMode: CronFormState["deliveryMode"],
): BlockingField[] {
  const orderedKeys: CronFieldKey[] = [
    "name",
    "scheduleAt",
    "everyAmount",
    "cronExpr",
    "staggerAmount",
    "payloadText",
    "payloadModel",
    "payloadThinking",
    "timeoutSeconds",
    "deliveryTo",
    "failureAlertAfter",
    "failureAlertCooldownSeconds",
  ];
  const fields: BlockingField[] = [];
  for (const key of orderedKeys) {
    const message = errors[key];
    if (!message) {
      continue;
    }
    fields.push({
      key,
      label: fieldLabelForKey(key, form, deliveryMode),
      message,
      inputId: inputIdForField(key),
    });
  }
  return fields;
}

function focusFormField(id: string) {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLElement)) {
    return;
  }
  if (typeof el.scrollIntoView === "function") {
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  el.focus();
}

function renderFieldLabel(text: string, required = false) {
  return html`<span>
    ${text}
    ${
      required
        ? html`
            <span class="cron-required-marker" aria-hidden="true">*</span>
            <span class="cron-required-sr">${t("cron.form.requiredSr")}</span>
          `
        : nothing
    }
  </span>`;
}

function executionStatusLabel(status: CronExecutionStatus) {
  switch (status) {
    case "ok":
      return "OK";
    case "error":
      return "Error";
    case "pending":
      return "Pending";
    case "skipped":
      return "Skipped";
    case "ready":
      return "Ready";
  }
}

function executionStatusChipClass(status: CronExecutionStatus) {
  switch (status) {
    case "ok":
    case "ready":
      return "chip-ok";
    case "error":
      return "chip-danger";
    case "pending":
      return "chip-warn";
    case "skipped":
      return "";
  }
}

function resolveRuntimeStatus(value?: string | null): CronExecutionStatus {
  if (value === "ok") {
    return "ok";
  }
  if (value === "error") {
    return "error";
  }
  if (value === "skipped") {
    return "skipped";
  }
  return "ready";
}

function resolveDeliveryExecutionStatus(
  value?: "delivered" | "not-delivered" | "unknown" | "not-requested",
): CronExecutionStatus {
  switch (value) {
    case "delivered":
      return "ok";
    case "not-delivered":
      return "error";
    case "unknown":
      return "pending";
    case "not-requested":
      return "skipped";
    default:
      return "ready";
  }
}

function describeJobRuntime(job: CronJob) {
  if (job.sessionTarget === "main") {
    return "Main-session heartbeat";
  }
  if (job.sessionTarget === "isolated") {
    return "Isolated agent run";
  }
  if (job.sessionTarget === "current") {
    return "Current session run";
  }
  return `Session ${job.sessionTarget}`;
}

function describeDeliveryTarget(job: CronJob) {
  const delivery = job.delivery;
  if (!delivery || delivery.mode === "none") {
    return "No delivery step configured.";
  }
  if (delivery.mode === "webhook") {
    return delivery.to ? `Webhook to ${delivery.to}` : "Webhook delivery";
  }
  const channel = delivery.channel ?? "last";
  return delivery.to ? `Announce via ${channel} -> ${delivery.to}` : `Announce via ${channel}`;
}

function collectMatchingApprovals(params: {
  job?: CronJob;
  entry?: CronRunLogEntry;
  queue: CronProps["execApprovalQueue"];
}) {
  const sessionKeys = new Set<string>();
  const runSessionKey = params.entry?.sessionKey?.trim();
  const jobSessionKey = params.job?.sessionKey?.trim();
  if (runSessionKey) {
    sessionKeys.add(runSessionKey);
  }
  if (jobSessionKey) {
    sessionKeys.add(jobSessionKey);
  }
  return params.queue.filter((entry) => {
    const approvalSessionKey = entry.request.sessionKey?.trim();
    if (approvalSessionKey && sessionKeys.has(approvalSessionKey)) {
      return true;
    }
    if (sessionKeys.size > 0) {
      return false;
    }
    const approvalAgentId = entry.request.agentId?.trim();
    return Boolean(
      params.job?.agentId && approvalAgentId && approvalAgentId === params.job.agentId,
    );
  });
}

function renderTraceSteps(steps: CronTraceStep[]) {
  return html`
    <div style="display:flex; flex-direction:column; gap:8px; margin-top:8px;">
      ${steps.map(
        (step) => html`
          <div
            style="display:grid; grid-template-columns:minmax(120px, 170px) auto; gap:10px; align-items:start;"
          >
            <div>
              <div class="list-sub">${step.label}</div>
              <span class=${`chip ${executionStatusChipClass(step.status)}`}>${executionStatusLabel(step.status)}</span>
            </div>
            <div class="muted">${step.detail}</div>
          </div>
        `,
      )}
    </div>
  `;
}

function resolveApprovalTraceStep(
  matchingApprovals: CronProps["execApprovalQueue"],
): CronTraceStep {
  return matchingApprovals.length > 0
    ? {
        key: "approvals",
        label: "Approvals",
        status: "pending",
        detail:
          matchingApprovals.length === 1
            ? (matchingApprovals[0]?.request.command ?? "1 exec approval is pending.")
            : `${matchingApprovals.length} exec approvals are currently pending for this path.`,
      }
    : {
        key: "approvals",
        label: "Approvals",
        status: "skipped",
        detail: "No live exec approvals are waiting on this run.",
      };
}

function withLiveApprovals(
  steps: CronTraceStep[],
  matchingApprovals: CronProps["execApprovalQueue"],
): CronTraceStep[] {
  const approvalStep = resolveApprovalTraceStep(matchingApprovals);
  const next = steps.map((step) => ({ ...step }));
  const index = next.findIndex((step) => step.key === "approvals");
  if (index >= 0) {
    next[index] = approvalStep;
    return next;
  }
  return [...next, approvalStep];
}

function failureStageLabel(stage?: CronRunLogEntry["failureStage"]) {
  switch (stage) {
    case "schedule":
      return "Schedule";
    case "runtime":
      return "Runtime";
    case "delivery":
      return "Delivery";
    case "approvals":
      return "Approvals";
    default:
      return "Unknown";
  }
}

function summarizeSkippedActions(trace?: CronTraceStep[]) {
  const skipped =
    trace?.filter((step) => step.status === "skipped").map((step) => step.label) ?? [];
  return skipped.length > 0 ? skipped.join(", ") : "";
}

function buildExecutionGraphSteps(params: {
  job: CronJob;
  latestRun?: CronRunLogEntry;
  matchingApprovals: CronProps["execApprovalQueue"];
}) {
  const { job, latestRun, matchingApprovals } = params;
  if (latestRun?.trace?.length) {
    return withLiveApprovals(latestRun.trace, matchingApprovals);
  }
  const lastRunAt = job.state?.lastRunAtMs;
  const nextRunAt = job.state?.nextRunAtMs;
  const schedulerStatus =
    latestRun?.status === "skipped" && latestRun.error?.includes("not due")
      ? "skipped"
      : typeof job.state?.runningAtMs === "number"
        ? "pending"
        : latestRun
          ? "ok"
          : job.enabled
            ? "ready"
            : "skipped";
  const runtimeStatus =
    typeof job.state?.runningAtMs === "number" && !latestRun
      ? "pending"
      : latestRun
        ? resolveRuntimeStatus(latestRun.status)
        : resolveRuntimeStatus(job.state?.lastStatus);
  const deliveryStatus = latestRun
    ? resolveDeliveryExecutionStatus(latestRun.deliveryStatus ?? "not-requested")
    : job.delivery && job.delivery.mode !== "none"
      ? "ready"
      : "skipped";
  const approvalStatus = matchingApprovals.length > 0 ? "pending" : "ready";

  return [
    {
      key: "schedule",
      label: "Scheduler",
      status: schedulerStatus satisfies CronExecutionStatus,
      detail:
        `Last ${formatStateRelative(lastRunAt)} · Next ${formatStateRelative(nextRunAt)}`.trim(),
    },
    {
      key: "runtime",
      label: "Runtime",
      status: runtimeStatus,
      detail:
        latestRun?.summary ??
        latestRun?.error ??
        `${describeJobRuntime(job)}${job.agentId ? ` · agent ${job.agentId}` : ""}`,
    },
    {
      key: "delivery",
      label: "Delivery",
      status: deliveryStatus,
      detail:
        latestRun?.deliveryError ??
        runDeliveryLabel(latestRun?.deliveryStatus ?? "not-requested") ??
        describeDeliveryTarget(job),
    },
    {
      key: "approvals",
      label: "Approvals",
      status: approvalStatus,
      detail:
        matchingApprovals.length > 0
          ? `${matchingApprovals.length} pending approval${matchingApprovals.length === 1 ? "" : "s"}`
          : "No pending exec approvals for this execution path.",
    },
  ] satisfies CronTraceStep[];
}

function buildRunTraceSteps(params: {
  entry: CronRunLogEntry;
  job?: CronJob;
  matchingApprovals: CronProps["execApprovalQueue"];
}) {
  const { entry, job, matchingApprovals } = params;
  if (entry.trace?.length) {
    return withLiveApprovals(entry.trace, matchingApprovals);
  }
  const steps: CronTraceStep[] = [
    {
      key: "schedule",
      label: "Schedule",
      status: entry.status === "skipped" ? "skipped" : "ok",
      detail:
        typeof entry.runAtMs === "number"
          ? `Triggered ${formatMs(entry.runAtMs)}`
          : "Run was accepted by the scheduler.",
    },
    {
      key: "runtime",
      label: "Runtime",
      status: resolveRuntimeStatus(entry.status),
      detail:
        entry.error ??
        entry.summary ??
        `${job ? describeJobRuntime(job) : "Execution completed"}${entry.model ? ` · ${entry.model}` : ""}`,
    },
    {
      key: "delivery",
      label: "Delivery",
      status: resolveDeliveryExecutionStatus(entry.deliveryStatus ?? "not-requested"),
      detail:
        entry.deliveryError ??
        (job
          ? describeDeliveryTarget(job)
          : runDeliveryLabel(entry.deliveryStatus ?? "not-requested")),
    },
  ];
  steps.push(resolveApprovalTraceStep(matchingApprovals));
  return steps;
}

function renderExecutionOverview(params: {
  job?: CronJob;
  latestRun?: CronRunLogEntry;
  runs: CronRunLogEntry[];
  matchingApprovals: CronProps["execApprovalQueue"];
}) {
  if (!params.job) {
    return nothing;
  }
  const skippedRuns = params.runs.filter(
    (entry) => entry.jobId === params.job?.id && entry.status === "skipped",
  ).length;
  const steps = buildExecutionGraphSteps({
    job: params.job,
    latestRun: params.latestRun,
    matchingApprovals: params.matchingApprovals,
  });
  return html`
    <div class="callout info" style="margin-top: 12px;">
      <div class="row" style="justify-content: space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
        <div>
          <div style="font-weight:600;">Execution graph</div>
          <div class="muted">${describeJobRuntime(params.job)}${params.job.agentId ? ` · agent ${params.job.agentId}` : ""}</div>
        </div>
        <div class="chip-row">
          <span class="chip">Last ${formatStateRelative(params.job.state?.lastRunAtMs)}</span>
          <span class="chip">Next ${formatStateRelative(params.job.state?.nextRunAtMs)}</span>
          <span class=${`chip ${params.matchingApprovals.length > 0 ? "chip-warn" : ""}`}>
            ${params.matchingApprovals.length} pending approvals
          </span>
          <span class=${`chip ${skippedRuns > 0 ? "chip-warn" : ""}`}>${skippedRuns} skipped runs</span>
        </div>
      </div>
      ${renderTraceSteps(steps)}
    </div>
  `;
}

function renderDeadLetterQueue(params: {
  basePath: string;
  runs: CronRunLogEntry[];
  jobsById: Map<string, CronJob>;
  onRetryRun: (jobId: string) => void;
}) {
  const failedRuns = params.runs.filter((entry) => entry.deadLetter ?? entry.status === "error");
  if (failedRuns.length === 0) {
    return nothing;
  }
  const visible = failedRuns.slice(0, 5);
  return html`
    <div class="callout danger" style="margin-top: 12px;">
      <div class="row" style="justify-content: space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
        <div>
          <div style="font-weight:600;">Dead-letter queue</div>
          <div class="muted">
            ${failedRuns.length} failed run${failedRuns.length === 1 ? "" : "s"} waiting for review,
            replay, or retry.
          </div>
        </div>
        <div class="chip-row">
          <span class="chip chip-danger">${failedRuns.length} failed</span>
        </div>
      </div>
      <div style="display:flex; flex-direction:column; gap:8px; margin-top:10px;">
        ${visible.map((entry) => {
          const job = params.jobsById.get(entry.jobId);
          const chatUrl =
            typeof entry.sessionKey === "string" && entry.sessionKey.trim().length > 0
              ? `${pathForTab("chat", params.basePath)}?session=${encodeURIComponent(entry.sessionKey)}`
              : null;
          const skipped = summarizeSkippedActions(entry.trace);
          const canRetry = entry.retryable ?? entry.status !== "ok";
          const canReplay = entry.replayable ?? Boolean(chatUrl);
          return html`
            <div class="list-item">
              <div class="list-main">
                <div class="list-title">${entry.jobName ?? job?.name ?? entry.jobId}</div>
                <div class="list-sub">
                  ${entry.error ?? entry.summary ?? "Run failed without a recorded summary."}
                </div>
                <div class="chip-row" style="margin-top:6px;">
                  <span class="chip chip-danger">${failureStageLabel(entry.failureStage)}</span>
                  ${skipped ? html`<span class="chip">Skipped: ${skipped}</span>` : nothing}
                </div>
              </div>
              <div class="list-meta">
                <div>${formatMs(entry.ts)}</div>
                ${
                  typeof entry.runAtMs === "number"
                    ? html`<div class="muted">${t("cron.runEntry.runAt")} ${formatMs(entry.runAtMs)}</div>`
                    : nothing
                }
                <div class="row" style="justify-content:flex-end; gap:8px; flex-wrap:wrap; margin-top:8px;">
                  ${
                    canRetry
                      ? html`
                          <button class="btn btn--sm" type="button" @click=${() => params.onRetryRun(entry.jobId)}>
                            Retry now
                          </button>
                        `
                      : nothing
                  }
                  ${
                    canReplay && chatUrl
                      ? html`<a class="btn btn--sm" href=${chatUrl}>Replay in chat</a>`
                      : nothing
                  }
                </div>
              </div>
            </div>
          `;
        })}
      </div>
    </div>
  `;
}

export function renderCron(props: CronProps) {
  const isEditing = Boolean(props.editingJobId);
  const isAgentTurn = props.form.payloadKind === "agentTurn";
  const isCronSchedule = props.form.scheduleKind === "cron";
  const channelOptions = buildChannelOptions(props);
  const selectedJob =
    props.runsJobId == null ? undefined : props.jobs.find((job) => job.id === props.runsJobId);
  const selectedRunTitle =
    props.runsScope === "all"
      ? t("cron.jobList.allJobs")
      : (selectedJob?.name ?? props.runsJobId ?? t("cron.jobList.selectJob"));
  const runs = props.runs.toSorted((a, b) =>
    props.runsSortDir === "asc" ? a.ts - b.ts : b.ts - a.ts,
  );
  const jobsById = new Map(props.jobs.map((job) => [job.id, job]));
  const executionJob =
    props.runsScope === "job" ? selectedJob : runs[0] ? jobsById.get(runs[0].jobId) : undefined;
  const latestRunForExecutionJob =
    executionJob == null ? undefined : runs.find((entry) => entry.jobId === executionJob.id);
  const executionApprovals = collectMatchingApprovals({
    job: executionJob,
    entry: latestRunForExecutionJob,
    queue: props.execApprovalQueue,
  });
  const runStatusOptions = getRunStatusOptions();
  const runDeliveryOptions = getRunDeliveryOptions();
  const selectedStatusLabels = runStatusOptions
    .filter((option) => props.runsStatuses.includes(option.value))
    .map((option) => option.label);
  const selectedDeliveryLabels = runDeliveryOptions
    .filter((option) => props.runsDeliveryStatuses.includes(option.value))
    .map((option) => option.label);
  const statusSummary = summarizeSelection(selectedStatusLabels, t("cron.runs.allStatuses"));
  const deliverySummary = summarizeSelection(selectedDeliveryLabels, t("cron.runs.allDelivery"));
  const supportsAnnounce =
    props.form.sessionTarget !== "main" && props.form.payloadKind === "agentTurn";
  const selectedDeliveryMode =
    props.form.deliveryMode === "announce" && !supportsAnnounce ? "none" : props.form.deliveryMode;
  const blockingFields = collectBlockingFields(props.fieldErrors, props.form, selectedDeliveryMode);
  const blockedByValidation = !props.busy && blockingFields.length > 0;
  const hasActiveJobsFilters =
    props.jobsQuery.trim().length > 0 ||
    props.jobsEnabledFilter !== "all" ||
    props.jobsScheduleKindFilter !== "all" ||
    props.jobsLastStatusFilter !== "all" ||
    props.jobsSortBy !== "nextRunAtMs" ||
    props.jobsSortDir !== "asc";
  const submitDisabledReason =
    blockedByValidation && !props.canSubmit
      ? blockingFields.length === 1
        ? t("cron.form.fixFields", { count: String(blockingFields.length) })
        : t("cron.form.fixFieldsPlural", { count: String(blockingFields.length) })
      : "";
  return html`
    <section class="card cron-summary-strip">
      <div class="cron-summary-strip__left">
        <div class="cron-summary-item">
          <div class="cron-summary-label">${t("cron.summary.enabled")}</div>
          <div class="cron-summary-value">
            <span class=${`chip ${props.status?.enabled ? "chip-ok" : "chip-danger"}`}>
              ${
                props.status
                  ? props.status.enabled
                    ? t("cron.summary.yes")
                    : t("cron.summary.no")
                  : t("common.na")
              }
            </span>
          </div>
        </div>
        <div class="cron-summary-item">
          <div class="cron-summary-label">${t("cron.summary.jobs")}</div>
          <div class="cron-summary-value">${props.status?.jobs ?? t("common.na")}</div>
        </div>
        <div class="cron-summary-item cron-summary-item--wide">
          <div class="cron-summary-label">${t("cron.summary.nextWake")}</div>
          <div class="cron-summary-value">${formatNextRun(props.status?.nextWakeAtMs ?? null)}</div>
        </div>
      </div>
      <div class="cron-summary-strip__actions">
        <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
          ${props.loading ? t("cron.summary.refreshing") : t("cron.summary.refresh")}
        </button>
        ${
          props.notice
            ? html`<div class="callout info" style="margin-top: 8px;">${props.notice}</div>`
            : nothing
        }
        ${
          props.error
            ? html`<div class="callout danger" style="margin-top: 8px;">${props.error}</div>`
            : nothing
        }
      </div>
    </section>

    <section class="cron-workspace">
      <div class="cron-workspace-main">
        <section class="card">
          <div class="row" style="justify-content: space-between; align-items: flex-start; gap: 12px;">
            <div>
              <div class="card-title">${t("cron.jobs.title")}</div>
              <div class="card-sub">${t("cron.jobs.subtitle")}</div>
            </div>
            <div class="muted">${t("cron.jobs.shownOf", {
              shown: String(props.jobs.length),
              total: String(props.jobsTotal),
            })}</div>
          </div>
          <div class="filters" style="margin-top: 12px;">
            <label class="field cron-filter-search">
              <span>${t("cron.jobs.searchJobs")}</span>
              <input
                .value=${props.jobsQuery}
                placeholder=${t("cron.jobs.searchPlaceholder")}
                @input=${(e: Event) =>
                  props.onJobsFiltersChange({
                    cronJobsQuery: (e.target as HTMLInputElement).value,
                  })}
              />
            </label>
            <label class="field">
              <span>${t("cron.jobs.enabled")}</span>
              <select
                .value=${props.jobsEnabledFilter}
                @change=${(e: Event) =>
                  props.onJobsFiltersChange({
                    cronJobsEnabledFilter: (e.target as HTMLSelectElement)
                      .value as CronJobsEnabledFilter,
                  })}
              >
                <option value="all">${t("cron.jobs.all")}</option>
                <option value="enabled">${t("common.enabled")}</option>
                <option value="disabled">${t("common.disabled")}</option>
              </select>
            </label>
            <label class="field">
              <span>${t("cron.jobs.schedule")}</span>
              <select
                data-test-id="cron-jobs-schedule-filter"
                .value=${props.jobsScheduleKindFilter}
                @change=${(e: Event) =>
                  props.onJobsFiltersChange({
                    cronJobsScheduleKindFilter: (e.target as HTMLSelectElement)
                      .value as CronJobsScheduleKindFilter,
                  })}
              >
                <option value="all">${t("cron.jobs.all")}</option>
                <option value="at">${t("cron.form.at")}</option>
                <option value="every">${t("cron.form.every")}</option>
                <option value="cron">${t("cron.form.cronOption")}</option>
              </select>
            </label>
            <label class="field">
              <span>${t("cron.jobs.lastRun")}</span>
              <select
                data-test-id="cron-jobs-last-status-filter"
                .value=${props.jobsLastStatusFilter}
                @change=${(e: Event) =>
                  props.onJobsFiltersChange({
                    cronJobsLastStatusFilter: (e.target as HTMLSelectElement)
                      .value as CronJobsLastStatusFilter,
                  })}
              >
                <option value="all">${t("cron.jobs.all")}</option>
                <option value="ok">${t("cron.runs.runStatusOk")}</option>
                <option value="error">${t("cron.runs.runStatusError")}</option>
                <option value="skipped">${t("cron.runs.runStatusSkipped")}</option>
              </select>
            </label>
            <label class="field">
              <span>${t("cron.jobs.sort")}</span>
              <select
                .value=${props.jobsSortBy}
                @change=${(e: Event) =>
                  props.onJobsFiltersChange({
                    cronJobsSortBy: (e.target as HTMLSelectElement).value as CronJobsSortBy,
                  })}
              >
                <option value="nextRunAtMs">${t("cron.jobs.nextRun")}</option>
                <option value="updatedAtMs">${t("cron.jobs.recentlyUpdated")}</option>
                <option value="name">${t("cron.jobs.name")}</option>
              </select>
            </label>
            <label class="field">
              <span>${t("cron.jobs.direction")}</span>
              <select
                .value=${props.jobsSortDir}
                @change=${(e: Event) =>
                  props.onJobsFiltersChange({
                    cronJobsSortDir: (e.target as HTMLSelectElement).value as CronSortDir,
                  })}
              >
                <option value="asc">${t("cron.jobs.ascending")}</option>
                <option value="desc">${t("cron.jobs.descending")}</option>
              </select>
            </label>
            <label class="field">
              <span>${t("cron.jobs.reset")}</span>
              <button
                class="btn"
                data-test-id="cron-jobs-filters-reset"
                ?disabled=${!hasActiveJobsFilters}
                @click=${props.onJobsFiltersReset}
              >
                ${t("cron.jobs.reset")}
              </button>
            </label>
          </div>
          ${
            props.jobs.length === 0
              ? html`
                  <div class="muted" style="margin-top: 12px">${t("cron.jobs.noMatching")}</div>
                `
              : html`
                  <div class="list" style="margin-top: 12px;">
                    ${props.jobs.map((job) => renderJob(job, props))}
                  </div>
                `
          }
          ${
            props.jobsHasMore
              ? html`
                  <div class="row" style="margin-top: 12px">
                    <button
                      class="btn"
                      ?disabled=${props.loading || props.jobsLoadingMore}
                      @click=${props.onLoadMoreJobs}
                    >
                      ${props.jobsLoadingMore ? t("cron.jobs.loading") : t("cron.jobs.loadMore")}
                    </button>
                  </div>
                `
              : nothing
          }
        </section>

        <section class="card">
          <div class="row" style="justify-content: space-between; align-items: flex-start; gap: 12px;">
            <div>
              <div class="card-title">${t("cron.runs.title")}</div>
              <div class="card-sub">
                ${
                  props.runsScope === "all"
                    ? t("cron.runs.subtitleAll")
                    : t("cron.runs.subtitleJob", { title: selectedRunTitle })
                }
              </div>
            </div>
            <div class="muted">${t("cron.jobs.shownOf", {
              shown: String(runs.length),
              total: String(props.runsTotal),
            })}</div>
          </div>
          <div class="cron-run-filters">
            ${renderExecutionOverview({
              job: executionJob,
              latestRun: latestRunForExecutionJob,
              runs,
              matchingApprovals: executionApprovals,
            })}
            ${renderDeadLetterQueue({
              basePath: props.basePath,
              runs,
              jobsById,
              onRetryRun: props.onRetryRun,
            })}
            <div class="cron-run-filters__row cron-run-filters__row--primary">
              <label class="field">
                <span>${t("cron.runs.scope")}</span>
                <select
                  .value=${props.runsScope}
                  @change=${(e: Event) =>
                    props.onRunsFiltersChange({
                      cronRunsScope: (e.target as HTMLSelectElement).value as CronRunScope,
                    })}
                >
                  <option value="all">${t("cron.runs.allJobs")}</option>
                  <option value="job" ?disabled=${props.runsJobId == null}>${t("cron.runs.selectedJob")}</option>
                </select>
              </label>
              <label class="field cron-run-filter-search">
                <span>${t("cron.runs.searchRuns")}</span>
                <input
                  .value=${props.runsQuery}
                  placeholder=${t("cron.runs.searchPlaceholder")}
                  @input=${(e: Event) =>
                    props.onRunsFiltersChange({
                      cronRunsQuery: (e.target as HTMLInputElement).value,
                    })}
                />
              </label>
              <label class="field">
                <span>${t("cron.jobs.sort")}</span>
                <select
                  .value=${props.runsSortDir}
                  @change=${(e: Event) =>
                    props.onRunsFiltersChange({
                      cronRunsSortDir: (e.target as HTMLSelectElement).value as CronSortDir,
                    })}
                >
                  <option value="desc">${t("cron.runs.newestFirst")}</option>
                  <option value="asc">${t("cron.runs.oldestFirst")}</option>
                </select>
              </label>
            </div>
            <div class="cron-run-filters__row cron-run-filters__row--secondary">
              ${renderRunFilterDropdown({
                id: "status",
                title: t("cron.runs.status"),
                summary: statusSummary,
                options: runStatusOptions,
                selected: props.runsStatuses,
                onToggle: (value, checked) => {
                  const next = toggleSelection(
                    props.runsStatuses,
                    value as CronRunsStatusValue,
                    checked,
                  );
                  void props.onRunsFiltersChange({ cronRunsStatuses: next });
                },
                onClear: () => {
                  void props.onRunsFiltersChange({ cronRunsStatuses: [] });
                },
              })}
              ${renderRunFilterDropdown({
                id: "delivery",
                title: t("cron.runs.delivery"),
                summary: deliverySummary,
                options: runDeliveryOptions,
                selected: props.runsDeliveryStatuses,
                onToggle: (value, checked) => {
                  const next = toggleSelection(
                    props.runsDeliveryStatuses,
                    value as CronDeliveryStatus,
                    checked,
                  );
                  void props.onRunsFiltersChange({ cronRunsDeliveryStatuses: next });
                },
                onClear: () => {
                  void props.onRunsFiltersChange({ cronRunsDeliveryStatuses: [] });
                },
              })}
            </div>
          </div>
          ${
            props.runsScope === "job" && props.runsJobId == null
              ? html`
                  <div class="muted" style="margin-top: 12px">${t("cron.runs.selectJobHint")}</div>
                `
              : runs.length === 0
                ? html`
                    <div class="muted" style="margin-top: 12px">${t("cron.runs.noMatching")}</div>
                  `
                : html`
                    <div class="list" style="margin-top: 12px;">
                      ${runs.map((entry) =>
                        renderRun(
                          entry,
                          props.basePath,
                          jobsById.get(entry.jobId),
                          collectMatchingApprovals({
                            job: jobsById.get(entry.jobId),
                            entry,
                            queue: props.execApprovalQueue,
                          }),
                          props.onRetryRun,
                        ),
                      )}
                    </div>
                  `
          }
          ${
            (props.runsScope === "all" || props.runsJobId != null) && props.runsHasMore
              ? html`
                  <div class="row" style="margin-top: 12px">
                    <button
                      class="btn"
                      ?disabled=${props.runsLoadingMore}
                      @click=${props.onLoadMoreRuns}
                    >
                      ${props.runsLoadingMore ? t("cron.jobs.loading") : t("cron.runs.loadMore")}
                    </button>
                  </div>
                `
              : nothing
          }
        </section>
      </div>

      <section class="card cron-workspace-form">
        <div class="card-title">${isEditing ? t("cron.form.editJob") : t("cron.form.newJob")}</div>
        <div class="card-sub">
          ${isEditing ? t("cron.form.updateSubtitle") : t("cron.form.createSubtitle")}
        </div>
        <div class="cron-form">
          <div class="cron-required-legend">
            <span class="cron-required-marker" aria-hidden="true">*</span> ${t("cron.form.required")}
          </div>
          <section class="cron-form-section">
            <div class="cron-form-section__title">${t("cron.form.basics")}</div>
            <div class="cron-form-section__sub">${t("cron.form.basicsSub")}</div>
            <div class="form-grid cron-form-grid">
              <label class="field">
                ${renderFieldLabel(t("cron.form.fieldName"), true)}
                <input
                  id="cron-name"
                  .value=${props.form.name}
                  placeholder=${t("cron.form.namePlaceholder")}
                  aria-invalid=${props.fieldErrors.name ? "true" : "false"}
                  aria-describedby=${ifDefined(
                    props.fieldErrors.name ? errorIdForField("name") : undefined,
                  )}
                  @input=${(e: Event) =>
                    props.onFormChange({ name: (e.target as HTMLInputElement).value })}
                />
                ${renderFieldError(props.fieldErrors.name, errorIdForField("name"))}
              </label>
              <label class="field">
                <span>${t("cron.form.description")}</span>
                <input
                  .value=${props.form.description}
                  placeholder=${t("cron.form.descriptionPlaceholder")}
                  @input=${(e: Event) =>
                    props.onFormChange({ description: (e.target as HTMLInputElement).value })}
                />
              </label>
              <label class="field">
                ${renderFieldLabel(t("cron.form.agentId"))}
                <input
                  id="cron-agent-id"
                  .value=${props.form.agentId}
                  list="cron-agent-suggestions"
                  ?disabled=${props.form.clearAgent}
                  @input=${(e: Event) =>
                    props.onFormChange({ agentId: (e.target as HTMLInputElement).value })}
                  placeholder=${t("cron.form.agentPlaceholder")}
                />
                <div class="cron-help">${t("cron.form.agentHelp")}</div>
              </label>
              <label class="field checkbox cron-checkbox cron-checkbox-inline">
                <input
                  type="checkbox"
                  .checked=${props.form.enabled}
                  @change=${(e: Event) =>
                    props.onFormChange({ enabled: (e.target as HTMLInputElement).checked })}
                />
                <span class="field-checkbox__label">${t("cron.summary.enabled")}</span>
              </label>
            </div>
          </section>

          <section class="cron-form-section">
            <div class="cron-form-section__title">${t("cron.form.schedule")}</div>
            <div class="cron-form-section__sub">${t("cron.form.scheduleSub")}</div>
            <div class="form-grid cron-form-grid">
              <label class="field cron-span-2">
                ${renderFieldLabel(t("cron.form.schedule"))}
                <select
                  id="cron-schedule-kind"
                  .value=${props.form.scheduleKind}
                  @change=${(e: Event) =>
                    props.onFormChange({
                      scheduleKind: (e.target as HTMLSelectElement)
                        .value as CronFormState["scheduleKind"],
                    })}
                >
                  <option value="every">${t("cron.form.every")}</option>
                  <option value="at">${t("cron.form.at")}</option>
                  <option value="cron">${t("cron.form.cronOption")}</option>
                </select>
              </label>
            </div>
            ${renderScheduleFields(props)}
          </section>

          <section class="cron-form-section">
            <div class="cron-form-section__title">${t("cron.form.execution")}</div>
            <div class="cron-form-section__sub">${t("cron.form.executionSub")}</div>
            <div class="form-grid cron-form-grid">
              <label class="field">
                ${renderFieldLabel(t("cron.form.session"))}
                <select
                  id="cron-session-target"
                  .value=${props.form.sessionTarget}
                  @change=${(e: Event) =>
                    props.onFormChange({
                      sessionTarget: (e.target as HTMLSelectElement)
                        .value as CronFormState["sessionTarget"],
                    })}
                >
                  <option value="main">${t("cron.form.main")}</option>
                  <option value="isolated">${t("cron.form.isolated")}</option>
                </select>
                <div class="cron-help">${t("cron.form.sessionHelp")}</div>
              </label>
              <label class="field">
                ${renderFieldLabel(t("cron.form.wakeMode"))}
                <select
                  id="cron-wake-mode"
                  .value=${props.form.wakeMode}
                  @change=${(e: Event) =>
                    props.onFormChange({
                      wakeMode: (e.target as HTMLSelectElement).value as CronFormState["wakeMode"],
                    })}
                >
                  <option value="now">${t("cron.form.now")}</option>
                  <option value="next-heartbeat">${t("cron.form.nextHeartbeat")}</option>
                </select>
                <div class="cron-help">${t("cron.form.wakeModeHelp")}</div>
              </label>
              <label class="field ${isAgentTurn ? "" : "cron-span-2"}">
                ${renderFieldLabel(t("cron.form.payloadKind"))}
                <select
                  id="cron-payload-kind"
                  .value=${props.form.payloadKind}
                  @change=${(e: Event) =>
                    props.onFormChange({
                      payloadKind: (e.target as HTMLSelectElement)
                        .value as CronFormState["payloadKind"],
                    })}
                >
                  <option value="systemEvent">${t("cron.form.systemEvent")}</option>
                  <option value="agentTurn">${t("cron.form.agentTurn")}</option>
                </select>
                <div class="cron-help">
                  ${
                    props.form.payloadKind === "systemEvent"
                      ? t("cron.form.systemEventHelp")
                      : t("cron.form.agentTurnHelp")
                  }
                </div>
              </label>
              ${
                isAgentTurn
                  ? html`
                      <label class="field">
                        ${renderFieldLabel(t("cron.form.timeoutSeconds"))}
                        <input
                          id="cron-timeout-seconds"
                          .value=${props.form.timeoutSeconds}
                          placeholder=${t("cron.form.timeoutPlaceholder")}
                          aria-invalid=${props.fieldErrors.timeoutSeconds ? "true" : "false"}
                          aria-describedby=${ifDefined(
                            props.fieldErrors.timeoutSeconds
                              ? errorIdForField("timeoutSeconds")
                              : undefined,
                          )}
                          @input=${(e: Event) =>
                            props.onFormChange({
                              timeoutSeconds: (e.target as HTMLInputElement).value,
                            })}
                        />
                        <div class="cron-help">${t("cron.form.timeoutHelp")}</div>
                        ${renderFieldError(
                          props.fieldErrors.timeoutSeconds,
                          errorIdForField("timeoutSeconds"),
                        )}
                      </label>
                    `
                  : nothing
              }
            </div>
            <label class="field cron-span-2">
              ${renderFieldLabel(
                props.form.payloadKind === "systemEvent"
                  ? t("cron.form.mainTimelineMessage")
                  : t("cron.form.assistantTaskPrompt"),
                true,
              )}
              <textarea
                id="cron-payload-text"
                .value=${props.form.payloadText}
                aria-invalid=${props.fieldErrors.payloadText ? "true" : "false"}
                aria-describedby=${ifDefined(
                  props.fieldErrors.payloadText ? errorIdForField("payloadText") : undefined,
                )}
                @input=${(e: Event) =>
                  props.onFormChange({
                    payloadText: (e.target as HTMLTextAreaElement).value,
                  })}
                rows="4"
              ></textarea>
              ${renderFieldError(props.fieldErrors.payloadText, errorIdForField("payloadText"))}
            </label>
          </section>

          <section class="cron-form-section">
            <div class="cron-form-section__title">${t("cron.form.deliverySection")}</div>
            <div class="cron-form-section__sub">${t("cron.form.deliverySub")}</div>
            <div class="form-grid cron-form-grid">
              <label class="field ${selectedDeliveryMode === "none" ? "cron-span-2" : ""}">
                ${renderFieldLabel(t("cron.form.resultDelivery"))}
                <select
                  id="cron-delivery-mode"
                  .value=${selectedDeliveryMode}
                  @change=${(e: Event) =>
                    props.onFormChange({
                      deliveryMode: (e.target as HTMLSelectElement)
                        .value as CronFormState["deliveryMode"],
                    })}
                >
                  ${
                    supportsAnnounce
                      ? html`
                          <option value="announce">${t("cron.form.announceDefault")}</option>
                        `
                      : nothing
                  }
                  <option value="webhook">${t("cron.form.webhookPost")}</option>
                  <option value="none">${t("cron.form.noneInternal")}</option>
                </select>
                <div class="cron-help">${t("cron.form.deliveryHelp")}</div>
              </label>
              ${
                selectedDeliveryMode !== "none"
                  ? html`
                      <label class="field ${selectedDeliveryMode === "webhook" ? "cron-span-2" : ""}">
                        ${renderFieldLabel(
                          selectedDeliveryMode === "webhook"
                            ? t("cron.form.webhookUrl")
                            : t("cron.form.channel"),
                          selectedDeliveryMode === "webhook",
                        )}
                        ${
                          selectedDeliveryMode === "webhook"
                            ? html`
                                <input
                                  id="cron-delivery-to"
                                  .value=${props.form.deliveryTo}
                                  list="cron-delivery-to-suggestions"
                                  aria-invalid=${props.fieldErrors.deliveryTo ? "true" : "false"}
                                  aria-describedby=${ifDefined(
                                    props.fieldErrors.deliveryTo
                                      ? errorIdForField("deliveryTo")
                                      : undefined,
                                  )}
                                  @input=${(e: Event) =>
                                    props.onFormChange({
                                      deliveryTo: (e.target as HTMLInputElement).value,
                                    })}
                                  placeholder=${t("cron.form.webhookPlaceholder")}
                                />
                              `
                            : html`
                                <select
                                  id="cron-delivery-channel"
                                  .value=${props.form.deliveryChannel || "last"}
                                  @change=${(e: Event) =>
                                    props.onFormChange({
                                      deliveryChannel: (e.target as HTMLSelectElement).value,
                                    })}
                                >
                                  ${channelOptions.map(
                                    (channel) =>
                                      html`<option value=${channel}>
                                        ${resolveChannelLabel(props, channel)}
                                      </option>`,
                                  )}
                                </select>
                              `
                        }
                        ${
                          selectedDeliveryMode === "announce"
                            ? html`
                                <div class="cron-help">${t("cron.form.channelHelp")}</div>
                              `
                            : html`
                                <div class="cron-help">${t("cron.form.webhookHelp")}</div>
                              `
                        }
                      </label>
                      ${
                        selectedDeliveryMode === "announce"
                          ? html`
                              <label class="field cron-span-2">
                                ${renderFieldLabel(t("cron.form.to"))}
                                <input
                                  id="cron-delivery-to"
                                  .value=${props.form.deliveryTo}
                                  list="cron-delivery-to-suggestions"
                                  @input=${(e: Event) =>
                                    props.onFormChange({
                                      deliveryTo: (e.target as HTMLInputElement).value,
                                    })}
                                  placeholder=${t("cron.form.toPlaceholder")}
                                />
                                <div class="cron-help">${t("cron.form.toHelp")}</div>
                              </label>
                            `
                          : nothing
                      }
                      ${
                        selectedDeliveryMode === "webhook"
                          ? renderFieldError(
                              props.fieldErrors.deliveryTo,
                              errorIdForField("deliveryTo"),
                            )
                          : nothing
                      }
                    `
                  : nothing
              }
            </div>
          </section>

          <details class="cron-advanced">
            <summary class="cron-advanced__summary">${t("cron.form.advanced")}</summary>
            <div class="cron-help">${t("cron.form.advancedHelp")}</div>
            <div class="form-grid cron-form-grid">
              <label class="field checkbox cron-checkbox">
                <input
                  type="checkbox"
                  .checked=${props.form.deleteAfterRun}
                  @change=${(e: Event) =>
                    props.onFormChange({
                      deleteAfterRun: (e.target as HTMLInputElement).checked,
                    })}
                />
                <span class="field-checkbox__label">${t("cron.form.deleteAfterRun")}</span>
                <div class="cron-help">${t("cron.form.deleteAfterRunHelp")}</div>
              </label>
              <label class="field checkbox cron-checkbox">
                <input
                  type="checkbox"
                  .checked=${props.form.clearAgent}
                  @change=${(e: Event) =>
                    props.onFormChange({
                      clearAgent: (e.target as HTMLInputElement).checked,
                    })}
                />
                <span class="field-checkbox__label">${t("cron.form.clearAgentOverride")}</span>
                <div class="cron-help">${t("cron.form.clearAgentHelp")}</div>
              </label>
              <label class="field cron-span-2">
                ${renderFieldLabel("Session key")}
                <input
                  id="cron-session-key"
                  .value=${props.form.sessionKey}
                  @input=${(e: Event) =>
                    props.onFormChange({
                      sessionKey: (e.target as HTMLInputElement).value,
                    })}
                  placeholder="agent:main:main"
                />
                <div class="cron-help">
                  Optional routing key for job delivery and wake routing.
                </div>
              </label>
              ${
                isCronSchedule
                  ? html`
                      <label class="field checkbox cron-checkbox cron-span-2">
                        <input
                          type="checkbox"
                          .checked=${props.form.scheduleExact}
                          @change=${(e: Event) =>
                            props.onFormChange({
                              scheduleExact: (e.target as HTMLInputElement).checked,
                            })}
                        />
                        <span class="field-checkbox__label">${t("cron.form.exactTiming")}</span>
                        <div class="cron-help">${t("cron.form.exactTimingHelp")}</div>
                      </label>
                      <div class="cron-stagger-group cron-span-2">
                        <label class="field">
                          ${renderFieldLabel(t("cron.form.staggerWindow"))}
                          <input
                            id="cron-stagger-amount"
                            .value=${props.form.staggerAmount}
                            ?disabled=${props.form.scheduleExact}
                            aria-invalid=${props.fieldErrors.staggerAmount ? "true" : "false"}
                            aria-describedby=${ifDefined(
                              props.fieldErrors.staggerAmount
                                ? errorIdForField("staggerAmount")
                                : undefined,
                            )}
                            @input=${(e: Event) =>
                              props.onFormChange({
                                staggerAmount: (e.target as HTMLInputElement).value,
                              })}
                            placeholder=${t("cron.form.staggerPlaceholder")}
                          />
                          ${renderFieldError(
                            props.fieldErrors.staggerAmount,
                            errorIdForField("staggerAmount"),
                          )}
                        </label>
                        <label class="field">
                          <span>${t("cron.form.staggerUnit")}</span>
                          <select
                            .value=${props.form.staggerUnit}
                            ?disabled=${props.form.scheduleExact}
                            @change=${(e: Event) =>
                              props.onFormChange({
                                staggerUnit: (e.target as HTMLSelectElement)
                                  .value as CronFormState["staggerUnit"],
                              })}
                          >
                            <option value="seconds">${t("cron.form.seconds")}</option>
                            <option value="minutes">${t("cron.form.minutes")}</option>
                          </select>
                        </label>
                      </div>
                    `
                  : nothing
              }
              ${
                isAgentTurn
                  ? html`
                      <label class="field cron-span-2">
                        ${renderFieldLabel("Account ID")}
                        <input
                          id="cron-delivery-account-id"
                          .value=${props.form.deliveryAccountId}
                          list="cron-delivery-account-suggestions"
                          ?disabled=${selectedDeliveryMode !== "announce"}
                          @input=${(e: Event) =>
                            props.onFormChange({
                              deliveryAccountId: (e.target as HTMLInputElement).value,
                            })}
                          placeholder="default"
                        />
                        <div class="cron-help">
                          Optional channel account ID for multi-account setups.
                        </div>
                      </label>
                      <label class="field checkbox cron-checkbox cron-span-2">
                        <input
                          type="checkbox"
                          .checked=${props.form.payloadLightContext}
                          @change=${(e: Event) =>
                            props.onFormChange({
                              payloadLightContext: (e.target as HTMLInputElement).checked,
                            })}
                        />
                        <span class="field-checkbox__label">Light context</span>
                        <div class="cron-help">
                          Use lightweight bootstrap context for this agent job.
                        </div>
                      </label>
                      <label class="field">
                        ${renderFieldLabel(t("cron.form.model"))}
                        <input
                          id="cron-payload-model"
                          .value=${props.form.payloadModel}
                          list="cron-model-suggestions"
                          @input=${(e: Event) =>
                            props.onFormChange({
                              payloadModel: (e.target as HTMLInputElement).value,
                            })}
                          placeholder=${t("cron.form.modelPlaceholder")}
                        />
                        <div class="cron-help">${t("cron.form.modelHelp")}</div>
                      </label>
                      <label class="field">
                        ${renderFieldLabel(t("cron.form.thinking"))}
                        <input
                          id="cron-payload-thinking"
                          .value=${props.form.payloadThinking}
                          list="cron-thinking-suggestions"
                          @input=${(e: Event) =>
                            props.onFormChange({
                              payloadThinking: (e.target as HTMLInputElement).value,
                            })}
                          placeholder=${t("cron.form.thinkingPlaceholder")}
                        />
                        <div class="cron-help">${t("cron.form.thinkingHelp")}</div>
                      </label>
                    `
                  : nothing
              }
              ${
                isAgentTurn
                  ? html`
                      <label class="field cron-span-2">
                        ${renderFieldLabel("Failure alerts")}
                        <select
                          .value=${props.form.failureAlertMode}
                          @change=${(e: Event) =>
                            props.onFormChange({
                              failureAlertMode: (e.target as HTMLSelectElement)
                                .value as CronFormState["failureAlertMode"],
                            })}
                        >
                          <option value="inherit">Inherit global setting</option>
                          <option value="disabled">Disable for this job</option>
                          <option value="custom">Custom per-job settings</option>
                        </select>
                        <div class="cron-help">
                          Control when this job sends repeated-failure alerts.
                        </div>
                      </label>
                      ${
                        props.form.failureAlertMode === "custom"
                          ? html`
                              <label class="field">
                                ${renderFieldLabel("Alert after")}
                                <input
                                  id="cron-failure-alert-after"
                                  .value=${props.form.failureAlertAfter}
                                  aria-invalid=${props.fieldErrors.failureAlertAfter ? "true" : "false"}
                                  aria-describedby=${ifDefined(
                                    props.fieldErrors.failureAlertAfter
                                      ? errorIdForField("failureAlertAfter")
                                      : undefined,
                                  )}
                                  @input=${(e: Event) =>
                                    props.onFormChange({
                                      failureAlertAfter: (e.target as HTMLInputElement).value,
                                    })}
                                  placeholder="2"
                                />
                                <div class="cron-help">Consecutive errors before alerting.</div>
                                ${renderFieldError(
                                  props.fieldErrors.failureAlertAfter,
                                  errorIdForField("failureAlertAfter"),
                                )}
                              </label>
                              <label class="field">
                                ${renderFieldLabel("Cooldown (seconds)")}
                                <input
                                  id="cron-failure-alert-cooldown-seconds"
                                  .value=${props.form.failureAlertCooldownSeconds}
                                  aria-invalid=${props.fieldErrors.failureAlertCooldownSeconds ? "true" : "false"}
                                  aria-describedby=${ifDefined(
                                    props.fieldErrors.failureAlertCooldownSeconds
                                      ? errorIdForField("failureAlertCooldownSeconds")
                                      : undefined,
                                  )}
                                  @input=${(e: Event) =>
                                    props.onFormChange({
                                      failureAlertCooldownSeconds: (e.target as HTMLInputElement)
                                        .value,
                                    })}
                                  placeholder="3600"
                                />
                                <div class="cron-help">Minimum seconds between alerts.</div>
                                ${renderFieldError(
                                  props.fieldErrors.failureAlertCooldownSeconds,
                                  errorIdForField("failureAlertCooldownSeconds"),
                                )}
                              </label>
                              <label class="field">
                                ${renderFieldLabel("Alert channel")}
                                <select
                                  .value=${props.form.failureAlertChannel || "last"}
                                  @change=${(e: Event) =>
                                    props.onFormChange({
                                      failureAlertChannel: (e.target as HTMLSelectElement).value,
                                    })}
                                >
                                  ${channelOptions.map(
                                    (channel) =>
                                      html`<option value=${channel}>
                                        ${resolveChannelLabel(props, channel)}
                                      </option>`,
                                  )}
                                </select>
                              </label>
                              <label class="field">
                                ${renderFieldLabel("Alert to")}
                                <input
                                  .value=${props.form.failureAlertTo}
                                  list="cron-delivery-to-suggestions"
                                  @input=${(e: Event) =>
                                    props.onFormChange({
                                      failureAlertTo: (e.target as HTMLInputElement).value,
                                    })}
                                  placeholder="+1555... or chat id"
                                />
                                <div class="cron-help">
                                  Optional recipient override for failure alerts.
                                </div>
                              </label>
                              <label class="field">
                                ${renderFieldLabel("Alert mode")}
                                <select
                                  .value=${props.form.failureAlertDeliveryMode || "announce"}
                                  @change=${(e: Event) =>
                                    props.onFormChange({
                                      failureAlertDeliveryMode: (e.target as HTMLSelectElement)
                                        .value as CronFormState["failureAlertDeliveryMode"],
                                    })}
                                >
                                  <option value="announce">Announce (via channel)</option>
                                  <option value="webhook">Webhook (HTTP POST)</option>
                                </select>
                              </label>
                              <label class="field">
                                ${renderFieldLabel("Alert account ID")}
                                <input
                                  .value=${props.form.failureAlertAccountId}
                                  @input=${(e: Event) =>
                                    props.onFormChange({
                                      failureAlertAccountId: (e.target as HTMLInputElement).value,
                                    })}
                                  placeholder="Account ID for multi-account setups"
                                />
                              </label>
                            `
                          : nothing
                      }
                    `
                  : nothing
              }
              ${
                selectedDeliveryMode !== "none"
                  ? html`
                      <label class="field checkbox cron-checkbox cron-span-2">
                        <input
                          type="checkbox"
                          .checked=${props.form.deliveryBestEffort}
                          @change=${(e: Event) =>
                            props.onFormChange({
                              deliveryBestEffort: (e.target as HTMLInputElement).checked,
                            })}
                        />
                        <span class="field-checkbox__label">${t("cron.form.bestEffortDelivery")}</span>
                        <div class="cron-help">${t("cron.form.bestEffortHelp")}</div>
                      </label>
                    `
                  : nothing
              }
            </div>
          </details>
        </div>
        ${
          blockedByValidation
            ? html`
                <div class="cron-form-status" role="status" aria-live="polite">
                  <div class="cron-form-status__title">${t("cron.form.cantAddYet")}</div>
                  <div class="cron-help">${t("cron.form.fillRequired")}</div>
                  <ul class="cron-form-status__list">
                    ${blockingFields.map(
                      (field) => html`
                        <li>
                          <button
                            type="button"
                            class="cron-form-status__link"
                            @click=${() => focusFormField(field.inputId)}
                          >
                            ${field.label}: ${t(field.message)}
                          </button>
                        </li>
                      `,
                    )}
                  </ul>
                </div>
              `
            : nothing
        }
        <div class="row cron-form-actions">
          <button class="btn primary" ?disabled=${props.busy || !props.canSubmit} @click=${props.onAdd}>
            ${props.busy ? t("cron.form.saving") : isEditing ? t("cron.form.saveChanges") : t("cron.form.addJob")}
          </button>
          ${
            submitDisabledReason
              ? html`<div class="cron-submit-reason" aria-live="polite">${submitDisabledReason}</div>`
              : nothing
          }
          ${
            isEditing
              ? html`
                  <button class="btn" ?disabled=${props.busy} @click=${props.onCancelEdit}>
                    ${t("cron.form.cancel")}
                  </button>
                `
              : nothing
          }
        </div>
      </section>
    </section>

    ${renderSuggestionList("cron-agent-suggestions", props.agentSuggestions)}
    ${renderSuggestionList("cron-model-suggestions", props.modelSuggestions)}
    ${renderSuggestionList("cron-thinking-suggestions", props.thinkingSuggestions)}
    ${renderSuggestionList("cron-tz-suggestions", props.timezoneSuggestions)}
    ${renderSuggestionList("cron-delivery-to-suggestions", props.deliveryToSuggestions)}
    ${renderSuggestionList("cron-delivery-account-suggestions", props.accountSuggestions)}
  `;
}

function renderScheduleFields(props: CronProps) {
  const form = props.form;
  if (form.scheduleKind === "at") {
    return html`
      <label class="field cron-span-2" style="margin-top: 12px;">
        ${renderFieldLabel(t("cron.form.runAt"), true)}
        <input
          id="cron-schedule-at"
          type="datetime-local"
          .value=${form.scheduleAt}
          aria-invalid=${props.fieldErrors.scheduleAt ? "true" : "false"}
          aria-describedby=${ifDefined(
            props.fieldErrors.scheduleAt ? errorIdForField("scheduleAt") : undefined,
          )}
          @input=${(e: Event) =>
            props.onFormChange({
              scheduleAt: (e.target as HTMLInputElement).value,
            })}
        />
        ${renderFieldError(props.fieldErrors.scheduleAt, errorIdForField("scheduleAt"))}
      </label>
    `;
  }
  if (form.scheduleKind === "every") {
    return html`
      <div class="form-grid cron-form-grid" style="margin-top: 12px;">
        <label class="field">
          ${renderFieldLabel(t("cron.form.every"), true)}
          <input
            id="cron-every-amount"
            .value=${form.everyAmount}
            aria-invalid=${props.fieldErrors.everyAmount ? "true" : "false"}
            aria-describedby=${ifDefined(
              props.fieldErrors.everyAmount ? errorIdForField("everyAmount") : undefined,
            )}
            @input=${(e: Event) =>
              props.onFormChange({
                everyAmount: (e.target as HTMLInputElement).value,
              })}
            placeholder=${t("cron.form.everyAmountPlaceholder")}
          />
          ${renderFieldError(props.fieldErrors.everyAmount, errorIdForField("everyAmount"))}
        </label>
        <label class="field">
          <span>${t("cron.form.unit")}</span>
          <select
            .value=${form.everyUnit}
            @change=${(e: Event) =>
              props.onFormChange({
                everyUnit: (e.target as HTMLSelectElement).value as CronFormState["everyUnit"],
              })}
          >
            <option value="minutes">${t("cron.form.minutes")}</option>
            <option value="hours">${t("cron.form.hours")}</option>
            <option value="days">${t("cron.form.days")}</option>
          </select>
        </label>
      </div>
    `;
  }
  return html`
    <div class="form-grid cron-form-grid" style="margin-top: 12px;">
      <label class="field">
        ${renderFieldLabel(t("cron.form.expression"), true)}
        <input
          id="cron-cron-expr"
          .value=${form.cronExpr}
          aria-invalid=${props.fieldErrors.cronExpr ? "true" : "false"}
          aria-describedby=${ifDefined(
            props.fieldErrors.cronExpr ? errorIdForField("cronExpr") : undefined,
          )}
          @input=${(e: Event) =>
            props.onFormChange({ cronExpr: (e.target as HTMLInputElement).value })}
          placeholder=${t("cron.form.expressionPlaceholder")}
        />
        ${renderFieldError(props.fieldErrors.cronExpr, errorIdForField("cronExpr"))}
      </label>
      <label class="field">
        <span>${t("cron.form.timezoneOptional")}</span>
        <input
          .value=${form.cronTz}
          list="cron-tz-suggestions"
          @input=${(e: Event) =>
            props.onFormChange({ cronTz: (e.target as HTMLInputElement).value })}
          placeholder=${t("cron.form.timezonePlaceholder")}
        />
        <div class="cron-help">${t("cron.form.timezoneHelp")}</div>
      </label>
      <div class="cron-help cron-span-2">${t("cron.form.jitterHelp")}</div>
    </div>
  `;
}

function renderFieldError(message?: string, id?: string) {
  if (!message) {
    return nothing;
  }
  return html`<div id=${ifDefined(id)} class="cron-help cron-error">${t(message)}</div>`;
}

function renderJob(job: CronJob, props: CronProps) {
  const isSelected = props.runsJobId === job.id;
  const itemClass = `list-item list-item-clickable cron-job${isSelected ? " list-item-selected" : ""}`;
  const selectAnd = (action: () => void) => {
    props.onLoadRuns(job.id);
    action();
  };
  return html`
    <div class=${itemClass} @click=${() => props.onLoadRuns(job.id)}>
      <div class="list-main">
        <div class="list-title">${job.name}</div>
        <div class="list-sub">${formatCronSchedule(job)}</div>
        ${renderJobPayload(job)}
        ${job.agentId ? html`<div class="muted cron-job-agent">${t("cron.jobDetail.agent")}: ${job.agentId}</div>` : nothing}
      </div>
      <div class="list-meta">
        ${renderJobState(job)}
      </div>
      <div class="cron-job-footer">
        <div class="chip-row cron-job-chips">
          <span class=${`chip ${job.enabled ? "chip-ok" : "chip-danger"}`}>
            ${job.enabled ? t("cron.jobList.enabled") : t("cron.jobList.disabled")}
          </span>
          <span class="chip">${job.sessionTarget}</span>
          <span class="chip">${job.wakeMode}</span>
        </div>
        <div class="row cron-job-actions">
          <button
            class="btn"
            ?disabled=${props.busy}
            @click=${(event: Event) => {
              event.stopPropagation();
              selectAnd(() => props.onEdit(job));
            }}
          >
            ${t("cron.jobList.edit")}
          </button>
          <button
            class="btn"
            ?disabled=${props.busy}
            @click=${(event: Event) => {
              event.stopPropagation();
              selectAnd(() => props.onClone(job));
            }}
          >
            ${t("cron.jobList.clone")}
          </button>
          <button
            class="btn"
            ?disabled=${props.busy}
            @click=${(event: Event) => {
              event.stopPropagation();
              selectAnd(() => props.onToggle(job, !job.enabled));
            }}
          >
            ${job.enabled ? t("cron.jobList.disable") : t("cron.jobList.enable")}
          </button>
          <button
            class="btn"
            ?disabled=${props.busy}
            @click=${(event: Event) => {
              event.stopPropagation();
              selectAnd(() => props.onRun(job, "force"));
            }}
          >
            ${t("cron.jobList.run")}
          </button>
          <button
            class="btn"
            ?disabled=${props.busy}
            @click=${(event: Event) => {
              event.stopPropagation();
              selectAnd(() => props.onRun(job, "due"));
            }}
          >
            Run if due
          </button>
          <button
            class="btn"
            ?disabled=${props.busy}
            @click=${(event: Event) => {
              event.stopPropagation();
              props.onLoadRuns(job.id);
            }}
          >
            ${t("cron.jobList.history")}
          </button>
          <button
            class="btn danger"
            ?disabled=${props.busy}
            @click=${(event: Event) => {
              event.stopPropagation();
              selectAnd(() => props.onRemove(job));
            }}
          >
            ${t("cron.jobList.remove")}
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderJobPayload(job: CronJob) {
  if (job.payload.kind === "systemEvent") {
    return html`<div class="cron-job-detail">
      <span class="cron-job-detail-label">${t("cron.jobDetail.system")}</span>
      <span class="muted cron-job-detail-value">${job.payload.text}</span>
    </div>`;
  }

  const delivery = job.delivery;
  const deliveryTarget =
    delivery?.mode === "webhook"
      ? delivery.to
        ? ` (${delivery.to})`
        : ""
      : delivery?.channel || delivery?.to
        ? ` (${delivery.channel ?? "last"}${delivery.to ? ` -> ${delivery.to}` : ""})`
        : "";

  return html`
    <div class="cron-job-detail">
      <span class="cron-job-detail-label">${t("cron.jobDetail.prompt")}</span>
      <span class="muted cron-job-detail-value">${job.payload.message}</span>
    </div>
    ${
      delivery
        ? html`<div class="cron-job-detail">
            <span class="cron-job-detail-label">${t("cron.jobDetail.delivery")}</span>
            <span class="muted cron-job-detail-value">${delivery.mode}${deliveryTarget}</span>
          </div>`
        : nothing
    }
  `;
}

function formatStateRelative(ms?: number) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) {
    return t("common.na");
  }
  return formatRelativeTimestamp(ms);
}

function formatRunNextLabel(nextRunAtMs: number, nowMs = Date.now()) {
  const rel = formatRelativeTimestamp(nextRunAtMs);
  return nextRunAtMs > nowMs ? t("cron.runEntry.next", { rel }) : t("cron.runEntry.due", { rel });
}

function renderJobState(job: CronJob) {
  const rawStatus = job.state?.lastStatus;
  const deliveryStatus = job.state?.lastDeliveryStatus;
  const deliveryError = job.state?.lastDeliveryError;
  const statusClass =
    rawStatus === "ok"
      ? "cron-job-status-ok"
      : rawStatus === "error"
        ? "cron-job-status-error"
        : rawStatus === "skipped"
          ? "cron-job-status-skipped"
          : "cron-job-status-na";
  const statusLabel =
    rawStatus === "ok"
      ? t("cron.runs.runStatusOk")
      : rawStatus === "error"
        ? t("cron.runs.runStatusError")
        : rawStatus === "skipped"
          ? t("cron.runs.runStatusSkipped")
          : t("common.na");
  const nextRunAtMs = job.state?.nextRunAtMs;
  const lastRunAtMs = job.state?.lastRunAtMs;

  return html`
    <div class="cron-job-state">
      <div class="cron-job-state-row">
        <span class="cron-job-state-key">${t("cron.jobState.status")}</span>
        <span class=${`cron-job-status-pill ${statusClass}`}>${statusLabel}</span>
      </div>
      <div class="cron-job-state-row">
        <span class="cron-job-state-key">${t("cron.jobState.next")}</span>
        <span class="cron-job-state-value" title=${formatMs(nextRunAtMs)}>
          ${formatStateRelative(nextRunAtMs)}
        </span>
      </div>
      <div class="cron-job-state-row">
        <span class="cron-job-state-key">${t("cron.jobState.last")}</span>
        <span class="cron-job-state-value" title=${formatMs(lastRunAtMs)}>
          ${formatStateRelative(lastRunAtMs)}
        </span>
      </div>
      ${
        deliveryStatus
          ? html`<div class="cron-job-state-row">
              <span class="cron-job-state-key">${t("cron.jobDetail.delivery")}</span>
              <span class="cron-job-state-value">${runDeliveryLabel(deliveryStatus)}</span>
            </div>`
          : nothing
      }
      ${
        deliveryError
          ? html`<div class="cron-job-state-row">
              <span class="cron-job-state-key">Delivery issue</span>
              <span class="cron-job-state-value">${deliveryError}</span>
            </div>`
          : nothing
      }
    </div>
  `;
}

function runStatusLabel(value: string): string {
  switch (value) {
    case "ok":
      return t("cron.runs.runStatusOk");
    case "error":
      return t("cron.runs.runStatusError");
    case "skipped":
      return t("cron.runs.runStatusSkipped");
    default:
      return t("cron.runs.runStatusUnknown");
  }
}

function runDeliveryLabel(value: string): string {
  switch (value) {
    case "delivered":
      return t("cron.runs.deliveryDelivered");
    case "not-delivered":
      return t("cron.runs.deliveryNotDelivered");
    case "not-requested":
      return t("cron.runs.deliveryNotRequested");
    case "unknown":
      return t("cron.runs.deliveryUnknown");
    default:
      return t("cron.runs.deliveryUnknown");
  }
}

function renderRun(
  entry: CronRunLogEntry,
  basePath: string,
  job: CronJob | undefined,
  matchingApprovals: CronProps["execApprovalQueue"],
  onRetryRun: (jobId: string) => void,
) {
  const chatUrl =
    typeof entry.sessionKey === "string" && entry.sessionKey.trim().length > 0
      ? `${pathForTab("chat", basePath)}?session=${encodeURIComponent(entry.sessionKey)}`
      : null;
  const status = runStatusLabel(entry.status ?? "unknown");
  const delivery = runDeliveryLabel(entry.deliveryStatus ?? "not-requested");
  const usage = entry.usage;
  const usageSummary =
    usage && typeof usage.total_tokens === "number"
      ? `${usage.total_tokens} tokens`
      : usage && typeof usage.input_tokens === "number" && typeof usage.output_tokens === "number"
        ? `${usage.input_tokens} in / ${usage.output_tokens} out`
        : null;
  const traceSteps = buildRunTraceSteps({ entry, job, matchingApprovals });
  const showRetry = entry.retryable ?? (entry.status === "error" || entry.status === "skipped");
  const showReplay = (entry.replayable ?? Boolean(chatUrl)) && Boolean(chatUrl);
  return html`
    <div class="list-item cron-run-entry">
      <div class="list-main cron-run-entry__main">
        <div class="list-title cron-run-entry__title">
          ${entry.jobName ?? entry.jobId}
          <span class="muted"> · ${status}</span>
        </div>
        <div class="list-sub cron-run-entry__summary">${entry.summary ?? entry.error ?? t("cron.runEntry.noSummary")}</div>
        <div class="chip-row" style="margin-top: 6px;">
          <span class="chip">${delivery}</span>
          ${entry.failureStage ? html`<span class="chip chip-danger">${failureStageLabel(entry.failureStage)}</span>` : nothing}
          ${entry.model ? html`<span class="chip">${entry.model}</span>` : nothing}
          ${entry.provider ? html`<span class="chip">${entry.provider}</span>` : nothing}
          ${usageSummary ? html`<span class="chip">${usageSummary}</span>` : nothing}
        </div>
      </div>
      <div class="list-meta cron-run-entry__meta">
        <div>${formatMs(entry.ts)}</div>
        ${typeof entry.runAtMs === "number" ? html`<div class="muted">${t("cron.runEntry.runAt")} ${formatMs(entry.runAtMs)}</div>` : nothing}
        <div class="muted">${entry.durationMs ?? 0}ms</div>
        ${
          typeof entry.nextRunAtMs === "number"
            ? html`<div class="muted">${formatRunNextLabel(entry.nextRunAtMs)}</div>`
            : nothing
        }
        ${
          chatUrl
            ? html`<div><a class="session-link" href=${chatUrl}>${t("cron.runEntry.openRunChat")}</a></div>`
            : nothing
        }
        ${entry.error ? html`<div class="muted">${entry.error}</div>` : nothing}
        ${entry.deliveryError ? html`<div class="muted">${entry.deliveryError}</div>` : nothing}
      </div>
      <div style="flex-basis:100%; margin-top:10px;">
        <details>
          <summary style="cursor:pointer;">Trace and recovery</summary>
          ${renderTraceSteps(traceSteps)}
          <div class="row" style="margin-top:10px; gap:8px; flex-wrap:wrap;">
            ${
              showRetry
                ? html`
                    <button class="btn btn--sm" type="button" @click=${() => onRetryRun(entry.jobId)}>
                      Retry now
                    </button>
                  `
                : nothing
            }
            ${
              showReplay ? html`<a class="btn btn--sm" href=${chatUrl}>Replay in chat</a>` : nothing
            }
          </div>
        </details>
      </div>
    </div>
  `;
}
