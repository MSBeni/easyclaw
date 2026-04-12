import { describe, expect, it, vi } from "vitest";
import "../styles.css";
import type { OpenClawApp } from "./app.ts";
import type { BuilderPlanResult, BuilderVerifyResult } from "./controllers/builder.ts";
import { mountApp, registerAppMountHooks } from "./test-helpers/app-mount.ts";

registerAppMountHooks();

function nextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function settle(app: OpenClawApp, frames = 2) {
  for (let index = 0; index < frames; index += 1) {
    await Promise.resolve();
    await app.updateComplete;
    await nextFrame();
  }
  await Promise.resolve();
  await app.updateComplete;
}

async function waitForElement<T extends Element>(
  app: OpenClawApp,
  selector: string,
  params?: { frames?: number },
): Promise<T | null> {
  const frames = params?.frames ?? 10;
  for (let index = 0; index < frames; index += 1) {
    const element = app.querySelector<T>(selector);
    if (element) {
      return element;
    }
    await settle(app, 1);
  }
  return app.querySelector<T>(selector);
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function findButtonByText(
  app: OpenClawApp,
  text: string,
  params?: { exact?: boolean },
): HTMLButtonElement | null {
  const expected = normalizeText(text);
  return (
    Array.from(app.querySelectorAll<HTMLButtonElement>("button")).find((button) => {
      const actual = normalizeText(button.textContent);
      return params?.exact ? actual === expected : actual.includes(expected);
    }) ?? null
  );
}

function clickButton(app: OpenClawApp, text: string, params?: { exact?: boolean }) {
  const button = findButtonByText(app, text, params);
  expect(button).not.toBeNull();
  button?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  return button;
}

function changeValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) {
  element.value = value;
  element.dispatchEvent(
    new Event(element instanceof HTMLSelectElement ? "change" : "input", {
      bubbles: true,
      cancelable: true,
      composed: true,
    }),
  );
}

