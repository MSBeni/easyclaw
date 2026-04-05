import { describe, expect, it } from "vitest";
import { ONBOARDING_STEPS } from "../ui/src/ui/views/onboarding.ts";

function getStep(id: string) {
  const step = ONBOARDING_STEPS.find((entry) => entry.id === id);
  expect(step, `missing onboarding step ${id}`).toBeDefined();
  return step!;
}

describe("onboarding setup steps", () => {
  it("stores AI provider fields under models.providers instead of auth", () => {
    const aiStepsWithFields = ONBOARDING_STEPS.filter(
      (step) => step.category === "ai" && !step.infoOnly && step.fields.length > 0,
    );

    for (const step of aiStepsWithFields) {
      for (const field of step.fields) {
        expect(field.path.slice(0, 2), `${step.id}:${field.label}`).toEqual([
          "models",
          "providers",
        ]);
      }
    }
  });

  it("keeps important provider mappings aligned with models.providers", () => {
    expect(getStep("openai").fields[0]?.path).toEqual(["models", "providers", "openai", "apiKey"]);
    expect(getStep("google-gemini").fields[0]?.path).toEqual([
      "models",
      "providers",
      "google",
      "apiKey",
    ]);
    expect(getStep("cloudflare-ai-gateway").fields[0]?.path).toEqual([
      "models",
      "providers",
      "cloudflare-ai-gateway",
      "baseUrl",
    ]);
    expect(getStep("vercel-ai-gateway").fields[0]?.path).toEqual([
      "models",
      "providers",
      "vercel-ai-gateway",
      "baseUrl",
    ]);
    expect(getStep("volcengine").fields[0]?.path).toEqual([
      "models",
      "providers",
      "volcengine",
      "apiKey",
    ]);
    expect(getStep("modelstudio").fields[0]?.path).toEqual([
      "models",
      "providers",
      "modelstudio",
      "apiKey",
    ]);
    expect(getStep("kilocode").fields[0]?.path).toEqual([
      "models",
      "providers",
      "kilocode",
      "baseUrl",
    ]);
  });

  it("keeps OAuth-backed AI providers as info-only auth-order checks", () => {
    expect(getStep("openai-codex")).toEqual(
      expect.objectContaining({
        infoOnly: true,
        configCheck: ["auth", "order", "openai-codex", 0],
      }),
    );
    expect(getStep("github-copilot")).toEqual(
      expect.objectContaining({
        infoOnly: true,
        configCheck: ["auth", "order", "github-copilot", 0],
      }),
    );
    expect(getStep("chutes")).toEqual(
      expect.objectContaining({
        infoOnly: true,
        configCheck: ["auth", "order", "chutes", 0],
      }),
    );
  });

  it("keeps qianfan to a single API key field", () => {
    const qianfan = getStep("qianfan");
    expect(qianfan.fields).toHaveLength(1);
    expect(qianfan.fields[0]).toEqual(
      expect.objectContaining({
        label: "API Key",
        path: ["models", "providers", "qianfan", "apiKey"],
      }),
    );
  });

  it("includes Telegram default target guidance for scheduled delivery", () => {
    const telegram = getStep("telegram");
    const targetField = telegram.fields.find((field) => field.label.includes("Default Target"));
    expect(targetField).toEqual(
      expect.objectContaining({
        path: ["channels", "telegram", "defaultTo"],
      }),
    );
    expect(
      telegram.guide.some((entry) =>
        entry.instruction.toLowerCase().includes("auto-detect target"),
      ),
    ).toBe(true);
  });
});
