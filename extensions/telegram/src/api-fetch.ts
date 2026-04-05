export async function fetchTelegramChatId(params: {
  token: string;
  chatId: string;
  signal?: AbortSignal;
}): Promise<string | null> {
  const url = `https://api.telegram.org/bot${params.token}/getChat?chat_id=${encodeURIComponent(params.chatId)}`;
  try {
    const res = await fetch(url, params.signal ? { signal: params.signal } : undefined);
    if (!res.ok) {
      return null;
    }
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      result?: { id?: number | string };
    } | null;
    const id = data?.ok ? data?.result?.id : undefined;
    if (typeof id === "number" || typeof id === "string") {
      return String(id);
    }
    return null;
  } catch {
    return null;
  }
}

export type TelegramBotIdentity = {
  id: string;
  username?: string;
  firstName?: string;
  isBot?: boolean;
};

export type TelegramBotIdentityResult = {
  bot: TelegramBotIdentity | null;
  error?: string;
};

export async function fetchTelegramBotIdentity(params: {
  token: string;
  signal?: AbortSignal;
}): Promise<TelegramBotIdentityResult> {
  const url = `https://api.telegram.org/bot${params.token}/getMe`;
  try {
    const res = await fetch(url, params.signal ? { signal: params.signal } : undefined);
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      description?: string;
      result?: {
        id?: number | string;
        username?: string;
        first_name?: string;
        is_bot?: boolean;
      };
    } | null;
    if (!res.ok) {
      const error =
        typeof data?.description === "string" && data.description.trim().length > 0
          ? data.description.trim()
          : `Telegram getMe failed with HTTP ${res.status}.`;
      return { bot: null, error };
    }
    if (!data?.ok) {
      const error =
        typeof data?.description === "string" && data.description.trim().length > 0
          ? data.description.trim()
          : "Telegram getMe did not return ok=true.";
      return { bot: null, error };
    }
    const id = data.result?.id;
    if (typeof id !== "number" && typeof id !== "string") {
      return { bot: null, error: "Telegram getMe returned no bot id." };
    }
    return {
      bot: {
        id: String(id),
        ...(typeof data.result?.username === "string" && data.result.username.trim().length > 0
          ? { username: data.result.username.trim() }
          : {}),
        ...(typeof data.result?.first_name === "string" && data.result.first_name.trim().length > 0
          ? { firstName: data.result.first_name.trim() }
          : {}),
        ...(typeof data.result?.is_bot === "boolean" ? { isBot: data.result.is_bot } : {}),
      },
    };
  } catch (error) {
    return {
      bot: null,
      error: String(error instanceof Error ? error.message : error),
    };
  }
}

type TelegramUpdatesMessage = {
  chat?: { id?: number | string };
  message_thread_id?: number;
};

type TelegramUpdate = {
  update_id?: number;
  message?: TelegramUpdatesMessage;
  edited_message?: TelegramUpdatesMessage;
  channel_post?: TelegramUpdatesMessage;
  edited_channel_post?: TelegramUpdatesMessage;
};

export type TelegramLatestDeliveryTarget = {
  target: string;
  chatId: string;
  messageThreadId?: number;
};

export type TelegramLatestDeliveryTargetResult = {
  target: TelegramLatestDeliveryTarget | null;
  error?: string;
};

function pickUpdateMessage(update: TelegramUpdate): TelegramUpdatesMessage | null {
  if (update.message) {
    return update.message;
  }
  if (update.edited_message) {
    return update.edited_message;
  }
  if (update.channel_post) {
    return update.channel_post;
  }
  if (update.edited_channel_post) {
    return update.edited_channel_post;
  }
  return null;
}

function formatDeliveryTarget(chatId: string, messageThreadId: number | undefined): string {
  if (
    typeof messageThreadId === "number" &&
    Number.isFinite(messageThreadId) &&
    messageThreadId > 0
  ) {
    return `${chatId}:topic:${Math.trunc(messageThreadId)}`;
  }
  return chatId;
}

function extractLatestDeliveryTargetFromUpdates(
  updates: TelegramUpdate[],
): TelegramLatestDeliveryTarget | null {
  let selected: { target: TelegramLatestDeliveryTarget; updateId: number | null } | null = null;
  for (const update of updates) {
    const message = pickUpdateMessage(update);
    if (!message) {
      continue;
    }
    const rawChatId = message.chat?.id;
    if (typeof rawChatId !== "number" && typeof rawChatId !== "string") {
      continue;
    }
    const chatId = String(rawChatId).trim();
    if (!chatId) {
      continue;
    }
    const messageThreadId =
      typeof message.message_thread_id === "number" && Number.isFinite(message.message_thread_id)
        ? Math.trunc(message.message_thread_id)
        : undefined;
    const candidate = {
      chatId,
      messageThreadId,
      target: formatDeliveryTarget(chatId, messageThreadId),
    } satisfies TelegramLatestDeliveryTarget;
    const updateId =
      typeof update.update_id === "number" && Number.isFinite(update.update_id)
        ? Math.trunc(update.update_id)
        : null;

    if (!selected) {
      selected = { target: candidate, updateId };
      continue;
    }
    if (updateId != null && (selected.updateId == null || updateId > selected.updateId)) {
      selected = { target: candidate, updateId };
      continue;
    }
    if (updateId == null && selected.updateId == null) {
      selected = { target: candidate, updateId };
    }
  }
  return selected?.target ?? null;
}

const TELEGRAM_UPDATES_ALLOWED_UPDATES = encodeURIComponent(
  JSON.stringify(["message", "edited_message", "channel_post", "edited_channel_post"]),
);

export async function fetchTelegramLatestDeliveryTarget(params: {
  token: string;
  signal?: AbortSignal;
  limit?: number;
}): Promise<TelegramLatestDeliveryTargetResult> {
  const normalizedLimit =
    typeof params.limit === "number" && Number.isFinite(params.limit)
      ? Math.min(100, Math.max(1, Math.trunc(params.limit)))
      : 100;
  const url = `https://api.telegram.org/bot${params.token}/getUpdates?limit=${normalizedLimit}&allowed_updates=${TELEGRAM_UPDATES_ALLOWED_UPDATES}`;
  try {
    const res = await fetch(url, params.signal ? { signal: params.signal } : undefined);
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      description?: string;
      result?: TelegramUpdate[];
    } | null;
    if (!res.ok) {
      const error =
        typeof data?.description === "string" && data.description.trim().length > 0
          ? data.description.trim()
          : `Telegram getUpdates failed with HTTP ${res.status}.`;
      return { target: null, error };
    }
    if (!data?.ok) {
      const error =
        typeof data?.description === "string" && data.description.trim().length > 0
          ? data.description.trim()
          : "Telegram getUpdates did not return ok=true.";
      return { target: null, error };
    }
    if (!Array.isArray(data.result)) {
      return { target: null };
    }
    return {
      target: extractLatestDeliveryTargetFromUpdates(data.result),
    };
  } catch (error) {
    return {
      target: null,
      error: String(error instanceof Error ? error.message : error),
    };
  }
}
