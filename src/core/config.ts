import * as fs from "node:fs";
import * as path from "node:path";
import { DeployOptions, EnvironmentConfig, ResolvedConfig, WebAppConfigFile } from "./types.js";

export const DEFAULT_CONFIG_FILENAME = "kodall-webapp.config.json";
export const LEGACY_CONFIG_FILENAME = "config_web_app.json";

/**
 * Migrates legacy config_web_app.json or flat single-instance objects to the new multi-environment format
 */
export function migrateLegacyConfigFile(
  cwd = process.cwd()
): { migrated: boolean; oldPath?: string; newPath?: string } {
  const defaultPath = path.join(cwd, DEFAULT_CONFIG_FILENAME);
  const legacyPath = path.join(cwd, LEGACY_CONFIG_FILENAME);

  // 1. Check if kodall-webapp.config.json exists
  if (fs.existsSync(defaultPath)) {
    try {
      const raw = fs.readFileSync(defaultPath, "utf-8");
      const parsed = JSON.parse(raw);

      // Check if it's a flat legacy format with instance at root
      if (parsed.instance && (!parsed.environments || Object.keys(parsed.environments).length === 0)) {
        const migrated: WebAppConfigFile = {
          web_app_name: parsed.web_app_name || "app",
          web_app_path:
            parsed.web_app_path
              ? parsed.web_app_path.startsWith("/")
                ? parsed.web_app_path
                : `/${parsed.web_app_path}`
              : parsed.web_app_name
              ? parsed.web_app_name.startsWith("/")
                ? parsed.web_app_name
                : `/${parsed.web_app_name}`
              : "/app",
          dist_path: parsed.dist_path || "./dist",
          default_env: "dev",
          environments: {
            dev: {
              type: "dev",
              instance: parsed.instance,
              ...(parsed.api_key ? { api_key: parsed.api_key } : {}),
            },
          },
        };
        fs.writeFileSync(defaultPath, JSON.stringify(migrated, null, 2) + "\n", "utf-8");

        if (fs.existsSync(legacyPath)) {
          try {
            fs.unlinkSync(legacyPath);
          } catch {}
        }

        return { migrated: true, newPath: defaultPath };
      }

      // Already has environments. If old config_web_app.json also exists, remove it
      if (fs.existsSync(legacyPath)) {
        try {
          fs.unlinkSync(legacyPath);
        } catch {}
      }

      return { migrated: false };
    } catch {
      return { migrated: false };
    }
  }

  // 2. kodall-webapp.config.json doesn't exist, but legacy config_web_app.json does
  if (fs.existsSync(legacyPath)) {
    try {
      const raw = fs.readFileSync(legacyPath, "utf-8");
      const parsed = JSON.parse(raw);

      let migrated: WebAppConfigFile;

      if (parsed.environments && Object.keys(parsed.environments).length > 0) {
        migrated = {
          web_app_name: parsed.web_app_name,
          web_app_path: parsed.web_app_path,
          dist_path: parsed.dist_path,
          default_env: parsed.default_env || Object.keys(parsed.environments)[0],
          environments: parsed.environments,
        };
      } else {
        migrated = {
          web_app_name: parsed.web_app_name || "app",
          web_app_path:
            parsed.web_app_path ||
            (parsed.web_app_name
              ? parsed.web_app_name.startsWith("/")
                ? parsed.web_app_name
                : `/${parsed.web_app_name}`
              : "/app"),
          dist_path: parsed.dist_path || "./dist",
          default_env: "dev",
          environments: {
            dev: {
              type: "dev",
              instance: parsed.instance || "",
              ...(parsed.api_key ? { api_key: parsed.api_key } : {}),
            },
          },
        };
      }

      fs.writeFileSync(defaultPath, JSON.stringify(migrated, null, 2) + "\n", "utf-8");

      try {
        fs.unlinkSync(legacyPath);
      } catch {}

      return { migrated: true, oldPath: legacyPath, newPath: defaultPath };
    } catch {
      return { migrated: false };
    }
  }

  return { migrated: false };
}

