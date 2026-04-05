import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withEnvAsync } from "../test-utils/env.js";
import {
  discoverDownloadedGogCredentials,
  ensureDependency,
  ensureGcloudAuth,
  ensureGogAuth,
  ensureTailscaleEndpoint,
  extractTailscaleFunnelEnableUrl,
  getActiveGcloudAccount,
  getGogCommandEnv,
  getGogAuthStatus,
  resetGmailSetupUtilsCachesForTest,
  resolvePythonExecutablePath,
  validatePublicPushEndpoint,
} from "./gmail-setup-utils.js";

const itUnix = process.platform === "win32" ? it.skip : it;
const runCommandWithTimeoutMock = vi.fn();
const hasBinaryMock = vi.hoisted(() => vi.fn());

vi.mock("../process/exec.js", () => ({
  runCommandWithTimeout: (...args: unknown[]) => runCommandWithTimeoutMock(...args),
}));

vi.mock("../agents/skills.js", () => ({
  hasBinary: (...args: unknown[]) => hasBinaryMock(...args),
}));

beforeEach(() => {
  runCommandWithTimeoutMock.mockReset();
  hasBinaryMock.mockReset();
  hasBinaryMock.mockImplementation((bin: string) => bin === "brew");
  resetGmailSetupUtilsCachesForTest();
});

