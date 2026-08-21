import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG_FILENAME,
  findTargetEnvironments,
  LEGACY_CONFIG_FILENAME,
  loadConfigFile,
  migrateLegacyConfigFile,
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

  it("should have correct default and legacy config filenames", () => {
    expect(DEFAULT_CONFIG_FILENAME).toBe("kodall-webapp.config.json");
    expect(LEGACY_CONFIG_FILENAME).toBe("config_web_app.json");
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

  it("should load and save configuration file in kodall-webapp.config.json", () => {
    const sampleConfig = {
      web_app_name: "test-app",
      web_app_path: "test-path",
      dist_path: "./dist",
      default_env: "dev",
      environments: {
        dev: {
          instance: "https://test.domain.com",
        },
      },
    };

    saveConfigFile(DEFAULT_CONFIG_FILENAME, sampleConfig, tempDir);
    const { fileExists, config } = loadConfigFile(DEFAULT_CONFIG_FILENAME, tempDir);

    expect(fileExists).toBe(true);
    expect(config.web_app_name).toBe("test-app");
    expect(config.environments?.dev?.instance).toBe("https://test.domain.com");
  });

  it("should migrate legacy flat config_web_app.json to kodall-webapp.config.json with environments", () => {
    const legacyFlatConfig = {
      web_app_name: "legacy-app",
      web_app_path: "/legacy",
      instance: "https://legacy.instance.com",
      dist_path: "./dist",
      api_key: "my-key-123",
    };

    fs.writeFileSync(
      path.join(tempDir, LEGACY_CONFIG_FILENAME),
      JSON.stringify(legacyFlatConfig, null, 2),
      "utf-8"
    );

    const result = migrateLegacyConfigFile(tempDir);
    expect(result.migrated).toBe(true);
    expect(fs.existsSync(path.join(tempDir, DEFAULT_CONFIG_FILENAME))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, LEGACY_CONFIG_FILENAME))).toBe(false);

    const { config } = loadConfigFile(DEFAULT_CONFIG_FILENAME, tempDir);
    expect(config.web_app_name).toBe("legacy-app");
    expect(config.web_app_path).toBe("/legacy");
    expect(config.default_env).toBe("dev");
    expect(config.environments?.dev?.instance).toBe("https://legacy.instance.com");
    expect(config.environments?.dev?.api_key).toBe("my-key-123");

    // Second call is a no-op
    const noopResult = migrateLegacyConfigFile(tempDir);
    expect(noopResult.migrated).toBe(false);
  });

  it("should migrate legacy multi-environment config_web_app.json to kodall-webapp.config.json", () => {
    const legacyMultiConfig = {
      web_app_name: "multi-app",
      web_app_path: "/multi",
      environments: {
        staging: {
          instance: "https://staging.kodall.ro",
        },
      },
    };

    fs.writeFileSync(
      path.join(tempDir, LEGACY_CONFIG_FILENAME),
      JSON.stringify(legacyMultiConfig, null, 2),
      "utf-8"
    );

    const result = migrateLegacyConfigFile(tempDir);
    expect(result.migrated).toBe(true);
    expect(fs.existsSync(path.join(tempDir, DEFAULT_CONFIG_FILENAME))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, LEGACY_CONFIG_FILENAME))).toBe(false);

    const { config } = loadConfigFile(DEFAULT_CONFIG_FILENAME, tempDir);
    expect(config.web_app_name).toBe("multi-app");
    expect(config.environments?.staging?.instance).toBe("https://staging.kodall.ro");
  });

  it("should clean up legacy file if new config already exists", () => {
    fs.writeFileSync(
      path.join(tempDir, DEFAULT_CONFIG_FILENAME),
      JSON.stringify({ environments: { dev: { instance: "https://dev.ro" } } }),
      "utf-8"
    );
    fs.writeFileSync(path.join(tempDir, LEGACY_CONFIG_FILENAME), "{}", "utf-8");

    const result = migrateLegacyConfigFile(tempDir);
    expect(result.migrated).toBe(false);
    expect(fs.existsSync(path.join(tempDir, LEGACY_CONFIG_FILENAME))).toBe(false);
  });

  it("should handle corrupted files during migration gracefully", () => {
    fs.writeFileSync(path.join(tempDir, DEFAULT_CONFIG_FILENAME), "{ bad json }", "utf-8");
    expect(migrateLegacyConfigFile(tempDir).migrated).toBe(false);

    fs.unlinkSync(path.join(tempDir, DEFAULT_CONFIG_FILENAME));
    fs.writeFileSync(path.join(tempDir, LEGACY_CONFIG_FILENAME), "{ bad json }", "utf-8");
    expect(migrateLegacyConfigFile(tempDir).migrated).toBe(false);
  });

  it("should auto-migrate flat format inside kodall-webapp.config.json on load", () => {
    const flatInNewFile = {
      web_app_name: "flat-app",
      web_app_path: "flat-path",
      instance: "https://flat.kodall.ro",
    };

    fs.writeFileSync(
      path.join(tempDir, DEFAULT_CONFIG_FILENAME),
      JSON.stringify(flatInNewFile, null, 2),
      "utf-8"
    );

    const { config } = loadConfigFile(DEFAULT_CONFIG_FILENAME, tempDir);
    expect(config.environments?.dev?.instance).toBe("https://flat.kodall.ro");
    expect(config.web_app_path).toBe("/flat-path");
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

    saveConfigFile(DEFAULT_CONFIG_FILENAME, multiEnvConfig, tempDir);

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
      environments: {
        dev: {
          instance: "https://base.instance.com",
        },
      },
    };
    saveConfigFile(DEFAULT_CONFIG_FILENAME, config, tempDir);

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
