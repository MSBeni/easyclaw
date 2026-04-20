import { describe, expect, it } from "vitest";
import {
  collectReleasePackageMetadataErrors,
  collectReleaseTagErrors,
  parseReleaseTagVersion,
  parseReleaseVersion,
  utcCalendarDayDistance,
} from "../scripts/openclaw-npm-release-check.ts";

describe("parseReleaseVersion", () => {
  it("parses stable CalVer releases", () => {
    expect(parseReleaseVersion("2026.3.10")).toMatchObject({
      version: "2026.3.10",
      channel: "stable",
      year: 2026,
      month: 3,
      day: 10,
    });
  });

  it("parses beta CalVer releases", () => {
    expect(parseReleaseVersion("2026.3.10-beta.2")).toMatchObject({
      version: "2026.3.10-beta.2",
      channel: "beta",
      year: 2026,
      month: 3,
      day: 10,
      betaNumber: 2,
    });
  });

  it("rejects legacy and malformed release formats", () => {
    expect(parseReleaseVersion("2026.3.10-1")).toBeNull();
    expect(parseReleaseVersion("2026.03.09")).toBeNull();
    expect(parseReleaseVersion("v2026.3.10")).toBeNull();
    expect(parseReleaseVersion("2026.2.30")).toBeNull();
    expect(parseReleaseVersion("2.0.0-beta2")).toBeNull();
  });
});

describe("parseReleaseTagVersion", () => {
  it("accepts fallback correction tags for stable releases", () => {
    expect(parseReleaseTagVersion("2026.3.10-2")).toMatchObject({
      version: "2026.3.10-2",
      packageVersion: "2026.3.10",
      channel: "stable",
      correctionNumber: 2,
    });
  });

  it("rejects beta correction tags and malformed correction tags", () => {
    expect(parseReleaseTagVersion("2026.3.10-beta.1-1")).toBeNull();
    expect(parseReleaseTagVersion("2026.3.10-0")).toBeNull();
  });
});

describe("utcCalendarDayDistance", () => {
  it("compares UTC calendar days rather than wall-clock hours", () => {
    const left = new Date("2026-03-09T23:59:59Z");
    const right = new Date("2026-03-11T00:00:01Z");
    expect(utcCalendarDayDistance(left, right)).toBe(2);
  });
});

describe("collectReleaseTagErrors", () => {
  it("accepts versions within the two-day CalVer window", () => {
    expect(
      collectReleaseTagErrors({
        packageVersion: "2026.3.10",
        releaseTag: "v2026.3.10",
        now: new Date("2026-03-11T12:00:00Z"),
      }),
    ).toEqual([]);
  });

  it("rejects versions outside the two-day CalVer window", () => {
    expect(
      collectReleaseTagErrors({
        packageVersion: "2026.3.10",
        releaseTag: "v2026.3.10",
        now: new Date("2026-03-13T00:00:00Z"),
      }),
    ).toContainEqual(expect.stringContaining("must be within 2 days"));
  });

  it("accepts fallback correction tags for stable package versions", () => {
    expect(
      collectReleaseTagErrors({
        packageVersion: "2026.3.10",
        releaseTag: "v2026.3.10-1",
        now: new Date("2026-03-10T00:00:00Z"),
      }),
    ).toEqual([]);
  });

  it("rejects beta package versions paired with fallback correction tags", () => {
    expect(
      collectReleaseTagErrors({
        packageVersion: "2026.3.10-beta.1",
        releaseTag: "v2026.3.10-1",
        now: new Date("2026-03-10T00:00:00Z"),
      }),
    ).toContainEqual(expect.stringContaining("does not match package.json version"));
  });
});

describe("collectReleasePackageMetadataErrors", () => {
  it("validates the expected npm package metadata", () => {
    expect(
      collectReleasePackageMetadataErrors(
        {
          name: "openclaw",
          description:
            "Compatibility package that re-exports EasyClaw under the legacy OpenClaw npm name",
          license: "MIT",
          repository: { url: "git+https://github.com/MSBeni/easyclaw.git" },
          bin: { openclaw: "./bin/openclaw.js" },
          exports: { "./cli-entry": "./bin/openclaw.js" },
          dependencies: { easyclaw: "2026.3.14" },
        },
        {
          version: "2026.3.14",
          repository: { url: "git+https://github.com/MSBeni/easyclaw.git" },
        },
      ),
    ).toEqual([]);
  });

  it("requires the compatibility package to depend on the matching easyclaw version", () => {
    expect(
      collectReleasePackageMetadataErrors(
        {
          name: "openclaw",
          description:
            "Compatibility package that re-exports EasyClaw under the legacy OpenClaw npm name",
          license: "MIT",
          repository: { url: "git+https://github.com/MSBeni/easyclaw.git" },
          bin: { openclaw: "./bin/openclaw.js" },
          exports: { "./cli-entry": "./bin/openclaw.js" },
          dependencies: { easyclaw: "2026.3.13" },
        },
        {
          version: "2026.3.14",
          repository: { url: "git+https://github.com/MSBeni/easyclaw.git" },
        },
      ),
    ).toContain(
      'package.json dependencies.easyclaw must match root version "2026.3.14"; found "2026.3.13".',
    );
  });
});