async function withTempGogState<T>(callback: (stateDir: string) => Promise<T>): Promise<T> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-gog-state-"));
  try {
    return await withEnvAsync(
      {
        HOME: tmp,
        OPENCLAW_STATE_DIR: path.join(tmp, ".openclaw"),
      },
      async () => await callback(path.join(tmp, ".openclaw")),
    );
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

describe("resolvePythonExecutablePath", () => {
  itUnix(
    "resolves a working python path and caches the result",
    async () => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-python-"));
      try {
        const realPython = path.join(tmp, "python-real");
        await fs.writeFile(realPython, "#!/bin/sh\nexit 0\n", "utf-8");
        await fs.chmod(realPython, 0o755);

        const shimDir = path.join(tmp, "shims");
        await fs.mkdir(shimDir, { recursive: true });
        const shim = path.join(shimDir, "python3");
        await fs.writeFile(shim, "#!/bin/sh\nexit 0\n", "utf-8");
        await fs.chmod(shim, 0o755);

        await withEnvAsync({ PATH: `${shimDir}${path.delimiter}/usr/bin` }, async () => {
          runCommandWithTimeoutMock.mockResolvedValue({
            stdout: `${realPython}\n`,
            stderr: "",
            code: 0,
            signal: null,
            killed: false,
          });

          const resolved = await resolvePythonExecutablePath();
          expect(resolved).toBe(realPython);

          await withEnvAsync({ PATH: "/bin" }, async () => {
            const cached = await resolvePythonExecutablePath();
            expect(cached).toBe(realPython);
          });
          expect(runCommandWithTimeoutMock).toHaveBeenCalledTimes(1);
        });
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    },
    60_000,
  );
});

describe("ensureGcloudAuth", () => {
  it("reports no active gcloud account when the config is unset", async () => {
    await withEnvAsync({ CLOUDSDK_PYTHON: "/bin/sh" }, async () => {
      runCommandWithTimeoutMock.mockResolvedValueOnce({
        stdout: "(unset)\n",
        stderr: "",
        code: 0,
        signal: null,
        killed: false,
      });

      await expect(getActiveGcloudAccount()).resolves.toBeNull();
    });
  });

  it("fails clearly in non-interactive mode when gcloud login is missing", async () => {
    await withEnvAsync({ CLOUDSDK_PYTHON: "/bin/sh" }, async () => {
      runCommandWithTimeoutMock.mockResolvedValueOnce({
        stdout: "(unset)\n",
        stderr: "",
        code: 0,
        signal: null,
        killed: false,
      });

      await expect(ensureGcloudAuth(false)).rejects.toThrow(
        "gcloud login required. Run `gcloud auth login` and retry.",
      );
    });
  });

  itUnix(
    "ignores an invalid CLOUDSDK_PYTHON override when a working python is available",
    async () => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-gcloud-python-"));
      try {
        const realPython = path.join(tmp, "python-real");
        await fs.writeFile(realPython, "#!/bin/sh\nexit 0\n", "utf-8");
        await fs.chmod(realPython, 0o755);

        const shimDir = path.join(tmp, "shims");
        await fs.mkdir(shimDir, { recursive: true });
        const shim = path.join(shimDir, "python3");
        await fs.writeFile(shim, "#!/bin/sh\nexit 0\n", "utf-8");
        await fs.chmod(shim, 0o755);

        await withEnvAsync(
          {
            PATH: `${shimDir}${path.delimiter}/usr/bin`,
            CLOUDSDK_PYTHON: "/missing/python3",
          },
          async () => {
            runCommandWithTimeoutMock
              .mockResolvedValueOnce({
                stdout: `${realPython}\n`,
                stderr: "",
                code: 0,
                signal: null,
                killed: false,
              })
              .mockResolvedValueOnce({
                stdout: "user@example.com\n",
                stderr: "",
                code: 0,
                signal: null,
                killed: false,
              });

            await ensureGcloudAuth();

            expect(runCommandWithTimeoutMock).toHaveBeenNthCalledWith(
              2,
              ["gcloud", "config", "get-value", "account", "--quiet"],
              expect.objectContaining({
                env: expect.objectContaining({
                  CLOUDSDK_PYTHON: realPython,
                }),
              }),
            );
          },
        );
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    },
  );
});

describe("ensureGogAuth", () => {
  it("reports missing gog credentials from auth status", async () => {
    await withTempGogState(async () => {
      runCommandWithTimeoutMock.mockResolvedValueOnce({
        stdout: JSON.stringify({
          account: {
            credentials_exists: false,
            email: "",
          },
        }),
        stderr: "",
        code: 0,
        signal: null,
        killed: false,
      });

      await expect(getGogAuthStatus()).resolves.toEqual({
        credentialsExists: false,
        email: null,
      });
      const authStatusCall = runCommandWithTimeoutMock.mock.calls.at(-1);
      expect(authStatusCall?.[0]).toEqual([
        "gog",
        "auth",
        "status",
        "--json",
        "--no-input",
        "--client",
        "openclaw-gmail-hook",
      ]);
      expect(authStatusCall?.[1]).toEqual(
        expect.objectContaining({
          env: expect.objectContaining({
            GOG_KEYRING_BACKEND: "file",
            GOG_KEYRING_PASSWORD: expect.any(String),
          }),
        }),
      );
    });
  });

  itUnix("persists a reusable file-backed gog keyring password", async () => {
    await withTempGogState(async (stateDir) => {
      const firstEnv = await getGogCommandEnv();
      const secondEnv = await getGogCommandEnv();

      expect(firstEnv.GOG_KEYRING_BACKEND).toBe("file");
      expect(secondEnv.GOG_KEYRING_BACKEND).toBe("file");
      expect(firstEnv.GOG_KEYRING_PASSWORD).toEqual(secondEnv.GOG_KEYRING_PASSWORD);

      const passwordPath = path.join(stateDir, "credentials", "gog-keyring-password");
      expect(existsSync(passwordPath)).toBe(true);
      const storedPassword = await fs.readFile(passwordPath, "utf8");
      expect(storedPassword.trim()).toBe(firstEnv.GOG_KEYRING_PASSWORD);
    });
  });

  it("fails clearly in non-interactive mode when gog credentials are missing", async () => {
    await withTempGogState(async () => {
      runCommandWithTimeoutMock.mockResolvedValueOnce({
        stdout: JSON.stringify({
          account: {
            credentials_exists: false,
            email: "",
          },
        }),
        stderr: "",
        code: 0,
        signal: null,
        killed: false,
      });

      await expect(ensureGogAuth("automation@example.com", false)).rejects.toThrow(
        "gog OAuth client credentials missing. Import them with `gog auth credentials set --client openclaw-gmail-hook <credentials.json>` and retry.",
      );
    });
  });

  it("fails clearly in non-interactive mode when gog login is still required", async () => {
    await withTempGogState(async () => {
      runCommandWithTimeoutMock.mockResolvedValueOnce({
        stdout: JSON.stringify({
          account: {
            credentials_exists: true,
            email: "",
          },
        }),
        stderr: "",
        code: 0,
        signal: null,
        killed: false,
      });

      await expect(ensureGogAuth("automation@example.com", false)).rejects.toThrow(
        "gog login required. Run `gog login automation@example.com --client openclaw-gmail-hook --services gmail --gmail-scope full --force-consent` and retry.",
      );
    });
  });
});

describe("discoverDownloadedGogCredentials", () => {
  itUnix("finds the newest matching Desktop OAuth client JSON in Downloads", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-gog-downloads-"));
    try {
      const downloadsDir = path.join(tmp, "Downloads");
      await fs.mkdir(downloadsDir, { recursive: true });
      const olderPath = path.join(downloadsDir, "client_secret_old.json");
      const newerPath = path.join(downloadsDir, "client_secret_new.json");
      await fs.writeFile(
        olderPath,
        JSON.stringify({
          installed: {
            client_id: "old.apps.googleusercontent.com",
            client_secret: "old-secret",
            redirect_uris: ["http://localhost"],
            project_id: "project-123",
          },
        }),
        "utf8",
      );
      await fs.writeFile(
        newerPath,
        JSON.stringify({
          installed: {
            client_id: "new.apps.googleusercontent.com",
            client_secret: "new-secret",
            redirect_uris: ["http://localhost"],
            project_id: "project-123",
          },
        }),
        "utf8",
      );
      const now = Date.now();
      await fs.utimes(olderPath, now / 1000 - 20, now / 1000 - 20);
      await fs.utimes(newerPath, now / 1000, now / 1000);

      await withEnvAsync({ HOME: tmp }, async () => {
        const discovered = await discoverDownloadedGogCredentials("project-123");
        expect(discovered).toEqual(
          expect.objectContaining({
            filename: "client_secret_new.json",
            projectId: "project-123",
          }),
        );
      });
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  itUnix("ignores non-desktop or wrong-project OAuth JSON files", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-gog-downloads-filter-"));
    try {
      const downloadsDir = path.join(tmp, "Downloads");
      await fs.mkdir(downloadsDir, { recursive: true });
      await fs.writeFile(
        path.join(downloadsDir, "client_secret_web.json"),
        JSON.stringify({
          web: {
            client_id: "web.apps.googleusercontent.com",
            client_secret: "web-secret",
            redirect_uris: ["https://example.com/oauth/callback"],
          },
        }),
        "utf8",
      );
      await fs.writeFile(
        path.join(downloadsDir, "client_secret_other.json"),
        JSON.stringify({
          installed: {
            client_id: "other.apps.googleusercontent.com",
            client_secret: "other-secret",
            redirect_uris: ["http://localhost"],
            project_id: "project-other",
          },
        }),
        "utf8",
      );

      await withEnvAsync({ HOME: tmp }, async () => {
        await expect(discoverDownloadedGogCredentials("project-123")).resolves.toBeNull();
      });
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("ensureDependency", () => {
  itUnix("adds the Homebrew prefix bin to PATH so gog becomes visible after install", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-gog-brew-"));
    try {
      const prefixDir = path.join(tmp, "brew-prefix");
      const binDir = path.join(prefixDir, "bin");
      await fs.mkdir(binDir, { recursive: true });
      const gogPath = path.join(binDir, "gog");
      await fs.writeFile(gogPath, "#!/bin/sh\nexit 0\n", "utf-8");
      await fs.chmod(gogPath, 0o755);

      hasBinaryMock.mockImplementation((bin: string) => {
        if (bin === "brew") {
          return true;
        }
        const pathEnv = process.env.PATH ?? "";
        return pathEnv
          .split(path.delimiter)
          .filter(Boolean)
          .some((dir) => existsSync(path.join(dir, bin)));
      });

      await withEnvAsync({ PATH: "/usr/bin:/bin" }, async () => {
        runCommandWithTimeoutMock
          .mockResolvedValueOnce({
            stdout: `${prefixDir}\n`,
            stderr: "",
            code: 0,
            signal: null,
            killed: false,
          })
          .mockResolvedValueOnce({
            stdout: "",
            stderr: "",
            code: 0,
            signal: null,
            killed: false,
          })
          .mockResolvedValueOnce({
            stdout: `${prefixDir}\n`,
            stderr: "",
            code: 0,
            signal: null,
            killed: false,
          });

        await ensureDependency("gog", ["gogcli"]);

        expect((process.env.PATH ?? "").split(path.delimiter)).toContain(binDir);
      });
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("ensureTailscaleEndpoint", () => {
  it("includes stdout and exit code when tailscale serve fails", async () => {
    runCommandWithTimeoutMock
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ Self: { DNSName: "host.tailnet.ts.net." } }),
        stderr: "",
        code: 0,
        signal: null,
        killed: false,
      })
      .mockResolvedValueOnce({
        stdout: "tailscale output",
        stderr: "Warning: client version mismatch",
        code: 1,
        signal: null,
        killed: false,
      });

    let message = "";
    try {
      await ensureTailscaleEndpoint({
        mode: "serve",
        path: "/gmail-pubsub",
        port: 8788,
      });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    expect(message).toContain("code=1");
    expect(message).toContain("stderr: Warning: client version mismatch");
    expect(message).toContain("stdout: tailscale output");
  });

  it("includes JSON parse failure details with stdout", async () => {
    runCommandWithTimeoutMock.mockResolvedValueOnce({
      stdout: "not-json",
      stderr: "",
      code: 0,
      signal: null,
      killed: false,
    });

    let message = "";
    try {
      await ensureTailscaleEndpoint({
        mode: "funnel",
        path: "/gmail-pubsub",
        port: 8788,
      });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    expect(message).toContain("returned invalid JSON");
    expect(message).toContain("stdout: not-json");
    expect(message).toContain("code=0");
  });

  it("returns a clear Funnel enable handoff when the tailnet blocks Funnel", async () => {
    runCommandWithTimeoutMock
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ Self: { DNSName: "host.tailnet.ts.net." } }),
        stderr: "",
        code: 0,
        signal: null,
        killed: false,
      })
      .mockResolvedValueOnce({
        stdout:
          "Funnel is not enabled on your tailnet. To enable, visit: https://login.tailscale.com/f/funnel?node=node-123",
        stderr: "",
        code: null,
        signal: "SIGKILL",
        killed: true,
      });

    await expect(
      ensureTailscaleEndpoint({
        mode: "funnel",
        path: "/gmail-pubsub",
        port: 8788,
      }),
    ).rejects.toThrow(
      "tailscale funnel enable required. Enable it at https://login.tailscale.com/f/funnel?node=node-123 and retry.",
    );
  });
});

describe("Public Push Endpoint validation", () => {
  it("rejects a bare IP address", () => {
    expect(validatePublicPushEndpoint("100.76.180.116")).toEqual({
      ok: false,
      error:
        "Public Push Endpoint must be a full public HTTPS URL, not just a host or IP address. Example: https://your-host.example/gmail-pubsub?token=...",
    });
  });

  it("rejects a private Tailscale-style IP URL", () => {
    expect(validatePublicPushEndpoint("https://100.76.180.116/gmail-pubsub")).toEqual({
      ok: false,
      error:
        "Public Push Endpoint must be a public HTTPS URL. Private, LAN, and Tailscale IP addresses will not work for Google Pub/Sub push delivery.",
    });
  });

  it("accepts a public HTTPS URL", () => {
    expect(validatePublicPushEndpoint("https://example.com/gmail-pubsub?token=secret")).toEqual({
      ok: true,
      normalized: "https://example.com/gmail-pubsub?token=secret",
    });
  });
});

describe("extractTailscaleFunnelEnableUrl", () => {
  it("extracts the Funnel enable link from helper output", () => {
    expect(
      extractTailscaleFunnelEnableUrl(
        "Warning: client version mismatch. Funnel is not enabled on your tailnet. To enable, visit: https://login.tailscale.com/f/funnel?node=node-123",
      ),
    ).toBe("https://login.tailscale.com/f/funnel?node=node-123");
  });
});
