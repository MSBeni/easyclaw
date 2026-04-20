import { describe, expect, it, vi } from "vitest";
import "../styles.css";
import type { OpenClawApp } from "./app.ts";
import type { BuilderPlanResult, BuilderVerifyResult } from "./controllers/builder.ts";
import { mountApp, registerAppMountHooks } from "./test-helpers/app-mount.ts";

registerAppMountHooks();

type BrowserSetupAction = NonNullable<
  BuilderPlanResult["draft"]["buildSpec"]["setupActions"][number]
>;
type BrowserSetupTask = NonNullable<BuilderPlanResult["draft"]["planning"]["setupTasks"][number]>;

function nextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function settle(app: OpenClawApp, frames = 2) {
  for (let index = 0; index < frames; index += 1) {
    await Promise.resolve();
    await app.updateComplete;
    await nextFrame();
  }
  await Promise.resolve();
  await app.updateComplete;
}

async function waitForElement<T extends Element>(
  app: OpenClawApp,
  selector: string,
  params?: { frames?: number },
): Promise<T | null> {
  const frames = Math.max(params?.frames ?? 10, 24);
  for (let index = 0; index < frames; index += 1) {
    const element = app.querySelector<T>(selector);
    if (element) {
      return element;
    }
    await settle(app, 1);
  }
  return app.querySelector<T>(selector);
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function findButtonByText(
  app: OpenClawApp,
  text: string,
  params?: { exact?: boolean },
): HTMLButtonElement | null {
  return findButtonsByText(app, text, params)[0] ?? null;
}

function findButtonsByText(
  app: OpenClawApp,
  text: string,
  params?: { exact?: boolean },
): HTMLButtonElement[] {
  const expected = normalizeText(text);
  return Array.from(app.querySelectorAll<HTMLButtonElement>("button")).filter((button) => {
    const actual = normalizeText(button.textContent);
    return params?.exact ? actual === expected : actual.includes(expected);
  });
}

function clickButton(app: OpenClawApp, text: string, params?: { exact?: boolean; index?: number }) {
  const buttons = findButtonsByText(app, text, params);
  const index = params?.index ?? 0;
  const button = buttons[index] ?? null;
  expect(button).not.toBeNull();
  button?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  return button;
}

function clickFirstMatchingButton(
  app: OpenClawApp,
  predicate: (button: HTMLButtonElement) => boolean,
) {
  const button =
    Array.from(app.querySelectorAll<HTMLButtonElement>("button")).find((candidate) =>
      predicate(candidate),
    ) ?? null;
  expect(button).not.toBeNull();
  button?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  return button;
}

function clickButtonInSetupCard(app: OpenClawApp, text: string, params?: { exact?: boolean }) {
  return clickFirstMatchingButton(app, (button) => {
    const actual = normalizeText(button.textContent);
    const expected = normalizeText(text);
    const matches = params?.exact ? actual === expected : actual.includes(expected);
    if (!matches) {
      return false;
    }
    return button.closest(".quick-setup") !== null;
  });
}

function expectApplyBlocked(app: OpenClawApp) {
  const applyButton = findButtonByText(app, "Apply Builder Plan", { exact: true });
  if (applyButton) {
    expect(applyButton.disabled).toBe(true);
    return;
  }
  expect(app.tab).toBe("onboarding");
}

function changeValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) {
  element.value = value;
  element.dispatchEvent(
    new Event(element instanceof HTMLSelectElement ? "change" : "input", {
      bubbles: true,
      cancelable: true,
      composed: true,
    }),
  );
}

function findFieldByLabel<T extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
  app: OpenClawApp,
  text: string,
): T | null {
  const expected = normalizeText(text).toLowerCase();
  const labels = Array.from(app.querySelectorAll<HTMLLabelElement>("label"));
  for (const label of labels) {
    const labelText = normalizeText(
      label.querySelector(".quick-setup__field-label")?.textContent ?? label.textContent,
    ).toLowerCase();
    if (!labelText.includes(expected)) {
      continue;
    }
    const field = label.querySelector<T>("input, textarea, select");
    if (field) {
      return field;
    }
  }
  return null;
}

function setLabeledFieldValues(app: OpenClawApp, values: Record<string, string>): boolean {
  for (const [label, value] of Object.entries(values)) {
    const field = findFieldByLabel<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      app,
      label,
    );
    expect(field).not.toBeNull();
    if (!field) {
      return false;
    }
    changeValue(field, value);
  }
  return true;
}

function attachMockClient(app: OpenClawApp, request: ReturnType<typeof vi.fn>) {
  const withFallbacks = async (method: string, params: unknown) => {
    try {
      return await request(method, params);
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error);
      if (!message.includes("Unhandled")) {
        throw error;
      }
      if (method === "config.schema") {
        return {
          version: "test-schema",
          schema: {
            type: "object",
            properties: {},
          },
        };
      }
      if (method === "config.get") {
        return createConfigSnapshot({});
      }
      if (method === "channels.status") {
        return {
          ts: Date.now(),
          channelOrder: [],
          channelLabels: {},
          channels: {},
          channelAccounts: {},
          channelDefaultAccountId: {},
        };
      }
      throw error;
    }
  };
  app.client = {
    request: withFallbacks,
    stop: vi.fn(),
  } as unknown as OpenClawApp["client"];
}

function nextConfigStateFromSetParams(params: unknown): Record<string, unknown> {
  const record =
    params && typeof params === "object" && !Array.isArray(params)
      ? (params as Record<string, unknown>)
      : {};
  const raw = typeof record.raw === "string" ? record.raw : "{}";
  return JSON.parse(raw) as Record<string, unknown>;
}

async function exerciseRetryableGuidedVerificationFlow(params: {
  planFactory: (setupComplete: boolean) => BuilderPlanResult;
  brief: string;
  initialConfigState: Record<string, unknown>;
  openSetupLabel: string;
  openSetupIndex?: number;
  verifyButtonLabel: string;
  retryButtonLabel?: string;
  actionId: string;
  connectorId: string;
  initialFields: Record<string, string>;
  repairedFields: Record<string, string>;
  expectedVisibleText?: string;
  failureMessage: string;
  failureResumeLabel: string;
  failureResumeDetail: string;
  failureSummary?: Record<string, unknown>;
  successMessage: string;
  successUpdatedRefs: string[];
  successSummary?: Record<string, unknown>;
  fingerprint: string;
}) {
  const app = mountApp("/builder");
  await settle(app, 3);

  let setupAttempts = 0;
  let verifyRuns = 0;
  let configState = params.initialConfigState;

  const request = vi.fn(async (method: string, rpcParams: unknown) => {
    switch (method) {
      case "agents.builder.plan":
        return params.planFactory(false);
      case "config.get":
        return createConfigSnapshot(configState, `${params.connectorId}-retry-${verifyRuns}`);
      case "config.set":
        configState = nextConfigStateFromSetParams(rpcParams);
        return { ok: true };
      case "agents.builder.setup.run":
        setupAttempts += 1;
        if (setupAttempts === 1) {
          return {
            actionId: params.actionId,
            connectorId: params.connectorId,
            status: "needs_setup" as const,
            message: params.failureMessage,
            updatedRefs: [],
            summary: params.failureSummary,
            resume: {
              actionId: params.actionId,
              connectorId: params.connectorId,
              label: params.failureResumeLabel,
              detail: params.failureResumeDetail,
              inputs: {},
            },
          };
        }
        return {
          actionId: params.actionId,
          connectorId: params.connectorId,
          status: "configured" as const,
          message: params.successMessage,
          updatedRefs: params.successUpdatedRefs,
          summary: params.successSummary,
        };
      case "agents.builder.verify":
        verifyRuns += 1;
        return createVerifyResult(params.planFactory(true), params.fingerprint);
      default:
        throw new Error(`Unhandled guided retry method: ${method}`);
    }
  });

  attachMockClient(app, request);

  const briefInput = await waitForElement<HTMLTextAreaElement>(
    app,
    ".builder-brief-field textarea",
    {
      frames: 12,
    },
  );
  expect(briefInput).not.toBeNull();
  if (!briefInput) {
    return;
  }
  changeValue(briefInput, params.brief);
  await settle(app);

  clickButton(app, "Build Plan", { exact: true });
  await settle(app, 4);

  clickButton(app, params.openSetupLabel, { index: params.openSetupIndex ?? 1 });
  await settle(app, 3);

  if (params.expectedVisibleText) {
    expect(app.textContent).toContain(params.expectedVisibleText);
  }

  expect(setLabeledFieldValues(app, params.initialFields)).toBe(true);
  await settle(app);

  clickButton(app, "Save", { exact: true });
  await settle(app, 4);

  clickButton(app, params.verifyButtonLabel, { exact: true });
  await settle(app, 4);

  expect(app.builderSetupResult).toEqual(
    expect.objectContaining({
      actionId: params.actionId,
      connectorId: params.connectorId,
      status: "needs_setup",
    }),
  );
  expect(app.builderVerifyResult).toBeNull();
  expect(app.textContent).toContain(params.failureMessage);
  expect(app.textContent).toContain(params.failureResumeLabel);
  const blockedApplyButton = findButtonByText(app, "Apply Builder Plan", { exact: true });
  if (blockedApplyButton) {
    expect(blockedApplyButton.disabled).toBe(true);
  } else {
    expect(app.tab).toBe("onboarding");
  }

  expect(setLabeledFieldValues(app, params.repairedFields)).toBe(true);
  await settle(app);

  clickButton(app, "Save", { exact: true });
  await settle(app, 4);

  clickButton(app, params.retryButtonLabel ?? params.verifyButtonLabel, { exact: true });
  await settle(app, 4);

  expect(app.builderSetupResult).toEqual(
    expect.objectContaining({
      actionId: params.actionId,
      connectorId: params.connectorId,
      status: "configured",
    }),
  );
  expect(app.builderVerifyResult?.verification.fingerprint).toBe(params.fingerprint);
  expect(findButtonByText(app, "Apply Builder Plan", { exact: true })?.disabled).toBe(false);
}

function createSingleConnectorPlanResult(params: {
  brief: string;
  displayName: string;
  templateId: string;
  primaryGoal: "assistant" | "briefing" | "operator" | "research" | "support";
  executionMode: "bound-channel" | "direct" | "hybrid" | "scheduled" | "webhook";
  contractIds?: string[];
  connectorId: string;
  connectorLabel: string;
  connectorKind: string;
  connectorSourceKind: string;
  docsPath: string;
  sourceChannels: string[];
  ingressChannels: string[];
  readyIntegrationCount: number;
  unresolvedIntegrationCount: number;
  integrationStatus:
    | "discovered"
    | "install_required"
    | "installed"
    | "configured"
    | "authenticated"
    | "verified"
    | "degraded"
    | "failed";
  integrationIssues: string[];
  configRefs: string[];
  authRefs: string[];
  requiresConfig: boolean;
  requiresAuth: boolean;
  onboarding: boolean;
  installRequired?: boolean;
  installStrategy?: "none" | "bundled" | "npm" | "local" | "external";
  selectionLabel: string;
  detailLabel: string;
  setupActions: BrowserSetupAction[];
  setupTasks: BrowserSetupTask[];
  verificationProbeLabel: string;
  blockedVerificationDetail: string;
  passedVerificationDetail: string;
}): BuilderPlanResult {
  const contractIds = params.contractIds ?? ["message.send"];
  const verification = {
    id: `${params.connectorId}:builder-check`,
    connectorId: params.connectorId,
    connectorLabel: params.connectorLabel,
    probeKind: "setup",
    probeLabel: params.verificationProbeLabel,
    status: params.setupActions.length === 0 ? ("passed" as const) : ("blocked" as const),
    detail:
      params.setupActions.length === 0
        ? params.passedVerificationDetail
        : params.blockedVerificationDetail,
    source: "live" as const,
    checkedAt:
      params.setupActions.length === 0 ? "2026-04-10T18:25:00.000Z" : "2026-04-10T18:20:00.000Z",
  };

  return {
    draft: {
      brief: params.brief,
      templateId: params.templateId,
      displayName: params.displayName,
      confidence: "high",
      plannerStatus: "ready",
      reasons: [`Matched ${params.displayName.toLowerCase()} requirements from the brief.`],
      assumptions: [],
      questions: [],
      ready: params.setupActions.length === 0,
      buildSpec: {
        version: 1,
        status: "ready",
        contract: {
          id: "easyclaw.builder",
          version: "1",
          kind: "hybrid-deterministic",
          deterministicValidationRequired: true,
          plannerModelPolicy: "optional",
        },
        planner: {
          mode: "fallback-deterministic",
          attempts: 1,
          repairCount: 0,
        },
        context: {
          capabilityContractCount: 4,
          connectorCount: 2,
          templateExemplarCount: 1,
          readyIntegrationCount: params.readyIntegrationCount,
          unresolvedIntegrationCount: params.unresolvedIntegrationCount,
        },
        goal: {
          primaryGoal: params.primaryGoal,
          executionMode: params.executionMode,
          confidence: "high",
        },
        template: {
          templateId: params.templateId,
          displayName: params.displayName,
          confidence: "high",
          reasons: [`Selected ${params.displayName} for this connector flow.`],
        },
        schedule: {},
        graph: {
          mode: "single-agent",
          entryNodeId: "primary",
          nodes: [
            {
              id: "primary",
              roleId: "primary",
              label: "Primary Worker",
              entry: true,
              templateId: params.templateId,
              goal: params.brief,
              contractIds,
              connectorIds: [params.connectorId],
              responsibilities: ["Coordinate setup", "Run the workflow"],
            },
          ],
          edges: [],
        },
        integrations: [
          {
            connectorId: params.connectorId,
            label: params.connectorLabel,
            status: params.integrationStatus,
            kind: params.connectorKind,
            sourceKind: params.connectorSourceKind,
            issues: [...params.integrationIssues],
          },
        ],
        setupActions: params.setupActions,
        workspaceArtifacts: [],
        assumptions: [],
        questions: [],
        notes: [],
      },
      requirements: {
        confidence: "high",
        workflow: {
          primaryGoal: params.primaryGoal,
          executionMode: params.executionMode,
          triggerKinds: [],
          sourceKinds: params.sourceChannels,
          transformKinds: [],
          actionKinds: ["deliver"],
          deliveryKinds: params.ingressChannels,
          requiresApproval: false,
        },
        intentTags: [params.primaryGoal, params.connectorId.split(":")[1] ?? params.connectorId],
        triggers: [],
        inputs: params.sourceChannels.map((detail) => ({ detail })),
        transforms: [],
        decisions: [],
        actions: [{ detail: `Use ${params.connectorLabel} in this workflow.` }],
        outputs: [{ detail: "Keep Builder setup and verification reviewable." }],
        policies: [],
        constraints: [],
        missingInputs: [],
        setupGaps:
          params.setupActions.length > 0
            ? [{ code: `${params.connectorId}-setup`, message: params.blockedVerificationDetail }]
            : [],
        policyGaps: [],
        unsupportedGaps: [],
        ambiguities: [],
        unsupportedRequests: [],
        unsupportedClassifications: [],
        missingDataFields: [],
      },
      planning: {
        selections: [
          {
            requirementId: `${params.connectorId}-selection`,
            requirementLabel: params.connectorLabel,
            contractIds,
            connectorId: params.connectorId,
            connectorLabel: params.connectorLabel,
            source: "explicit",
          },
        ],
        alternatives: [],
        variants: [],
        integrations: [
          {
            connectorId: params.connectorId,
            instanceId: params.connectorId,
            status: params.integrationStatus,
            configRefs: [...params.configRefs],
            authRefs: [...params.authRefs],
            issues: [...params.integrationIssues],
            label: params.connectorLabel,
            kind: params.connectorKind,
            sourceKind: params.connectorSourceKind,
            contracts: contractIds,
            verification: [
              {
                kind: "setup",
                label: params.verificationProbeLabel,
                successDescription: params.passedVerificationDetail,
              },
            ],
            docsPath: params.docsPath,
            selectionLabel: params.selectionLabel,
            detailLabel: params.detailLabel,
            onboarding: params.onboarding,
            requiresConfig: params.requiresConfig,
            requiresAuth: params.requiresAuth,
            installRequired: params.installRequired ?? false,
            installStrategy: params.installStrategy ?? "none",
          },
        ],
        setupTasks: params.setupTasks,
        verifications: [verification],
        topology: {
          mode: "single-agent",
          reason: "A single coordinator can handle this connector setup flow.",
          roles: [
            {
              id: "primary",
              label: "Primary Worker",
              contractIds,
              connectorIds: [params.connectorId],
              responsibilities: ["Coordinate setup", "Run the workflow"],
            },
          ],
        },
        graph: {
          mode: "single-agent",
          entryNodeId: "primary",
          nodes: [
            {
              id: "primary",
              roleId: "primary",
              label: "Primary Worker",
              templateId: params.templateId,
              entry: true,
              agentId: `${params.templateId}-worker`,
              name: params.displayName,
              interactionMode: "direct",
              connectorIds: [params.connectorId],
              responsibilities: ["Coordinate setup", "Run the workflow"],
              deliveryTarget: null,
              schedule: null,
            },
          ],
          edges: [],
        },
      },
      extracted: {
        agentId: `${params.templateId}-worker`,
        name: params.displayName,
        ingressChannels: [...params.ingressChannels],
        sourceChannels: [...params.sourceChannels],
        deliveryTarget: null,
        schedule: null,
      },
    },
    workspacePreviews: [],
    plan: {
      status: "ready",
      issues: [],
    },
    graphPlans: [],
  };
}

function createVerifyResult(plan: BuilderPlanResult, fingerprint: string): BuilderVerifyResult {
  const results = plan.draft.planning.verifications;
  const passedCount = results.filter((entry) => entry.status === "passed").length;
  const failedCount = results.filter((entry) => entry.status === "failed").length;
  const blockedCount = results.filter((entry) => entry.status === "blocked").length;
  const unresolvedCount = results.filter((entry) => entry.status === "needs_live_check").length;
  return {
    ...plan,
    verification: {
      fingerprint,
      checkedAt: results[0]?.checkedAt ?? "2026-04-10T18:30:00.000Z",
      passedCount,
      failedCount,
      blockedCount,
      unresolvedCount,
      results,
    },
  };
}

