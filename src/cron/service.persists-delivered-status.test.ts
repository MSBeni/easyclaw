import { describe, expect, it, vi } from "vitest";
import { CronService } from "./service.js";
import {
  createStartedCronServiceWithFinishedBarrier,
  createCronStoreHarness,
  createNoopLogger,
  installCronTestHooks,
} from "./service.test-harness.js";

const noopLogger = createNoopLogger();
const { makeStorePath } = createCronStoreHarness();
installCronTestHooks({ logger: noopLogger });

type CronAddInput = Parameters<CronService["add"]>[0];

function buildIsolatedAgentTurnJob(name: string): CronAddInput {
  return {
    name,
    enabled: true,
    schedule: { kind: "every", everyMs: 60_000 },
    sessionTarget: "isolated",
    wakeMode: "next-heartbeat",
    payload: { kind: "agentTurn", message: "test" },
    delivery: { mode: "none" },
  };
}

function buildMainSessionSystemEventJob(name: string): CronAddInput {
  return {
    name,
    enabled: true,
    schedule: { kind: "every", everyMs: 60_000 },
    sessionTarget: "main",
    wakeMode: "next-heartbeat",
    payload: { kind: "systemEvent", text: "tick" },
  };
}

function createFinishedBarrierAny() {
  const resolvers = new Map<string, (evt: { jobId: string; status?: string }) => void>();
  return {
    waitForFinished: (jobId: string) =>
      new Promise<{ jobId: string; status?: string }>((resolve) => {
        resolvers.set(jobId, resolve);
      }),
    onEvent: (evt: { jobId: string; action: string; status?: string }) => {
      if (evt.action !== "finished") {
        return;
      }
      const resolve = resolvers.get(evt.jobId);
      if (!resolve) {
        return;
      }
      resolvers.delete(evt.jobId);
      resolve(evt);
    },
  };
}

function createIsolatedCronWithFinishedBarrier(params: {
  storePath: string;
  delivered?: boolean;
  result?: Partial<{
    status: "ok" | "error" | "skipped";
    summary: string;
    error: string;
    errorKind: "delivery-target";
    deliveryError: string;
    delivered: boolean;
    sessionKey: string;
  }>;
  onFinished?: (evt: {
    jobId: string;
    delivered?: boolean;
    deliveryStatus?: string;
    failureStage?: string;
    deadLetter?: boolean;
    retryable?: boolean;
    replayable?: boolean;
    trace?: Array<{ key: string; status: string; detail: string }>;
  }) => void;
}) {
  const finished = createFinishedBarrierAny();
  const cron = new CronService({
    storePath: params.storePath,
    cronEnabled: true,
    log: noopLogger,
    enqueueSystemEvent: vi.fn(),
    requestHeartbeatNow: vi.fn(),
    runIsolatedAgentJob: vi.fn(async () => ({
      status: "ok" as const,
      summary: "done",
      ...(params.delivered === undefined ? {} : { delivered: params.delivered }),
      ...params.result,
    })),
    onEvent: (evt) => {
      if (evt.action === "finished") {
        params.onFinished?.({
          jobId: evt.jobId,
          delivered: evt.delivered,
          deliveryStatus: evt.deliveryStatus,
          failureStage: evt.failureStage,
          deadLetter: evt.deadLetter,
          retryable: evt.retryable,
          replayable: evt.replayable,
          trace: evt.trace?.map((step) => ({
            key: step.key,
            status: step.status,
            detail: step.detail,
          })),
        });
      }
      finished.onEvent(evt);
    },
  });
  return { cron, finished };
}

async function runSingleJobAndReadState(params: {
  cron: CronService;
  finished:
    | ReturnType<typeof createFinishedBarrierAny>
    | {
        waitForOk: (jobId: string) => Promise<unknown>;
      };
  job: CronAddInput;
}) {
  const job = await params.cron.add(params.job);
  vi.setSystemTime(new Date(job.state.nextRunAtMs! + 5));
  await vi.runOnlyPendingTimersAsync();
  if ("waitForFinished" in params.finished) {
    await params.finished.waitForFinished(job.id);
  } else {
    await params.finished.waitForOk(job.id);
  }

  const jobs = await params.cron.list({ includeDisabled: true });
  return { job, updated: jobs.find((entry) => entry.id === job.id) };
}

function expectSuccessfulCronRun(
  updated:
    | {
        state: {
          lastStatus?: string;
          lastRunStatus?: string;
          [key: string]: unknown;
        };
      }
    | undefined,
) {
  expect(updated?.state.lastStatus).toBe("ok");
  expect(updated?.state.lastRunStatus).toBe("ok");
}

function expectDeliveryNotRequested(
  updated:
    | {
        state: {
          lastDelivered?: boolean;
          lastDeliveryStatus?: string;
          lastDeliveryError?: string;
        };
      }
    | undefined,
) {
  expectSuccessfulCronRun(updated);
  expect(updated?.state.lastDelivered).toBeUndefined();
  expect(updated?.state.lastDeliveryStatus).toBe("not-requested");
  expect(updated?.state.lastDeliveryError).toBeUndefined();
}

