import { describe, expect, it } from "vitest";
import { ONBOARDING_STEPS } from "../ui/src/ui/views/onboarding.ts";

describe("onboarding channel setup definitions", () => {
  it("maps Signal setup to channels.signal.account", () => {
    const signal = ONBOARDING_STEPS.find((step) => step.id === "signal");
    expect(signal).toBeTruthy();
    const signalField = signal?.fields.find((field) => field.label === "Signal Account");
    expect(signalField?.path).toEqual(["channels", "signal", "account"]);
    expect(signal?.configCheck).toEqual(["channels", "signal", "account"]);
  });

  it("keeps WhatsApp pairing inside onboarding without a Channels-tab detour", () => {
    const whatsapp = ONBOARDING_STEPS.find((step) => step.id === "whatsapp");
    expect(whatsapp).toBeTruthy();
    expect(whatsapp?.infoOnly).toBeUndefined();
    const guideText = whatsapp?.guide.map((item) => item.instruction).join(" ");
    expect(guideText).toContain("Show QR");
    expect(guideText).not.toContain("Open the Channels tab");
  });
});
