import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleInit } from "../src/commands/init.js";
import { DEFAULT_CONFIG_FILENAME } from "../src/core/config.js";
import { log } from "../src/ui/logger.js";
import * as prompts from "../src/ui/prompts.js";

describe("commands/init", () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kodall-init-cmd-test-"));
    configPath = path.join(tempDir, DEFAULT_CONFIG_FILENAME);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("handleInit should create single-environment configuration", async () => {
    vi.spyOn(prompts, "askText")
      .mockResolvedValueOnce("My Portal")
      .mockResolvedValueOnce("/portal")
      .mockResolvedValueOnce("./dist")
      .mockResolvedValueOnce("https://dev.kodall.ro")
      .mockResolvedValueOnce("dev-api-key");

    vi.spyOn(prompts, "askConfirm").mockResolvedValueOnce(false); // multiEnv: false
    const succSpy = vi.spyOn(log, "success").mockImplementation(() => {});

    await handleInit(configPath);
    expect(succSpy).toHaveBeenCalledWith(expect.stringContaining("Configuration written to"));
    expect(fs.existsSync(configPath)).toBe(true);

    const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(cfg.web_app_name).toBe("My Portal");
    expect(cfg.environments.dev.api_key).toBe("dev-api-key");
    succSpy.mockRestore();
  });

  it("handleInit should create multi-environment configuration including custom environments", async () => {
    vi.spyOn(prompts, "askText")
      .mockResolvedValueOnce("Multi App")
      .mockResolvedValueOnce("/app")
      .mockResolvedValueOnce("./dist")
      // dev
      .mockResolvedValueOnce("https://dev.kodall.ro")
      .mockResolvedValueOnce("custom-path") // customPath
      .mockResolvedValueOnce("custom-dist") // customDist
      .mockResolvedValueOnce("dev-k") // apiKey
      // staging
      .mockResolvedValueOnce("https://staging.kodall.ro")
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("")
      // prod
      .mockResolvedValueOnce("https://app.kodall.ro")
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("")
      // custom env name
      .mockResolvedValueOnce("client-a")
      .mockResolvedValueOnce("custom-type") // custom type name
      .mockResolvedValueOnce("https://clienta.kodall.ro")
      .mockResolvedValueOnce("/client-a")
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("");

    vi.spyOn(prompts, "askConfirm")
      .mockResolvedValueOnce(true) // multiEnv: true
      .mockResolvedValueOnce(true) // staging: true
      .mockResolvedValueOnce(true) // prod: true
      .mockResolvedValueOnce(true) // add custom: true
      .mockResolvedValueOnce(false); // add another: false

    vi.spyOn(prompts, "askSelect")
      .mockResolvedValueOnce("dev") // dev type
      .mockResolvedValueOnce("staging") // staging type
      .mockResolvedValueOnce("prod") // prod type
      .mockResolvedValueOnce("custom") // client-a type
      .mockResolvedValueOnce("dev"); // default env

    const succSpy = vi.spyOn(log, "success").mockImplementation(() => {});

    await handleInit(configPath);
    expect(succSpy).toHaveBeenCalledWith(expect.stringContaining("Multi-environment configuration written"));
    succSpy.mockRestore();
  });

  it("handleInit should support single env in multiEnv mode", async () => {
    vi.spyOn(prompts, "askText")
      .mockResolvedValueOnce("Single App")
      .mockResolvedValueOnce("/app")
      .mockResolvedValueOnce("./dist")
      .mockResolvedValueOnce("https://dev.kodall.ro")
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("");

    vi.spyOn(prompts, "askConfirm")
      .mockResolvedValueOnce(true) // multiEnv: true
      .mockResolvedValueOnce(false) // staging: false
      .mockResolvedValueOnce(false) // prod: false
      .mockResolvedValueOnce(false); // add custom: false

    vi.spyOn(prompts, "askSelect")
      .mockResolvedValueOnce("dev"); // dev type

    const succSpy = vi.spyOn(log, "success").mockImplementation(() => {});
    await handleInit(configPath);
    expect(succSpy).toHaveBeenCalledWith(expect.stringContaining("Multi-environment configuration written"));
    succSpy.mockRestore();
  });

  it("handleInit should offer to update existing config file or overwrite", async () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        web_app_name: "test-app",
        web_app_path: "/test-app",
        dist_path: "./dist",
        default_env: "dev",
        environments: { dev: { instance: "https://dev.kodall.ro" } },
      })
    );

    vi.spyOn(prompts, "askSelect")
      .mockResolvedValueOnce("Add / update an environment")
      .mockResolvedValueOnce("dev") // select existing dev
      .mockResolvedValueOnce("dev"); // select type dev

    vi.spyOn(prompts, "askText")
      .mockResolvedValueOnce("https://dev.kodall.ro")
      .mockResolvedValueOnce("/app")
      .mockResolvedValueOnce("key")
      .mockResolvedValueOnce("./dist");

    await handleInit(configPath);

    // Overwrite path
    vi.spyOn(prompts, "askSelect")
      .mockResolvedValueOnce("Re-initialize / overwrite configuration");
    vi.spyOn(prompts, "askText")
      .mockResolvedValueOnce("Overwritten App")
      .mockResolvedValueOnce("/overwritten")
      .mockResolvedValueOnce("./dist")
      .mockResolvedValueOnce("https://dev.kodall.ro")
      .mockResolvedValueOnce("");
    vi.spyOn(prompts, "askConfirm").mockResolvedValueOnce(false);

    await handleInit(configPath);
  });
});
