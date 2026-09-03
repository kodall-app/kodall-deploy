import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KodallNodeClient } from "../src/client/kodall-node-client.js";
import * as pkceModule from "../src/client/pkce-auth.js";
import * as authProbeModule from "../src/commands/auth-probe.js";
import { ensureBuildFresh, handleDeployCommand } from "../src/commands/deploy.js";
import * as buildCore from "../src/core/build-check.js";
import { DEFAULT_CONFIG_FILENAME } from "../src/core/config.js";
import * as deployerCore from "../src/core/deployer.js";
import * as rollbackCore from "../src/core/rollback.js";
import { log } from "../src/ui/logger.js";
import * as prompts from "../src/ui/prompts.js";

describe("commands/deploy", () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kodall-deploy-cmd-test-"));
    configPath = path.join(tempDir, DEFAULT_CONFIG_FILENAME);
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("ensureBuildFresh", () => {
    it("should skip build if flags.no-build or isCi is true", async () => {
      expect(await ensureBuildFresh("./dist", { "no-build": true }, false)).toBe(true);
      expect(await ensureBuildFresh("./dist", {}, true)).toBe(true);
    });

    it("should run build when flags.build is set", async () => {
      vi.spyOn(buildCore, "runBuild").mockResolvedValueOnce({
        success: true,
        durationMs: 500,
      });
      expect(await ensureBuildFresh("./dist", { build: true }, false)).toBe(true);

      vi.spyOn(buildCore, "runBuild").mockResolvedValueOnce({
        success: false,
        error: "Syntax error",
        durationMs: 100,
      });
      expect(await ensureBuildFresh("./dist", { build: true }, false)).toBe(false);
    });

    it("should prompt to build if build directory is missing", async () => {
      vi.spyOn(buildCore, "checkBuildStatus").mockReturnValueOnce({
        exists: false,
        distPath: "./missing-dist",
        hasBuildScript: true,
        isStale: false,
      });

      vi.spyOn(prompts, "askConfirm").mockResolvedValueOnce(true);
      vi.spyOn(buildCore, "runBuild").mockResolvedValueOnce({
        success: true,
        durationMs: 300,
      });

      expect(await ensureBuildFresh("./missing-dist", {}, false)).toBe(true);

      // Test build failure when directory missing
      vi.spyOn(buildCore, "checkBuildStatus").mockReturnValueOnce({
        exists: false,
        distPath: "./missing-dist",
        hasBuildScript: true,
        isStale: false,
      });
      vi.spyOn(prompts, "askConfirm").mockResolvedValueOnce(true);
      vi.spyOn(buildCore, "runBuild").mockResolvedValueOnce({
        success: false,
        error: "Missing build failure",
        durationMs: 50,
      });
      expect(await ensureBuildFresh("./missing-dist", {}, false)).toBe(false);
    });

    it("should prompt to build if build is stale", async () => {
      vi.spyOn(buildCore, "checkBuildStatus").mockReturnValueOnce({
        exists: true,
        distPath: "./stale-dist",
        hasBuildScript: true,
        isStale: true,
        newestSourceFile: "src/app.ts",
      });

      vi.spyOn(prompts, "askConfirm").mockResolvedValueOnce(true);
      vi.spyOn(buildCore, "runBuild").mockResolvedValueOnce({
        success: true,
        durationMs: 300,
      });

      expect(await ensureBuildFresh("./stale-dist", {}, false)).toBe(true);

      // Test build failure when stale
      vi.spyOn(buildCore, "checkBuildStatus").mockReturnValueOnce({
        exists: true,
        distPath: "./stale-dist",
        hasBuildScript: true,
        isStale: true,
      });
      vi.spyOn(prompts, "askConfirm").mockResolvedValueOnce(true);
      vi.spyOn(buildCore, "runBuild").mockResolvedValueOnce({
        success: false,
        error: "Stale rebuild failure",
        durationMs: 50,
      });
      expect(await ensureBuildFresh("./stale-dist", {}, false)).toBe(false);

      // Test user declining stale rebuild
      vi.spyOn(buildCore, "checkBuildStatus").mockReturnValueOnce({
        exists: true,
        distPath: "./stale-dist",
        hasBuildScript: true,
        isStale: true,
      });
      vi.spyOn(prompts, "askConfirm").mockResolvedValueOnce(false);
      expect(await ensureBuildFresh("./stale-dist", {}, false)).toBe(true);
    });
  });

  describe("handleDeployCommand - Basic Tests", () => {
    it("should handle explicitEnvPrompt and missing config wizard", async () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          web_app_name: "app",
          web_app_path: "/app",
          dist_path: "./dist",
          environments: { dev: { instance: "https://dev.kodall.ro", api_key: "k1" } },
        })
      );

      vi.spyOn(prompts, "askSelect").mockResolvedValueOnce("dev");
      vi.spyOn(deployerCore, "deploy").mockImplementationOnce(async (opts) => {
        opts?.onProgress?.("archive", "start", "Archiving...");
        opts?.onProgress?.("archive", "success", "Archived");
        opts?.onProgress?.("verify", "warn", "Warning");
        opts?.onProgress?.("verify", "error", "Error");
        opts?.onProgress?.("verify", "info", "Info message");
        return {
          success: true,
          action: "updated",
          durationMs: 100,
          healthCheck: { ok: true, status: 200, statusText: "OK", url: "https://dev.kodall.ro/app", durationMs: 40 },
        };
      });

      await handleDeployCommand(configPath, { "no-build": true }, { explicitEnvPrompt: true });

      // Empty config
      const emptyCfg = path.join(tempDir, "empty.json");
      fs.writeFileSync(emptyCfg, JSON.stringify({}));
      vi.spyOn(prompts, "askText").mockResolvedValue("test-val");
      vi.spyOn(prompts, "askConfirm").mockResolvedValue(false);
      vi.spyOn(authProbeModule, "probeAuthType").mockResolvedValue({ isOidc: false });
      vi.spyOn(prompts, "askPassword").mockResolvedValue("pwd");

      vi.spyOn(deployerCore, "deploy").mockResolvedValueOnce({ success: true, action: "created", durationMs: 100 });
      await handleDeployCommand(emptyCfg, { "no-build": true }, { explicitEnvPrompt: true });
    });

    it("should handle explicitTypePrompt", async () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          web_app_name: "app",
          web_app_path: "/app",
          dist_path: "./dist",
          environments: {
            dev: { type: "dev", instance: "https://dev.kodall.ro", api_key: "k1" },
          },
        })
      );

      vi.spyOn(prompts, "askSelect").mockResolvedValueOnce("dev");
      vi.spyOn(deployerCore, "deploy").mockResolvedValueOnce({ success: true, action: "updated", durationMs: 100 });

      await handleDeployCommand(configPath, { "no-build": true }, { explicitTypePrompt: true });
    });
  });

  describe("handleDeployCommand - Interactive Menu Modes", () => {
    it("should handle Select specific environment and Deploy by type menus", async () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          web_app_name: "app",
          web_app_path: "/app",
          dist_path: "./dist",
          environments: {
            dev: { type: "dev", instance: "https://dev.kodall.ro", api_key: "k1" },
            prod: { type: "prod", instance: "https://app.kodall.ro", api_key: "k2" },
          },
        })
      );

      // Select specific env (with Back then dev)
      vi.spyOn(prompts, "askSelect")
        .mockResolvedValueOnce("Select specific environment")
        .mockResolvedValueOnce("Back")
        .mockResolvedValueOnce("Select specific environment")
        .mockResolvedValueOnce("dev");
      vi.spyOn(deployerCore, "deploy").mockResolvedValueOnce({ success: true, action: "updated", durationMs: 100 });

      await handleDeployCommand(configPath, { "no-build": true });

      // Deploy by type (with Back then prod)
      vi.spyOn(prompts, "askSelect")
        .mockResolvedValueOnce("Deploy by environment type (dev / staging / prod)")
        .mockResolvedValueOnce("Back")
        .mockResolvedValueOnce("Deploy by environment type (dev / staging / prod)")
        .mockResolvedValueOnce("prod");
      vi.spyOn(deployerCore, "deploy").mockResolvedValueOnce({ success: true, action: "updated", durationMs: 100 });

      await handleDeployCommand(configPath, { "no-build": true });

      // Deploy to ALL environments
      vi.spyOn(prompts, "askSelect")
        .mockResolvedValueOnce("Deploy to ALL environments");
      vi.spyOn(prompts, "askConfirm").mockResolvedValue(true);
      vi.spyOn(deployerCore, "deploy").mockResolvedValue({ success: true, action: "updated", durationMs: 100 });

      await handleDeployCommand(configPath, { "no-build": true });
    });

    it("should handle View history, Rollback, Live status, Manage envs, and CI generator from menu", async () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          web_app_name: "app",
          web_app_path: "/app",
          dist_path: "./dist",
          environments: {
            dev: { instance: "https://dev.kodall.ro", api_key: "k1" },
          },
        })
      );

      // View history then exit via Rollback return
      vi.spyOn(rollbackCore, "rollback").mockResolvedValue({
        success: true,
        toStorageId: 10,
        entityKey: 1,
        durationMs: 100,
        webAppName: "app",
        webAppPath: "/app",
      });
      vi.spyOn(prompts, "askPassword").mockResolvedValue("secret");
      vi.spyOn(prompts, "askSelect")
        .mockResolvedValueOnce("View deployment history")
        .mockResolvedValueOnce("Back") // test Back in history selection
        .mockResolvedValueOnce("View deployment history")
        .mockResolvedValueOnce("All environments")
        .mockResolvedValueOnce("Live remote status dashboard")
        .mockResolvedValueOnce("Manage environments")
        .mockResolvedValueOnce("Back") // exit manage envs loop
        .mockResolvedValueOnce("Generate CI/CD deployment workflow")
        .mockResolvedValueOnce("GitHub Actions (.github/workflows/kodall-deploy.yml)")
        .mockResolvedValueOnce("Rollback to a previous build")
        .mockResolvedValueOnce("dev") // environment to rollback
        .mockResolvedValue("Storage ID: 10 - test-app (CURRENT ACTIVE BUILD)");

      vi.spyOn(prompts, "askText").mockResolvedValue("develop");
      vi.spyOn(prompts, "askConfirm").mockResolvedValue(false);
      vi.spyOn(authProbeModule, "probeAuthType").mockResolvedValue({ isOidc: false });

      await handleDeployCommand(configPath, { "no-build": true });
    });

    it("should handle Custom one-off deployment with saving to config", async () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          web_app_name: "app",
          web_app_path: "/app",
          dist_path: "./dist",
          environments: {
            dev: { instance: "https://dev.kodall.ro", api_key: "k1" },
          },
        })
      );

      vi.spyOn(prompts, "askSelect")
        .mockResolvedValueOnce("Custom one-off deployment")
        .mockResolvedValueOnce("custom"); // type for new env

      vi.spyOn(prompts, "askText")
        .mockResolvedValueOnce("https://custom.kodall.ro") // instance
        .mockResolvedValueOnce("custom-app") // name
        .mockResolvedValueOnce("/custom-app") // path
        .mockResolvedValueOnce("./dist-custom") // dist
        .mockResolvedValueOnce("custom-api-key") // apiKey
        .mockResolvedValueOnce("custom-env"); // newEnvName

      vi.spyOn(prompts, "askConfirm").mockResolvedValueOnce(true); // save to config: true

      vi.spyOn(deployerCore, "deploy").mockResolvedValueOnce({
        success: true,
        action: "created",
        entityKey: 99,
        storageId: 199,
        durationMs: 300,
      });

      await handleDeployCommand(configPath, { "no-build": true });
    });
  });

  describe("handleDeployCommand - Batch Deployments & Auth", () => {
    it("should handle batch deployment with OIDC token reuse and progress events", async () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          web_app_name: "batch-app",
          web_app_path: "/batch",
          default_env: "dev",
          environments: {
            dev: { instance: "https://dev.kodall.ro" },
            staging: {},
          },
        })
      );

      vi.spyOn(prompts, "askConfirm").mockResolvedValueOnce(true); // confirm batch

      vi.spyOn(authProbeModule, "probeAuthType").mockResolvedValue({
        isOidc: true,
        oidcIssuer: "https://auth.company.com/realms/batch",
      });

      vi.spyOn(KodallNodeClient.prototype, "getOidcIssuer").mockResolvedValue({
        issuer: "https://auth.company.com/realms/batch",
      } as any);

      vi.spyOn(pkceModule, "executeBrowserOAuthLogin").mockImplementation(async (options) => {
        options.onAuthUrl?.("https://auth.company.com/batch-login");
        return { accessToken: "batch-oidc-token" };
      });

      let deployCount = 0;
      vi.spyOn(deployerCore, "deploy").mockImplementation(async (opts) => {
        deployCount++;
        opts?.onProgress?.("upload", "start", "Uploading...");
        opts?.onProgress?.("upload", "success", "Uploaded");
        opts?.onProgress?.("verify", "warn", "Warning");
        opts?.onProgress?.("verify", "error", "Error");
        opts?.onProgress?.("verify", "info", "Info message");
        if (deployCount === 2) {
          throw new Error("Staging deploy failed");
        }
        return { success: true, action: "updated", entityKey: 1, storageId: 2, durationMs: 250 };
      });

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const errLogSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await handleDeployCommand(configPath, { all: true, "no-build": true, debug: true });
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("DEPLOYMENT SUMMARY"));
      logSpy.mockRestore();
      errLogSpy.mockRestore();
    });

    it("should handle batch deployment with basic login prompts", async () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          web_app_name: "batch-app",
          web_app_path: "/batch",
          environments: {
            dev: { instance: "https://dev.kodall.ro" },
            staging: { instance: "https://staging.kodall.ro" },
          },
        })
      );

      vi.spyOn(prompts, "askConfirm").mockResolvedValueOnce(true); // confirm batch
      vi.spyOn(authProbeModule, "probeAuthType").mockResolvedValue({ isOidc: false });
      vi.spyOn(prompts, "askText").mockResolvedValueOnce("admin");
      vi.spyOn(prompts, "askPassword").mockResolvedValueOnce("password");

      vi.spyOn(deployerCore, "deploy").mockResolvedValue({
        success: true,
        action: "created",
        entityKey: 1,
        storageId: 1,
        durationMs: 100,
      });

      await handleDeployCommand(configPath, { all: true, "no-build": true });
    });

    it("should exit with code 1 if build fails during batch deploy", async () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          environments: {
            dev: { instance: "https://dev.kodall.ro", api_key: "k1" },
            staging: { instance: "https://staging.kodall.ro", api_key: "k2" },
          },
        })
      );

      vi.spyOn(prompts, "askConfirm").mockResolvedValueOnce(true);
      vi.spyOn(buildCore, "runBuild").mockResolvedValueOnce({
        success: false,
        error: "Batch build error",
        durationMs: 40,
      });

      await handleDeployCommand(configPath, { all: true, build: true });
      expect(process.exitCode).toBe(1);
    });

    it("should allow cancelling batch deployment confirmation", async () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          environments: {
            dev: { instance: "https://dev.kodall.ro", api_key: "k1" },
            staging: { instance: "https://staging.kodall.ro", api_key: "k2" },
          },
        })
      );

      vi.spyOn(prompts, "askConfirm").mockResolvedValueOnce(false); // cancel batch
      const warnSpy = vi.spyOn(log, "warn").mockImplementation(() => {});

      await handleDeployCommand(configPath, { all: true, "no-build": true });
      expect(warnSpy).toHaveBeenCalledWith("Deployment cancelled.");
      warnSpy.mockRestore();
    });
  });

  describe("handleDeployCommand - Single Deploy Interactive Wizard & Debug Errors", () => {
    it("should prompt for missing params and save new config file", async () => {
      const newConfigPath = path.join(tempDir, "new-app-config.json");

      vi.spyOn(prompts, "askText")
        .mockResolvedValueOnce("New App") // name
        .mockResolvedValueOnce("/new-app") // path
        .mockResolvedValueOnce("https://new.kodall.ro") // instance
        .mockResolvedValueOnce("./dist"); // dist

      vi.spyOn(prompts, "askConfirm").mockResolvedValueOnce(true); // save config: true

      vi.spyOn(authProbeModule, "probeAuthType").mockResolvedValueOnce({
        isOidc: true,
        oidcIssuer: "https://auth.company.com/realms/kodall",
      });

      vi.spyOn(KodallNodeClient.prototype, "getOidcIssuer").mockResolvedValueOnce({
        issuer: "https://auth.company.com/realms/kodall",
      } as any);

      vi.spyOn(pkceModule, "executeBrowserOAuthLogin").mockImplementationOnce(async (options) => {
        options.onAuthUrl?.("https://auth.company.com/auth?login=1");
        return { accessToken: "new-token" };
      });

      vi.spyOn(deployerCore, "deploy").mockResolvedValueOnce({
        success: true,
        action: "created",
        durationMs: 400,
        healthCheck: { ok: false, status: 500, statusText: "Internal Error", url: "https://new.kodall.ro/new-app", durationMs: 50 },
      });

      await handleDeployCommand(newConfigPath, { "no-build": true });
      expect(fs.existsSync(newConfigPath)).toBe(true);
    });

    it("should handle single dry-run deployment", async () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          web_app_name: "app",
          web_app_path: "/app",
          dist_path: "./dist",
          environments: {
            dev: { instance: "https://dev.kodall.ro", api_key: "dev-key" },
          },
        })
      );

      vi.spyOn(deployerCore, "deploy").mockResolvedValueOnce({
        success: true,
        action: "dry-run",
        durationMs: 150,
      });

      const succSpy = vi.spyOn(log, "success").mockImplementation(() => {});
      await handleDeployCommand(configPath, { env: "dev", "no-build": true, ci: true, "dry-run": true });
      expect(succSpy).toHaveBeenCalledWith(expect.stringContaining("Dry-run completed successfully"));
      succSpy.mockRestore();
    });

    it("should output standard error message when --debug is not set", async () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          web_app_name: "app",
          web_app_path: "/app",
          dist_path: "./dist",
          environments: {
            dev: { instance: "https://dev.kodall.ro", api_key: "dev-key" },
          },
        })
      );

      vi.spyOn(deployerCore, "deploy").mockRejectedValueOnce(new Error("Deploy error message"));

      const errSpy = vi.spyOn(log, "error").mockImplementation(() => {});
      await handleDeployCommand(configPath, { env: "dev", "no-build": true, ci: true });
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("Deployment failed"));
      errSpy.mockRestore();
    });

    it("should exit with code 1 if build fails during single deploy", async () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          web_app_name: "app",
          web_app_path: "/app",
          dist_path: "./dist",
          environments: {
            dev: { instance: "https://dev.kodall.ro", api_key: "dev-key" },
          },
        })
      );

      vi.spyOn(buildCore, "runBuild").mockResolvedValueOnce({
        success: false,
        error: "Build crashed",
        durationMs: 50,
      });

      await handleDeployCommand(configPath, { env: "dev", build: true });
      expect(process.exitCode).toBe(1);
    });

    it("should print cause stack trace when debug is true and cause has stack", async () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          web_app_name: "app",
          web_app_path: "/app",
          dist_path: "./dist",
          environments: {
            dev: { instance: "https://dev.kodall.ro", api_key: "dev-key" },
          },
        })
      );

      const err: any = new Error("Top error");
      err.stack = "Error: Top error\n    at func1 (file.js:1:1)";
      err.cause = new Error("Nested cause error");
      err.cause.stack = "Error: Nested cause error\n    at func2 (file.js:2:2)";

      vi.spyOn(deployerCore, "deploy").mockRejectedValueOnce(err);

      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await handleDeployCommand(configPath, { env: "dev", "no-build": true, ci: true, debug: true });
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("Cause stack trace"));
      errSpy.mockRestore();
    });
  });
});
