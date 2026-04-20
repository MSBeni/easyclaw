import { describe, expect, it } from "vitest";
import { buildBuilderSetupUrl, resolveBuilderQuestionSetupConnectorId } from "./builder.ts";

describe("buildBuilderSetupUrl", () => {
  it("builds a setup URL for guided web setup", () => {
    const url = buildBuilderSetupUrl("http://127.0.0.1:18789/builder?session=main", "", {
      actionId: "tools:web:configure",
      connectorId: "tools:web",
      connectorLabel: "OpenClaw Web Tools",
      connectorKind: "tooling",
      connectorSourceKind: "core_tool_section",
      connectorOnboarding: false,
      connectorRequiresConfig: true,
      connectorRequiresAuth: true,
      connectorInstallRequired: false,
      connectorInstallStrategy: "none",
      title: "Open web tools setup",
      detail: "web search provider is not configured",
      refs: ["web"],
      targetTab: "onboarding",
    });

    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/setup");
    expect(parsed.searchParams.get("session")).toBe(null);
    expect(parsed.searchParams.get("builderSetupConnectorId")).toBe("tools:web");
    expect(parsed.searchParams.get("builderSetupActionId")).toBe("tools:web:configure");
    expect(parsed.searchParams.get("builderSetupTargetTab")).toBe("onboarding");
    expect(parsed.searchParams.get("builderSetupTitle")).toBe("Open web tools setup");
    expect(parsed.searchParams.getAll("builderSetupRef")).toEqual(["web"]);
  });

  it("routes WhatsApp delivery questions to guided channel setup", () => {
    expect(
      resolveBuilderQuestionSetupConnectorId({
        id: "delivery-target",
        prompt: "Which whatsapp destination should receive the result?",
        required: true,
      }),
    ).toBe("channel:whatsapp");
  });
});
