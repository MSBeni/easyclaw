import type { Api, Model } from "@mariozechner/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { getAgentBlueprintTemplate, listAgentBlueprintCatalog } from "../blueprints/registry.js";
import {
  buildOpenClawCapabilityRegistry,
  buildRequirementPlannerResult,
  buildRequirementSet,
} from "../capabilities/index.js";
import type { RequirementPlannerResult } from "../capabilities/planner.js";
import type { RequirementSet } from "../capabilities/requirements.js";
import type { CapabilityRegistry } from "../capabilities/schema.js";
import {
  __testing,
  runBuilderPlannerAgent,
  type BuilderPlannerAgentGraphInput,
  type BuilderPlannerAgentInput,
} from "./planner-agent.js";

function createRuntimeGraphFromPlanning(
  planning: RequirementPlannerResult,
): BuilderPlannerAgentGraphInput {
  if (planning.topology.mode === "single-agent") {
    return {
      mode: "single-agent",
      entryNodeId: "primary",
      nodes: [
        {
          id: "primary",
          roleId: "primary",
          label: "Primary Agent",
          entry: true,
          connectorIds: planning.selections.map((selection) => selection.connectorId),
          responsibilities: ["Handle the workflow end to end in one runtime."],
        },
      ],
      edges: [],
    };
  }

  const entryRoleId =
    planning.topology.roles.find((role) => role.id === "coordinator")?.id ?? "coordinator";
  return {
    mode: "multi-agent",
    entryNodeId: entryRoleId,
    nodes: planning.topology.roles.map((role) => ({
      id: role.id,
      roleId: role.id,
      label: role.label,
      entry: role.id === entryRoleId,
      connectorIds: role.connectorIds,
      responsibilities: role.responsibilities,
    })),
    edges: planning.topology.roles
      .filter((role) => role.id !== entryRoleId)
      .map((role) => ({
        id: `${entryRoleId}->${role.id}:delegates`,
        fromNodeId: entryRoleId,
        toNodeId: role.id,
        kind: "delegates",
        label: `Delegate work to ${role.label}`,
      })),
  };
}

function createPlannerInput(params: { brief: string }): {
  input: BuilderPlannerAgentInput;
  registry: CapabilityRegistry;
  requirements: RequirementSet;
  planning: RequirementPlannerResult;
} {
  const registry = buildOpenClawCapabilityRegistry();
  const requirements = buildRequirementSet({
    brief: params.brief,
    cfg: {
      agents: {
        defaults: {
          model: "openai/gpt-4o",
        },
      },
    },
    registry,
  });
  const planning = buildRequirementPlannerResult({
    requirements,
    cfg: {
      agents: {
        defaults: {
          model: "openai/gpt-4o",
        },
      },
    },
    registry,
  });
  const bundle = getAgentBlueprintTemplate("daily-briefing");
  if (!bundle) {
    throw new Error("missing daily-briefing template");
  }
  const runtimeGraph = createRuntimeGraphFromPlanning(planning);
  const input: BuilderPlannerAgentInput = {
    brief: params.brief,
    cfg: {
      agents: {
        defaults: {
          model: "openai/gpt-4o",
        },
      },
    },
    bundle,
    requirements,
    planning,
    templateId: "daily-briefing",
    templateDisplayName: bundle.manifest.displayName,
    templateConfidence: "medium",
    templateReasons: ["Scheduled briefing baseline."],
    assumptions: ["Baseline draft came from the daily briefing template."],
    questions: [],
    capabilityRegistry: registry,
    templateExemplars: listAgentBlueprintCatalog(),
    runtimeGraph,
  };
  return { input, registry, requirements, planning };
}

function plannerModelResolution() {
  return Promise.resolve({
    provider: "openai",
    model: "gpt-5.4",
    modelRef: "openai/gpt-5.4",
    source: "preferred-configured-reasoning-model" as const,
    resolvedModel: {} as Model<Api>,
    apiKey: "sk-test",
  });
}

afterEach(() => {
  __testing.setPlannerModelRunnerForTest();
  __testing.setResolvePlannerModelForTest();
});

