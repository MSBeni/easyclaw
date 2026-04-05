import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../protocol/index.js";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(() => ({ agents: { default: "main" } })),
  writeConfigFile: vi.fn(async () => {}),
  compileAgentBlueprintBuilderPlan: vi.fn(),
  applyAgentBlueprintBuilderPlan: vi.fn(),
  verifyAgentBlueprintBuilderPlan: vi.fn(),
  resolveTelegramAccount: vi.fn(),
  fetchTelegramBotIdentity: vi.fn(),
  fetchTelegramLatestDeliveryTarget: vi.fn(),
  runGmailSetup: vi.fn(),
  getTailscaleConnectionSummary: vi.fn(),
  installMacAppWithBrew: vi.fn(),
  launchMacApp: vi.fn(),
  launchMacPath: vi.fn(),
  launchTerminalCommand: vi.fn(),
  extractTailscaleFunnelEnableUrl: vi.fn((message: string) => {
    const match = message.match(/https:\/\/login\.tailscale\.com\/[^\s"'<>]+/i);
    return match ? match[0].replace(/[)\],.;]+$/g, "") : null;
  }),
  validatePublicPushEndpoint: vi.fn((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return { ok: true, normalized: "" };
    }
    if (!/^https:\/\//i.test(trimmed)) {
      return {
        ok: false,
        error:
          "Public Push Endpoint must be a full public HTTPS URL, not just a host or IP address. Example: https://your-host.example/gmail-pubsub?token=...",
      };
    }
    if (/^https:\/\/100\./i.test(trimmed)) {
      return {
        ok: false,
        error:
          "Public Push Endpoint must be a public HTTPS URL. Private, LAN, and Tailscale IP addresses will not work for Google Pub/Sub push delivery.",
      };
    }
    return { ok: true, normalized: trimmed };
  }),
  discoverDownloadedGogCredentials: vi.fn(),
  getActiveGcloudAccount: vi.fn(),
  getGogKeyringPasswordPath: vi.fn(),
  getGogAuthStatus: vi.fn(),
  importGogCredentialsJson: vi.fn(),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: mocks.loadConfig,
  writeConfigFile: mocks.writeConfigFile,
}));

vi.mock("../../../extensions/telegram/src/accounts.js", () => ({
  resolveTelegramAccount: mocks.resolveTelegramAccount,
}));

vi.mock("../../../extensions/telegram/src/api-fetch.js", () => ({
  fetchTelegramBotIdentity: mocks.fetchTelegramBotIdentity,
  fetchTelegramLatestDeliveryTarget: mocks.fetchTelegramLatestDeliveryTarget,
}));

vi.mock("../../agents/blueprints/builder.js", () => ({
  compileAgentBlueprintBuilderPlan: mocks.compileAgentBlueprintBuilderPlan,
  applyAgentBlueprintBuilderPlan: mocks.applyAgentBlueprintBuilderPlan,
  verifyAgentBlueprintBuilderPlan: mocks.verifyAgentBlueprintBuilderPlan,
}));

vi.mock("../../hooks/gmail-ops.js", () => ({
  runGmailSetup: mocks.runGmailSetup,
}));

vi.mock("../../hooks/gmail-setup-utils.js", () => ({
  discoverDownloadedGogCredentials: mocks.discoverDownloadedGogCredentials,
  extractTailscaleFunnelEnableUrl: mocks.extractTailscaleFunnelEnableUrl,
  getActiveGcloudAccount: mocks.getActiveGcloudAccount,
  getGogKeyringPasswordPath: mocks.getGogKeyringPasswordPath,
  getGogAuthStatus: mocks.getGogAuthStatus,
  getTailscaleConnectionSummary: mocks.getTailscaleConnectionSummary,
  importGogCredentialsJson: mocks.importGogCredentialsJson,
  installMacAppWithBrew: mocks.installMacAppWithBrew,
  validatePublicPushEndpoint: mocks.validatePublicPushEndpoint,
}));

vi.mock("../../infra/terminal-launch.js", () => ({
  launchMacApp: mocks.launchMacApp,
  launchMacPath: mocks.launchMacPath,
  launchTerminalCommand: mocks.launchTerminalCommand,
}));

const { builderHandlers } = await import("./builder.js");

type RespondCall = [boolean, unknown?, { code: number; message: string }?];

function createInvokeParams(method: keyof typeof builderHandlers, params: Record<string, unknown>) {
  const respond = vi.fn();
  return {
    respond,
    invoke: async () =>
      await builderHandlers[method]({
        params,
        respond: respond as never,
        context: {} as never,
        client: null,
        req: { type: "req", id: "req-1", method },
        isWebchatConnect: () => false,
      }),
  };
}