function createBuilderPlanResult(params: { setupComplete: boolean }): BuilderPlanResult {
  const setupActions = params.setupComplete
    ? []
    : [
        {
          id: "tools:web:configure",
          connectorId: "tools:web",
          connectorLabel: "OpenClaw Web Tools",
          title: "Configure Web Tools",
          detail: "Set a web search provider and credentials, then rerun verification.",
          status: "pending" as const,
          kind: "verify" as const,
          source: "verification" as const,
          blocking: true,
          refs: ["tools.web.search"],
          requiredFields: [
            {
              key: "provider",
              label: "Web search provider",
              kind: "provider" as const,
              required: true,
              inputKey: "provider",
              configPath: "tools.web.search.provider",
              inputType: "select" as const,
              options: [
                { value: "brave", label: "Brave" },
                { value: "gemini", label: "Gemini" },
              ],
              help: "Provider used by web_search for latest-news and research requests.",
            },
            {
              key: "apiKey",
              label: "API key",
              kind: "auth" as const,
              required: false,
              inputKey: "apiKey",
              inputType: "secret" as const,
              placeholder: "Paste provider API key",
              help: "Leave blank to keep an existing config or environment credential.",
            },
          ],
          workflowRoles: ["Research Worker"],
          uiSchema: {
            variant: "guided-setup" as const,
            section: "tools.web.search",
            fieldKeys: ["provider", "apiKey"],
          },
          completionSignal: {
            kind: "verification" as const,
            target: "tools:web:search",
            detail: "Pass the web tools readiness check before apply is allowed.",
          },
        },
      ];

  const setupTasks = params.setupComplete
    ? []
    : [
        {
          id: "tools:web:configure",
          connectorId: "tools:web",
          connectorLabel: "OpenClaw Web Tools",
          kind: "configure" as const,
          status: "pending" as const,
          title: "Configure Web Tools",
          detail: "Set a web search provider and credentials.",
          refs: ["tools.web.search"],
        },
      ];

  const verifications = [
    {
      id: "tools:web:search",
      connectorId: "tools:web",
      connectorLabel: "OpenClaw Web Tools",
      probeKind: "tooling",
      probeLabel: "Web tools readiness",
      status: params.setupComplete ? ("passed" as const) : ("blocked" as const),
      detail: params.setupComplete
        ? 'Web search is configured with provider "brave".'
        : "Web search provider is saved, but credentials are still missing.",
      source: "live" as const,
      checkedAt: params.setupComplete ? "2026-04-10T18:05:00.000Z" : "2026-04-10T18:01:00.000Z",
    },
  ];

  const workspaceArtifacts = [
    {
      fileName: "AGENTS.md",
      purpose: "Coordinator operating instructions.",
      status: "generated" as const,
      previewSummary: "Managed instructions for the entry agent before activation.",
    },
    {
      fileName: "MEMORY.md",
      purpose: "Memory strategy for the generated workflow.",
      status: "generated" as const,
      previewSummary: "Captures what the runtime should remember across executions.",
    },
    {
      fileName: "TOOLS.md",
      purpose: "Tool policy defaults for the generated runtime.",
      status: "planned" as const,
      previewSummary: "Will summarize which tool families this workflow can use after apply.",
    },
  ];

  return {
    draft: {
      brief: "Use web research in this workflow.",
      templateId: "research-agent",
      displayName: "Research Agent",
      confidence: "high",
      plannerStatus: "ready",
      reasons: ["Matched a research workflow with web-search requirements."],
      assumptions: ["Use Brave as the initial provider for the guided setup flow."],
      questions: [],
      ready: params.setupComplete,
      buildSpec: {
        version: 1,
        status: "ready",
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
          capabilityContractCount: 4,
          connectorCount: 2,
          templateExemplarCount: 1,
          readyIntegrationCount: params.setupComplete ? 1 : 0,
          unresolvedIntegrationCount: params.setupComplete ? 0 : 1,
        },
        goal: {
          primaryGoal: "research",
          executionMode: "direct",
          confidence: "high",
        },
        template: {
          templateId: "research-agent",
          displayName: "Research Agent",
          confidence: "high",
          reasons: ["Selected for web research and summarization."],
        },
        schedule: {},
        graph: {
          mode: "single-agent",
          entryNodeId: "primary",
          nodes: [
            {
              id: "primary",
              roleId: "primary",
              label: "Research Worker",
              entry: true,
              templateId: "research-agent",
              goal: "Research the topic and produce a concise report.",
              contractIds: ["fetch.web", "summarize"],
              connectorIds: ["tools:web"],
              responsibilities: ["Research", "Summarize"],
            },
          ],
          edges: [],
        },
        integrations: [
          {
            connectorId: "tools:web",
            label: "OpenClaw Web Tools",
            status: params.setupComplete ? "verified" : "configured",
            kind: "tooling",
            sourceKind: "core_tool_section",
            issues: params.setupComplete
              ? []
              : ["Credentials are still missing for the selected provider."],
          },
        ],
        setupActions,
        workspaceArtifacts,
        assumptions: ["Web research uses the guided connector setup path by default."],
        questions: [],
        notes: [],
      },
      requirements: {
        confidence: "high",
        workflow: {
          primaryGoal: "research",
          executionMode: "direct",
          triggerKinds: [],
          sourceKinds: ["web"],
          transformKinds: ["summarize"],
          actionKinds: ["report"],
          deliveryKinds: [],
          requiresApproval: false,
        },
        intentTags: ["research", "web"],
        triggers: [],
        inputs: [{ detail: "Use web search for research inputs." }],
        transforms: [{ detail: "Summarize the findings." }],
        decisions: [],
        actions: [{ detail: "Produce a concise report." }],
        outputs: [{ detail: "Return a final answer to the user." }],
        policies: [],
        constraints: [],
        missingInputs: [],
        setupGaps: params.setupComplete
          ? []
          : [{ code: "web-provider", message: "Web search credentials are still missing." }],
        policyGaps: [],
        unsupportedGaps: [],
        ambiguities: [],
        unsupportedRequests: [],
        unsupportedClassifications: [],
        missingDataFields: [],
      },
      planning: {
        selections: [
          {
            requirementId: "web-fetch",
            requirementLabel: "Web research",
            contractIds: ["fetch.web"],
            connectorId: "tools:web",
            connectorLabel: "OpenClaw Web Tools",
            source: "explicit",
          },
        ],
        alternatives: [],
        variants: [],
        integrations: [
          {
            connectorId: "tools:web",
            instanceId: "tools:web",
            status: params.setupComplete ? "verified" : "configured",
            configRefs: ["tools.web.search"],
            authRefs: params.setupComplete ? [] : ["tools.web.search.apiKey"],
            issues: params.setupComplete
              ? []
              : ["Credentials are still missing for the selected provider."],
            label: "OpenClaw Web Tools",
            kind: "tooling",
            sourceKind: "core_tool_section",
            contracts: ["fetch.web"],
            verification: [
              {
                kind: "tooling",
                label: "Web tools readiness",
                successDescription: "The web-search provider is configured and ready.",
              },
            ],
            docsPath: "/tools/web",
            selectionLabel: "Web tools",
            detailLabel: "Provider and credentials",
            onboarding: false,
            requiresConfig: true,
            requiresAuth: true,
            installRequired: false,
            installStrategy: "none",
          },
        ],
        setupTasks,
        verifications,
        topology: {
          mode: "single-agent",
          reason: "A single research worker is enough for this prompt.",
          roles: [
            {
              id: "primary",
              label: "Research Worker",
              contractIds: ["fetch.web", "summarize"],
              connectorIds: ["tools:web"],
              responsibilities: ["Research", "Summarize"],
            },
          ],
        },
        graph: {
          mode: "single-agent",
          entryNodeId: "primary",
          nodes: [
            {
              id: "primary",
              roleId: "primary",
              label: "Research Worker",
              templateId: "research-agent",
              entry: true,
              agentId: "research-worker",
              name: "Research Worker",
              interactionMode: "direct",
              connectorIds: ["tools:web"],
              responsibilities: ["Research", "Summarize"],
              deliveryTarget: null,
              schedule: null,
            },
          ],
          edges: [],
        },
      },
      extracted: {
        agentId: "research-worker",
        name: "Research Worker",
        ingressChannels: [],
        sourceChannels: ["web"],
        deliveryTarget: null,
        schedule: null,
      },
    },
    workspacePreviews: [
      {
        nodeId: "primary",
        roleId: "primary",
        entry: true,
        files: [
          {
            name: "AGENTS.md",
            content:
              "## Managed Instructions\n\n- Research the topic.\n- Produce a concise report.",
          },
          {
            name: "MEMORY.md",
            content: "## Managed Memory\n\n- Keep important research findings concise.",
          },
        ],
      },
    ],
    plan: {
      status: "ready",
      issues: [],
    },
    graphPlans: [
      {
        nodeId: "primary",
        roleId: "primary",
        entry: true,
        templateId: "research-agent",
        plan: {
          status: "ready",
          issues: [],
        },
      },
    ],
  };
}

