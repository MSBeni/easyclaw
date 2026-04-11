import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../protocol/index.js";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(() => ({ agents: { default: "main" } })),
  writeConfigFile: vi.fn(async () => {}),
  getChannelPluginCatalogEntry: vi.fn(),
  clearPluginDiscoveryCache: vi.fn(),
  enablePluginInConfig: vi.fn((cfg: Record<string, unknown>, pluginId: string) => {
    const plugins = (cfg.plugins as Record<string, unknown> | undefined) ?? {};
    const enabled = Array.isArray(plugins.enabled) ? plugins.enabled : [];
    return {
      enabled: true,
      config: {
        ...cfg,
        plugins: {
          ...plugins,
          enabled: [...enabled, pluginId],
        },
      },
    };
  }),
  installPluginFromNpmSpec: vi.fn(),
  buildNpmResolutionInstallFields: vi.fn(() => ({})),
  recordPluginInstall: vi.fn((cfg: Record<string, unknown>, update: Record<string, unknown>) => {
    const plugins = (cfg.plugins as Record<string, unknown> | undefined) ?? {};
    const installs =
      plugins.installs && typeof plugins.installs === "object" && !Array.isArray(plugins.installs)
        ? (plugins.installs as Record<string, unknown>)
        : {};
    return {
      ...cfg,
      plugins: {
        ...plugins,
        installs: {
          ...installs,
          [String(update.pluginId)]: update,
        },
      },
    };
  }),
  compileAgentBlueprintBuilderPlan: vi.fn(),
  applyAgentBlueprintBuilderPlan: vi.fn(),
  verifyAgentBlueprintBuilderPlan: vi.fn(),
  resolveSlackAccount: vi.fn(),
  probeSlack: vi.fn(),
  createSlackWebClient: vi.fn(),
  slackApiCall: vi.fn(),
  resolveDiscordAccount: vi.fn(),
  fetchDiscord: vi.fn(),
  listGuilds: vi.fn(),
  probeDiscord: vi.fn(),
  resolveGoogleChatAccount: vi.fn(),
  probeGoogleChat: vi.fn(),
  resolveIMessageAccount: vi.fn(),
  probeIMessage: vi.fn(),
  resolveMatrixAccount: vi.fn(),
  resolveMatrixAuth: vi.fn(),
  probeMatrix: vi.fn(),
  probeMSTeams: vi.fn(),
  resolveSignalAccount: vi.fn(),
  probeSignal: vi.fn(),
  resolveTelegramAccount: vi.fn(),
  fetchTelegramBotIdentity: vi.fn(),
  fetchTelegramLatestDeliveryTarget: vi.fn(),
  resolveWhatsAppAccount: vi.fn(),
  readWebSelfId: vi.fn(),
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

vi.mock("../../channels/plugins/catalog.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../channels/plugins/catalog.js")>();
  return {
    ...actual,
    getChannelPluginCatalogEntry: mocks.getChannelPluginCatalogEntry,
  };
});

vi.mock("../../plugins/discovery.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../plugins/discovery.js")>();
  return {
    ...actual,
    clearPluginDiscoveryCache: mocks.clearPluginDiscoveryCache,
  };
});

vi.mock("../../plugins/enable.js", () => ({
  enablePluginInConfig: mocks.enablePluginInConfig,
}));

vi.mock("../../plugins/install.js", () => ({
  installPluginFromNpmSpec: mocks.installPluginFromNpmSpec,
}));

vi.mock("../../plugins/installs.js", () => ({
  buildNpmResolutionInstallFields: mocks.buildNpmResolutionInstallFields,
  recordPluginInstall: mocks.recordPluginInstall,
}));

vi.mock("../../../extensions/telegram/src/accounts.js", () => ({
  resolveTelegramAccount: mocks.resolveTelegramAccount,
}));

vi.mock("../../../extensions/slack/src/accounts.js", () => ({
  resolveSlackAccount: mocks.resolveSlackAccount,
}));

vi.mock("../../../extensions/slack/src/probe.js", () => ({
  probeSlack: mocks.probeSlack,
}));

vi.mock("../../../extensions/slack/src/client.js", () => ({
  createSlackWebClient: mocks.createSlackWebClient,
}));

vi.mock("../../../extensions/discord/src/accounts.js", () => ({
  resolveDiscordAccount: mocks.resolveDiscordAccount,
}));

vi.mock("../../../extensions/discord/src/api.js", () => ({
  fetchDiscord: mocks.fetchDiscord,
}));