/**
 * Load and parse config file if present
 */
export function loadConfigFile(
  configPath = DEFAULT_CONFIG_FILENAME,
  cwd = process.cwd()
): { fileExists: boolean; config: WebAppConfigFile } {
  let resolvedPath = path.isAbsolute(configPath)
    ? configPath
    : path.join(cwd, configPath);

  // Auto-migrate if loading default config and legacy file exists
  if (
    configPath === DEFAULT_CONFIG_FILENAME &&
    !fs.existsSync(resolvedPath) &&
    fs.existsSync(path.join(cwd, LEGACY_CONFIG_FILENAME))
  ) {
    migrateLegacyConfigFile(cwd);
  }

  if (!fs.existsSync(resolvedPath)) {
    return { fileExists: false, config: {} };
  }

  try {
    const rawContent = fs.readFileSync(resolvedPath, "utf-8");
    const parsed = JSON.parse(rawContent);

    // If loaded file is flat legacy, auto-migrate it
    if (parsed.instance && (!parsed.environments || Object.keys(parsed.environments).length === 0)) {
      const migrated: WebAppConfigFile = {
        web_app_name: parsed.web_app_name || "app",
        web_app_path:
          parsed.web_app_path
            ? parsed.web_app_path.startsWith("/")
              ? parsed.web_app_path
              : `/${parsed.web_app_path}`
            : parsed.web_app_name
            ? parsed.web_app_name.startsWith("/")
              ? parsed.web_app_name
              : `/${parsed.web_app_name}`
            : "/app",
        dist_path: parsed.dist_path || "./dist",
        default_env: "dev",
        environments: {
          dev: {
            type: "dev",
            instance: parsed.instance,
            ...(parsed.api_key ? { api_key: parsed.api_key } : {}),
          },
        },
      };
      fs.writeFileSync(resolvedPath, JSON.stringify(migrated, null, 2) + "\n", "utf-8");
      return { fileExists: true, config: migrated };
    }

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
  const configPath = options.configPath || DEFAULT_CONFIG_FILENAME;
  const { fileExists, config } = loadConfigFile(configPath, cwd);

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
  // Instance and api_key must come from flags, env vars, or environment block (NOT root config)
  let rawInstance =
    options.instance ||
    process.env.ONE_INSTANCE ||
    process.env.KODALL_INSTANCE ||
    envOverrides.instance;

  let instance = rawInstance?.trim();
  if (instance) {
    while (/^https?:\/\/https?:\/\//i.test(instance)) {
      instance = instance.replace(/^https?:\/\//i, "");
    }
    if (instance.endsWith("/")) {
      instance = instance.slice(0, -1);
    }
  }

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
    envOverrides.api_key;

  const token =
    options.token ||
    process.env.ONE_TOKEN ||
    process.env.KODALL_TOKEN ||
    process.env.ONE_OIDC_TOKEN ||
    envOverrides.token;

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

  const otp =
    options.otp ||
    process.env.ONE_OTP ||
    process.env.KODALL_OTP ||
    envOverrides.otp;

  const client_id =
    options.clientId ||
    process.env.ONE_CLIENT_ID ||
    process.env.KODALL_CLIENT_ID ||
    envOverrides.client_id;

  const resolved: Partial<ResolvedConfig> = {
    instance,
    web_app_name,
    web_app_path,
    dist_path,
    api_key,
    token,
    otp,
    client_id,
    username,
    password,
    env: targetEnv,
  };

  const missing: string[] = [];
  if (!instance) missing.push("instance");
  if (!web_app_name) missing.push("web_app_name");
  if (!web_app_path) missing.push("web_app_path");
  if (!dist_path) missing.push("dist_path");

  // If no apiKey or token, username/password credentials are required for auth
  if (!api_key && !token) {
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
