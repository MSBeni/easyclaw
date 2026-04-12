import type { WebClient } from "@slack/web-api";
import { describe, expect, it, vi } from "vitest";
import { createSlackSendTestClient, installSlackBlockTestMocks } from "./blocks.test-helpers.js";

installSlackBlockTestMocks();
const { sendMessageSlack } = await import("./send.js");

describe("sendMessageSlack NO_REPLY guard", () => {
  it("suppresses NO_REPLY text before any Slack API call", async () => {
    const client = createSlackSendTestClient();
    const result = await sendMessageSlack("channel:C123", "NO_REPLY", {
      token: "xoxb-test",
      client,
    });

    expect(client.chat.postMessage).not.toHaveBeenCalled();
    expect(result.messageId).toBe("suppressed");
  });

  it("suppresses NO_REPLY with surrounding whitespace", async () => {
    const client = createSlackSendTestClient();
    const result = await sendMessageSlack("channel:C123", "  NO_REPLY  ", {
      token: "xoxb-test",
      client,
    });

    expect(client.chat.postMessage).not.toHaveBeenCalled();
    expect(result.messageId).toBe("suppressed");
  });

  it("does not suppress substantive text containing NO_REPLY", async () => {
    const client = createSlackSendTestClient();
    await sendMessageSlack("channel:C123", "This is not a NO_REPLY situation", {
      token: "xoxb-test",
      client,
    });

    expect(client.chat.postMessage).toHaveBeenCalled();
  });

  it("does not suppress NO_REPLY when blocks are attached", async () => {
    const client = createSlackSendTestClient();
    const result = await sendMessageSlack("channel:C123", "NO_REPLY", {
      token: "xoxb-test",
      client,
      blocks: [{ type: "section", text: { type: "mrkdwn", text: "content" } }],
    });

    expect(client.chat.postMessage).toHaveBeenCalled();
    expect(result.messageId).toBe("171234.567");
  });
});

describe("sendMessageSlack blocks", () => {
  it("posts blocks with fallback text when message is empty", async () => {
    const client = createSlackSendTestClient();
    const result = await sendMessageSlack("channel:C123", "", {
      token: "xoxb-test",
      client,
      blocks: [{ type: "divider" }],
    });

    expect(client.conversations.open).not.toHaveBeenCalled();
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C123",
        text: "Shared a Block Kit message",
        blocks: [{ type: "divider" }],
      }),
    );
    expect(result).toEqual({ messageId: "171234.567", channelId: "C123" });
  });

  it("derives fallback text from image blocks", async () => {
    const client = createSlackSendTestClient();
    await sendMessageSlack("channel:C123", "", {
      token: "xoxb-test",
      client,
      blocks: [{ type: "image", image_url: "https://example.com/a.png", alt_text: "Build chart" }],
    });

    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Build chart",
      }),
    );
  });

  it("derives fallback text from video blocks", async () => {
    const client = createSlackSendTestClient();
    await sendMessageSlack("channel:C123", "", {
      token: "xoxb-test",
      client,
      blocks: [
        {
          type: "video",
          title: { type: "plain_text", text: "Release demo" },
          video_url: "https://example.com/demo.mp4",
          thumbnail_url: "https://example.com/thumb.jpg",
          alt_text: "demo",
        },
      ],
    });

    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Release demo",
      }),
    );
  });

  it("derives fallback text from file blocks", async () => {
    const client = createSlackSendTestClient();
    await sendMessageSlack("channel:C123", "", {
      token: "xoxb-test",
      client,
      blocks: [{ type: "file", source: "remote", external_id: "F123" }],
    });

    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Shared a file",
      }),
    );
  });

  it("rejects blocks combined with mediaUrl", async () => {
    const client = createSlackSendTestClient();
    await expect(
      sendMessageSlack("channel:C123", "hi", {
        token: "xoxb-test",
        client,
        mediaUrl: "https://example.com/image.png",
        blocks: [{ type: "divider" }],
      }),
    ).rejects.toThrow(/does not support blocks with mediaUrl/i);
    expect(client.chat.postMessage).not.toHaveBeenCalled();
  });

  it("rejects empty blocks arrays from runtime callers", async () => {
    const client = createSlackSendTestClient();
    await expect(
      sendMessageSlack("channel:C123", "hi", {
        token: "xoxb-test",
        client,
        blocks: [],
      }),
    ).rejects.toThrow(/must contain at least one block/i);
    expect(client.chat.postMessage).not.toHaveBeenCalled();
  });

  it("rejects blocks arrays above Slack max count", async () => {
    const client = createSlackSendTestClient();
    const blocks = Array.from({ length: 51 }, () => ({ type: "divider" }));
    await expect(
      sendMessageSlack("channel:C123", "hi", {
        token: "xoxb-test",
        client,
        blocks,
      }),
    ).rejects.toThrow(/cannot exceed 50 items/i);
    expect(client.chat.postMessage).not.toHaveBeenCalled();
  });

  it("rejects blocks missing type from runtime callers", async () => {
    const client = createSlackSendTestClient();
    await expect(
      sendMessageSlack("channel:C123", "hi", {
        token: "xoxb-test",
        client,
        blocks: [{} as { type: string }],
      }),
    ).rejects.toThrow(/non-empty string type/i);
    expect(client.chat.postMessage).not.toHaveBeenCalled();
  });

  it("joins a public Slack channel and retries when the bot is not in channel", async () => {
    const postError = Object.assign(new Error("An API error occurred: not_in_channel"), {
      data: { error: "not_in_channel" },
    });
    const client = {
      conversations: {
        open: vi.fn(async () => ({ channel: { id: "D123" } })),
        join: vi.fn(async () => ({ ok: true, channel: { id: "C123" } })),
      },
      chat: {
        postMessage: vi
          .fn()
          .mockRejectedValueOnce(postError)
          .mockResolvedValueOnce({ ts: "171234.567" }),
      },
    } as unknown as WebClient;

    const result = await sendMessageSlack("channel:C123", "hi", {
      token: "xoxb-test",
      client,
    });

    expect(client.conversations.join).toHaveBeenCalledWith({ channel: "C123" });
    expect(client.chat.postMessage).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ messageId: "171234.567", channelId: "C123" });
  });

  it("surfaces an actionable error when Slack delivery cannot join the channel", async () => {
    const postError = Object.assign(new Error("An API error occurred: not_in_channel"), {
      data: { error: "not_in_channel" },
    });
    const joinError = Object.assign(new Error("An API error occurred: missing_scope"), {
      data: { error: "missing_scope", needed: "channels:join" },
    });
    const client = {
      conversations: {
        open: vi.fn(async () => ({ channel: { id: "D123" } })),
        join: vi.fn(async () => {
          throw joinError;
        }),
      },
      chat: {
        postMessage: vi.fn().mockRejectedValue(postError),
      },
    } as unknown as WebClient;

    await expect(
      sendMessageSlack("channel:C123", "hi", {
        token: "xoxb-test",
        client,
      }),
    ).rejects.toThrow(/missing channels:join/i);
    expect(client.conversations.join).toHaveBeenCalledWith({ channel: "C123" });
  });
});
