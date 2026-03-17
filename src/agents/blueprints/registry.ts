import {
  ALL_BLUEPRINT_EXAMPLES,
  STARTER_BLUEPRINT_TEMPLATE_IDS,
  STRETCH_BLUEPRINT_TEMPLATE_IDS,
} from "./examples.js";
import type { AgentBlueprintBundle } from "./schema.js";

export type AgentBlueprintCatalogTier = "starter" | "stretch";

export type AgentBlueprintCatalogEntry = {
  templateId: string;
  displayName: string;
  summary: string;
  tags: string[];
  tier: AgentBlueprintCatalogTier;
};

const STARTER_TEMPLATE_ID_SET = new Set<string>(STARTER_BLUEPRINT_TEMPLATE_IDS);
const STRETCH_TEMPLATE_ID_SET = new Set<string>(STRETCH_BLUEPRINT_TEMPLATE_IDS);

function cloneBlueprint(bundle: AgentBlueprintBundle): AgentBlueprintBundle {
  return structuredClone(bundle);
}

function resolveCatalogTier(templateId: string): AgentBlueprintCatalogTier {
  if (STARTER_TEMPLATE_ID_SET.has(templateId)) {
    return "starter";
  }
  if (STRETCH_TEMPLATE_ID_SET.has(templateId)) {
    return "stretch";
  }
  return "starter";
}

const BLUEPRINT_CATALOG_ENTRIES = ALL_BLUEPRINT_EXAMPLES.map((bundle) => ({
  templateId: bundle.manifest.templateId,
  displayName: bundle.manifest.displayName,
  summary: bundle.manifest.summary,
  tags: [...(bundle.manifest.tags ?? [])],
  tier: resolveCatalogTier(bundle.manifest.templateId),
})) satisfies AgentBlueprintCatalogEntry[];

const BLUEPRINTS_BY_TEMPLATE_ID = new Map<string, AgentBlueprintBundle>(
  ALL_BLUEPRINT_EXAMPLES.map((bundle) => [bundle.manifest.templateId, bundle]),
);

export function listAgentBlueprintCatalog(
  opts: { tier?: AgentBlueprintCatalogTier } = {},
): AgentBlueprintCatalogEntry[] {
  const tier = opts.tier;
  return BLUEPRINT_CATALOG_ENTRIES.filter((entry) => !tier || entry.tier === tier).map((entry) => ({
    ...entry,
    tags: [...entry.tags],
  }));
}

export function isKnownAgentBlueprintTemplate(templateId: string): boolean {
  return BLUEPRINTS_BY_TEMPLATE_ID.has(templateId.trim());
}

export function getAgentBlueprintTemplate(templateId: string): AgentBlueprintBundle | undefined {
  const bundle = BLUEPRINTS_BY_TEMPLATE_ID.get(templateId.trim());
  return bundle ? cloneBlueprint(bundle) : undefined;
}

export function requireAgentBlueprintTemplate(templateId: string): AgentBlueprintBundle {
  const bundle = getAgentBlueprintTemplate(templateId);
  if (bundle) {
    return bundle;
  }
  const known = listAgentBlueprintCatalog()
    .map((entry) => entry.templateId)
    .join(", ");
  throw new Error(`Unknown agent blueprint template "${templateId}". Known templates: ${known}`);
}
