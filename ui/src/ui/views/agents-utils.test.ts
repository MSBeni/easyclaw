import { describe, expect, it } from "vitest";
import {
  agentLogoUrl,
  resolveBuilderDefaultModelLabel,
  resolveBuilderModelOverrideOptions,
  resolveConfiguredCronModelSuggestions,
  resolveModelOptions,
  resolveAgentAvatarUrl,
  resolveEffectiveModelFallbacks,
  sortLocaleStrings,
} from "./agents-utils.ts";
import { shouldOpenBuilderQuickSetup } from "./builder.ts";

describe("resolveEffectiveModelFallbacks", () => {
  it("inherits defaults when no entry fallbacks are configured", () => {
    const entryModel = undefined;
    const defaultModel = {
      primary: "openai/gpt-5-nano",
      fallbacks: ["google/gemini-2.0-flash"],
    };

    expect(resolveEffectiveModelFallbacks(entryModel, defaultModel)).toEqual([
      "google/gemini-2.0-flash",
    ]);
  });

  it("prefers entry fallbacks over defaults", () => {
    const entryModel = {
      primary: "openai/gpt-5-mini",
      fallbacks: ["openai/gpt-5-nano"],
    };
    const defaultModel = {
      primary: "openai/gpt-5",
      fallbacks: ["google/gemini-2.0-flash"],
    };

    expect(resolveEffectiveModelFallbacks(entryModel, defaultModel)).toEqual(["openai/gpt-5-nano"]);
  });

  it("keeps explicit empty entry fallback lists", () => {
    const entryModel = {
      primary: "openai/gpt-5-mini",
      fallbacks: [],
    };
    const defaultModel = {
      primary: "openai/gpt-5",
      fallbacks: ["google/gemini-2.0-flash"],
    };

    expect(resolveEffectiveModelFallbacks(entryModel, defaultModel)).toEqual([]);
  });
});

describe("resolveConfiguredCronModelSuggestions", () => {
  it("collects defaults primary/fallbacks, alias map keys, and per-agent model entries", () => {
    const result = resolveConfiguredCronModelSuggestions({
      agents: {
        defaults: {
          model: {
            primary: "openai/gpt-5.2",
            fallbacks: ["google/gemini-2.5-pro", "openai/gpt-5.2-mini"],
          },
          models: {
            "anthropic/claude-sonnet-4-5": { alias: "smart" },
            "openai/gpt-5.2": { alias: "main" },
          },
        },
        list: {
          writer: {
            model: { primary: "xai/grok-4", fallbacks: ["openai/gpt-5.2-mini"] },
          },
          planner: {
            model: "google/gemini-2.5-flash",
          },
        },
      },
    });

    expect(result).toEqual([
      "anthropic/claude-sonnet-4-5",
      "google/gemini-2.5-flash",
      "google/gemini-2.5-pro",
      "openai/gpt-5.2",
      "openai/gpt-5.2-mini",
      "xai/grok-4",
    ]);
  });

  it("returns empty array for invalid or missing config shape", () => {
    expect(resolveConfiguredCronModelSuggestions(null)).toEqual([]);
    expect(resolveConfiguredCronModelSuggestions({})).toEqual([]);
    expect(resolveConfiguredCronModelSuggestions({ agents: { defaults: { model: "" } } })).toEqual(
      [],
    );
  });
});

describe("buildModelOptions", () => {
  it("includes gateway-discovered model suggestions even when config does not define models", async () => {
    const values = resolveModelOptions(null, ["openai/gpt-5.4", "anthropic/claude-opus-4-6"]).map(
      (option) => option.value,
    );
    expect(values).toEqual(["anthropic/claude-opus-4-6", "openai/gpt-5.4"]);
  });
});

