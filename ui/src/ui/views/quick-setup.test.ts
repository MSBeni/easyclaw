import { describe, expect, it } from "vitest";
import {
  ONBOARDING_STEPS,
  isStepConfigured,
  resolveStepLiveVerificationIssue,
  summarizeStepLiveVerificationIssue,
} from "./onboarding.ts";
import { resolveQuickSetupForFocus } from "./quick-setup.ts";

type BuilderSetupFocus = Parameters<typeof resolveQuickSetupForFocus>[0];

function buildFocus(params: { connectorId: string; ref: string }): BuilderSetupFocus {
  return {
    connectorId: params.connectorId,
    title: "Configure connector",
    detail: "Connector setup details",
    refs: [params.ref],
    targetTab: "builder",
  };
}

function buildActionFocus(params: {
  actionId: string;
  actionKind: NonNullable<BuilderSetupFocus["actionKind"]>;
  connectorId: string;
  connectorLabel: string;
  ref: string;
  title: string;
  detail: string;
  requiredFields: NonNullable<BuilderSetupFocus["requiredFields"]>;
}): BuilderSetupFocus {
  return {
    actionId: params.actionId,
    actionKind: params.actionKind,
    connectorId: params.connectorId,
    connectorLabel: params.connectorLabel,
    title: params.title,
    detail: params.detail,
    requiredFields: params.requiredFields,
    refs: [params.ref],
    targetTab: "builder",
  };
}

function onboardingStepById(id: string) {
  const step = ONBOARDING_STEPS.find((entry) => entry.id === id);
  expect(step).toBeDefined();
  return step!;
}

function createOnboardingVerificationState(params: {
  connectorId: string;
  detail: string;
  source?: "live" | "preflight" | "persisted";
  status?: "failed" | "blocked" | "passed" | "needs_live_check";
  focusConnectorId?: string | null;
}) {
  return {
    channelsSnapshot: null,
    whatsappLoginConnected: null,
    builderSetupFocus:
      params.focusConnectorId === undefined
        ? null
        : {
            connectorId: params.focusConnectorId,
          },
    builderPlan: {
      draft: {
        planning: {
          verifications: [
            {
              id: `${params.connectorId}:status`,
              connectorId: params.connectorId,
              connectorLabel: "Test Connector",
              probeKind: "status",
              probeLabel: "Status probe",
              status: params.status ?? "failed",
              detail: params.detail,
              source: params.source ?? "live",
            },
          ],
        },
      },
    },
  } as never;
}