describe("builder gateway handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.writeConfigFile.mockResolvedValue(undefined);
    mocks.resolveTelegramAccount.mockReturnValue({
      accountId: "default",
      enabled: true,
      token: "telegram-token",
      tokenSource: "config",
      config: {},
    });
    mocks.fetchTelegramLatestDeliveryTarget.mockResolvedValue({
      target: {
        chatId: "-1001234567890",
        target: "-1001234567890",
      },
    });
    mocks.fetchTelegramBotIdentity.mockResolvedValue({
      bot: {
        id: "123456789",
        username: "vole_bot",
      },
    });
    mocks.launchMacApp.mockResolvedValue(undefined);
    mocks.launchMacPath.mockResolvedValue(undefined);
    mocks.installMacAppWithBrew.mockResolvedValue(undefined);
    mocks.getActiveGcloudAccount.mockResolvedValue("user@example.com");
    mocks.getGogKeyringPasswordPath.mockResolvedValue("/tmp/gog-keyring-password");
    mocks.getGogAuthStatus.mockResolvedValue({
      credentialsExists: true,
      email: "automation@example.com",
    });
    mocks.getTailscaleConnectionSummary.mockResolvedValue({
      appInstalled: true,
      connected: false,
      dnsName: null,
      detail: "failed to connect to local Tailscale service; is Tailscale running?",
      installerPackagePath: null,
    });
  });

  it("rejects plans without a brief", async () => {
    const { respond, invoke } = createInvokeParams("agents.builder.plan", {});
    await invoke();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(false);
    expect(call?.[2]?.code).toBe(ErrorCodes.INVALID_REQUEST);
  });

  it("returns a builder plan", async () => {
    mocks.compileAgentBlueprintBuilderPlan.mockResolvedValue({
      draft: {
        brief: "Create me a daily digest",
        templateId: "daily-briefing",
        displayName: "Daily Briefing Agent",
        confidence: "high",
        plannerStatus: "ready",
        reasons: ["Matched digest language."],
        assumptions: [],
        questions: [],
        ready: true,
        requirements: {
          intentTags: ["scheduled", "summary"],
          triggers: [],
          inputs: [],
          transforms: [],
          decisions: [],
          actions: [],
          outputs: [],
          policies: [],
          constraints: [],
          missingInputs: [],
          setupGaps: [],
          policyGaps: [],
          unsupportedGaps: [],
        },
        planning: {
          selections: [
            {
              requirementId: "schedule",
              requirementLabel: "Scheduled Trigger",
              contractIds: ["schedule.trigger"],
              connectorId: "tools:automation",
              connectorLabel: "OpenClaw Automation Tools",
              source: "explicit",
            },
          ],
          integrations: [
            {
              connectorId: "tools:automation",
              instanceId: "tools:automation",
              status: "installed",
              configRefs: ["cron.enabled"],
              authRefs: [],
              issues: [],
              label: "OpenClaw Automation Tools",
              kind: "tooling",
              sourceKind: "core_tool_section",
              contracts: ["schedule.trigger"],
              verification: [],
            },
          ],
          setupTasks: [
            {
              id: "tools:automation:setup",
              connectorId: "tools:automation",
              connectorLabel: "OpenClaw Automation Tools",
              kind: "configure",
              status: "completed",
              title: "OpenClaw Automation Tools configured",
              detail: "OpenClaw Automation Tools is ready for this workflow.",
              refs: ["cron.enabled"],
            },
          ],
          verifications: [],
        },
        extracted: {
          agentId: "daily-briefing",
          name: "Morning Brief",
          ingressChannels: [],
          sourceChannels: ["gmail"],
          deliveryTarget: "telegram @me",
          schedule: "weekday-morning-brief: 0 9 * * 1-5",
        },
      },
      plan: {
        status: "ready",
      },
    });

    const { respond, invoke } = createInvokeParams("agents.builder.plan", {
      brief: "Create me a daily digest",
      templateId: "daily-briefing",
    });
    await invoke();

    expect(mocks.compileAgentBlueprintBuilderPlan).toHaveBeenCalledWith({
      brief: "Create me a daily digest",
      templateId: "daily-briefing",
      cfg: { agents: { default: "main" } },
    });
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        draft: expect.objectContaining({ templateId: "daily-briefing" }),
      }),
    );
  });

  it("forwards an explicit modelId to builder planning", async () => {
    mocks.compileAgentBlueprintBuilderPlan.mockResolvedValue({
      draft: {
        brief: "Create me a daily digest",
        templateId: "daily-briefing",
        displayName: "Daily Briefing Agent",
        confidence: "high",
        plannerStatus: "ready",
        reasons: [],
        assumptions: [],
        questions: [],
        ready: true,
        requirements: {
          confidence: "high",
          workflow: {
            primaryGoal: "briefing",
            executionMode: "scheduled",
            triggerKinds: [],
            sourceKinds: [],
            transformKinds: [],
            actionKinds: [],
            deliveryKinds: [],
            requiresApproval: false,
          },
          intentTags: [],
          triggers: [],
          inputs: [],
          transforms: [],
          decisions: [],
          actions: [],
          outputs: [],
          policies: [],
          constraints: [],
          missingInputs: [],
          setupGaps: [],
          policyGaps: [],
          unsupportedGaps: [],
          ambiguities: [],
          unsupportedRequests: [],
          unsupportedClassifications: [],
          missingDataFields: [],
        },
        planning: {
          selections: [],
          alternatives: [],
          variants: [],
          integrations: [],
          setupTasks: [],
          verifications: [],
          topology: {
            mode: "single-agent",
            reason: "default",
            roles: [],
          },
          graph: {
            mode: "single-agent",
            entryNodeId: "primary",
            nodes: [],
            edges: [],
          },
        },
        extracted: {
          agentId: "daily-briefing",
          name: "Morning Brief",
          ingressChannels: [],
          sourceChannels: [],
          deliveryTarget: null,
          schedule: null,
        },
      },
      plan: { status: "ready" },
      graphPlans: [],
    });

    const { invoke } = createInvokeParams("agents.builder.plan", {
      brief: "Create me a daily digest",
      modelId: "openai/gpt-4o",
    });
    await invoke();

    expect(mocks.compileAgentBlueprintBuilderPlan).toHaveBeenCalledWith({
      brief: "Create me a daily digest",
      modelId: "openai/gpt-4o",
      cfg: { agents: { default: "main" } },
    });
  });

  it("applies a builder-generated blueprint", async () => {
    mocks.applyAgentBlueprintBuilderPlan.mockResolvedValue({
      draft: {
        brief: "Create a support bot on Telegram",
        templateId: "support-responder",
        displayName: "Support Responder",
        confidence: "high",
        plannerStatus: "ready",
        reasons: ["Matched support language."],
        assumptions: [],
        questions: [],
        ready: true,
        requirements: {
          intentTags: ["support"],
          triggers: [],
          inputs: [],
          transforms: [],
          decisions: [],
          actions: [],
          outputs: [],
          policies: [],
          constraints: [],
          missingInputs: [],
          setupGaps: [],
          policyGaps: [],
          unsupportedGaps: [],
        },
        planning: {
          selections: [
            {
              requirementId: "chat-ingress",
              requirementLabel: "Chat Ingress",
              contractIds: ["ingress.chat"],
              connectorId: "channel:telegram",
              connectorLabel: "Telegram",
              source: "explicit",
            },
          ],
          integrations: [
            {
              connectorId: "channel:telegram",
              instanceId: "channel:telegram",
              status: "authenticated",
              configRefs: ["channels.telegram"],
              authRefs: ["channels.telegram"],
              issues: [],
              label: "Telegram",
              kind: "channel",
              sourceKind: "builtin_channel",
              contracts: ["ingress.chat", "delivery.chat", "message.send"],
              verification: [],
            },
          ],
          setupTasks: [
            {
              id: "channel:telegram:setup",
              connectorId: "channel:telegram",
              connectorLabel: "Telegram",
              kind: "connect",
              status: "completed",
              title: "Telegram connected",
              detail: "Telegram is connected and available to this workflow.",
              refs: ["channels.telegram"],
            },
          ],
          verifications: [],
        },
        extracted: {
          agentId: "support",
          name: "Support",
          ingressChannels: ["telegram"],
          sourceChannels: [],
          deliveryTarget: null,
          schedule: null,
        },
      },
      result: {
        status: "applied",
        agent: {
          agentId: "support",
          name: "Support",
        },
      },
    });

    const { respond, invoke } = createInvokeParams("agents.builder.apply", {
      brief: "Create a support bot on Telegram",
    });
    await invoke();

    expect(mocks.applyAgentBlueprintBuilderPlan).toHaveBeenCalledWith({
      brief: "Create a support bot on Telegram",
      cfg: { agents: { default: "main" } },
    });
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({
          agent: expect.objectContaining({ agentId: "support" }),
        }),
      }),
    );
  });

  it("runs the Gmail helper setup for builder quick setup", async () => {
    mocks.runGmailSetup.mockResolvedValue({
      projectId: "project-123",
      topic: "projects/project-123/topics/gmail-push",
      subscription: "gmail-push-sub",
      pushEndpoint: "https://gateway.example/hooks/gmail",
      hookUrl: "http://127.0.0.1:18789/hooks/gmail",
      hookToken: "secret-hook",
      pushToken: "secret-push",
      serve: {
        bind: "127.0.0.1",
        port: 8788,
        path: "/",
      },
    });

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "platform:gmail-hook",
      inputs: {
        account: "automation@example.com",
        project: "project-123",
        topic: "gmail-push",
        subscription: "gmail-push-sub",
      },
    });
    await invoke();

    expect(mocks.runGmailSetup).toHaveBeenCalledWith({
      account: "automation@example.com",
      interactiveAuth: false,
      project: "project-123",
      topic: "gmail-push",
      subscription: "gmail-push-sub",
    });
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "platform:gmail-hook",
        status: "configured",
        summary: expect.objectContaining({
          projectId: "project-123",
          topic: "projects/project-123/topics/gmail-push",
        }),
      }),
    );
  });

  it("auto-detects Telegram default target and persists it", async () => {
    mocks.fetchTelegramLatestDeliveryTarget.mockResolvedValue({
      target: {
        chatId: "-1002003004005",
        messageThreadId: 77,
        target: "-1002003004005:topic:77",
      },
    });

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "channel:telegram:auto-default-target",
      inputs: {},
    });
    await invoke();

    expect(mocks.resolveTelegramAccount).toHaveBeenCalledWith({
      cfg: { agents: { default: "main" } },
    });
    expect(mocks.fetchTelegramLatestDeliveryTarget).toHaveBeenCalledWith({
      token: "telegram-token",
    });
    expect(mocks.writeConfigFile).toHaveBeenCalledWith(
      expect.objectContaining({
        channels: expect.objectContaining({
          telegram: expect.objectContaining({
            defaultTo: "-1002003004005:topic:77",
          }),
        }),
      }),
    );

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "channel:telegram:auto-default-target",
        status: "configured",
        updatedRefs: ["channels.telegram.defaultTo"],
      }),
    );
  });

  it("writes account-scoped Telegram default target when accountId input is provided", async () => {
    mocks.fetchTelegramLatestDeliveryTarget.mockResolvedValue({
      target: {
        chatId: "-1002003004005",
        target: "-1002003004005",
      },
    });

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "channel:telegram:auto-default-target",
      inputs: {
        accountId: "Ops",
      },
    });
    await invoke();

    expect(mocks.resolveTelegramAccount).toHaveBeenCalledWith({
      cfg: { agents: { default: "main" } },
      accountId: "ops",
    });
    expect(mocks.writeConfigFile).toHaveBeenCalledWith(
      expect.objectContaining({
        channels: expect.objectContaining({
          telegram: expect.objectContaining({
            accounts: expect.objectContaining({
              ops: expect.objectContaining({
                defaultTo: "-1002003004005",
              }),
            }),
          }),
        }),
      }),
    );

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "channel:telegram:auto-default-target",
        status: "configured",
        updatedRefs: ["channels.telegram.accounts.ops.defaultTo"],
      }),
    );
  });

  it("returns setup guidance when Telegram auto-detect has no updates yet", async () => {
    mocks.fetchTelegramLatestDeliveryTarget.mockResolvedValue({
      target: null,
    });

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "channel:telegram:auto-default-target",
      inputs: {},
    });
    await invoke();

    expect(mocks.writeConfigFile).not.toHaveBeenCalled();
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "channel:telegram:auto-default-target",
        status: "needs_setup",
        message: expect.stringContaining("did not find any pending updates"),
      }),
    );
  });

  it("returns actionable guidance when Telegram auto-detect gets Not Found", async () => {
    mocks.fetchTelegramLatestDeliveryTarget.mockResolvedValue({
      target: null,
      error: "Not Found",
    });

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "channel:telegram:auto-default-target",
      inputs: {},
    });
    await invoke();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "channel:telegram:auto-default-target",
        status: "needs_setup",
        message: expect.stringContaining("token is likely invalid/revoked"),
      }),
    );
  });

  it("prefers an explicit token input for Telegram auto-detect", async () => {
    mocks.fetchTelegramLatestDeliveryTarget.mockResolvedValue({
      target: {
        chatId: "123456789",
        target: "123456789",
      },
    });

    const { invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "channel:telegram:auto-default-target",
      inputs: {
        token: "token-from-input",
      },
    });
    await invoke();

    expect(mocks.fetchTelegramLatestDeliveryTarget).toHaveBeenCalledWith({
      token: "token-from-input",
    });
  });

  it("normalizes explicit Telegram token input before auto-detect", async () => {
    mocks.fetchTelegramLatestDeliveryTarget.mockResolvedValue({
      target: {
        chatId: "123456789",
        target: "123456789",
      },
    });

    const { invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "channel:telegram:auto-default-target",
      inputs: {
        token: " 123456:abc\u2013DEF \n",
      },
    });
    await invoke();

    expect(mocks.fetchTelegramLatestDeliveryTarget).toHaveBeenCalledWith({
      token: "123456:abc-DEF",
    });
  });

  it("ignores redacted token placeholders and falls back to configured account token", async () => {
    mocks.fetchTelegramLatestDeliveryTarget.mockResolvedValue({
      target: {
        chatId: "123456789",
        target: "123456789",
      },
    });

    const { invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "channel:telegram:auto-default-target",
      inputs: {
        token: "__OPENCLAW_REDACTED__",
      },
    });
    await invoke();

    expect(mocks.fetchTelegramLatestDeliveryTarget).toHaveBeenCalledWith({
      token: "telegram-token",
    });
  });

  it("verifies Telegram token and reports the resolved bot identity", async () => {
    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "channel:telegram:verify-token",
      inputs: {},
    });
    await invoke();

    expect(mocks.fetchTelegramBotIdentity).toHaveBeenCalledWith({
      token: "telegram-token",
    });
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "channel:telegram:verify-token",
        status: "configured",
        message: expect.stringContaining("@vole_bot"),
        summary: expect.objectContaining({
          command: "getMe",
          botId: "123456789",
          botUsername: "vole_bot",
          accountId: "default",
        }),
      }),
    );
  });

  it("returns generic auth guidance for connectors that are still disconnected", async () => {
    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "channel:slack",
      inputs: {},
    });
    await invoke();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "channel:slack",
        status: "needs_auth",
        updatedRefs: expect.arrayContaining(["channels.slack"]),
        resume: expect.objectContaining({
          connectorId: "channel:slack",
        }),
      }),
    );
  });

  it("returns generic configured status for connectors already ready", async () => {
    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "platform:core-model",
      inputs: {},
    });
    await invoke();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "platform:core-model",
        status: "configured",
        updatedRefs: expect.arrayContaining(["models", "auth"]),
      }),
    );
  });

  it("rejects unknown connector ids in setup.run", async () => {
    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "channel:not-real",
      inputs: {},
    });
    await invoke();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(false);
    expect(call?.[2]?.code).toBe(ErrorCodes.INVALID_REQUEST);
    expect(call?.[2]?.message).toContain("unknown connectorId");
  });

  it("rejects Gmail quick setup without an account", async () => {
    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "platform:gmail-hook",
      inputs: {},
    });
    await invoke();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(false);
    expect(call?.[2]?.code).toBe(ErrorCodes.INVALID_REQUEST);
  });

  it("returns a structured auth handoff when Gmail setup needs login", async () => {
    mocks.runGmailSetup.mockRejectedValue(
      new Error(
        "gcloud login required. Run `gcloud auth login`. gog login required. Run `gog login automation@example.com --client openclaw-gmail-hook --services gmail --gmail-scope full --force-consent`. Retry after both are complete.",
      ),
    );

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "platform:gmail-hook",
      inputs: {
        account: "automation@example.com",
      },
    });
    await invoke();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "platform:gmail-hook",
        status: "needs_auth",
        authSteps: expect.arrayContaining([
          expect.objectContaining({
            connectorId: "platform:gmail-hook:gcloud-auth",
            command: "gcloud auth login",
          }),
          expect.objectContaining({
            connectorId: "platform:gmail-hook:gog-auth",
            command:
              "gog login automation@example.com --client openclaw-gmail-hook --services gmail --gmail-scope full --force-consent",
          }),
        ]),
        resume: expect.objectContaining({
          connectorId: "platform:gmail-hook",
        }),
      }),
    );
  });

  it("returns a structured credentials handoff when Gmail setup needs an OAuth client JSON", async () => {
    mocks.runGmailSetup.mockRejectedValue(
      new Error(
        "gcloud login required. Run `gcloud auth login`. gog OAuth client credentials missing. Import them with `gog auth credentials set --client openclaw-gmail-hook <credentials.json>`. Retry after both are complete.",
      ),
    );
    mocks.getActiveGcloudAccount.mockResolvedValue(null);
    mocks.getGogAuthStatus.mockResolvedValue({
      credentialsExists: false,
      email: null,
    });

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "platform:gmail-hook",
      inputs: {
        account: "automation@example.com",
        project: "project-123",
      },
    });
    await invoke();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "platform:gmail-hook",
        status: "needs_credentials",
        credentialImport: expect.objectContaining({
          connectorId: "platform:gmail-hook:gog-credentials",
          consoleUrl: "https://console.cloud.google.com/apis/credentials?project=project-123",
          autoDetect: expect.objectContaining({
            connectorId: "platform:gmail-hook:gog-credentials-auto",
          }),
        }),
      }),
    );
  });

  it("tries to import a downloaded Gmail OAuth client JSON and continues into gog login", async () => {
    mocks.discoverDownloadedGogCredentials.mockResolvedValue({
      filePath: "/Users/moe/Downloads/client_secret_abc.json",
      filename: "client_secret_abc.json",
      credentialsJson:
        '{"installed":{"client_id":"123.apps.googleusercontent.com","client_secret":"secret","redirect_uris":["http://localhost"],"project_id":"project-123"}}',
      projectId: "project-123",
    });
    mocks.getActiveGcloudAccount.mockResolvedValue("user@example.com");

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "platform:gmail-hook:gog-credentials-auto",
      inputs: {
        account: "automation@example.com",
        project: "project-123",
      },
    });
    await invoke();

    expect(mocks.discoverDownloadedGogCredentials).toHaveBeenCalledWith("project-123");
    expect(mocks.importGogCredentialsJson).toHaveBeenCalledWith(
      '{"installed":{"client_id":"123.apps.googleusercontent.com","client_secret":"secret","redirect_uris":["http://localhost"],"project_id":"project-123"}}',
      "client_secret_abc.json",
    );
    expect(mocks.launchTerminalCommand).toHaveBeenCalledWith(
      "export GOG_KEYRING_BACKEND=file; export GOG_KEYRING_PASSWORD=\"$(cat '/tmp/gog-keyring-password')\"; gog login automation@example.com --client openclaw-gmail-hook --services gmail --gmail-scope full --force-consent",
    );

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "platform:gmail-hook",
        status: "started",
        summary: expect.objectContaining({
          projectId: "project-123",
          command:
            "gog login automation@example.com --client openclaw-gmail-hook --services gmail --gmail-scope full --force-consent",
        }),
      }),
    );
  });

  it("falls back to manual Gmail OAuth upload when no downloaded JSON is found", async () => {
    mocks.discoverDownloadedGogCredentials.mockResolvedValue(null);
    mocks.getActiveGcloudAccount.mockResolvedValue("user@example.com");

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "platform:gmail-hook:gog-credentials-auto",
      inputs: {
        account: "automation@example.com",
        project: "project-123",
      },
    });
    await invoke();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "platform:gmail-hook",
        status: "needs_credentials",
        credentialImport: expect.objectContaining({
          connectorId: "platform:gmail-hook:gog-credentials",
          autoDetect: expect.objectContaining({
            connectorId: "platform:gmail-hook:gog-credentials-auto",
          }),
        }),
      }),
    );
  });

  it("launches Terminal for the gcloud auth handoff", async () => {
    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "platform:gmail-hook:gcloud-auth",
      inputs: {},
    });
    await invoke();

    expect(mocks.launchTerminalCommand).toHaveBeenCalledWith("gcloud auth login");
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        status: "started",
        summary: expect.objectContaining({ command: "gcloud auth login" }),
      }),
    );
  });

  it("returns a structured setup handoff when Gmail setup needs Tailscale", async () => {
    mocks.runGmailSetup.mockRejectedValue(
      new Error(
        "tailscale status --json failed (code=1) stderr: failed to connect to local Tailscale service; is Tailscale running?",
      ),
    );

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "platform:gmail-hook",
      inputs: {
        account: "automation@example.com",
      },
    });
    await invoke();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "platform:gmail-hook",
        status: "needs_setup",
        authSteps: expect.arrayContaining([
          expect.objectContaining({
            connectorId: "platform:gmail-hook:tailscale-start",
            command: "open -a Tailscale",
          }),
          expect.objectContaining({
            connectorId: "platform:gmail-hook:tailscale-check",
            command: "tailscale status --json",
          }),
        ]),
      }),
    );
  });

  it("guides the user to enable Tailscale Funnel when the tailnet blocks it", async () => {
    mocks.getTailscaleConnectionSummary.mockResolvedValue({
      appInstalled: true,
      connected: true,
      dnsName: "moes-macbook-pro.tail10a93.ts.net",
      detail: "Tailscale is connected as moes-macbook-pro.tail10a93.ts.net.",
      installerPackagePath: null,
    });
    mocks.runGmailSetup.mockRejectedValue(
      new Error(
        "tailscale funnel enable required. Enable it at https://login.tailscale.com/f/funnel?node=node-123 and retry.",
      ),
    );

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "platform:gmail-hook",
      inputs: {
        account: "automation@example.com",
      },
    });
    await invoke();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "platform:gmail-hook",
        status: "needs_setup",
        message: expect.stringContaining("Funnel is not enabled"),
        authSteps: expect.arrayContaining([
          expect.objectContaining({
            connectorId: "platform:gmail-hook:tailscale-funnel-enable",
            command: "open https://login.tailscale.com/f/funnel?node=node-123",
          }),
          expect.objectContaining({
            connectorId: "platform:gmail-hook:tailscale-check",
          }),
        ]),
      }),
    );
  });

  it("offers Tailscale install first when the Mac app is missing", async () => {
    mocks.getTailscaleConnectionSummary.mockResolvedValue({
      appInstalled: false,
      connected: false,
      dnsName: null,
      detail: "Tailscale is not installed on this Mac.",
      installerPackagePath: null,
    });
    mocks.runGmailSetup.mockRejectedValue(
      new Error(
        "tailscale status --json failed (code=1) stderr: failed to connect to local Tailscale service; is Tailscale running?",
      ),
    );

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "platform:gmail-hook",
      inputs: {
        account: "automation@example.com",
      },
    });
    await invoke();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "platform:gmail-hook",
        status: "needs_setup",
        authSteps: expect.arrayContaining([
          expect.objectContaining({
            connectorId: "platform:gmail-hook:tailscale-install",
            command: "brew install --cask tailscale",
          }),
        ]),
      }),
    );
  });

  it("offers the staged Tailscale installer when Homebrew already downloaded it", async () => {
    mocks.getTailscaleConnectionSummary.mockResolvedValue({
      appInstalled: false,
      connected: false,
      dnsName: null,
      detail:
        "Homebrew downloaded the Tailscale installer, but macOS still needs you to finish installing it.",
      installerPackagePath:
        "/opt/homebrew/Caskroom/tailscale-app/1.96.2/Tailscale-1.96.2-macos.pkg",
    });
    mocks.runGmailSetup.mockRejectedValue(
      new Error(
        "tailscale status --json failed (code=1) stderr: failed to connect to local Tailscale service; is Tailscale running?",
      ),
    );

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "platform:gmail-hook",
      inputs: {
        account: "automation@example.com",
      },
    });
    await invoke();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "platform:gmail-hook",
        status: "needs_setup",
        message: expect.stringContaining("Homebrew already downloaded the Tailscale installer"),
        authSteps: expect.arrayContaining([
          expect.objectContaining({
            connectorId: "platform:gmail-hook:tailscale-open-installer",
            command: "open /opt/homebrew/Caskroom/tailscale-app/1.96.2/Tailscale-1.96.2-macos.pkg",
          }),
        ]),
      }),
    );
  });

  it("launches Tailscale for the Gmail setup handoff", async () => {
    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "platform:gmail-hook:tailscale-start",
      inputs: {
        account: "automation@example.com",
      },
    });
    await invoke();

    expect(mocks.launchMacApp).toHaveBeenCalledWith("Tailscale");
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        status: "started",
        authSteps: expect.arrayContaining([
          expect.objectContaining({
            connectorId: "platform:gmail-hook:tailscale-check",
          }),
        ]),
        summary: expect.objectContaining({ command: "open -a Tailscale" }),
      }),
    );
  });

  it("reports a missing Tailscale app honestly instead of claiming it opened", async () => {
    mocks.launchMacApp.mockRejectedValue(new Error("Tailscale app is not installed on this Mac."));
    mocks.getTailscaleConnectionSummary.mockResolvedValue({
      appInstalled: false,
      connected: false,
      dnsName: null,
      detail: "Tailscale is not installed on this Mac.",
      installerPackagePath: null,
    });

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "platform:gmail-hook:tailscale-start",
      inputs: {
        account: "automation@example.com",
      },
    });
    await invoke();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "platform:gmail-hook",
        status: "needs_setup",
        message: expect.stringContaining("Tailscale is not installed on this Mac"),
        authSteps: expect.arrayContaining([
          expect.objectContaining({
            connectorId: "platform:gmail-hook:tailscale-install",
          }),
        ]),
      }),
    );
  });

  it("opens the staged Tailscale installer package", async () => {
    mocks.getTailscaleConnectionSummary.mockResolvedValue({
      appInstalled: false,
      connected: false,
      dnsName: null,
      detail:
        "Homebrew downloaded the Tailscale installer, but macOS still needs you to finish installing it.",
      installerPackagePath:
        "/opt/homebrew/Caskroom/tailscale-app/1.96.2/Tailscale-1.96.2-macos.pkg",
    });

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "platform:gmail-hook:tailscale-open-installer",
      inputs: {
        account: "automation@example.com",
      },
    });
    await invoke();

    expect(mocks.launchMacPath).toHaveBeenCalledWith(
      "/opt/homebrew/Caskroom/tailscale-app/1.96.2/Tailscale-1.96.2-macos.pkg",
    );
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "platform:gmail-hook",
        status: "started",
        summary: expect.objectContaining({
          command: "open /opt/homebrew/Caskroom/tailscale-app/1.96.2/Tailscale-1.96.2-macos.pkg",
        }),
      }),
    );
  });

  it("installs Tailscale and asks the user to connect it before continuing", async () => {
    mocks.getTailscaleConnectionSummary.mockResolvedValue({
      appInstalled: true,
      connected: false,
      dnsName: null,
      detail: "Tailscale is installed, but this machine is not connected yet.",
      installerPackagePath: null,
    });

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "platform:gmail-hook:tailscale-install",
      inputs: {
        account: "automation@example.com",
      },
    });
    await invoke();

    expect(mocks.installMacAppWithBrew).toHaveBeenCalledWith({
      appName: "Tailscale",
      caskName: "tailscale",
    });
    expect(mocks.launchMacApp).toHaveBeenCalledWith("Tailscale");
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "platform:gmail-hook",
        status: "started",
        authSteps: expect.arrayContaining([
          expect.objectContaining({
            connectorId: "platform:gmail-hook:tailscale-check",
          }),
        ]),
        summary: expect.objectContaining({ command: "brew install --cask tailscale" }),
      }),
    );
  });

  it("keeps the guided flow alive if Tailscale installs but the app is not ready to open yet", async () => {
    mocks.getTailscaleConnectionSummary.mockResolvedValue({
      appInstalled: false,
      connected: false,
      dnsName: null,
      detail:
        "Homebrew downloaded the Tailscale installer, but macOS still needs you to finish installing it.",
      installerPackagePath:
        "/opt/homebrew/Caskroom/tailscale-app/1.96.2/Tailscale-1.96.2-macos.pkg",
    });
    mocks.launchMacApp.mockRejectedValueOnce(
      new Error("Tailscale app is not installed on this Mac."),
    );

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "platform:gmail-hook:tailscale-install",
      inputs: {
        account: "automation@example.com",
      },
    });
    await invoke();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "platform:gmail-hook",
        status: "needs_setup",
        message: expect.stringContaining("Finish the installer package"),
        authSteps: expect.arrayContaining([
          expect.objectContaining({
            connectorId: "platform:gmail-hook:tailscale-open-installer",
          }),
        ]),
      }),
    );
  });

  it("checks Tailscale and automatically resumes Gmail setup once connected", async () => {
    mocks.getTailscaleConnectionSummary.mockResolvedValue({
      appInstalled: true,
      connected: true,
      dnsName: "host.tailnet.ts.net",
      detail: "Tailscale is connected as host.tailnet.ts.net.",
      installerPackagePath: null,
    });
    mocks.runGmailSetup.mockResolvedValue({
      projectId: "proj-123",
      topic: "gmail-push",
      subscription: "gmail-push-sub",
      pushEndpoint: "https://host.tailnet.ts.net/gmail-pubsub?token=secret",
      hookUrl: "http://127.0.0.1:8788/gmail-pubsub",
      serve: { bind: "127.0.0.1", port: 8788, path: "/gmail-pubsub" },
    });

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "platform:gmail-hook:tailscale-check",
      inputs: {
        account: "automation@example.com",
        pushEndpoint: "https://example.com/gmail-pubsub?token=test",
      },
    });
    await invoke();

    expect(mocks.runGmailSetup).toHaveBeenCalledWith(
      expect.objectContaining({
        account: "automation@example.com",
        interactiveAuth: false,
      }),
    );
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "platform:gmail-hook",
        status: "configured",
        summary: expect.objectContaining({
          pushEndpoint: "https://host.tailnet.ts.net/gmail-pubsub?token=secret",
        }),
      }),
    );
  });

  it("rejects a bare IP push endpoint before calling gcloud", async () => {
    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "platform:gmail-hook",
      inputs: {
        account: "automation@example.com",
        pushEndpoint: "100.76.180.116",
      },
    });
    await invoke();

    expect(mocks.runGmailSetup).not.toHaveBeenCalled();
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "platform:gmail-hook",
        status: "needs_setup",
        message: expect.stringContaining("full public HTTPS URL"),
      }),
    );
  });

  it("opens the Tailscale Funnel enable page", async () => {
    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "platform:gmail-hook:tailscale-funnel-enable",
      inputs: {
        account: "automation@example.com",
        funnelEnableUrl: "https://login.tailscale.com/f/funnel?node=node-123",
      },
    });
    await invoke();

    expect(mocks.launchMacPath).toHaveBeenCalledWith(
      "https://login.tailscale.com/f/funnel?node=node-123",
    );
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "platform:gmail-hook",
        status: "started",
        summary: expect.objectContaining({
          command: "open https://login.tailscale.com/f/funnel?node=node-123",
        }),
      }),
    );
  });

  it("imports the Gmail OAuth client JSON and returns the next sign-in step", async () => {
    mocks.getActiveGcloudAccount.mockResolvedValue("user@example.com");
    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "platform:gmail-hook:gog-credentials",
      inputs: {
        account: "automation@example.com",
        credentialsJson: '{"installed":{"client_id":"123.apps.googleusercontent.com"}}',
        filename: "client-secret.json",
      },
    });
    await invoke();

    expect(mocks.importGogCredentialsJson).toHaveBeenCalledWith(
      '{"installed":{"client_id":"123.apps.googleusercontent.com"}}',
      "client-secret.json",
    );
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "platform:gmail-hook",
        status: "needs_auth",
        message: "OAuth client JSON imported. Sign in to gog next, then retry Gmail setup.",
        authSteps: expect.arrayContaining([
          expect.objectContaining({
            connectorId: "platform:gmail-hook:gog-auth",
            command:
              "gog login automation@example.com --client openclaw-gmail-hook --services gmail --gmail-scope full --force-consent",
          }),
        ]),
      }),
    );
  });

  it("returns a Gmail scope re-consent handoff when Google rejects the current token scopes", async () => {
    mocks.runGmailSetup.mockRejectedValue(
      new Error(
        "Google API error (403 insufficientPermissions): Request had insufficient authentication scopes.",
      ),
    );
    mocks.getActiveGcloudAccount.mockResolvedValue("user@example.com");
    mocks.getGogAuthStatus.mockResolvedValue({
      credentialsExists: true,
      email: "automation@example.com",
    });

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "platform:gmail-hook",
      inputs: {
        account: "automation@example.com",
      },
    });
    await invoke();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "platform:gmail-hook",
        status: "needs_auth",
        message: expect.stringContaining("missing Gmail scopes"),
        authSteps: expect.arrayContaining([
          expect.objectContaining({
            connectorId: "platform:gmail-hook:gog-auth",
            label: "Grant Gmail access in gog",
            command:
              "gog login automation@example.com --client openclaw-gmail-hook --services gmail --gmail-scope full --force-consent",
          }),
        ]),
      }),
    );
  });

  it("keeps Gmail resumed sub-step failures in the guided auth flow", async () => {
    mocks.runGmailSetup.mockRejectedValue(
      new Error(
        "Google API error (403 insufficientPermissions): Request had insufficient authentication scopes.",
      ),
    );
    mocks.getActiveGcloudAccount.mockResolvedValue("user@example.com");
    mocks.getGogAuthStatus.mockResolvedValue({
      credentialsExists: true,
      email: "automation@example.com",
    });
    mocks.getTailscaleConnectionSummary.mockResolvedValue({
      appInstalled: true,
      connected: true,
      dnsName: "host.tailnet.ts.net",
      detail: "connected",
      installerPackagePath: null,
    });

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "platform:gmail-hook:tailscale-check",
      inputs: {
        account: "automation@example.com",
      },
    });
    await invoke();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "platform:gmail-hook",
        status: "needs_auth",
        authSteps: expect.arrayContaining([
          expect.objectContaining({
            connectorId: "platform:gmail-hook:gog-auth",
            label: "Grant Gmail access in gog",
          }),
        ]),
      }),
    );
  });

  it("runs live verification for a builder plan", async () => {
    mocks.verifyAgentBlueprintBuilderPlan.mockResolvedValue({
      draft: {
        brief: "Create a support bot on Telegram",
        templateId: "support-responder",
        displayName: "Support Responder",
        confidence: "high",
        plannerStatus: "ready",
        reasons: ["Matched support language."],
        assumptions: [],
        questions: [],
        ready: true,
        requirements: {
          intentTags: ["support"],
          triggers: [],
          inputs: [],
          transforms: [],
          decisions: [],
          actions: [],
          outputs: [],
          policies: [],
          constraints: [],
          missingInputs: [],
          setupGaps: [],
          policyGaps: [],
          unsupportedGaps: [],
        },
        planning: {
          selections: [],
          integrations: [
            {
              connectorId: "channel:telegram",
              instanceId: "channel:telegram",
              status: "verified",
              configRefs: ["channels.telegram"],
              authRefs: ["channels.telegram"],
              issues: [],
              lastVerifiedAt: "2026-03-18T12:00:00.000Z",
              label: "Telegram",
              kind: "channel",
              sourceKind: "builtin_channel",
              contracts: ["ingress.chat", "delivery.chat", "message.send"],
              verification: [],
            },
          ],
          setupTasks: [],
          verifications: [
            {
              id: "channel:telegram:status",
              connectorId: "channel:telegram",
              connectorLabel: "Telegram",
              probeKind: "status",
              probeLabel: "Status probe",
              status: "passed",
              detail: "Telegram responded to a live account probe successfully.",
              source: "live",
              checkedAt: "2026-03-18T12:00:00.000Z",
            },
          ],
        },
        extracted: {
          agentId: "support",
          name: "Support",
          ingressChannels: ["telegram"],
          sourceChannels: [],
          deliveryTarget: null,
          schedule: null,
        },
      },
      verification: {
        fingerprint: "abc123",
        checkedAt: "2026-03-18T12:00:00.000Z",
        passedCount: 1,
        failedCount: 0,
        blockedCount: 0,
        unresolvedCount: 0,
        results: [],
      },
      plan: {
        status: "ready",
      },
    });

    const { respond, invoke } = createInvokeParams("agents.builder.verify", {
      brief: "Create a support bot on Telegram",
    });
    await invoke();

    expect(mocks.verifyAgentBlueprintBuilderPlan).toHaveBeenCalledWith({
      brief: "Create a support bot on Telegram",
      cfg: { agents: { default: "main" } },
    });
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        verification: expect.objectContaining({
          passedCount: 1,
        }),
      }),
    );
  });
});