function createGmailPlanResult(setupComplete: boolean): BuilderPlanResult {
  return createSingleConnectorPlanResult({
    brief: "Create a daily Telegram briefing from my Gmail every morning at 9am.",
    displayName: "Daily Briefing Agent",
    templateId: "daily-briefing",
    primaryGoal: "briefing",
    executionMode: "scheduled",
    connectorId: "platform:gmail-hook",
    connectorLabel: "Gmail Hook",
    connectorKind: "hooking",
    connectorSourceKind: "core_hook_section",
    docsPath: "/configuration#hooks",
    sourceChannels: ["gmail"],
    ingressChannels: ["telegram"],
    readyIntegrationCount: setupComplete ? 1 : 0,
    unresolvedIntegrationCount: setupComplete ? 0 : 1,
    integrationStatus: setupComplete ? "verified" : "configured",
    integrationIssues: setupComplete ? [] : ["Gmail setup still needs interactive sign-in."],
    configRefs: ["hooks.gmail"],
    authRefs: ["hooks.gmail"],
    requiresConfig: true,
    requiresAuth: true,
    onboarding: false,
    selectionLabel: "Gmail Hook",
    detailLabel: "Mailbox watch + Pub/Sub setup",
    setupActions: setupComplete
      ? []
      : [
          {
            id: "platform:gmail-hook",
            connectorId: "platform:gmail-hook",
            connectorLabel: "Gmail Hook",
            title: "Set up Gmail Hook",
            detail: "Finish Gmail sign-in and Pub/Sub setup before apply is allowed.",
            status: "pending",
            kind: "configure",
            source: "runtime-auth",
            blocking: true,
            refs: ["hooks.gmail"],
            workflowRoles: ["Primary Worker"],
            uiSchema: {
              variant: "guided-setup",
              section: "hooks.gmail",
              fieldKeys: [],
            },
            completionSignal: {
              kind: "verification",
              target: "platform:gmail-hook:builder-check",
              detail: "Pass Gmail hook readiness before apply is allowed.",
            },
          },
        ],
    setupTasks: setupComplete
      ? []
      : [
          {
            id: "platform:gmail-hook:setup",
            connectorId: "platform:gmail-hook",
            connectorLabel: "Gmail Hook",
            kind: "configure",
            status: "pending",
            title: "Set up Gmail Hook",
            detail: "Finish Gmail auth and Pub/Sub configuration.",
            refs: ["hooks.gmail"],
          },
        ],
    verificationProbeLabel: "Gmail hook readiness",
    blockedVerificationDetail:
      "Gmail setup still needs interactive sign-in and a resumed helper run.",
    passedVerificationDetail: "Gmail hook is configured and ready for delivery workflows.",
  });
}

function createTelegramPlanResult(setupComplete: boolean): BuilderPlanResult {
  return createSingleConnectorPlanResult({
    brief: "Deliver a daily briefing to my Telegram chat.",
    displayName: "Daily Briefing Agent",
    templateId: "daily-briefing",
    primaryGoal: "briefing",
    executionMode: "scheduled",
    connectorId: "channel:telegram",
    connectorLabel: "Telegram",
    connectorKind: "channel",
    connectorSourceKind: "core_channel_section",
    docsPath: "/channels/telegram",
    sourceChannels: [],
    ingressChannels: ["telegram"],
    readyIntegrationCount: setupComplete ? 1 : 0,
    unresolvedIntegrationCount: setupComplete ? 0 : 1,
    integrationStatus: setupComplete ? "verified" : "configured",
    integrationIssues: setupComplete ? [] : ["Telegram still needs a default delivery target."],
    configRefs: ["channels.telegram"],
    authRefs: ["channels.telegram"],
    requiresConfig: true,
    requiresAuth: true,
    onboarding: false,
    selectionLabel: "Telegram",
    detailLabel: "Bot token + default delivery target",
    setupActions: setupComplete
      ? []
      : [
          {
            id: "channel:telegram:auto-default-target",
            connectorId: "channel:telegram",
            connectorLabel: "Telegram",
            title: "Set up Telegram delivery",
            detail: "Auto-detect or set the Telegram default target before apply is allowed.",
            status: "pending",
            kind: "verify",
            source: "verification",
            blocking: true,
            refs: ["channels.telegram"],
            workflowRoles: ["Primary Worker"],
            uiSchema: {
              variant: "guided-setup",
              section: "channels.telegram",
              fieldKeys: [],
            },
            completionSignal: {
              kind: "verification",
              target: "channel:telegram:builder-check",
              detail: "Pass Telegram delivery readiness before apply is allowed.",
            },
          },
        ],
    setupTasks: setupComplete
      ? []
      : [
          {
            id: "channel:telegram:setup",
            connectorId: "channel:telegram",
            connectorLabel: "Telegram",
            kind: "configure",
            status: "pending",
            title: "Set up Telegram delivery",
            detail: "Choose a default target for scheduled deliveries.",
            refs: ["channels.telegram"],
          },
        ],
    verificationProbeLabel: "Telegram delivery readiness",
    blockedVerificationDetail: "Telegram still needs a verified default delivery target.",
    passedVerificationDetail: "Telegram delivery is configured and ready.",
  });
}

function createSlackVerifyPlanResult(setupComplete: boolean): BuilderPlanResult {
  return createSingleConnectorPlanResult({
    brief: "Send my daily ops summary to Slack.",
    displayName: "Ops Summary Agent",
    templateId: "daily-briefing",
    primaryGoal: "briefing",
    executionMode: "scheduled",
    connectorId: "channel:slack",
    connectorLabel: "Slack",
    connectorKind: "channel",
    connectorSourceKind: "core_channel_section",
    docsPath: "/channels/slack",
    sourceChannels: [],
    ingressChannels: ["slack"],
    readyIntegrationCount: setupComplete ? 1 : 0,
    unresolvedIntegrationCount: setupComplete ? 0 : 1,
    integrationStatus: setupComplete ? "verified" : "configured",
    integrationIssues: setupComplete ? [] : ["Slack still needs verified credentials."],
    configRefs: ["channels.slack"],
    authRefs: ["channels.slack"],
    requiresConfig: true,
    requiresAuth: true,
    onboarding: false,
    selectionLabel: "Slack",
    detailLabel: "Slack credentials verification",
    setupActions: setupComplete
      ? []
      : [
          {
            id: "channel:slack:verify-credentials",
            connectorId: "channel:slack",
            connectorLabel: "Slack",
            title: "Verify Slack credentials",
            detail: "Confirm the saved Slack tokens before delivery is enabled.",
            status: "pending",
            kind: "verify",
            source: "verification",
            blocking: true,
            refs: ["channels.slack"],
            requiredFields: [
              {
                key: "bot-token",
                label: "Bot token",
                kind: "auth",
                required: true,
                inputKey: "slack.botToken",
                configPath: "channels.slack.botToken",
                inputType: "secret",
              },
              {
                key: "app-token",
                label: "App token",
                kind: "auth",
                required: false,
                inputKey: "slack.appToken",
                configPath: "channels.slack.appToken",
                inputType: "secret",
              },
            ],
            workflowRoles: ["Primary Worker"],
            uiSchema: {
              variant: "guided-setup",
              section: "channels.slack",
              fieldKeys: ["bot-token", "app-token"],
            },
            completionSignal: {
              kind: "verification",
              target: "channel:slack:builder-check",
              detail: "Pass Slack credential readiness before apply is allowed.",
            },
          },
        ],
    setupTasks: setupComplete
      ? []
      : [
          {
            id: "channel:slack:verify",
            connectorId: "channel:slack",
            connectorLabel: "Slack",
            kind: "verify",
            status: "pending",
            title: "Verify Slack credentials",
            detail: "Check the Slack tokens before enabling delivery.",
            refs: ["channels.slack"],
          },
        ],
    verificationProbeLabel: "Slack credential readiness",
    blockedVerificationDetail: "Slack still needs verified credentials before delivery can run.",
    passedVerificationDetail: "Slack credentials are configured and ready.",
  });
}

function createSignalVerifyPlanResult(setupComplete: boolean): BuilderPlanResult {
  return createSingleConnectorPlanResult({
    brief: "Send alerts through Signal.",
    displayName: "Alerting Agent",
    templateId: "support-responder",
    primaryGoal: "support",
    executionMode: "hybrid",
    connectorId: "channel:signal",
    connectorLabel: "Signal",
    connectorKind: "channel",
    connectorSourceKind: "core_channel_section",
    docsPath: "/channels/signal",
    sourceChannels: [],
    ingressChannels: ["signal"],
    readyIntegrationCount: setupComplete ? 1 : 0,
    unresolvedIntegrationCount: setupComplete ? 0 : 1,
    integrationStatus: setupComplete ? "verified" : "configured",
    integrationIssues: setupComplete ? [] : ["Signal transport still needs verification."],
    configRefs: ["channels.signal"],
    authRefs: ["channels.signal"],
    requiresConfig: true,
    requiresAuth: true,
    onboarding: false,
    selectionLabel: "Signal",
    detailLabel: "Signal transport verification",
    setupActions: setupComplete
      ? []
      : [
          {
            id: "channel:signal:verify-transport",
            connectorId: "channel:signal",
            connectorLabel: "Signal",
            title: "Verify Signal transport",
            detail: "Confirm the Signal transport endpoint before delivery is enabled.",
            status: "pending",
            kind: "verify",
            source: "verification",
            blocking: true,
            refs: ["channels.signal"],
            requiredFields: [
              {
                key: "signal-account",
                label: "Signal account",
                kind: "account",
                required: true,
                inputKey: "signal.account",
                configPath: "channels.signal.account",
                inputType: "text",
              },
              {
                key: "signal-http-url",
                label: "Signal HTTP URL",
                kind: "destination",
                required: false,
                inputKey: "signal.httpUrl",
                configPath: "channels.signal.httpUrl",
                inputType: "text",
                placeholder: "http://127.0.0.1:8080",
              },
            ],
            workflowRoles: ["Primary Worker"],
            uiSchema: {
              variant: "guided-setup",
              section: "channels.signal",
              fieldKeys: ["signal-account", "signal-http-url"],
            },
            completionSignal: {
              kind: "verification",
              target: "channel:signal:builder-check",
              detail: "Pass Signal transport readiness before apply is allowed.",
            },
          },
        ],
    setupTasks: setupComplete
      ? []
      : [
          {
            id: "channel:signal:verify",
            connectorId: "channel:signal",
            connectorLabel: "Signal",
            kind: "verify",
            status: "pending",
            title: "Verify Signal transport",
            detail: "Check the saved Signal transport details.",
            refs: ["channels.signal"],
          },
        ],
    verificationProbeLabel: "Signal transport readiness",
    blockedVerificationDetail: "Signal transport still needs verification before delivery can run.",
    passedVerificationDetail: "Signal transport is configured and ready.",
  });
}

function createDiscordVerifyPlanResult(setupComplete: boolean): BuilderPlanResult {
  return createSingleConnectorPlanResult({
    brief: "Send release notes to Discord.",
    displayName: "Release Notes Agent",
    templateId: "daily-briefing",
    primaryGoal: "briefing",
    executionMode: "scheduled",
    connectorId: "channel:discord",
    connectorLabel: "Discord",
    connectorKind: "channel",
    connectorSourceKind: "core_channel_section",
    docsPath: "/channels/discord",
    sourceChannels: [],
    ingressChannels: ["discord"],
    readyIntegrationCount: setupComplete ? 1 : 0,
    unresolvedIntegrationCount: setupComplete ? 0 : 1,
    integrationStatus: setupComplete ? "verified" : "configured",
    integrationIssues: setupComplete ? [] : ["Discord still needs a verified bot token."],
    configRefs: ["channels.discord"],
    authRefs: ["channels.discord"],
    requiresConfig: true,
    requiresAuth: true,
    onboarding: false,
    selectionLabel: "Discord",
    detailLabel: "Discord token verification",
    setupActions: setupComplete
      ? []
      : [
          {
            id: "channel:discord:verify-token",
            connectorId: "channel:discord",
            connectorLabel: "Discord",
            title: "Verify Discord token",
            detail: "Confirm the saved Discord bot token before delivery is enabled.",
            status: "pending",
            kind: "verify",
            source: "verification",
            blocking: true,
            refs: ["channels.discord"],
            requiredFields: [
              {
                key: "token",
                label: "Bot token",
                kind: "auth",
                required: true,
                inputKey: "discord.token",
                configPath: "channels.discord.token",
                inputType: "secret",
              },
            ],
            workflowRoles: ["Primary Worker"],
            uiSchema: {
              variant: "guided-setup",
              section: "channels.discord",
              fieldKeys: ["token"],
            },
            completionSignal: {
              kind: "verification",
              target: "channel:discord:builder-check",
              detail: "Pass Discord token readiness before apply is allowed.",
            },
          },
        ],
    setupTasks: setupComplete
      ? []
      : [
          {
            id: "channel:discord:verify",
            connectorId: "channel:discord",
            connectorLabel: "Discord",
            kind: "verify",
            status: "pending",
            title: "Verify Discord token",
            detail: "Check the Discord bot token before enabling delivery.",
            refs: ["channels.discord"],
          },
        ],
    verificationProbeLabel: "Discord token readiness",
    blockedVerificationDetail: "Discord still needs a verified bot token before delivery can run.",
    passedVerificationDetail: "Discord credentials are configured and ready.",
  });
}

function createGoogleChatVerifyPlanResult(setupComplete: boolean): BuilderPlanResult {
  return createSingleConnectorPlanResult({
    brief: "Send deployment updates to Google Chat.",
    displayName: "Deployment Updates Agent",
    templateId: "support-responder",
    primaryGoal: "support",
    executionMode: "hybrid",
    connectorId: "channel:googlechat",
    connectorLabel: "Google Chat",
    connectorKind: "channel",
    connectorSourceKind: "core_channel_section",
    docsPath: "/channels/googlechat",
    sourceChannels: [],
    ingressChannels: ["googlechat"],
    readyIntegrationCount: setupComplete ? 1 : 0,
    unresolvedIntegrationCount: setupComplete ? 0 : 1,
    integrationStatus: setupComplete ? "verified" : "configured",
    integrationIssues: setupComplete ? [] : ["Google Chat still needs verified auth."],
    configRefs: ["channels.googlechat"],
    authRefs: ["channels.googlechat"],
    requiresConfig: true,
    requiresAuth: true,
    onboarding: false,
    selectionLabel: "Google Chat",
    detailLabel: "Service-account auth verification",
    setupActions: setupComplete
      ? []
      : [
          {
            id: "channel:googlechat:verify-auth",
            connectorId: "channel:googlechat",
            connectorLabel: "Google Chat",
            title: "Verify Google Chat auth",
            detail: "Confirm service-account and webhook auth settings before delivery is enabled.",
            status: "pending",
            kind: "verify",
            source: "verification",
            blocking: true,
            refs: ["channels.googlechat"],
            workflowRoles: ["Primary Worker"],
            uiSchema: {
              variant: "guided-setup",
              section: "channels.googlechat",
              fieldKeys: [],
            },
            completionSignal: {
              kind: "verification",
              target: "channel:googlechat:builder-check",
              detail: "Pass Google Chat auth readiness before apply is allowed.",
            },
          },
        ],
    setupTasks: setupComplete
      ? []
      : [
          {
            id: "channel:googlechat:verify",
            connectorId: "channel:googlechat",
            connectorLabel: "Google Chat",
            kind: "verify",
            status: "pending",
            title: "Verify Google Chat auth",
            detail: "Check service-account and audience settings before enabling delivery.",
            refs: ["channels.googlechat"],
          },
        ],
    verificationProbeLabel: "Google Chat auth readiness",
    blockedVerificationDetail: "Google Chat still needs verified auth before delivery can run.",
    passedVerificationDetail: "Google Chat auth is configured and ready.",
  });
}

function createMatrixVerifyPlanResult(setupComplete: boolean): BuilderPlanResult {
  return createSingleConnectorPlanResult({
    brief: "Send deployment updates to Matrix.",
    displayName: "Deployment Updates Agent",
    templateId: "support-responder",
    primaryGoal: "support",
    executionMode: "hybrid",
    connectorId: "channel:matrix",
    connectorLabel: "Matrix",
    connectorKind: "channel",
    connectorSourceKind: "channel_catalog",
    docsPath: "/channels/matrix",
    sourceChannels: [],
    ingressChannels: ["matrix"],
    readyIntegrationCount: setupComplete ? 1 : 0,
    unresolvedIntegrationCount: setupComplete ? 0 : 1,
    integrationStatus: setupComplete ? "verified" : "configured",
    integrationIssues: setupComplete ? [] : ["Matrix still needs verified credentials."],
    configRefs: ["channels.matrix"],
    authRefs: ["channels.matrix"],
    requiresConfig: true,
    requiresAuth: true,
    onboarding: false,
    selectionLabel: "Matrix",
    detailLabel: "Matrix auth verification",
    setupActions: setupComplete
      ? []
      : [
          {
            id: "channel:matrix:verify-credentials",
            connectorId: "channel:matrix",
            connectorLabel: "Matrix",
            title: "Verify Matrix credentials",
            detail: "Confirm the saved Matrix homeserver and token before delivery is enabled.",
            status: "pending",
            kind: "verify",
            source: "verification",
            blocking: true,
            refs: ["channels.matrix"],
            workflowRoles: ["Primary Worker"],
            uiSchema: {
              variant: "guided-setup",
              section: "channels.matrix",
              fieldKeys: [],
            },
            completionSignal: {
              kind: "verification",
              target: "channel:matrix:builder-check",
              detail: "Pass Matrix credential readiness before apply is allowed.",
            },
          },
        ],
    setupTasks: setupComplete
      ? []
      : [
          {
            id: "channel:matrix:verify",
            connectorId: "channel:matrix",
            connectorLabel: "Matrix",
            kind: "verify",
            status: "pending",
            title: "Verify Matrix credentials",
            detail: "Check the Matrix homeserver and token before enabling delivery.",
            refs: ["channels.matrix"],
          },
        ],
    verificationProbeLabel: "Matrix credential readiness",
    blockedVerificationDetail: "Matrix still needs verified credentials before delivery can run.",
    passedVerificationDetail: "Matrix credentials are configured and ready.",
  });
}

