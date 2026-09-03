import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KodallNodeClient } from "../src/client/kodall-node-client.js";
import * as pkceModule from "../src/client/pkce-auth.js";
import * as authProbeModule from "../src/commands/auth-probe.js";
import { displayHistory, displayHistoryForEnv, displayServerHistory } from "../src/commands/history.js";
import { DEFAULT_CONFIG_FILENAME } from "../src/core/config.js";
import { recordDeployment } from "../src/core/history.js";
import { DeploymentRecord } from "../src/core/types.js";
import * as prompts from "../src/ui/prompts.js";

describe("commands/history", () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kodall-hist-cmd-test-"));
    configPath = path.join(tempDir, DEFAULT_CONFIG_FILENAME);
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("displayServerHistory should render empty message or grouped log tables", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    displayServerHistory([], "dev", "https://dev.kodall.ro");

    displayServerHistory(
      [
        {
          key: 101,
          status: "success",
          date_created: "2026-09-01T12:00:00Z",
          path: "/app",
          storageFileVersionKey: 55,
          file_name: "web_app.zip",
          _appName: "Portal",
        },
        {
          key: 102,
          status: "rollback",
          date_created: "invalid-date",
          _appName: "Portal",
        },
        {
          key: 103,
          status: "error",
          _appName: "Portal",
        },
      ],
      undefined,
      "https://dev.kodall.ro"
    );

    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("displayHistory should render local records or empty message", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    displayHistory([], "dev");

    const records: DeploymentRecord[] = [
      {
        id: "rec-1",
        timestamp: "2026-09-01T12:00:00Z",
        storageId: 101,
        entityKey: 202,
        webAppName: "Portal",
        webAppPath: "/portal",
        instance: "https://dev.kodall.ro",
        env: "dev",
        action: "created",
        username: "admin",
      },
      {
        id: "rec-2",
        timestamp: "invalid-date-string",
        storageId: 102,
        entityKey: 202,
        webAppName: "Portal",
        webAppPath: "/portal",
        instance: "https://dev.kodall.ro",
        env: "dev",
        action: "updated",
      },
      {
        id: "rec-3",
        timestamp: "2026-09-02T12:00:00Z",
        storageId: 103,
        entityKey: 202,
        webAppName: "Portal",
        webAppPath: "/portal",
        instance: "https://dev.kodall.ro",
        env: "dev",
        action: "rollback",
      },
    ];

    displayHistory(records, undefined);
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("displayHistoryForEnv should query server when instance is >= 1.8.0", async () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        web_app_name: "portal",
        environments: {
          dev: { instance: "https://dev.kodall.ro", api_key: "dev-key" },
        },
      })
    );

    vi.spyOn(KodallNodeClient.prototype, "session").mockResolvedValue({
      authenticated: true,
      version: "1.8.0",
    } as any);

    vi.spyOn(KodallNodeClient.prototype, "fetch").mockResolvedValue([
      {
        key: 1,
        status: "success",
        date_created: "2026-09-01T00:00:00Z",
        storageFileVersionKey: 50,
      },
    ] as any);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await displayHistoryForEnv(configPath, "dev", {});
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("displayHistoryForEnv should handle OIDC browser authentication flow", async () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        web_app_name: "portal",
        environments: {
          dev: { instance: "https://dev.kodall.ro" },
        },
      })
    );

    vi.spyOn(KodallNodeClient.prototype, "session").mockResolvedValue({
      authenticated: false,
      version: "1.8.0",
    } as any);

    vi.spyOn(authProbeModule, "probeAuthType").mockResolvedValue({
      isOidc: true,
      oidcIssuer: "https://auth.company.com/realms/kodall",
    });

    vi.spyOn(KodallNodeClient.prototype, "getOidcIssuer").mockResolvedValue({
      issuer: "https://auth.company.com/realms/kodall",
      authorizationEndpoint: "https://auth.company.com/auth",
      tokenEndpoint: "https://auth.company.com/token",
    } as any);

    vi.spyOn(pkceModule, "executeBrowserOAuthLogin").mockResolvedValue({
      accessToken: "oidc-token",
    } as any);

    vi.spyOn(KodallNodeClient.prototype, "openIdAuth").mockResolvedValue({
      authenticated: true,
    } as any);

    vi.spyOn(KodallNodeClient.prototype, "fetch").mockResolvedValue([]);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await displayHistoryForEnv(configPath, "dev", {});
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("displayHistoryForEnv should handle token auth and username/password login", async () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        web_app_name: "portal",
        environments: {
          dev: { instance: "https://dev.kodall.ro" },
        },
      })
    );

    vi.spyOn(KodallNodeClient.prototype, "session").mockResolvedValue({
      authenticated: false,
      version: "1.8.0",
    } as any);

    vi.spyOn(KodallNodeClient.prototype, "auth").mockResolvedValue({
      ok: true,
    } as any);

    vi.spyOn(KodallNodeClient.prototype, "fetch").mockResolvedValue([]);

    // Direct token flag
    await displayHistoryForEnv(configPath, "dev", { token: "secret-token" });

    // Username/password interactive prompt
    vi.spyOn(authProbeModule, "probeAuthType").mockResolvedValue({
      isOidc: false,
    });
    vi.spyOn(prompts, "askText").mockResolvedValueOnce("admin");
    vi.spyOn(prompts, "askPassword").mockResolvedValueOnce("pwd");

    await displayHistoryForEnv(configPath, "dev", {});
  });

  it("displayHistoryForEnv should fallback to local history if no envs configured or server fetch fails", async () => {
    const emptyCfg = path.join(tempDir, "empty.json");
    fs.writeFileSync(emptyCfg, JSON.stringify({}));

    recordDeployment(
      {
        id: "r1",
        timestamp: "2026-09-01T00:00:00Z",
        storageId: 10,
        entityKey: 20,
        webAppName: "app",
        webAppPath: "/app",
        instance: "https://dev.kodall.ro",
        env: "dev",
        action: "created",
      },
      tempDir
    );

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await displayHistoryForEnv(emptyCfg, undefined, {});
    await displayHistoryForEnv(emptyCfg, "dev", {});
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });
});