vi.mock("../../../extensions/discord/src/guilds.js", () => ({
  listGuilds: mocks.listGuilds,
}));

vi.mock("../../../extensions/discord/src/probe.js", () => ({
  probeDiscord: mocks.probeDiscord,
}));

vi.mock("../../../extensions/googlechat/src/accounts.js", () => ({
  resolveGoogleChatAccount: mocks.resolveGoogleChatAccount,
}));

vi.mock("../../../extensions/googlechat/src/api.js", () => ({
  probeGoogleChat: mocks.probeGoogleChat,
}));

vi.mock("../../../extensions/imessage/src/accounts.js", () => ({
  resolveIMessageAccount: mocks.resolveIMessageAccount,
}));

vi.mock("../../../extensions/imessage/src/probe.js", () => ({
  probeIMessage: mocks.probeIMessage,
}));

vi.mock("../../../extensions/matrix/src/matrix/accounts.js", () => ({
  resolveMatrixAccount: mocks.resolveMatrixAccount,
}));

vi.mock("../../../extensions/matrix/src/matrix/client/config.js", () => ({
  resolveMatrixAuth: mocks.resolveMatrixAuth,
}));

vi.mock("../../../extensions/matrix/src/matrix/probe.js", () => ({
  probeMatrix: mocks.probeMatrix,
}));

vi.mock("../../../extensions/msteams/src/probe.js", () => ({
  probeMSTeams: mocks.probeMSTeams,
}));

vi.mock("../../../extensions/signal/src/accounts.js", () => ({
  resolveSignalAccount: mocks.resolveSignalAccount,
}));

vi.mock("../../../extensions/signal/src/probe.js", () => ({
  probeSignal: mocks.probeSignal,
}));

vi.mock("../../../extensions/telegram/src/api-fetch.js", () => ({
  fetchTelegramBotIdentity: mocks.fetchTelegramBotIdentity,
  fetchTelegramLatestDeliveryTarget: mocks.fetchTelegramLatestDeliveryTarget,
}));

vi.mock("../../../extensions/whatsapp/src/accounts.js", () => ({
  resolveWhatsAppAccount: mocks.resolveWhatsAppAccount,
}));