describe("quick setup connector assist parity", () => {
  it("maps Slack to a dedicated auto-default-target assist action", () => {
    const setup = resolveQuickSetupForFocus(
      buildFocus({
        connectorId: "channel:slack",
        ref: "channels.slack",
      }),
    );

    expect(setup?.assist?.actionId).toBe("channel:slack:auto-default-target");
    expect(setup?.assist?.runLabel).toBe("Auto-detect target");
    expect(setup?.docsHint).toBe("https://docs.openclaw.ai/channels/slack");
    expect(setup?.steps[3]?.instruction).toContain("channels:read");
    expect(setup?.steps[3]?.instruction).toContain("groups:read");
    expect(setup?.steps[4]?.instruction).toContain("reinstall the app");
  });

  it("maps Discord to a dedicated auto-default-target assist action", () => {
    const setup = resolveQuickSetupForFocus(
      buildFocus({
        connectorId: "channel:discord",
        ref: "channels.discord",
      }),
    );

    expect(setup?.assist?.actionId).toBe("channel:discord:auto-default-target");
    expect(setup?.assist?.runLabel).toBe("Auto-detect target");
    expect(setup?.docsHint).toBe("https://docs.openclaw.ai/channels/discord");
  });

  it("maps Signal to a dedicated auto-detect-http-url assist action", () => {
    const setup = resolveQuickSetupForFocus(
      buildFocus({
        connectorId: "channel:signal",
        ref: "channels.signal",
      }),
    );

    expect(setup?.assist?.actionId).toBe("channel:signal:auto-detect-http-url");
    expect(setup?.assist?.runLabel).toBe("Auto-detect Signal URL");
    expect(setup?.docsHint).toBe("https://docs.openclaw.ai/channels/signal");
  });

  it("maps Google Chat to a dedicated verify-auth assist action", () => {
    const setup = resolveQuickSetupForFocus(
      buildFocus({
        connectorId: "channel:googlechat",
        ref: "channels.googlechat",
      }),
    );

    expect(setup?.assist?.actionId).toBe("channel:googlechat:verify-auth");
    expect(setup?.assist?.runLabel).toBe("Verify Google Chat auth");
    expect(setup?.docsHint).toBe("https://docs.openclaw.ai/channels/googlechat");
  });

  it("maps Matrix to a dedicated verify-credentials assist action", () => {
    const setup = resolveQuickSetupForFocus(
      buildFocus({
        connectorId: "channel:matrix",
        ref: "channels.matrix",
      }),
    );

    expect(setup?.assist?.actionId).toBe("channel:matrix:verify-credentials");
    expect(setup?.assist?.runLabel).toBe("Verify Matrix credentials");
    expect(setup?.docsHint).toBe("https://docs.openclaw.ai/channels/matrix");
  });

  it("maps Microsoft Teams to a dedicated verify-credentials assist action", () => {
    const setup = resolveQuickSetupForFocus(
      buildFocus({
        connectorId: "channel:msteams",
        ref: "channels.msteams",
      }),
    );

    expect(setup?.assist?.actionId).toBe("channel:msteams:verify-credentials");
    expect(setup?.assist?.runLabel).toBe("Verify Teams credentials");
    expect(setup?.docsHint).toBe("https://docs.openclaw.ai/channels/msteams");
  });

  it("maps iMessage to a dedicated verify-transport assist action", () => {
    const setup = resolveQuickSetupForFocus(
      buildFocus({
        connectorId: "channel:imessage",
        ref: "channels.imessage",
      }),
    );

    expect(setup?.assist?.actionId).toBe("channel:imessage:verify-transport");
    expect(setup?.assist?.runLabel).toBe("Verify iMessage transport");
    expect(setup?.docsHint).toBe("https://docs.openclaw.ai/channels/imessage");
  });

  it("maps web tools to a dedicated configure-and-verify assist action", () => {
    const setup = resolveQuickSetupForFocus(
      buildFocus({
        connectorId: "tools:web",
        ref: "tools.web.search",
      }),
    );

    expect(setup?.assist?.actionId).toBe("tools:web:configure");
    expect(setup?.assist?.runLabel).toBe("Configure and Verify");
    expect(setup?.docsHint).toBe("https://docs.openclaw.ai/tools/web");
  });

  it("points Gmail hook setup to the detailed Gmail Pub/Sub docs", () => {
    const setup = resolveQuickSetupForFocus(
      buildFocus({
        connectorId: "platform:gmail-hook",
        ref: "hooks.gmail",
      }),
    );

    expect(setup?.docsHint).toBe("https://docs.openclaw.ai/automation/gmail-pubsub");
  });

  it("builds action-driven quick setup from required field metadata", () => {
    const setup = resolveQuickSetupForFocus({
      actionId: "platform:exec-approvals:configure",
      actionKind: "policy",
      connectorId: "platform:exec-approvals",
      connectorDocsPath: "/configuration#approvals",
      title: "Configure Exec Approvals",
      detail: "Choose how approval prompts should be routed.",
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
      ],
      refs: ["approvals.exec"],
      targetTab: "builder",
    });

    expect(setup?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Forward exec approvals",
          path: ["approvals", "exec", "enabled"],
        }),
      ]),
    );
    expect(setup?.assist?.actionId).toBe("platform:exec-approvals:configure");
    expect(setup?.assist?.fields).toHaveLength(0);
  });

  it("prefers action-backed install guidance over custom channel setup for plugin installs", () => {
    const setup = resolveQuickSetupForFocus({
      actionId: "channel:msteams:install",
      actionKind: "install",
      connectorId: "channel:msteams",
      connectorLabel: "Microsoft Teams",
      connectorDocsPath: "/channels/msteams",
      connectorInstallRequired: true,
      connectorInstallStrategy: "npm",
      title: "Install Microsoft Teams",
      detail: "Install the Microsoft Teams plugin before Builder can continue onboarding.",
      refs: ["channels.msteams"],
      targetTab: "builder",
    });

    expect(setup?.title).toBe("Install Microsoft Teams");
    expect(setup?.steps[0]?.instruction).toContain("Install the Microsoft Teams plugin");
    expect(setup?.assist?.runLabel).toBe("Install Microsoft Teams");
  });

  it("uses the action-backed Telegram verify flow instead of the auto-target guide", () => {
    const setup = resolveQuickSetupForFocus(
      buildActionFocus({
        actionId: "channel:telegram:verify-token",
        actionKind: "verify",
        connectorId: "channel:telegram",
        connectorLabel: "Telegram",
        ref: "channels.telegram",
        title: "Verify Telegram",
        detail: "Confirm the configured Telegram bot token works before delivery is enabled.",
        requiredFields: [
          {
            key: "auth",
            label: "Bot token",
            kind: "auth",
            required: true,
            inputKey: "token",
            configPath: "channels.telegram.botToken",
            inputType: "secret",
          },
        ],
      }),
    );

    expect(setup?.title).toBe("Verify Telegram");
    expect(setup?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Bot token",
          path: ["channels", "telegram", "botToken"],
        }),
      ]),
    );
    expect(setup?.assist?.actionId).toBe("channel:telegram:verify-token");
    expect(setup?.assist?.runLabel).toBe("Configure and Verify");
  });

  it("uses the action-backed Slack verify flow instead of the auto-target guide", () => {
    const setup = resolveQuickSetupForFocus(
      buildActionFocus({
        actionId: "channel:slack:verify-credentials",
        actionKind: "verify",
        connectorId: "channel:slack",
        connectorLabel: "Slack",
        ref: "channels.slack",
        title: "Verify Slack credentials",
        detail: "Check the saved Slack tokens before delivery setup continues.",
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
      }),
    );

    expect(setup?.title).toBe("Verify Slack credentials");
    expect(setup?.assist?.actionId).toBe("channel:slack:verify-credentials");
    expect(setup?.assist?.runLabel).toBe("Configure and Verify");
    expect(setup?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Bot token",
          path: ["channels", "slack", "botToken"],
        }),
        expect.objectContaining({
          label: "App token",
          path: ["channels", "slack", "appToken"],
        }),
      ]),
    );
  });

  it("uses the action-backed Discord verify flow instead of the auto-target guide", () => {
    const setup = resolveQuickSetupForFocus(
      buildActionFocus({
        actionId: "channel:discord:verify-token",
        actionKind: "verify",
        connectorId: "channel:discord",
        connectorLabel: "Discord",
        ref: "channels.discord",
        title: "Verify Discord token",
        detail: "Confirm the saved Discord bot token works before delivery is enabled.",
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
      }),
    );

    expect(setup?.assist?.actionId).toBe("channel:discord:verify-token");
    expect(setup?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Bot token",
          path: ["channels", "discord", "token"],
        }),
      ]),
    );
  });

  it("uses the action-backed Signal transport verify flow instead of auto-detect guidance", () => {
    const setup = resolveQuickSetupForFocus(
      buildActionFocus({
        actionId: "channel:signal:verify-transport",
        actionKind: "verify",
        connectorId: "channel:signal",
        connectorLabel: "Signal",
        ref: "channels.signal",
        title: "Verify Signal transport",
        detail: "Check the configured Signal transport endpoint before delivery is enabled.",
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
          },
        ],
      }),
    );

    expect(setup?.assist?.actionId).toBe("channel:signal:verify-transport");
    expect(setup?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Signal account",
          path: ["channels", "signal", "account"],
        }),
        expect.objectContaining({
          label: "Signal HTTP URL",
          path: ["channels", "signal", "httpUrl"],
        }),
      ]),
    );
  });
});

