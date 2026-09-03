import { loadConfigFile, saveConfigFile } from "../core/config.js";
import { detectFramework } from "../core/detector.js";
import {
  clearActiveEnvironment,
  cloneEnvironment,
  EnvironmentInfo,
  getActiveEnvironment,
  listEnvironments,
  removeEnvironment,
  setActiveEnvironment,
  setDefaultEnvironment,
} from "../core/env-manager.js";
import { bold, cyan, dim, green, log, magenta, pad, red, yellow } from "../ui/logger.js";
import { askConfirm, askSelect, askText } from "../ui/prompts.js";

export function displayEnvsTable(envs: EnvironmentInfo[]): void {
  if (envs.length === 0) {
    console.log(yellow("\nNo environments configured. Run 'kodall-deploy --init' or '--add-env' to add one.\n"));
    return;
  }

  console.log(`\n${bold(cyan("⚙️  Configured Environments:"))}\n`);
  console.log(
    "  " +
      dim(
        pad("DEFAULT", 10) +
        pad("PROXY", 8) +
        pad("ENV NAME", 16) +
        pad("TYPE", 12) +
        pad("AUTH", 12) +
        pad("ROUTE PATH", 20) +
        "INSTANCE URL"
      )
  );
  console.log(dim("  " + "─".repeat(120)));

  for (const env of envs) {
    const defaultTag = env.isDefault ? green(bold("  ★")) : "";
    const proxyTag = env.isActiveProxy ? cyan(bold("  ▶")) : "";
    const nameStr = env.isActiveProxy
      ? bold(cyan(env.name))
      : env.isDefault
      ? bold(env.name)
      : env.name;
    const typeStr =
      env.type === "prod"
        ? red(env.type)
        : env.type === "staging"
        ? yellow(env.type)
        : cyan(env.type);

    const authStr = env.hasApiKey ? green("API Key") : dim("Username");
    const routeStr = env.webAppPath || "/";
    const instanceStr = env.instance || "-";

    console.log(
      "  " +
        pad(defaultTag, 10) +
        pad(proxyTag, 8) +
        pad(nameStr, 16) +
        pad(typeStr, 12) +
        pad(authStr, 12) +
        pad(routeStr, 20) +
        dim(instanceStr)
    );
  }
  console.log(dim("\n  Legend: ★ = Default Deployment Target, ▶ = Active Local Dev Proxy\n"));
}

export async function handleListEnvs(configPath: string): Promise<void> {
  const envs = listEnvironments(configPath);
  displayEnvsTable(envs);
}

export async function handleClearActive(): Promise<void> {
  clearActiveEnvironment(process.cwd());
  log.success("Cleared local dev proxy environment override. Reverted to config default.");
}

export async function handleUseEnv(
  configPath: string,
  envName?: string,
  saveConfig = false
): Promise<void> {
  const { fileExists, config } = loadConfigFile(configPath);
  if (!fileExists || !config.environments || Object.keys(config.environments).length === 0) {
    log.error(`No environments found in ${configPath}`);
    return;
  }

  const envKeys = Object.keys(config.environments);
  let target = envName;
  if (!target) {
    const activeLocal = getActiveEnvironment(process.cwd());
    const choices = envKeys.map((k) => {
      const inst = config.environments?.[k]?.instance || "";
      const tags: string[] = [];
      if (k === config.default_env) tags.push("deploy default");
      if (k === (activeLocal || config.default_env)) tags.push("active proxy");
      const tagStr = tags.length > 0 ? ` [${tags.join(", ")}]` : "";
      return inst ? `${k} (${inst})${tagStr}` : `${k}${tagStr}`;
    });
    const currentActive = activeLocal || config.default_env;
    const defaultIdx = currentActive ? Math.max(0, envKeys.indexOf(currentActive)) : 0;
    const selected = await askSelect("Select active development & proxy environment", choices, defaultIdx);
    const selectedIdx = choices.indexOf(selected);
    target = envKeys[selectedIdx];
  }

  if (!config.environments[target]) {
    log.error(`Environment "${target}" does not exist in ${configPath}. Available: ${envKeys.join(", ")}`);
    return;
  }

  setActiveEnvironment(target, process.cwd(), configPath);
  if (saveConfig) {
    setDefaultEnvironment(target, configPath);
  }

  const targetInstance = config.environments[target]?.instance || "";
  const modeNote = saveConfig ? " (saved to config file)" : " (local dev override)";
  log.success(
    `Active proxy environment set to ${bold(cyan(`"${target}"`))}${targetInstance ? ` (${magenta(targetInstance)})` : ""}${dim(modeNote)}`
  );
}