vi.mock("../../../extensions/whatsapp/src/auth-store.js", () => ({
  readWebSelfId: mocks.readWebSelfId,
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
  const context = {
    cron: {
      list: vi.fn(),
      add: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    },
  };
  return {
    respond,
    context,
    invoke: async () =>
      await builderHandlers[method]({
        params,
        respond: respond as never,
        context: context as never,
        client: null,
        req: { type: "req", id: "req-1", method },
        isWebchatConnect: () => false,
      }),
  };
}

describe("builder gateway handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfig.mockReturnValue({ agents: { default: "main" } });
    mocks.createSlackWebClient.mockReturnValue({
      apiCall: mocks.slackApiCall,
    });
    mocks.slackApiCall.mockResolvedValue({
      ok: true,
      url: "wss://slack.example/socket",
    });
    mocks.resolveSlackAccount.mockReturnValue({
      accountId: "default",
      enabled: true,
      botToken: "xoxb-test-token",
      appToken: "xapp-test-token",
      config: {
        mode: "socket",
      },
    });
    mocks.probeSlack.mockResolvedValue({
      ok: true,
      status: 200,
      elapsedMs: 12,
      bot: { id: "B123", name: "openclaw" },
      team: { id: "T123", name: "OpenClaw Team" },
    });
    mocks.resolveDiscordAccount.mockReturnValue({
      accountId: "default",
      enabled: true,
      token: "discord-token",
      tokenSource: "config",
      config: {},
    });
    mocks.probeDiscord.mockResolvedValue({
      ok: true,
      status: 200,
      elapsedMs: 11,
      bot: { id: "12345", username: "openclaw-bot" },
    });
    mocks.listGuilds.mockResolvedValue([
      {
        id: "9876543210",
        name: "OpenClaw Lab",
      },
    ]);
    mocks.fetchDiscord.mockResolvedValue([
      {
        id: "1234567890",
        name: "general",
        type: 0,
      },
    ]);
    mocks.resolveGoogleChatAccount.mockReturnValue({
      accountId: "default",
      enabled: true,
      config: {
        audienceType: "app-url",
        audience: "https://chat.googleapis.com/",
      },
      credentialSource: "inline",
    });
    mocks.probeGoogleChat.mockResolvedValue({
      ok: true,
      status: 200,
    });
    mocks.resolveIMessageAccount.mockReturnValue({
      accountId: "default",
      enabled: true,
      configured: true,
      config: {
        cliPath: "imsg",
      },
    });
    mocks.probeIMessage.mockResolvedValue({
      ok: true,
    });
    mocks.resolveMatrixAccount.mockReturnValue({
      accountId: "default",
      enabled: true,
      configured: true,
      homeserver: "https://matrix.org",
      userId: "@openclaw-bot:matrix.org",
      config: {},
    });
    mocks.resolveMatrixAuth.mockResolvedValue({
      homeserver: "https://matrix.org",
      userId: "@openclaw-bot:matrix.org",
      accessToken: "matrix-token",
      deviceName: undefined,
      initialSyncLimit: undefined,
      encryption: false,
    });
    mocks.probeMatrix.mockResolvedValue({
      ok: true,
      status: 200,
      elapsedMs: 15,
      error: null,
      userId: "@openclaw-bot:matrix.org",
    });
    mocks.probeMSTeams.mockResolvedValue({
      ok: true,
      appId: "teams-app-id",
      graph: { ok: true },
    });
    mocks.resolveSignalAccount.mockReturnValue({
      accountId: "default",
      enabled: true,
      baseUrl: "http://127.0.0.1:8080",
      configured: true,
      config: {
        account: "+15551234567",
      },
    });
    mocks.probeSignal.mockResolvedValue({
      ok: true,
      status: 200,
      elapsedMs: 10,
      version: "0.13.0",
      error: null,
    });
    mocks.getChannelPluginCatalogEntry.mockReturnValue(undefined);
    mocks.installPluginFromNpmSpec.mockResolvedValue({
      ok: true,
      pluginId: "msteams",
      targetDir: "/tmp/openclaw/extensions/msteams",
      version: "1.2.3",
      npmResolution: undefined,
    });
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
    mocks.resolveWhatsAppAccount.mockReturnValue({
      accountId: "default",
      authDir: "/tmp/openclaw-whatsapp/default",
      enabled: true,
      sendReadReceipts: true,
      isLegacyAuthDir: false,
    });
    mocks.readWebSelfId.mockReturnValue({
      e164: null,
      jid: null,
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

  it("hydrates whatsapp default target for planning from linked session identity", async () => {
    mocks.loadConfig.mockReturnValue({
      agents: { default: "main" },
      channels: {
        whatsapp: {
          enabled: true,
        },
      },
    });
    mocks.readWebSelfId.mockReturnValue({
      e164: "+15550001111",
      jid: "15550001111@s.whatsapp.net",
    });
    mocks.compileAgentBlueprintBuilderPlan.mockResolvedValue({
      draft: {
        templateId: "daily-briefing",
      },
      plan: {
        status: "ready",
      },
    });

    const { invoke } = createInvokeParams("agents.builder.plan", {
      brief: "Send my daily briefing to WhatsApp.",
    });
    await invoke();

    expect(mocks.compileAgentBlueprintBuilderPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        brief: "Send my daily briefing to WhatsApp.",
        cfg: expect.objectContaining({
          channels: expect.objectContaining({
            whatsapp: expect.objectContaining({
              defaultTo: "+15550001111",
            }),
          }),
        }),
      }),
    );
    expect(mocks.writeConfigFile).not.toHaveBeenCalled();
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

  it("normalizes unqualified model selections to provider/model when uniquely configured", async () => {
    mocks.loadConfig.mockReturnValue({
      agents: { default: "main" },
      models: {
        providers: {
          google: {
            models: [{ id: "gemini-3-flash", name: "Gemini 3 Flash" }],
          },
        },
      },
    });
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
      modelId: "gemini-3-flash",
    });
    await invoke();

    expect(mocks.compileAgentBlueprintBuilderPlan).toHaveBeenCalledWith({
      brief: "Create me a daily digest",
      modelId: "google/gemini-3-flash",
      cfg: expect.objectContaining({
        models: expect.objectContaining({
          providers: expect.objectContaining({
            google: expect.any(Object),
          }),
        }),
      }),
    });
  });

  it("forwards agent name overrides to planning", async () => {
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
      agentName: "Podcast Ideas Bot",
    });
    await invoke();

    expect(mocks.compileAgentBlueprintBuilderPlan).toHaveBeenCalledWith({
      brief: "Create me a daily digest",
      agentName: "Podcast Ideas Bot",
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

    const { respond, context, invoke } = createInvokeParams("agents.builder.apply", {
      brief: "Create a support bot on Telegram",
    });
    await invoke();

    expect(mocks.applyAgentBlueprintBuilderPlan).toHaveBeenCalledWith({
      brief: "Create a support bot on Telegram",
      cfg: { agents: { default: "main" } },
      cron: context.cron,
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

  it("forwards edited managed workspace docs when applying a builder plan", async () => {
    mocks.applyAgentBlueprintBuilderPlan.mockResolvedValue({
      draft: {
        brief: "Create a support bot on Telegram",
        templateId: "support-responder",
        displayName: "Support Responder",
        confidence: "high",
        plannerStatus: "ready",
        reasons: [],
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
          integrations: [],
          setupTasks: [],
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

    const { context, invoke } = createInvokeParams("agents.builder.apply", {
      brief: "Create a support bot on Telegram",
      workspaceDocEdits: [
        {
          nodeId: "coordinator",
          fileName: "AGENTS.md",
          content: "## Reviewed Instructions\n\n- Escalate risky issues quickly.",
        },
      ],
    });
    await invoke();

    expect(mocks.applyAgentBlueprintBuilderPlan).toHaveBeenCalledWith({
      brief: "Create a support bot on Telegram",
      workspaceDocEdits: [
        {
          nodeId: "coordinator",
          fileName: "AGENTS.md",
          content: "## Reviewed Instructions\n\n- Escalate risky issues quickly.",
        },
      ],
      cfg: { agents: { default: "main" } },
      cron: context.cron,
    });
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

  it("auto-detects WhatsApp default target from linked self identity", async () => {
    mocks.readWebSelfId.mockReturnValue({
      e164: "+15551234567",
      jid: "15551234567@s.whatsapp.net",
    });

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "channel:whatsapp:auto-default-target",
      inputs: {},
    });
    await invoke();

    expect(mocks.writeConfigFile).toHaveBeenCalledWith(
      expect.objectContaining({
        channels: expect.objectContaining({
          whatsapp: expect.objectContaining({
            defaultTo: "+15551234567",
          }),
        }),
      }),
    );
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "channel:whatsapp:auto-default-target",
        status: "configured",
        message: expect.stringContaining("default target set to +15551234567"),
        updatedRefs: ["channels.whatsapp.defaultTo"],
      }),
    );
  });

  it("sets WhatsApp default target to an explicit manual destination", async () => {
    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "channel:whatsapp:auto-default-target",
      inputs: {
        "whatsapp.target": "+14155551234",
      },
    });
    await invoke();

    expect(mocks.writeConfigFile).toHaveBeenCalledWith(
      expect.objectContaining({
        channels: expect.objectContaining({
          whatsapp: expect.objectContaining({
            defaultTo: "+14155551234",
          }),
        }),
      }),
    );
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "channel:whatsapp:auto-default-target",
        status: "configured",
        message: expect.stringContaining("default target set to +14155551234"),
      }),
    );
  });

  it("rejects invalid manual WhatsApp destination inputs", async () => {
    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "channel:whatsapp:auto-default-target",
      inputs: {
        "whatsapp.target": "not-a-number",
      },
    });
    await invoke();

    expect(mocks.writeConfigFile).not.toHaveBeenCalled();
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "channel:whatsapp:auto-default-target",
        status: "needs_setup",
        message: expect.stringContaining("Invalid WhatsApp destination"),
      }),
    );
  });

  it("returns setup guidance when WhatsApp self identity is unavailable", async () => {
    mocks.readWebSelfId.mockReturnValue({
      e164: null,
      jid: null,
    });

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "channel:whatsapp:auto-default-target",
      inputs: {},
    });
    await invoke();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "channel:whatsapp:auto-default-target",
        status: "needs_setup",
        message: expect.stringContaining("could not find a linked account identity"),
        resume: expect.objectContaining({
          connectorId: "channel:whatsapp:auto-default-target",
          label: "Auto-detect WhatsApp target",
        }),
      }),
    );
  });

  it("auto-detects Slack default target and writes channels.slack.defaultTo", async () => {
    mocks.slackApiCall.mockResolvedValue({
      ok: true,
      channels: [{ id: "C024BE91L", name: "ops", is_member: true, is_archived: false }],
    });

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "channel:slack:auto-default-target",
      inputs: {},
    });
    await invoke();

    expect(mocks.slackApiCall).toHaveBeenCalledWith(
      "conversations.list",
      expect.objectContaining({
        types: "public_channel,private_channel,im,mpim",
        exclude_archived: true,
      }),
    );
    expect(mocks.writeConfigFile).toHaveBeenCalledWith(
      expect.objectContaining({
        channels: expect.objectContaining({
          slack: expect.objectContaining({
            defaultTo: "channel:C024BE91L",
          }),
        }),
      }),
    );
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "channel:slack:auto-default-target",
        status: "configured",
        message: expect.stringContaining("Slack default target set to"),
        updatedRefs: ["channels.slack.defaultTo"],
      }),
    );
  });

  it("returns retry guidance when Slack auto-detect finds no visible conversations", async () => {
    mocks.slackApiCall.mockResolvedValue({
      ok: true,
      channels: [],
    });

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "channel:slack:auto-default-target",
      inputs: {},
    });
    await invoke();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "channel:slack:auto-default-target",
        status: "needs_setup",
        message: expect.stringContaining("did not find any visible conversations"),
        resume: expect.objectContaining({
          connectorId: "channel:slack:auto-default-target",
          label: "Auto-detect Slack target",
        }),
      }),
    );
  });

  it("refuses to save a hinted Slack target when the bot is not in that channel", async () => {
    mocks.slackApiCall.mockResolvedValue({
      ok: true,
      channels: [{ id: "C024BE91L", name: "engineering", is_member: false, is_archived: false }],
    });

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "channel:slack:auto-default-target",
      inputs: { target: "#engineering" },
    });
    await invoke();

    expect(mocks.writeConfigFile).not.toHaveBeenCalled();
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "channel:slack:auto-default-target",
        status: "needs_setup",
        message: expect.stringContaining("bot is not a member"),
        resume: expect.objectContaining({
          connectorId: "channel:slack:auto-default-target",
          label: "Auto-detect Slack target",
        }),
      }),
    );
  });

  it("refuses to auto-select Slack conversations the bot cannot post into", async () => {
    mocks.slackApiCall.mockResolvedValue({
      ok: true,
      channels: [{ id: "C024BE91L", name: "engineering", is_member: false, is_archived: false }],
    });

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "channel:slack:auto-default-target",
      inputs: {},
    });
    await invoke();

    expect(mocks.writeConfigFile).not.toHaveBeenCalled();
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "channel:slack:auto-default-target",
        status: "needs_setup",
        message: expect.stringContaining("bot is not joined to any deliverable conversation"),
        resume: expect.objectContaining({
          connectorId: "channel:slack:auto-default-target",
          label: "Auto-detect Slack target",
        }),
      }),
    );
  });

  it("explains required Slack scopes when auto-detect hits missing_scope", async () => {
    mocks.slackApiCall.mockRejectedValue(new Error("An API error occurred: missing_scope"));

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "channel:slack:auto-default-target",
      inputs: {},
    });
    await invoke();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "channel:slack:auto-default-target",
        status: "needs_setup",
        message: expect.stringContaining(
          "Add Slack bot scopes channels:read, groups:read, im:read, mpim:read",
        ),
        resume: expect.objectContaining({
          connectorId: "channel:slack:auto-default-target",
          label: "Auto-detect Slack target",
        }),
      }),
    );
  });

  it("verifies Slack bot and app credentials with live API checks", async () => {
    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "channel:slack:verify-credentials",
      inputs: {},
    });
    await invoke();

    expect(mocks.probeSlack).toHaveBeenCalledWith("xoxb-test-token", 5000);
    expect(mocks.slackApiCall).toHaveBeenCalledWith("apps.connections.open");

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "channel:slack:verify-credentials",
        status: "configured",
        message: expect.stringContaining("Slack credentials are valid"),
      }),
    );
  });

  it("reports Slack app-token setup requirements for socket mode", async () => {
    mocks.resolveSlackAccount.mockReturnValue({
      accountId: "default",
      enabled: true,
      botToken: "xoxb-test-token",
      appToken: "",
      config: {
        mode: "socket",
      },
    });

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "channel:slack:verify-credentials",
      inputs: {},
    });
    await invoke();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "channel:slack:verify-credentials",
        status: "needs_setup",
        message: expect.stringContaining("app token is missing"),
      }),
    );
  });

  it("auto-detects Discord default target and writes channels.discord.defaultTo", async () => {
    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "channel:discord:auto-default-target",
      inputs: {},
    });
    await invoke();

    expect(mocks.listGuilds).toHaveBeenCalledWith("discord-token", fetch);
    expect(mocks.fetchDiscord).toHaveBeenCalledWith("/guilds/9876543210/channels", "discord-token");
    expect(mocks.writeConfigFile).toHaveBeenCalledWith(
      expect.objectContaining({
        channels: expect.objectContaining({
          discord: expect.objectContaining({
            defaultTo: "channel:1234567890",
          }),
        }),
      }),
    );
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "channel:discord:auto-default-target",
        status: "configured",
        message: expect.stringContaining("Discord default target set to"),
      }),
    );
  });

  it("returns retry guidance when Discord auto-detect sees no guild membership", async () => {
    mocks.listGuilds.mockResolvedValue([]);

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "channel:discord:auto-default-target",
      inputs: {},
    });
    await invoke();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "channel:discord:auto-default-target",
        status: "needs_setup",
        message: expect.stringContaining("did not find any guilds"),
        resume: expect.objectContaining({
          connectorId: "channel:discord:auto-default-target",
          label: "Auto-detect Discord target",
        }),
      }),
    );
  });

  it("verifies Discord token against the bot identity endpoint", async () => {
    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "channel:discord:verify-token",
      inputs: {},
    });
    await invoke();

    expect(mocks.probeDiscord).toHaveBeenCalledWith("discord-token", 5000, {
      includeApplication: true,
    });

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "channel:discord:verify-token",
        status: "configured",
        message: expect.stringContaining("@openclaw-bot"),
      }),
    );
  });

  it("auto-detects Signal HTTP transport URL and writes channels.signal.httpUrl", async () => {
    mocks.probeSignal.mockImplementation(async (baseUrl: string) => {
      if (baseUrl === "http://localhost:8080") {
        return {
          ok: true,
          status: 200,
          elapsedMs: 8,
          version: "0.13.0",
          error: null,
        };
      }
      return {
        ok: false,
        status: 503,
        elapsedMs: 6,
        version: null,
        error: "unreachable",
      };
    });

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "channel:signal:auto-detect-http-url",
      inputs: {
        httpUrl: "http://localhost:8080",
      },
    });
    await invoke();

    expect(mocks.writeConfigFile).toHaveBeenCalledWith(
      expect.objectContaining({
        channels: expect.objectContaining({
          signal: expect.objectContaining({
            httpUrl: "http://localhost:8080",
          }),
        }),
      }),
    );
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "channel:signal:auto-detect-http-url",
        status: "configured",
        message: expect.stringContaining("Signal transport URL set to"),
        updatedRefs: ["channels.signal.httpUrl"],
      }),
    );
  });

  it("returns retry guidance when Signal auto-detect cannot reach transport", async () => {
    mocks.probeSignal.mockResolvedValue({
      ok: false,
      status: 503,
      elapsedMs: 6,
      version: null,
      error: "unreachable",
    });

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "channel:signal:auto-detect-http-url",
      inputs: {},
    });
    await invoke();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "channel:signal:auto-detect-http-url",
        status: "needs_setup",
        message: expect.stringContaining("could not reach signal-cli"),
        resume: expect.objectContaining({
          connectorId: "channel:signal:auto-detect-http-url",
          label: "Auto-detect Signal URL",
        }),
      }),
    );
  });

  it("verifies Signal transport availability and readiness", async () => {
    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "channel:signal:verify-transport",
      inputs: {},
    });
    await invoke();

    expect(mocks.probeSignal).toHaveBeenCalledWith("http://127.0.0.1:8080", 5000);
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "channel:signal:verify-transport",
        status: "configured",
        message: expect.stringContaining("Signal transport is reachable"),
      }),
    );
  });

  it("verifies Google Chat service-account auth and audience readiness", async () => {
    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "channel:googlechat:verify-auth",
      inputs: {},
    });
    await invoke();

    expect(mocks.resolveGoogleChatAccount).toHaveBeenCalled();
    expect(mocks.probeGoogleChat).toHaveBeenCalled();
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "channel:googlechat:verify-auth",
        status: "configured",
        message: expect.stringContaining("Google Chat credentials are valid"),
      }),
    );
  });

  it("returns retry guidance when Google Chat credentials are missing", async () => {
    mocks.resolveGoogleChatAccount.mockReturnValue({
      accountId: "default",
      enabled: true,
      config: {
        audienceType: "app-url",
        audience: "https://chat.googleapis.com/",
      },
      credentialSource: "none",
    });

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "channel:googlechat:verify-auth",
      inputs: {},
    });
    await invoke();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "channel:googlechat:verify-auth",
        status: "needs_setup",
        message: expect.stringContaining("service-account credentials are missing"),
        resume: expect.objectContaining({
          connectorId: "channel:googlechat:verify-auth",
          label: "Verify Google Chat auth",
        }),
      }),
    );
  });

  it("verifies Matrix credentials with whoami probe", async () => {
    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "channel:matrix:verify-credentials",
      inputs: {},
    });
    await invoke();

    expect(mocks.resolveMatrixAuth).toHaveBeenCalled();
    expect(mocks.probeMatrix).toHaveBeenCalledWith({
      homeserver: "https://matrix.org",
      accessToken: "matrix-token",
      userId: "@openclaw-bot:matrix.org",
      timeoutMs: 5000,
    });
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "channel:matrix:verify-credentials",
        status: "configured",
        message: expect.stringContaining("Matrix credentials are valid"),
      }),
    );
  });

  it("returns retry guidance when Matrix credential verification fails", async () => {
    mocks.probeMatrix.mockResolvedValue({
      ok: false,
      status: 401,
      elapsedMs: 8,
      error: "Unauthorized",
      userId: "@openclaw-bot:matrix.org",
    });

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "channel:matrix:verify-credentials",
      inputs: {},
    });
    await invoke();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "channel:matrix:verify-credentials",
        status: "needs_setup",
        message: expect.stringContaining("Matrix credential verification failed"),
        resume: expect.objectContaining({
          connectorId: "channel:matrix:verify-credentials",
          label: "Verify Matrix credentials",
        }),
      }),
    );
  });

  it("verifies Microsoft Teams credentials", async () => {
    mocks.loadConfig.mockReturnValueOnce({
      agents: { default: "main" },
      channels: {
        msteams: {
          enabled: true,
          appId: "teams-app-id",
          appPassword: "teams-app-password",
          tenantId: "teams-tenant",
        },
      },
    } as unknown as ReturnType<typeof mocks.loadConfig>);

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "channel:msteams:verify-credentials",
      inputs: {},
    });
    await invoke();

    expect(mocks.probeMSTeams).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "teams-app-id",
        appPassword: "teams-app-password",
        tenantId: "teams-tenant",
      }),
    );
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "channel:msteams:verify-credentials",
        status: "configured",
        message: expect.stringContaining("Microsoft Teams credentials are valid"),
      }),
    );
  });

  it("returns retry guidance when Microsoft Teams verification fails", async () => {
    mocks.loadConfig.mockReturnValueOnce({
      agents: { default: "main" },
      channels: {
        msteams: {
          enabled: true,
          appId: "teams-app-id",
          appPassword: "teams-app-password",
          tenantId: "teams-tenant",
        },
      },
    } as unknown as ReturnType<typeof mocks.loadConfig>);
    mocks.probeMSTeams.mockResolvedValue({
      ok: false,
      error: "missing credentials",
    });

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "channel:msteams:verify-credentials",
      inputs: {},
    });
    await invoke();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "channel:msteams:verify-credentials",
        status: "needs_setup",
        message: expect.stringContaining("Microsoft Teams credential verification failed"),
        resume: expect.objectContaining({
          connectorId: "channel:msteams:verify-credentials",
          label: "Verify Teams credentials",
        }),
      }),
    );
  });

  it("verifies iMessage transport using imsg rpc", async () => {
    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "channel:imessage:verify-transport",
      inputs: {},
    });
    await invoke();

    expect(mocks.probeIMessage).toHaveBeenCalledWith(5000, {});
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "channel:imessage:verify-transport",
        status: "configured",
        message: expect.stringContaining("iMessage transport is reachable"),
      }),
    );
  });

  it("returns retry guidance when iMessage transport verification fails", async () => {
    mocks.probeIMessage.mockResolvedValue({
      ok: false,
      error: "imsg rpc unavailable",
    });

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "channel:imessage:verify-transport",
      inputs: {},
    });
    await invoke();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "channel:imessage:verify-transport",
        status: "needs_setup",
        message: expect.stringContaining("iMessage transport verification failed"),
        resume: expect.objectContaining({
          connectorId: "channel:imessage:verify-transport",
          label: "Verify iMessage transport",
        }),
      }),
    );
  });

  it("returns generic auth guidance for connectors that are still disconnected", async () => {
    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "platform:webhook-runtime",
      inputs: {},
    });
    await invoke();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "platform:webhook-runtime",
        status: "needs_auth",
        updatedRefs: expect.arrayContaining(["hooks.token"]),
        resume: expect.objectContaining({
          connectorId: "platform:webhook-runtime",
        }),
      }),
    );
  });

  it("returns setup guidance when web tools provider is missing", async () => {
    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "tools:web",
      inputs: {},
    });
    await invoke();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "tools:web",
        status: "needs_setup",
        message: expect.stringContaining("Select a web search provider first"),
      }),
    );
  });

  it("saves web tools provider credentials and returns configured status", async () => {
    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "tools:web",
      inputs: {
        provider: "brave",
        apiKey: "brave-key",
      },
    });
    await invoke();

    expect(mocks.writeConfigFile).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.objectContaining({
          web: expect.objectContaining({
            search: expect.objectContaining({
              enabled: true,
              provider: "brave",
              apiKey: "brave-key",
            }),
          }),
        }),
      }),
    );
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "tools:web",
        status: "configured",
        message: expect.stringContaining('provider "brave"'),
        updatedRefs: expect.arrayContaining([
          "tools.web.search.provider",
          "tools.web.search.apiKey",
        ]),
      }),
    );
  });

  it("accepts action-native web setup requests", async () => {
    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      actionId: "tools:web:configure",
      connectorId: "tools:web",
      inputs: {
        provider: "brave",
        apiKey: "brave-key",
      },
    });
    await invoke();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "tools:web",
        actionId: "tools:web:configure",
        status: "configured",
      }),
    );
  });

  it("reports needs_auth when web tools provider is set without credentials", async () => {
    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      connectorId: "tools:web",
      inputs: {
        provider: "gemini",
      },
    });
    await invoke();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "tools:web",
        status: "needs_auth",
        message: expect.stringContaining("missing credentials"),
      }),
    );
  });

  it("installs channel plugins from the Builder install action", async () => {
    mocks.loadConfig.mockReturnValue({
      agents: { default: "main" },
      plugins: {},
    });
    mocks.getChannelPluginCatalogEntry.mockReturnValue({
      id: "msteams",
      meta: {
        id: "msteams",
        label: "Microsoft Teams",
        selectionLabel: "Microsoft Teams",
        docsPath: "/channels/msteams",
        blurb: "Teams channel",
      },
      install: {
        npmSpec: "@openclaw/msteams",
      },
    });

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      actionId: "channel:msteams:install",
      connectorId: "channel:msteams",
      inputs: {},
    });
    await invoke();

    expect(mocks.installPluginFromNpmSpec).toHaveBeenCalledWith({
      spec: "@openclaw/msteams",
      logger: expect.any(Object),
    });
    expect(mocks.writeConfigFile).toHaveBeenCalled();
    expect(mocks.clearPluginDiscoveryCache).toHaveBeenCalledTimes(1);
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        connectorId: "channel:msteams",
        actionId: "channel:msteams:install",
      }),
    );
  });

  it("returns retry guidance when a Builder plugin install fails", async () => {
    mocks.loadConfig.mockReturnValue({
      agents: { default: "main" },
      plugins: {},
    });
    mocks.getChannelPluginCatalogEntry.mockReturnValue({
      id: "msteams",
      meta: {
        id: "msteams",
        label: "Microsoft Teams",
        selectionLabel: "Microsoft Teams",
        docsPath: "/channels/msteams",
        blurb: "Teams channel",
      },
      install: {
        npmSpec: "@openclaw/msteams",
      },
    });
    mocks.installPluginFromNpmSpec.mockResolvedValue({
      ok: false,
      error: "npm registry temporarily unavailable",
    });

    const { respond, invoke } = createInvokeParams("agents.builder.setup.run", {
      actionId: "channel:msteams:install",
      connectorId: "channel:msteams",
      inputs: {},
    });
    await invoke();

    expect(mocks.writeConfigFile).not.toHaveBeenCalled();
    expect(mocks.clearPluginDiscoveryCache).not.toHaveBeenCalled();
    expect(mocks.enablePluginInConfig).not.toHaveBeenCalled();
    expect(mocks.recordPluginInstall).not.toHaveBeenCalled();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual({
      connectorId: "channel:msteams",
      actionId: "channel:msteams:install",
      status: "needs_setup",
      message: "Plugin install failed for Microsoft Teams: npm registry temporarily unavailable",
      updatedRefs: [],
      resume: {
        connectorId: "channel:msteams",
        actionId: "channel:msteams:install",
        label: "Install Microsoft Teams",
        detail: "Retry the npm install for @openclaw/msteams after fixing the install error.",
        inputs: {},
      },
      summary: {
        command: "npm install @openclaw/msteams",
      },
    });
  });

  it("returns generic configured status for connectors already ready", async () => {
    mocks.loadConfig.mockReturnValueOnce({
      agents: {
        default: "main",
        defaults: {
          model: "openai/gpt-4o",
        },
      },
    } as unknown as ReturnType<typeof mocks.loadConfig>);
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

  it("returns model setup guidance when no default model is configured", async () => {
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
        status: "needs_auth",
        message: expect.stringContaining("default model selection is not configured"),
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