function createSwarmBuilderPlanResult(): BuilderPlanResult {
  const result = createBuilderPlanResult({ setupComplete: true });
  return {
    ...result,
    draft: {
      ...result.draft,
      brief: "Read Gmail signals, rank them, and send the best opportunities every morning.",
      templateId: "daily-briefing",
      displayName: "AI Opportunity Swarm",
      assumptions: [
        "Use a coordinator plus specialist workers so the runtime graph stays reviewable before activation.",
      ],
      buildSpec: {
        ...result.draft.buildSpec,
        goal: {
          primaryGoal: "briefing",
          executionMode: "scheduled",
          confidence: "high",
        },
        template: {
          templateId: "daily-briefing",
          displayName: "Daily Briefing",
          confidence: "high",
          reasons: ["Selected for recurring multi-step opportunity briefs."],
        },
        schedule: {
          cron: "0 9 * * *",
          description: "Daily at 9:00 AM Pacific Time",
          timezone: "America/Los_Angeles",
          timezoneLabel: "Pacific Time",
          assumed: false,
        },
        graph: {
          mode: "swarm",
          entryNodeId: "orchestrator",
          nodes: [
            {
              id: "orchestrator",
              roleId: "orchestrator",
              label: "Opportunity Orchestrator",
              entry: true,
              templateId: "daily-briefing",
              goal: "Coordinate signal gathering and publish the final ranked brief.",
              contractIds: ["agent.manage", "delivery.report"],
              connectorIds: ["platform:gmail-hook", "channel:whatsapp", "tools:sessions"],
              responsibilities: ["Coordinate workers", "Assemble the final brief"],
            },
            {
              id: "scout",
              roleId: "scout",
              label: "Signal Scout",
              entry: false,
              templateId: "research-agent",
              goal: "Read source material and capture candidate opportunity signals.",
              contractIds: ["ingest.email", "extract.signals"],
              connectorIds: ["platform:gmail-hook"],
              upstreamNodeIds: ["orchestrator"],
              responsibilities: ["Read Gmail sources", "Capture promising signals"],
            },
            {
              id: "analyst",
              roleId: "analyst",
              label: "Opportunity Analyst",
              entry: false,
              templateId: "research-agent",
              goal: "Rank candidate ideas and explain the strongest opportunities.",
              contractIds: ["transform.summarize", "decision.rank"],
              connectorIds: ["platform:core-model"],
              upstreamNodeIds: ["scout", "orchestrator"],
              responsibilities: ["Rank opportunities", "Explain why each idea matters"],
            },
          ],
          edges: [
            {
              id: "orchestrator->scout",
              fromNodeId: "orchestrator",
              toNodeId: "scout",
              kind: "delegates",
              label: "Scout for signals",
            },
            {
              id: "scout->analyst",
              fromNodeId: "scout",
              toNodeId: "analyst",
              kind: "feeds",
              label: "Feed candidate signals",
            },
            {
              id: "orchestrator->analyst",
              fromNodeId: "orchestrator",
              toNodeId: "analyst",
              kind: "delegates",
              label: "Hand off the final ranking task",
            },
          ],
        },
        integrations: [
          {
            connectorId: "platform:gmail-hook",
            label: "Gmail Hook",
            status: "verified",
            kind: "source",
            sourceKind: "platform",
            issues: [],
          },
          {
            connectorId: "channel:whatsapp",
            label: "WhatsApp",
            status: "verified",
            kind: "delivery",
            sourceKind: "channel",
            issues: [],
          },
          {
            connectorId: "platform:core-model",
            label: "OpenClaw Core Model Runtime",
            status: "verified",
            kind: "runtime",
            sourceKind: "platform",
            issues: [],
          },
        ],
        workspaceArtifacts: [
          {
            fileName: "AGENTS.md",
            purpose: "Managed instructions for each runtime node.",
            status: "generated",
            previewSummary: "Defines the role-specific instructions each node should review.",
          },
          {
            fileName: "MEMORY.md",
            purpose: "Shared memory strategy for the generated runtime graph.",
            status: "generated",
            previewSummary: "Captures which signals and decisions should persist across runs.",
          },
          {
            fileName: "SOUL.md",
            purpose: "Mission framing for specialist worker nodes.",
            status: "generated",
            previewSummary: "Documents how the analyst should approach ranking work.",
          },
          {
            fileName: "HEARTBEAT.md",
            purpose: "Health checks and smoke tests for the runtime graph.",
            status: "planned",
            previewSummary: "Will describe the recurring readiness checks after activation.",
          },
          {
            fileName: "TOOLS.md",
            purpose: "Tool policies for coordinated runtime work.",
            status: "planned",
            previewSummary:
              "Will summarize tool policy defaults once workspace materialization runs.",
          },
        ],
      },
      requirements: {
        ...result.draft.requirements,
        workflow: {
          primaryGoal: "briefing",
          executionMode: "scheduled",
          triggerKinds: ["schedule"],
          sourceKinds: ["gmail"],
          transformKinds: ["rank", "summarize"],
          actionKinds: ["report"],
          deliveryKinds: ["whatsapp"],
          requiresApproval: false,
        },
        intentTags: ["briefing", "gmail", "swarm"],
        triggers: [{ detail: "Run every morning at 9:00 AM Pacific Time." }],
        inputs: [{ detail: "Read Gmail newsletters and prior captured signals." }],
        transforms: [
          { detail: "Identify candidate opportunities." },
          { detail: "Rank the strongest ideas before delivery." },
        ],
        actions: [{ detail: "Send a final ranked brief." }],
        outputs: [{ detail: "Deliver the best opportunities on WhatsApp." }],
      },
      planning: {
        ...result.draft.planning,
        selections: [
          {
            requirementId: "gmail-source",
            requirementLabel: "Read Gmail signals",
            contractIds: ["ingest.email"],
            connectorId: "platform:gmail-hook",
            connectorLabel: "Gmail Hook",
            source: "explicit",
          },
          {
            requirementId: "rank-opportunities",
            requirementLabel: "Rank opportunities",
            contractIds: ["transform.summarize", "decision.rank"],
            connectorId: "platform:core-model",
            connectorLabel: "OpenClaw Core Model Runtime",
            source: "preferred",
          },
          {
            requirementId: "deliver-brief",
            requirementLabel: "Deliver the brief",
            contractIds: ["delivery.report"],
            connectorId: "channel:whatsapp",
            connectorLabel: "WhatsApp",
            source: "explicit",
          },
        ],
        integrations: [
          {
            connectorId: "platform:gmail-hook",
            instanceId: "platform:gmail-hook",
            status: "verified",
            configRefs: ["hooks.gmail"],
            authRefs: [],
            issues: [],
            label: "Gmail Hook",
            kind: "source",
            sourceKind: "platform",
            contracts: ["ingest.email"],
            verification: [
              {
                kind: "live",
                label: "Gmail watch readiness",
                successDescription: "The Gmail watch is authenticated and ready.",
              },
            ],
            docsPath: "/tools/gmail",
            selectionLabel: "Gmail watch",
            detailLabel: "Source ingestion",
            onboarding: false,
            requiresConfig: true,
            requiresAuth: true,
            installRequired: false,
            installStrategy: "none",
          },
          {
            connectorId: "platform:core-model",
            instanceId: "platform:core-model",
            status: "verified",
            configRefs: ["agents.defaults.model"],
            authRefs: [],
            issues: [],
            label: "OpenClaw Core Model Runtime",
            kind: "runtime",
            sourceKind: "platform",
            contracts: ["transform.summarize", "decision.rank"],
            verification: [
              {
                kind: "runtime",
                label: "Model runtime readiness",
                successDescription: "The runtime model is configured and callable.",
              },
            ],
            docsPath: "/models",
            selectionLabel: "Runtime model",
            detailLabel: "Planner execution",
            onboarding: false,
            requiresConfig: true,
            requiresAuth: true,
            installRequired: false,
            installStrategy: "none",
          },
          {
            connectorId: "channel:whatsapp",
            instanceId: "channel:whatsapp",
            status: "verified",
            configRefs: ["channels.whatsapp"],
            authRefs: [],
            issues: [],
            label: "WhatsApp",
            kind: "delivery",
            sourceKind: "channel",
            contracts: ["delivery.report"],
            verification: [
              {
                kind: "delivery",
                label: "WhatsApp delivery readiness",
                successDescription: "WhatsApp is paired and has a destination target.",
              },
            ],
            docsPath: "/channels/whatsapp",
            selectionLabel: "WhatsApp delivery",
            detailLabel: "Channel delivery",
            onboarding: true,
            requiresConfig: true,
            requiresAuth: true,
            installRequired: false,
            installStrategy: "none",
          },
        ],
        setupTasks: [],
        verifications: [
          {
            id: "platform:gmail-hook:ready",
            connectorId: "platform:gmail-hook",
            connectorLabel: "Gmail Hook",
            probeKind: "source",
            probeLabel: "Gmail watch readiness",
            status: "passed",
            detail: "Gmail watch is authenticated and receiving updates.",
            source: "live",
            checkedAt: "2026-04-11T16:05:00.000Z",
          },
          {
            id: "platform:core-model:ready",
            connectorId: "platform:core-model",
            connectorLabel: "OpenClaw Core Model Runtime",
            probeKind: "runtime",
            probeLabel: "Model runtime readiness",
            status: "passed",
            detail: "The configured runtime model is available.",
            source: "live",
            checkedAt: "2026-04-11T16:05:00.000Z",
          },
          {
            id: "channel:whatsapp:ready",
            connectorId: "channel:whatsapp",
            connectorLabel: "WhatsApp",
            probeKind: "delivery",
            probeLabel: "WhatsApp delivery readiness",
            status: "passed",
            detail: "WhatsApp is paired and the delivery target is saved.",
            source: "live",
            checkedAt: "2026-04-11T16:05:00.000Z",
          },
        ],
        topology: {
          mode: "multi-agent",
          reason:
            "Separate source collection from analysis so the final brief stays deterministic and reviewable.",
          roles: [
            {
              id: "orchestrator",
              label: "Opportunity Orchestrator",
              contractIds: ["agent.manage", "delivery.report"],
              connectorIds: ["platform:gmail-hook", "channel:whatsapp", "tools:sessions"],
              responsibilities: ["Coordinate workers", "Assemble the final brief"],
            },
            {
              id: "scout",
              label: "Signal Scout",
              contractIds: ["ingest.email", "extract.signals"],
              connectorIds: ["platform:gmail-hook"],
              responsibilities: ["Read Gmail sources", "Capture promising signals"],
            },
            {
              id: "analyst",
              label: "Opportunity Analyst",
              contractIds: ["transform.summarize", "decision.rank"],
              connectorIds: ["platform:core-model"],
              responsibilities: ["Rank opportunities", "Explain why each idea matters"],
            },
          ],
        },
        graph: {
          mode: "swarm",
          entryNodeId: "orchestrator",
          nodes: [
            {
              id: "orchestrator",
              roleId: "orchestrator",
              label: "Opportunity Orchestrator",
              templateId: "daily-briefing",
              entry: true,
              agentId: "ai-opportunity-swarm",
              name: "AI Opportunity Swarm",
              interactionMode: "scheduled",
              connectorIds: ["platform:gmail-hook", "channel:whatsapp", "tools:sessions"],
              responsibilities: ["Coordinate workers", "Assemble the final brief"],
              deliveryTarget: "WhatsApp default target",
              schedule: "Daily at 9:00 AM Pacific Time",
            },
            {
              id: "scout",
              roleId: "scout",
              label: "Signal Scout",
              templateId: "research-agent",
              entry: false,
              agentId: "ai-opportunity-swarm-scout",
              name: "AI Opportunity Swarm Scout",
              interactionMode: "direct",
              connectorIds: ["platform:gmail-hook"],
              responsibilities: ["Read Gmail sources", "Capture promising signals"],
              deliveryTarget: null,
              schedule: null,
            },
            {
              id: "analyst",
              roleId: "analyst",
              label: "Opportunity Analyst",
              templateId: "research-agent",
              entry: false,
              agentId: "ai-opportunity-swarm-analyst",
              name: "AI Opportunity Swarm Analyst",
              interactionMode: "direct",
              connectorIds: ["platform:core-model"],
              responsibilities: ["Rank opportunities", "Explain why each idea matters"],
              deliveryTarget: null,
              schedule: null,
            },
          ],
          edges: [
            {
              id: "orchestrator->scout",
              fromNodeId: "orchestrator",
              toNodeId: "scout",
              kind: "delegates",
              label: "Scout for signals",
            },
            {
              id: "scout->analyst",
              fromNodeId: "scout",
              toNodeId: "analyst",
              kind: "feeds",
              label: "Feed candidate signals",
            },
            {
              id: "orchestrator->analyst",
              fromNodeId: "orchestrator",
              toNodeId: "analyst",
              kind: "delegates",
              label: "Hand off the final ranking task",
            },
          ],
        },
      },
      extracted: {
        agentId: "ai-opportunity-swarm",
        name: "AI Opportunity Swarm",
        ingressChannels: [],
        sourceChannels: ["gmail"],
        deliveryTarget: "WhatsApp default target",
        schedule: "Daily at 9:00 AM Pacific Time",
      },
    },
    workspacePreviews: [
      {
        nodeId: "orchestrator",
        roleId: "orchestrator",
        entry: true,
        files: [
          {
            name: "AGENTS.md",
            content:
              "## Orchestrator Instructions\n\n- Coordinate scouts and analysts.\n- Deliver the final brief.",
          },
          {
            name: "MEMORY.md",
            content: "## Orchestrator Memory\n\n- Track the strongest opportunity signals.",
          },
        ],
      },
      {
        nodeId: "scout",
        roleId: "scout",
        entry: false,
        files: [
          {
            name: "AGENTS.md",
            content:
              "## Scout Instructions\n\n- Read incoming sources.\n- Capture candidate signals.",
          },
        ],
      },
      {
        nodeId: "analyst",
        roleId: "analyst",
        entry: false,
        files: [
          {
            name: "SOUL.md",
            content: "## Analyst Role\n\n- Rank candidate ideas.\n- Explain why they matter.",
          },
        ],
      },
    ],
    graphPlans: [
      {
        nodeId: "orchestrator",
        roleId: "orchestrator",
        entry: true,
        templateId: "daily-briefing",
        plan: {
          status: "ready",
          issues: [],
        },
      },
      {
        nodeId: "scout",
        roleId: "scout",
        entry: false,
        templateId: "research-agent",
        plan: {
          status: "ready",
          issues: [],
        },
      },
      {
        nodeId: "analyst",
        roleId: "analyst",
        entry: false,
        templateId: "research-agent",
        plan: {
          status: "ready",
          issues: [],
        },
      },
    ],
  };
}

