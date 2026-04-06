import { describe, expect, it } from "vitest";
import { listOpenClawConnectorDefinitions } from "../src/agents/capabilities/openclaw.ts";
import {
  connectorIdToConfigRef,
  hasPendingSetupTask,
  resolveBuilderQuestionConfigRefs,
  setupActionLabel,
} from "../ui/src/ui/views/builder.ts";
import { resolveQuickSetupForFocus } from "../ui/src/ui/views/quick-setup.ts";

function buildFocus(connector: ReturnType<typeof listOpenClawConnectorDefinitions>[number]) {
  const configRef = connectorIdToConfigRef(connector.id);
  return {
    connectorId: connector.id,
    connectorLabel: connector.label,
    connectorKind: connector.kind,
    connectorSourceKind: connector.source.kind,
    connectorDocsPath: connector.metadata.docsPath ?? null,
    connectorSelectionLabel: connector.metadata.selectionLabel ?? null,
    connectorDetailLabel: connector.metadata.detailLabel ?? null,
    connectorOnboarding: connector.setup.onboarding,
    connectorRequiresConfig: connector.setup.requiresConfig,
    connectorRequiresAuth: connector.setup.requiresAuth,
    connectorInstallRequired: connector.install.required,
    connectorInstallStrategy: connector.install.strategy,
    title: `Open ${connector.label} setup`,
    detail: `${connector.label} needs setup.`,
    refs: configRef ? [configRef] : [],
    targetTab: "config" as const,
  };
}

describe("connectorIdToConfigRef", () => {
  it("routes built-in and plugin chat connectors to their dedicated channels setup", () => {
    expect(connectorIdToConfigRef("channel:telegram")).toBe("channels.telegram");
    expect(connectorIdToConfigRef("channel:slack")).toBe("channels.slack");
    expect(connectorIdToConfigRef("channel:matrix")).toBe("channels.matrix");
  });

  it("routes platform connectors to focused setup sections", () => {
    expect(connectorIdToConfigRef("platform:core-model")).toBe("models");
    expect(connectorIdToConfigRef("platform:exec-approvals")).toBe("approvals.exec");
    expect(connectorIdToConfigRef("platform:gmail-hook")).toBe("hooks.gmail");
    expect(connectorIdToConfigRef("platform:observability")).toBe("logs");
    expect(connectorIdToConfigRef("platform:webhook-runtime")).toBe("hooks");
  });

  it("routes tool sections to explicit setup surfaces", () => {
    expect(connectorIdToConfigRef("tools:agents")).toBe("agents");
    expect(connectorIdToConfigRef("tools:automation")).toBe("cron");
    expect(connectorIdToConfigRef("tools:fs")).toBe("tools");
    expect(connectorIdToConfigRef("tools:media")).toBe("media");
    expect(connectorIdToConfigRef("tools:memory")).toBe("memory");
    expect(connectorIdToConfigRef("tools:messaging")).toBe("messages");
    expect(connectorIdToConfigRef("tools:nodes")).toBe("nodes");
    expect(connectorIdToConfigRef("tools:runtime")).toBe("tools");
    expect(connectorIdToConfigRef("tools:sessions")).toBe("session");
    expect(connectorIdToConfigRef("tools:ui")).toBe("browser");
    expect(connectorIdToConfigRef("tools:web")).toBe("web");
  });
});

