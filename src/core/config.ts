import * as fs from "node:fs";
import * as path from "node:path";
import { DeployOptions, EnvironmentConfig, ResolvedConfig, WebAppConfigFile } from "./types.js";

export const DEFAULT_CONFIG_FILENAME = "config_web_app.json";

/**
 * Load and parse config file if present
 */
export function loadConfigFile(
  configPath = DEFAULT_CONFIG_FILENAME,
  cwd = process.cwd()
): { fileExists: boolean; config: WebAppConfigFile } {
  const resolvedPath = path.isAbsolute(configPath)
    ? configPath
    : path.join(cwd, configPath);

  if (!fs.existsSync(resolvedPath)) {
    return { fileExists: false, config: {} };
  }

  try {
    const rawContent = fs.readFileSync(resolvedPath, "utf-8");
    const parsed = JSON.parse(rawContent);
    return { fileExists: true, config: parsed };
  } catch (error) {
    throw new Error(
      `Failed to parse config file at ${resolvedPath}: ${(error as Error).message}`
    );
  }
}

/**
 * Save or update config file
 */
export function saveConfigFile(
  configPath = DEFAULT_CONFIG_FILENAME,
  config: WebAppConfigFile,
  cwd = process.cwd()
): void {
  const resolvedPath = path.isAbsolute(configPath)
    ? configPath
    : path.join(cwd, configPath);

  fs.writeFileSync(resolvedPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/**
 * Find matching environment names by --all, --type, or comma-separated --env
 */
export function findTargetEnvironments(
  filter: { env?: string; type?: string; all?: boolean } = {},
  config: WebAppConfigFile = {}
): string[] {
  if (!config.environments) {
    return [];
  }

  const allEnvKeys = Object.keys(config.environments);
  if (allEnvKeys.length === 0) {
    return [];
  }

  if (filter.all) {
    return allEnvKeys;
  }

  if (filter.type) {
    const targetType = filter.type.toLowerCase();
    return allEnvKeys.filter((key) => {
      const envObj = config.environments![key];
      const envType = (
        envObj.type ||
        (["dev", "staging", "prod", "test"].includes(key.toLowerCase()) ? key : "")
      ).toLowerCase();
      return envType === targetType || key.toLowerCase() === targetType;
    });
  }

  if (filter.env) {
    if (filter.env.includes(",")) {
      return filter.env
        .split(",")
        .map((s) => s.trim())
        .filter((name) => allEnvKeys.includes(name));
    }
    return [filter.env];
  }

  return [];
}

/**
 * Resolve deployment parameters applying full priority hierarchy
 */
export function resolveConfig(
  options: DeployOptions = {},
  cwd = process.cwd()
): {
  resolved: Partial<ResolvedConfig>;
  missing: string[];
  availableEnvs: string[];
  targetEnv?: string;
  hasConfigFile: boolean;
} {
  const { fileExists, config } = loadConfigFile(options.configPath, cwd);

  const availableEnvs = config.environments
    ? Object.keys(config.environments)
    : [];

  // Determine target environment
  const targetEnv =
    options.env ||
    process.env.ONE_ENV ||
    process.env.KODALL_ENV ||
    config.default_env ||
    (availableEnvs.length === 1 ? availableEnvs[0] : undefined);

  const envOverrides: EnvironmentConfig =
    targetEnv && config.environments && config.environments[targetEnv]
      ? config.environments[targetEnv]
      : {};

  // Merge values according to precedence:
  // CLI flags > Environment Variables > Config Environment Overrides > Config Top-level Defaults
  const instance =
    options.instance ||
    process.env.ONE_INSTANCE ||
    process.env.KODALL_INSTANCE ||
    envOverrides.instance ||
    config.instance;

  const web_app_name =
    options.webAppName ||
    process.env.ONE_APP_NAME ||
    process.env.KODALL_APP_NAME ||
    process.env.ONE_WEB_APP_NAME ||
    envOverrides.web_app_name ||
    config.web_app_name;

  const raw_web_app_path =
    options.webAppPath ||
    process.env.ONE_APP_PATH ||
    process.env.KODALL_APP_PATH ||
    process.env.ONE_WEB_APP_PATH ||
    envOverrides.web_app_path ||
    config.web_app_path;

  const web_app_path = raw_web_app_path
    ? raw_web_app_path.startsWith("/")
      ? raw_web_app_path
      : `/${raw_web_app_path}`
    : undefined;

  const dist_path =
    options.distPath ||
    process.env.ONE_DIST_PATH ||
    process.env.KODALL_DIST_PATH ||
    envOverrides.dist_path ||
    config.dist_path ||
    "./dist";

  const api_key =
    options.apiKey ||
    process.env.ONE_API_KEY ||
    process.env.KODALL_API_KEY ||
    envOverrides.api_key ||
    config.api_key;

  const username =
    options.username ||
    process.env.ONE_USERNAME ||
    process.env.KODALL_USERNAME ||
    process.env.ONE_USER ||
    process.env.KODALL_USER;

  const password =
    options.password ||
    process.env.ONE_PASSWORD ||
    process.env.KODALL_PASSWORD;

  const resolved: Partial<ResolvedConfig> = {
    instance,
    web_app_name,
    web_app_path,
    dist_path,
    api_key,
    username,
    password,
    env: targetEnv,
  };

  const missing: string[] = [];
  if (!instance) missing.push("instance");
  if (!web_app_name) missing.push("web_app_name");
  if (!web_app_path) missing.push("web_app_path");
  if (!dist_path) missing.push("dist_path");

  // If no apiKey, credentials are required for auth
  if (!api_key) {
    if (!username) missing.push("username");
    if (!password) missing.push("password");
  }

  return {
    resolved,
    missing,
    availableEnvs,
    targetEnv,
    hasConfigFile: fileExists,
  };
}

/**
 * Validate that dist directory exists and contains index.html
 */
export function validateDistDirectory(
  distPath: string,
  cwd = process.cwd()
): { valid: boolean; resolvedDistPath: string; error?: string } {
  const resolvedDistPath = path.isAbsolute(distPath)
    ? distPath
    : path.join(cwd, distPath);

  if (!fs.existsSync(resolvedDistPath)) {
    return {
      valid: false,
      resolvedDistPath,
      error: `Build directory does not exist: ${resolvedDistPath}`,
    };
  }

  const stat = fs.statSync(resolvedDistPath);
  if (!stat.isDirectory()) {
    return {
      valid: false,
      resolvedDistPath,
      error: `Build path is not a directory: ${resolvedDistPath}`,
    };
  }

  const indexHtmlPath = path.join(resolvedDistPath, "index.html");
  if (!fs.existsSync(indexHtmlPath)) {
    return {
      valid: false,
      resolvedDistPath,
      error: `Missing index.html in build directory: ${resolvedDistPath}`,
    };
  }

  return {
    valid: true,
    resolvedDistPath,
  };
}
