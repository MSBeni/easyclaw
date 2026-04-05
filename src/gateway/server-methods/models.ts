import { DEFAULT_PROVIDER } from "../../agents/defaults.js";
import { resolveModelAuthMode } from "../../agents/model-auth.js";
import { buildAllowedModelSet } from "../../agents/model-selection.js";
import { loadConfig } from "../../config/config.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateModelsListParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

export const modelsHandlers: GatewayRequestHandlers = {
  "models.list": async ({ params, respond, context }) => {
    if (!validateModelsListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.list params: ${formatValidationErrors(validateModelsListParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const catalog = await context.loadGatewayModelCatalog();
      const cfg = loadConfig();
      const { allowedCatalog } = buildAllowedModelSet({
        cfg,
        catalog,
        defaultProvider: DEFAULT_PROVIDER,
      });
      const models = allowedCatalog.length > 0 ? allowedCatalog : catalog;

      // Annotate each model with whether its provider has credentials configured.
      // Cache provider lookups to avoid redundant checks for the same provider.
      const providerConfigured = new Map<string, boolean>();
      const annotated = models.map((entry) => {
        const provider = entry.provider?.trim();
        if (!provider) {
          return { ...entry, configured: false };
        }
        if (!providerConfigured.has(provider)) {
          const authMode = resolveModelAuthMode(provider, cfg);
          providerConfigured.set(provider, authMode !== undefined && authMode !== "unknown");
        }
        return { ...entry, configured: providerConfigured.get(provider) ?? false };
      });

      respond(true, { models: annotated }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};
