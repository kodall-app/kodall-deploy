import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULT_CONFIG_FILENAME, loadConfigFile, saveConfigFile } from "./config.js";
import { ensureGitIgnoreEntry, getHistoryDir } from "./history.js";
import type { EnvironmentConfig, WebAppConfigFile } from "./types.js";

export const ACTIVE_ENV_FILENAME = "active-env";

export interface EnvironmentInfo {
  name: string;
  isDefault: boolean;
  isActiveProxy?: boolean;
  type: string;
  instance: string;
  webAppName: string;
  webAppPath: string;
  distPath: string;
  hasApiKey: boolean;
}

/**
 * Resolve path to the active-env file in the local state directory (.kodall-deploy/active-env)
 */
export function getActiveEnvFilePath(cwd: string = process.cwd()): string {
  return path.resolve(getHistoryDir(cwd), ACTIVE_ENV_FILENAME);
}

/**
 * Returns the locally active proxy environment from .kodall-deploy/active-env if set
 */
export function getActiveEnvironment(cwd: string = process.cwd()): string | undefined {
  const filePath = getActiveEnvFilePath(cwd);
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, "utf-8").trim();
      return content || undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Sets the locally active proxy environment in .kodall-deploy/active-env without mutating kodall-webapp.config.json
 */
export function setActiveEnvironment(
  envName: string,
  cwd: string = process.cwd(),
  configPath: string = DEFAULT_CONFIG_FILENAME
): void {
  const { fileExists, config } = loadConfigFile(configPath, cwd);
  if (fileExists && config.environments && Object.keys(config.environments).length > 0) {
    if (!config.environments[envName]) {
      const available = Object.keys(config.environments).join(", ");
      throw new Error(`Environment "${envName}" not found in ${configPath}. Available: ${available}`);
    }
  }

  ensureGitIgnoreEntry(cwd);
  const dir = getHistoryDir(cwd);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filePath = getActiveEnvFilePath(cwd);
  fs.writeFileSync(filePath, envName.trim(), "utf-8");
}

/**
 * Clears the locally active proxy environment override
 */
export function clearActiveEnvironment(cwd: string = process.cwd()): void {
  const filePath = getActiveEnvFilePath(cwd);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch {}
  }
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
  const activeProxyEnv = getActiveEnvironment(cwd) || config.default_proxy_env || defaultEnv;

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

      const instance = envData.instance || "";
      const webAppName = envData.web_app_name || globalName;
      const webAppPath = envData.web_app_path || globalPath;
      const distPath = envData.dist_path || globalDist;
      const hasApiKey = Boolean(envData.api_key);
      const isDefault = name === defaultEnv;
      const isActiveProxy = name === activeProxyEnv;

      result.push({
        name,
        isDefault,
        isActiveProxy,
        type,
        instance,
        webAppName,
        webAppPath,
        distPath,
        hasApiKey,
      });
    }
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
