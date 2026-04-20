import { describe, expect, it, vi } from "vitest";

const getActiveWebListenerMock = vi.hoisted(() => vi.fn());
const sendMessageWhatsAppMock = vi.hoisted(() => vi.fn());
const sendPollWhatsAppMock = vi.hoisted(() => vi.fn());
const outboundBoundarySendMock = vi.hoisted(() => vi.fn());
const outboundBoundaryPollMock = vi.hoisted(() => vi.fn());

vi.mock("../../channel-web.js", () => ({
  getActiveWebListener: (...args: unknown[]) => getActiveWebListenerMock(...args),
}));

vi.mock("../../channels/web/index.js", () => ({
  getActiveWebListener: (...args: unknown[]) => getActiveWebListenerMock(...args),
  sendMessageWhatsApp: (...args: unknown[]) => sendMessageWhatsAppMock(...args),
  sendPollWhatsApp: (...args: unknown[]) => sendPollWhatsAppMock(...args),
  monitorWebChannel: vi.fn(),
}));

vi.mock("./runtime-whatsapp-outbound.runtime.js", () => ({
  sendMessageWhatsApp: (...args: unknown[]) => outboundBoundarySendMock(...args),
  sendPollWhatsApp: (...args: unknown[]) => outboundBoundaryPollMock(...args),
}));

import { createRuntimeWhatsApp } from "./runtime-whatsapp.js";

describe("createRuntimeWhatsApp", () => {
  it("reads the active listener from the shared web runtime boundary", () => {
    const runtime = createRuntimeWhatsApp();
    const listener = { sendMessage: vi.fn() };
    getActiveWebListenerMock.mockReturnValueOnce(listener);

    expect(runtime.getActiveWebListener("default")).toBe(listener);
    expect(getActiveWebListenerMock).toHaveBeenCalledWith("default");
  });

  it("routes outbound sends through the shared web runtime boundary", async () => {
    const runtime = createRuntimeWhatsApp();
    const expected = { messageId: "msg-1", toJid: "15551234567@s.whatsapp.net" };
    sendMessageWhatsAppMock.mockResolvedValueOnce(expected);

    await expect(
      runtime.sendMessageWhatsApp("whatsapp:+15551234567", "hello", { verbose: false }),
    ).resolves.toEqual(expected);

    expect(sendMessageWhatsAppMock).toHaveBeenCalledWith(
      "whatsapp:+15551234567",
      "hello",
      { verbose: false },
    );
    expect(outboundBoundarySendMock).not.toHaveBeenCalled();
  });

  it("routes outbound polls through the shared web runtime boundary", async () => {
    const runtime = createRuntimeWhatsApp();
    const expected = { messageId: "poll-1", toJid: "15551234567@s.whatsapp.net" };
    sendPollWhatsAppMock.mockResolvedValueOnce(expected);

    await expect(
      runtime.sendPollWhatsApp(
        "whatsapp:+15551234567",
        { question: "Ship it?", options: ["yes", "no"], maxSelections: 1 },
        { verbose: false },
      ),
    ).resolves.toEqual(expected);

    expect(sendPollWhatsAppMock).toHaveBeenCalled();
    expect(outboundBoundaryPollMock).not.toHaveBeenCalled();
  });
});
