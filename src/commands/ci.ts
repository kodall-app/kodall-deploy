import * as fs from "node:fs";
import * as path from "node:path";
import { detectPackageManager, generateCIWorkflow } from "../core/ci-generator.js";
import { loadConfigFile } from "../core/config.js";
import { CIEnvironmentMapping, CIProvider } from "../core/types.js";
import { bold, cyan, dim, green, log } from "../ui/logger.js";
import { askSelect, askText } from "../ui/prompts.js";

/**
 * Detect which CI system configuration file already exists in the repository
 */
export function detectExistingCIProvider(cwd: string = process.cwd()): CIProvider | undefined {
  if (
    fs.existsSync(path.join(cwd, ".github", "workflows")) ||
    fs.existsSync(path.join(cwd, ".github"))
  ) {
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
  if (fs.existsSync(path.join(cwd, ".circleci", "config.yml"))) {
    return "circleci";
  }
  if (fs.existsSync(path.join(cwd, "buildspec.yml"))) {
    return "aws";
  }
  return undefined;
}

export async function handleInitCI(configPath: string): Promise<void> {
  console.log(bold("\nGenerate CI/CD Deployment Workflow:\n"));

  const detectedProvider = detectExistingCIProvider(process.cwd());
  const detectedPM = detectPackageManager(process.cwd());

  if (detectedProvider) {
    const PROVIDER_NAMES: Record<CIProvider, string> = {
      github: "GitHub Actions",
      gitlab: "GitLab CI",
      bitbucket: "Bitbucket Pipelines",
      jenkins: "Jenkins",
      azure: "Azure DevOps",
      circleci: "CircleCI",
      aws: "AWS CodeBuild",
    };
    const detectedName = PROVIDER_NAMES[detectedProvider] || "CI Provider";
    console.log(dim(`  ${cyan("ℹ")} Detected existing CI configuration: ${bold(detectedName)}\n`));
  }

  const allProviders: Array<{ id: CIProvider; label: string }> = [
    { id: "github", label: "GitHub Actions (.github/workflows/kodall-deploy.yml)" },
    { id: "gitlab", label: "GitLab CI (.gitlab-ci.yml)" },
    { id: "bitbucket", label: "Bitbucket Pipelines (bitbucket-pipelines.yml)" },
    { id: "jenkins", label: "Jenkins (Jenkinsfile)" },
    { id: "azure", label: "Azure DevOps Pipelines (azure-pipelines.yml)" },
    { id: "circleci", label: "CircleCI (.circleci/config.yml)" },
    { id: "aws", label: "AWS CodeBuild (buildspec.yml)" },
  ];

  // If a provider is detected in the repo, move it to the top (index 0)
  if (detectedProvider) {
    const idx = allProviders.findIndex((p) => p.id === detectedProvider);
    if (idx > 0) {
      const [detectedItem] = allProviders.splice(idx, 1);
      detectedItem.label = `${detectedItem.label} (Detected)`;
      allProviders.unshift(detectedItem);
    }
  }

  const providerChoices = allProviders.map((p) => p.label);

  const chosenProviderStr = await askSelect(
    "Select your CI/CD platform:",
    providerChoices,
    0
  );

  let provider: CIProvider = "github";
  if (chosenProviderStr.startsWith("GitLab")) provider = "gitlab";
  else if (chosenProviderStr.startsWith("Bitbucket")) provider = "bitbucket";
  else if (chosenProviderStr.startsWith("Jenkins")) provider = "jenkins";
  else if (chosenProviderStr.startsWith("Azure")) provider = "azure";
  else if (chosenProviderStr.startsWith("CircleCI")) provider = "circleci";
  else if (chosenProviderStr.startsWith("AWS")) provider = "aws";

  const { fileExists, config } = loadConfigFile(configPath);
  const envKeys = config.environments ? Object.keys(config.environments) : [];

  if (!fileExists || envKeys.length === 0) {
    log.error(`No environments found in ${configPath}. Please run "kodall-deploy --init" first.`);
    return;
  }

  console.log(
    dim("\nMap Git branches to environments for automated CI deployment:") +
    dim("\n(Enter branch name like 'main' or 'develop'. Press Enter on blank or type 'skip' to exclude an environment)\n")
  );
  const mappings: CIEnvironmentMapping[] = [];

  for (const envName of envKeys) {
    const defaultBranch =
      envName.toLowerCase() === "prod" || envName.toLowerCase() === "production"
        ? "main"
        : envName.toLowerCase() === "staging" || envName.toLowerCase() === "stage"
        ? "staging"
        : envName.toLowerCase() === "dev"
        ? "develop"
        : undefined;

    const branch = await askText(
      `Git branch for "${envName}"`,
      defaultBranch,
      false
    );

    if (
      branch &&
      branch.trim() &&
      branch.trim().toLowerCase() !== "skip" &&
      branch.trim().toLowerCase() !== "none"
    ) {
      mappings.push({ envName, branch: branch.trim() });
    }
  }

  if (mappings.length === 0) {
    log.warn("No branches configured. Deployment workflow generation cancelled.");
    return;
  }

  const result = generateCIWorkflow(
    {
      provider,
      mappings,
      packageManager: detectedPM,
    },
    process.cwd()
  );

  console.log("");
  log.success(bold(green(`CI/CD workflow file created at ${result.filePath}!`)));
  console.log("");
  console.log(bold(cyan("🔑 Required CI/CD Repository Secrets:")));
  console.log(dim("  Configure these environment variables / secrets in your repository settings:"));
  console.log(`    ${cyan("▸")} ${bold("KODALL_API_KEY")}:   Your Kodall API authentication key (or ONE_API_KEY)`);
  const sampleInstance =
    (config.default_env && config.environments?.[config.default_env]?.instance) ||
    (config.environments && Object.values(config.environments)[0]?.instance) ||
    "https://instance.kodall.ro";
  console.log(`    ${cyan("▸")} ${bold("KODALL_INSTANCE")}: Base instance URL (e.g. ${sampleInstance}) (or ONE_INSTANCE)`);
  console.log("");
}
