import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cloneEnvironment,
  listEnvironments,
  removeEnvironment,
  setDefaultEnvironment,
} from "../src/core/env-manager.js";

describe("Environment Manager", () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kodall-env-test-"));
    configPath = path.join(tempDir, "config_web_app.json");
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
      "uat",
      {
        instance: "https://uat.kodall.ro",
        type: "test",
      },
      configPath,
      tempDir
    );

    expect(updatedConfig.environments?.uat).toBeDefined();
    expect(updatedConfig.environments?.uat.instance).toBe("https://uat.kodall.ro");
    expect(updatedConfig.environments?.uat.web_app_path).toBe("/dev-path");
    expect(updatedConfig.environments?.uat.type).toBe("test");
  });

  it("should throw when cloning to an already existing environment", () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        environments: {
          dev: { instance: "https://dev.kodall.ro" },
          staging: { instance: "https://staging.kodall.ro" },
        },
      }),
      "utf-8"
    );

    expect(() =>
      cloneEnvironment("dev", "staging", {}, configPath, tempDir)
    ).toThrowError(/already exists/);
  });

  it("should set a new default environment", () => {
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
});
