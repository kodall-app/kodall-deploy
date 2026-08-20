import * as fs from "node:fs";
import * as path from "node:path";
import type {
  CIProvider,
  CIWorkflowOptions,
  CIWorkflowResult,
  PackageManagerType,
} from "./types.js";

/**
 * Auto-detects the project's package manager from lockfiles
 */
export function detectPackageManager(cwd: string = process.cwd()): PackageManagerType {
  if (fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (fs.existsSync(path.join(cwd, "yarn.lock"))) {
    return "yarn";
  }
  if (fs.existsSync(path.join(cwd, "bun.lockb"))) {
    return "bun";
  }
  return "npm";
}

/**
 * Detects if the repository already has configuration for a specific CI provider
 */
export function detectExistingCIProvider(cwd: string = process.cwd()): CIProvider | undefined {
  if (fs.existsSync(path.join(cwd, ".github"))) {
    return "github";
  }
  if (fs.existsSync(path.join(cwd, ".gitlab-ci.yml"))) {
    return "gitlab";
  }
  if (fs.existsSync(path.join(cwd, "bitbucket-pipelines.yml"))) {
    return "bitbucket";
  }
  return undefined;
}

function getInstallCommand(pm: PackageManagerType): string {
  switch (pm) {
    case "pnpm":
      return "pnpm install --frozen-lockfile";
    case "yarn":
      return "yarn install --frozen-lockfile";
    case "bun":
      return "bun install --frozen-lockfile";
    case "npm":
    default:
      return "npm ci";
  }
}

function getBuildCommand(pm: PackageManagerType): string {
  switch (pm) {
    case "pnpm":
      return "pnpm run build";
    case "yarn":
      return "yarn build";
    case "bun":
      return "bun run build";
    case "npm":
    default:
      return "npm run build";
  }
}

/**
 * Generates a GitHub Actions workflow YAML string
 */
export function generateGitHubActionsWorkflow(options: CIWorkflowOptions): string {
  const pm = options.packageManager || "npm";
  const nodeVersion = options.nodeVersion || "20";
  const branches = Array.from(new Set(options.mappings.map((m) => m.branch)));
  const installCmd = getInstallCommand(pm);
  const buildCmd = getBuildCommand(pm);
  const title = options.workflowName || "Deploy to ONE Framework";

  const branchCases = options.mappings
    .map((m) => `          "${m.branch}") npx kodall-one-deploy --ci -e ${m.envName} ;;`)
    .join("\n");

  return `name: ${title}

on:
  push:
    branches: [${branches.map((b) => `"${b}"`).join(", ")}]

jobs:
  deploy:
    name: Build & Deploy
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js ${nodeVersion}
        uses: actions/setup-node@v4
        with:
          node-version: ${nodeVersion}
          ${pm !== "bun" ? `cache: "${pm}"` : ""}

      - name: Install dependencies
        run: ${installCmd}

      - name: Build web application
        run: ${buildCmd}

      - name: Deploy to ONE Framework / Kodall
        env:
          ONE_API_KEY: \${{ secrets.ONE_API_KEY }}
          ONE_INSTANCE: \${{ secrets.ONE_INSTANCE }}
        run: |
          case "\${{ github.ref_name }}" in
${branchCases}
            *) echo "No deployment mapping found for branch \${{ github.ref_name }}" && exit 1 ;;
          esac
`;
}

/**
 * Generates a GitLab CI YAML string
 */
export function generateGitLabCIWorkflow(options: CIWorkflowOptions): string {
  const pm = options.packageManager || "npm";
  const nodeVersion = options.nodeVersion || "20";
  const installCmd = getInstallCommand(pm);
  const buildCmd = getBuildCommand(pm);

  const jobs = options.mappings.map((m) => {
    return `deploy-${m.envName}:
  stage: deploy
  only:
    - ${m.branch}
  script:
    - ${installCmd}
    - ${buildCmd}
    - npx kodall-one-deploy --ci -e ${m.envName}
  variables:
    ONE_API_KEY: $ONE_API_KEY
    ONE_INSTANCE: $ONE_INSTANCE
`;
  });

  return `image: node:${nodeVersion}

stages:
  - deploy

${jobs.join("\n")}
`;
}

/**
 * Generates a Bitbucket Pipelines YAML string
 */
export function generateBitbucketPipelinesWorkflow(options: CIWorkflowOptions): string {
  const pm = options.packageManager || "npm";
  const nodeVersion = options.nodeVersion || "20";
  const installCmd = getInstallCommand(pm);
  const buildCmd = getBuildCommand(pm);

  const branchSteps = options.mappings.map((m) => {
    return `    ${m.branch}:
      - step:
          name: Deploy to ${m.envName}
          script:
            - ${installCmd}
            - ${buildCmd}
            - npx kodall-one-deploy --ci -e ${m.envName}`;
  });

  return `image: node:${nodeVersion}

pipelines:
  branches:
${branchSteps.join("\n")}
`;
}

/**
 * Generates and writes the CI workflow file to the target repository
 */
export function generateCIWorkflow(
  options: CIWorkflowOptions,
  cwd: string = process.cwd()
): CIWorkflowResult {
  const pm = options.packageManager || detectPackageManager(cwd);
  const optsWithDefaults: CIWorkflowOptions = {
    ...options,
    packageManager: pm,
    nodeVersion: options.nodeVersion || "20",
  };

  let relativePath = "";
  let content = "";

  switch (options.provider) {
    case "github":
      relativePath = path.join(".github", "workflows", "one-deploy.yml");
      content = generateGitHubActionsWorkflow(optsWithDefaults);
      break;
    case "gitlab":
      relativePath = ".gitlab-ci.yml";
      content = generateGitLabCIWorkflow(optsWithDefaults);
      break;
    case "bitbucket":
      relativePath = "bitbucket-pipelines.yml";
      content = generateBitbucketPipelinesWorkflow(optsWithDefaults);
      break;
    default:
      throw new Error(`Unsupported CI provider: ${options.provider}`);
  }

  const fullPath = path.resolve(cwd, relativePath);
  const targetDir = path.dirname(fullPath);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  fs.writeFileSync(fullPath, content, "utf-8");

  const secrets = ["ONE_API_KEY", "ONE_INSTANCE"];

  return {
    provider: options.provider,
    filePath: relativePath.replace(/\\/g, "/"),
    content,
    secrets,
  };
}