describe("onboarding readiness", () => {
  it("requires the full Gmail hook config before marking the setup step ready", () => {
    const step = onboardingStepById("gmail-hook");

    expect(
      isStepConfigured(
        {
          hooks: {
            gmail: {
              account: "automation@example.com",
            },
          },
        },
        step,
      ),
    ).toBe(false);

    expect(
      isStepConfigured(
        {
          hooks: {
            token: "hook-token",
            gmail: {
              account: "automation@example.com",
              topic: "projects/example/topics/gmail-push",
              pushToken: "push-token",
            },
          },
        },
        step,
      ),
    ).toBe(true);
  });

  it("surfaces Gmail live verification failures in onboarding", () => {
    const step = onboardingStepById("gmail-hook");
    const state = createOnboardingVerificationState({
      connectorId: "platform:gmail-hook",
      detail: "Gmail needs to be reconnected: its sign-in state is corrupted.",
    });

    expect(resolveStepLiveVerificationIssue(step, state)).toBe(
      "Gmail needs to be reconnected: its sign-in state is corrupted.",
    );

    expect(
      isStepConfigured(
        {
          hooks: {
            token: "hook-token",
            gmail: {
              account: "automation@example.com",
              topic: "projects/example/topics/gmail-push",
              pushToken: "push-token",
            },
          },
        },
        step,
        state,
      ),
    ).toBe(false);
  });

  it("summarizes Gmail keyring integrity failures with reconnect guidance", () => {
    const step = onboardingStepById("gmail-hook");

    expect(
      summarizeStepLiveVerificationIssue(
        step,
        "aes.KeyUnwrap(): integrity check failed while loading the gog token",
      ),
    ).toContain("Validate or reconnect Gmail auth");
  });

  it("ignores Gmail verification issues while another connector is actively focused", () => {
    const step = onboardingStepById("gmail-hook");
    const state = createOnboardingVerificationState({
      connectorId: "platform:gmail-hook",
      detail: "Gmail sign-in has expired.",
      focusConnectorId: "channel:slack",
    });

    expect(resolveStepLiveVerificationIssue(step, state)).toBeNull();
  });
});
