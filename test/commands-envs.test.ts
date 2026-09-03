import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  displayEnvsTable,
  handleAddEnv,
  handleClearActive,
  handleCloneEnv,
  handleListEnvs,
  handleManageEnvs,
  handleRemoveEnv,
  handleSetDefault,
  handleUseEnv,
} from "../src/commands/envs.js";
import { DEFAULT_CONFIG_FILENAME } from "../src/core/config.js";
import { EnvironmentInfo } from "../src/core/env-manager.js";
import { log } from "../src/ui/logger.js";
import * as prompts from "../src/ui/prompts.js";

describe("commands/envs", () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kodall-envs-cmd-test-"));
    configPath = path.join(tempDir, DEFAULT_CONFIG_FILENAME);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("displayEnvsTable should handle empty env list", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    displayEnvsTable([]);
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("displayEnvsTable should render table with prod, staging, and custom types", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const envs: EnvironmentInfo[] = [
      {
        name: "dev",
        type: "dev",
        instance: "https://dev.kodall.ro",
        isDefault: true,
        isActiveProxy: true,
        hasApiKey: false,
        webAppName: "app",
        webAppPath: "/app",
        distPath: "./dist",
      },
      {
        name: "staging",
        type: "staging",
        instance: "https://staging.kodall.ro",
        isDefault: false,
        isActiveProxy: false,
        hasApiKey: true,
        webAppName: "app",
        webAppPath: "/staging",
        distPath: "./dist",
      },
      {
        name: "prod",
        type: "prod",
        instance: "https://app.kodall.ro",
        isDefault: false,
        isActiveProxy: false,
        hasApiKey: true,
        webAppName: "app",
        webAppPath: "/prod",
        distPath: "./dist",
      },
    ];
    displayEnvsTable(envs);
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("handleListEnvs should list configured environments", async () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        environments: {
          dev: { instance: "https://dev.kodall.ro" },
        },
      })
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleListEnvs(configPath);
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("handleClearActive should clear active env override", async () => {
    const succSpy = vi.spyOn(log, "success").mockImplementation(() => {});
    await handleClearActive();
    expect(succSpy).toHaveBeenCalledWith(expect.stringContaining("Cleared local dev proxy"));
    succSpy.mockRestore();
  });

  it("handleUseEnv should handle non-existent config and invalid env names", async () => {
    const errSpy = vi.spyOn(log, "error").mockImplementation(() => {});
    await handleUseEnv(path.join(tempDir, "non-existent.json"), "dev");
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("No environments found"));

    fs.writeFileSync(
      configPath,
      JSON.stringify({
        default_env: "dev",
        environments: { dev: { instance: "https://dev.kodall.ro" } },
      })
    );

    await handleUseEnv(configPath, "ghost-env");
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Environment "ghost-env" does not exist'));
    errSpy.mockRestore();
  });

  it("handleUseEnv should interactively prompt and save local override", async () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        default_env: "dev",
        environments: {
          dev: { instance: "https://dev.kodall.ro" },
          staging: { instance: "https://staging.kodall.ro" },
        },
      })
    );

    vi.spyOn(prompts, "askSelect").mockResolvedValueOnce("staging (https://staging.kodall.ro)");
    const succSpy = vi.spyOn(log, "success").mockImplementation(() => {});

    await handleUseEnv(configPath, undefined, true);
    expect(succSpy).toHaveBeenCalledWith(expect.stringContaining("Active proxy environment set to"));
    succSpy.mockRestore();
  });

  it("handleSetDefault should update default environment in config", async () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        default_env: "dev",
        environments: {
          dev: { instance: "https://dev.kodall.ro" },
          prod: { instance: "https://app.kodall.ro" },
        },
      })
    );

    vi.spyOn(prompts, "askSelect").mockResolvedValueOnce("prod (https://app.kodall.ro)");
    const succSpy = vi.spyOn(log, "success").mockImplementation(() => {});

    await handleSetDefault(configPath);
    expect(succSpy).toHaveBeenCalledWith(expect.stringContaining("Default deployment environment set to"));

    const errSpy = vi.spyOn(log, "error").mockImplementation(() => {});
    await handleSetDefault(path.join(tempDir, "missing.json"));
    expect(errSpy).toHaveBeenCalled();
    await handleSetDefault(configPath, "ghost");
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
    succSpy.mockRestore();
  });

  it("handleAddEnv should guide user through adding new environment or editing existing", async () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        environments: {
          dev: { instance: "https://dev.kodall.ro" },
        },
      })
    );

    vi.spyOn(prompts, "askSelect")
      .mockResolvedValueOnce("➕ Add new environment...")
      .mockResolvedValueOnce("custom");
    vi.spyOn(prompts, "askText")
      .mockResolvedValueOnce("uat")
      .mockResolvedValueOnce("user-acceptance")
      .mockResolvedValueOnce("https://uat.kodall.ro")
      .mockResolvedValueOnce("/uat")
      .mockResolvedValueOnce("uat-api-key")
      .mockResolvedValueOnce("./dist-uat")
      .mockResolvedValueOnce("My App")
      .mockResolvedValueOnce("/my-app");

    const succSpy = vi.spyOn(log, "success").mockImplementation(() => {});
    vi.spyOn(prompts, "askConfirm").mockResolvedValue(true);
    await handleAddEnv(configPath);
    expect(succSpy).toHaveBeenCalledWith(expect.stringContaining('Environment "uat" saved'));

    // Test inferred types for prod and staging and non-existent config path
    vi.spyOn(prompts, "askSelect").mockResolvedValue("dev");
    vi.spyOn(prompts, "askText").mockResolvedValue("test-val");
    await handleAddEnv(configPath, "production");
    await handleAddEnv(configPath, "staging-env");
    await handleAddEnv(path.join(tempDir, "brand-new.json"), "dev");

    // Test creating config with no environments object
    const emptyCfgPath = path.join(tempDir, "empty-cfg.json");
    fs.writeFileSync(emptyCfgPath, JSON.stringify({}));
    vi.spyOn(prompts, "askText")
      .mockResolvedValueOnce("dev") // name
      .mockResolvedValueOnce("https://dev.kodall.ro") // instance
      .mockResolvedValueOnce("/app")
      .mockResolvedValueOnce("key")
      .mockResolvedValueOnce("./dist")
      .mockResolvedValueOnce("App")
      .mockResolvedValueOnce("/app");
    vi.spyOn(prompts, "askSelect").mockResolvedValueOnce("dev");

    await handleAddEnv(emptyCfgPath);
    succSpy.mockRestore();
  });

  it("handleRemoveEnv should remove environment after confirmation", async () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        default_env: "dev",
        environments: {
          dev: { instance: "https://dev.kodall.ro" },
          staging: { instance: "https://staging.kodall.ro" },
        },
      })
    );

    vi.spyOn(prompts, "askSelect").mockResolvedValueOnce("dev");
    vi.spyOn(prompts, "askConfirm").mockResolvedValueOnce(true);
    const succSpy = vi.spyOn(log, "success").mockImplementation(() => {});

    await handleRemoveEnv(configPath);
    expect(succSpy).toHaveBeenCalledWith(expect.stringContaining('Environment "dev" removed'));

    // Cancelled confirmation
    vi.spyOn(prompts, "askConfirm").mockResolvedValueOnce(false);
    await handleRemoveEnv(configPath, "staging");

    // Missing file or invalid target
    const errSpy = vi.spyOn(log, "error").mockImplementation(() => {});
    await handleRemoveEnv(path.join(tempDir, "missing.json"));
    await handleRemoveEnv(configPath, "ghost");
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
    succSpy.mockRestore();
  });

  it("handleCloneEnv should clone environment with new settings", async () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        default_env: "dev",
        environments: {
          dev: { instance: "https://dev.kodall.ro", web_app_path: "/app", api_key: "k1" },
        },
      })
    );

    vi.spyOn(prompts, "askSelect").mockResolvedValueOnce("dev");
    vi.spyOn(prompts, "askText")
      .mockResolvedValueOnce("dev-copy")
      .mockResolvedValueOnce("https://dev2.kodall.ro")
      .mockResolvedValueOnce("/app2")
      .mockResolvedValueOnce("k2");

    const succSpy = vi.spyOn(log, "success").mockImplementation(() => {});
    await handleCloneEnv(configPath);
    expect(succSpy).toHaveBeenCalledWith(expect.stringContaining('Environment "dev-copy" created'));

    // Test with source and target passed as arguments
    vi.spyOn(prompts, "askText")
      .mockResolvedValueOnce("https://dev3.kodall.ro")
      .mockResolvedValueOnce("/app3")
      .mockResolvedValueOnce("k3");
    await handleCloneEnv(configPath, "dev", "dev3");
    expect(succSpy).toHaveBeenCalledWith(expect.stringContaining('Environment "dev3" created'));

    // Errors
    const errSpy = vi.spyOn(log, "error").mockImplementation(() => {});
    await handleCloneEnv(path.join(tempDir, "missing.json"));
    await handleCloneEnv(configPath, "ghost");
    await handleCloneEnv(configPath, "dev", "dev-copy");
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
    succSpy.mockRestore();
  });

  it("handleManageEnvs loop should route to all management subcommands", async () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        default_env: "dev",
        environments: {
          dev: { instance: "https://dev.kodall.ro" },
        },
      })
    );

    vi.spyOn(prompts, "askSelect")
      .mockResolvedValueOnce("List configured environments")
      .mockResolvedValueOnce("Switch active proxy environment (local override)")
      .mockResolvedValueOnce("dev") // use select
      .mockResolvedValueOnce("Set default deployment environment (config file)")
      .mockResolvedValueOnce("dev") // default select
      .mockResolvedValueOnce("Add or edit an environment")
      .mockResolvedValueOnce("dev") // select existing env to edit
      .mockResolvedValueOnce("dev") // select env type
      .mockResolvedValueOnce("Remove an environment")
      .mockResolvedValueOnce("dev") // remove select
      .mockResolvedValueOnce("Clone / duplicate an environment")
      .mockResolvedValueOnce("dev") // clone select
      .mockResolvedValueOnce("Back");

    // Sub-prompts
    vi.spyOn(prompts, "askConfirm").mockResolvedValue(true);
    vi.spyOn(prompts, "askText").mockResolvedValue("test-val");

    await handleManageEnvs(configPath);
  });
});