describe("builder planner agent", () => {
  it("uses model-backed planner output when the emitted BuildSpec is valid", async () => {
    const { input } = createPlannerInput({
      brief:
        "Read my Gmail AI newsletters, have scouts identify trends, an analyst synthesize opportunities, and send me a WhatsApp brief every day at 9am PST.",
    });
    __testing.setResolvePlannerModelForTest(() => plannerModelResolution());
    __testing.setPlannerModelRunnerForTest(async () =>
      JSON.stringify({
        graph: {
          mode: "swarm",
          entryNodeId: "orchestrator",
          nodes: [
            {
              id: "orchestrator",
              roleId: "orchestrator",
              label: "Opportunity Orchestrator",
              entry: true,
              contractIds: ["agent.manage", "delivery.report", "message.send"],
              connectorIds: ["channel:whatsapp", "tools:sessions"],
              responsibilities: ["Coordinate scouts and analysts before delivery."],
            },
            {
              id: "scout",
              roleId: "scout",
              label: "Signal Scout",
              entry: false,
              contractIds: ["ingest.email"],
              connectorIds: ["platform:gmail-hook"],
              responsibilities: ["Read newsletters and extract promising signals."],
            },
            {
              id: "analyst",
              roleId: "analyst",
              label: "Market Analyst",
              entry: false,
              contractIds: ["transform.summarize"],
              connectorIds: ["platform:core-model"],
              responsibilities: ["Turn raw signals into ranked business opportunities."],
            },
          ],
          edges: [
            {
              id: "orchestrator->scout",
              fromNodeId: "orchestrator",
              toNodeId: "scout",
              kind: "delegates",
              label: "Scout the newsletters",
            },
            {
              id: "scout->analyst",
              fromNodeId: "scout",
              toNodeId: "analyst",
              kind: "feeds",
              label: "Pass promising signals",
            },
          ],
        },
        integrations: [
          {
            connectorId: "platform:gmail-hook",
            label: "Gmail Hook",
            status: "configured",
            kind: "integration",
            sourceKind: "core_platform",
            issues: [],
          },
          {
            connectorId: "channel:whatsapp",
            label: "WhatsApp",
            status: "configured",
            kind: "channel",
            sourceKind: "channel_catalog",
            issues: [],
          },
        ],
        setupActions: [
          {
            connectorId: "channel:whatsapp",
            title: "Confirm WhatsApp target",
            detail: "Make sure the daily brief has a verified WhatsApp destination.",
            status: "pending",
            refs: ["channels.whatsapp"],
          },
        ],
        workspaceArtifacts: [
          {
            fileName: "AGENTS.md",
            purpose: "Operating instructions.",
            status: "generated",
            previewSummary: "Orchestrator workflow summary.",
            managedSection:
              "## Easyclaw Planner Instructions\n\n- Coordinate scouts and analysts.\n- Deliver only the ranked final brief.",
          },
        ],
        assumptions: ["Gmail newsletters are the canonical source of truth."],
        questions: ["Which WhatsApp target should receive the delivery?"],
        notes: [
          "Used a three-node swarm because the brief called for distinct scouting and analysis roles.",
        ],
      }),
    );

    const result = await runBuilderPlannerAgent(input);

    expect(result.contract.kind).toBe("model-backed-hybrid");
    expect(result.buildSpec.planner.mode).toBe("model-backed");
    expect(result.buildSpec.planner.usedModelRef).toBe("openai/gpt-5.4");
    expect(result.buildSpec.graph.mode).toBe("swarm");
    expect(result.buildSpec.graph.nodes).toHaveLength(3);
    expect(
      result.buildSpec.workspaceArtifacts.find((artifact) => artifact.fileName === "AGENTS.md")
        ?.managedSection,
    ).toContain("Coordinate scouts and analysts.");
  });

  it("repairs an invalid planner response before accepting the BuildSpec", async () => {
    const { input } = createPlannerInput({
      brief:
        "Read Gmail strategy emails, have one agent collect signals and another rank opportunities before sending the result to WhatsApp.",
    });
    __testing.setResolvePlannerModelForTest(() => plannerModelResolution());
    let calls = 0;
    __testing.setPlannerModelRunnerForTest(async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          graph: {
            mode: "multi-agent",
            entryNodeId: "bad-entry",
            nodes: [
              {
                id: "bad-entry",
                roleId: "coordinator",
                label: "Coordinator",
                entry: true,
                contractIds: ["agent.manage"],
                connectorIds: ["unknown:connector"],
                responsibilities: ["Coordinate everything."],
              },
              {
                id: "bad-entry",
                roleId: "worker",
                label: "Worker",
                entry: true,
                contractIds: ["transform.summarize"],
                connectorIds: ["platform:gmail-hook"],
                responsibilities: [],
              },
            ],
            edges: [],
          },
        });
      }
      return JSON.stringify({
        graph: {
          mode: "multi-agent",
          entryNodeId: "coordinator",
          nodes: [
            {
              id: "coordinator",
              roleId: "coordinator",
              label: "Coordinator",
              entry: true,
              contractIds: ["agent.manage", "delivery.report", "message.send"],
              connectorIds: ["channel:whatsapp"],
              responsibilities: ["Coordinate the final delivery."],
            },
            {
              id: "worker",
              roleId: "worker",
              label: "Worker",
              entry: false,
              contractIds: ["ingest.email", "transform.summarize"],
              connectorIds: ["platform:gmail-hook", "platform:core-model"],
              responsibilities: ["Read Gmail and summarize ranked opportunities."],
            },
          ],
          edges: [
            {
              id: "coordinator->worker",
              fromNodeId: "coordinator",
              toNodeId: "worker",
              kind: "delegates",
              label: "Collect and rank opportunities",
            },
          ],
        },
      });
    });

    const result = await runBuilderPlannerAgent(input);

    expect(calls).toBe(2);
    expect(result.buildSpec.planner.attempts).toBe(2);
    expect(result.buildSpec.planner.repairCount).toBe(1);
    expect(result.buildSpec.graph.entryNodeId).toBe("coordinator");
    expect(result.buildSpec.graph.nodes).toHaveLength(2);
  });

  it("keeps mixed-source planning valid when the model emits a DAG-shaped BuildSpec", async () => {
    const { input } = createPlannerInput({
      brief:
        "At 9am PST every weekday, read my Gmail AI newsletters and the strategy PDFs in my workspace, have scouts collect opportunities, let an analyst rank them, and send the final brief to WhatsApp.",
    });
    __testing.setResolvePlannerModelForTest(() => plannerModelResolution());
    __testing.setPlannerModelRunnerForTest(async () =>
      JSON.stringify({
        graph: {
          mode: "swarm",
          entryNodeId: "orchestrator",
          nodes: [
            {
              id: "orchestrator",
              roleId: "orchestrator",
              label: "Opportunity Orchestrator",
              entry: true,
              contractIds: ["agent.manage", "delivery.report", "message.send"],
              connectorIds: ["channel:whatsapp", "tools:sessions"],
              responsibilities: ["Coordinate the DAG and deliver the final brief."],
            },
            {
              id: "mail-scout",
              roleId: "mail-scout",
              label: "Mail Scout",
              entry: false,
              contractIds: ["ingest.email"],
              connectorIds: ["platform:gmail-hook"],
              responsibilities: ["Read Gmail newsletters and extract opportunity signals."],
            },
            {
              id: "file-scout",
              roleId: "file-scout",
              label: "File Scout",
              entry: false,
              contractIds: ["fs.read"],
              connectorIds: ["tools:fs"],
              responsibilities: ["Review workspace PDFs for strategic context."],
            },
            {
              id: "analyst",
              roleId: "analyst",
              label: "Market Analyst",
              entry: false,
              contractIds: ["transform.summarize"],
              connectorIds: ["platform:core-model"],
              responsibilities: ["Rank the strongest business opportunities."],
            },
          ],
          edges: [
            {
              id: "orchestrator->mail-scout",
              fromNodeId: "orchestrator",
              toNodeId: "mail-scout",
              kind: "delegates",
              label: "Collect email signals",
            },
            {
              id: "orchestrator->file-scout",
              fromNodeId: "orchestrator",
              toNodeId: "file-scout",
              kind: "delegates",
              label: "Collect PDF strategy signals",
            },
            {
              id: "mail-scout->analyst",
              fromNodeId: "mail-scout",
              toNodeId: "analyst",
              kind: "feeds",
              label: "Route newsletter signals",
            },
            {
              id: "file-scout->analyst",
              fromNodeId: "file-scout",
              toNodeId: "analyst",
              kind: "feeds",
              label: "Route PDF context",
            },
          ],
        },
        integrations: [
          {
            connectorId: "platform:gmail-hook",
            label: "Gmail Hook",
            status: "configured",
            kind: "integration",
            sourceKind: "core_platform",
            issues: [],
          },
          {
            connectorId: "tools:fs",
            label: "OpenClaw Filesystem Tools",
            status: "configured",
            kind: "tooling",
            sourceKind: "core_tool_section",
            issues: [],
          },
          {
            connectorId: "channel:whatsapp",
            label: "WhatsApp",
            status: "configured",
            kind: "channel",
            sourceKind: "builtin_channel",
            issues: [],
          },
        ],
      }),
    );

    const result = await runBuilderPlannerAgent(input);

    expect(result.contract.kind).toBe("model-backed-hybrid");
    expect(result.buildSpec.graph.mode).toBe("swarm");
    expect(result.buildSpec.graph.nodes).toHaveLength(4);
    expect(result.buildSpec.graph.edges.every((edge) => edge.toNodeId !== "orchestrator")).toBe(
      true,
    );
  });

  it("normalizes explicit schedule timezone shorthands from planner output", async () => {
    const { input } = createPlannerInput({
      brief:
        "At 9am PST every weekday, read my Gmail AI newsletters and send the final brief to WhatsApp.",
    });
    __testing.setResolvePlannerModelForTest(() => plannerModelResolution());
    __testing.setPlannerModelRunnerForTest(async () =>
      JSON.stringify({
        schedule: {
          cron: "0 9 * * 1-5",
          description: "Weekdays at 9:00 AM PST",
          timezone: "PST",
        },
      }),
    );

    const result = await runBuilderPlannerAgent(input);

    expect(result.contract.kind).toBe("model-backed-hybrid");
    expect(result.buildSpec.schedule).toMatchObject({
      cron: "0 9 * * 1-5",
      description: "Weekdays at 9:00 AM PST",
      timezone: "America/Los_Angeles",
      timezoneLabel: "Pacific Time",
    });
  });

  it("falls back to deterministic planning when no planner model is available", async () => {
    const { input } = createPlannerInput({
      brief: "Create a daily Gmail briefing and send it to Telegram every morning.",
    });
    __testing.setResolvePlannerModelForTest(async () => null);

    const result = await runBuilderPlannerAgent(input);

    expect(result.contract.kind).toBe("hybrid-deterministic");
    expect(result.buildSpec.planner.mode).toBe("fallback-deterministic");
    expect(result.buildSpec.planner.fallbackReason).toContain(
      "No configured high-reasoning planner model",
    );
  });
});
