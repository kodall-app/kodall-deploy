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
  if (fs.existsSync(path.join(cwd, "Jenkinsfile"))) {
    return "jenkins";
  }
  if (fs.existsSync(path.join(cwd, "azure-pipelines.yml"))) {
    return "azure";
  }
  if (fs.existsSync(path.join(cwd, ".circleci"))) {
    return "circleci";
  }
  if (fs.existsSync(path.join(cwd, "buildspec.yml"))) {
    return "aws";
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
  const title = options.workflowName || "Deploy to Kodall";

  const branchCases = options.mappings
    .map((m) => `          "${m.branch}") npx kodall-deploy --ci -e ${m.envName} ;;`)
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

      - name: Deploy to Kodall
        env:
          KODALL_API_KEY: \${{ secrets.KODALL_API_KEY }}
          KODALL_INSTANCE: \${{ secrets.KODALL_INSTANCE }}
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
    - npx kodall-deploy --ci -e ${m.envName}
  variables:
    KODALL_API_KEY: $KODALL_API_KEY
    KODALL_INSTANCE: $KODALL_INSTANCE
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
            - npx kodall-deploy --ci -e ${m.envName}`;
  });

  return `image: node:${nodeVersion}

pipelines:
  branches:
${branchSteps.join("\n")}
`;
}

/**
 * Generates a Jenkinsfile Declarative Pipeline string
 */
export function generateJenkinsfileWorkflow(options: CIWorkflowOptions): string {
  const pm = options.packageManager || "npm";
  const nodeVersion = options.nodeVersion || "20";
  const installCmd = getInstallCommand(pm);
  const buildCmd = getBuildCommand(pm);

  const branchCases = options.mappings
    .map(
      (m) => `                        case "${m.branch}":
                            sh 'npx kodall-deploy --ci -e ${m.envName}'
                            break`
    )
    .join("\n");

  return `pipeline {
    agent any

    tools {
        nodejs 'NodeJS ${nodeVersion}'
    }

    environment {
        KODALL_API_KEY = credentials('KODALL_API_KEY')
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Install & Build') {
            steps {
                sh '${installCmd}'
                sh '${buildCmd}'
            }
        }

        stage('Deploy to Kodall') {
            steps {
                script {
                    def targetBranch = env.BRANCH_NAME ?: env.GIT_BRANCH?.replaceAll('^origin/', '')
                    switch (targetBranch) {
${branchCases}
                        default:
                            echo "No deployment mapping configured for branch \${targetBranch}"
                            break
                    }
                }
            }
        }
    }
}
`;
}

/**
 * Generates an Azure DevOps Pipeline YAML string
 */
export function generateAzureDevOpsWorkflow(options: CIWorkflowOptions): string {
  const pm = options.packageManager || "npm";
  const nodeVersion = options.nodeVersion || "20";
  const branches = Array.from(new Set(options.mappings.map((m) => m.branch)));
  const installCmd = getInstallCommand(pm);
  const buildCmd = getBuildCommand(pm);

  const branchCases = options.mappings
    .map((m) => `          "${m.branch}") npx kodall-deploy --ci -e ${m.envName} ;;`)
    .join("\n");

  return `trigger:
  branches:
    include:
${branches.map((b) => `      - ${b}`).join("\n")}

pool:
  vmImage: 'ubuntu-latest'

variables:
  - group: KODALL_DEPLOY_SECRETS

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '${nodeVersion}.x'
    displayName: 'Install Node.js ${nodeVersion}'

  - script: |
      ${installCmd}
    displayName: 'Install Dependencies'

  - script: |
      ${buildCmd}
    displayName: 'Build Web Application'

  - script: |
      case "$(Build.SourceBranchName)" in
${branchCases}
        *) echo "No deployment mapping for branch $(Build.SourceBranchName)" && exit 1 ;;
      esac
    displayName: 'Deploy to Kodall'
    env:
      KODALL_API_KEY: $(KODALL_API_KEY)
      KODALL_INSTANCE: $(KODALL_INSTANCE)
`;
}

/**
 * Generates a CircleCI 2.1 YAML configuration string
 */
export function generateCircleCIWorkflow(options: CIWorkflowOptions): string {
  const pm = options.packageManager || "npm";
  const nodeVersion = options.nodeVersion || "20";
  const branches = Array.from(new Set(options.mappings.map((m) => m.branch)));
  const installCmd = getInstallCommand(pm);
  const buildCmd = getBuildCommand(pm);

  const branchCases = options.mappings
    .map((m) => `              "${m.branch}") npx kodall-deploy --ci -e ${m.envName} ;;`)
    .join("\n");

  return `version: 2.1

executors:
  node-executor:
    docker:
      - image: cimg/node:${nodeVersion}.0
    working_directory: ~/repo

jobs:
  build-and-deploy:
    executor: node-executor
    steps:
      - checkout
      - run:
          name: Install Dependencies
          command: ${installCmd}
      - run:
          name: Build Application
          command: ${buildCmd}
      - run:
          name: Deploy to Kodall
          command: |
            case "$CIRCLE_BRANCH" in
${branchCases}
              *) echo "No deployment mapping for branch $CIRCLE_BRANCH" && exit 1 ;;
            esac

workflows:
  version: 2
  deploy-pipeline:
    jobs:
      - build-and-deploy:
          filters:
            branches:
              only:
${branches.map((b) => `                - ${b}`).join("\n")}
`;
}

/**
 * Generates an AWS CodeBuild buildspec YAML string
 */
export function generateAWSCodeBuildWorkflow(options: CIWorkflowOptions): string {
  const pm = options.packageManager || "npm";
  const nodeVersion = options.nodeVersion || "20";
  const installCmd = getInstallCommand(pm);
  const buildCmd = getBuildCommand(pm);

  const branchCases = options.mappings
    .map((m) => `          "${m.branch}") npx kodall-deploy --ci -e ${m.envName} ;;`)
    .join("\n");

  return `version: 0.2

env:
  secrets-manager:
    KODALL_API_KEY: "kodall-deploy/credentials:KODALL_API_KEY"

phases:
  install:
    runtime-versions:
      nodejs: ${nodeVersion}
    commands:
      - ${installCmd}

  build:
    commands:
      - ${buildCmd}

  post_build:
    commands:
      - |
        BRANCH_NAME=$(echo $CODEBUILD_SOURCE_VERSION | sed 's/.*\\///')
        case "$BRANCH_NAME" in
${branchCases}
          *) echo "No deployment mapping for branch $BRANCH_NAME" ;;
        esac
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
      relativePath = path.join(".github", "workflows", "kodall-deploy.yml");
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
    case "jenkins":
      relativePath = "Jenkinsfile";
      content = generateJenkinsfileWorkflow(optsWithDefaults);
      break;
    case "azure":
      relativePath = "azure-pipelines.yml";
      content = generateAzureDevOpsWorkflow(optsWithDefaults);
      break;
    case "circleci":
      relativePath = path.join(".circleci", "config.yml");
      content = generateCircleCIWorkflow(optsWithDefaults);
      break;
    case "aws":
      relativePath = "buildspec.yml";
      content = generateAWSCodeBuildWorkflow(optsWithDefaults);
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

  const secrets = ["KODALL_API_KEY", "KODALL_INSTANCE"];

  return {
    provider: options.provider,
    filePath: relativePath.replace(/\\/g, "/"),
    content,
    secrets,
  };
}
