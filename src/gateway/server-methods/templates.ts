import { compileAgentBlueprintPlan } from "../../agents/blueprints/compiler.js";
import { loadAgentBlueprint } from "../../agents/blueprints/files.js";
import { applyAgentBlueprint } from "../../agents/blueprints/materialize.js";
import {
  getAgentBlueprintTemplate,
  listAgentBlueprintCatalog,
} from "../../agents/blueprints/registry.js";
import {
  listAgentBlueprintTemplateVariables,
  resolveAgentBlueprintVariables,
} from "../../agents/blueprints/variables.js";
import { loadConfig } from "../../config/config.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

function parseVariablesMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      out[key] = value;
    }
  }
  return out;
}

export const templatesHandlers: GatewayRequestHandlers = {
  "agents.templates.catalog": ({ params, respond }) => {
    const paramsRecord = typeof params === "object" && params !== null ? params : null;
    const tier = paramsRecord && "tier" in paramsRecord ? paramsRecord.tier : undefined;
    const catalog = listAgentBlueprintCatalog(
      typeof tier === "string" ? { tier: tier as "starter" | "stretch" } : {},
    );
    // Enrich each entry with the full bundle and template variables
    const enriched = catalog.map((entry) => {
      const bundle = getAgentBlueprintTemplate(entry.templateId);
      const variables = bundle ? listAgentBlueprintTemplateVariables(bundle) : [];
      return { ...entry, bundle: bundle ?? null, variables };
    });
    respond(true, { catalog: enriched }, undefined);
  },

  "agents.templates.plan": async ({ params, respond }) => {
    const p = params as Record<string, unknown> | null;
    const input = typeof p?.input === "string" ? p.input.trim() : "";
    if (!input) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "agents.templates.plan requires an `input` param (template ID or file path)",
        ),
      );
      return;
    }
    const variables = parseVariablesMap(p?.variables);

    try {
      const loaded = await loadAgentBlueprint(input);
      const resolved = resolveAgentBlueprintVariables({
        bundle: loaded.bundle,
        variables,
      });
      const cfg = loadConfig();
      const plan = await compileAgentBlueprintPlan({
        bundle: resolved.bundle,
        cfg,
        source: { kind: loaded.kind, value: loaded.source, format: loaded.format },
      });
      respond(
        true,
        {
          plan,
          unresolved: resolved.unresolved,
          resolved: resolved.resolved,
        },
        undefined,
      );
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, String(err instanceof Error ? err.message : err)),
      );
    }
  },

  "agents.templates.apply": async ({ params, respond }) => {
    const p = params as Record<string, unknown> | null;
    const input = typeof p?.input === "string" ? p.input.trim() : "";
    if (!input) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "agents.templates.apply requires an `input` param (template ID or file path)",
        ),
      );
      return;
    }
    const variables = parseVariablesMap(p?.variables);

    try {
      const loaded = await loadAgentBlueprint(input);
      const result = await applyAgentBlueprint({ loaded, variables });
      respond(true, result, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, String(err instanceof Error ? err.message : err)),
      );
    }
  },
};
