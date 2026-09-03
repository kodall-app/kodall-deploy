import * as path from "node:path";
import { DEFAULT_CONFIG_FILENAME, loadConfigFile } from "./config.js";
import { getActiveEnvironment } from "./env-manager.js";
import { ProxyOptions, ResolvedProxyConfig } from "./types.js";

export const DEFAULT_PROXY_PATHS = ["/auth", "/rest", "/storage"];

/**
 * Normalize a URL path to always begin with a single slash and not have trailing slash (unless root)
 */
export function normalizePath(p: string): string {
  if (!p) return "/";
  let cleaned = p.trim();
  if (!cleaned.startsWith("/")) {
    cleaned = `/${cleaned}`;
  }
  if (cleaned.length > 1 && cleaned.endsWith("/")) {
    cleaned = cleaned.slice(0, -1);
  }
  return cleaned;
}

/**
 * Remove trailing slashes from a base URL
 */
export function normalizeUrl(url: string): string {
  if (!url) return "";
  let cleaned = url.trim();
  while (cleaned.endsWith("/")) {
    cleaned = cleaned.slice(0, -1);
  }
  return cleaned;
}

/**
 * Resolve target instance URL and proxy paths from options, environment variables, and config file.
 */
export function resolveProxyConfig(options: ProxyOptions = {}): ResolvedProxyConfig {
  const cwd = options.cwd || process.cwd();
  const configPath = options.configPath || path.join(cwd, DEFAULT_CONFIG_FILENAME);
  const { config: configFile } = loadConfigFile(configPath, cwd);

  // 1. Resolve Target Environment Name
  const localActiveEnv = getActiveEnvironment(cwd);
  let envName =
    options.env ||
    process.env.KODALL_ENV ||
    process.env.ONE_ENV ||
    localActiveEnv ||
    configFile?.default_proxy_env ||
    configFile?.default_env;

  const isLocalOverride =
    !options.env &&
    !process.env.KODALL_ENV &&
    !process.env.ONE_ENV &&
    Boolean(localActiveEnv);

  if (!envName && configFile?.environments) {
    const envKeys = Object.keys(configFile.environments);
    if (envKeys.length > 0) {
      envName = envKeys[0];
    }
  }

  const envConfig =
    envName && configFile?.environments ? configFile.environments[envName] : undefined;

  // 2. Resolve Instance URL
  let instanceUrl =
    options.instance ||
    process.env.KODALL_INSTANCE ||
    process.env.ONE_INSTANCE ||
    envConfig?.instance;

  if (!instanceUrl) {
    if (configFile?.environments && Object.keys(configFile.environments).length > 0) {
      const firstEnv = Object.values(configFile.environments)[0];
      if (firstEnv?.instance) {
        instanceUrl = firstEnv.instance;
      }
    }
  }

  if (!instanceUrl) {
    instanceUrl = "http://localhost:8080";
  }

  instanceUrl = normalizeUrl(instanceUrl);

  // 3. Resolve Proxy Paths
  const pathsSet = new Set<string>();

  // Add defaults
  for (const p of DEFAULT_PROXY_PATHS) {
    pathsSet.add(normalizePath(p));
  }

  // Add global config proxy_paths
  if (Array.isArray(configFile?.proxy_paths)) {
    for (const p of configFile.proxy_paths) {
      if (p) pathsSet.add(normalizePath(p));
    }
  }

  // Add env-specific proxy_paths
  if (Array.isArray(envConfig?.proxy_paths)) {
    for (const p of envConfig.proxy_paths) {
      if (p) pathsSet.add(normalizePath(p));
    }
  }

  // Add options.proxyPaths
  if (Array.isArray(options.proxyPaths)) {
    for (const p of options.proxyPaths) {
      if (p) pathsSet.add(normalizePath(p));
    }
  }

  return {
    instanceUrl,
    envName,
    proxyPaths: Array.from(pathsSet),
    changeOrigin: options.changeOrigin !== false,
    secure: options.secure !== false,
    isLocalOverride,
  };
}

/**
 * Check if a request URL matches any of the configured proxy paths
 */
export function matchesProxyPath(urlPath: string, proxyPaths: string[]): boolean {
  if (!urlPath) return false;
  const normalized = urlPath.startsWith("/") ? urlPath : `/${urlPath}`;
  return proxyPaths.some((prefix) => {
    if (normalized === prefix) return true;
    if (normalized.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`)) return true;
    if (normalized.startsWith(`${prefix}?`)) return true;
    return false;
  });
}
