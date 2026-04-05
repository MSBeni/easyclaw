import type { BaseTokenResolution } from "../../../src/channels/plugins/types.js";
import type { OpenClawConfig } from "../../../src/config/config.js";
import { normalizeResolvedSecretInputString } from "../../../src/config/types.secrets.js";
import type { TelegramAccountConfig } from "../../../src/config/types.telegram.js";
import { tryReadSecretFileSync } from "../../../src/infra/secret-file.js";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "../../../src/routing/session-key.js";

export type TelegramTokenSource = "env" | "tokenFile" | "config" | "none";

export type TelegramTokenResolution = BaseTokenResolution & {
  source: TelegramTokenSource;
};

type ResolveTelegramTokenOpts = {
  envToken?: string | null;
  accountId?: string | null;
  logMissingFile?: (message: string) => void;
};

// Users often paste tokens with hidden whitespace/newlines, or with Unicode dash
// characters copied from rich text. Normalize these common input artifacts.
const TELEGRAM_TOKEN_DASH_RE = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g;

export function normalizeTelegramBotToken(raw: string | undefined | null): string {
  if (typeof raw !== "string") {
    return "";
  }
  return raw.replace(TELEGRAM_TOKEN_DASH_RE, "-").replace(/\s+/g, "").trim();
}

export function resolveTelegramToken(
  cfg?: OpenClawConfig,
  opts: ResolveTelegramTokenOpts = {},
): TelegramTokenResolution {
  const accountId = normalizeAccountId(opts.accountId);
  const telegramCfg = cfg?.channels?.telegram;

  // Account IDs are normalized for routing (e.g. lowercased). Config keys may not
  // be normalized, so resolve per-account config by matching normalized IDs.
  const resolveAccountCfg = (id: string): TelegramAccountConfig | undefined => {
    const accounts = telegramCfg?.accounts;
    if (!accounts || typeof accounts !== "object" || Array.isArray(accounts)) {
      return undefined;
    }
    // Direct hit (already normalized key)
    const direct = accounts[id];
    if (direct) {
      return direct;
    }
    // Fallback: match by normalized key
    const matchKey = Object.keys(accounts).find((key) => normalizeAccountId(key) === id);
    return matchKey ? accounts[matchKey] : undefined;
  };

  const accountCfg = resolveAccountCfg(
    accountId !== DEFAULT_ACCOUNT_ID ? accountId : DEFAULT_ACCOUNT_ID,
  );
  const accountTokenFile = accountCfg?.tokenFile?.trim();
  if (accountTokenFile) {
    const token = tryReadSecretFileSync(
      accountTokenFile,
      `channels.telegram.accounts.${accountId}.tokenFile`,
      { rejectSymlink: true },
    );
    const normalizedToken = normalizeTelegramBotToken(token);
    if (normalizedToken) {
      return { token: normalizedToken, source: "tokenFile" };
    }
    opts.logMissingFile?.(
      `channels.telegram.accounts.${accountId}.tokenFile not found or unreadable: ${accountTokenFile}`,
    );
    return { token: "", source: "none" };
  }

  const accountToken = normalizeResolvedSecretInputString({
    value: accountCfg?.botToken,
    path: `channels.telegram.accounts.${accountId}.botToken`,
  });
  const normalizedAccountToken = normalizeTelegramBotToken(accountToken);
  if (normalizedAccountToken) {
    return { token: normalizedAccountToken, source: "config" };
  }

  const allowEnv = accountId === DEFAULT_ACCOUNT_ID;
  const tokenFile = telegramCfg?.tokenFile?.trim();
  if (tokenFile) {
    const token = tryReadSecretFileSync(tokenFile, "channels.telegram.tokenFile", {
      rejectSymlink: true,
    });
    const normalizedToken = normalizeTelegramBotToken(token);
    if (normalizedToken) {
      return { token: normalizedToken, source: "tokenFile" };
    }
    opts.logMissingFile?.(`channels.telegram.tokenFile not found or unreadable: ${tokenFile}`);
    return { token: "", source: "none" };
  }

  const configToken = normalizeResolvedSecretInputString({
    value: telegramCfg?.botToken,
    path: "channels.telegram.botToken",
  });
  const normalizedConfigToken = normalizeTelegramBotToken(configToken);
  if (normalizedConfigToken) {
    return { token: normalizedConfigToken, source: "config" };
  }

  const envToken = allowEnv
    ? normalizeTelegramBotToken(opts.envToken ?? process.env.TELEGRAM_BOT_TOKEN)
    : "";
  if (envToken) {
    return { token: envToken, source: "env" };
  }

  return { token: "", source: "none" };
}
