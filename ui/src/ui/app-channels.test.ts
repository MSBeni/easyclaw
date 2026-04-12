import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadChannels: vi.fn(async (state: Record<string, unknown>) => {
    state.channelsSnapshot = {
      channelAccounts: {
        whatsapp: [{ connected: true, linked: true, lastError: null }],
      },
    };
  }),
  startWhatsAppLogin: vi.fn(async (state: Record<string, unknown>) => {
    state.whatsappLoginConnected = true;
    state.whatsappLoginMessage = "Linked.";
    state.whatsappLoginQrDataUrl = null;
  }),
  waitWhatsAppLogin: vi.fn(async (state: Record<string, unknown>) => {
    state.whatsappLoginConnected = true;
    state.whatsappLoginMessage = "Linked.";
  }),
  logoutWhatsApp: vi.fn(async () => {}),
  loadConfig: vi.fn(async () => {}),
  saveConfig: vi.fn(async () => {}),
  applyConfig: vi.fn(async () => {}),
  updateConfigFormValue: vi.fn(),
}));

vi.mock("./controllers/channels.ts", () => ({
  loadChannels: mocks.loadChannels,
  startWhatsAppLogin: mocks.startWhatsAppLogin,
  waitWhatsAppLogin: mocks.waitWhatsAppLogin,
  logoutWhatsApp: mocks.logoutWhatsApp,
}));

vi.mock("./controllers/config.ts", () => ({
  loadConfig: mocks.loadConfig,
  saveConfig: mocks.saveConfig,
  applyConfig: mocks.applyConfig,
  updateConfigFormValue: mocks.updateConfigFormValue,
}));

import { handleWhatsAppStart, handleWhatsAppWait } from "./app-channels.ts";

function createHost() {
  const request = vi.fn(async (method: string) => {
    if (method === "agents.builder.setup.run") {
      return {
        connectorId: "channel:whatsapp:auto-default-target",
        status: "configured",
        message: "WhatsApp default target set to +15551234567.",
      };
    }
    return {};
  });
  return {
    client: { request },
    connected: true,
    channelsSnapshot: null,
    channelsLoading: false,
    channelsError: null,
    channelsLastSuccess: null,
    whatsappBusy: false,
    whatsappLoginMessage: null,
    whatsappLoginQrDataUrl: null,
    whatsappLoginConnected: null,
    configForm: null,
    lastError: null,
    setTab: vi.fn(),
    request,
  };
}

describe("app-channels whatsapp automation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("auto-configures whatsapp default target after wait confirms connected", async () => {
    const host = createHost();
    await handleWhatsAppWait(host as never);

    expect(host.request).toHaveBeenCalledWith("agents.builder.setup.run", {
      connectorId: "channel:whatsapp:auto-default-target",
      inputs: {},
    });
    expect(host.whatsappLoginMessage).toContain("default target set");
  });

  it("auto-configures whatsapp default target after start flow reaches connected", async () => {
    const host = createHost();
    await handleWhatsAppStart(host as never, false);

    expect(host.request).toHaveBeenCalledWith("agents.builder.setup.run", {
      connectorId: "channel:whatsapp:auto-default-target",
      inputs: {},
    });
  });

  it("skips auto-configure when wait does not report a connected session", async () => {
    mocks.waitWhatsAppLogin.mockImplementationOnce(async (state: Record<string, unknown>) => {
      state.whatsappLoginConnected = false;
      state.whatsappLoginMessage = "Waiting for scan.";
    });
    mocks.loadChannels.mockImplementationOnce(async (state: Record<string, unknown>) => {
      state.channelsSnapshot = {
        channelAccounts: {
          whatsapp: [{ connected: false, linked: false, lastError: null }],
        },
      };
    });
    const host = createHost();

    await handleWhatsAppWait(host as never);

    expect(host.request).not.toHaveBeenCalledWith("agents.builder.setup.run", {
      connectorId: "channel:whatsapp:auto-default-target",
      inputs: {},
    });
  });
});