describe("setupActionLabel", () => {
  it("builds explicit labels for chat connectors", () => {
    expect(setupActionLabel({ connectorId: "channel:telegram", connectorLabel: "Telegram" })).toBe(
      "Open Telegram setup",
    );
    expect(setupActionLabel({ connectorId: "channel:matrix", connectorLabel: "Matrix" })).toBe(
      "Open Matrix setup",
    );
  });

  it("builds explicit labels for platform connectors", () => {
    expect(setupActionLabel({ connectorId: "platform:gmail-hook" })).toBe("Open Gmail hook setup");
    expect(
      setupActionLabel({ connectorId: "platform:exec-approvals", refs: ["approvals.exec"] }),
    ).toBe("Open approvals setup");
    expect(setupActionLabel({ connectorId: "platform:core-model" })).toBe("Open model setup");
    expect(setupActionLabel({ connectorId: "platform:webhook-runtime" })).toBe(
      "Open webhook runtime setup",
    );
    expect(setupActionLabel({ connectorId: "platform:observability" })).toBe(
      "Open logs and debug setup",
    );
  });

  it("builds explicit labels for tool connectors", () => {
    expect(setupActionLabel({ connectorId: "tools:agents" })).toBe("Open agent runtime setup");
    expect(setupActionLabel({ connectorId: "tools:automation" })).toBe("Open automation setup");
    expect(setupActionLabel({ connectorId: "tools:fs" })).toBe("Open file access setup");
    expect(setupActionLabel({ connectorId: "tools:media" })).toBe("Open media setup");
    expect(setupActionLabel({ connectorId: "tools:memory" })).toBe("Open memory setup");
    expect(setupActionLabel({ connectorId: "tools:messaging" })).toBe("Open messaging setup");
    expect(setupActionLabel({ connectorId: "tools:nodes" })).toBe("Open nodes setup");
    expect(setupActionLabel({ connectorId: "tools:runtime" })).toBe("Open runtime tools setup");
    expect(setupActionLabel({ connectorId: "tools:sessions" })).toBe(
      "Open session and subagent setup",
    );
    expect(setupActionLabel({ connectorId: "tools:ui" })).toBe("Open browser and canvas setup");
    expect(setupActionLabel({ connectorId: "tools:web" })).toBe("Open web tools setup");
  });
});

describe("hasPendingSetupTask", () => {
  it("returns true only when a connector still has pending work", () => {
    expect(
      hasPendingSetupTask(
        [
          { connectorId: "tools:memory", status: "completed" },
          { connectorId: "channel:telegram", status: "pending" },
        ],
        "channel:telegram",
      ),
    ).toBe(true);

    expect(
      hasPendingSetupTask([{ connectorId: "tools:memory", status: "completed" }], "tools:memory"),
    ).toBe(false);
  });
});