export async function handleSetDefault(configPath: string, envName?: string): Promise<void> {
  const { fileExists, config } = loadConfigFile(configPath);
  if (!fileExists || !config.environments || Object.keys(config.environments).length === 0) {
    log.error(`No environments found in ${configPath}`);
    return;
  }

  const envKeys = Object.keys(config.environments);
  let target = envName;
  if (!target) {
    const choices = envKeys.map((k) => {
      const inst = config.environments?.[k]?.instance || "";
      return inst ? `${k} (${inst})` : k;
    });
    const defaultIdx = config.default_env ? Math.max(0, envKeys.indexOf(config.default_env)) : 0;
    const selected = await askSelect("Select default deployment environment (saved in config file)", choices, defaultIdx);
    const selectedIdx = choices.indexOf(selected);
    target = envKeys[selectedIdx];
  }

  if (!config.environments[target]) {
    log.error(`Environment "${target}" does not exist in ${configPath}. Available: ${envKeys.join(", ")}`);
    return;
  }

  setDefaultEnvironment(target, configPath);
  const targetInstance = config.environments[target]?.instance || "";
  log.success(
    `Default deployment environment set to ${bold(cyan(`"${target}"`))}${targetInstance ? ` (${magenta(targetInstance)})` : ""} in ${configPath}`
  );
}

export async function handleAddEnv(configPath: string, initialEnvName?: string): Promise<void> {
  const { fileExists, config } = loadConfigFile(configPath);

  if (!fileExists) {
    console.log(yellow(`No ${configPath} found. Creating a new multi-environment configuration.`));
  }

  let envName = initialEnvName;
  const existingEnvs = config.environments ? Object.keys(config.environments) : [];

  if (!envName) {
    if (existingEnvs.length > 0) {
      const NEW_OPTION = "➕ Add new environment...";
      const selected = await askSelect(
        "Select an existing environment to edit or add a new one",
        [...existingEnvs, NEW_OPTION]
      );

      if (selected === NEW_OPTION) {
        envName = await askText("Environment name (e.g. uat, client-a, prod-eu)");
      } else {
        envName = selected;
      }
    } else {
      envName = await askText("Environment name to add (e.g. dev, staging, prod, client-a)");
    }
  }

  const existingData = config.environments?.[envName] || {};
  const typeChoices = ["dev", "staging", "prod", "test", "custom"];
  const inferredType =
    existingData.type ||
    (envName.toLowerCase().includes("prod")
      ? "prod"
      : envName.toLowerCase().includes("staging")
      ? "staging"
      : envName.toLowerCase().includes("dev")
      ? "dev"
      : "custom");

  const defaultIdx = Math.max(0, typeChoices.indexOf(inferredType));
  let envType = await askSelect(`Select environment type for "${envName}"`, typeChoices, defaultIdx);
  if (envType === "custom") {
    envType = await askText("Custom type name", existingData.type || "custom");
  }

  const instanceUrl = await askText(
    `Instance URL for "${envName}"`,
    existingData.instance || "https://dev.instance.kodall.ro"
  );

  const customPath = await askText(
    `Custom WebApp path for "${envName}" (press Enter to use "${config.web_app_path || "default"}")`,
    existingData.web_app_path,
    false
  );

  const apiKey = await askText(
    `API Key for "${envName}" (optional, press Enter to skip)`,
    existingData.api_key,
    false
  );

  const customDist = await askText(
    `Custom build path for "${envName}" (press Enter to use "${config.dist_path || "./dist"}")`,
    existingData.dist_path,
    false
  );

  if (!config.environments) {
    config.environments = {};
  }

  if (!config.web_app_name) {
    const detected = detectFramework(process.cwd());
    config.web_app_name = await askText("Global WebApp name", detected.appName || envName);
  }
  if (!config.web_app_path) {
    const defaultPath = config.web_app_name.startsWith("/") ? config.web_app_name : `/${config.web_app_name}`;
    config.web_app_path = await askText("Global WebApp path", defaultPath);
  }
  if (!config.dist_path) {
    const detected = detectFramework(process.cwd());
    config.dist_path = detected.distPath || "./dist";
  }
  if (!config.default_env) {
    config.default_env = envName;
  }

  config.environments[envName] = {
    ...(envType ? { type: envType } : {}),
    instance: instanceUrl,
    ...(customPath ? { web_app_path: customPath.startsWith("/") ? customPath : `/${customPath}` } : {}),
    ...(apiKey ? { api_key: apiKey } : {}),
    ...(customDist ? { dist_path: customDist } : {}),
  };

  saveConfigFile(configPath, config);
  console.log("");
  log.success(`Environment "${envName}" saved to ${configPath}!`);
}

