import { describe, expect, it } from "vitest";
import { buildOpenClawCapabilityRegistry } from "./openclaw.js";
import {
  applyRequirementQuestions,
  buildRequirementSet,
  type RequirementQuestion,
} from "./requirements.js";
import type { ConnectorDefinition } from "./schema.js";

const EXTERNAL_ZALO_CONNECTOR: ConnectorDefinition = {
  id: "channel:zalo",
  label: "Zalo",
  kind: "plugin",
  summary: "External Zalo chat connector.",
  contracts: ["ingress.chat", "delivery.chat", "message.send"],
  riskClasses: ["communicative"],
  source: {
    kind: "external",
    id: "zalo",
  },
  install: {
    required: true,
    strategy: "external",
  },
  setup: {
    onboarding: true,
    requiresConfig: true,
    requiresAuth: true,
  },
  verification: {
    supported: true,
    probes: [],
  },
  metadata: {
    aliases: ["zalo"],
    detailLabel: "Zalo Bot",
    selectionLabel: "Zalo",
  },
};

describe("capability requirements", () => {
  it("extracts scheduled digest requirements and reports setup gaps", () => {
    const requirements = buildRequirementSet({
      brief:
        "Create a bot that summarizes my daily emails and posts them to Slack #ops every morning at 9am.",
      cfg: {},
    });

    expect(requirements.intentTags).toEqual(
      expect.arrayContaining(["email", "scheduled", "summary"]),
    );
    expect(requirements.requestedContractIds).toEqual(
      expect.arrayContaining([
        "ingest.email",
        "message.send",
        "schedule.trigger",
        "transform.summarize",
      ]),
    );
    expect(requirements.setupGaps.map((gap) => gap.code)).toEqual(
      expect.arrayContaining(["gmail-hook", "channel:slack"]),
    );
    expect(requirements.confidence).toBe("high");
    expect(requirements.ambiguities).toEqual([]);
    expect(requirements.missingDataFields).toEqual([]);
    expect(requirements.workflow.primaryGoal).toBe("briefing");
    expect(requirements.workflow.executionMode).toBe("scheduled");
    expect(requirements.plannerStatus).toBe("needs_setup");
  });

  it("marks risky on-behalf actions as unsafe without approval routing", () => {
    const requirements = buildRequirementSet({
      brief:
        "Open the links on X, follow the account, and leave a good comment there on my behalf.",
      cfg: {},
    });

    expect(requirements.actions.map((entry) => entry.id)).toContain("browser-action");
    expect(requirements.policies.map((entry) => entry.id)).toContain("approval-policy");
    expect(requirements.policyGaps.map((gap) => gap.code)).toContain("approval-route");
    expect(requirements.ambiguities).toContain(
      "Risky on-behalf actions were requested without an explicit approval mode.",
    );
    expect(requirements.missingDataFields).toContain("approval-mode");
    expect(requirements.confidence).toBe("medium");
    expect(requirements.workflow.primaryGoal).toBe("operator");
    expect(requirements.workflow.requiresApproval).toBe(true);
    expect(requirements.plannerStatus).toBe("unsafe_without_policy");
  });

  it("keeps a supported schedule-and-summary request ready when setup is already present", () => {
    const requirements = buildRequirementSet({
      brief: "Create a daily Telegram briefing from my Gmail every morning at 9am.",
      cfg: {
        hooks: {
          token: "hook-token",
          gmail: {
            account: "user@example.com",
            topic: "projects/test/topics/watch",
            pushToken: "push-token",
          },
        },
        channels: {
          telegram: {
            botToken: "123:abc",
          },
        },
      },
    });

    expect(requirements.setupGaps).toEqual([]);
    expect(requirements.policyGaps).toEqual([]);
    expect(requirements.confidence).toBe("high");
    expect(requirements.ambiguities).toEqual([]);
    expect(requirements.missingDataFields).toEqual([]);
    expect(requirements.workflow.primaryGoal).toBe("briefing");
    expect(requirements.workflow.executionMode).toBe("scheduled");
    expect(requirements.plannerStatus).toBe("ready");
  });

  it("folds required follow-up questions into the planner status", () => {
    const requirements = buildRequirementSet({
      brief: "I want a customer support responder for billing questions.",
      cfg: {},
    });
    const questions: RequirementQuestion[] = [
      {
        id: "binding-channel",
        prompt: "Which channel should this support responder watch?",
        required: true,
      },
    ];

    const withQuestions = applyRequirementQuestions(requirements, questions);

    expect(withQuestions.missingInputs.map((gap) => gap.code)).toContain(
      "question:binding-channel",
    );
    expect(withQuestions.plannerStatus).toBe("needs_input");
  });

  it("detects external chat connectors from the capability registry", () => {
    const registry = buildOpenClawCapabilityRegistry({
      includeCatalog: false,
      extraConnectors: [EXTERNAL_ZALO_CONNECTOR],
    });
    const requirements = buildRequirementSet({
      brief: "Create a daily summary bot that sends the result to Zalo.",
      cfg: {},
      registry,
    });

    expect(
      requirements.outputs.find((entry) => entry.id === "message-output")?.connectorIds,
    ).toContain("channel:zalo");
    expect(requirements.setupGaps.map((gap) => gap.code)).toContain("channel:zalo");
  });

  it("surfaces ambiguous and missing requirement data explicitly", () => {
    const requirements = buildRequirementSet({
      brief: "Create a weekly digest agent.",
      cfg: {},
    });

    expect(requirements.ambiguities).toEqual(
      expect.arrayContaining([
        "A recurring schedule was requested without an exact time.",
        "A summary was requested without a clearly stated source of material.",
        "The workflow implies delivery, but no destination channel was named.",
      ]),
    );
    expect(requirements.missingDataFields).toEqual(
      expect.arrayContaining(["delivery-destination", "schedule-time", "source-material"]),
    );
    expect(requirements.confidence).toBe("low");
    expect(requirements.workflow.primaryGoal).toBe("briefing");
  });

  it("reports unsupported outbound email delivery requests explicitly", () => {
    const requirements = buildRequirementSet({
      brief: "Create a daily summary and email me the result.",
      cfg: {},
    });

    expect(requirements.unsupportedGaps.map((gap) => gap.code)).toContain("email-delivery");
    expect(requirements.unsupportedRequests).toContain(
      "Email delivery is not modeled as a supported outbound connector yet.",
    );
    expect(requirements.unsupportedClassifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "email-delivery",
          kind: "delivery",
          label: "Unsupported Delivery",
        }),
      ]),
    );
    expect(requirements.confidence).toBe("low");
    expect(requirements.plannerStatus).toBe("unsupported");
  });

  it("extracts webhook, file, memory, and delegation requirements", () => {
    const requirements = buildRequirementSet({
      brief:
        "Create a webhook-driven agent that reads PDFs from my workspace, checks memory for prior context, and spawns a subagent to summarize them.",
      cfg: {
        hooks: {
          token: "hook-token",
        },
      },
    });

    expect(requirements.triggers.map((entry) => entry.id)).toContain("webhook-ingress");
    expect(requirements.inputs.map((entry) => entry.id)).toEqual(
      expect.arrayContaining(["file-source", "memory-source"]),
    );
    expect(requirements.actions.map((entry) => entry.id)).toContain("session-spawn");
    expect(requirements.workflow.executionMode).toBe("webhook");
    expect(requirements.workflow.sourceKinds).toEqual(
      expect.arrayContaining(["file-source", "memory-source"]),
    );
  });
});
