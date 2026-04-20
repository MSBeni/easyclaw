import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildOpenClawCapabilityRegistry } from "../capabilities/openclaw.js";
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

  it("summarizes unresolved approval posture as a first-class policy blocker", () => {
    const cfg = {
      approvals: {
        exec: {
          enabled: true,
          targets: [{ channel: "telegram", to: "123456789" }],
        },
      },
    };
    const requirements = buildRequirementSet({
      brief: "Open the links on X and comment on my behalf.",
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
      planning,
      questions: [],
      cfg,
    });

    expect(synced.policy).toMatchObject({
      highestRisk: "operator",
      riskTiers: expect.arrayContaining(["operator"]),
      approval: {
        required: true,
        routeStatus: "configured",
        posture: "unresolved",
        postureSource: "missing",
        recommendedPosture: "ask_every_time",
        unresolved: true,
        blockers: expect.arrayContaining([
          expect.stringContaining("Choose an approval posture in Builder or the brief"),
        ]),
      },
    });
  });

  it("records the explicit approval posture when the brief chooses one", () => {
    const cfg = {
      approvals: {
        exec: {
          enabled: true,
          targets: [{ channel: "telegram", to: "123456789" }],
        },
      },
    };
    const requirements = buildRequirementSet({
      brief: "Open the links on X on my behalf, but ask every time before acting.",
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
      planning,
      questions: [],
      cfg,
    });

    expect(synced.policy).toMatchObject({
      approval: {
        required: true,
        routeStatus: "configured",
        posture: "ask_every_time",
        postureSource: "brief",
        unresolved: false,
        blockers: [],
      },
    });
  });

  it("records a builder-selected approval posture separately from the brief", () => {
    const cfg = {
      approvals: {
        exec: {
          enabled: true,
          targets: [{ channel: "telegram", to: "123456789" }],
        },
      },
    };
    const requirements = buildRequirementSet({
      brief: "Open the links on X and comment on my behalf.",
      approvalPosture: "ask_every_time",
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
      planning,
      questions: [],
      cfg,
    });

    expect(synced.policy).toMatchObject({
      summary: expect.stringContaining("Builder selected Ask Every Time"),
      approval: {
        required: true,
        routeStatus: "configured",
        posture: "ask_every_time",
        postureSource: "builder",
        unresolved: false,
        blockers: [],
      },
    });
  });

  it("treats scheduled briefing plans as communication risk instead of operator risk", () => {
    const cfg = {
      hooks: {
        token: "hook-token",
        gmail: {
          account: "user@example.com",
          topic: "projects/test/topics/watch",
          pushToken: "push-token",
        },
      },
      channels: {
        whatsapp: {
          enabled: true,
        },
      },
    };
    const requirements = buildRequirementSet({
      brief:
        "Read my Gmail AI newsletters, give me business ideas every day at 9am PST, and send it to WhatsApp.",
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
      planning,
      questions: [],
      cfg,
    });

    expect(synced.policy).toMatchObject({
      highestRisk: "communicative",
      riskTiers: expect.arrayContaining(["communicative"]),
      approval: {
        required: false,
        routeStatus: "not_required",
        posture: "always_auto",
        recommendedPosture: "always_auto",
      },
    });
    expect(synced.policy?.summary).toContain("Communication risk");
  });

  it("merges external setup descriptors and workspace artifacts from catalog metadata", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-phase13-setup-"));
    const catalogPath = path.join(dir, "catalog.json");
    fs.writeFileSync(
      catalogPath,
      JSON.stringify({
        entries: [
          {
            name: "@openclaw/voice-delivery",
            openclaw: {
              channel: {
                id: "voice-delivery",
                label: "Voice Delivery",
                selectionLabel: "Voice Delivery",
                docsPath: "/channels/voice-delivery",
                blurb: "Voice call delivery for outbound updates.",
              },
              install: {
                npmSpec: "@openclaw/voice-delivery",
              },
              builder: {
                channelConnector: {
                  contracts: ["delivery.chat", "message.send"],
                  plannerHints: {
                    aliases: ["phone call"],
                  },
                  verification: {
                    supported: true,
                    probes: [
                      {
                        kind: "status",
                        label: "Voice route probe",
                        successDescription: "The voice route is ready for outbound delivery.",
                      },
                    ],
                  },
                  setupActions: [
                    {
                      actionId: "channel:voice-delivery:verify",
                      title: "Verify voice route",
                      detail: "Confirm the voice destination and caller profile before activation.",
                      requiredFields: [
                        {
                          key: "destination",
                          label: "Phone destination",
                          kind: "destination",
                          required: true,
                          configPath: "channels.voice-delivery.destination",
                        },
                        {
                          key: "sender",
                          label: "Caller profile",
                          kind: "sender",
                          required: true,
                          configPath: "channels.voice-delivery.sender",
                        },
                      ],
                      uiSchema: {
                        variant: "guided-setup",
                        section: "channels.voice-delivery",
                        fieldKeys: ["destination", "sender"],
                      },
                      guidedLauncher: {
                        available: true,
                        target: "builder-quick-setup",
                        connectorId: "channel:voice-delivery",
                      },
                      completionSignal: {
                        kind: "verification",
                        target: "channel:voice-delivery:status",
                        detail: "Pass the voice route probe for Voice Delivery.",
                      },
                    },
                  ],
                  workspaceArtifacts: [
                    {
                      fileName: "VOICE_DELIVERY.md",
                      purpose: "Voice delivery runbook",
                      status: "suggested",
                      previewSummary:
                        "Documents the reviewed voice routing assumptions before activation.",
                      managedSection:
                        "## Voice Delivery Runbook\n\n- Confirm the caller profile.\n- Confirm the destination route.",
                    },
                  ],
                },
              },
            },
          },
        ],
      }),
    );

    const cfg = {
      channels: {
        "voice-delivery": {
          destination: "+15551234567",
          sender: "Daily Brief Bot",
        },
      },
      agents: {
        defaults: {
          model: "openai/gpt-4o",
        },
      },
    };
    const registry = buildOpenClawCapabilityRegistry({ catalogPaths: [catalogPath] });
    const requirements = buildRequirementSet({
      brief: "Create an assistant that can send short updates to phone call.",
      cfg,
      registry,
    });
    const basePlanning = buildRequirementPlannerResult({
      requirements,
      cfg,
      registry,
    });
    const planning = rebuildRequirementPlannerResult({
      status: basePlanning.status,
      selections: basePlanning.selections,
      alternatives: basePlanning.alternatives,
      variants: basePlanning.variants,
      topology: basePlanning.topology,
      integrations: basePlanning.integrations,
      verifications: basePlanning.verifications.map((verification) =>
        verification.connectorId === "channel:voice-delivery"
          ? {
              ...verification,
              status: "failed",
              detail: "Voice destination is configured, but the caller profile still needs review.",
              source: "live",
            }
          : verification,
      ),
      verificationFingerprint: basePlanning.verificationFingerprint,
      registry,
    });

    const synced = synchronizeBuildSpec({
      buildSpec: createBaseBuildSpec({
        brief: requirements.brief,
        status: planning.status,
      }),
      requirements,
      planning,
      questions: [],
      cfg,
    });

    expect(
      synced.setupActions.find((action) => action.id === "channel:voice-delivery:verify"),
    ).toEqual(
      expect.objectContaining({
        title: "Verify voice route",
        detail: expect.stringContaining("caller profile"),
        guidedLauncher: expect.objectContaining({
          available: true,
          target: "builder-quick-setup",
        }),
        completionSignal: {
          kind: "verification",
          target: "channel:voice-delivery:status",
          detail: "Pass the voice route probe for Voice Delivery.",
        },
      }),
    );
    expect(
      synced.setupActions
        .find((action) => action.id === "channel:voice-delivery:verify")
        ?.requiredFields?.map((field) => field.key),
    ).toEqual(expect.arrayContaining(["destination", "sender"]));
    expect(synced.workspaceArtifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fileName: "VOICE_DELIVERY.md",
          purpose: "Voice delivery runbook",
          previewSummary: expect.stringContaining("voice routing assumptions"),
        }),
      ]),
    );
  });
});