function createUnsafePolicyBuilderPlanResult(): BuilderPlanResult {
  const result = createBuilderPlanResult({ setupComplete: true });
  return {
    ...result,
    draft: {
      ...result.draft,
      brief: "Open links on X and comment on my behalf.",
      plannerStatus: "unsafe_without_policy",
      ready: false,
      reasons: [
        "The workflow shape is valid, but Builder still needs an explicit approval posture before activation.",
      ],
      buildSpec: {
        ...result.draft.buildSpec,
        status: "unsafe_without_policy",
        goal: {
          primaryGoal: "operator",
          executionMode: "direct",
          confidence: "high",
        },
        integrations: [
          {
            connectorId: "tools:ui",
            label: "Browser Tools",
            status: "verified",
            kind: "tooling",
            sourceKind: "core_tool_section",
            issues: [],
          },
          {
            connectorId: "platform:exec-approvals",
            label: "Exec Approvals",
            status: "configured",
            kind: "integration",
            sourceKind: "core_platform",
            issues: [],
          },
        ],
        setupActions: [],
        policy: {
          highestRisk: "operator",
          riskTiers: ["operator"],
          summary:
            "Operator risk. Builder still needs an approval route or posture before activation.",
          riskyContractIds: ["approval.request", "browser.operate"],
          riskyConnectorIds: ["platform:exec-approvals", "tools:ui"],
          approval: {
            required: true,
            routeStatus: "configured",
            posture: "unresolved",
            postureSource: "missing",
            recommendedPosture: "ask_every_time",
            unresolved: true,
            blockers: [
              "Choose an approval posture in Builder or the brief before apply is allowed.",
            ],
          },
        },
      },
      requirements: {
        ...result.draft.requirements,
        workflow: {
          primaryGoal: "operator",
          executionMode: "direct",
          triggerKinds: [],
          sourceKinds: [],
          transformKinds: [],
          actionKinds: ["browser-action"],
          deliveryKinds: [],
          requiresApproval: true,
        },
        intentTags: ["operator", "approval"],
        actions: [{ detail: "Open links and comment on the user's behalf." }],
        policies: [{ detail: "Require an explicit approval posture before risky actions run." }],
        policyGaps: [
          {
            code: "approval-posture",
            message:
              "Choose an approval posture before allowing this workflow to act on your behalf.",
          },
        ],
      },
      planning: {
        ...result.draft.planning,
        selections: [
          {
            requirementId: "browser-action",
            requirementLabel: "Browser actions",
            contractIds: ["browser.operate"],
            connectorId: "tools:ui",
            connectorLabel: "Browser Tools",
            source: "explicit",
          },
          {
            requirementId: "approval-policy",
            requirementLabel: "Approval Gate",
            contractIds: ["approval.request"],
            connectorId: "platform:exec-approvals",
            connectorLabel: "Exec Approvals",
            source: "explicit",
          },
        ],
        integrations: [
          {
            connectorId: "tools:ui",
            instanceId: "tools:ui",
            status: "verified",
            configRefs: ["browser.enabled"],
            authRefs: [],
            issues: [],
            label: "Browser Tools",
            kind: "tooling",
            sourceKind: "core_tool_section",
            contracts: ["browser.operate"],
            verification: [],
            onboarding: false,
            requiresConfig: true,
            requiresAuth: false,
            installRequired: false,
            installStrategy: "none",
          },
          {
            connectorId: "platform:exec-approvals",
            instanceId: "platform:exec-approvals",
            status: "configured",
            configRefs: ["approvals.exec"],
            authRefs: [],
            issues: [],
            label: "Exec Approvals",
            kind: "integration",
            sourceKind: "core_platform",
            contracts: ["approval.request"],
            verification: [],
            onboarding: true,
            requiresConfig: true,
            requiresAuth: false,
            installRequired: false,
            installStrategy: "none",
          },
        ],
        setupTasks: [],
        verifications: [],
      },
    },
  };
}

