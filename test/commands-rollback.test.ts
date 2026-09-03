import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KodallNodeClient } from "../src/client/kodall-node-client.js";
import * as pkceModule from "../src/client/pkce-auth.js";
import * as authProbeModule from "../src/commands/auth-probe.js";
import { handleRollback } from "../src/commands/rollback.js";
import { DEFAULT_CONFIG_FILENAME } from "../src/core/config.js";
import * as historyCore from "../src/core/history.js";
import * as rollbackCore from "../src/core/rollback.js";
import { log } from "../src/ui/logger.js";
import * as prompts from "../src/ui/prompts.js";

describe("commands/rollback", () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kodall-rb-cmd-test-"));
    configPath = path.join(tempDir, DEFAULT_CONFIG_FILENAME);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("handleRollback should auto-detect environment from local history when storageId is given", async () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        default_env: "dev",
        environments: {
          dev: { instance: "https://dev.kodall.ro", api_key: "dev-key" },
          prod: { instance: "https://app.kodall.ro", api_key: "prod-key" },
        },
      })
    );

    vi.spyOn(historyCore, "getDeploymentHistory").mockReturnValue([
      {
        id: "rb-rec-1",
        storageId: 101,
        entityKey: 202,
        action: "created",
        env: "prod",
        timestamp: "2026-09-01T00:00:00Z",
        webAppName: "portal",
        webAppPath: "/portal",
        instance: "https://app.kodall.ro",
      },
    ]);

    vi.spyOn(rollbackCore, "rollback").mockImplementationOnce(async (opts) => {
      opts.onProgress?.("prepare", "start", "Preparing...");
      opts.onProgress?.("prepare", "success", "Ready");
      opts.onProgress?.("verify", "warn", "Warning");
      opts.onProgress?.("verify", "error", "Error");
      opts.onProgress?.("verify", "info", "Info message");
      return {
        success: true,
        toStorageId: 101,
        entityKey: 202,
        durationMs: 400,
        webAppName: "portal",
        webAppPath: "/portal",
      };
    });

    const succSpy = vi.spyOn(log, "success").mockImplementation(() => {});
    await handleRollback(configPath, "101", undefined, {});
    expect(succSpy).toHaveBeenCalledWith(expect.stringContaining("Rollback successful"));
    succSpy.mockRestore();
  });

  it("handleRollback should prompt for environment when multiple exist", async () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        environments: {
          dev: { instance: "https://dev.kodall.ro", api_key: "dev-key" },
          prod: { instance: "https://app.kodall.ro", api_key: "prod-key" },
        },
      })
    );

    vi.spyOn(prompts, "askSelect").mockResolvedValueOnce("prod");
    vi.spyOn(rollbackCore, "rollback").mockResolvedValueOnce({
      success: true,
      toStorageId: 105,
      entityKey: 202,
      durationMs: 400,
      webAppName: "portal",
      webAppPath: "/portal",
    });

    const succSpy = vi.spyOn(log, "success").mockImplementation(() => {});
    await handleRollback(configPath, "105", undefined, {});
    expect(succSpy).toHaveBeenCalledWith(expect.stringContaining("Rollback successful"));
    succSpy.mockRestore();
  });

  it("handleRollback should handle OIDC auth and server log build selection", async () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        web_app_name: "portal",
        environments: {
          dev: { instance: "https://dev.kodall.ro" },
        },
      })
    );

    vi.spyOn(authProbeModule, "probeAuthType").mockResolvedValue({
      isOidc: true,
      oidcIssuer: "https://auth.company.com/realms/kodall",
    });

    vi.spyOn(KodallNodeClient.prototype, "getOidcIssuer").mockResolvedValue({
      issuer: "https://auth.company.com/realms/kodall",
      authorizationEndpoint: "https://auth.company.com/auth",
      tokenEndpoint: "https://auth.company.com/token",
    } as any);

    vi.spyOn(pkceModule, "executeBrowserOAuthLogin").mockImplementationOnce(async (options) => {
      options.onAuthUrl?.("https://auth.company.com/auth?test=1");
      return { accessToken: "oidc-token" };
    });

    vi.spyOn(KodallNodeClient.prototype, "auth").mockResolvedValue({
      authenticated: true,
      token: "oidc-token",
    } as any);

    vi.spyOn(KodallNodeClient.prototype, "session").mockResolvedValue({
      version: "1.8.0",
      authenticated: true,
    } as any);

    vi.spyOn(KodallNodeClient.prototype, "fetch").mockResolvedValue([
      {
        key: 1,
        date_created: "2026-09-01T00:00:00Z",
        storageFileVersionKey: 55,
        file_name: "bundle.zip",
        path: "/portal",
      },
    ]);

    vi.spyOn(prompts, "askSelect").mockImplementation(async (_msg, choices) => choices[0]);
    vi.spyOn(rollbackCore, "rollback").mockResolvedValueOnce({
      success: true,
      toStorageId: 55,
      entityKey: 202,
      durationMs: 400,
      webAppName: "portal",
      webAppPath: "/portal",
    });

    const succSpy = vi.spyOn(log, "success").mockImplementation(() => {});
    await handleRollback(configPath, undefined, "dev", {});
    expect(succSpy).toHaveBeenCalledWith(expect.stringContaining("Rollback successful"));
    succSpy.mockRestore();
  });

  it("handleRollback should handle basic username/password login and local history selection", async () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        web_app_name: "portal",
        environments: {
          dev: { instance: "https://dev.kodall.ro" },
        },
      })
    );

    vi.spyOn(authProbeModule, "probeAuthType").mockResolvedValue({
      isOidc: false,
    });

    vi.spyOn(prompts, "askText").mockResolvedValueOnce("admin").mockResolvedValueOnce("pwd");
    vi.spyOn(prompts, "askPassword").mockResolvedValueOnce("secret");

    vi.spyOn(KodallNodeClient.prototype, "auth").mockResolvedValue({
      authenticated: true,
      user: "admin",
    } as any);

    vi.spyOn(KodallNodeClient.prototype, "session").mockResolvedValue({
      version: "1.0.0",
      authenticated: true,
    } as any);

    vi.spyOn(historyCore, "getDeploymentHistory").mockReturnValue([
      {
        id: "rb-rec-2",
        storageId: 99,
        entityKey: 202,
        action: "created",
        timestamp: "2026-09-01T00:00:00Z",
        webAppName: "portal",
        webAppPath: "/portal",
        instance: "https://dev.kodall.ro",
      },
    ]);

    vi.spyOn(prompts, "askSelect").mockImplementation(async (_msg, choices) => choices[0]);
    vi.spyOn(rollbackCore, "rollback").mockResolvedValueOnce({
      success: true,
      toStorageId: 99,
      entityKey: 202,
      durationMs: 400,
      webAppName: "portal",
      webAppPath: "/portal",
    });

    const succSpy = vi.spyOn(log, "success").mockImplementation(() => {});
    await handleRollback(configPath, undefined, "dev", {});
    expect(succSpy).toHaveBeenCalledWith(expect.stringContaining("Rollback successful"));
    succSpy.mockRestore();
  });

  it("handleRollback should exit when no storage ID is specified or chosen", async () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        environments: {
          dev: { instance: "https://dev.kodall.ro", api_key: "dev-key" },
        },
      })
    );

    vi.spyOn(historyCore, "getDeploymentHistory").mockReturnValue([]);
    vi.spyOn(prompts, "askText").mockResolvedValueOnce("");

    const errSpy = vi.spyOn(log, "error").mockImplementation(() => {});
    await handleRollback(configPath, undefined, "dev", {});
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("No storage ID specified"));
    errSpy.mockRestore();
  });

  it("handleRollback should handle rollback error", async () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        environments: {
          dev: { instance: "https://dev.kodall.ro", api_key: "dev-key" },
        },
      })
    );

    vi.spyOn(rollbackCore, "rollback").mockRejectedValueOnce(
      new Error("Target storage version not found")
    );

    const errSpy = vi.spyOn(log, "error").mockImplementation(() => {});
    await handleRollback(configPath, "999", "dev", {});
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("Rollback failed"));
    errSpy.mockRestore();
  });
});
