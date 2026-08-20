import { DEFAULT_CONFIG_FILENAME, loadConfigFile, saveConfigFile } from "./config.js";
import type { EnvironmentConfig, WebAppConfigFile } from "./types.js";

export interface EnvironmentInfo {
  name: string;
  isDefault: boolean;
  type: string;
  instance: string;
  webAppName: string;
  webAppPath: string;
  distPath: string;
  hasApiKey: boolean;
}

/**
 * Returns a list of all configured environments with resolved properties
 */
export function listEnvironments(
  configPath: string = DEFAULT_CONFIG_FILENAME,
  cwd: string = process.cwd()
): EnvironmentInfo[] {
  const { config } = loadConfigFile(configPath, cwd);
  const globalName = config.web_app_name || "app";
  const globalPath = config.web_app_path || (globalName.startsWith("/") ? globalName : `/${globalName}`);
  const globalDist = config.dist_path || "./dist";
  const defaultEnv = config.default_env;

  const result: EnvironmentInfo[] = [];

  if (config.environments && Object.keys(config.environments).length > 0) {
    for (const [name, envData] of Object.entries(config.environments)) {
      const type =
        envData.type ||
        (name.includes("prod")
          ? "prod"
          : name.includes("staging")
          ? "staging"
          : name.includes("dev")
          ? "dev"
          : "custom");

      const instance = envData.instance || config.instance || "";
      const webAppName = envData.web_app_name || globalName;
      const webAppPath = envData.web_app_path || globalPath;
      const distPath = envData.dist_path || globalDist;
      const hasApiKey = Boolean(envData.api_key || config.api_key);
      const isDefault = name === defaultEnv;

      result.push({
        name,
        isDefault,
        type,
        instance,
        webAppName,
        webAppPath,
        distPath,
        hasApiKey,
      });
    }
  } else if (config.instance) {
    // Legacy single environment
    result.push({
      name: "default",
      isDefault: true,
      type: "custom",
      instance: config.instance,
      webAppName: globalName,
      webAppPath: globalPath,
      distPath: globalDist,
      hasApiKey: Boolean(config.api_key),
    });
  }

  return result;
}

/**
 * Removes an environment from the configuration file
 */
export function removeEnvironment(
  envName: string,
  configPath: string = DEFAULT_CONFIG_FILENAME,
  cwd: string = process.cwd()
): { success: boolean; newDefault?: string } {
  const { fileExists, config } = loadConfigFile(configPath, cwd);
  if (!fileExists || !config.environments || !config.environments[envName]) {
    throw new Error(`Environment "${envName}" not found in ${configPath}`);
  }

  delete config.environments[envName];

  let newDefault = config.default_env;
  if (config.default_env === envName) {
    const remainingEnvs = Object.keys(config.environments);
    newDefault = remainingEnvs.length > 0 ? remainingEnvs[0] : undefined;
    config.default_env = newDefault;
  }

  saveConfigFile(configPath, config, cwd);
  return { success: true, newDefault };
}

/**
 * Clones an existing environment to a new target environment name
 */
export function cloneEnvironment(
  sourceName: string,
  targetName: string,
  overrides: Partial<EnvironmentConfig> = {},
  configPath: string = DEFAULT_CONFIG_FILENAME,
  cwd: string = process.cwd()
): WebAppConfigFile {
  const { fileExists, config } = loadConfigFile(configPath, cwd);
  if (!fileExists) {
    throw new Error(`Configuration file ${configPath} does not exist`);
  }

  if (!config.environments || !config.environments[sourceName]) {
    throw new Error(`Source environment "${sourceName}" not found in ${configPath}`);
  }

  if (!config.environments) {
    config.environments = {};
  }

  if (config.environments[targetName]) {
    throw new Error(`Target environment "${targetName}" already exists in ${configPath}`);
  }

  const sourceData = config.environments[sourceName];
  const clonedData: EnvironmentConfig = {
    ...sourceData,
    ...overrides,
  };

  config.environments[targetName] = clonedData;
  saveConfigFile(configPath, config, cwd);
  return config;
}

/**
 * Sets the default environment in the configuration file
 */
export function setDefaultEnvironment(
  envName: string,
  configPath: string = DEFAULT_CONFIG_FILENAME,
  cwd: string = process.cwd()
): WebAppConfigFile {
  const { fileExists, config } = loadConfigFile(configPath, cwd);
  if (!fileExists) {
    throw new Error(`Configuration file ${configPath} does not exist`);
  }

  if (!config.environments || !config.environments[envName]) {
    throw new Error(`Environment "${envName}" not found in ${configPath}`);
  }

  config.default_env = envName;
  saveConfigFile(configPath, config, cwd);
  return config;
}
