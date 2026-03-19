import {
  applyAgentBlueprintBuilderPlan,
  compileAgentBlueprintBuilderPlan,
  verifyAgentBlueprintBuilderPlan,
} from "../../agents/blueprints/builder.js";
import { loadConfig } from "../../config/config.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

function parseBuilderParams(raw: unknown): { brief: string; templateId?: string } {
  if (!raw || typeof raw !== "object") {
    return { brief: "" };
  }
  const record = raw as Record<string, unknown>;
  const brief = typeof record.brief === "string" ? record.brief.trim() : "";
  const templateId = typeof record.templateId === "string" ? record.templateId.trim() : "";
  return {
    brief,
    ...(templateId ? { templateId } : {}),
  };
}

export const builderHandlers: GatewayRequestHandlers = {
  "agents.builder.plan": async ({ params, respond }) => {
    const parsed = parseBuilderParams(params);
    if (!parsed.brief) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "agents.builder.plan requires a `brief` param."),
      );
      return;
    }
    try {
      const result = await compileAgentBlueprintBuilderPlan({
        brief: parsed.brief,
        ...(parsed.templateId ? { templateId: parsed.templateId } : {}),
        cfg: loadConfig(),
      });
      respond(true, result, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, String(error instanceof Error ? error.message : error)),
      );
    }
  },

  "agents.builder.apply": async ({ params, respond }) => {
    const parsed = parseBuilderParams(params);
    if (!parsed.brief) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "agents.builder.apply requires a `brief` param."),
      );
      return;
    }
    try {
      const cfg = loadConfig();
      const result = await applyAgentBlueprintBuilderPlan({
        brief: parsed.brief,
        ...(parsed.templateId ? { templateId: parsed.templateId } : {}),
        cfg,
      });
      respond(true, result, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, String(error instanceof Error ? error.message : error)),
      );
    }
  },

  "agents.builder.verify": async ({ params, respond }) => {
    const parsed = parseBuilderParams(params);
    if (!parsed.brief) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "agents.builder.verify requires a `brief` param."),
      );
      return;
    }
    try {
      const cfg = loadConfig();
      const result = await verifyAgentBlueprintBuilderPlan({
        brief: parsed.brief,
        ...(parsed.templateId ? { templateId: parsed.templateId } : {}),
        cfg,
      });
      respond(true, result, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, String(error instanceof Error ? error.message : error)),
      );
    }
  },
};
