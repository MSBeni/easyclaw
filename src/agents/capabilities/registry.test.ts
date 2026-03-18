import { describe, expect, it } from "vitest";
import { buildOpenClawCapabilityRegistry } from "./openclaw.js";
import {
  buildCapabilityRegistry,
  getCapabilityContract,
  listConnectorsForContract,
} from "./registry.js";
import type { CapabilityContract, ConnectorDefinition } from "./schema.js";

const TEST_CONTRACT: CapabilityContract = {
  id: "transform.normalize",
  label: "Normalize",
  summary: "Normalize a payload.",
  family: "transform",
  semanticVerbs: ["normalize"],
  requiredInputs: ["payload"],
  producedOutputs: ["normalized payload"],
  requiresTools: [],
  requiresToolSections: [],
  configRequirements: [],
  authRequirements: [],
  setupHints: [],
  risk: "read_only",
  verification: [],
};

const TEST_CONNECTOR: ConnectorDefinition = {
  id: "external:normalizer",
  label: "Normalizer",
  kind: "plugin",
  summary: "External normalizer plugin.",
  contracts: ["transform.normalize"],
  riskClasses: ["read_only"],
  source: {
    kind: "external",
    id: "normalizer",
  },
  install: {
    required: true,
    strategy: "external",
  },
  setup: {
    onboarding: false,
    requiresConfig: true,
    requiresAuth: false,
  },
  verification: {
    supported: true,
    probes: [],
  },
  metadata: {},
};

describe("capability registry", () => {
  it("indexes contracts and connectors by id", () => {
    const registry = buildCapabilityRegistry({
      contracts: [TEST_CONTRACT],
      connectors: [TEST_CONNECTOR],
    });

    expect(getCapabilityContract(registry, "transform.normalize")?.label).toBe("Normalize");
    expect(listConnectorsForContract(registry, "transform.normalize")).toEqual([TEST_CONNECTOR]);
  });

  it("rejects duplicate contract ids", () => {
    expect(() =>
      buildCapabilityRegistry({
        contracts: [TEST_CONTRACT, TEST_CONTRACT],
        connectors: [TEST_CONNECTOR],
      }),
    ).toThrow('Duplicate contract id "transform.normalize"');
  });

  it("rejects connector references to unknown contracts", () => {
    expect(() =>
      buildCapabilityRegistry({
        contracts: [TEST_CONTRACT],
        connectors: [
          {
            ...TEST_CONNECTOR,
            contracts: ["transform.missing"],
          },
        ],
      }),
    ).toThrow('references unknown capability contract "transform.missing"');
  });
});

describe("openclaw capability substrate", () => {
  it("builds a registry with core tool and channel connectors", () => {
    const registry = buildOpenClawCapabilityRegistry({ includeCatalog: false });

    expect(getCapabilityContract(registry, "ingress.chat")).toBeDefined();
    expect(getCapabilityContract(registry, "browser.operate")).toBeDefined();
    expect(getCapabilityContract(registry, "schedule.trigger")).toBeDefined();

    expect(registry.connectorsById.get("channel:telegram")?.contracts).toContain("ingress.chat");
    expect(registry.connectorsById.get("channel:slack")?.contracts).toContain("delivery.chat");
    expect(registry.connectorsById.get("tools:web")?.contracts).toContain("fetch.web");
    expect(registry.connectorsById.get("tools:ui")?.contracts).toContain("browser.operate");
    expect(registry.connectorsById.get("platform:gmail-hook")?.contracts).toContain("ingest.email");
    expect(registry.connectorsById.get("platform:core-model")?.contracts).toContain(
      "transform.summarize",
    );
    expect(registry.connectorsById.get("platform:exec-approvals")?.contracts).toContain(
      "approval.request",
    );
  });

  it("supports extension contracts and connectors", () => {
    const registry = buildOpenClawCapabilityRegistry({
      includeCatalog: false,
      extraContracts: [TEST_CONTRACT],
      extraConnectors: [TEST_CONNECTOR],
    });

    expect(getCapabilityContract(registry, "transform.normalize")).toBeDefined();
    expect(registry.connectorsById.get("external:normalizer")?.source.kind).toBe("external");
  });

  it("marks built-in chat connectors as onboardable when adapters exist", () => {
    const registry = buildOpenClawCapabilityRegistry({ includeCatalog: false });

    expect(registry.connectorsById.get("channel:telegram")?.setup.onboarding).toBe(true);
    expect(registry.connectorsById.get("channel:slack")?.setup.onboarding).toBe(true);
  });
});
