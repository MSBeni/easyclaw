import { describe, expect, it } from "vitest";
import {
  makeIsolatedAgentTurnParams,
  setupRunCronIsolatedAgentTurnSuite,
} from "./run.suite-helpers.js";
import {
  loadRunCronIsolatedAgentTurn,
  mockRunCronFallbackPassthrough,
  runEmbeddedPiAgentMock,
  runWithModelFallbackMock,
} from "./run.test-harness.js";

const runCronIsolatedAgentTurn = await loadRunCronIsolatedAgentTurn();

describe("runCronIsolatedAgentTurn — timeout retry", () => {
  setupRunCronIsolatedAgentTurnSuite();

  it("retries once with a higher timeout when the first run returns a timeout-only error payload", async () => {
    runEmbeddedPiAgentMock
      .mockResolvedValueOnce({
        payloads: [
          {
            text:
              "Request timed out before a response was generated. " +
              "Please try again, or increase `agents.defaults.timeoutSeconds` in your config.",
            isError: true,
          },
        ],
        meta: { agentMeta: { usage: { input: 10, output: 20 } } },
      })
      .mockResolvedValueOnce({
        payloads: [{ text: "Daily digest complete." }],
        meta: { agentMeta: { usage: { input: 10, output: 20 } } },
      });

    mockRunCronFallbackPassthrough();
    const result = await runCronIsolatedAgentTurn(makeIsolatedAgentTurnParams());

    expect(result.status).toBe("ok");
    expect(runWithModelFallbackMock).toHaveBeenCalledTimes(2);
    expect(runEmbeddedPiAgentMock).toHaveBeenCalledTimes(2);
    expect(runEmbeddedPiAgentMock.mock.calls[0]?.[0]?.timeoutMs).toBe(60_000);
    expect(runEmbeddedPiAgentMock.mock.calls[1]?.[0]?.timeoutMs).toBe(120_000);
    expect(runEmbeddedPiAgentMock.mock.calls[1]?.[0]?.prompt).toContain(
      "previous attempt timed out",
    );
  });

  it("does not retry for non-timeout error payloads", async () => {
    runEmbeddedPiAgentMock.mockResolvedValueOnce({
      payloads: [{ text: "rate limit exceeded", isError: true }],
      meta: { agentMeta: { usage: { input: 10, output: 20 } } },
    });

    mockRunCronFallbackPassthrough();
    const result = await runCronIsolatedAgentTurn(makeIsolatedAgentTurnParams());

    expect(result.status).toBe("error");
    expect(runWithModelFallbackMock).toHaveBeenCalledTimes(1);
    expect(runEmbeddedPiAgentMock).toHaveBeenCalledTimes(1);
  });
});
