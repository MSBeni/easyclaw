const KEY = "openclaw.control.settings.v1";
const LEGACY_TOKEN_SESSION_KEY = "openclaw.control.token.v1";
const TOKEN_SESSION_KEY_PREFIX = "openclaw.control.token.v1:";
const BUILDER_DRAFT_SESSION_KEY = "openclaw.control.builder-draft.v1";
const BUILDER_SETUP_SESSION_KEY = "openclaw.control.builder-setup.v1";

type PersistedUiSettings = Omit<UiSettings, "token"> & { token?: never };

import { isSupportedLocale } from "../i18n/index.ts";
import type { BuilderSetupRunResult } from "./controllers/builder.ts";
import { inferBasePathFromPathname, normalizeBasePath } from "./navigation.ts";
import { parseThemeSelection, type ThemeMode, type ThemeName } from "./theme.ts";

export type UiSettings = {
  gatewayUrl: string;
  token: string;
  sessionKey: string;
  lastActiveSessionKey: string;
  theme: ThemeName;
  themeMode: ThemeMode;
  chatFocusMode: boolean;
  chatShowThinking: boolean;
  chatShowToolCalls: boolean;
  splitRatio: number; // Sidebar split ratio (0.4 to 0.7, default 0.6)
  navCollapsed: boolean; // Collapsible sidebar state
  navWidth: number; // Sidebar width when expanded (240–400px)
  navGroupsCollapsed: Record<string, boolean>; // Which nav groups are collapsed
  locale?: string;
};

export type BuilderDraftSettings = {
  brief: string;
  approvalPosture: string;
  templateId: string;
  modelId: string;
  agentName: string;
};

export type BuilderSetupSessionState = {
  focus: Record<string, unknown> | null;
  inputs: Record<string, string>;
  result: BuilderSetupRunResult | null;
};

function isViteDevPage(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  return Boolean(document.querySelector('script[src*="/@vite/client"]'));
}

function formatHostWithPort(hostname: string, port: string): string {
  const normalizedHost = hostname.includes(":") ? `[${hostname}]` : hostname;
  return `${normalizedHost}:${port}`;
}

function deriveDefaultGatewayUrl(): { pageUrl: string; effectiveUrl: string } {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const configured =
    typeof window !== "undefined" &&
    typeof window.__OPENCLAW_CONTROL_UI_BASE_PATH__ === "string" &&
    window.__OPENCLAW_CONTROL_UI_BASE_PATH__.trim();
  const basePath = configured
    ? normalizeBasePath(configured)
    : inferBasePathFromPathname(location.pathname);
  const pageUrl = `${proto}://${location.host}${basePath}`;
  if (!isViteDevPage()) {
    return { pageUrl, effectiveUrl: pageUrl };
  }
  const effectiveUrl = `${proto}://${formatHostWithPort(location.hostname, "18789")}`;
  return { pageUrl, effectiveUrl };
}

function getSessionStorage(): Storage | null {
  if (typeof window !== "undefined" && window.sessionStorage) {
    return window.sessionStorage;
  }
  if (typeof sessionStorage !== "undefined") {
    return sessionStorage;
  }
  return null;
}

function normalizeGatewayTokenScope(gatewayUrl: string): string {
  const trimmed = gatewayUrl.trim();
  if (!trimmed) {
    return "default";
  }
  try {
    const base =
      typeof location !== "undefined"
        ? `${location.protocol}//${location.host}${location.pathname || "/"}`
        : undefined;
    const parsed = base ? new URL(trimmed, base) : new URL(trimmed);
    const pathname =
      parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "") || parsed.pathname;
    return `${parsed.protocol}//${parsed.host}${pathname}`;
  } catch {
    return trimmed;
  }
}

function tokenSessionKeyForGateway(gatewayUrl: string): string {
  return `${TOKEN_SESSION_KEY_PREFIX}${normalizeGatewayTokenScope(gatewayUrl)}`;
}

function loadSessionToken(gatewayUrl: string): string {
  try {
    const storage = getSessionStorage();
    if (!storage) {
      return "";
    }
    storage.removeItem(LEGACY_TOKEN_SESSION_KEY);
    const token = storage.getItem(tokenSessionKeyForGateway(gatewayUrl)) ?? "";
    return token.trim();
  } catch {
    return "";
  }
}

