import { describe, expect, it } from "vitest";
import { normalizeTimeZoneInput, resolveUserTimezone } from "./date-time.js";

describe("date-time timezone normalization", () => {
  it("maps common timezone abbreviations to concrete IANA zones", () => {
    expect(normalizeTimeZoneInput("PST")).toEqual({
      timeZone: "America/Los_Angeles",
      label: "Pacific Time",
    });
    expect(normalizeTimeZoneInput("EDT")).toEqual({
      timeZone: "America/New_York",
      label: "Eastern Time",
    });
  });

  it("preserves valid IANA zones and adds friendly labels when known", () => {
    expect(normalizeTimeZoneInput("America/Los_Angeles")).toEqual({
      timeZone: "America/Los_Angeles",
      label: "Pacific Time",
    });
    expect(normalizeTimeZoneInput("Europe/Berlin")).toEqual({
      timeZone: "Europe/Berlin",
    });
  });

  it("uses normalized timezone inputs for user timezone resolution", () => {
    expect(resolveUserTimezone("PDT")).toBe("America/Los_Angeles");
    expect(resolveUserTimezone("UTC")).toBe("UTC");
  });
});