function createResolvedPolicyBuilderPlanResult(posture: "ask_every_time"): BuilderPlanResult {
  const result = createUnsafePolicyBuilderPlanResult();
  return {
    ...result,
    draft: {
      ...result.draft,
      plannerStatus: "ready",
      ready: true,
      reasons: ["Builder has an explicit approval posture and the policy gate is resolved."],
      buildSpec: {
        ...result.draft.buildSpec,
        status: "ready",
        policy: {
          highestRisk: "operator",
          riskTiers: ["operator"],
          summary:
            "Operator risk. Approval route is configured and Builder selected Ask Every Time.",
          riskyContractIds: ["approval.request", "browser.operate"],
          riskyConnectorIds: ["platform:exec-approvals", "tools:ui"],
          approval: {
            required: true,
            routeStatus: "configured",
            posture,
            postureSource: "builder",
            recommendedPosture: "ask_every_time",
            unresolved: false,
            blockers: [],
          },
        },
      },
      requirements: {
        ...result.draft.requirements,
        policyGaps: [],
      },
    },
    plan: {
      ...result.plan,
      status: "ready",
      issues: [],
    },
  };
}

function createBuilderVerifyResult(params: {
  setupComplete: boolean;
  fingerprint: string;
}): BuilderVerifyResult {
  const plan = createBuilderPlanResult({ setupComplete: params.setupComplete });
  return {
    ...plan,
    verification: {
      fingerprint: params.fingerprint,
      checkedAt: params.setupComplete ? "2026-04-10T18:05:00.000Z" : "2026-04-10T18:01:00.000Z",
      passedCount: params.setupComplete ? 1 : 0,
      failedCount: 0,
      blockedCount: params.setupComplete ? 0 : 1,
      unresolvedCount: 0,
      results: plan.draft.planning.verifications,
    },
  };
}