async function runIsolatedJobAndReadState(params: {
  job: CronAddInput;
  delivered?: boolean;
  result?: Partial<{
    status: "ok" | "error" | "skipped";
    summary: string;
    error: string;
    errorKind: "delivery-target";
    deliveryError: string;
    delivered: boolean;
    sessionKey: string;
  }>;
  onFinished?: (evt: {
    jobId: string;
    delivered?: boolean;
    deliveryStatus?: string;
    failureStage?: string;
    deadLetter?: boolean;
    retryable?: boolean;
    replayable?: boolean;
    trace?: Array<{ key: string; status: string; detail: string }>;
  }) => void;
}) {
  const store = await makeStorePath();
  const { cron, finished } = createIsolatedCronWithFinishedBarrier({
    storePath: store.storePath,
    ...(params.delivered !== undefined ? { delivered: params.delivered } : {}),
    ...(params.result ? { result: params.result } : {}),
    ...(params.onFinished ? { onFinished: params.onFinished } : {}),
  });

  await cron.start();
  try {
    const { updated } = await runSingleJobAndReadState({
      cron,
      finished,
      job: params.job,
    });
    return updated;
  } finally {
    cron.stop();
  }
}

describe("CronService persists delivered status", () => {
  it("persists lastDelivered=true when isolated job reports delivered", async () => {
    const updated = await runIsolatedJobAndReadState({
      job: buildIsolatedAgentTurnJob("delivered-true"),
      delivered: true,
    });
    expectSuccessfulCronRun(updated);
    expect(updated?.state.lastDelivered).toBe(true);
    expect(updated?.state.lastDeliveryStatus).toBe("delivered");
    expect(updated?.state.lastDeliveryError).toBeUndefined();
  });

  it("persists lastDelivered=false when isolated job explicitly reports not delivered", async () => {
    const updated = await runIsolatedJobAndReadState({
      job: buildIsolatedAgentTurnJob("delivered-false"),
      delivered: false,
    });
    expectSuccessfulCronRun(updated);
    expect(updated?.state.lastDelivered).toBe(false);
    expect(updated?.state.lastDeliveryStatus).toBe("not-delivered");
    expect(updated?.state.lastDeliveryError).toBeUndefined();
  });

  it("persists not-requested delivery state when delivery is not configured", async () => {
    const updated = await runIsolatedJobAndReadState({
      job: buildIsolatedAgentTurnJob("no-delivery"),
    });
    expectDeliveryNotRequested(updated);
  });

  it("persists unknown delivery state when delivery is requested but the runner omits delivered", async () => {
    const updated = await runIsolatedJobAndReadState({
      job: {
        ...buildIsolatedAgentTurnJob("delivery-unknown"),
        delivery: { mode: "announce", channel: "telegram", to: "123" },
      },
    });
    expectSuccessfulCronRun(updated);
    expect(updated?.state.lastDelivered).toBeUndefined();
    expect(updated?.state.lastDeliveryStatus).toBe("unknown");
    expect(updated?.state.lastDeliveryError).toBeUndefined();
  });

  it("does not set lastDelivered for main session jobs", async () => {
    const store = await makeStorePath();
    const { cron, enqueueSystemEvent, finished } = createStartedCronServiceWithFinishedBarrier({
      storePath: store.storePath,
      logger: noopLogger,
    });

    await cron.start();
    const { updated } = await runSingleJobAndReadState({
      cron,
      finished,
      job: buildMainSessionSystemEventJob("main-session"),
    });

    expectDeliveryNotRequested(updated);
    expect(enqueueSystemEvent).toHaveBeenCalled();

    cron.stop();
  });

  it("emits delivered in the finished event", async () => {
    let capturedEvent:
      | {
          jobId: string;
          delivered?: boolean;
          deliveryStatus?: string;
        }
      | undefined;
    await runIsolatedJobAndReadState({
      job: buildIsolatedAgentTurnJob("event-test"),
      delivered: true,
      onFinished: (evt) => {
        capturedEvent = evt;
      },
    });

    expect(capturedEvent).toBeDefined();
    expect(capturedEvent?.delivered).toBe(true);
    expect(capturedEvent?.deliveryStatus).toBe("delivered");
  });

  it("emits trace and dead-letter metadata for delivery failures", async () => {
    let capturedEvent:
      | {
          failureStage?: string;
          deadLetter?: boolean;
          retryable?: boolean;
          replayable?: boolean;
          trace?: Array<{ key: string; status: string; detail: string }>;
        }
      | undefined;

    await runIsolatedJobAndReadState({
      job: {
        ...buildIsolatedAgentTurnJob("event-trace"),
        delivery: { mode: "announce", channel: "telegram", to: "ops-room" },
      },
      result: {
        status: "error",
        error: "telegram target rejected",
        errorKind: "delivery-target",
        deliveryError: "403 from telegram",
        delivered: false,
        sessionKey: "agent:ops:cron:event-trace",
      },
      onFinished: (evt) => {
        capturedEvent = evt;
      },
    });

    expect(capturedEvent?.failureStage).toBe("delivery");
    expect(capturedEvent?.deadLetter).toBe(true);
    expect(capturedEvent?.retryable).toBe(true);
    expect(capturedEvent?.replayable).toBe(true);
    expect(capturedEvent?.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "runtime", status: "ok" }),
        expect.objectContaining({ key: "delivery", status: "error" }),
      ]),
    );
  });
});