function createMSTeamsVerifyPlanResult(setupComplete: boolean): BuilderPlanResult {
  return createSingleConnectorPlanResult({
    brief: "Send deployment updates to Microsoft Teams.",
    displayName: "Deployment Updates Agent",
    templateId: "support-responder",
    primaryGoal: "support",
    executionMode: "hybrid",
    connectorId: "channel:msteams",
    connectorLabel: "Microsoft Teams",
    connectorKind: "channel",
    connectorSourceKind: "channel_catalog",
    docsPath: "/channels/msteams",
    sourceChannels: [],
    ingressChannels: ["msteams"],
    readyIntegrationCount: setupComplete ? 1 : 0,
    unresolvedIntegrationCount: setupComplete ? 0 : 1,
    integrationStatus: setupComplete ? "verified" : "configured",
    integrationIssues: setupComplete ? [] : ["Microsoft Teams still needs verified credentials."],
    configRefs: ["channels.msteams"],
    authRefs: ["channels.msteams"],
    requiresConfig: true,
    requiresAuth: true,
    onboarding: false,
    selectionLabel: "Microsoft Teams",
    detailLabel: "Bot Framework credential verification",
    setupActions: setupComplete
      ? []
      : [
          {
            id: "channel:msteams:verify-credentials",
            connectorId: "channel:msteams",
            connectorLabel: "Microsoft Teams",
            title: "Verify Teams credentials",
            detail: "Confirm the saved Bot Framework credentials before delivery is enabled.",
            status: "pending",
            kind: "verify",
            source: "verification",
            blocking: true,
            refs: ["channels.msteams"],
            workflowRoles: ["Primary Worker"],
            uiSchema: {
              variant: "guided-setup",
              section: "channels.msteams",
              fieldKeys: [],
            },
            completionSignal: {
              kind: "verification",
              target: "channel:msteams:builder-check",
              detail: "Pass Teams credential readiness before apply is allowed.",
            },
          },
        ],
    setupTasks: setupComplete
      ? []
      : [
          {
            id: "channel:msteams:verify",
            connectorId: "channel:msteams",
            connectorLabel: "Microsoft Teams",
            kind: "verify",
            status: "pending",
            title: "Verify Teams credentials",
            detail: "Check Bot Framework credentials before enabling delivery.",
            refs: ["channels.msteams"],
          },
        ],
    verificationProbeLabel: "Teams credential readiness",
    blockedVerificationDetail:
      "Microsoft Teams still needs verified credentials before delivery can run.",
    passedVerificationDetail: "Microsoft Teams credentials are configured and ready.",
  });
}

function createIMessageVerifyPlanResult(setupComplete: boolean): BuilderPlanResult {
  return createSingleConnectorPlanResult({
    brief: "Send deployment updates to iMessage.",
    displayName: "Deployment Updates Agent",
    templateId: "support-responder",
    primaryGoal: "support",
    executionMode: "hybrid",
    connectorId: "channel:imessage",
    connectorLabel: "iMessage",
    connectorKind: "channel",
    connectorSourceKind: "core_channel_section",
    docsPath: "/channels/imessage",
    sourceChannels: [],
    ingressChannels: ["imessage"],
    readyIntegrationCount: setupComplete ? 1 : 0,
    unresolvedIntegrationCount: setupComplete ? 0 : 1,
    integrationStatus: setupComplete ? "verified" : "configured",
    integrationIssues: setupComplete ? [] : ["iMessage transport still needs verification."],
    configRefs: ["channels.imessage"],
    authRefs: ["channels.imessage"],
    requiresConfig: true,
    requiresAuth: true,
    onboarding: false,
    selectionLabel: "iMessage",
    detailLabel: "iMessage transport verification",
    setupActions: setupComplete
      ? []
      : [
          {
            id: "channel:imessage:verify-transport",
            connectorId: "channel:imessage",
            connectorLabel: "iMessage",
            title: "Verify iMessage transport",
            detail: "Confirm local iMessage transport access before delivery is enabled.",
            status: "pending",
            kind: "verify",
            source: "verification",
            blocking: true,
            refs: ["channels.imessage"],
            workflowRoles: ["Primary Worker"],
            uiSchema: {
              variant: "guided-setup",
              section: "channels.imessage",
              fieldKeys: [],
            },
            completionSignal: {
              kind: "verification",
              target: "channel:imessage:builder-check",
              detail: "Pass iMessage transport readiness before apply is allowed.",
            },
          },
        ],
    setupTasks: setupComplete
      ? []
      : [
          {
            id: "channel:imessage:verify",
            connectorId: "channel:imessage",
            connectorLabel: "iMessage",
            kind: "verify",
            status: "pending",
            title: "Verify iMessage transport",
            detail: "Check local imsg transport before enabling delivery.",
            refs: ["channels.imessage"],
          },
        ],
    verificationProbeLabel: "iMessage transport readiness",
    blockedVerificationDetail:
      "iMessage transport still needs verification before delivery can run.",
    passedVerificationDetail: "iMessage transport is configured and ready.",
  });
}

function createWhatsAppPlanResult(setupComplete: boolean): BuilderPlanResult {
  return createSingleConnectorPlanResult({
    brief: "Send a daily briefing to my WhatsApp account.",
    displayName: "Daily Briefing Agent",
    templateId: "daily-briefing",
    primaryGoal: "briefing",
    executionMode: "scheduled",
    connectorId: "channel:whatsapp",
    connectorLabel: "WhatsApp",
    connectorKind: "channel",
    connectorSourceKind: "core_channel_section",
    docsPath: "/channels/whatsapp",
    sourceChannels: [],
    ingressChannels: ["whatsapp"],
    readyIntegrationCount: setupComplete ? 1 : 0,
    unresolvedIntegrationCount: setupComplete ? 0 : 1,
    integrationStatus: setupComplete ? "verified" : "configured",
    integrationIssues: setupComplete
      ? []
      : ["WhatsApp still needs a connected session and delivery target."],
    configRefs: ["channels.whatsapp"],
    authRefs: ["channels.whatsapp"],
    requiresConfig: true,
    requiresAuth: true,
    onboarding: true,
    selectionLabel: "WhatsApp",
    detailLabel: "QR pairing + default destination",
    setupActions: setupComplete
      ? []
      : [
          {
            id: "channel:whatsapp:auto-default-target",
            connectorId: "channel:whatsapp",
            connectorLabel: "WhatsApp",
            title: "Set up WhatsApp delivery",
            detail: "Pair WhatsApp and set a delivery destination before apply is allowed.",
            status: "pending",
            kind: "connect",
            source: "setup-task",
            blocking: true,
            refs: ["channels.whatsapp"],
            workflowRoles: ["Primary Worker"],
            uiSchema: {
              variant: "guided-setup",
              section: "channels.whatsapp",
              fieldKeys: [],
            },
            completionSignal: {
              kind: "verification",
              target: "channel:whatsapp:builder-check",
              detail: "Pass WhatsApp delivery readiness before apply is allowed.",
            },
          },
        ],
    setupTasks: setupComplete
      ? []
      : [
          {
            id: "channel:whatsapp:setup",
            connectorId: "channel:whatsapp",
            connectorLabel: "WhatsApp",
            kind: "connect",
            status: "pending",
            title: "Set up WhatsApp delivery",
            detail: "Pair the session and set the default destination.",
            refs: ["channels.whatsapp"],
          },
        ],
    verificationProbeLabel: "WhatsApp delivery readiness",
    blockedVerificationDetail:
      "WhatsApp still needs a connected session and a verified destination.",
    passedVerificationDetail: "WhatsApp delivery is configured and ready.",
  });
}

function createExecApprovalsPlanResult(setupComplete: boolean): BuilderPlanResult {
  return createSingleConnectorPlanResult({
    brief: "Open websites for me and ask for approval before changing anything.",
    displayName: "Operator Agent",
    templateId: "personal-assistant",
    primaryGoal: "operator",
    executionMode: "hybrid",
    contractIds: ["approval.request", "browser.control"],
    connectorId: "platform:exec-approvals",
    connectorLabel: "Exec Approvals",
    connectorKind: "policy",
    connectorSourceKind: "core_policy_section",
    docsPath: "/configuration#approvals",
    sourceChannels: [],
    ingressChannels: [],
    readyIntegrationCount: setupComplete ? 1 : 0,
    unresolvedIntegrationCount: setupComplete ? 0 : 1,
    integrationStatus: setupComplete ? "verified" : "configured",
    integrationIssues: setupComplete ? [] : ["Exec approvals still need a valid forwarding route."],
    configRefs: ["approvals.exec"],
    authRefs: [],
    requiresConfig: true,
    requiresAuth: false,
    onboarding: false,
    installRequired: false,
    installStrategy: "none",
    selectionLabel: "Exec Approvals",
    detailLabel: "Approval forwarding route",
    setupActions: setupComplete
      ? []
      : [
          {
            id: "platform:exec-approvals:configure",
            connectorId: "platform:exec-approvals",
            connectorLabel: "Exec Approvals",
            title: "Configure Exec Approvals",
            detail:
              "Set approval forwarding so risky actions can be reviewed before apply is allowed.",
            status: "pending",
            kind: "policy",
            source: "requirement-gap",
            blocking: true,
            refs: ["approvals.exec"],
            requiredFields: [
              {
                key: "approval-enabled",
                label: "Forward exec approvals",
                kind: "approval",
                required: true,
                configPath: "approvals.exec.enabled",
                inputType: "select",
                options: [
                  { value: "true", label: "Enabled" },
                  { value: "false", label: "Disabled" },
                ],
              },
              {
                key: "approval-mode",
                label: "Approval forwarding mode",
                kind: "approval",
                required: true,
                configPath: "approvals.exec.mode",
                inputType: "select",
                options: [
                  { value: "session", label: "Session only" },
                  { value: "targets", label: "Explicit targets only" },
                  { value: "both", label: "Session and targets" },
                ],
              },
              {
                key: "approval-target-channel",
                label: "Approval target channel",
                kind: "destination",
                required: false,
                configPath: "approvals.exec.targets.0.channel",
                inputType: "text",
                placeholder: "telegram",
              },
              {
                key: "approval-target",
                label: "Approval target destination",
                kind: "destination",
                required: false,
                configPath: "approvals.exec.targets.0.to",
                inputType: "text",
                placeholder: "123456789",
              },
            ],
            workflowRoles: ["Primary Worker"],
            uiSchema: {
              variant: "guided-setup",
              section: "approvals.exec",
              fieldKeys: [
                "approval-enabled",
                "approval-mode",
                "approval-target-channel",
                "approval-target",
              ],
            },
            completionSignal: {
              kind: "verification",
              target: "platform:exec-approvals:builder-check",
              detail: "Pass exec approval routing readiness before apply is allowed.",
            },
          },
        ],
    setupTasks: setupComplete
      ? []
      : [
          {
            id: "platform:exec-approvals:setup",
            connectorId: "platform:exec-approvals",
            connectorLabel: "Exec Approvals",
            kind: "policy",
            status: "pending",
            title: "Configure Exec Approvals",
            detail: "Choose how approval prompts should be routed.",
            refs: ["approvals.exec"],
          },
        ],
    verificationProbeLabel: "Exec approval readiness",
    blockedVerificationDetail:
      "Exec approvals still need a valid session or explicit forwarding route.",
    passedVerificationDetail: "Exec approvals are configured and ready.",
  });
}

function createChannelPluginInstallPlanResult(
  params: {
    brief: string;
    connectorId: string;
    connectorLabel: string;
    docsPath: string;
    ingressChannel: string;
  },
  setupComplete: boolean,
): BuilderPlanResult {
  const channelRef = `channels.${params.connectorId.slice("channel:".length)}`;
  const installTitle = `Install ${params.connectorLabel}`;
  const installDetail = `Install the ${params.connectorLabel} plugin before Builder can continue onboarding.`;
  const blockedVerificationDetail = `${params.connectorLabel} still needs the plugin installed before setup can continue.`;
  const passedVerificationDetail = `${params.connectorLabel} is installed and ready for the next onboarding step.`;

  return createSingleConnectorPlanResult({
    brief: params.brief,
    displayName: "Support Responder",
    templateId: "support-responder",
    primaryGoal: "support",
    executionMode: "bound-channel",
    connectorId: params.connectorId,
    connectorLabel: params.connectorLabel,
    connectorKind: "channel",
    connectorSourceKind: "channel_catalog",
    docsPath: params.docsPath,
    sourceChannels: [],
    ingressChannels: [params.ingressChannel],
    readyIntegrationCount: setupComplete ? 1 : 0,
    unresolvedIntegrationCount: setupComplete ? 0 : 1,
    integrationStatus: setupComplete ? "verified" : "install_required",
    integrationIssues: setupComplete ? [] : [blockedVerificationDetail],
    configRefs: [channelRef],
    authRefs: [channelRef],
    requiresConfig: true,
    requiresAuth: true,
    onboarding: true,
    installRequired: !setupComplete,
    installStrategy: setupComplete ? "none" : "npm",
    selectionLabel: params.connectorLabel,
    detailLabel: "Plugin install and channel onboarding",
    setupActions: setupComplete
      ? []
      : [
          {
            id: `${params.connectorId}:install`,
            connectorId: params.connectorId,
            connectorLabel: params.connectorLabel,
            title: installTitle,
            detail: installDetail,
            status: "pending",
            kind: "install",
            source: "setup-task",
            blocking: true,
            refs: [channelRef],
            workflowRoles: ["Primary Worker"],
            uiSchema: {
              variant: "guided-setup",
              section: channelRef,
              fieldKeys: [],
            },
            completionSignal: {
              kind: "verification",
              target: `${params.connectorId}:builder-check`,
              detail: `Install the ${params.connectorLabel} channel before apply is allowed.`,
            },
          },
        ],
    setupTasks: setupComplete
      ? []
      : [
          {
            id: `${params.connectorId}:install`,
            connectorId: params.connectorId,
            connectorLabel: params.connectorLabel,
            kind: "install",
            status: "pending",
            title: installTitle,
            detail: `Install the ${params.connectorLabel} plugin package.`,
            refs: [channelRef],
          },
        ],
    verificationProbeLabel: `${params.connectorLabel} readiness`,
    blockedVerificationDetail,
    passedVerificationDetail,
  });
}

function createPluginInstallPlanResult(setupComplete: boolean): BuilderPlanResult {
  return createChannelPluginInstallPlanResult(
    {
      brief: "Send support escalations to Microsoft Teams.",
      connectorId: "channel:msteams",
      connectorLabel: "Microsoft Teams",
      docsPath: "/channels/msteams",
      ingressChannel: "msteams",
    },
    setupComplete,
  );
}

function createMatrixPluginInstallPlanResult(setupComplete: boolean): BuilderPlanResult {
  return createChannelPluginInstallPlanResult(
    {
      brief: "Send support escalations to Matrix.",
      connectorId: "channel:matrix",
      connectorLabel: "Matrix",
      docsPath: "/channels/matrix",
      ingressChannel: "matrix",
    },
    setupComplete,
  );
}

function createConfigSnapshot(config: Record<string, unknown>, hash = "config-hash") {
  return {
    hash,
    valid: true,
    config,
    raw: JSON.stringify(config, null, 2),
    issues: [],
  };
}

