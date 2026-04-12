import { describe, expect, it } from "vitest";
import { resolveSlackBoltRuntime } from "./bolt-interop.js";

class TestApp {}
class TestHTTPReceiver {}

describe("resolveSlackBoltRuntime", () => {
  it("accepts namespace-style exports", () => {
    expect(
      resolveSlackBoltRuntime({
        App: TestApp,
        HTTPReceiver: TestHTTPReceiver,
      }),
    ).toEqual({
      App: TestApp,
      HTTPReceiver: TestHTTPReceiver,
    });
  });

  it("accepts default-wrapped exports", () => {
    expect(
      resolveSlackBoltRuntime({
        default: {
          App: TestApp,
          HTTPReceiver: TestHTTPReceiver,
        },
      }),
    ).toEqual({
      App: TestApp,
      HTTPReceiver: TestHTTPReceiver,
    });
  });

  it("accepts nested default wrappers", () => {
    expect(
      resolveSlackBoltRuntime({
        default: {
          default: {
            App: TestApp,
            HTTPReceiver: TestHTTPReceiver,
          },
        },
      }),
    ).toEqual({
      App: TestApp,
      HTTPReceiver: TestHTTPReceiver,
    });
  });

  it("throws for unsupported module shapes", () => {
    expect(() => resolveSlackBoltRuntime({ default: TestApp })).toThrow(
      "Slack Bolt runtime did not expose App/HTTPReceiver constructors",
    );
  });
});
