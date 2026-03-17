import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../protocol/index.js";

const mocks = vi.hoisted(() => ({
  listAgentBlueprintCatalog: vi.fn(),
  getAgentBlueprintTemplate: vi.fn(),
  listAgentBlueprintTemplateVariables: vi.fn(),
  loadAgentBlueprint: vi.fn(),
  resolveAgentBlueprintVariables: vi.fn(),
  compileAgentBlueprintPlan: vi.fn(),
  applyAgentBlueprint: vi.fn(),
  loadConfig: vi.fn(() => ({ agents: { default: "main" } })),
}));

vi.mock("../../agents/blueprints/compiler.js", () => ({
  compileAgentBlueprintPlan: mocks.compileAgentBlueprintPlan,
}));

vi.mock("../../agents/blueprints/files.js", () => ({
  loadAgentBlueprint: mocks.loadAgentBlueprint,
}));

vi.mock("../../agents/blueprints/materialize.js", () => ({
  applyAgentBlueprint: mocks.applyAgentBlueprint,
}));

vi.mock("../../agents/blueprints/registry.js", () => ({
  getAgentBlueprintTemplate: mocks.getAgentBlueprintTemplate,
  listAgentBlueprintCatalog: mocks.listAgentBlueprintCatalog,
}));

vi.mock("../../agents/blueprints/variables.js", () => ({
  listAgentBlueprintTemplateVariables: mocks.listAgentBlueprintTemplateVariables,
  resolveAgentBlueprintVariables: mocks.resolveAgentBlueprintVariables,
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: mocks.loadConfig,
}));

const { templatesHandlers } = await import("./templates.js");

type RespondCall = [boolean, unknown?, { code: number; message: string }?];

function createInvokeParams(
  method: keyof typeof templatesHandlers,
  params: Record<string, unknown>,
) {
  const respond = vi.fn();
  return {
    respond,
    invoke: async () =>
      await templatesHandlers[method]({
        params,
        respond: respond as never,
        context: {} as never,
        client: null,
        req: { type: "req", id: "req-1", method },
        isWebchatConnect: () => false,
      }),
  };
}

describe("templates gateway handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the enriched template catalog", async () => {
    const bundle = { manifest: { templateId: "daily-briefing" } };
    mocks.listAgentBlueprintCatalog.mockReturnValue([
      {
        templateId: "daily-briefing",
        displayName: "Daily Briefing Agent",
        summary: "Start the day with a digest.",
        tags: ["starter"],
        tier: "starter",
      },
    ]);
    mocks.getAgentBlueprintTemplate.mockReturnValue(bundle);
    mocks.listAgentBlueprintTemplateVariables.mockReturnValue(["owner_target"]);

    const { respond, invoke } = createInvokeParams("agents.templates.catalog", { tier: "starter" });
    await invoke();

    expect(mocks.listAgentBlueprintCatalog).toHaveBeenCalledWith({ tier: "starter" });
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual({
      catalog: [
        {
          templateId: "daily-briefing",
          displayName: "Daily Briefing Agent",
          summary: "Start the day with a digest.",
          tags: ["starter"],
          tier: "starter",
          bundle,
          variables: ["owner_target"],
        },
      ],
    });
  });

  it("rejects plans without an input", async () => {
    const { respond, invoke } = createInvokeParams("agents.templates.plan", {});
    await invoke();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(false);
    expect(call?.[2]?.code).toBe(ErrorCodes.INVALID_REQUEST);
    expect(call?.[2]?.message).toContain("requires an `input` param");
  });

  it("compiles a resolved plan from a template id and variables", async () => {
    const loaded = {
      kind: "template",
      source: "daily-briefing",
      format: "builtin",
      bundle: { manifest: { templateId: "daily-briefing" } },
    };
    const resolved = {
      bundle: { manifest: { templateId: "daily-briefing" }, delivery: { target: "@me" } },
      unresolved: [],
      resolved: ["owner_target"],
    };
    const compiledPlan = { status: "ready", agent: { agentId: "daily-briefing" } };
    mocks.loadAgentBlueprint.mockResolvedValue(loaded);
    mocks.resolveAgentBlueprintVariables.mockReturnValue(resolved);
    mocks.compileAgentBlueprintPlan.mockResolvedValue(compiledPlan);

    const { respond, invoke } = createInvokeParams("agents.templates.plan", {
      input: "daily-briefing",
      variables: {
        owner_target: "@me",
        ignored: 42,
      },
    });
    await invoke();

    expect(mocks.loadAgentBlueprint).toHaveBeenCalledWith("daily-briefing");
    expect(mocks.resolveAgentBlueprintVariables).toHaveBeenCalledWith({
      bundle: loaded.bundle,
      variables: { owner_target: "@me" },
    });
    expect(mocks.compileAgentBlueprintPlan).toHaveBeenCalledWith({
      bundle: resolved.bundle,
      cfg: { agents: { default: "main" } },
      source: { kind: "template", value: "daily-briefing", format: "builtin" },
    });
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual({
      plan: compiledPlan,
      unresolved: [],
      resolved: ["owner_target"],
    });
  });

  it("applies a template with resolved variables", async () => {
    mocks.loadAgentBlueprint.mockResolvedValue({
      kind: "template",
      source: "support-responder",
      format: "builtin",
      bundle: { manifest: { templateId: "support-responder" } },
    });
    mocks.applyAgentBlueprint.mockResolvedValue({
      status: "applied",
      agent: { agentId: "support-responder", name: "Support Responder" },
    });

    const { respond, invoke } = createInvokeParams("agents.templates.apply", {
      input: "support-responder",
      variables: {
        support_channel: "#help",
      },
    });
    await invoke();

    expect(mocks.applyAgentBlueprint).toHaveBeenCalledWith({
      loaded: expect.objectContaining({ source: "support-responder" }),
      variables: { support_channel: "#help" },
    });
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toEqual({
      status: "applied",
      agent: { agentId: "support-responder", name: "Support Responder" },
    });
  });
});
