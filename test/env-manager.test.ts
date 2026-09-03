import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG_FILENAME } from "../src/core/config.js";
import {
  clearActiveEnvironment,
  cloneEnvironment,
  getActiveEnvironment,
  listEnvironments,
  removeEnvironment,
  setActiveEnvironment,
  setDefaultEnvironment,
} from "../src/core/env-manager.js";

describe("Environment Manager", () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kodall-env-test-"));
    configPath = path.join(tempDir, DEFAULT_CONFIG_FILENAME);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should list environments with defaults and overrides", () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        web_app_name: "test-app",
        web_app_path: "/test-app",
        default_env: "dev",
        environments: {
          dev: {
            type: "dev",
            instance: "https://dev.kodall.ro",
          },
          prod: {
            type: "prod",
            instance: "https://app.kodall.ro",
            api_key: "prod-key",
          },
        },
      }),
      "utf-8"
    );

    const list = listEnvironments(configPath, tempDir);
    expect(list.length).toBe(2);

    const dev = list.find((e) => e.name === "dev");
    expect(dev).toBeDefined();
    expect(dev?.isDefault).toBe(true);
    expect(dev?.type).toBe("dev");
    expect(dev?.hasApiKey).toBe(false);

    const prod = list.find((e) => e.name === "prod");
    expect(prod).toBeDefined();
    expect(prod?.isDefault).toBe(false);
    expect(prod?.type).toBe("prod");
    expect(prod?.hasApiKey).toBe(true);
  });

  it("should handle custom environment type", () => {
    // Custom env
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        environments: {
          sandbox: { instance: "https://sandbox.kodall.ro" },
        },
      }),
      "utf-8"
    );
    const customList = listEnvironments(configPath, tempDir);
    expect(customList[0].type).toBe("custom");
  });

  it("should handle empty or missing config file in listEnvironments", () => {
    const list = listEnvironments("nonexistent.json", tempDir);
    expect(list).toEqual([]);
  });

  it("should remove an environment and update default if needed", () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        default_env: "dev",
        environments: {
          dev: { instance: "https://dev.kodall.ro" },
          staging: { instance: "https://staging.kodall.ro" },
        },
      }),
      "utf-8"
    );

    const res = removeEnvironment("dev", configPath, tempDir);
    expect(res.success).toBe(true);
    expect(res.newDefault).toBe("staging");

    const updatedList = listEnvironments(configPath, tempDir);
    expect(updatedList.length).toBe(1);
    expect(updatedList[0].name).toBe("staging");
    expect(updatedList[0].isDefault).toBe(true);
  });

  it("should fail when removing non-existent environment", () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        environments: { dev: { instance: "https://dev.kodall.ro" } },
      }),
      "utf-8"
    );

    expect(() => removeEnvironment("ghost", configPath, tempDir)).toThrow("not found");
  });

  it("should clone an existing environment with overrides", () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        default_env: "dev",
        environments: {
          dev: {
            type: "dev",
            instance: "https://dev.kodall.ro",
            web_app_path: "/dev-path",
          },
        },
      }),
      "utf-8"
    );

    const updatedConfig = cloneEnvironment(
      "dev",
      "dev2",
      { web_app_path: "/dev2-path" },
      configPath,
      tempDir
    );

    expect(updatedConfig.environments?.dev2).toBeDefined();

    const list = listEnvironments(configPath, tempDir);
    expect(list.length).toBe(2);

    const dev2 = list.find((e) => e.name === "dev2");
    expect(dev2).toBeDefined();
    expect(dev2?.webAppPath).toBe("/dev2-path");
    expect(dev2?.instance).toBe("https://dev.kodall.ro");
  });

  it("should fail when cloning non-existent environment or when target already exists", () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        environments: {
          dev: { instance: "https://dev.kodall.ro" },
        },
      }),
      "utf-8"
    );

    expect(() => cloneEnvironment("unknown", "new-env", {}, configPath, tempDir)).toThrow(
      "not found"
    );

    expect(() => cloneEnvironment("dev", "dev", {}, configPath, tempDir)).toThrow(
      "already exists"
    );

    expect(() => cloneEnvironment("dev", "dev2", {}, "missing.json", tempDir)).toThrow(
      "does not exist"
    );
  });

  it("should set default environment properly", () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        default_env: "dev",
        environments: {
          dev: { instance: "https://dev.kodall.ro" },
          prod: { instance: "https://app.kodall.ro" },
        },
      }),
      "utf-8"
    );

    const updatedConfig = setDefaultEnvironment("prod", configPath, tempDir);
    expect(updatedConfig.default_env).toBe("prod");

    const list = listEnvironments(configPath, tempDir);
    const prod = list.find((e) => e.name === "prod");
    expect(prod?.isDefault).toBe(true);
  });

  it("should fail when setting non-existent default environment or missing config", () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        environments: { dev: { instance: "https://dev.kodall.ro" } },
      }),
      "utf-8"
    );

    expect(() => setDefaultEnvironment("unknown", configPath, tempDir)).toThrow("not found");
    expect(() => setDefaultEnvironment("dev", "missing.json", tempDir)).toThrow("does not exist");
  });

  describe("Active Proxy Environment State Isolation", () => {
    it("should set and get local active environment without modifying config file", () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          default_env: "dev",
          environments: {
            dev: { instance: "https://dev.kodall.ro" },
            staging: { instance: "https://staging.kodall.ro" },
          },
        }),
        "utf-8"
      );

      expect(getActiveEnvironment(tempDir)).toBeUndefined();

      setActiveEnvironment("staging", tempDir, configPath);
      expect(getActiveEnvironment(tempDir)).toBe("staging");

      // Verify kodall-webapp.config.json is NOT modified (clean git!)
      const configRaw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(configRaw.default_env).toBe("dev");

      // listEnvironments should report isActiveProxy true for staging and isDefault true for dev
      const list = listEnvironments(configPath, tempDir);
      const dev = list.find((e) => e.name === "dev");
      const staging = list.find((e) => e.name === "staging");
      expect(dev?.isDefault).toBe(true);
      expect(dev?.isActiveProxy).toBe(false);
      expect(staging?.isDefault).toBe(false);
      expect(staging?.isActiveProxy).toBe(true);

      // Clear active env
      clearActiveEnvironment(tempDir);
      expect(getActiveEnvironment(tempDir)).toBeUndefined();
    });

    it("should throw error when setting active env to non-existent environment", () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          environments: {
            dev: { instance: "https://dev.kodall.ro" },
          },
        }),
        "utf-8"
      );

      expect(() => setActiveEnvironment("ghost", tempDir, configPath)).toThrow("not found");
    });
  });
});
