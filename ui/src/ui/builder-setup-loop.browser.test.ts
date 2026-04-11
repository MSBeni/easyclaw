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
        workspaceArtifacts: [],
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
    workspacePreviews: [],
    plan: {
      status: "ready",
      issues: [],
    },
    graphPlans: [],
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
