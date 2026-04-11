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
  const frames = params?.frames ?? 10;
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

function attachMockClient(app: OpenClawApp, request: ReturnType<typeof vi.fn>) {
  app.client = {
    request,
    stop: vi.fn(),
  } as unknown as OpenClawApp["client"];
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
    expect(findButtonByText(app, "Apply Builder Plan", { exact: true })?.disabled).toBe(true);

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
                  lastError: null,
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
      "WhatsApp is connected. Return to Builder and continue setup.",
    );
    expect(app.textContent).toContain("WhatsApp default target set to +15551234567.");
    expect(autoTargetCalls).toBeGreaterThanOrEqual(1);
    expect(findButtonByText(app, "Apply Builder Plan", { exact: true })?.disabled).toBe(true);

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

    expect(findButtonByText(app, "Apply Builder Plan", { exact: true })?.disabled).toBe(true);
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

    expect(findButtonByText(app, "Apply Builder Plan", { exact: true })?.disabled).toBe(true);
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
    expect(findButtonByText(app, "Apply Builder Plan", { exact: true })?.disabled).toBe(true);
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
    expect(findButtonByText(app, "Apply Builder Plan", { exact: true })?.disabled).toBe(true);

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
    expect(findButtonByText(app, "Apply Builder Plan", { exact: true })?.disabled).toBe(true);

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
    expect(findButtonByText(app, "Apply Builder Plan", { exact: true })?.disabled).toBe(true);

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
