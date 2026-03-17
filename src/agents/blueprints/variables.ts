import type { AgentBlueprintBundle } from "./schema.js";

export type AgentBlueprintVariableMap = Record<string, string>;

export type ResolvedAgentBlueprintVariables = {
  bundle: AgentBlueprintBundle;
  resolved: string[];
  unresolved: string[];
};

const BLUEPRINT_TEMPLATE_VARIABLE_RE = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

function resolveBlueprintValue(value: unknown, vars: AgentBlueprintVariableMap): unknown {
  if (typeof value === "string") {
    return value.replace(BLUEPRINT_TEMPLATE_VARIABLE_RE, (match, name: string) => {
      const next = vars[name];
      return typeof next === "string" ? next : match;
    });
  }
  if (Array.isArray(value)) {
    return value.map((entry) => resolveBlueprintValue(entry, vars));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, resolveBlueprintValue(entry, vars)]),
  );
}

function collectTemplateVariables(value: unknown, names: Set<string>) {
  if (typeof value === "string") {
    for (const match of value.matchAll(BLUEPRINT_TEMPLATE_VARIABLE_RE)) {
      const name = match[1]?.trim();
      if (name) {
        names.add(name);
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectTemplateVariables(entry, names);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const entry of Object.values(value)) {
    collectTemplateVariables(entry, names);
  }
}

export function listAgentBlueprintTemplateVariables(bundle: AgentBlueprintBundle): string[] {
  const names = new Set<string>();
  collectTemplateVariables(bundle, names);
  return Array.from(names).toSorted();
}

export function resolveAgentBlueprintVariables(params: {
  bundle: AgentBlueprintBundle;
  variables?: AgentBlueprintVariableMap;
}): ResolvedAgentBlueprintVariables {
  const variables = params.variables ?? {};
  const resolvedBundle = resolveBlueprintValue(params.bundle, variables) as AgentBlueprintBundle;
  const unresolved = listAgentBlueprintTemplateVariables(resolvedBundle);
  const resolved = listAgentBlueprintTemplateVariables(params.bundle).filter(
    (name) => !unresolved.includes(name),
  );
  return {
    bundle: resolvedBundle,
    resolved,
    unresolved,
  };
}
