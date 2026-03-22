import { describe, expect, it } from "vitest";
import {
  connectorIdToConfigRef,
  hasPendingSetupTask,
  setupActionLabel,
} from "../ui/src/ui/views/builder.ts";

describe("connectorIdToConfigRef", () => {
  it("routes built-in and plugin chat connectors to their dedicated channels setup", () => {
    expect(connectorIdToConfigRef("channel:telegram")).toBe("channels.telegram");
    expect(connectorIdToConfigRef("channel:slack")).toBe("channels.slack");
    expect(connectorIdToConfigRef("channel:matrix")).toBe("channels.matrix");
  });

  it("routes platform connectors to focused setup sections", () => {
    expect(connectorIdToConfigRef("platform:core-model")).toBe("models");
    expect(connectorIdToConfigRef("platform:exec-approvals")).toBe("approvals.exec");
    expect(connectorIdToConfigRef("platform:gmail-hook")).toBe("hooks.gmail");
    expect(connectorIdToConfigRef("platform:observability")).toBe("logs");
    expect(connectorIdToConfigRef("platform:webhook-runtime")).toBe("hooks");
  });

  it("routes tool sections to explicit setup surfaces", () => {
    expect(connectorIdToConfigRef("tools:agents")).toBe("agents");
    expect(connectorIdToConfigRef("tools:automation")).toBe("cron");
    expect(connectorIdToConfigRef("tools:fs")).toBe("tools");
    expect(connectorIdToConfigRef("tools:media")).toBe("media");
    expect(connectorIdToConfigRef("tools:memory")).toBe("memory");
    expect(connectorIdToConfigRef("tools:messaging")).toBe("messages");
    expect(connectorIdToConfigRef("tools:nodes")).toBe("nodes");
    expect(connectorIdToConfigRef("tools:runtime")).toBe("tools");
    expect(connectorIdToConfigRef("tools:sessions")).toBe("session");
    expect(connectorIdToConfigRef("tools:ui")).toBe("browser");
    expect(connectorIdToConfigRef("tools:web")).toBe("web");
  });
});

describe("setupActionLabel", () => {
  it("builds explicit labels for chat connectors", () => {
    expect(setupActionLabel({ connectorId: "channel:telegram", connectorLabel: "Telegram" })).toBe(
      "Open Telegram setup",
    );
    expect(setupActionLabel({ connectorId: "channel:matrix", connectorLabel: "Matrix" })).toBe(
      "Open Matrix setup",
    );
  });

  it("builds explicit labels for platform connectors", () => {
    expect(setupActionLabel({ connectorId: "platform:gmail-hook" })).toBe("Open Gmail hook setup");
    expect(
      setupActionLabel({ connectorId: "platform:exec-approvals", refs: ["approvals.exec"] }),
    ).toBe("Open approvals setup");
    expect(setupActionLabel({ connectorId: "platform:core-model" })).toBe("Open model setup");
    expect(setupActionLabel({ connectorId: "platform:webhook-runtime" })).toBe(
      "Open webhook runtime setup",
    );
    expect(setupActionLabel({ connectorId: "platform:observability" })).toBe(
      "Open logs and debug setup",
    );
  });

  it("builds explicit labels for tool connectors", () => {
    expect(setupActionLabel({ connectorId: "tools:agents" })).toBe("Open agent runtime setup");
    expect(setupActionLabel({ connectorId: "tools:automation" })).toBe("Open automation setup");
    expect(setupActionLabel({ connectorId: "tools:fs" })).toBe("Open file access setup");
    expect(setupActionLabel({ connectorId: "tools:media" })).toBe("Open media setup");
    expect(setupActionLabel({ connectorId: "tools:memory" })).toBe("Open memory setup");
    expect(setupActionLabel({ connectorId: "tools:messaging" })).toBe("Open messaging setup");
    expect(setupActionLabel({ connectorId: "tools:nodes" })).toBe("Open nodes setup");
    expect(setupActionLabel({ connectorId: "tools:runtime" })).toBe("Open runtime tools setup");
    expect(setupActionLabel({ connectorId: "tools:sessions" })).toBe(
      "Open session and subagent setup",
    );
    expect(setupActionLabel({ connectorId: "tools:ui" })).toBe("Open browser and canvas setup");
    expect(setupActionLabel({ connectorId: "tools:web" })).toBe("Open web tools setup");
  });
});

describe("hasPendingSetupTask", () => {
  it("returns true only when a connector still has pending work", () => {
    expect(
      hasPendingSetupTask(
        [
          { connectorId: "tools:memory", status: "completed" },
          { connectorId: "channel:telegram", status: "pending" },
        ],
        "channel:telegram",
      ),
    ).toBe(true);

    expect(
      hasPendingSetupTask([{ connectorId: "tools:memory", status: "completed" }], "tools:memory"),
    ).toBe(false);
  });
});
