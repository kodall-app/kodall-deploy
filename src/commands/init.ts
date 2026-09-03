import { loadConfigFile, saveConfigFile } from "../core/config.js";
import { detectFramework } from "../core/detector.js";
import { WebAppConfigFile } from "../core/types.js";
import { bold, cyan, dim, green, log, yellow } from "../ui/logger.js";
import { askConfirm, askSelect, askText } from "../ui/prompts.js";
import { handleAddEnv } from "./envs.js";

export async function handleInit(configPath: string): Promise<void> {
  const { fileExists } = loadConfigFile(configPath);

  if (fileExists) {
    console.log(yellow(`Found existing configuration at ${configPath}.`));
    const action = await askSelect("What would you like to do?", [
      "Add / update an environment",
      "Re-initialize / overwrite configuration",
    ]);

    if (action === "Add / update an environment") {
      await handleAddEnv(configPath);
      return;
    }
  }

  console.log(bold("Initialize Kodall Deploy Configuration:\n"));

  const detected = detectFramework(process.cwd());
  console.log(
    dim("  " + "─".repeat(50)) + "\n" +
    `  ${cyan("ℹ")} ${bold("Detected Project:")}   ${bold(green(detected.framework))}\n` +
    `  ${cyan("▸")} ${dim("Suggested App Name:")} ${cyan(detected.appName)}\n` +
    `  ${cyan("▸")} ${dim("Build Output Path:")}  ${cyan(detected.distPath)}\n` +
    dim("  " + "─".repeat(50)) + "\n"
  );

  const webAppName = await askText("WebApp Name", detected.appName);
  const defaultPath = webAppName.startsWith("/") ? webAppName : `/${webAppName}`;
  const webAppPath = await askText("WebApp Path (URL route)", defaultPath);
  const distPath = await askText("Build Directory (containing index.html)", detected.distPath || "./dist");

  const multiEnv = await askConfirm("Do you want to configure multiple environments (dev, staging, prod, custom)?", true);

  if (!multiEnv) {
    const instance = await askText("Instance URL (e.g. https://instance.domain.com)");
    const apiKey = await askText("API Key (optional, press enter to skip)", undefined, false);

    const cfg: WebAppConfigFile = {
      web_app_name: webAppName,
      web_app_path: webAppPath,
      dist_path: distPath,
      default_env: "dev",
      environments: {
        dev: {
          type: "dev",
          instance,
          ...(apiKey ? { api_key: apiKey } : {}),
        },
      },
    };

    saveConfigFile(configPath, cfg);
    log.success(`Configuration written to ${configPath}`);
    return;
  }

  const envs: Record<string, any> = {};

  // Setup helper for an environment
  const configureEnv = async (envName: string, defaultUrl?: string, defaultType?: string) => {
    console.log(`\n${cyan(`▸ Configuring [${envName}] environment:`)}`);
    const typeChoices = ["dev", "staging", "prod", "test", "custom"];
    const inferredType = defaultType || (envName.toLowerCase().includes("prod") ? "prod" : envName.toLowerCase().includes("staging") ? "staging" : envName.toLowerCase().includes("dev") ? "dev" : "custom");
    const defaultIdx = Math.max(0, typeChoices.indexOf(inferredType));
    
    let envType = await askSelect(`Select environment type for "${envName}"`, typeChoices, defaultIdx);
    if (envType === "custom") {
      envType = await askText("Custom type name", "custom");
    }

    const instance = await askText(`Instance URL for "${envName}"`, defaultUrl);
    
    // Ask if custom path or inherit default
    const customPath = await askText(
      `Custom URL path for "${envName}" (press Enter to inherit "${webAppPath}")`,
      undefined,
      false
    );

    // Ask if custom build dist or inherit default
    const customDist = await askText(
      `Custom build directory for "${envName}" (press Enter to inherit "${distPath}")`,
      undefined,
      false
    );

    const apiKey = await askText(`API Key for "${envName}" (optional, press Enter to skip)`, undefined, false);

    envs[envName] = {
      ...(envType ? { type: envType } : {}),
      instance,
      ...(customPath ? { web_app_path: customPath.startsWith("/") ? customPath : `/${customPath}` } : {}),
      ...(customDist ? { dist_path: customDist } : {}),
      ...(apiKey ? { api_key: apiKey } : {}),
    };
  };

  // Configure dev
  await configureEnv("dev", "https://dev.instance.kodall.ro", "dev");

  // Configure staging
  const addStaging = await askConfirm("Add staging environment?", true);
  if (addStaging) {
    await configureEnv("staging", "https://staging.instance.kodall.ro", "staging");
  }

  // Configure prod
  const addProd = await askConfirm("Add prod environment?", true);
  if (addProd) {
    await configureEnv("prod", "https://app.instance.kodall.ro", "prod");
  }

  // Allow adding any additional custom environments
  while (true) {
    const addAnother = await askConfirm("Add another custom environment (e.g. client-a, qa, prod-eu)?", false);
    if (!addAnother) break;
    const customEnvName = await askText("Custom environment name");
    await configureEnv(customEnvName);
  }

  const envNames = Object.keys(envs);
  const defaultEnv = envNames.length > 1
    ? await askSelect("Select default deployment environment", envNames, 0)
    : envNames[0];

  const config: WebAppConfigFile = {
    web_app_name: webAppName,
    web_app_path: webAppPath,
    dist_path: distPath,
    default_env: defaultEnv,
    environments: envs,
  };

  saveConfigFile(configPath, config);
  console.log("");
  log.success(`Multi-environment configuration written to ${configPath}`);
}
