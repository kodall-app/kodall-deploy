import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectExistingCIProvider,
  detectPackageManager,
  generateAWSCodeBuildWorkflow,
  generateAzureDevOpsWorkflow,
  generateBitbucketPipelinesWorkflow,
  generateCircleCIWorkflow,
  generateCIWorkflow,
  generateGitHubActionsWorkflow,
  generateGitLabCIWorkflow,
  generateJenkinsfileWorkflow,
} from "../src/core/ci-generator.js";

describe("CI/CD Workflow Generator", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kodall-ci-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("detectPackageManager", () => {
    it("should detect pnpm from pnpm-lock.yaml", () => {
      fs.writeFileSync(path.join(tempDir, "pnpm-lock.yaml"), "lockfileVersion: 5.4");
      expect(detectPackageManager(tempDir)).toBe("pnpm");
    });

    it("should detect yarn from yarn.lock", () => {
      fs.writeFileSync(path.join(tempDir, "yarn.lock"), "# yarn lock");
      expect(detectPackageManager(tempDir)).toBe("yarn");
    });

    it("should detect bun from bun.lockb", () => {
      fs.writeFileSync(path.join(tempDir, "bun.lockb"), "");
      expect(detectPackageManager(tempDir)).toBe("bun");
    });

    it("should default to npm when no special lockfile exists", () => {
      expect(detectPackageManager(tempDir)).toBe("npm");
    });
  });

  describe("detectExistingCIProvider", () => {
    it("should detect GitHub Actions from .github folder", () => {
      fs.mkdirSync(path.join(tempDir, ".github"));
      expect(detectExistingCIProvider(tempDir)).toBe("github");
    });

    it("should detect GitLab CI from .gitlab-ci.yml", () => {
      fs.writeFileSync(path.join(tempDir, ".gitlab-ci.yml"), "stages: [deploy]");
      expect(detectExistingCIProvider(tempDir)).toBe("gitlab");
    });

    it("should detect Bitbucket from bitbucket-pipelines.yml", () => {
      fs.writeFileSync(path.join(tempDir, "bitbucket-pipelines.yml"), "pipelines: {}");
      expect(detectExistingCIProvider(tempDir)).toBe("bitbucket");
    });

    it("should detect Jenkins from Jenkinsfile", () => {
      fs.writeFileSync(path.join(tempDir, "Jenkinsfile"), "pipeline {}");
      expect(detectExistingCIProvider(tempDir)).toBe("jenkins");
    });

    it("should detect Azure DevOps from azure-pipelines.yml", () => {
      fs.writeFileSync(path.join(tempDir, "azure-pipelines.yml"), "trigger: []");
      expect(detectExistingCIProvider(tempDir)).toBe("azure");
    });

    it("should detect CircleCI from .circleci folder", () => {
      fs.mkdirSync(path.join(tempDir, ".circleci"));
      expect(detectExistingCIProvider(tempDir)).toBe("circleci");
    });

    it("should detect AWS CodeBuild from buildspec.yml", () => {
      fs.writeFileSync(path.join(tempDir, "buildspec.yml"), "version: 0.2");
      expect(detectExistingCIProvider(tempDir)).toBe("aws");
    });

    it("should return undefined when no CI config exists", () => {
      expect(detectExistingCIProvider(tempDir)).toBeUndefined();
    });
  });

  describe("generateGitHubActionsWorkflow", () => {
    it("should generate valid GitHub Actions workflow YAML", () => {
      const yaml = generateGitHubActionsWorkflow({
        provider: "github",
        mappings: [
          { envName: "dev", branch: "develop" },
          { envName: "prod", branch: "main" },
        ],
        packageManager: "npm",
        nodeVersion: "20",
      });

      expect(yaml).toContain('branches: ["develop", "main"]');
      expect(yaml).toContain("actions/checkout@v4");
      expect(yaml).toContain("actions/setup-node@v4");
      expect(yaml).toContain("npm ci");
      expect(yaml).toContain("npm run build");
      expect(yaml).toContain("KODALL_API_KEY: ${{ secrets.KODALL_API_KEY }}");
      expect(yaml).toContain('"develop") npx kodall-deploy --ci -e dev ;;');
      expect(yaml).toContain('"main") npx kodall-deploy --ci -e prod ;;');
    });

    it("should format bun and yarn commands properly", () => {
      const yarnYaml = generateGitHubActionsWorkflow({
        provider: "github",
        mappings: [{ envName: "dev", branch: "main" }],
        packageManager: "yarn",
      });
      expect(yarnYaml).toContain("yarn install --frozen-lockfile");
      expect(yarnYaml).toContain("yarn build");

      const bunYaml = generateGitHubActionsWorkflow({
        provider: "github",
        mappings: [{ envName: "dev", branch: "main" }],
        packageManager: "bun",
      });
      expect(bunYaml).toContain("bun install --frozen-lockfile");
      expect(bunYaml).toContain("bun run build");
    });
  });

  describe("generateGitLabCIWorkflow", () => {
    it("should generate valid GitLab CI YAML", () => {
      const yaml = generateGitLabCIWorkflow({
        provider: "gitlab",
        mappings: [
          { envName: "dev", branch: "develop" },
          { envName: "prod", branch: "main" },
        ],
        packageManager: "pnpm",
        nodeVersion: "20",
      });

      expect(yaml).toContain("image: node:20");
      expect(yaml).toContain("deploy-dev:");
      expect(yaml).toContain("- develop");
      expect(yaml).toContain("pnpm install --frozen-lockfile");
      expect(yaml).toContain("npx kodall-deploy --ci -e dev");
      expect(yaml).toContain("deploy-prod:");
      expect(yaml).toContain("- main");
      expect(yaml).toContain("npx kodall-deploy --ci -e prod");
    });
  });

  describe("generateBitbucketPipelinesWorkflow", () => {
    it("should generate valid Bitbucket Pipelines YAML", () => {
      const yaml = generateBitbucketPipelinesWorkflow({
        provider: "bitbucket",
        mappings: [{ envName: "dev", branch: "develop" }],
        packageManager: "npm",
        nodeVersion: "20",
      });

      expect(yaml).toContain("image: node:20");
      expect(yaml).toContain("pipelines:");
      expect(yaml).toContain("develop:");
      expect(yaml).toContain("npx kodall-deploy --ci -e dev");
    });
  });

  describe("generateJenkinsfileWorkflow", () => {
    it("should generate valid Jenkinsfile pipeline", () => {
      const jf = generateJenkinsfileWorkflow({
        provider: "jenkins",
        mappings: [
          { envName: "dev", branch: "develop" },
          { envName: "prod", branch: "main" },
        ],
        packageManager: "npm",
        nodeVersion: "20",
      });

      expect(jf).toContain("pipeline {");
      expect(jf).toContain("nodejs 'NodeJS 20'");
      expect(jf).toContain("KODALL_API_KEY = credentials('KODALL_API_KEY')");
      expect(jf).toContain("case \"develop\":");
      expect(jf).toContain("sh 'npx kodall-deploy --ci -e dev'");
      expect(jf).toContain("case \"main\":");
      expect(jf).toContain("sh 'npx kodall-deploy --ci -e prod'");
    });
  });

  describe("generateAzureDevOpsWorkflow", () => {
    it("should generate valid Azure DevOps pipeline YAML", () => {
      const yaml = generateAzureDevOpsWorkflow({
        provider: "azure",
        mappings: [{ envName: "prod", branch: "main" }],
        packageManager: "pnpm",
        nodeVersion: "20",
      });

      expect(yaml).toContain("trigger:");
      expect(yaml).toContain("- main");
      expect(yaml).toContain("vmImage: 'ubuntu-latest'");
      expect(yaml).toContain("task: NodeTool@0");
      expect(yaml).toContain("pnpm install --frozen-lockfile");
      expect(yaml).toContain('"main") npx kodall-deploy --ci -e prod ;;');
    });
  });

  describe("generateCircleCIWorkflow", () => {
    it("should generate valid CircleCI config YAML", () => {
      const yaml = generateCircleCIWorkflow({
        provider: "circleci",
        mappings: [{ envName: "dev", branch: "develop" }],
        packageManager: "npm",
        nodeVersion: "20",
      });

      expect(yaml).toContain("version: 2.1");
      expect(yaml).toContain("image: cimg/node:20.0");
      expect(yaml).toContain("npx kodall-deploy --ci -e dev");
      expect(yaml).toContain("- develop");
    });
  });

  describe("generateAWSCodeBuildWorkflow", () => {
    it("should generate valid AWS CodeBuild buildspec YAML", () => {
      const yaml = generateAWSCodeBuildWorkflow({
        provider: "aws",
        mappings: [{ envName: "staging", branch: "release/*" }],
        packageManager: "npm",
        nodeVersion: "20",
      });

      expect(yaml).toContain("version: 0.2");
      expect(yaml).toContain("nodejs: 20");
      expect(yaml).toContain("npx kodall-deploy --ci -e staging");
    });
  });

  describe("generateCIWorkflow", () => {
    it("should write .github/workflows/kodall-deploy.yml to filesystem", () => {
      const res = generateCIWorkflow(
        {
          provider: "github",
          mappings: [{ envName: "dev", branch: "main" }],
        },
        tempDir
      );

      expect(res.filePath).toBe(".github/workflows/kodall-deploy.yml");
      expect(fs.existsSync(path.join(tempDir, ".github", "workflows", "kodall-deploy.yml"))).toBe(true);
      expect(res.secrets).toContain("KODALL_API_KEY");
      expect(res.secrets).toContain("KODALL_INSTANCE");
    });

    it("should write .gitlab-ci.yml to filesystem", () => {
      const res = generateCIWorkflow(
        {
          provider: "gitlab",
          mappings: [{ envName: "prod", branch: "main" }],
        },
        tempDir
      );

      expect(res.filePath).toBe(".gitlab-ci.yml");
      expect(fs.existsSync(path.join(tempDir, ".gitlab-ci.yml"))).toBe(true);
    });

    it("should write bitbucket-pipelines.yml to filesystem", () => {
      const res = generateCIWorkflow(
        {
          provider: "bitbucket",
          mappings: [{ envName: "dev", branch: "develop" }],
        },
        tempDir
      );

      expect(res.filePath).toBe("bitbucket-pipelines.yml");
      expect(fs.existsSync(path.join(tempDir, "bitbucket-pipelines.yml"))).toBe(true);
    });

    it("should write Jenkinsfile to filesystem", () => {
      const res = generateCIWorkflow(
        {
          provider: "jenkins",
          mappings: [{ envName: "prod", branch: "main" }],
        },
        tempDir
      );

      expect(res.filePath).toBe("Jenkinsfile");
      expect(fs.existsSync(path.join(tempDir, "Jenkinsfile"))).toBe(true);
    });

    it("should write azure-pipelines.yml to filesystem", () => {
      const res = generateCIWorkflow(
        {
          provider: "azure",
          mappings: [{ envName: "prod", branch: "main" }],
        },
        tempDir
      );

      expect(res.filePath).toBe("azure-pipelines.yml");
      expect(fs.existsSync(path.join(tempDir, "azure-pipelines.yml"))).toBe(true);
    });

    it("should write .circleci/config.yml to filesystem", () => {
      const res = generateCIWorkflow(
        {
          provider: "circleci",
          mappings: [{ envName: "prod", branch: "main" }],
        },
        tempDir
      );

      expect(res.filePath).toBe(".circleci/config.yml");
      expect(fs.existsSync(path.join(tempDir, ".circleci", "config.yml"))).toBe(true);
    });

    it("should write buildspec.yml to filesystem", () => {
      const res = generateCIWorkflow(
        {
          provider: "aws",
          mappings: [{ envName: "prod", branch: "main" }],
        },
        tempDir
      );

      expect(res.filePath).toBe("buildspec.yml");
      expect(fs.existsSync(path.join(tempDir, "buildspec.yml"))).toBe(true);
    });

    it("should throw error on unsupported provider", () => {
      expect(() =>
        generateCIWorkflow(
          {
            provider: "unsupported" as any,
            mappings: [],
          },
          tempDir
        )
      ).toThrow("Unsupported CI provider");
    });
  });
});
