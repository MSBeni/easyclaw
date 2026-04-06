import { describe, expect, it } from "vitest";
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

describe("quick setup connector assist parity", () => {
  it("maps Slack to a dedicated auto-default-target assist action", () => {
    const setup = resolveQuickSetupForFocus(
      buildFocus({
        connectorId: "channel:slack",
        ref: "channels.slack",
      }),
    );

    expect(setup?.assist?.connectorId).toBe("channel:slack:auto-default-target");
    expect(setup?.assist?.runLabel).toBe("Auto-detect target");
    expect(setup?.docsHint).toBe("https://docs.openclaw.ai/channels/slack");
  });

  it("maps Discord to a dedicated auto-default-target assist action", () => {
    const setup = resolveQuickSetupForFocus(
      buildFocus({
        connectorId: "channel:discord",
        ref: "channels.discord",
      }),
    );

    expect(setup?.assist?.connectorId).toBe("channel:discord:auto-default-target");
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

    expect(setup?.assist?.connectorId).toBe("channel:signal:auto-detect-http-url");
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

    expect(setup?.assist?.connectorId).toBe("channel:googlechat:verify-auth");
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

    expect(setup?.assist?.connectorId).toBe("channel:matrix:verify-credentials");
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

    expect(setup?.assist?.connectorId).toBe("channel:msteams:verify-credentials");
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

    expect(setup?.assist?.connectorId).toBe("channel:imessage:verify-transport");
    expect(setup?.assist?.runLabel).toBe("Verify iMessage transport");
    expect(setup?.docsHint).toBe("https://docs.openclaw.ai/channels/imessage");
  });
});