function createGmailGuidedRequest() {
  let gmailResumeReady = false;
  let gmailConfigured = false;
  let verifyRuns = 0;

  const request = vi.fn(async (method: string, params: unknown) => {
    switch (method) {
      case "agents.builder.plan":
        return createGmailPlanResult(false);
      case "agents.builder.setup.run": {
        const record =
          params && typeof params === "object" && !Array.isArray(params)
            ? (params as Record<string, unknown>)
            : {};
        const actionId =
          typeof record.actionId === "string"
            ? record.actionId
            : typeof record.connectorId === "string"
              ? record.connectorId
              : "";
        if (actionId === "platform:gmail-hook" && !gmailResumeReady && !gmailConfigured) {
          return {
            actionId: "platform:gmail-hook",
            connectorId: "platform:gmail-hook",
            status: "needs_auth" as const,
            message: "Gmail setup needs sign-in before EasyClaw can finish the remaining steps.",
            updatedRefs: [],
            authSteps: [
              {
                id: "gcloud-auth",
                actionId: "platform:gmail-hook:gcloud-auth",
                label: "Sign in to Google Cloud",
                detail: "Log in to the Google Cloud CLI.",
                command: "gcloud auth login",
                connectorId: "platform:gmail-hook",
                inputs: {},
              },
            ],
            resume: {
              actionId: "platform:gmail-hook",
              connectorId: "platform:gmail-hook",
              label: "Retry Gmail setup",
              detail: "Run Gmail auto-setup again after the setup steps are complete.",
              inputs: {
                account: "automation@example.com",
                project: "",
                topic: "",
                subscription: "",
                pushEndpoint: "",
              },
            },
          };
        }
        if (actionId === "platform:gmail-hook:gcloud-auth") {
          return {
            actionId: "platform:gmail-hook:gcloud-auth",
            connectorId: "platform:gmail-hook",
            status: "needs_auth" as const,
            message: "Google Cloud sign-in launched. Finish it, then authorize gog.",
            updatedRefs: [],
            authSteps: [
              {
                id: "gog-auth",
                actionId: "platform:gmail-hook:gog-auth",
                label: "Sign in to gog",
                detail: "Authorize gog for Gmail access.",
                command:
                  "gog login automation@example.com --client openclaw-gmail-hook --services gmail --gmail-scope full --force-consent",
                connectorId: "platform:gmail-hook",
                inputs: {
                  account: "automation@example.com",
                },
              },
            ],
            resume: {
              actionId: "platform:gmail-hook",
              connectorId: "platform:gmail-hook",
              label: "Retry Gmail setup",
              detail: "Run Gmail auto-setup again after the setup steps are complete.",
              inputs: {
                account: "automation@example.com",
                project: "",
                topic: "",
                subscription: "",
                pushEndpoint: "",
              },
            },
          };
        }
        if (actionId === "platform:gmail-hook:gog-auth") {
          gmailResumeReady = true;
          return {
            actionId: "platform:gmail-hook:gog-auth",
            connectorId: "platform:gmail-hook",
            status: "needs_auth" as const,
            message: "Gmail auth finished. Retry Gmail setup to continue.",
            updatedRefs: [],
            resume: {
              actionId: "platform:gmail-hook",
              connectorId: "platform:gmail-hook",
              label: "Retry Gmail setup",
              detail: "Run Gmail auto-setup again after the setup steps are complete.",
              inputs: {
                account: "automation@example.com",
                project: "",
                topic: "",
                subscription: "",
                pushEndpoint: "",
              },
            },
          };
        }
        if (actionId === "platform:gmail-hook" && gmailResumeReady) {
          gmailConfigured = true;
          return {
            actionId: "platform:gmail-hook",
            connectorId: "platform:gmail-hook",
            status: "configured" as const,
            message: "Gmail hook configured.",
            updatedRefs: ["hooks.gmail", "hooks.gmail.topic"],
            summary: {
              projectId: "project-123",
              topic: "projects/project-123/topics/gmail-push",
            },
          };
        }
        throw new Error(`Unexpected Gmail builder action: ${actionId}`);
      }
      case "config.get":
        return createConfigSnapshot(
          {
            hooks: {
              gmail: {
                account: "automation@example.com",
                topic: "projects/project-123/topics/gmail-push",
              },
            },
          },
          "config-hash",
        );
      case "agents.builder.verify":
        verifyRuns += 1;
        return createVerifyResult(createGmailPlanResult(true), `gmail-verify-${verifyRuns}`);
      default:
        throw new Error(`Unhandled Gmail test gateway method: ${method}`);
    }
  });

  return { request };
}

