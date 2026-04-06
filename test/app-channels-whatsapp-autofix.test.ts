import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadChannels: vi.fn(async () => {}),
  logoutWhatsApp: vi.fn(async () => {}),
  startWhatsAppLogin: vi.fn(async () => {}),
  waitWhatsAppLogin: vi.fn(async () => {}),
  applyConfig: vi.fn(async () => {}),
  loadConfig: vi.fn(async () => {}),
  saveConfig: vi.fn(async () => {}),
  updateConfigFormValue: vi.fn(),
}));

vi.mock("../ui/src/ui/controllers/channels.ts", () => ({
  loadChannels: mocks.loadChannels,
  logoutWhatsApp: mocks.logoutWhatsApp,
  startWhatsAppLogin: mocks.startWhatsAppLogin,
  waitWhatsAppLogin: mocks.waitWhatsAppLogin,
}));

vi.mock("../ui/src/ui/controllers/config.ts", () => ({
  applyConfig: mocks.applyConfig,
  loadConfig: mocks.loadConfig,
  saveConfig: mocks.saveConfig,
  updateConfigFormValue: mocks.updateConfigFormValue,
}));

const { handleWhatsAppStart } = await import("../ui/src/ui/app-channels.ts");

function createHost() {
  return {
    connected: true,
    client: {},
    lastError: null as string | null,
    whatsappLoginMessage: null as string | null,
    configForm: null as Record<string, unknown> | null,
    configSnapshot: null,
  };
}

describe("handleWhatsAppStart auto-enable flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("auto-enables WhatsApp provider config and retries when provider is unavailable", async () => {
    const host = createHost();
    let attempts = 0;
    mocks.startWhatsAppLogin.mockImplementation(async (state: typeof host) => {
      attempts += 1;
      state.whatsappLoginMessage =
        attempts === 1
          ? "GatewayRequestError: web login provider is not available"
          : "QR code ready";
    });
    mocks.loadConfig.mockImplementation(async (state: typeof host) => {
      state.configForm = {
        channels: {
          whatsapp: {},
        },
        plugins: {
          allow: ["telegram"],
        },
      };
    });
    mocks.applyConfig.mockImplementation(async (state: typeof host) => {
      state.lastError = null;
    });

    await handleWhatsAppStart(host as unknown as Parameters<typeof handleWhatsAppStart>[0], false);

    expect(mocks.startWhatsAppLogin).toHaveBeenCalledTimes(2);
    expect(mocks.loadConfig).toHaveBeenCalledTimes(2);
    expect(mocks.applyConfig).toHaveBeenCalledTimes(1);
    expect(mocks.updateConfigFormValue).toHaveBeenCalledWith(
      host,
      ["channels", "whatsapp", "enabled"],
      true,
    );
    expect(mocks.updateConfigFormValue).toHaveBeenCalledWith(
      host,
      ["plugins", "allow", 1],
      "whatsapp",
    );
    expect(host.whatsappLoginMessage).toBe("QR code ready");
    expect(mocks.loadChannels).toHaveBeenCalledTimes(1);
  });

  it("reports a clear next step when auto-enable fails", async () => {
    const host = createHost();
    mocks.startWhatsAppLogin.mockImplementation(async (state: typeof host) => {
      state.whatsappLoginMessage = "GatewayRequestError: web login provider is not available";
    });
    mocks.loadConfig.mockImplementation(async (state: typeof host) => {
      state.configForm = {
        channels: {
          whatsapp: {},
        },
      };
    });
    mocks.applyConfig.mockImplementation(async (state: typeof host) => {
      state.lastError = "config.apply failed";
    });

    await handleWhatsAppStart(host as unknown as Parameters<typeof handleWhatsAppStart>[0], false);

    expect(mocks.startWhatsAppLogin).toHaveBeenCalledTimes(1);
    expect(mocks.applyConfig).toHaveBeenCalledTimes(1);
    expect(host.whatsappLoginMessage).toContain("Auto-enable failed");
    expect(mocks.loadChannels).toHaveBeenCalledTimes(1);
  });
});
