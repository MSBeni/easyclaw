import { describe, expect, it } from "vitest";
import {
  buildRequirementPlannerResult,
  rebuildRequirementPlannerResult,
} from "../capabilities/planner.js";
import { buildRequirementSet } from "../capabilities/requirements.js";
import type { BuildSpec } from "./build-spec.js";
import { synchronizeBuildSpec } from "./setup-actions.js";

function createBaseBuildSpec(params: { brief: string; status: BuildSpec["status"] }): BuildSpec {
  return {
    version: 1,
    brief: params.brief,
    status: params.status,
    contract: {
      id: "easyclaw.builder",
      version: "1",
      kind: "hybrid-deterministic",
      deterministicValidationRequired: true,
      plannerModelPolicy: "optional",
    },
    planner: {
      mode: "fallback-deterministic",
      attempts: 1,
      repairCount: 0,
    },
    context: {
      capabilityContractCount: 0,
      connectorCount: 0,
      templateExemplarCount: 0,
      readyIntegrationCount: 0,
      unresolvedIntegrationCount: 0,
    },
    goal: {
      primaryGoal: "briefing",
      executionMode: "scheduled",
      confidence: "high",
    },
    template: {
      templateId: "daily-briefing",
      displayName: "Daily Briefing Agent",
      confidence: "high",
      reasons: [],
    },
    schedule: {},
    graph: {
      mode: "single-agent",
      entryNodeId: "primary",
      nodes: [
        {
          id: "primary",
          roleId: "primary",
          label: "Primary Agent",
          entry: true,
          contractIds: [],
          connectorIds: [],
          responsibilities: [],
        },
      ],
      edges: [],
    },
    integrations: [],
    setupActions: [],
    workspaceArtifacts: [],
    assumptions: [],
    questions: [],
    notes: [],
  };
}

describe("synchronizeBuildSpec", () => {
  it("routes failed Slack send verification back to the destination setup action", () => {
    const cfg = {
      channels: {
        slack: {
          botToken: "xoxb-test",
          appToken: "xapp-test",
          defaultTo: "channel:C0AK6RU9FFS",
        },
      },
      agents: {
        defaults: {
          model: "openai/gpt-5.3-codex",
        },
      },
    };
    const requirements = buildRequirementSet({
      brief: "Create a daily AI briefing and send it to my Slack channel every morning.",
      cfg,
    });
    const planning = buildRequirementPlannerResult({
      requirements,
      cfg,
    });

    const synced = synchronizeBuildSpec({
      buildSpec: createBaseBuildSpec({
        brief: requirements.brief,
        status: planning.status,
      }),
      requirements,
      planning: {
        ...planning,
        verifications: planning.verifications.map((verification) =>
          verification.id === "channel:slack:send_test"
            ? {
                ...verification,
                status: "failed",
                detail:
                  "Slack workspace auth is ready, but the bot is not a member of #engineering. Invite the app to that conversation, then rerun verification.",
                source: "live",
              }
            : verification,
        ),
      },
      questions: [],
    });

    expect(
      synced.setupActions.find((action) => action.detail.includes("not a member of #engineering")),
    ).toEqual(
      expect.objectContaining({
        id: "channel:slack:auto-default-target",
        connectorId: "channel:slack",
        kind: "verify",
        source: "verification",
      }),
    );
  });

  it("collapses degraded Slack delivery failures into a single destination action", () => {
    const cfg = {
      channels: {
        slack: {
          botToken: "xoxb-test",
          appToken: "xapp-test",
          defaultTo: "channel:C0AK6RU9FFS",
        },
      },
      agents: {
        defaults: {
          model: "openai/gpt-5.3-codex",
        },
      },
    };
    const requirements = buildRequirementSet({
      brief:
        "Create a research agent that uses web search for latest news and send me a daily report on a Slack channel at 8am PST.",
      cfg,
    });
    const basePlanning = buildRequirementPlannerResult({
      requirements,
      cfg,
    });
    const planning = rebuildRequirementPlannerResult({
      status: basePlanning.status,
      selections: basePlanning.selections,
      alternatives: basePlanning.alternatives,
      variants: basePlanning.variants,
      topology: basePlanning.topology,
      integrations: basePlanning.integrations.map((integration) =>
        integration.connectorId === "channel:slack"
          ? {
              ...integration,
              status: "degraded" as const,
              issues: [
                "Live verification failed for Send test: Slack workspace auth is ready, but the bot is not a member of #engineering. Invite the app to that conversation, then rerun verification.",
              ],
            }
          : integration,
      ),
      verifications: basePlanning.verifications.map((verification) =>
        verification.id === "channel:slack:send_test"
          ? {
              ...verification,
              status: "failed" as const,
              detail:
                "Slack workspace auth is ready, but the bot is not a member of #engineering. Invite the app to that conversation, then rerun verification.",
              source: "live" as const,
            }
          : verification,
      ),
      verificationFingerprint: basePlanning.verificationFingerprint,
    });

    const synced = synchronizeBuildSpec({
      buildSpec: createBaseBuildSpec({
        brief: requirements.brief,
        status: planning.status,
      }),
      requirements,
      planning,
      questions: [],
    });

    const slackActions = synced.setupActions.filter(
      (action) => action.connectorId === "channel:slack",
    );

    expect(slackActions).toHaveLength(1);
    expect(slackActions[0]).toEqual(
      expect.objectContaining({
        id: "channel:slack:auto-default-target",
        connectorId: "channel:slack",
        kind: "verify",
        title: "Verify Slack delivery target",
      }),
    );
  });
});
