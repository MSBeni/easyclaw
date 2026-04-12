import type {
  CronDeliveryStatus,
  CronFailureStage,
  CronJob,
  CronRunOutcome,
  CronRunReview,
  CronRunTelemetry,
  CronTraceStep,
  CronTraceStepStatus,
} from "./types.js";

type CronFinishedResult = CronRunOutcome &
  CronRunTelemetry & {
    deliveryError?: string;
    delivered?: boolean;
  };

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

function describeDeliveryStatus(deliveryStatus?: CronDeliveryStatus) {
  switch (deliveryStatus) {
    case "delivered":
      return "Delivery confirmed.";
    case "not-delivered":
      return "Delivery failed.";
    case "unknown":
      return "Delivery status is still unknown.";
    case "not-requested":
      return "No delivery step was requested.";
    default:
      return undefined;
  }
}

function resolveRuntimeStatus(status: CronRunOutcome["status"]): CronTraceStepStatus {
  if (status === "ok") {
    return "ok";
  }
  if (status === "error") {
    return "error";
  }
  return "skipped";
}

function resolveDeliveryStatus(deliveryStatus?: CronDeliveryStatus): CronTraceStepStatus {
  switch (deliveryStatus) {
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

function isApprovalPendingError(error?: string): boolean {
  const text = error?.trim().toLowerCase() ?? "";
  if (!text) {
    return false;
  }
  return (
    text.includes("approval") &&
    (text.includes("exec") ||
      text.includes("approve") ||
      text.includes("required") ||
      text.includes("pending") ||
      text.includes("wait"))
  );
}

function resolveFailureStage(params: {
  result: CronFinishedResult;
  deliveryStatus?: CronDeliveryStatus;
}): CronFailureStage | undefined {
  if (params.result.status === "error") {
    if (isApprovalPendingError(params.result.error)) {
      return "approvals";
    }
    if (
      params.result.errorKind === "delivery-target" ||
      params.deliveryStatus === "not-delivered" ||
      typeof params.result.deliveryError === "string"
    ) {
      return "delivery";
    }
    return "runtime";
  }
  if (params.result.status === "skipped") {
    const error = params.result.error?.trim().toLowerCase() ?? "";
    if (error.includes("not due")) {
      return "schedule";
    }
    if (isApprovalPendingError(params.result.error)) {
      return "approvals";
    }
    if (error) {
      return "runtime";
    }
  }
  return undefined;
}

export function buildCronRunReview(params: {
  job: CronJob;
  result: CronFinishedResult;
  runAtMs: number;
}): CronRunReview & {
  trace: CronTraceStep[];
  deadLetter: boolean;
  retryable: boolean;
  replayable: boolean;
} {
  const { job, result, runAtMs } = params;
  const deliveryStatus = job.state.lastDeliveryStatus;
  const failureStage = resolveFailureStage({ result, deliveryStatus });
  const deliveryConfigured = Boolean(job.delivery && job.delivery.mode !== "none");

  const scheduleStep: CronTraceStep =
    failureStage === "schedule"
      ? {
          key: "schedule",
          label: "Schedule",
          status: "skipped",
          detail: result.error ?? "The scheduler skipped this run.",
        }
      : {
          key: "schedule",
          label: "Schedule",
          status: "ok",
          detail: `Triggered at ${new Date(runAtMs).toISOString()}`,
        };

  const runtimeStep: CronTraceStep =
    failureStage === "schedule"
      ? {
          key: "runtime",
          label: "Runtime",
          status: "skipped",
          detail: "Execution never started because the scheduler skipped this run.",
        }
      : failureStage === "delivery"
        ? {
            key: "runtime",
            label: "Runtime",
            status: "ok",
            detail:
              result.summary ??
              `${describeJobRuntime(job)}${job.agentId ? ` · agent ${job.agentId}` : ""}`,
          }
        : failureStage === "approvals"
          ? {
              key: "runtime",
              label: "Runtime",
              status: "pending",
              detail:
                result.error ??
                `${describeJobRuntime(job)}${job.agentId ? ` · agent ${job.agentId}` : ""}`,
            }
          : {
              key: "runtime",
              label: "Runtime",
              status: resolveRuntimeStatus(result.status),
              detail:
                result.error ??
                result.summary ??
                `${describeJobRuntime(job)}${job.agentId ? ` · agent ${job.agentId}` : ""}`,
            };

  const deliveryStep: CronTraceStep = !deliveryConfigured
    ? {
        key: "delivery",
        label: "Delivery",
        status: "skipped",
        detail: "No delivery step configured.",
      }
    : failureStage === "schedule" || failureStage === "runtime" || failureStage === "approvals"
      ? {
          key: "delivery",
          label: "Delivery",
          status: "skipped",
          detail: "Delivery did not run because the workflow stopped earlier.",
        }
      : {
          key: "delivery",
          label: "Delivery",
          status:
            failureStage === "delivery" && result.status !== "ok"
              ? "error"
              : resolveDeliveryStatus(deliveryStatus),
          detail:
            job.state.lastDeliveryError ??
            result.deliveryError ??
            describeDeliveryStatus(deliveryStatus) ??
            describeDeliveryTarget(job),
        };

  const approvalsStep: CronTraceStep =
    failureStage === "approvals"
      ? {
          key: "approvals",
          label: "Approvals",
          status: "pending",
          detail: result.error ?? "Exec approval is still required before this run can continue.",
        }
      : {
          key: "approvals",
          label: "Approvals",
          status: "skipped",
          detail: "No exec approval wait was captured for this run.",
        };

  return {
    trace: [scheduleStep, runtimeStep, deliveryStep, approvalsStep],
    failureStage,
    deadLetter: result.status === "error",
    retryable: result.status !== "ok",
    replayable: Boolean(result.sessionKey?.trim()),
  };
}
