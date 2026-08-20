import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  findTargetEnvironments,
  loadConfigFile,
  resolveConfig,
  saveConfigFile,
  validateDistDirectory,
} from "../src/core/config.js";

describe("Config Resolution & Validation", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kodall-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("should handle missing config file gracefully", () => {
    const { fileExists, config } = loadConfigFile("nonexistent.json", tempDir);
    expect(fileExists).toBe(false);
    expect(config).toEqual({});
  });

  it("should throw descriptive error when config file contains malformed JSON", () => {
    fs.writeFileSync(path.join(tempDir, "broken.json"), "{ invalid-json }", "utf-8");
    expect(() => loadConfigFile("broken.json", tempDir)).toThrow("Failed to parse config file");
  });

  it("should load and save configuration file", () => {
    const sampleConfig = {
      web_app_name: "test-app",
      web_app_path: "test-path",
      instance: "https://test.domain.com",
      dist_path: "./dist",
    };

    saveConfigFile("config_web_app.json", sampleConfig, tempDir);
    const { fileExists, config } = loadConfigFile("config_web_app.json", tempDir);

    expect(fileExists).toBe(true);
    expect(config.web_app_name).toBe("test-app");
    expect(config.instance).toBe("https://test.domain.com");
  });

  it("should resolve multi-environment configuration with overrides", () => {
    const multiEnvConfig = {
      web_app_name: "my-app",
      web_app_path: "app-root",
      dist_path: "./build",
      default_env: "dev",
      environments: {
        dev: {
          instance: "https://dev.instance.domain.com",
        },
        prod: {
          instance: "https://prod.instance.domain.com",
          web_app_path: "app-production",
          api_key: "secret-prod-api-key",
        },
      },
    };

    saveConfigFile("config_web_app.json", multiEnvConfig, tempDir);

    // Resolve default env (dev)
    const devRes = resolveConfig({}, tempDir);
    expect(devRes.targetEnv).toBe("dev");
    expect(devRes.resolved.instance).toBe("https://dev.instance.domain.com");
    expect(devRes.resolved.web_app_name).toBe("my-app");
    expect(devRes.resolved.web_app_path).toBe("/app-root");
    expect(devRes.resolved.dist_path).toBe("./build");

    // Resolve specific env (prod)
    const prodRes = resolveConfig({ env: "prod" }, tempDir);
    expect(prodRes.targetEnv).toBe("prod");
    expect(prodRes.resolved.instance).toBe("https://prod.instance.domain.com");
    expect(prodRes.resolved.web_app_path).toBe("/app-production");
    expect(prodRes.resolved.api_key).toBe("secret-prod-api-key");
    expect(prodRes.missing).not.toContain("username");
    expect(prodRes.missing).not.toContain("password");
  });

  it("should prioritize CLI options over config file", () => {
    const config = {
      web_app_name: "base-name",
      web_app_path: "base-path",
      instance: "https://base.instance.com",
    };
    saveConfigFile("config_web_app.json", config, tempDir);

    const result = resolveConfig(
      {
        instance: "https://cli-override.instance.com",
        webAppName: "cli-app",
      },
      tempDir
    );

    expect(result.resolved.instance).toBe("https://cli-override.instance.com");
    expect(result.resolved.web_app_name).toBe("cli-app");
    expect(result.resolved.web_app_path).toBe("/base-path");
  });

  it("should validate dist directory containing index.html", () => {
    const distPath = path.join(tempDir, "dist");
    fs.mkdirSync(distPath);
    fs.writeFileSync(path.join(distPath, "index.html"), "<html></html>");

    expect(validateDistDirectory("./dist", tempDir).valid).toBe(true);

    // Missing directory
    expect(validateDistDirectory("./missing-dir", tempDir).valid).toBe(false);

    // Directory without index.html
    const emptyDist = path.join(tempDir, "empty-dist");
    fs.mkdirSync(emptyDist);
    expect(validateDistDirectory("./empty-dist", tempDir).valid).toBe(false);

    // File instead of directory
    const fileDist = path.join(tempDir, "file-dist");
    fs.writeFileSync(fileDist, "not a dir");
    expect(validateDistDirectory("./file-dist", tempDir).valid).toBe(false);
  });

  it("should find target environments by name, comma list, type, or all", () => {
    const config = {
      environments: {
        dev: { type: "dev" },
        staging: { type: "staging" },
        "prod-us": { type: "prod" },
        "prod-eu": { type: "prod" },
      },
    };

    // By comma list
    expect(findTargetEnvironments({ env: "dev,staging" }, config)).toEqual(["dev", "staging"]);

    // By type
    expect(findTargetEnvironments({ type: "prod" }, config)).toEqual(["prod-us", "prod-eu"]);

    // All
    expect(findTargetEnvironments({ all: true }, config)).toEqual([
      "dev",
      "staging",
      "prod-us",
      "prod-eu",
    ]);

    // Single env
    expect(findTargetEnvironments({ env: "dev" }, config)).toEqual(["dev"]);

    // Empty environments map
    expect(findTargetEnvironments({ all: true }, { environments: {} })).toEqual([]);

    // Fallback key type detection
    expect(
      findTargetEnvironments(
        { type: "dev" },
        { environments: { dev: {}, staging: {} } }
      )
    ).toEqual(["dev"]);

    // No filter provided (empty options)
    expect(
      findTargetEnvironments(
        {},
        { environments: { dev: {}, staging: {} } }
      )
    ).toEqual([]);
  });
});
