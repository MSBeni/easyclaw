import { describe, expect, it } from "vitest";
import {
  connectorIdToConfigRef,
  hasPendingSetupTask,
  setupActionLabel,
} from "../ui/src/ui/views/builder.ts";

describe("connectorIdToConfigRef", () => {
  it("routes chat connectors to their dedicated channels setup", () => {
    expect(connectorIdToConfigRef("channel:telegram")).toBe("channels.telegram");
    expect(connectorIdToConfigRef("channel:slack")).toBe("channels.slack");
  });

  it("routes common builder blockers to focused setup sections", () => {
    expect(connectorIdToConfigRef("platform:gmail-hook")).toBe("hooks");
    expect(connectorIdToConfigRef("platform:core-model")).toBe("models");
    expect(connectorIdToConfigRef("platform:exec-approvals")).toBe("approvals");
  });
});

describe("setupActionLabel", () => {
  it("builds explicit labels for common guided setup actions", () => {
    expect(setupActionLabel({ connectorId: "channel:telegram" })).toBe("Open Telegram setup");
    expect(setupActionLabel({ connectorId: "platform:gmail-hook" })).toBe("Open Gmail hook setup");
    expect(
      setupActionLabel({ connectorId: "platform:exec-approvals", refs: ["approvals.exec"] }),
    ).toBe("Open approvals setup");
    expect(setupActionLabel({ connectorId: "platform:core-model" })).toBe("Open model setup");
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