describe("resolveBuilderModelOverrideOptions", () => {
  it("marks configured and unconfigured models separately for builder model override", () => {
    const options = resolveBuilderModelOverrideOptions(
      {
        agents: {
          defaults: {
            model: "openai/gpt-5.4",
          },
        },
      },
      undefined,
      ["openai/gpt-5.4", "xai/grok-4"],
      [
        {
          id: "gpt-5.4",
          name: "GPT-5.4",
          provider: "openai",
          configured: true,
        },
        {
          id: "grok-4",
          name: "Grok 4",
          provider: "xai",
          configured: false,
        },
      ],
    );

    const openai = options.find((option) => option.value === "openai/gpt-5.4");
    const grok = options.find((option) => option.value === "xai/grok-4");
    expect(openai?.configured).toBe(true);
    expect(grok?.configured).toBe(false);
    expect((openai?.label ?? "").toLowerCase()).toContain("openai");
    expect((grok?.label ?? "").toLowerCase()).toContain("xai");
  });

  it("trusts gateway readiness over config presence when catalog data is available", () => {
    const options = resolveBuilderModelOverrideOptions(
      {
        agents: {
          defaults: {
            model: "google/gemini-2.5-pro",
          },
        },
      },
      undefined,
      [],
      [
        {
          id: "gemini-2.5-pro",
          name: "Gemini 2.5 Pro",
          provider: "google",
          configured: false,
        },
      ],
    );

    expect(options).toContainEqual(
      expect.objectContaining({
        value: "google/gemini-2.5-pro",
        configured: false,
      }),
    );
  });

  it("keeps the current override visible even when it is not in catalog", () => {
    const options = resolveBuilderModelOverrideOptions(null, "openai/gpt-5.4-pro", [], []);
    expect(options[0]).toMatchObject({
      value: "openai/gpt-5.4-pro",
      label: "Current (openai/gpt-5.4-pro)",
    });
  });

  it("falls back to config-defined readiness when the model catalog has not loaded yet", () => {
    const options = resolveBuilderModelOverrideOptions(
      {
        agents: {
          defaults: {
            model: "google/gemini-2.5-pro",
          },
        },
      },
      undefined,
      [],
      [],
    );

    expect(options).toContainEqual(
      expect.objectContaining({
        value: "google/gemini-2.5-pro",
        configured: true,
      }),
    );
  });

  it("treats a current override as configured when the provider has saved auth config", () => {
    const options = resolveBuilderModelOverrideOptions(
      {
        models: {
          providers: {
            google: {
              apiKey: "***redacted***",
            },
          },
        },
      },
      "google/gemini-2.5-pro",
      [],
      [],
    );

    expect(options).toContainEqual(
      expect.objectContaining({
        value: "google/gemini-2.5-pro",
        configured: true,
      }),
    );
  });
});

describe("resolveBuilderDefaultModelLabel", () => {
  it("shows the configured default model when one is set", () => {
    expect(
      resolveBuilderDefaultModelLabel({
        agents: {
          defaults: {
            model: "openai/gpt-4o",
          },
        },
      }),
    ).toBe("gpt-4o · openai");
  });
});

describe("shouldOpenBuilderQuickSetup", () => {
  it("routes guided Builder connectors to focused setup", () => {
    expect(shouldOpenBuilderQuickSetup("tools:web")).toBe(true);
    expect(shouldOpenBuilderQuickSetup("platform:gmail-hook")).toBe(true);
    expect(shouldOpenBuilderQuickSetup("platform:exec-approvals")).toBe(true);
    expect(shouldOpenBuilderQuickSetup("channel:telegram")).toBe(true);
    expect(shouldOpenBuilderQuickSetup("channel:whatsapp")).toBe(true);
  });

  it("keeps non-guided connectors on config tabs", () => {
    expect(shouldOpenBuilderQuickSetup("platform:observability")).toBe(false);
    expect(shouldOpenBuilderQuickSetup(null)).toBe(false);
  });
});

describe("sortLocaleStrings", () => {
  it("sorts values using localeCompare without relying on Array.prototype.toSorted", () => {
    expect(sortLocaleStrings(["z", "b", "a"])).toEqual(["a", "b", "z"]);
  });

  it("accepts any iterable input, including sets", () => {
    expect(sortLocaleStrings(new Set(["beta", "alpha"]))).toEqual(["alpha", "beta"]);
  });
});

describe("agentLogoUrl", () => {
  it("keeps base-mounted control UI logo paths absolute to the mount", () => {
    expect(agentLogoUrl("/ui")).toBe("/ui/favicon.svg");
    expect(agentLogoUrl("/apps/openclaw/")).toBe("/apps/openclaw/favicon.svg");
  });

  it("uses a route-relative fallback before basePath bootstrap finishes", () => {
    expect(agentLogoUrl("")).toBe("favicon.svg");
  });
});

describe("resolveAgentAvatarUrl", () => {
  it("prefers a runtime avatar URL over non-URL identity avatars", () => {
    expect(
      resolveAgentAvatarUrl(
        { identity: { avatar: "A", avatarUrl: "/avatar/main" } },
        {
          agentId: "main",
          avatar: "A",
          name: "Main",
        },
      ),
    ).toBe("/avatar/main");
  });

  it("returns null for initials or emoji avatar values without a URL", () => {
    expect(resolveAgentAvatarUrl({ identity: { avatar: "A" } })).toBeNull();
    expect(resolveAgentAvatarUrl({ identity: { avatar: "🦞" } })).toBeNull();
  });
});
