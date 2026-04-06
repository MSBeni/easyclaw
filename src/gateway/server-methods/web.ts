import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { listChannelPlugins } from "../../channels/plugins/index.js";
import type { ChannelPlugin } from "../../channels/plugins/types.js";
import { loadConfig } from "../../config/config.js";
import { applyPluginAutoEnable } from "../../config/plugin-auto-enable.js";
import { loadOpenClawPlugins } from "../../plugins/loader.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateWebLoginStartParams,
  validateWebLoginWaitParams,
} from "../protocol/index.js";
import { formatForLog } from "../ws-log.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

const WEB_LOGIN_METHODS = new Set(["web.login.start", "web.login.wait"]);

function resolveWebLoginProviderFromPlugins(plugins: ChannelPlugin[]): ChannelPlugin | null {
  return (
    plugins.find((plugin) =>
      (plugin.gatewayMethods ?? []).some((method) => WEB_LOGIN_METHODS.has(method)),
    ) ??
    plugins.find(
      (plugin) =>
        typeof plugin.gateway?.loginWithQrStart === "function" &&
        typeof plugin.gateway?.loginWithQrWait === "function",
    ) ??
    null
  );
}

const resolveWebLoginProvider = () => resolveWebLoginProviderFromPlugins(listChannelPlugins());

function bootstrapWebLoginProvider(): {
  provider: ChannelPlugin | null;
  diagnostics: string[];
} {
  try {
    const cfg = loadConfig();
    const autoEnabled = applyPluginAutoEnable({ config: cfg }).config;
    const defaultAgentId = resolveDefaultAgentId(autoEnabled);
    const workspaceDir = resolveAgentWorkspaceDir(autoEnabled, defaultAgentId);
    const registry = loadOpenClawPlugins({
      config: autoEnabled,
      workspaceDir,
    });
    const provider = resolveWebLoginProviderFromPlugins(
      registry.channels.map((entry) => entry.plugin),
    );
    const diagnostics = registry.diagnostics
      .filter((entry) => {
        const pluginId = entry.pluginId?.toLowerCase() ?? "";
        const source = entry.source?.toLowerCase() ?? "";
        const message = entry.message.toLowerCase();
        return (
          pluginId === "whatsapp" || source.includes("whatsapp") || message.includes("whatsapp")
        );
      })
      .map((entry) => entry.message.trim())
      .filter(Boolean)
      .slice(0, 2);
    return { provider, diagnostics };
  } catch (error) {
    return {
      provider: null,
      diagnostics: [`plugin bootstrap failed: ${formatForLog(error)}`],
    };
  }
}

function resolveAccountId(params: unknown): string | undefined {
  return typeof (params as { accountId?: unknown }).accountId === "string"
    ? (params as { accountId?: string }).accountId
    : undefined;
}

function respondProviderUnavailable(respond: RespondFn, diagnostics?: string[]) {
  const details = diagnostics?.filter(Boolean).join(" | ") ?? "";
  respond(
    false,
    undefined,
    errorShape(
      ErrorCodes.INVALID_REQUEST,
      details
        ? `web login provider is not available (enable channels.whatsapp.enabled and apply config; if plugins.allow is set, include whatsapp). Details: ${details}`
        : "web login provider is not available (enable channels.whatsapp.enabled and apply config; if plugins.allow is set, include whatsapp).",
    ),
  );
}

function respondProviderUnsupported(respond: RespondFn, providerId: string) {
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.INVALID_REQUEST, `web login is not supported by provider ${providerId}`),
  );
}

export const webHandlers: GatewayRequestHandlers = {
  "web.login.start": async ({ params, respond, context }) => {
    if (!validateWebLoginStartParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid web.login.start params: ${formatValidationErrors(validateWebLoginStartParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const accountId = resolveAccountId(params);
      let provider = resolveWebLoginProvider();
      let diagnostics: string[] = [];
      if (!provider) {
        const bootstrapped = bootstrapWebLoginProvider();
        provider = bootstrapped.provider;
        diagnostics = bootstrapped.diagnostics;
      }
      if (!provider) {
        respondProviderUnavailable(respond, diagnostics);
        return;
      }
      await context.stopChannel(provider.id, accountId);
      if (!provider.gateway?.loginWithQrStart) {
        respondProviderUnsupported(respond, provider.id);
        return;
      }
      const result = await provider.gateway.loginWithQrStart({
        force: Boolean((params as { force?: boolean }).force),
        timeoutMs:
          typeof (params as { timeoutMs?: unknown }).timeoutMs === "number"
            ? (params as { timeoutMs?: number }).timeoutMs
            : undefined,
        verbose: Boolean((params as { verbose?: boolean }).verbose),
        accountId,
      });
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  "web.login.wait": async ({ params, respond, context }) => {
    if (!validateWebLoginWaitParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid web.login.wait params: ${formatValidationErrors(validateWebLoginWaitParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const accountId = resolveAccountId(params);
      let provider = resolveWebLoginProvider();
      let diagnostics: string[] = [];
      if (!provider) {
        const bootstrapped = bootstrapWebLoginProvider();
        provider = bootstrapped.provider;
        diagnostics = bootstrapped.diagnostics;
      }
      if (!provider) {
        respondProviderUnavailable(respond, diagnostics);
        return;
      }
      if (!provider.gateway?.loginWithQrWait) {
        respondProviderUnsupported(respond, provider.id);
        return;
      }
      const result = await provider.gateway.loginWithQrWait({
        timeoutMs:
          typeof (params as { timeoutMs?: unknown }).timeoutMs === "number"
            ? (params as { timeoutMs?: number }).timeoutMs
            : undefined,
        accountId,
      });
      if (result.connected) {
        await context.startChannel(provider.id, accountId);
      }
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
};
