import type { App, HTTPReceiver } from "@slack/bolt";

type SlackBoltExports = {
  App?: unknown;
  HTTPReceiver?: unknown;
  default?: unknown;
};

type SlackBoltRuntime = {
  App: typeof App;
  HTTPReceiver: typeof HTTPReceiver;
};

function asSlackBoltRuntime(candidate: unknown): SlackBoltRuntime | null {
  if (!candidate || (typeof candidate !== "object" && typeof candidate !== "function")) {
    return null;
  }
  const maybe = candidate as SlackBoltExports;
  if (typeof maybe.App !== "function" || typeof maybe.HTTPReceiver !== "function") {
    return null;
  }
  return {
    App: maybe.App as typeof App,
    HTTPReceiver: maybe.HTTPReceiver as typeof HTTPReceiver,
  };
}

export function resolveSlackBoltRuntime(moduleExports: unknown): SlackBoltRuntime {
  const candidates = [
    moduleExports,
    (moduleExports as SlackBoltExports | undefined)?.default,
    ((moduleExports as SlackBoltExports | undefined)?.default as SlackBoltExports | undefined)
      ?.default,
  ];
  for (const candidate of candidates) {
    const runtime = asSlackBoltRuntime(candidate);
    if (runtime) {
      return runtime;
    }
  }
  throw new TypeError("Slack Bolt runtime did not expose App/HTTPReceiver constructors");
}