describe("resolveQuickSetupForFocus", () => {
  it("returns generic quick setup cards for every connector that needs setup guidance", () => {
    const connectors = listOpenClawConnectorDefinitions({ workspaceDir: process.cwd() }).filter(
      (connector) =>
        connector.install.required ||
        connector.setup.requiresAuth ||
        connector.setup.requiresConfig,
    );

    for (const connector of connectors) {
      const focus = buildFocus(connector);
      expect(resolveQuickSetupForFocus(focus), connector.id).not.toBeNull();
    }
  });

  it("uses agents.defaults.model for the core model quick setup selector", () => {
    const coreModel = listOpenClawConnectorDefinitions({ workspaceDir: process.cwd() }).find(
      (value) => value.id === "platform:core-model",
    );
    expect(coreModel).toBeTruthy();

    const card = resolveQuickSetupForFocus(buildFocus(coreModel!));
    const modelField = card?.fields.find((field) => field.label === "Default Model");
    expect(modelField?.path).toEqual(["agents", "defaults", "model"]);
    expect(modelField?.options?.every((option) => option.value.includes("/"))).toBe(true);
  });

  it("includes Telegram default target in quick setup fields", () => {
    const connector = listOpenClawConnectorDefinitions({ workspaceDir: process.cwd() }).find(
      (value) => value.id === "channel:telegram",
    );
    expect(connector).toBeTruthy();
    const card = resolveQuickSetupForFocus(buildFocus(connector!));
    const targetField = card?.fields.find((field) => field.label.includes("Default Target"));
    expect(targetField?.path).toEqual(["channels", "telegram", "defaultTo"]);
  });

  it("includes Telegram default-target auto-detect assist action", () => {
    const connector = listOpenClawConnectorDefinitions({ workspaceDir: process.cwd() }).find(
      (value) => value.id === "channel:telegram",
    );
    expect(connector).toBeTruthy();
    const card = resolveQuickSetupForFocus(buildFocus(connector!));
    expect(card?.assist?.connectorId).toBe("channel:telegram:auto-default-target");
    expect(card?.assist?.fields).toEqual([]);
  });

  it("includes connector-specific verify assists for Discord, Slack, and Signal", () => {
    const connectors = listOpenClawConnectorDefinitions({ workspaceDir: process.cwd() });
    const discord = connectors.find((value) => value.id === "channel:discord");
    const slack = connectors.find((value) => value.id === "channel:slack");
    const signal = connectors.find((value) => value.id === "channel:signal");
    expect(discord).toBeTruthy();
    expect(slack).toBeTruthy();
    expect(signal).toBeTruthy();

    const discordCard = resolveQuickSetupForFocus(buildFocus(discord!));
    const slackCard = resolveQuickSetupForFocus(buildFocus(slack!));
    const signalCard = resolveQuickSetupForFocus(buildFocus(signal!));

    expect(discordCard?.assist?.connectorId).toBe("channel:discord:verify-token");
    expect(slackCard?.assist?.connectorId).toBe("channel:slack:verify-credentials");
    expect(signalCard?.assist?.connectorId).toBe("channel:signal:verify-transport");
  });

  it("guides WhatsApp pairing in-place from quick setup", () => {
    const whatsapp = listOpenClawConnectorDefinitions({ workspaceDir: process.cwd() }).find(
      (value) => value.id === "channel:whatsapp",
    );
    expect(whatsapp).toBeTruthy();

    const card = resolveQuickSetupForFocus(buildFocus(whatsapp!));
    const instructions = card?.steps?.map((step) => step.instruction).join(" ");

    expect(instructions).toContain("Start QR Scan");
    expect(instructions).not.toContain("Open the Channels tab");
  });

  it("maps Signal quick-setup account field to channels.signal.account", () => {
    const signal = listOpenClawConnectorDefinitions({ workspaceDir: process.cwd() }).find(
      (value) => value.id === "channel:signal",
    );
    expect(signal).toBeTruthy();

    const card = resolveQuickSetupForFocus(buildFocus(signal!));
    const signalField = card?.fields.find((field) => field.label === "Signal Account");
    expect(signalField?.path).toEqual(["channels", "signal", "account"]);
  });

  it("uses a generic channel setup card for uncovered chat connectors", () => {
    const connector = listOpenClawConnectorDefinitions({ workspaceDir: process.cwd() }).find(
      (value) => value.id === "channel:googlechat",
    );
    expect(connector).toBeTruthy();
    const card = resolveQuickSetupForFocus(buildFocus(connector!));
    expect(card?.title).toBe("Set up Google Chat");
    expect(card?.steps?.some((step) => step.instruction.includes("channel card below"))).toBe(true);
    expect(card?.docsHint).toBe("https://docs.openclaw.ai/channels/googlechat");
    expect(card?.assist?.connectorId).toBe("channel:googlechat");
    expect(card?.assist?.runLabel).toBe("Check setup status");
  });

  it("uses a generic connector setup card for uncovered platform and tool connectors", () => {
    const webhook = listOpenClawConnectorDefinitions({ workspaceDir: process.cwd() }).find(
      (value) => value.id === "platform:webhook-runtime",
    );
    const agents = listOpenClawConnectorDefinitions({ workspaceDir: process.cwd() }).find(
      (value) => value.id === "tools:agents",
    );
    expect(webhook).toBeTruthy();
    expect(agents).toBeTruthy();

    const webhookCard = resolveQuickSetupForFocus(buildFocus(webhook!));
    const agentsCard = resolveQuickSetupForFocus(buildFocus(agents!));

    expect(webhookCard?.title).toBe("Configure OpenClaw Webhook Runtime");
    expect(webhookCard?.steps?.some((step) => step.instruction.includes("sign-in, API key"))).toBe(
      true,
    );
    expect(agentsCard?.title).toBe("Configure OpenClaw Agents Tools");
    expect(agentsCard?.steps?.at(-1)?.instruction).toContain("Return to Builder");
    expect(webhookCard?.assist?.connectorId).toBe("platform:webhook-runtime");
    expect(agentsCard?.assist?.connectorId).toBe("tools:agents");
  });
});

describe("resolveBuilderQuestionConfigRefs", () => {
  it("maps delivery-target questions to channel config refs", () => {
    expect(
      resolveBuilderQuestionConfigRefs({
        id: "delivery-target",
        prompt: "Which telegram destination should receive the digest?",
        required: true,
      }),
    ).toEqual(["channels.telegram"]);

    expect(
      resolveBuilderQuestionConfigRefs({
        id: "delivery-target",
        prompt: "Which Slack destination should receive the digest?",
        required: true,
      }),
    ).toEqual(["channels.slack"]);
  });

  it("returns empty refs for non-delivery questions", () => {
    expect(
      resolveBuilderQuestionConfigRefs({
        id: "binding-channel",
        prompt: "Which channel should this workflow watch?",
        required: true,
      }),
    ).toEqual([]);
  });
});
