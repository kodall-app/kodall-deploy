import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectExistingCIProvider, handleInitCI } from "../src/commands/ci.js";
import { DEFAULT_CONFIG_FILENAME } from "../src/core/config.js";
import { log } from "../src/ui/logger.js";
import * as prompts from "../src/ui/prompts.js";

describe("commands/ci", () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kodall-ci-cmd-test-"));
    configPath = path.join(tempDir, DEFAULT_CONFIG_FILENAME);
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("detectExistingCIProvider should detect all provider files", () => {
    expect(detectExistingCIProvider(tempDir)).toBeUndefined();

    const gitlabFile = path.join(tempDir, ".gitlab-ci.yml");
    fs.writeFileSync(gitlabFile, "test");
    expect(detectExistingCIProvider(tempDir)).toBe("gitlab");
    fs.unlinkSync(gitlabFile);

    const bbFile = path.join(tempDir, "bitbucket-pipelines.yml");
    fs.writeFileSync(bbFile, "test");
    expect(detectExistingCIProvider(tempDir)).toBe("bitbucket");
    fs.unlinkSync(bbFile);

    const jFile = path.join(tempDir, "Jenkinsfile");
    fs.writeFileSync(jFile, "test");
    expect(detectExistingCIProvider(tempDir)).toBe("jenkins");
    fs.unlinkSync(jFile);

    const azFile = path.join(tempDir, "azure-pipelines.yml");
    fs.writeFileSync(azFile, "test");
    expect(detectExistingCIProvider(tempDir)).toBe("azure");
    fs.unlinkSync(azFile);

    const circleDir = path.join(tempDir, ".circleci");
    fs.mkdirSync(circleDir, { recursive: true });
    fs.writeFileSync(path.join(circleDir, "config.yml"), "test");
    expect(detectExistingCIProvider(tempDir)).toBe("circleci");
    fs.rmSync(circleDir, { recursive: true });

    const awsFile = path.join(tempDir, "buildspec.yml");
    fs.writeFileSync(awsFile, "test");
    expect(detectExistingCIProvider(tempDir)).toBe("aws");
    fs.unlinkSync(awsFile);

    const ghDir = path.join(tempDir, ".github", "workflows");
    fs.mkdirSync(ghDir, { recursive: true });
    expect(detectExistingCIProvider(tempDir)).toBe("github");
  });

  it("handleInitCI should handle all detected provider notifications", async () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        environments: { dev: { instance: "https://dev.kodall.ro" } },
      })
    );

    const providers = [
      { file: ".gitlab-ci.yml", isDir: false },
      { file: "bitbucket-pipelines.yml", isDir: false },
      { file: "Jenkinsfile", isDir: false },
      { file: "azure-pipelines.yml", isDir: false },
      { file: ".circleci/config.yml", isDir: true },
      { file: "buildspec.yml", isDir: false },
      { file: ".github/workflows", isDir: true },
    ];

    for (const p of providers) {
      const targetPath = path.join(tempDir, p.file);
      if (p.isDir) {
        fs.mkdirSync(targetPath, { recursive: true });
      } else {
        fs.writeFileSync(targetPath, "test");
      }

      vi.spyOn(prompts, "askSelect").mockResolvedValueOnce("GitHub Actions (.github/workflows/kodall-deploy.yml)");
      vi.spyOn(prompts, "askText").mockResolvedValueOnce("main");
      await handleInitCI(configPath);

      if (p.isDir) {
        fs.rmSync(path.join(tempDir, p.file.split("/")[0]), { recursive: true, force: true });
      } else {
        fs.unlinkSync(targetPath);
      }
    }
  });

  it("handleInitCI should handle missing config or empty envs", async () => {
    vi.spyOn(prompts, "askSelect").mockResolvedValueOnce("GitHub Actions (.github/workflows/kodall-deploy.yml)");
    const errSpy = vi.spyOn(log, "error").mockImplementation(() => {});
    await handleInitCI(path.join(tempDir, "non-existent.json"));
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("No environments found"));
    errSpy.mockRestore();
  });

  it("handleInitCI should generate workflow for detected provider and handle fallback sample instance", async () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        environments: {
          prod: { instance: "https://app.kodall.ro" },
          staging: { instance: "https://staging.kodall.ro" },
          dev: { instance: "https://dev.kodall.ro" },
          custom: { instance: "https://custom.kodall.ro" },
        },
      })
    );

    vi.spyOn(prompts, "askSelect").mockResolvedValueOnce("GitHub Actions (.github/workflows/kodall-deploy.yml)");
    vi.spyOn(prompts, "askText")
      .mockResolvedValueOnce("main")
      .mockResolvedValueOnce("staging")
      .mockResolvedValueOnce("develop")
      .mockResolvedValueOnce("custom-branch");

    const succSpy = vi.spyOn(log, "success").mockImplementation(() => {});
    await handleInitCI(configPath);
    expect(succSpy).toHaveBeenCalledWith(expect.stringContaining("CI/CD workflow file created"));
    succSpy.mockRestore();
  });

  it("handleInitCI should warn when all branches are skipped", async () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        environments: {
          dev: { instance: "https://dev.kodall.ro" },
        },
      })
    );

    vi.spyOn(prompts, "askSelect").mockResolvedValueOnce("GitLab CI (.gitlab-ci.yml)");
    vi.spyOn(prompts, "askText").mockResolvedValueOnce("none");

    const warnSpy = vi.spyOn(log, "warn").mockImplementation(() => {});
    await handleInitCI(configPath);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("No branches configured"));
    warnSpy.mockRestore();

    // Test fallback instance when no instances in config
    const noInstConfig = path.join(tempDir, "no-inst.json");
    fs.writeFileSync(
      noInstConfig,
      JSON.stringify({
        environments: {
          test: {},
        },
      })
    );
    vi.spyOn(prompts, "askSelect").mockResolvedValueOnce("GitHub Actions (.github/workflows/kodall-deploy.yml)");
    vi.spyOn(prompts, "askText").mockResolvedValueOnce("main");
    await handleInitCI(noInstConfig);
  });
});