function persistSessionToken(gatewayUrl: string, token: string) {
  try {
    const storage = getSessionStorage();
    if (!storage) {
      return;
    }
    storage.removeItem(LEGACY_TOKEN_SESSION_KEY);
    const key = tokenSessionKeyForGateway(gatewayUrl);
    const normalized = token.trim();
    if (normalized) {
      storage.setItem(key, normalized);
      return;
    }
    storage.removeItem(key);
  } catch {
    // best-effort
  }
}

function normalizeBuilderDraftField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) =>
      typeof entry === "string" ? [[key, entry] as const] : [],
    ),
  );
}

function normalizeBuilderSetupResult(value: unknown): BuilderSetupSessionState["result"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as BuilderSetupRunResult;
}

export function loadBuilderDraft(): BuilderDraftSettings {
  const defaults: BuilderDraftSettings = {
    brief: "",
    approvalPosture: "",
    templateId: "",
    modelId: "",
    agentName: "",
  };
  try {
    const storage = getSessionStorage();
    if (!storage) {
      return defaults;
    }
    const raw = storage.getItem(BUILDER_DRAFT_SESSION_KEY);
    if (!raw) {
      return defaults;
    }
    const parsed = JSON.parse(raw) as Partial<BuilderDraftSettings>;
    return {
      brief: normalizeBuilderDraftField(parsed.brief),
      approvalPosture: normalizeBuilderDraftField(parsed.approvalPosture),
      templateId: normalizeBuilderDraftField(parsed.templateId),
      modelId: normalizeBuilderDraftField(parsed.modelId),
      agentName: normalizeBuilderDraftField(parsed.agentName),
    };
  } catch {
    return defaults;
  }
}

export function saveBuilderDraft(next: BuilderDraftSettings) {
  try {
    const storage = getSessionStorage();
    if (!storage) {
      return;
    }
    storage.setItem(
      BUILDER_DRAFT_SESSION_KEY,
      JSON.stringify({
        brief: next.brief,
        approvalPosture: next.approvalPosture,
        templateId: next.templateId,
        modelId: next.modelId,
        agentName: next.agentName,
      }),
    );
  } catch {
    // best-effort
  }
}

export function loadBuilderSetupSession(): BuilderSetupSessionState {
  try {
    const storage = getSessionStorage();
    if (!storage) {
      return {
        focus: null,
        inputs: {},
        result: null,
      };
    }
    const raw = storage.getItem(BUILDER_SETUP_SESSION_KEY);
    if (!raw) {
      return {
        focus: null,
        inputs: {},
        result: null,
      };
    }
    const parsed = JSON.parse(raw) as Partial<BuilderSetupSessionState>;
    return {
      focus:
        parsed.focus && typeof parsed.focus === "object" && !Array.isArray(parsed.focus)
          ? parsed.focus
          : null,
      inputs: normalizeStringRecord(parsed.inputs),
      result: normalizeBuilderSetupResult(parsed.result),
    };
  } catch {
    return {
      focus: null,
      inputs: {},
      result: null,
    };
  }
}

export function saveBuilderSetupSession(next: BuilderSetupSessionState) {
  try {
    const storage = getSessionStorage();
    if (!storage) {
      return;
    }
    const shouldClear = !next.focus && Object.keys(next.inputs).length === 0 && next.result == null;
    if (shouldClear) {
      storage.removeItem(BUILDER_SETUP_SESSION_KEY);
      return;
    }
    storage.setItem(
      BUILDER_SETUP_SESSION_KEY,
      JSON.stringify({
        focus: next.focus,
        inputs: next.inputs,
        result: next.result,
      }),
    );
  } catch {
    // best-effort
  }
}

export function clearBuilderSetupSession() {
  try {
    const storage = getSessionStorage();
    if (!storage) {
      return;
    }
    storage.removeItem(BUILDER_SETUP_SESSION_KEY);
  } catch {
    // best-effort
  }
}

