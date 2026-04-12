import type { PluginRuntime } from "openclaw/plugin-sdk/whatsapp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setActiveWebListener } from "./active-listener.js";
import { whatsappPlugin } from "./channel.js";
import { setWhatsAppRuntime } from "./runtime.js";

afterEach(() => {
  setActiveWebListener("default", null);
});

describe("whatsappPlugin outbound sendMedia", () => {
  it("forwards mediaLocalRoots to sendMessageWhatsApp", async () => {
    const sendWhatsApp = vi.fn(async () => ({
      messageId: "msg-1",
      toJid: "15551234567@s.whatsapp.net",
    }));
    const mediaLocalRoots = ["/tmp/workspace"];

    const outbound = whatsappPlugin.outbound;
    if (!outbound?.sendMedia) {
      throw new Error("whatsapp outbound sendMedia is unavailable");
    }

    const result = await outbound.sendMedia({
      cfg: {} as never,
      to: "whatsapp:+15551234567",
      text: "photo",
      mediaUrl: "/tmp/workspace/photo.png",
      mediaLocalRoots,
      accountId: "default",
      deps: { sendWhatsApp },
      gifPlayback: false,
    });

    expect(sendWhatsApp).toHaveBeenCalledWith(
      "whatsapp:+15551234567",
      "photo",
      expect.objectContaining({
        verbose: false,
        mediaUrl: "/tmp/workspace/photo.png",
        mediaLocalRoots,
        accountId: "default",
        gifPlayback: false,
      }),
    );
    expect(result).toMatchObject({ channel: "whatsapp", messageId: "msg-1" });
  });
});

describe("whatsappPlugin status probe", () => {
  it("fails when the account is linked but no listener is active", async () => {
    setWhatsAppRuntime({
      channel: {
        whatsapp: {
          webAuthExists: vi.fn(async () => true),
          readWebSelfId: vi.fn(() => ({ e164: "+15551234567", jid: "15551234567@s.whatsapp.net" })),
        },
      },
    } as unknown as PluginRuntime);

    const result = await whatsappPlugin.status?.probeAccount?.({
      account: {
        accountId: "default",
        authDir: "/tmp/wa-auth",
      } as never,
      timeoutMs: 1_000,
      cfg: {} as never,
    });

    expect(result).toEqual({
      ok: false,
      error: "WhatsApp Web is linked, but no active listener is running for this account.",
    });
  });
});
