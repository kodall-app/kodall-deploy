import { KodallNodeClient } from "../client/kodall-node-client.js";
import { DEFAULT_CONFIG_FILENAME, loadConfigFile } from "./config.js";
import { EnvironmentInfo, listEnvironments } from "./env-manager.js";
import { checkEndpointHealth } from "./health.js";
import type { RemoteEnvironmentStatus, RemoteHealthState } from "./types.js";

/**
 * Classifies an HTTP status code into a human-readable health state
 */
export function classifyHealthState(status: number): RemoteHealthState {
  if (status >= 200 && status < 400) {
    return "ONLINE";
  }
  if (status === 404) {
    return "NOT_FOUND";
  }
  if (status === 401 || status === 403) {
    return "PROTECTED";
  }
  if (status === 502 || status === 503 || status === 504 || status === 0 || status === 408) {
    return "OFFLINE";
  }
  return "ERROR";
}

/**
 * Checks the live remote status and entity state for a single environment
 */
export async function checkSingleEnvironmentStatus(
  envInfo: EnvironmentInfo,
  credentials?: { username?: string; password?: string }
): Promise<RemoteEnvironmentStatus> {
  const cleanInstance = envInfo.instance.replace(/\/+$/, "");
  const cleanPath = envInfo.webAppPath.startsWith("/")
    ? envInfo.webAppPath
    : `/${envInfo.webAppPath}`;
  const liveUrl = `${cleanInstance}${cleanPath}`;

  // 1. Live HTTP Ping
  const ping = await checkEndpointHealth(liveUrl, 6000);
  const state = classifyHealthState(ping.status);

  let entityKey: string | number | undefined;
  let storageId: string | number | undefined;

  // 2. Query Entity API if credentials or API key are present and server is not offline
  const hasAuth = envInfo.hasApiKey || (credentials?.username && credentials?.password);
  if (hasAuth && state !== "OFFLINE" && cleanInstance) {
    try {
      const client = new KodallNodeClient({
        baseUrl: cleanInstance,
        apiKey: envInfo.hasApiKey ? (envInfo as any).api_key || undefined : undefined,
      });

      if (!envInfo.hasApiKey && credentials?.username && credentials?.password) {
        await client.auth({ user: credentials.username, password: credentials.password });
      }

      const escapedName = envInfo.webAppName.replace(/'/g, "\\'");
      const query = `select key, properties.name, properties.path, properties.id_storage_file from web_app where properties.name = '${escapedName}'`;
      const searchResults = await client.fetch<any>(query);

      if (Array.isArray(searchResults) && searchResults.length > 0) {
        const match = searchResults[0];
        entityKey = match.key ?? match.id;
        const matchProps = match.properties || match;
        storageId = matchProps.id_storage_file ?? matchProps.storage;
      }
    } catch {
      // Non-fatal: Entity API query failure does not invalidate HTTP ping
    }
  }

  return {
    env: envInfo.name,
    isDefault: envInfo.isDefault,
    state,
    httpStatus: ping.status,
    httpStatusText: ping.statusText,
    latencyMs: ping.durationMs,
    entityKey,
    storageId,
    webAppName: envInfo.webAppName,
    webAppPath: cleanPath,
    instanceUrl: cleanInstance,
    error: ping.error,
  };
}

/**
 * Checks live remote status for all configured environments in parallel
 */
export async function checkAllEnvironmentsStatus(
  configPath: string = DEFAULT_CONFIG_FILENAME,
  envFilter?: string,
  cwd: string = process.cwd(),
  credentials?: { username?: string; password?: string }
): Promise<RemoteEnvironmentStatus[]> {
  const { fileExists, config } = loadConfigFile(configPath, cwd);
  if (!fileExists) {
    throw new Error(`Configuration file ${configPath} does not exist`);
  }

  let envs = listEnvironments(configPath, cwd);

  if (envFilter) {
    envs = envs.filter((e) => e.name.toLowerCase() === envFilter.toLowerCase());
    if (envs.length === 0) {
      throw new Error(`Environment "${envFilter}" not found in ${configPath}`);
    }
  }

  // If any env config has an api_key in environments map, attach it
  const fullEnvs = envs.map((e) => {
    const rawData = config.environments?.[e.name];
    const apiKey = rawData?.api_key || config.api_key;
    return {
      ...e,
      api_key: apiKey,
    };
  });

  const promises = fullEnvs.map((envInfo) =>
    checkSingleEnvironmentStatus(envInfo as any, credentials)
  );

  return Promise.all(promises);
}