export function loadSettings(): UiSettings {
  const { pageUrl: pageDerivedUrl, effectiveUrl: defaultUrl } = deriveDefaultGatewayUrl();

  const defaults: UiSettings = {
    gatewayUrl: defaultUrl,
    token: loadSessionToken(defaultUrl),
    sessionKey: "main",
    lastActiveSessionKey: "main",
    theme: "claw",
    themeMode: "system",
    chatFocusMode: false,
    chatShowThinking: true,
    chatShowToolCalls: true,
    splitRatio: 0.6,
    navCollapsed: false,
    navWidth: 220,
    navGroupsCollapsed: {},
  };

  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      return defaults;
    }
    const parsed = JSON.parse(raw) as Partial<UiSettings>;
    const parsedGatewayUrl =
      typeof parsed.gatewayUrl === "string" && parsed.gatewayUrl.trim()
        ? parsed.gatewayUrl.trim()
        : defaults.gatewayUrl;
    const gatewayUrl = parsedGatewayUrl === pageDerivedUrl ? defaultUrl : parsedGatewayUrl;
    const { theme, mode } = parseThemeSelection(
      (parsed as { theme?: unknown }).theme,
      (parsed as { themeMode?: unknown }).themeMode,
    );
    const settings = {
      gatewayUrl,
      // Gateway auth is intentionally in-memory only; scrub any legacy persisted token on load.
      token: loadSessionToken(gatewayUrl),
      sessionKey:
        typeof parsed.sessionKey === "string" && parsed.sessionKey.trim()
          ? parsed.sessionKey.trim()
          : defaults.sessionKey,
      lastActiveSessionKey:
        typeof parsed.lastActiveSessionKey === "string" && parsed.lastActiveSessionKey.trim()
          ? parsed.lastActiveSessionKey.trim()
          : (typeof parsed.sessionKey === "string" && parsed.sessionKey.trim()) ||
            defaults.lastActiveSessionKey,
      theme,
      themeMode: mode,
      chatFocusMode:
        typeof parsed.chatFocusMode === "boolean" ? parsed.chatFocusMode : defaults.chatFocusMode,
      chatShowThinking:
        typeof parsed.chatShowThinking === "boolean"
          ? parsed.chatShowThinking
          : defaults.chatShowThinking,
      chatShowToolCalls:
        typeof parsed.chatShowToolCalls === "boolean"
          ? parsed.chatShowToolCalls
          : defaults.chatShowToolCalls,
      splitRatio:
        typeof parsed.splitRatio === "number" &&
        parsed.splitRatio >= 0.4 &&
        parsed.splitRatio <= 0.7
          ? parsed.splitRatio
          : defaults.splitRatio,
      navCollapsed:
        typeof parsed.navCollapsed === "boolean" ? parsed.navCollapsed : defaults.navCollapsed,
      navWidth:
        typeof parsed.navWidth === "number" && parsed.navWidth >= 200 && parsed.navWidth <= 400
          ? parsed.navWidth
          : defaults.navWidth,
      navGroupsCollapsed:
        typeof parsed.navGroupsCollapsed === "object" && parsed.navGroupsCollapsed !== null
          ? parsed.navGroupsCollapsed
          : defaults.navGroupsCollapsed,
      locale: isSupportedLocale(parsed.locale) ? parsed.locale : undefined,
    };
    if ("token" in parsed) {
      persistSettings(settings);
    }
    return settings;
  } catch {
    return defaults;
  }
}

export function saveSettings(next: UiSettings) {
  persistSettings(next);
}

function persistSettings(next: UiSettings) {
  persistSessionToken(next.gatewayUrl, next.token);
  const persisted: PersistedUiSettings = {
    gatewayUrl: next.gatewayUrl,
    sessionKey: next.sessionKey,
    lastActiveSessionKey: next.lastActiveSessionKey,
    theme: next.theme,
    themeMode: next.themeMode,
    chatFocusMode: next.chatFocusMode,
    chatShowThinking: next.chatShowThinking,
    chatShowToolCalls: next.chatShowToolCalls,
    splitRatio: next.splitRatio,
    navCollapsed: next.navCollapsed,
    navWidth: next.navWidth,
    navGroupsCollapsed: next.navGroupsCollapsed,
    ...(next.locale ? { locale: next.locale } : {}),
  };
  localStorage.setItem(KEY, JSON.stringify(persisted));
}
