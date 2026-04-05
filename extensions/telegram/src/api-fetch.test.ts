import { describe, expect, it, vi } from "vitest";
import {
  fetchTelegramBotIdentity,
  fetchTelegramChatId,
  fetchTelegramLatestDeliveryTarget,
} from "./api-fetch.js";

describe("fetchTelegramChatId", () => {
  const cases = [
    {
      name: "returns stringified id when Telegram getChat succeeds",
      fetchImpl: vi.fn(async () => ({
        ok: true,
        json: async () => ({ ok: true, result: { id: 12345 } }),
      })),
      expected: "12345",
    },
    {
      name: "returns null when response is not ok",
      fetchImpl: vi.fn(async () => ({
        ok: false,
        json: async () => ({}),
      })),
      expected: null,
    },
    {
      name: "returns null on transport failures",
      fetchImpl: vi.fn(async () => {
        throw new Error("network failed");
      }),
      expected: null,
    },
  ] as const;

  for (const testCase of cases) {
    it(testCase.name, async () => {
      vi.stubGlobal("fetch", testCase.fetchImpl);

      const id = await fetchTelegramChatId({
        token: "abc",
        chatId: "@user",
      });

      expect(id).toBe(testCase.expected);
    });
  }

  it("calls Telegram getChat endpoint", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, result: { id: 12345 } }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchTelegramChatId({ token: "abc", chatId: "@user" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.telegram.org/botabc/getChat?chat_id=%40user",
      undefined,
    );
  });
});

describe("fetchTelegramLatestDeliveryTarget", () => {
  it("returns the newest chat target from updates", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        result: [
          {
            update_id: 10,
            message: {
              chat: { id: 12345 },
            },
          },
          {
            update_id: 11,
            message: {
              chat: { id: -1001234567890 },
              message_thread_id: 42,
            },
          },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchTelegramLatestDeliveryTarget({ token: "abc" });
    expect(result).toEqual({
      target: {
        chatId: "-1001234567890",
        messageThreadId: 42,
        target: "-1001234567890:topic:42",
      },
    });
  });

  it("returns null target when no chat-bearing updates exist", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        result: [{ update_id: 10, callback_query: { id: "x" } }],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchTelegramLatestDeliveryTarget({ token: "abc" });
    expect(result).toEqual({ target: null });
  });

  it("returns telegram API description for non-ok responses", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({
        ok: false,
        description: "Conflict: can't use getUpdates method while webhook is active",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchTelegramLatestDeliveryTarget({ token: "abc" });
    expect(result).toEqual({
      target: null,
      error: "Conflict: can't use getUpdates method while webhook is active",
    });
  });

  it("calls Telegram getUpdates endpoint with allowed update filters", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, result: [] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchTelegramLatestDeliveryTarget({ token: "abc", limit: 50 });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.telegram.org/botabc/getUpdates?limit=50&allowed_updates=%5B%22message%22%2C%22edited_message%22%2C%22channel_post%22%2C%22edited_channel_post%22%5D",
      undefined,
    );
  });
});

describe("fetchTelegramBotIdentity", () => {
  it("returns bot identity when getMe succeeds", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        result: {
          id: 123456789,
          username: "vole_bot",
          first_name: "Vole",
          is_bot: true,
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchTelegramBotIdentity({ token: "abc" });
    expect(result).toEqual({
      bot: {
        id: "123456789",
        username: "vole_bot",
        firstName: "Vole",
        isBot: true,
      },
    });
  });

  it("returns API description for non-ok response", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({
        ok: false,
        description: "Not Found",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchTelegramBotIdentity({ token: "abc" });
    expect(result).toEqual({
      bot: null,
      error: "Not Found",
    });
  });
});