describe("Builder setup loop", () => {
  it("shows runtime graph and workspace authoring review before apply", async () => {
    const app = mountApp("/builder");
    await settle(app, 3);

    const request = vi.fn(async (method: string) => {
      switch (method) {
        case "agents.builder.plan":
          return createBuilderPlanResult({ setupComplete: false });
        default:
          throw new Error(`Unhandled builder review method: ${method}`);
      }
    });

    app.client = {
      request,
      stop: vi.fn(),
    } as unknown as OpenClawApp["client"];

    const briefInput = await waitForElement<HTMLTextAreaElement>(
      app,
      ".builder-brief-field textarea",
      {
        frames: 12,
      },
    );
    expect(briefInput).not.toBeNull();
    if (!briefInput) {
      return;
    }
    changeValue(briefInput, "Use web research in this workflow.");
    await settle(app);

    clickButton(app, "Build Plan", { exact: true });
    await settle(app, 4);

    const builderText = normalizeText(app.textContent);
    expect(builderText).toContain("Runtime Node Plans");
    expect(builderText).toContain("2 workspace docs ready for review before apply.");
    expect(builderText).toContain("Workspace Authoring Review");
    expect(builderText).toContain("2 reviewable files across 1 runtime node.");
    expect(builderText).toContain("Pre-Apply Checklist");
    expect(builderText).toContain("Workspace authoring review");
    expect(builderText).toContain(
      "2 generated workspace docs ready for review, 0 edited in Builder, 1 still pending generation.",
    );
    expect(builderText).toContain("Planned Workspace Docs");
    expect(builderText).toContain("TOOLS.md");
    expect(builderText).toContain(
      "These docs are already part of the BuildSpec, but their generated review text is not available in Builder yet.",
    );

    const firstDetails = app.querySelector<HTMLDetailsElement>("details.tpl-note");
    expect(firstDetails).not.toBeNull();
    if (!firstDetails) {
      return;
    }
    firstDetails.open = true;
    firstDetails.dispatchEvent(new Event("toggle"));
    await settle(app, 2);

    const expandedText = normalizeText(app.textContent);
    expect(expandedText).toContain("Coordinator operating instructions.");
    expect(expandedText).toContain("Managed instructions for the entry agent before activation.");
    expect(expandedText).toContain(
      "Review summary: Generated preview ready for review with 4 lines.",
    );

    const firstTextarea = firstDetails.querySelector<HTMLTextAreaElement>("textarea");
    expect(firstTextarea).not.toBeNull();
    if (!firstTextarea) {
      return;
    }
    changeValue(firstTextarea, "## Reviewed Instructions\n\n- Focus on web research first.");
    await settle(app, 2);

    const editedText = normalizeText(app.textContent);
    expect(editedText).toContain("edited in Builder");
    expect(editedText).toContain(
      "Review summary: Edited in Builder. 4 generated lines, 3 current lines.",
    );
  });

  it("shows swarm runtime graph and multi-node workspace review before apply", async () => {
    const app = mountApp("/builder");
    await settle(app, 3);

    const request = vi.fn(async (method: string) => {
      switch (method) {
        case "agents.builder.plan":
          return createSwarmBuilderPlanResult();
        default:
          throw new Error(`Unhandled swarm builder method: ${method}`);
      }
    });

    app.client = {
      request,
      stop: vi.fn(),
    } as unknown as OpenClawApp["client"];

    const briefInput = await waitForElement<HTMLTextAreaElement>(
      app,
      ".builder-brief-field textarea",
      {
        frames: 12,
      },
    );
    expect(briefInput).not.toBeNull();
    if (!briefInput) {
      return;
    }
    changeValue(
      briefInput,
      "Read Gmail signals, rank them, and send the best opportunities every morning.",
    );
    await settle(app);

    clickButton(app, "Build Plan", { exact: true });
    await settle(app, 4);

    const builderText = normalizeText(app.textContent);
    expect(builderText).toContain("Runtime Graph");
    expect(builderText).toContain("swarm 3 nodes");
    expect(builderText).toContain("Signal Scout: ai-opportunity-swarm-scout");
    expect(builderText).toContain("Opportunity Analyst: ai-opportunity-swarm-analyst");
    expect(builderText).toContain("orchestrator delegates scout Scout for signals");
    expect(builderText).toContain("scout feeds analyst Feed candidate signals");
    expect(builderText).toContain("Runtime Node Plans");
    expect(builderText).toContain("Entry orchestrator (daily-briefing)");
    expect(builderText).toContain("Worker scout (research-agent)");
    expect(builderText).toContain("Worker analyst (research-agent)");
    expect(builderText).toContain("2 workspace docs ready for review before apply.");
    expect(builderText).toContain("1 workspace doc ready for review before apply.");
    expect(builderText).toContain("Workspace Authoring Review");
    expect(builderText).toContain("4 reviewable files across 3 runtime nodes.");
    expect(builderText).toContain(
      "4 generated workspace docs ready for review, 0 edited in Builder, 2 still pending generation.",
    );
    expect(builderText).toContain("Planned Workspace Docs");
    expect(builderText).toContain("HEARTBEAT.md");
    expect(builderText).toContain("TOOLS.md");

    const workspaceDetails = Array.from(
      app.querySelectorAll<HTMLDetailsElement>("details.tpl-note"),
    );
    expect(workspaceDetails).toHaveLength(4);
    const analystDetails = workspaceDetails.at(-1) ?? null;
    expect(analystDetails).not.toBeNull();
    if (!analystDetails) {
      return;
    }
    analystDetails.open = true;
    analystDetails.dispatchEvent(new Event("toggle"));
    await settle(app, 2);

    const expandedText = normalizeText(app.textContent);
    expect(expandedText).toContain("Mission framing for specialist worker nodes.");
    expect(expandedText).toContain("Documents how the analyst should approach ranking work.");
    expect(expandedText).toContain(
      "Review summary: Generated preview ready for review with 4 lines.",
    );

    const analystTextarea = analystDetails.querySelector<HTMLTextAreaElement>("textarea");
    expect(analystTextarea).not.toBeNull();
    if (!analystTextarea) {
      return;
    }
    changeValue(analystTextarea, "## Analyst Review\n\n- Focus on ranked opportunities.");
    await settle(app, 2);

    const editedText = normalizeText(app.textContent);
    expect(editedText).toContain("1 edited in Builder");
    expect(editedText).toContain(
      "Review summary: Edited in Builder. 4 generated lines, 3 current lines.",
    );
    expect(editedText).toContain(
      "4 generated workspace docs ready for review, 1 edited in Builder, 2 still pending generation.",
    );
  });

  it("shows safety policy review and keeps apply blocked when approval posture is unresolved", async () => {
    const app = mountApp("/builder");
    await settle(app, 3);

    const request = vi.fn(async (method: string) => {
      switch (method) {
        case "agents.builder.plan":
          return createUnsafePolicyBuilderPlanResult();
        default:
          throw new Error(`Unhandled unsafe policy builder method: ${method}`);
      }
    });

    app.client = {
      request,
      stop: vi.fn(),
    } as unknown as OpenClawApp["client"];

    const briefInput = await waitForElement<HTMLTextAreaElement>(
      app,
      ".builder-brief-field textarea",
      {
        frames: 12,
      },
    );
    expect(briefInput).not.toBeNull();
    if (!briefInput) {
      return;
    }
    changeValue(briefInput, "Open links on X and comment on my behalf.");
    await settle(app);

    clickButton(app, "Build Plan", { exact: true });
    await settle(app, 4);

    const builderText = normalizeText(app.textContent);
    expect(builderText).toContain("Safety & Policy");
    expect(builderText).toContain("Highest risk:");
    expect(builderText).toContain("Operator");
    expect(builderText).toContain("Approval route:");
    expect(builderText).toContain("Configured");
    expect(builderText).toContain("Approval posture:");
    expect(builderText).toContain("Unresolved");
    expect(builderText).toContain("Posture source:");
    expect(builderText).toContain("Missing");
    expect(builderText).toContain("Recommended posture:");
    expect(builderText).toContain("Ask Every Time");
    expect(builderText).toContain(
      "Supported postures: Always Auto, Ask Once, Ask Every Time, Draft Only, Never.",
    );
    expect(builderText).toContain(
      "Choose an approval posture in Builder or the brief before apply is allowed.",
    );
    expect(builderText).toContain("Choose in Builder");
    expect(builderText).toContain("Use Ask Every Time");
    expect(builderText).toContain("Safety and action policy");
    expect(builderText).toContain("Resolve the safety policy blockers before apply.");

    const applyButton = findButtonByText(app, "Apply Builder Plan", { exact: true });
    expect(applyButton).not.toBeNull();
    expect(applyButton?.disabled).toBe(true);
  });

  it("lets Builder choose an approval posture intentionally and rebuild", async () => {
    const app = mountApp("/builder");
    await settle(app, 3);

    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      switch (method) {
        case "agents.builder.plan":
          return params?.approvalPosture === "ask_every_time"
            ? createResolvedPolicyBuilderPlanResult("ask_every_time")
            : createUnsafePolicyBuilderPlanResult();
        default:
          throw new Error(`Unhandled builder posture method: ${method}`);
      }
    });

    app.client = {
      request,
      stop: vi.fn(),
    } as unknown as OpenClawApp["client"];

    const briefInput = await waitForElement<HTMLTextAreaElement>(
      app,
      ".builder-brief-field textarea",
      {
        frames: 12,
      },
    );
    expect(briefInput).not.toBeNull();
    if (!briefInput) {
      return;
    }
    changeValue(briefInput, "Open links on X and comment on my behalf.");
    await settle(app);

    clickButton(app, "Build Plan", { exact: true });
    await settle(app, 4);

    clickButton(app, "Use Ask Every Time");
    await settle(app, 4);

    expect(request).toHaveBeenNthCalledWith(2, "agents.builder.plan", {
      brief: "Open links on X and comment on my behalf.",
      approvalPosture: "ask_every_time",
    });

    const rebuiltText = normalizeText(app.textContent);
    expect(rebuiltText).toContain("Approval posture:");
    expect(rebuiltText).toContain("Ask Every Time");
    expect(rebuiltText).toContain("Posture source:");
    expect(rebuiltText).toContain("Builder");
    expect(rebuiltText).toContain(
      "Operator risk. Approval route is configured and Builder selected Ask Every Time.",
    );

    const applyButton = findButtonByText(app, "Apply Builder Plan", { exact: true });
    expect(applyButton).not.toBeNull();
    expect(applyButton?.disabled).toBe(false);
  });

  it("keeps apply blocked until guided web setup completes and auto-reruns verification", async () => {
    const app = mountApp("/builder");
    await settle(app, 3);

    let configuredProvider = "";
    let configuredApiKey = "";
    let verificationRuns = 0;

    const request = vi.fn(async (method: string, params: unknown) => {
      switch (method) {
        case "agents.builder.plan":
          return createBuilderPlanResult({ setupComplete: false });
        case "agents.builder.setup.run": {
          const inputs =
            params && typeof params === "object" && !Array.isArray(params)
              ? ((params as { inputs?: Record<string, string> }).inputs ?? {})
              : {};
          configuredProvider = inputs.provider ?? configuredProvider;
          configuredApiKey = inputs.apiKey ?? configuredApiKey;
          return configuredApiKey.trim()
            ? {
                connectorId: "tools:web",
                actionId: "tools:web:configure",
                status: "configured" as const,
                message: 'Web search is configured with provider "brave".',
                updatedRefs: ["tools.web.search.provider", "tools.web.search.apiKey"],
              }
            : {
                connectorId: "tools:web",
                actionId: "tools:web:configure",
                status: "needs_auth" as const,
                message: "Provider saved, but credentials are still missing.",
                updatedRefs: ["tools.web.search.provider"],
                resume: {
                  actionId: "tools:web:configure",
                  connectorId: "tools:web",
                  label: "Re-check web search setup",
                  detail:
                    "After setting credentials, run setup again so EasyClaw can verify web tools readiness.",
                  inputs: {
                    provider: configuredProvider || "brave",
                  },
                },
              };
        }
        case "config.get":
          return {
            hash: "config-hash",
            valid: true,
            config: {
              tools: {
                web: {
                  search: {
                    provider: configuredProvider || undefined,
                    apiKey: configuredApiKey || undefined,
                  },
                },
              },
            },
            raw: JSON.stringify(
              {
                tools: {
                  web: {
                    search: {
                      provider: configuredProvider || undefined,
                      apiKey: configuredApiKey || undefined,
                    },
                  },
                },
              },
              null,
              2,
            ),
            issues: [],
          };
        case "agents.builder.verify":
          verificationRuns += 1;
          return createBuilderVerifyResult({
            setupComplete: Boolean(configuredApiKey.trim()),
            fingerprint: `verify-${verificationRuns}`,
          });
        default:
          throw new Error(`Unhandled gateway method in browser Builder test: ${method}`);
      }
    });

    app.client = {
      request,
      stop: vi.fn(),
    } as unknown as OpenClawApp["client"];

    const briefInput = await waitForElement<HTMLTextAreaElement>(
      app,
      ".builder-brief-field textarea",
      { frames: 12 },
    );
    expect(briefInput).not.toBeNull();
    if (!briefInput) {
      return;
    }
    changeValue(briefInput, "Use web research in this workflow.");
    await settle(app);

    clickButton(app, "Build Plan", { exact: true });
    await settle(app, 4);

    expect(request).toHaveBeenCalledWith("agents.builder.plan", {
      brief: "Use web research in this workflow.",
    });
    expect(app.textContent).toContain("Configure Web Tools");

    const blockedApplyButton = findButtonByText(app, "Apply Builder Plan", { exact: true });
    expect(blockedApplyButton).not.toBeNull();
    expect(blockedApplyButton?.disabled).toBe(true);
    expect(app.textContent).toContain(
      "Finish the pending setup actions and rerun verification before apply.",
    );

    clickButton(app, "Open web tools setup");
    await settle(app, 3);

    expect(app.tab).toBe("builder");
    expect(window.location.pathname).toBe("/builder");
    expect(app.textContent).toContain("Configure and verify web search");

    const providerSelect = app.querySelector<HTMLSelectElement>(".quick-setup__assist select");
    expect(providerSelect).not.toBeNull();
    if (!providerSelect) {
      return;
    }
    changeValue(providerSelect, "brave");
    await settle(app);

    clickButton(app, "Configure and Verify", { exact: true });
    await settle(app, 4);

    expect(app.builderSetupResult).toEqual(
      expect.objectContaining({
        actionId: "tools:web:configure",
        connectorId: "tools:web",
        status: "needs_auth",
      }),
    );
    expect(app.builderVerifyResult?.verification.fingerprint).toBe("verify-1");
    expect(app.builderVerifyResult?.verification.blockedCount).toBe(1);
    expect(app.textContent).toContain("Provider saved, but credentials are still missing.");
    expect(
      request.mock.calls.filter(([method]) => method === "agents.builder.verify"),
    ).toHaveLength(1);
    expect(findButtonByText(app, "Apply Builder Plan", { exact: true })?.disabled).toBe(true);

    const apiKeyInput = app.querySelector<HTMLInputElement>(
      '.quick-setup__assist input[type="password"]',
    );
    expect(apiKeyInput).not.toBeNull();
    if (!apiKeyInput) {
      return;
    }
    changeValue(apiKeyInput, "brave-key");
    await settle(app);

    clickButton(app, "Configure and Verify", { exact: true });
    await settle(app, 4);

    expect(app.builderSetupResult).toEqual(
      expect.objectContaining({
        actionId: "tools:web:configure",
        connectorId: "tools:web",
        status: "configured",
      }),
    );
    expect(app.builderPlan?.draft.buildSpec.setupActions).toHaveLength(0);
    expect(app.builderVerifyResult?.verification.fingerprint).toBe("verify-2");
    expect(app.builderVerifyResult?.verification.passedCount).toBe(1);
    expect(app.textContent).toContain("All Passed");
    expect(
      request.mock.calls.filter(([method]) => method === "agents.builder.verify"),
    ).toHaveLength(2);

    const unblockedApplyButton = findButtonByText(app, "Apply Builder Plan", { exact: true });
    expect(unblockedApplyButton).not.toBeNull();
    expect(unblockedApplyButton?.disabled).toBe(false);

    clickButton(app, "Apply Builder Plan", { exact: true });
    await settle(app, 2);

    expect(app.querySelector(".confirm-banner")).not.toBeNull();
    expect(app.textContent).toContain("Confirm Apply");
  });
});