export async function handleRemoveEnv(configPath: string, envName?: string): Promise<void> {
  const { fileExists, config } = loadConfigFile(configPath);
  if (!fileExists || !config.environments || Object.keys(config.environments).length === 0) {
    log.error(`No environments found in ${configPath}`);
    return;
  }

  let target = envName;
  const envKeys = Object.keys(config.environments);

  if (!target) {
    target = await askSelect("Select environment to remove", envKeys, 0);
  }

  if (!config.environments[target]) {
    log.error(`Environment "${target}" does not exist in ${configPath}`);
    return;
  }

  const confirm = await askConfirm(`Are you sure you want to delete environment "${target}"?`, false);
  if (!confirm) {
    log.info("Cancelled.");
    return;
  }

  const res = removeEnvironment(target, configPath);
  log.success(`Environment "${target}" removed from ${configPath}!`);
  if (res.newDefault) {
    log.info(`New default environment: "${res.newDefault}"`);
  }
}

export async function handleCloneEnv(
  configPath: string,
  sourceName?: string,
  targetName?: string
): Promise<void> {
  const { fileExists, config } = loadConfigFile(configPath);
  if (!fileExists || !config.environments || Object.keys(config.environments).length === 0) {
    log.error(`No environments found in ${configPath}`);
    return;
  }

  const envKeys = Object.keys(config.environments);
  let src = sourceName;
  if (!src) {
    src = await askSelect("Select source environment to clone", envKeys, 0);
  }

  if (!config.environments[src]) {
    log.error(`Source environment "${src}" does not exist in ${configPath}`);
    return;
  }

  let dst = targetName;
  if (!dst) {
    dst = await askText(`New environment name (cloned from "${src}")`);
  }

  if (config.environments[dst]) {
    log.error(`Target environment "${dst}" already exists in ${configPath}`);
    return;
  }

  const srcData = config.environments[src];
  const newInstance = await askText(`Instance URL for "${dst}"`, srcData.instance || "https://dev.instance.kodall.ro");
  const newPath = await askText(`URL route for "${dst}" (press Enter to inherit "${srcData.web_app_path || config.web_app_path || "/app"}")`, srcData.web_app_path, false);
  const newApiKey = await askText(`API Key for "${dst}" (optional, press Enter to inherit)`, srcData.api_key, false);

  cloneEnvironment(
    src,
    dst,
    {
      instance: newInstance,
      ...(newPath ? { web_app_path: newPath.startsWith("/") ? newPath : `/${newPath}` } : {}),
      ...(newApiKey ? { api_key: newApiKey } : {}),
    },
    configPath
  );

  log.success(`Environment "${dst}" created (cloned from "${src}") in ${configPath}!`);
}

export async function handleManageEnvs(configPath: string): Promise<void> {
  const BACK_OPTION = "Back";
  const choices = [
    "List configured environments",
    "Switch active proxy environment (local override)",
    "Set default deployment environment (config file)",
    "Add or edit an environment",
    "Remove an environment",
    "Clone / duplicate an environment",
    BACK_OPTION,
  ];

  while (true) {
    const action = await askSelect("Environment Management:", choices, 0);
    if (action === BACK_OPTION) {
      break;
    } else if (action === "List configured environments") {
      await handleListEnvs(configPath);
    } else if (action === "Switch active proxy environment (local override)") {
      await handleUseEnv(configPath);
    } else if (action === "Set default deployment environment (config file)") {
      await handleSetDefault(configPath);
    } else if (action === "Add or edit an environment") {
      await handleAddEnv(configPath);
    } else if (action === "Remove an environment") {
      await handleRemoveEnv(configPath);
    } else if (action === "Clone / duplicate an environment") {
      await handleCloneEnv(configPath);
    }
  }
}