describe("Builder guided connector flows", () => {
  it("drives Gmail auth handoff and resume until Builder unblocks apply", async () => {
    const app = mountApp("/builder");
    await settle(app, 3);

    const { request } = createGmailGuidedRequest();

    attachMockClient(app, request);

    const briefInput = await waitForElement<HTMLTextAreaElement>(
      app,
      ".builder-brief-field textarea",
      {
        frames: 12,
      },
    );
    expect(briefInput).not.toBeNull();
    if (!briefInput) {
      return;
    }
    changeValue(briefInput, "Create a daily Telegram briefing from my Gmail every morning at 9am.");
    await settle(app);

    clickButton(app, "Build Plan", { exact: true });
    await settle(app, 4);

    expect(app.textContent).toContain("Set up Gmail Hook");
    expectApplyBlocked(app);

    clickButton(app, "Open Gmail hook setup");
    await settle(app, 3);

    const gmailAccountInput = Array.from(
      app.querySelectorAll<HTMLInputElement>('.quick-setup__assist input[type="text"]'),
    ).find((entry) => {
      const label = entry.closest("label")?.querySelector(".quick-setup__field-label")?.textContent;
      return normalizeText(label).includes("Gmail Account");
    });
    expect(gmailAccountInput).not.toBeNull();
    if (!gmailAccountInput) {
      return;
    }
    changeValue(gmailAccountInput, "automation@example.com");
    await settle(app);

    clickButton(app, "Auto-configure Gmail hook", { exact: true });
    await settle(app, 3);

    expect(app.textContent).toContain(
      "Gmail setup needs sign-in before EasyClaw can finish the remaining steps.",
    );
    expect(
      request.mock.calls.filter(([method]) => method === "agents.builder.verify"),
    ).toHaveLength(0);

    clickButton(app, "Sign in to Google Cloud", { exact: true });
    await settle(app, 3);
    expect(app.textContent).toContain(
      "Google Cloud sign-in launched. Finish it, then authorize gog.",
    );

    clickButton(app, "Sign in to gog", { exact: true });
    await settle(app, 3);
    expect(app.textContent).toContain("Gmail auth finished. Retry Gmail setup to continue.");

    clickButton(app, "Retry Gmail setup", { exact: true });
    await settle(app, 4);

    expect(app.builderSetupResult).toEqual(
      expect.objectContaining({
        actionId: "platform:gmail-hook",
        connectorId: "platform:gmail-hook",
        status: "configured",
      }),
    );
    expect(app.builderVerifyResult?.verification.fingerprint).toBe("gmail-verify-1");
    expect(app.textContent).toContain("All Passed");
    expect(findButtonByText(app, "Apply Builder Plan", { exact: true })?.disabled).toBe(false);

    clickButton(app, "Apply Builder Plan", { exact: true });
    await settle(app, 2);
    expect(app.textContent).toContain("Confirm Apply");
  });

  it("restores Gmail auth handoff after recreating the app and resumes setup", async () => {
    const app = mountApp("/builder");
    await settle(app, 3);

    const { request } = createGmailGuidedRequest();
    attachMockClient(app, request);

    const briefInput = await waitForElement<HTMLTextAreaElement>(
      app,
      ".builder-brief-field textarea",
      {
        frames: 12,
      },
    );
    expect(briefInput).not.toBeNull();
    if (!briefInput) {
      return;
    }
    changeValue(briefInput, "Create a daily Telegram briefing from my Gmail every morning at 9am.");
    await settle(app);

    clickButton(app, "Build Plan", { exact: true });
    await settle(app, 4);

    clickButton(app, "Open Gmail hook setup");
    await settle(app, 3);

    const gmailAccountInput = Array.from(
      app.querySelectorAll<HTMLInputElement>('.quick-setup__assist input[type="text"]'),
    ).find((entry) => {
      const label = entry.closest("label")?.querySelector(".quick-setup__field-label")?.textContent;
      return normalizeText(label).includes("Gmail Account");
    });
    expect(gmailAccountInput).not.toBeNull();
    if (!gmailAccountInput) {
      return;
    }
    changeValue(gmailAccountInput, "automation@example.com");
    await settle(app);

    clickButton(app, "Auto-configure Gmail hook", { exact: true });
    await settle(app, 3);

    expect(app.builderSetupResult).toEqual(
      expect.objectContaining({
        actionId: "platform:gmail-hook",
        connectorId: "platform:gmail-hook",
        status: "needs_auth",
      }),
    );

    app.remove();
    await nextFrame();

    const restoredApp = mountApp("/builder");
    await settle(restoredApp, 3);
    attachMockClient(restoredApp, request);
    await settle(restoredApp, 2);

    expect(restoredApp.builderBrief).toBe(
      "Create a daily Telegram briefing from my Gmail every morning at 9am.",
    );
    expect(restoredApp.builderSetupFocus).toEqual(
      expect.objectContaining({
        connectorId: "platform:gmail-hook",
      }),
    );
    expect(restoredApp.builderSetupInputs).toEqual(
      expect.objectContaining({
        "gmail.account": "automation@example.com",
      }),
    );
    expect(restoredApp.builderSetupResult).toEqual(
      expect.objectContaining({
        actionId: "platform:gmail-hook",
        connectorId: "platform:gmail-hook",
        status: "needs_auth",
      }),
    );
    expect(restoredApp.textContent).toContain(
      "Gmail setup needs sign-in before EasyClaw can finish the remaining steps.",
    );

    clickButton(restoredApp, "Sign in to Google Cloud", { exact: true });
    await settle(restoredApp, 3);

    clickButton(restoredApp, "Sign in to gog", { exact: true });
    await settle(restoredApp, 3);

    clickButton(restoredApp, "Retry Gmail setup", { exact: true });
    await settle(restoredApp, 4);

    expect(restoredApp.builderVerifyResult?.verification.fingerprint).toBe("gmail-verify-1");
    expect(restoredApp.textContent).toContain("All Passed");
    expect(findButtonByText(restoredApp, "Apply Builder Plan", { exact: true })?.disabled).toBe(
      false,
    );
  });

  it("drives Telegram delivery target setup until Builder unblocks apply", async () => {
    const app = mountApp("/builder");
    await settle(app, 3);

    let verifyRuns = 0;
    const request = vi.fn(async (method: string) => {
      switch (method) {
        case "agents.builder.plan":
          return createTelegramPlanResult(false);
        case "agents.builder.setup.run":
          return {
            actionId: "channel:telegram:auto-default-target",
            connectorId: "channel:telegram",
            status: "configured" as const,
            message: "Telegram default target set to -1002003004005.",
            updatedRefs: ["channels.telegram.defaultTo"],
            summary: {
              command: "getUpdates",
            },
          };
        case "config.get":
          return {
            hash: "config-hash",
            valid: true,
            config: {
              channels: {
                telegram: {
                  botToken: "telegram-token",
                  defaultTo: "-1002003004005",
                },
              },
            },
            raw: JSON.stringify(
              {
                channels: {
                  telegram: {
                    botToken: "telegram-token",
                    defaultTo: "-1002003004005",
                  },
                },
              },
              null,
              2,
            ),
            issues: [],
          };
        case "agents.builder.verify":
          verifyRuns += 1;
          return createVerifyResult(
            createTelegramPlanResult(true),
            `telegram-verify-${verifyRuns}`,
          );
        default:
          throw new Error(`Unhandled Telegram test gateway method: ${method}`);
      }
    });

    attachMockClient(app, request);

    const briefInput = await waitForElement<HTMLTextAreaElement>(
      app,
      ".builder-brief-field textarea",
      {
        frames: 12,
      },
    );
    expect(briefInput).not.toBeNull();
    if (!briefInput) {
      return;
    }
    changeValue(briefInput, "Deliver a daily briefing to my Telegram chat.");
    await settle(app);

    clickButton(app, "Build Plan", { exact: true });
    await settle(app, 4);

    clickButton(app, "Open Telegram setup");
    await settle(app, 3);

    expect(app.textContent).toContain("Auto-detect Telegram default target");
    clickButton(app, "Auto-detect default target", { exact: true });
    await settle(app, 4);

    expect(app.builderSetupResult).toEqual(
      expect.objectContaining({
        actionId: "channel:telegram:auto-default-target",
        connectorId: "channel:telegram",
        status: "configured",
      }),
    );
    expect(app.builderVerifyResult?.verification.fingerprint).toBe("telegram-verify-1");
    expect(app.textContent).toContain("All Passed");
    expect(findButtonByText(app, "Apply Builder Plan", { exact: true })?.disabled).toBe(false);

    clickButton(app, "Apply Builder Plan", { exact: true });
    await settle(app, 2);
    expect(app.textContent).toContain("Confirm Apply");
  });

  it("retries Telegram delivery setup after saving a manual default target", async () => {
    await exerciseRetryableGuidedVerificationFlow({
      planFactory: createTelegramPlanResult,
      brief: "Deliver a daily briefing to my Telegram chat.",
      initialConfigState: {
        channels: {
          telegram: {
            botToken: "",
            dmPolicy: "pairing",
            defaultTo: "",
          },
        },
      },
      openSetupLabel: "Open Telegram setup",
      openSetupIndex: 0,
      verifyButtonLabel: "Auto-detect default target",
      retryButtonLabel: "Retry Telegram target detection",
      actionId: "channel:telegram:auto-default-target",
      connectorId: "channel:telegram",
      initialFields: {
        "Bot Token": "telegram-token",
      },
      repairedFields: {
        "Default Target": "-1002003004005",
      },
      expectedVisibleText: "Auto-detect Telegram default target",
      failureMessage:
        "Telegram auto-detect found no recent chat updates. Send the bot a message or enter a default target manually.",
      failureResumeLabel: "Retry Telegram target detection",
      failureResumeDetail: "Send a message to the bot or save a default target, then retry.",
      failureSummary: {
        command: "getUpdates",
      },
      successMessage: "Telegram default target set to -1002003004005.",
      successUpdatedRefs: ["channels.telegram.defaultTo"],
      successSummary: {
        command: "getUpdates",
      },
      fingerprint: "telegram-retry-verify-1",
    });
  });

  it("uses the focused Slack credential verification flow until Builder unblocks apply", async () => {
    const app = mountApp("/builder");
    await settle(app, 3);

    let verifyRuns = 0;
    let configState: Record<string, unknown> = {
      channels: {
        slack: {
          botToken: "",
          appToken: "",
        },
      },
    };

    const request = vi.fn(async (method: string, params: unknown) => {
      switch (method) {
        case "agents.builder.plan":
          return createSlackVerifyPlanResult(false);
        case "config.get":
          return createConfigSnapshot(configState, `slack-config-${verifyRuns}`);
        case "config.set": {
          const record =
            params && typeof params === "object" && !Array.isArray(params)
              ? (params as Record<string, unknown>)
              : {};
          const raw = typeof record.raw === "string" ? record.raw : "{}";
          configState = JSON.parse(raw) as Record<string, unknown>;
          return { ok: true };
        }
        case "agents.builder.setup.run":
          return {
            actionId: "channel:slack:verify-credentials",
            connectorId: "channel:slack",
            status: "configured" as const,
            message: "Slack credentials are valid for the configured workspace.",
            updatedRefs: ["channels.slack"],
            summary: {
              command: "auth.test + apps.connections.open",
            },
          };
        case "agents.builder.verify":
          verifyRuns += 1;
          return createVerifyResult(
            createSlackVerifyPlanResult(true),
            `slack-verify-${verifyRuns}`,
          );
        default:
          throw new Error(`Unhandled Slack credential method: ${method}`);
      }
    });

    attachMockClient(app, request);

    const briefInput = await waitForElement<HTMLTextAreaElement>(
      app,
      ".builder-brief-field textarea",
      {
        frames: 12,
      },
    );
    expect(briefInput).not.toBeNull();
    if (!briefInput) {
      return;
    }
    changeValue(briefInput, "Send my daily ops summary to Slack.");
    await settle(app);

    clickButton(app, "Build Plan", { exact: true });
    await settle(app, 4);

    clickButton(app, "Open Slack setup", { index: 1 });
    await settle(app, 3);

    expect(app.textContent).toContain("Verify Slack credentials");
    expect(app.textContent).not.toContain("Auto-detect Slack default target");

    const botTokenField = findFieldByLabel<HTMLInputElement>(app, "Bot token");
    const appTokenField = findFieldByLabel<HTMLInputElement>(app, "App token");
    expect(botTokenField).not.toBeNull();
    expect(appTokenField).not.toBeNull();
    if (!botTokenField || !appTokenField) {
      return;
    }

    changeValue(botTokenField, "xoxb-test-token");
    changeValue(appTokenField, "xapp-test-token");
    await settle(app);

    clickButton(app, "Save", { exact: true });
    await settle(app, 4);

    clickButton(app, "Configure and Verify", { exact: true });
    await settle(app, 4);

    expect(app.builderSetupResult).toEqual(
      expect.objectContaining({
        actionId: "channel:slack:verify-credentials",
        connectorId: "channel:slack",
        status: "configured",
      }),
    );
    expect(app.builderVerifyResult?.verification.fingerprint).toBe("slack-verify-1");
    expect(findButtonByText(app, "Apply Builder Plan", { exact: true })?.disabled).toBe(false);
  });

  it("retries Slack credential verification after fixing the saved tokens", async () => {
    await exerciseRetryableGuidedVerificationFlow({
      planFactory: createSlackVerifyPlanResult,
      brief: "Send my daily ops summary to Slack.",
      initialConfigState: {
        channels: {
          slack: {
            botToken: "",
            appToken: "",
          },
        },
      },
      openSetupLabel: "Open Slack setup",
      verifyButtonLabel: "Configure and Verify",
      retryButtonLabel: "Verify Slack credentials",
      actionId: "channel:slack:verify-credentials",
      connectorId: "channel:slack",
      initialFields: {
        "Bot token": "xoxb-bad-token",
        "App token": "xapp-bad-token",
      },
      repairedFields: {
        "Bot token": "xoxb-test-token",
        "App token": "xapp-test-token",
      },
      expectedVisibleText: "Verify Slack credentials",
      failureMessage: "Slack credential verification failed: invalid_auth",
      failureResumeLabel: "Verify Slack credentials",
      failureResumeDetail: "Fix the Slack bot or app token and run verification again.",
      failureSummary: {
        command: "auth.test + apps.connections.open",
      },
      successMessage: "Slack credentials are valid for the configured workspace.",
      successUpdatedRefs: ["channels.slack"],
      successSummary: {
        command: "auth.test + apps.connections.open",
      },
      fingerprint: "slack-retry-verify-1",
    });
  });

  it("uses the focused Signal transport verification flow until Builder unblocks apply", async () => {
    const app = mountApp("/builder");
    await settle(app, 3);

    let verifyRuns = 0;
    let configState: Record<string, unknown> = {
      channels: {
        signal: {
          account: "",
          httpUrl: "",
        },
      },
    };

    const request = vi.fn(async (method: string, params: unknown) => {
      switch (method) {
        case "agents.builder.plan":
          return createSignalVerifyPlanResult(false);
        case "config.get":
          return createConfigSnapshot(configState, `signal-config-${verifyRuns}`);
        case "config.set": {
          const record =
            params && typeof params === "object" && !Array.isArray(params)
              ? (params as Record<string, unknown>)
              : {};
          const raw = typeof record.raw === "string" ? record.raw : "{}";
          configState = JSON.parse(raw) as Record<string, unknown>;
          return { ok: true };
        }
        case "agents.builder.setup.run":
          return {
            actionId: "channel:signal:verify-transport",
            connectorId: "channel:signal",
            status: "configured" as const,
            message: "Signal transport is reachable for the configured account.",
            updatedRefs: ["channels.signal"],
            summary: {
              command: "signal-cli version",
            },
          };
        case "agents.builder.verify":
          verifyRuns += 1;
          return createVerifyResult(
            createSignalVerifyPlanResult(true),
            `signal-verify-${verifyRuns}`,
          );
        default:
          throw new Error(`Unhandled Signal transport method: ${method}`);
      }
    });

    attachMockClient(app, request);

    const briefInput = await waitForElement<HTMLTextAreaElement>(
      app,
      ".builder-brief-field textarea",
      {
        frames: 12,
      },
    );
    expect(briefInput).not.toBeNull();
    if (!briefInput) {
      return;
    }
    changeValue(briefInput, "Send alerts through Signal.");
    await settle(app);

    clickButton(app, "Build Plan", { exact: true });
    await settle(app, 4);

    clickButton(app, "Open Signal setup", { index: 1 });
    await settle(app, 3);

    expect(app.textContent).toContain("Verify Signal transport");
    expect(app.textContent).not.toContain("Auto-detect Signal URL");

    const accountField = findFieldByLabel<HTMLInputElement>(app, "Signal account");
    const httpUrlField = findFieldByLabel<HTMLInputElement>(app, "Signal HTTP URL");
    expect(accountField).not.toBeNull();
    expect(httpUrlField).not.toBeNull();
    if (!accountField || !httpUrlField) {
      return;
    }

    changeValue(accountField, "+15551234567");
    changeValue(httpUrlField, "http://127.0.0.1:8080");
    await settle(app);

    clickButton(app, "Save", { exact: true });
    await settle(app, 4);

    clickButton(app, "Configure and Verify", { exact: true });
    await settle(app, 4);

    expect(app.builderSetupResult).toEqual(
      expect.objectContaining({
        actionId: "channel:signal:verify-transport",
        connectorId: "channel:signal",
        status: "configured",
      }),
    );
    expect(app.builderVerifyResult?.verification.fingerprint).toBe("signal-verify-1");
    expect(findButtonByText(app, "Apply Builder Plan", { exact: true })?.disabled).toBe(false);
  });

  it("retries Signal transport verification after fixing the HTTP endpoint", async () => {
    await exerciseRetryableGuidedVerificationFlow({
      planFactory: createSignalVerifyPlanResult,
      brief: "Send alerts through Signal.",
      initialConfigState: {
        channels: {
          signal: {
            account: "",
            httpUrl: "",
          },
        },
      },
      openSetupLabel: "Open Signal setup",
      verifyButtonLabel: "Configure and Verify",
      retryButtonLabel: "Verify Signal transport",
      actionId: "channel:signal:verify-transport",
      connectorId: "channel:signal",
      initialFields: {
        "Signal account": "+15551234567",
        "Signal HTTP URL": "http://127.0.0.1:9999",
      },
      repairedFields: {
        "Signal HTTP URL": "http://127.0.0.1:8080",
      },
      expectedVisibleText: "Verify Signal transport",
      failureMessage: "Signal transport verification failed: ECONNREFUSED http://127.0.0.1:9999",
      failureResumeLabel: "Verify Signal transport",
      failureResumeDetail: "Fix the Signal account or HTTP URL and run verification again.",
      failureSummary: {
        command: "signal-cli version",
      },
      successMessage: "Signal transport is reachable for the configured account.",
      successUpdatedRefs: ["channels.signal"],
      successSummary: {
        command: "signal-cli version",
      },
      fingerprint: "signal-retry-verify-1",
    });
  });

  it("uses the focused Discord token verification flow until Builder unblocks apply", async () => {
    const app = mountApp("/builder");
    await settle(app, 3);

    let verifyRuns = 0;
    let configState: Record<string, unknown> = {
      channels: {
        discord: {
          token: "",
        },
      },
    };

    const request = vi.fn(async (method: string, params: unknown) => {
      switch (method) {
        case "agents.builder.plan":
          return createDiscordVerifyPlanResult(false);
        case "config.get":
          return createConfigSnapshot(configState, `discord-config-${verifyRuns}`);
        case "config.set": {
          const record =
            params && typeof params === "object" && !Array.isArray(params)
              ? (params as Record<string, unknown>)
              : {};
          const raw = typeof record.raw === "string" ? record.raw : "{}";
          configState = JSON.parse(raw) as Record<string, unknown>;
          return { ok: true };
        }
        case "agents.builder.setup.run":
          return {
            actionId: "channel:discord:verify-token",
            connectorId: "channel:discord",
            status: "configured" as const,
            message: "Discord token is valid for the configured bot.",
            updatedRefs: ["channels.discord"],
            summary: {
              command: "GET /users/@me",
            },
          };
        case "agents.builder.verify":
          verifyRuns += 1;
          return createVerifyResult(
            createDiscordVerifyPlanResult(true),
            `discord-verify-${verifyRuns}`,
          );
        default:
          throw new Error(`Unhandled Discord verification method: ${method}`);
      }
    });

    attachMockClient(app, request);

    const briefInput = await waitForElement<HTMLTextAreaElement>(
      app,
      ".builder-brief-field textarea",
      {
        frames: 12,
      },
    );
    expect(briefInput).not.toBeNull();
    if (!briefInput) {
      return;
    }
    changeValue(briefInput, "Send release notes to Discord.");
    await settle(app);

    clickButton(app, "Build Plan", { exact: true });
    await settle(app, 4);

    clickButton(app, "Open Discord setup", { index: 1 });
    await settle(app, 3);

    expect(app.textContent).toContain("Verify Discord token");
    expect(app.textContent).not.toContain("Auto-detect Discord default target");

    const tokenField = findFieldByLabel<HTMLInputElement>(app, "Bot token");
    expect(tokenField).not.toBeNull();
    if (!tokenField) {
      return;
    }

    changeValue(tokenField, "discord-bot-token");
    await settle(app);

    clickButton(app, "Save", { exact: true });
    await settle(app, 4);

    clickButton(app, "Configure and Verify", { exact: true });
    await settle(app, 4);

    expect(app.builderSetupResult).toEqual(
      expect.objectContaining({
        actionId: "channel:discord:verify-token",
        connectorId: "channel:discord",
        status: "configured",
      }),
    );
    expect(app.builderVerifyResult?.verification.fingerprint).toBe("discord-verify-1");
    expect(findButtonByText(app, "Apply Builder Plan", { exact: true })?.disabled).toBe(false);
  });

  it("keeps Builder blocked when Discord token verification fails", async () => {
    const app = mountApp("/builder");
    await settle(app, 3);

    let configState: Record<string, unknown> = {
      channels: {
        discord: {
          token: "",
        },
      },
    };

    const request = vi.fn(async (method: string, params: unknown) => {
      switch (method) {
        case "agents.builder.plan":
          return createDiscordVerifyPlanResult(false);
        case "config.get":
          return createConfigSnapshot(configState, "discord-negative");
        case "config.set": {
          const record =
            params && typeof params === "object" && !Array.isArray(params)
              ? (params as Record<string, unknown>)
              : {};
          const raw = typeof record.raw === "string" ? record.raw : "{}";
          configState = JSON.parse(raw) as Record<string, unknown>;
          return { ok: true };
        }
        case "agents.builder.setup.run":
          return {
            actionId: "channel:discord:verify-token",
            connectorId: "channel:discord",
            status: "needs_setup" as const,
            message: "Discord token verification failed: unauthorized",
            updatedRefs: [],
            resume: {
              actionId: "channel:discord:verify-token",
              connectorId: "channel:discord",
              label: "Verify Discord token",
              detail: "Fix the Discord bot token and run verification again.",
              inputs: {},
            },
          };
        case "agents.builder.verify":
          throw new Error("Discord verify should not rerun after a failed token check");
        default:
          throw new Error(`Unhandled Discord negative verification method: ${method}`);
      }
    });

    attachMockClient(app, request);

    const briefInput = await waitForElement<HTMLTextAreaElement>(
      app,
      ".builder-brief-field textarea",
      {
        frames: 12,
      },
    );
    expect(briefInput).not.toBeNull();
    if (!briefInput) {
      return;
    }
    changeValue(briefInput, "Send release notes to Discord.");
    await settle(app);

    clickButton(app, "Build Plan", { exact: true });
    await settle(app, 4);

    clickButton(app, "Open Discord setup", { index: 1 });
    await settle(app, 3);

    const tokenField = findFieldByLabel<HTMLInputElement>(app, "Bot token");
    expect(tokenField).not.toBeNull();
    if (!tokenField) {
      return;
    }

    changeValue(tokenField, "bad-discord-token");
    await settle(app);

    clickButton(app, "Save", { exact: true });
    await settle(app, 4);

    clickButton(app, "Configure and Verify", { exact: true });
    await settle(app, 4);

    expect(app.builderSetupResult).toEqual(
      expect.objectContaining({
        actionId: "channel:discord:verify-token",
        connectorId: "channel:discord",
        status: "needs_setup",
      }),
    );
    expect(app.builderVerifyResult).toBeNull();
    expect(app.textContent).toContain("Discord token verification failed: unauthorized");
    expect(app.textContent).toContain("Verify Discord token");
    expectApplyBlocked(app);
  });

  it("retries Discord token verification after fixing the bot token", async () => {
    await exerciseRetryableGuidedVerificationFlow({
      planFactory: createDiscordVerifyPlanResult,
      brief: "Send release notes to Discord.",
      initialConfigState: {
        channels: {
          discord: {
            token: "",
          },
        },
      },
      openSetupLabel: "Open Discord setup",
      verifyButtonLabel: "Configure and Verify",
      actionId: "channel:discord:verify-token",
      connectorId: "channel:discord",
      initialFields: {
        "Bot token": "bad-discord-token",
      },
      repairedFields: {
        "Bot token": "discord-bot-token",
      },
      expectedVisibleText: "Verify Discord token",
      failureMessage: "Discord token verification failed: unauthorized",
      failureResumeLabel: "Verify Discord token",
      failureResumeDetail: "Fix the Discord bot token and run verification again.",
      failureSummary: {
        command: "GET /users/@me",
      },
      successMessage: "Discord credentials are valid for the configured bot.",
      successUpdatedRefs: ["channels.discord"],
      successSummary: {
        command: "GET /users/@me",
      },
      fingerprint: "discord-retry-verify-1",
    });
  });

  it("uses the guided Google Chat auth verification flow until Builder unblocks apply", async () => {
    const app = mountApp("/builder");
    await settle(app, 3);

    let verifyRuns = 0;
    let configState: Record<string, unknown> = {
      channels: {
        googlechat: {
          serviceAccount: "",
          audienceType: "",
          audience: "",
        },
      },
    };

    const request = vi.fn(async (method: string, params: unknown) => {
      switch (method) {
        case "agents.builder.plan":
          return createGoogleChatVerifyPlanResult(false);
        case "config.get":
          return createConfigSnapshot(configState, `googlechat-config-${verifyRuns}`);
        case "config.set": {
          const record =
            params && typeof params === "object" && !Array.isArray(params)
              ? (params as Record<string, unknown>)
              : {};
          const raw = typeof record.raw === "string" ? record.raw : "{}";
          configState = JSON.parse(raw) as Record<string, unknown>;
          return { ok: true };
        }
        case "agents.builder.setup.run":
          return {
            actionId: "channel:googlechat:verify-auth",
            connectorId: "channel:googlechat",
            status: "configured" as const,
            message: "Google Chat credentials are valid for the configured account.",
            updatedRefs: ["channels.googlechat"],
            summary: {
              command: "GET /v1/spaces?pageSize=1",
            },
          };
        case "agents.builder.verify":
          verifyRuns += 1;
          return createVerifyResult(
            createGoogleChatVerifyPlanResult(true),
            `googlechat-verify-${verifyRuns}`,
          );
        default:
          throw new Error(`Unhandled Google Chat verification method: ${method}`);
      }
    });

    attachMockClient(app, request);

    const briefInput = await waitForElement<HTMLTextAreaElement>(
      app,
      ".builder-brief-field textarea",
      {
        frames: 12,
      },
    );
    expect(briefInput).not.toBeNull();
    if (!briefInput) {
      return;
    }
    changeValue(briefInput, "Send deployment updates to Google Chat.");
    await settle(app);

    clickButton(app, "Build Plan", { exact: true });
    await settle(app, 4);

    clickButton(app, "Open Google Chat setup", { index: 1 });
    await settle(app, 3);

    expect(app.textContent).toContain("Verify Google Chat auth");

    const serviceAccountField = findFieldByLabel<HTMLInputElement>(app, "Service Account JSON");
    const audienceTypeField = findFieldByLabel<HTMLSelectElement>(app, "Audience Type");
    const audienceField = findFieldByLabel<HTMLInputElement>(app, "Audience");
    expect(serviceAccountField).not.toBeNull();
    expect(audienceTypeField).not.toBeNull();
    expect(audienceField).not.toBeNull();
    if (!serviceAccountField || !audienceTypeField || !audienceField) {
      return;
    }

    changeValue(
      serviceAccountField,
      '{"type":"service_account","client_email":"bot@example.iam.gserviceaccount.com"}',
    );
    changeValue(audienceTypeField, "app-url");
    changeValue(audienceField, "https://chat.googleapis.com/");
    await settle(app);

    clickButton(app, "Save", { exact: true });
    await settle(app, 4);

    clickButton(app, "Verify Google Chat auth", { exact: true });
    await settle(app, 4);

    expect(app.builderSetupResult).toEqual(
      expect.objectContaining({
        actionId: "channel:googlechat:verify-auth",
        connectorId: "channel:googlechat",
        status: "configured",
      }),
    );
    expect(app.builderVerifyResult?.verification.fingerprint).toBe("googlechat-verify-1");
    expect(findButtonByText(app, "Apply Builder Plan", { exact: true })?.disabled).toBe(false);
  });

  it("keeps Builder blocked when Google Chat webhook auth is incomplete", async () => {
    const app = mountApp("/builder");
    await settle(app, 3);

    let configState: Record<string, unknown> = {
      channels: {
        googlechat: {
          serviceAccount: "",
          audienceType: "",
          audience: "",
        },
      },
    };

    const request = vi.fn(async (method: string, params: unknown) => {
      switch (method) {
        case "agents.builder.plan":
          return createGoogleChatVerifyPlanResult(false);
        case "config.get":
          return createConfigSnapshot(configState, "googlechat-negative");
        case "config.set": {
          const record =
            params && typeof params === "object" && !Array.isArray(params)
              ? (params as Record<string, unknown>)
              : {};
          const raw = typeof record.raw === "string" ? record.raw : "{}";
          configState = JSON.parse(raw) as Record<string, unknown>;
          return { ok: true };
        }
        case "agents.builder.setup.run":
          return {
            actionId: "channel:googlechat:verify-auth",
            connectorId: "channel:googlechat",
            status: "needs_setup" as const,
            message: "Google Chat API auth is valid, but webhook auth fields are incomplete.",
            updatedRefs: [],
            resume: {
              actionId: "channel:googlechat:verify-auth",
              connectorId: "channel:googlechat",
              label: "Verify Google Chat auth",
              detail: "After setting audienceType and audience, run verification again.",
              inputs: {},
            },
          };
        case "agents.builder.verify":
          throw new Error("Google Chat verify should not rerun after incomplete webhook auth");
        default:
          throw new Error(`Unhandled Google Chat negative verification method: ${method}`);
      }
    });

    attachMockClient(app, request);

    const briefInput = await waitForElement<HTMLTextAreaElement>(
      app,
      ".builder-brief-field textarea",
      {
        frames: 12,
      },
    );
    expect(briefInput).not.toBeNull();
    if (!briefInput) {
      return;
    }
    changeValue(briefInput, "Send deployment updates to Google Chat.");
    await settle(app);

    clickButton(app, "Build Plan", { exact: true });
    await settle(app, 4);

    clickButton(app, "Open Google Chat setup", { index: 1 });
    await settle(app, 3);

    const serviceAccountField = findFieldByLabel<HTMLInputElement>(app, "Service Account JSON");
    expect(serviceAccountField).not.toBeNull();
    if (!serviceAccountField) {
      return;
    }

    changeValue(
      serviceAccountField,
      '{"type":"service_account","client_email":"bot@example.iam.gserviceaccount.com"}',
    );
    await settle(app);

    clickButton(app, "Save", { exact: true });
    await settle(app, 4);

    clickButton(app, "Verify Google Chat auth", { exact: true });
    await settle(app, 4);

    expect(app.builderSetupResult).toEqual(
      expect.objectContaining({
        actionId: "channel:googlechat:verify-auth",
        connectorId: "channel:googlechat",
        status: "needs_setup",
      }),
    );
    expect(app.builderVerifyResult).toBeNull();
    expect(app.textContent).toContain(
      "Google Chat API auth is valid, but webhook auth fields are incomplete.",
    );
    expect(app.textContent).toContain("Verify Google Chat auth");
    expectApplyBlocked(app);
  });

  it("retries Google Chat auth verification after completing webhook auth", async () => {
    await exerciseRetryableGuidedVerificationFlow({
      planFactory: createGoogleChatVerifyPlanResult,
      brief: "Send deployment updates to Google Chat.",
      initialConfigState: {
        channels: {
          googlechat: {
            serviceAccount: "",
            audienceType: "",
            audience: "",
          },
        },
      },
      openSetupLabel: "Open Google Chat setup",
      verifyButtonLabel: "Verify Google Chat auth",
      actionId: "channel:googlechat:verify-auth",
      connectorId: "channel:googlechat",
      initialFields: {
        "Service Account JSON":
          '{"type":"service_account","client_email":"bot@example.iam.gserviceaccount.com"}',
      },
      repairedFields: {
        "Audience Type": "app-url",
        Audience: "https://chat.googleapis.com/",
      },
      expectedVisibleText: "Verify Google Chat auth",
      failureMessage: "Google Chat API auth is valid, but webhook auth fields are incomplete.",
      failureResumeLabel: "Verify Google Chat auth",
      failureResumeDetail: "After setting audienceType and audience, run verification again.",
      failureSummary: {
        command: "GET /v1/spaces?pageSize=1",
      },
      successMessage: "Google Chat credentials are valid for the configured account.",
      successUpdatedRefs: ["channels.googlechat"],
      successSummary: {
        command: "GET /v1/spaces?pageSize=1",
      },
      fingerprint: "googlechat-retry-verify-1",
    });
  });

  it("uses the guided Matrix credential verification flow until Builder unblocks apply", async () => {
    const app = mountApp("/builder");
    await settle(app, 3);

    let verifyRuns = 0;
    let configState: Record<string, unknown> = {
      channels: {
        matrix: {
          homeserver: "",
          userId: "",
          accessToken: "",
        },
      },
    };

    const request = vi.fn(async (method: string, params: unknown) => {
      switch (method) {
        case "agents.builder.plan":
          return createMatrixVerifyPlanResult(false);
        case "config.get":
          return createConfigSnapshot(configState, `matrix-config-${verifyRuns}`);
        case "config.set": {
          const record =
            params && typeof params === "object" && !Array.isArray(params)
              ? (params as Record<string, unknown>)
              : {};
          const raw = typeof record.raw === "string" ? record.raw : "{}";
          configState = JSON.parse(raw) as Record<string, unknown>;
          return { ok: true };
        }
        case "agents.builder.setup.run":
          return {
            actionId: "channel:matrix:verify-credentials",
            connectorId: "channel:matrix",
            status: "configured" as const,
            message: "Matrix credentials are valid for the configured account.",
            updatedRefs: ["channels.matrix"],
            summary: {
              command: "whoami",
            },
          };
        case "agents.builder.verify":
          verifyRuns += 1;
          return createVerifyResult(
            createMatrixVerifyPlanResult(true),
            `matrix-verify-${verifyRuns}`,
          );
        default:
          throw new Error(`Unhandled Matrix verification method: ${method}`);
      }
    });

    attachMockClient(app, request);

    const briefInput = await waitForElement<HTMLTextAreaElement>(
      app,
      ".builder-brief-field textarea",
      {
        frames: 12,
      },
    );
    expect(briefInput).not.toBeNull();
    if (!briefInput) {
      return;
    }
    changeValue(briefInput, "Send deployment updates to Matrix.");
    await settle(app);

    clickButton(app, "Build Plan", { exact: true });
    await settle(app, 4);

    clickButton(app, "Open Matrix setup", { index: 1 });
    await settle(app, 3);

    expect(app.textContent).toContain("Verify Matrix credentials");

    const homeserverField = findFieldByLabel<HTMLInputElement>(app, "Homeserver");
    const userIdField = findFieldByLabel<HTMLInputElement>(app, "User ID");
    const accessTokenField = findFieldByLabel<HTMLInputElement>(app, "Access Token");
    expect(homeserverField).not.toBeNull();
    expect(userIdField).not.toBeNull();
    expect(accessTokenField).not.toBeNull();
    if (!homeserverField || !userIdField || !accessTokenField) {
      return;
    }

    changeValue(homeserverField, "https://matrix.org");
    changeValue(userIdField, "@bot:matrix.org");
    changeValue(accessTokenField, "syt_test_token");
    await settle(app);

    clickButton(app, "Save", { exact: true });
    await settle(app, 4);

    clickButton(app, "Verify Matrix credentials", { exact: true });
    await settle(app, 4);

    expect(app.builderSetupResult).toEqual(
      expect.objectContaining({
        actionId: "channel:matrix:verify-credentials",
        connectorId: "channel:matrix",
        status: "configured",
      }),
    );
    expect(app.builderVerifyResult?.verification.fingerprint).toBe("matrix-verify-1");
    expect(findButtonByText(app, "Apply Builder Plan", { exact: true })?.disabled).toBe(false);
  });

  it("keeps Builder blocked when Matrix credential verification fails", async () => {
    const app = mountApp("/builder");
    await settle(app, 3);

    let configState: Record<string, unknown> = {
      channels: {
        matrix: {
          homeserver: "",
          userId: "",
          accessToken: "",
        },
      },
    };

    const request = vi.fn(async (method: string, params: unknown) => {
      switch (method) {
        case "agents.builder.plan":
          return createMatrixVerifyPlanResult(false);
        case "config.get":
          return createConfigSnapshot(configState, "matrix-negative");
        case "config.set": {
          const record =
            params && typeof params === "object" && !Array.isArray(params)
              ? (params as Record<string, unknown>)
              : {};
          const raw = typeof record.raw === "string" ? record.raw : "{}";
          configState = JSON.parse(raw) as Record<string, unknown>;
          return { ok: true };
        }
        case "agents.builder.setup.run":
          return {
            actionId: "channel:matrix:verify-credentials",
            connectorId: "channel:matrix",
            status: "needs_setup" as const,
            message: "Matrix credential verification failed: M_FORBIDDEN",
            updatedRefs: [],
            resume: {
              actionId: "channel:matrix:verify-credentials",
              connectorId: "channel:matrix",
              label: "Verify Matrix credentials",
              detail: "Fix the Matrix homeserver or token and run verification again.",
              inputs: {},
            },
          };
        case "agents.builder.verify":
          throw new Error("Matrix verify should not rerun after invalid credentials");
        default:
          throw new Error(`Unhandled Matrix negative verification method: ${method}`);
      }
    });

    attachMockClient(app, request);

    const briefInput = await waitForElement<HTMLTextAreaElement>(
      app,
      ".builder-brief-field textarea",
      {
        frames: 12,
      },
    );
    expect(briefInput).not.toBeNull();
    if (!briefInput) {
      return;
    }
    changeValue(briefInput, "Send deployment updates to Matrix.");
    await settle(app);

    clickButton(app, "Build Plan", { exact: true });
    await settle(app, 4);

    clickButton(app, "Open Matrix setup", { index: 1 });
    await settle(app, 3);

    const homeserverField = findFieldByLabel<HTMLInputElement>(app, "Homeserver");
    const userIdField = findFieldByLabel<HTMLInputElement>(app, "User ID");
    const accessTokenField = findFieldByLabel<HTMLInputElement>(app, "Access Token");
    expect(homeserverField).not.toBeNull();
    expect(userIdField).not.toBeNull();
    expect(accessTokenField).not.toBeNull();
    if (!homeserverField || !userIdField || !accessTokenField) {
      return;
    }

    changeValue(homeserverField, "https://matrix.org");
    changeValue(userIdField, "@bot:matrix.org");
    changeValue(accessTokenField, "bad-matrix-token");
    await settle(app);

    clickButton(app, "Save", { exact: true });
    await settle(app, 4);

    clickButton(app, "Verify Matrix credentials", { exact: true });
    await settle(app, 4);

    expect(app.builderSetupResult).toEqual(
      expect.objectContaining({
        actionId: "channel:matrix:verify-credentials",
        connectorId: "channel:matrix",
        status: "needs_setup",
      }),
    );
    expect(app.builderVerifyResult).toBeNull();
    expect(app.textContent).toContain("Matrix credential verification failed: M_FORBIDDEN");
    expect(app.textContent).toContain("Verify Matrix credentials");
    expectApplyBlocked(app);
  });

  it("retries Matrix credential verification after fixing the access token", async () => {
    await exerciseRetryableGuidedVerificationFlow({
      planFactory: createMatrixVerifyPlanResult,
      brief: "Send deployment updates to Matrix.",
      initialConfigState: {
        channels: {
          matrix: {
            homeserver: "",
            userId: "",
            accessToken: "",
          },
        },
      },
      openSetupLabel: "Open Matrix setup",
      verifyButtonLabel: "Verify Matrix credentials",
      actionId: "channel:matrix:verify-credentials",
      connectorId: "channel:matrix",
      initialFields: {
        Homeserver: "https://matrix.org",
        "User ID": "@bot:matrix.org",
        "Access Token": "bad-matrix-token",
      },
      repairedFields: {
        "Access Token": "syt_test_token",
      },
      expectedVisibleText: "Verify Matrix credentials",
      failureMessage: "Matrix credential verification failed: M_FORBIDDEN",
      failureResumeLabel: "Verify Matrix credentials",
      failureResumeDetail: "Fix the Matrix homeserver or token and run verification again.",
      failureSummary: {
        command: "whoami",
      },
      successMessage: "Matrix credentials are valid for the configured account.",
      successUpdatedRefs: ["channels.matrix"],
      successSummary: {
        command: "whoami",
      },
      fingerprint: "matrix-retry-verify-1",
    });
  });

  it("uses the guided Teams credential verification flow until Builder unblocks apply", async () => {
    const app = mountApp("/builder");
    await settle(app, 3);

    let verifyRuns = 0;
    let configState: Record<string, unknown> = {
      channels: {
        msteams: {
          appId: "",
          appPassword: "",
          tenantId: "",
        },
      },
    };

    const request = vi.fn(async (method: string, params: unknown) => {
      switch (method) {
        case "agents.builder.plan":
          return createMSTeamsVerifyPlanResult(false);
        case "config.get":
          return createConfigSnapshot(configState, `msteams-config-${verifyRuns}`);
        case "config.set": {
          const record =
            params && typeof params === "object" && !Array.isArray(params)
              ? (params as Record<string, unknown>)
              : {};
          const raw = typeof record.raw === "string" ? record.raw : "{}";
          configState = JSON.parse(raw) as Record<string, unknown>;
          return { ok: true };
        }
        case "agents.builder.setup.run":
          return {
            actionId: "channel:msteams:verify-credentials",
            connectorId: "channel:msteams",
            status: "configured" as const,
            message: "Microsoft Teams credentials are valid for the configured bot.",
            updatedRefs: ["channels.msteams"],
            summary: {
              command: "Bot Framework token + Graph token",
            },
          };
        case "agents.builder.verify":
          verifyRuns += 1;
          return createVerifyResult(
            createMSTeamsVerifyPlanResult(true),
            `msteams-verify-${verifyRuns}`,
          );
        default:
          throw new Error(`Unhandled Teams verification method: ${method}`);
      }
    });

    attachMockClient(app, request);

    const briefInput = await waitForElement<HTMLTextAreaElement>(
      app,
      ".builder-brief-field textarea",
      {
        frames: 12,
      },
    );
    expect(briefInput).not.toBeNull();
    if (!briefInput) {
      return;
    }
    changeValue(briefInput, "Send deployment updates to Microsoft Teams.");
    await settle(app);

    clickButton(app, "Build Plan", { exact: true });
    await settle(app, 4);

    clickButton(app, "Open Microsoft Teams setup", { index: 1 });
    await settle(app, 3);

    expect(app.textContent).toContain("Verify Teams credentials");

    const appIdField = findFieldByLabel<HTMLInputElement>(app, "App ID");
    const appPasswordField = findFieldByLabel<HTMLInputElement>(app, "App Password");
    const tenantIdField = findFieldByLabel<HTMLInputElement>(app, "Tenant ID");
    expect(appIdField).not.toBeNull();
    expect(appPasswordField).not.toBeNull();
    expect(tenantIdField).not.toBeNull();
    if (!appIdField || !appPasswordField || !tenantIdField) {
      return;
    }

    changeValue(appIdField, "00000000-0000-0000-0000-000000000000");
    changeValue(appPasswordField, "teams-secret");
    changeValue(tenantIdField, "common");
    await settle(app);

    clickButton(app, "Save", { exact: true });
    await settle(app, 4);

    clickButton(app, "Verify Teams credentials", { exact: true });
    await settle(app, 4);

    expect(app.builderSetupResult).toEqual(
      expect.objectContaining({
        actionId: "channel:msteams:verify-credentials",
        connectorId: "channel:msteams",
        status: "configured",
      }),
    );
    expect(app.builderVerifyResult?.verification.fingerprint).toBe("msteams-verify-1");
    expect(findButtonByText(app, "Apply Builder Plan", { exact: true })?.disabled).toBe(false);
  });

  it("keeps Builder blocked when Teams credential verification fails", async () => {
    const app = mountApp("/builder");
    await settle(app, 3);

    let configState: Record<string, unknown> = {
      channels: {
        msteams: {
          appId: "",
          appPassword: "",
          tenantId: "",
        },
      },
    };

    const request = vi.fn(async (method: string, params: unknown) => {
      switch (method) {
        case "agents.builder.plan":
          return createMSTeamsVerifyPlanResult(false);
        case "config.get":
          return createConfigSnapshot(configState, "msteams-negative");
        case "config.set": {
          const record =
            params && typeof params === "object" && !Array.isArray(params)
              ? (params as Record<string, unknown>)
              : {};
          const raw = typeof record.raw === "string" ? record.raw : "{}";
          configState = JSON.parse(raw) as Record<string, unknown>;
          return { ok: true };
        }
        case "agents.builder.setup.run":
          return {
            actionId: "channel:msteams:verify-credentials",
            connectorId: "channel:msteams",
            status: "needs_setup" as const,
            message: "Microsoft Teams credential verification failed: AADSTS7000215",
            updatedRefs: [],
            resume: {
              actionId: "channel:msteams:verify-credentials",
              connectorId: "channel:msteams",
              label: "Verify Teams credentials",
              detail: "Fix appId, appPassword, or tenantId and run verification again.",
              inputs: {},
            },
          };
        case "agents.builder.verify":
          throw new Error("Teams verify should not rerun after invalid credentials");
        default:
          throw new Error(`Unhandled Teams negative verification method: ${method}`);
      }
    });

    attachMockClient(app, request);

    const briefInput = await waitForElement<HTMLTextAreaElement>(
      app,
      ".builder-brief-field textarea",
      {
        frames: 12,
      },
    );
    expect(briefInput).not.toBeNull();
    if (!briefInput) {
      return;
    }
    changeValue(briefInput, "Send deployment updates to Microsoft Teams.");
    await settle(app);

    clickButton(app, "Build Plan", { exact: true });
    await settle(app, 4);

    clickButton(app, "Open Microsoft Teams setup", { index: 1 });
    await settle(app, 3);

    const appIdField = findFieldByLabel<HTMLInputElement>(app, "App ID");
    const appPasswordField = findFieldByLabel<HTMLInputElement>(app, "App Password");
    const tenantIdField = findFieldByLabel<HTMLInputElement>(app, "Tenant ID");
    expect(appIdField).not.toBeNull();
    expect(appPasswordField).not.toBeNull();
    expect(tenantIdField).not.toBeNull();
    if (!appIdField || !appPasswordField || !tenantIdField) {
      return;
    }

    changeValue(appIdField, "00000000-0000-0000-0000-000000000000");
    changeValue(appPasswordField, "bad-secret");
    changeValue(tenantIdField, "common");
    await settle(app);

    clickButton(app, "Save", { exact: true });
    await settle(app, 4);

    clickButton(app, "Verify Teams credentials", { exact: true });
    await settle(app, 4);

    expect(app.builderSetupResult).toEqual(
      expect.objectContaining({
        actionId: "channel:msteams:verify-credentials",
        connectorId: "channel:msteams",
        status: "needs_setup",
      }),
    );
    expect(app.builderVerifyResult).toBeNull();
    expect(app.textContent).toContain(
      "Microsoft Teams credential verification failed: AADSTS7000215",
    );
    expect(app.textContent).toContain("Verify Teams credentials");
    expectApplyBlocked(app);
  });

  it("retries Teams credential verification after fixing the app password", async () => {
    await exerciseRetryableGuidedVerificationFlow({
      planFactory: createMSTeamsVerifyPlanResult,
      brief: "Send deployment updates to Microsoft Teams.",
      initialConfigState: {
        channels: {
          msteams: {
            appId: "",
            appPassword: "",
            tenantId: "",
          },
        },
      },
      openSetupLabel: "Open Microsoft Teams setup",
      verifyButtonLabel: "Verify Teams credentials",
      actionId: "channel:msteams:verify-credentials",
      connectorId: "channel:msteams",
      initialFields: {
        "App ID": "00000000-0000-0000-0000-000000000000",
        "App Password": "bad-secret",
        "Tenant ID": "common",
      },
      repairedFields: {
        "App Password": "teams-secret",
      },
      expectedVisibleText: "Verify Teams credentials",
      failureMessage: "Microsoft Teams credential verification failed: AADSTS7000215",
      failureResumeLabel: "Verify Teams credentials",
      failureResumeDetail: "Fix appId, appPassword, or tenantId and run verification again.",
      failureSummary: {
        command: "Bot Framework token + Graph token",
      },
      successMessage: "Microsoft Teams credentials are valid for the configured bot.",
      successUpdatedRefs: ["channels.msteams"],
      successSummary: {
        command: "Bot Framework token + Graph token",
      },
      fingerprint: "msteams-retry-verify-1",
    });
  });

  it("uses the guided iMessage transport verification flow until Builder unblocks apply", async () => {
    const app = mountApp("/builder");
    await settle(app, 3);

    let verifyRuns = 0;
    let configState: Record<string, unknown> = {
      channels: {
        imessage: {
          enabled: false,
          cliPath: "",
        },
      },
    };

    const request = vi.fn(async (method: string, params: unknown) => {
      switch (method) {
        case "agents.builder.plan":
          return createIMessageVerifyPlanResult(false);
        case "config.get":
          return createConfigSnapshot(configState, `imessage-config-${verifyRuns}`);
        case "config.set": {
          const record =
            params && typeof params === "object" && !Array.isArray(params)
              ? (params as Record<string, unknown>)
              : {};
          const raw = typeof record.raw === "string" ? record.raw : "{}";
          configState = JSON.parse(raw) as Record<string, unknown>;
          return { ok: true };
        }
        case "agents.builder.setup.run":
          return {
            actionId: "channel:imessage:verify-transport",
            connectorId: "channel:imessage",
            status: "configured" as const,
            message: "iMessage transport is reachable on this macOS host.",
            updatedRefs: ["channels.imessage"],
            summary: {
              command: "imsg rpc --help + chats.list",
            },
          };
        case "agents.builder.verify":
          verifyRuns += 1;
          return createVerifyResult(
            createIMessageVerifyPlanResult(true),
            `imessage-verify-${verifyRuns}`,
          );
        default:
          throw new Error(`Unhandled iMessage verification method: ${method}`);
      }
    });

    attachMockClient(app, request);

    const briefInput = await waitForElement<HTMLTextAreaElement>(
      app,
      ".builder-brief-field textarea",
      {
        frames: 12,
      },
    );
    expect(briefInput).not.toBeNull();
    if (!briefInput) {
      return;
    }
    changeValue(briefInput, "Send deployment updates to iMessage.");
    await settle(app);

    clickButton(app, "Build Plan", { exact: true });
    await settle(app, 4);

    clickButton(app, "Open iMessage setup", { index: 1 });
    await settle(app, 3);

    expect(app.textContent).toContain("Verify iMessage transport");

    const enabledField = findFieldByLabel<HTMLSelectElement>(app, "Enabled");
    const cliPathField = findFieldByLabel<HTMLInputElement>(app, "imsg CLI Path");
    expect(enabledField).not.toBeNull();
    expect(cliPathField).not.toBeNull();
    if (!enabledField || !cliPathField) {
      return;
    }

    changeValue(enabledField, "true");
    changeValue(cliPathField, "imsg");
    await settle(app);

    clickButton(app, "Save", { exact: true });
    await settle(app, 4);

    clickButton(app, "Verify iMessage transport", { exact: true });
    await settle(app, 4);

    expect(app.builderSetupResult).toEqual(
      expect.objectContaining({
        actionId: "channel:imessage:verify-transport",
        connectorId: "channel:imessage",
        status: "configured",
      }),
    );
    expect(app.builderVerifyResult?.verification.fingerprint).toBe("imessage-verify-1");
    expect(findButtonByText(app, "Apply Builder Plan", { exact: true })?.disabled).toBe(false);
  });

  it("keeps Builder blocked when iMessage transport verification fails", async () => {
    const app = mountApp("/builder");
    await settle(app, 3);

    let configState: Record<string, unknown> = {
      channels: {
        imessage: {
          enabled: false,
          cliPath: "",
        },
      },
    };

    const request = vi.fn(async (method: string, params: unknown) => {
      switch (method) {
        case "agents.builder.plan":
          return createIMessageVerifyPlanResult(false);
        case "config.get":
          return createConfigSnapshot(configState, "imessage-negative");
        case "config.set": {
          const record =
            params && typeof params === "object" && !Array.isArray(params)
              ? (params as Record<string, unknown>)
              : {};
          const raw = typeof record.raw === "string" ? record.raw : "{}";
          configState = JSON.parse(raw) as Record<string, unknown>;
          return { ok: true };
        }
        case "agents.builder.setup.run":
          return {
            actionId: "channel:imessage:verify-transport",
            connectorId: "channel:imessage",
            status: "needs_setup" as const,
            message: "iMessage transport verification failed: imsg rpc unavailable",
            updatedRefs: [],
            resume: {
              actionId: "channel:imessage:verify-transport",
              connectorId: "channel:imessage",
              label: "Verify iMessage transport",
              detail: "Fix local imsg access and run verification again.",
              inputs: {},
            },
          };
        case "agents.builder.verify":
          throw new Error("iMessage verify should not rerun after transport failure");
        default:
          throw new Error(`Unhandled iMessage negative verification method: ${method}`);
      }
    });

    attachMockClient(app, request);

    const briefInput = await waitForElement<HTMLTextAreaElement>(
      app,
      ".builder-brief-field textarea",
      {
        frames: 12,
      },
    );
    expect(briefInput).not.toBeNull();
    if (!briefInput) {
      return;
    }
    changeValue(briefInput, "Send deployment updates to iMessage.");
    await settle(app);

    clickButton(app, "Build Plan", { exact: true });
    await settle(app, 4);

    clickButton(app, "Open iMessage setup", { index: 1 });
    await settle(app, 3);

    const enabledField = findFieldByLabel<HTMLSelectElement>(app, "Enabled");
    const cliPathField = findFieldByLabel<HTMLInputElement>(app, "imsg CLI Path");
    expect(enabledField).not.toBeNull();
    expect(cliPathField).not.toBeNull();
    if (!enabledField || !cliPathField) {
      return;
    }

    changeValue(enabledField, "true");
    changeValue(cliPathField, "imsg");
    await settle(app);

    clickButton(app, "Save", { exact: true });
    await settle(app, 4);

    clickButton(app, "Verify iMessage transport", { exact: true });
    await settle(app, 4);

    expect(app.builderSetupResult).toEqual(
      expect.objectContaining({
        actionId: "channel:imessage:verify-transport",
        connectorId: "channel:imessage",
        status: "needs_setup",
      }),
    );
    expect(app.builderVerifyResult).toBeNull();
    expect(app.textContent).toContain(
      "iMessage transport verification failed: imsg rpc unavailable",
    );
    expect(app.textContent).toContain("Verify iMessage transport");
    expectApplyBlocked(app);
  });

  it("retries iMessage transport verification after fixing the CLI path", async () => {
    await exerciseRetryableGuidedVerificationFlow({
      planFactory: createIMessageVerifyPlanResult,
      brief: "Send deployment updates to iMessage.",
      initialConfigState: {
        channels: {
          imessage: {
            enabled: false,
            cliPath: "",
          },
        },
      },
      openSetupLabel: "Open iMessage setup",
      verifyButtonLabel: "Verify iMessage transport",
      actionId: "channel:imessage:verify-transport",
      connectorId: "channel:imessage",
      initialFields: {
        Enabled: "true",
        "imsg CLI Path": "missing-imsg",
      },
      repairedFields: {
        "imsg CLI Path": "imsg",
      },
      expectedVisibleText: "Verify iMessage transport",
      failureMessage: "iMessage transport verification failed: imsg rpc unavailable",
      failureResumeLabel: "Verify iMessage transport",
      failureResumeDetail: "Fix local imsg access and run verification again.",
      failureSummary: {
        command: "imsg rpc --help + chats.list",
      },
      successMessage: "iMessage transport is reachable on this macOS host.",
      successUpdatedRefs: ["channels.imessage"],
      successSummary: {
        command: "imsg rpc --help + chats.list",
      },
      fingerprint: "imessage-retry-verify-1",
    });
  });

  it("drives WhatsApp pairing and destination setup until Builder unblocks apply", async () => {
    const app = mountApp("/builder");
    await settle(app, 3);

    let whatsappConnected = false;
    let autoTargetCalls = 0;
    let verifyRuns = 0;

    const request = vi.fn(async (method: string, params: unknown) => {
      switch (method) {
        case "agents.builder.plan":
          return createWhatsAppPlanResult(false);
        case "web.login.start":
          return {
            message: "Scan this QR code with WhatsApp.",
            qrDataUrl: "data:image/png;base64,whatsapp-qr",
          };
        case "web.login.wait":
          whatsappConnected = true;
          return {
            message: "Linked.",
            connected: true,
          };
        case "channels.status":
          return {
            channelAccounts: {
              whatsapp: [
                {
                  connected: whatsappConnected,
                  linked: whatsappConnected,
                  running: whatsappConnected,
                  lastError: null,
                  probe: {
                    ok: whatsappConnected,
                  },
                },
              ],
            },
          };
        case "agents.builder.setup.run": {
          autoTargetCalls += 1;
          const record =
            params && typeof params === "object" && !Array.isArray(params)
              ? (params as Record<string, unknown>)
              : {};
          const hasActionId = typeof record.actionId === "string";
          const inputs =
            record.inputs && typeof record.inputs === "object" && !Array.isArray(record.inputs)
              ? (record.inputs as Record<string, unknown>)
              : {};
          const manualTarget =
            typeof inputs["whatsapp.target"] === "string" ? inputs["whatsapp.target"] : "";
          if (!hasActionId) {
            return {
              connectorId: "channel:whatsapp:auto-default-target",
              status: "configured" as const,
              message: "WhatsApp default target set to +15551234567.",
              updatedRefs: [],
            };
          }
          return {
            actionId: "channel:whatsapp:auto-default-target",
            connectorId: "channel:whatsapp",
            status: "configured" as const,
            message: manualTarget
              ? `WhatsApp default target set to ${manualTarget}.`
              : "WhatsApp default target set to +15551234567.",
            updatedRefs: ["channels.whatsapp.defaultTo"],
          };
        }
        case "config.get":
          return {
            hash: "config-hash",
            valid: true,
            config: {
              channels: {
                whatsapp: {
                  defaultTo: "+14155551234",
                },
              },
            },
            raw: JSON.stringify(
              {
                channels: {
                  whatsapp: {
                    defaultTo: "+14155551234",
                  },
                },
              },
              null,
              2,
            ),
            issues: [],
          };
        case "agents.builder.verify":
          verifyRuns += 1;
          return createVerifyResult(
            createWhatsAppPlanResult(true),
            `whatsapp-verify-${verifyRuns}`,
          );
        default:
          throw new Error(`Unhandled WhatsApp test gateway method: ${method}`);
      }
    });

    attachMockClient(app, request);

    const briefInput = await waitForElement<HTMLTextAreaElement>(
      app,
      ".builder-brief-field textarea",
      {
        frames: 12,
      },
    );
    expect(briefInput).not.toBeNull();
    if (!briefInput) {
      return;
    }
    changeValue(briefInput, "Send a daily briefing to my WhatsApp account.");
    await settle(app);

    clickButton(app, "Build Plan", { exact: true });
    await settle(app, 4);

    clickButton(app, "Open WhatsApp setup");
    await settle(app, 3);

    clickButton(app, "Show QR", { exact: true });
    await settle(app, 5);

    expect(app.textContent).toContain(
      "WhatsApp listener is active. Return to Builder and continue setup.",
    );
    expect(app.textContent).toContain("WhatsApp default target set to +15551234567.");
    expect(autoTargetCalls).toBeGreaterThanOrEqual(1);
    expectApplyBlocked(app);

    const destinationInput = Array.from(
      app.querySelectorAll<HTMLInputElement>('.quick-setup__fields input[type="text"]'),
    ).find((entry) => {
      const label = entry.closest("label")?.querySelector(".quick-setup__field-label")?.textContent;
      return normalizeText(label).includes("Default destination");
    });
    expect(destinationInput).not.toBeNull();
    if (!destinationInput) {
      return;
    }
    changeValue(destinationInput, "+14155551234");
    await settle(app);

    clickButton(app, "Set Destination", { exact: true });
    await settle(app, 4);

    expect(app.builderSetupResult).toEqual(
      expect.objectContaining({
        actionId: "channel:whatsapp:auto-default-target",
        connectorId: "channel:whatsapp",
        status: "configured",
      }),
    );
    expect(app.builderVerifyResult?.verification.fingerprint).toBe("whatsapp-verify-1");
    expect(app.textContent).toContain("All Passed");
    expect(findButtonByText(app, "Apply Builder Plan", { exact: true })?.disabled).toBe(false);

    clickButton(app, "Apply Builder Plan", { exact: true });
    await settle(app, 2);
    expect(app.textContent).toContain("Confirm Apply");
  });

  it("restores a WhatsApp destination retry after recreating the app and unblocks apply", async () => {
    const app = mountApp("/builder");
    await settle(app, 3);

    let whatsappConnected = false;
    let destinationAttempts = 0;
    let verifyRuns = 0;
    let currentTarget = "";

    const request = vi.fn(async (method: string, params: unknown) => {
      switch (method) {
        case "agents.builder.plan":
          return createWhatsAppPlanResult(false);
        case "web.login.start":
          return {
            message: "Scan this QR code with WhatsApp.",
            qrDataUrl: "data:image/png;base64,whatsapp-qr",
          };
        case "web.login.wait":
          whatsappConnected = true;
          return {
            message: "Linked.",
            connected: true,
          };
        case "channels.status":
          return {
            channelAccounts: {
              whatsapp: [
                {
                  connected: whatsappConnected,
                  linked: whatsappConnected,
                  running: whatsappConnected,
                  lastError: null,
                  probe: {
                    ok: whatsappConnected,
                  },
                },
              ],
            },
          };
        case "agents.builder.setup.run": {
          const record =
            params && typeof params === "object" && !Array.isArray(params)
              ? (params as Record<string, unknown>)
              : {};
          const hasActionId = typeof record.actionId === "string";
          const inputs =
            record.inputs && typeof record.inputs === "object" && !Array.isArray(record.inputs)
              ? (record.inputs as Record<string, unknown>)
              : {};
          const manualTarget =
            typeof inputs["whatsapp.target"] === "string" ? inputs["whatsapp.target"] : "";
          if (!hasActionId) {
            return {
              connectorId: "channel:whatsapp:auto-default-target",
              status: "configured" as const,
              message: "WhatsApp default target set to +15551234567.",
              updatedRefs: [],
            };
          }
          destinationAttempts += 1;
          if (destinationAttempts === 1) {
            return {
              actionId: "channel:whatsapp:auto-default-target",
              connectorId: "channel:whatsapp",
              status: "needs_setup" as const,
              message:
                "WhatsApp destination is invalid or unreachable. Enter a phone number or group JID and retry.",
              updatedRefs: [],
              resume: {
                actionId: "channel:whatsapp:auto-default-target",
                connectorId: "channel:whatsapp",
                label: "Retry WhatsApp destination",
                detail: "Set a reachable WhatsApp number or group JID, then retry.",
                inputs: {},
              },
            };
          }
          currentTarget = manualTarget || "+14155551234";
          return {
            actionId: "channel:whatsapp:auto-default-target",
            connectorId: "channel:whatsapp",
            status: "configured" as const,
            message: `WhatsApp default target set to ${currentTarget}.`,
            updatedRefs: ["channels.whatsapp.defaultTo"],
          };
        }
        case "config.get":
          return createConfigSnapshot(
            {
              channels: {
                whatsapp: {
                  defaultTo: currentTarget,
                },
              },
            },
            `whatsapp-retry-${verifyRuns}`,
          );
        case "agents.builder.verify":
          verifyRuns += 1;
          return createVerifyResult(
            createWhatsAppPlanResult(true),
            `whatsapp-retry-verify-${verifyRuns}`,
          );
        default:
          throw new Error(`Unhandled WhatsApp retry gateway method: ${method}`);
      }
    });

    attachMockClient(app, request);

    const briefInput = await waitForElement<HTMLTextAreaElement>(
      app,
      ".builder-brief-field textarea",
      {
        frames: 12,
      },
    );
    expect(briefInput).not.toBeNull();
    if (!briefInput) {
      return;
    }
    changeValue(briefInput, "Send a daily briefing to my WhatsApp account.");
    await settle(app);

    clickButton(app, "Build Plan", { exact: true });
    await settle(app, 4);

    clickButton(app, "Open WhatsApp setup");
    await settle(app, 3);

    clickButton(app, "Show QR", { exact: true });
    await settle(app, 5);

    expect(app.textContent).toContain(
      "WhatsApp listener is active. Return to Builder and continue setup.",
    );

    const destinationInput = Array.from(
      app.querySelectorAll<HTMLInputElement>('.quick-setup__fields input[type="text"]'),
    ).find((entry) => {
      const label = entry.closest("label")?.querySelector(".quick-setup__field-label")?.textContent;
      return normalizeText(label).includes("Default destination");
    });
    expect(destinationInput).not.toBeNull();
    if (!destinationInput) {
      return;
    }

    changeValue(destinationInput, "invalid-whatsapp-target");
    await settle(app);

    clickButton(app, "Set Destination", { exact: true });
    await settle(app, 4);

    expect(app.builderSetupResult).toEqual(
      expect.objectContaining({
        actionId: "channel:whatsapp:auto-default-target",
        connectorId: "channel:whatsapp",
        status: "needs_setup",
      }),
    );
    expect(app.builderVerifyResult).toBeNull();
    expect(app.textContent).toContain(
      "WhatsApp destination is invalid or unreachable. Enter a phone number or group JID and retry.",
    );
    expectApplyBlocked(app);

    app.remove();
    await nextFrame();

    const restoredApp = mountApp("/builder");
    await settle(restoredApp, 3);
    attachMockClient(restoredApp, request);
    await settle(restoredApp, 2);

    expect(restoredApp.builderSetupFocus).toEqual(
      expect.objectContaining({
        connectorId: "channel:whatsapp",
      }),
    );
    expect(restoredApp.builderSetupResult).toEqual(
      expect.objectContaining({
        actionId: "channel:whatsapp:auto-default-target",
        connectorId: "channel:whatsapp",
        status: "needs_setup",
      }),
    );

    const restoredDestinationInput = Array.from(
      restoredApp.querySelectorAll<HTMLInputElement>('.quick-setup__fields input[type="text"]'),
    ).find((entry) => {
      const label = entry.closest("label")?.querySelector(".quick-setup__field-label")?.textContent;
      return normalizeText(label).includes("Default destination");
    });
    expect(restoredDestinationInput).not.toBeNull();
    if (!restoredDestinationInput) {
      return;
    }
    expect(restoredDestinationInput.value).toBe("invalid-whatsapp-target");

    changeValue(restoredDestinationInput, "+14155551234");
    await settle(restoredApp);

    clickButton(restoredApp, "Set Destination", { exact: true });
    await settle(restoredApp, 4);

    expect(restoredApp.builderSetupResult).toEqual(
      expect.objectContaining({
        actionId: "channel:whatsapp:auto-default-target",
        connectorId: "channel:whatsapp",
        status: "configured",
      }),
    );
    expect(restoredApp.builderVerifyResult?.verification.fingerprint).toBe(
      "whatsapp-retry-verify-1",
    );
    expect(findButtonByText(restoredApp, "Apply Builder Plan", { exact: true })?.disabled).toBe(
      false,
    );
  });

  it("drives exec approvals setup until Builder unblocks apply", async () => {
    const app = mountApp("/builder");
    await settle(app, 3);

    let verifyRuns = 0;
    let configState: Record<string, unknown> = {
      approvals: {
        exec: {
          enabled: false,
          mode: "session",
          targets: [],
        },
      },
    };

    const request = vi.fn(async (method: string, params: unknown) => {
      switch (method) {
        case "agents.builder.plan":
          return createExecApprovalsPlanResult(false);
        case "config.get":
          return createConfigSnapshot(configState, `approvals-config-${verifyRuns}`);
        case "config.set": {
          const record =
            params && typeof params === "object" && !Array.isArray(params)
              ? (params as Record<string, unknown>)
              : {};
          const raw = typeof record.raw === "string" ? record.raw : "{}";
          configState = JSON.parse(raw) as Record<string, unknown>;
          return { ok: true };
        }
        case "agents.builder.setup.run":
          return {
            actionId: "platform:exec-approvals:configure",
            connectorId: "platform:exec-approvals",
            status: "configured" as const,
            message: "Exec approvals are configured and ready.",
            updatedRefs: [
              "approvals.exec.enabled",
              "approvals.exec.mode",
              "approvals.exec.targets.0.channel",
              "approvals.exec.targets.0.to",
            ],
          };
        case "agents.builder.verify":
          verifyRuns += 1;
          return createVerifyResult(
            createExecApprovalsPlanResult(true),
            `approvals-verify-${verifyRuns}`,
          );
        default:
          throw new Error(`Unhandled exec approvals gateway method: ${method}`);
      }
    });

    attachMockClient(app, request);

    const briefInput = await waitForElement<HTMLTextAreaElement>(
      app,
      ".builder-brief-field textarea",
      {
        frames: 12,
      },
    );
    expect(briefInput).not.toBeNull();
    if (!briefInput) {
      return;
    }
    changeValue(briefInput, "Open websites for me and ask for approval before changing anything.");
    await settle(app);

    clickButton(app, "Build Plan", { exact: true });
    await settle(app, 4);

    expectApplyBlocked(app);
    clickButton(app, "Open approvals setup");
    expect(await waitForElement(app, ".quick-setup", { frames: 12 })).not.toBeNull();
    await settle(app, 3);

    const enabledField = findFieldByLabel<HTMLSelectElement>(app, "Forward exec approvals");
    const modeField = findFieldByLabel<HTMLSelectElement>(app, "Approval forwarding mode");
    const channelField = findFieldByLabel<HTMLInputElement>(app, "Approval target channel");
    const targetField = findFieldByLabel<HTMLInputElement>(app, "Approval target destination");
    expect(enabledField).not.toBeNull();
    expect(modeField).not.toBeNull();
    expect(channelField).not.toBeNull();
    expect(targetField).not.toBeNull();
    if (!enabledField || !modeField || !channelField || !targetField) {
      return;
    }

    changeValue(enabledField, "true");
    changeValue(modeField, "both");
    changeValue(channelField, "telegram");
    changeValue(targetField, "123456789");
    await settle(app);

    clickButton(app, "Save", { exact: true });
    await settle(app, 4);

    expectApplyBlocked(app);
    expect(app.textContent).toContain("Check approval routing");

    clickButton(app, "Check approvals", { exact: true });
    await settle(app, 4);

    expect(app.builderSetupResult).toEqual(
      expect.objectContaining({
        actionId: "platform:exec-approvals:configure",
        connectorId: "platform:exec-approvals",
        status: "configured",
      }),
    );
    expect(app.builderVerifyResult?.verification.fingerprint).toBe("approvals-verify-1");
    expect(app.textContent).toContain("All Passed");
    expect(findButtonByText(app, "Apply Builder Plan", { exact: true })?.disabled).toBe(false);

    clickButton(app, "Apply Builder Plan", { exact: true });
    await settle(app, 2);
    expect(app.textContent).toContain("Confirm Apply");
  });

  it("keeps Builder blocked when exec approvals routing is misconfigured", async () => {
    const app = mountApp("/builder");
    await settle(app, 3);

    let configState: Record<string, unknown> = {
      approvals: {
        exec: {
          enabled: false,
          mode: "session",
          targets: [],
        },
      },
    };

    const request = vi.fn(async (method: string, params: unknown) => {
      switch (method) {
        case "agents.builder.plan":
          return createExecApprovalsPlanResult(false);
        case "config.get":
          return createConfigSnapshot(configState, "approvals-misconfig");
        case "config.set": {
          const record =
            params && typeof params === "object" && !Array.isArray(params)
              ? (params as Record<string, unknown>)
              : {};
          const raw = typeof record.raw === "string" ? record.raw : "{}";
          configState = JSON.parse(raw) as Record<string, unknown>;
          return { ok: true };
        }
        case "agents.builder.setup.run":
          return {
            actionId: "platform:exec-approvals:configure",
            connectorId: "platform:exec-approvals",
            status: "needs_setup" as const,
            message:
              'Approval forwarding mode "targets" needs both a target channel and destination.',
            updatedRefs: [],
            resume: {
              actionId: "platform:exec-approvals:configure",
              connectorId: "platform:exec-approvals",
              label: "Re-check approvals",
              detail:
                "Save both an approval target channel and destination, then run the check again.",
              inputs: {},
            },
          };
        case "agents.builder.verify":
          throw new Error("Exec approvals verify should not run for a misconfigured route");
        default:
          throw new Error(`Unhandled exec approvals misconfiguration method: ${method}`);
      }
    });

    attachMockClient(app, request);

    const briefInput = await waitForElement<HTMLTextAreaElement>(
      app,
      ".builder-brief-field textarea",
      {
        frames: 12,
      },
    );
    expect(briefInput).not.toBeNull();
    if (!briefInput) {
      return;
    }
    changeValue(briefInput, "Open websites for me and ask for approval before changing anything.");
    await settle(app);

    clickButton(app, "Build Plan", { exact: true });
    await settle(app, 4);

    clickButton(app, "Open approvals setup");
    expect(await waitForElement(app, ".quick-setup", { frames: 12 })).not.toBeNull();
    await settle(app, 3);

    const enabledField = findFieldByLabel<HTMLSelectElement>(app, "Forward exec approvals");
    const modeField = findFieldByLabel<HTMLSelectElement>(app, "Approval forwarding mode");
    expect(enabledField).not.toBeNull();
    expect(modeField).not.toBeNull();
    if (!enabledField || !modeField) {
      return;
    }

    changeValue(enabledField, "true");
    changeValue(modeField, "targets");
    await settle(app);

    clickButton(app, "Save", { exact: true });
    await settle(app, 4);

    clickButton(app, "Check approvals", { exact: true });
    await settle(app, 4);

    expect(app.builderSetupResult).toEqual(
      expect.objectContaining({
        actionId: "platform:exec-approvals:configure",
        connectorId: "platform:exec-approvals",
        status: "needs_setup",
      }),
    );
    expect(app.builderVerifyResult).toBeNull();
    expect(app.textContent).toContain(
      'Approval forwarding mode "targets" needs both a target channel and destination.',
    );
    expect(app.textContent).toContain("Re-check approvals");
    expectApplyBlocked(app);
  });

  it("retries exec approvals routing after adding an explicit target", async () => {
    await exerciseRetryableGuidedVerificationFlow({
      planFactory: createExecApprovalsPlanResult,
      brief: "Open websites for me and ask for approval before changing anything.",
      initialConfigState: {
        approvals: {
          exec: {
            enabled: false,
            mode: "session",
            targets: [],
          },
        },
      },
      openSetupLabel: "Open approvals setup",
      openSetupIndex: 0,
      verifyButtonLabel: "Check approvals",
      retryButtonLabel: "Re-check approvals",
      actionId: "platform:exec-approvals:configure",
      connectorId: "platform:exec-approvals",
      initialFields: {
        "Forward exec approvals": "true",
        "Approval forwarding mode": "targets",
      },
      repairedFields: {
        "Approval target channel": "telegram",
        "Approval target destination": "123456789",
      },
      expectedVisibleText: "Check approval routing",
      failureMessage:
        'Approval forwarding mode "targets" needs both a target channel and destination.',
      failureResumeLabel: "Re-check approvals",
      failureResumeDetail:
        "Save both an approval target channel and destination, then run the check again.",
      successMessage: "Exec approvals are configured and ready.",
      successUpdatedRefs: [
        "approvals.exec.enabled",
        "approvals.exec.mode",
        "approvals.exec.targets.0.channel",
        "approvals.exec.targets.0.to",
      ],
      fingerprint: "approvals-retry-verify-1",
    });
  });

  it("drives plugin install setup until Builder unblocks apply", async () => {
    const app = mountApp("/builder");
    await settle(app, 3);

    let verifyRuns = 0;
    let configState: Record<string, unknown> = {
      agents: { default: "main" },
      plugins: {},
    };

    const request = vi.fn(async (method: string) => {
      switch (method) {
        case "agents.builder.plan":
          return createPluginInstallPlanResult(false);
        case "agents.builder.setup.run":
          configState = {
            ...configState,
            plugins: {
              enabled: ["msteams"],
              installs: {
                msteams: {
                  pluginId: "msteams",
                  source: "npm",
                  spec: "@openclaw/msteams",
                  version: "1.2.3",
                },
              },
            },
          };
          return {
            actionId: "channel:msteams:install",
            connectorId: "channel:msteams",
            status: "configured" as const,
            message: "Microsoft Teams plugin installed and enabled.",
            updatedRefs: ["plugins.enabled", "plugins.installs.msteams"],
            summary: {
              command: "npm install @openclaw/msteams",
              pluginId: "msteams",
            },
          };
        case "config.get":
          return createConfigSnapshot(configState, `plugin-config-${verifyRuns}`);
        case "agents.builder.verify":
          verifyRuns += 1;
          return createVerifyResult(
            createPluginInstallPlanResult(true),
            `plugin-verify-${verifyRuns}`,
          );
        default:
          throw new Error(`Unhandled plugin-install gateway method: ${method}`);
      }
    });

    attachMockClient(app, request);

    const briefInput = await waitForElement<HTMLTextAreaElement>(
      app,
      ".builder-brief-field textarea",
      {
        frames: 12,
      },
    );
    expect(briefInput).not.toBeNull();
    if (!briefInput) {
      return;
    }
    changeValue(briefInput, "Send support escalations to Microsoft Teams.");
    await settle(app);

    clickButton(app, "Build Plan", { exact: true });
    await settle(app, 4);

    expect(app.textContent).toContain("Install Microsoft Teams");
    expectApplyBlocked(app);

    clickButton(app, "Open Microsoft Teams setup", { index: 1 });
    expect(await waitForElement(app, ".quick-setup", { frames: 12 })).not.toBeNull();
    await settle(app, 3);

    clickButtonInSetupCard(app, "Install Microsoft Teams", { exact: true });
    await settle(app, 4);

    expect(app.builderSetupResult).toEqual(
      expect.objectContaining({
        actionId: "channel:msteams:install",
        connectorId: "channel:msteams",
        status: "configured",
      }),
    );
    expect(app.builderVerifyResult?.verification.fingerprint).toBe("plugin-verify-1");
    expect(app.textContent).toContain("All Passed");
    expect(findButtonByText(app, "Apply Builder Plan", { exact: true })?.disabled).toBe(false);

    clickButton(app, "Apply Builder Plan", { exact: true });
    await settle(app, 2);
    expect(app.textContent).toContain("Confirm Apply");
  });

  it("retries plugin install after a failed Builder attempt", async () => {
    const app = mountApp("/builder");
    await settle(app, 3);

    let installAttempts = 0;
    let verifyRuns = 0;
    let configState: Record<string, unknown> = {
      agents: { default: "main" },
      plugins: {},
    };

    const request = vi.fn(async (method: string) => {
      switch (method) {
        case "agents.builder.plan":
          return createPluginInstallPlanResult(false);
        case "agents.builder.setup.run":
          installAttempts += 1;
          if (installAttempts === 1) {
            return {
              actionId: "channel:msteams:install",
              connectorId: "channel:msteams",
              status: "needs_setup" as const,
              message:
                "Plugin install failed for Microsoft Teams: npm registry temporarily unavailable.",
              updatedRefs: [],
              summary: {
                command: "npm install @openclaw/msteams",
              },
              resume: {
                actionId: "channel:msteams:install",
                connectorId: "channel:msteams",
                label: "Install Microsoft Teams",
                detail:
                  "Retry the npm install for @openclaw/msteams after fixing the install error.",
                inputs: {},
              },
            };
          }
          configState = {
            ...configState,
            plugins: {
              enabled: ["msteams"],
              installs: {
                msteams: {
                  pluginId: "msteams",
                  source: "npm",
                  spec: "@openclaw/msteams",
                  version: "1.2.3",
                },
              },
            },
          };
          return {
            actionId: "channel:msteams:install",
            connectorId: "channel:msteams",
            status: "configured" as const,
            message: "Microsoft Teams plugin installed and enabled.",
            updatedRefs: ["plugins.enabled", "plugins.installs.msteams"],
            summary: {
              command: "npm install @openclaw/msteams",
              pluginId: "msteams",
            },
          };
        case "config.get":
          return createConfigSnapshot(configState, `plugin-retry-${verifyRuns}`);
        case "agents.builder.verify":
          verifyRuns += 1;
          return createVerifyResult(
            createPluginInstallPlanResult(true),
            `plugin-retry-verify-${verifyRuns}`,
          );
        default:
          throw new Error(`Unhandled plugin retry gateway method: ${method}`);
      }
    });

    attachMockClient(app, request);

    const briefInput = await waitForElement<HTMLTextAreaElement>(
      app,
      ".builder-brief-field textarea",
      {
        frames: 12,
      },
    );
    expect(briefInput).not.toBeNull();
    if (!briefInput) {
      return;
    }
    changeValue(briefInput, "Send support escalations to Microsoft Teams.");
    await settle(app);

    clickButton(app, "Build Plan", { exact: true });
    await settle(app, 4);

    clickButton(app, "Open Microsoft Teams setup", { index: 1 });
    expect(await waitForElement(app, ".quick-setup", { frames: 12 })).not.toBeNull();
    await settle(app, 3);

    clickButtonInSetupCard(app, "Install Microsoft Teams", { exact: true });
    await settle(app, 4);

    expect(app.builderSetupResult).toEqual(
      expect.objectContaining({
        actionId: "channel:msteams:install",
        connectorId: "channel:msteams",
        status: "needs_setup",
      }),
    );
    expect(app.builderVerifyResult).toBeNull();
    expect(app.textContent).toContain(
      "Plugin install failed for Microsoft Teams: npm registry temporarily unavailable.",
    );
    expect(app.textContent).toContain("npm install @openclaw/msteams");
    expectApplyBlocked(app);

    clickButtonInSetupCard(app, "Install Microsoft Teams", { exact: true });
    await settle(app, 4);

    expect(app.builderVerifyResult?.verification.fingerprint).toBe("plugin-retry-verify-1");
    expect(app.textContent).toContain("All Passed");
    expect(findButtonByText(app, "Apply Builder Plan", { exact: true })?.disabled).toBe(false);
  });

  it("drives a second catalog-backed plugin install flow for Matrix", async () => {
    const app = mountApp("/builder");
    await settle(app, 3);

    let verifyRuns = 0;
    let configState: Record<string, unknown> = {
      agents: { default: "main" },
      plugins: {},
    };

    const request = vi.fn(async (method: string) => {
      switch (method) {
        case "agents.builder.plan":
          return createMatrixPluginInstallPlanResult(false);
        case "agents.builder.setup.run":
          configState = {
            ...configState,
            plugins: {
              enabled: ["matrix"],
              installs: {
                matrix: {
                  pluginId: "matrix",
                  source: "npm",
                  spec: "@openclaw/matrix",
                  version: "1.2.3",
                },
              },
            },
          };
          return {
            actionId: "channel:matrix:install",
            connectorId: "channel:matrix",
            status: "configured" as const,
            message: "Matrix plugin installed and enabled.",
            updatedRefs: ["plugins.enabled", "plugins.installs.matrix"],
            summary: {
              command: "npm install @openclaw/matrix",
              pluginId: "matrix",
            },
          };
        case "config.get":
          return createConfigSnapshot(configState, `matrix-plugin-${verifyRuns}`);
        case "agents.builder.verify":
          verifyRuns += 1;
          return createVerifyResult(
            createMatrixPluginInstallPlanResult(true),
            `matrix-plugin-verify-${verifyRuns}`,
          );
        default:
          throw new Error(`Unhandled Matrix plugin-install gateway method: ${method}`);
      }
    });

    attachMockClient(app, request);

    const briefInput = await waitForElement<HTMLTextAreaElement>(
      app,
      ".builder-brief-field textarea",
      {
        frames: 12,
      },
    );
    expect(briefInput).not.toBeNull();
    if (!briefInput) {
      return;
    }
    changeValue(briefInput, "Send support escalations to Matrix.");
    await settle(app);

    clickButton(app, "Build Plan", { exact: true });
    await settle(app, 4);

    expect(app.textContent).toContain("Install Matrix");
    expectApplyBlocked(app);

    clickButton(app, "Open Matrix setup", { index: 1 });
    expect(await waitForElement(app, ".quick-setup", { frames: 12 })).not.toBeNull();
    await settle(app, 3);

    clickButtonInSetupCard(app, "Install Matrix", { exact: true });
    await settle(app, 4);

    expect(app.builderSetupResult).toEqual(
      expect.objectContaining({
        actionId: "channel:matrix:install",
        connectorId: "channel:matrix",
        status: "configured",
      }),
    );
    expect(app.builderVerifyResult?.verification.fingerprint).toBe("matrix-plugin-verify-1");
    expect(app.textContent).toContain("All Passed");
    expect(findButtonByText(app, "Apply Builder Plan", { exact: true })?.disabled).toBe(false);
  });
});
