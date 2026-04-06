import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listChannelPlugins: vi.fn(),
  loadConfig: vi.fn(() => ({})),
  applyPluginAutoEnable: vi.fn((params: { config: unknown }) => ({ config: params.config })),
  loadOpenClawPlugins: vi.fn(),
}));

vi.mock("../../channels/plugins/index.js", () => ({
  listChannelPlugins: mocks.listChannelPlugins,
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock("../../config/plugin-auto-enable.js", () => ({
  applyPluginAutoEnable: mocks.applyPluginAutoEnable,
}));

vi.mock("../../plugins/loader.js", () => ({
  loadOpenClawPlugins: mocks.loadOpenClawPlugins,
}));

const { webHandlers } = await import("./web.js");

function createContext() {
  return {
    stopChannel: vi.fn(async () => {}),
    startChannel: vi.fn(async () => {}),
  };
}

describe("web gateway handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("bootstraps plugins when web login provider is initially missing", async () => {
    const loginWithQrStart = vi.fn(async () => ({
      message: "QR ready",
      qrDataUrl: "data:image/png;base64,abc",
    }));
    mocks.listChannelPlugins.mockReturnValue([]);
    mocks.loadOpenClawPlugins.mockReturnValue({
      channels: [
        {
          plugin: {
            id: "whatsapp",
            gateway: {
              loginWithQrStart,
              loginWithQrWait: vi.fn(),
            },
          },
        },
      ],
      diagnostics: [],
    });

    const respond = vi.fn();
    const context = createContext();
    await webHandlers["web.login.start"]({
      params: { force: false },
      respond: respond as never,
      context: context as never,
      client: null,
      req: { type: "req", id: "1", method: "web.login.start" },
      isWebchatConnect: () => false,
    });

    expect(mocks.loadOpenClawPlugins).toHaveBeenCalledTimes(1);
    expect(context.stopChannel).toHaveBeenCalledWith("whatsapp", undefined);
    expect(loginWithQrStart).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ message: "QR ready" }),
      undefined,
    );
  });

  it("returns provider-unavailable details when bootstrap still has no provider", async () => {
    mocks.listChannelPlugins.mockReturnValue([]);
    mocks.loadOpenClawPlugins.mockReturnValue({
      channels: [],
      diagnostics: [
        {
          level: "warn",
          pluginId: "whatsapp",
          source: "/tmp/whatsapp",
          message: "blocked plugin candidate: world-writable path",
        },
      ],
    });

    const respond = vi.fn();
    await webHandlers["web.login.start"]({
      params: { force: false },
      respond: respond as never,
      context: createContext() as never,
      client: null,
      req: { type: "req", id: "1", method: "web.login.start" },
      isWebchatConnect: () => false,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("Details: blocked plugin candidate"),
      }),
    );
  });
});
