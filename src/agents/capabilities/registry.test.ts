import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listCoreToolSections } from "../tool-catalog.js";
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

  it("covers every core OpenClaw tool section with at least one connector contract", () => {
    const registry = buildOpenClawCapabilityRegistry({ includeCatalog: false });

    for (const section of listCoreToolSections()) {
      expect(registry.connectorsById.get(`tools:${section.id}`)?.contracts.length).toBeGreaterThan(
        0,
      );
    }

    expect(registry.connectorsById.get("tools:nodes")?.contracts).toContain("node.operate");
    expect(registry.connectorsById.get("tools:sessions")?.contracts).toEqual(
      expect.arrayContaining(["session.inspect", "session.message", "session.spawn"]),
    );
    expect(registry.connectorsById.get("tools:ui")?.contracts).toEqual(
      expect.arrayContaining(["browser.operate", "canvas.operate"]),
    );
    expect(registry.connectorsById.get("tools:media")?.contracts).toEqual(
      expect.arrayContaining([
        "transform.image_understand",
        "transform.synthesize_speech",
        "transform.transcribe",
      ]),
    );
  });

  it("loads external capability contracts and connector overrides from the catalog", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-capability-catalog-"));
    const catalogPath = path.join(dir, "catalog.json");
    fs.writeFileSync(
      catalogPath,
      JSON.stringify({
        entries: [
          {
            name: "@openclaw/voice-call",
            openclaw: {
              channel: {
                id: "voice-call",
                label: "Voice Call",
                selectionLabel: "Voice Call",
                docsPath: "/channels/voice-call",
                blurb: "Voice call delivery",
              },
              install: {
                npmSpec: "@openclaw/voice-call",
              },
              builder: {
                capabilityContracts: [
                  {
                    id: "delivery.voice_call",
                    label: "Voice Call Delivery",
                    summary: "Deliver a result over a scoped voice call.",
                    family: "delivery",
                    semanticVerbs: ["call", "voice"],
                    requiredInputs: ["call target", "message payload"],
                    producedOutputs: ["voice delivery"],
                    requiresTools: [],
                    requiresToolSections: [],
                    configRequirements: ["call target"],
                    authRequirements: ["authenticated voice connector"],
                    setupHints: ["Connect the voice surface before activation."],
                    risk: "communicative",
                    verification: [
                      {
                        kind: "custom",
                        label: "Voice Probe",
                        successDescription: "The connector can place a scoped voice test.",
                      },
                    ],
                  },
                ],
                channelConnector: {
                  contracts: ["delivery.voice_call"],
                  riskClasses: ["communicative"],
                  setup: {
                    onboarding: false,
                    requiresConfig: true,
                    requiresAuth: false,
                  },
                  verification: {
                    supported: true,
                    probes: [
                      {
                        kind: "custom",
                        label: "Voice Probe",
                        successDescription: "The connector can place a scoped voice test.",
                      },
                    ],
                  },
                  plannerHints: {
                    aliases: ["phone call"],
                  },
                  setupActions: [
                    {
                      actionId: "channel:voice-call:verify",
                      title: "Verify voice route",
                      requiredFields: [
                        {
                          key: "destination",
                          label: "Phone destination",
                          kind: "destination",
                          required: true,
                        },
                      ],
                    },
                  ],
                  workspaceArtifacts: [
                    {
                      fileName: "VOICE_CALL.md",
                      purpose: "Voice call runbook",
                      previewSummary: "Documents the reviewed voice-call routing.",
                      managedSection: "## Voice Call Runbook",
                    },
                  ],
                },
              },
            },
          },
        ],
      }),
    );

    const registry = buildOpenClawCapabilityRegistry({ catalogPaths: [catalogPath] });
    const connector = registry.connectorsById.get("channel:voice-call");

    expect(getCapabilityContract(registry, "delivery.voice_call")?.label).toBe(
      "Voice Call Delivery",
    );
    expect(connector?.contracts).toEqual(["delivery.voice_call"]);
    expect(connector?.setup).toEqual({
      onboarding: false,
      requiresConfig: true,
      requiresAuth: false,
    });
    expect(connector?.verification).toEqual({
      supported: true,
      probes: [
        {
          kind: "custom",
          label: "Voice Probe",
          successDescription: "The connector can place a scoped voice test.",
        },
      ],
    });
    expect(connector?.metadata.aliases).toContain("phone call");
    expect(connector?.metadata.setupActionDescriptors?.[0]?.actionId).toBe(
      "channel:voice-call:verify",
    );
    expect(connector?.metadata.workspaceArtifacts?.[0]?.fileName).toBe("VOICE_CALL.md");
  });
});
