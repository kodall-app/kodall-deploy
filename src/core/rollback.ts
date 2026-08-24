import { KodallNodeClient } from "../client/kodall-node-client.js";
import { isProblem, isValidation } from "../client/types.js";
import { resolveConfig } from "./config.js";
import { getPreviousDeployment, recordDeployment } from "./history.js";
import type { RollbackOptions, RollbackResult } from "./types.js";
import { isVersionAtLeast } from "./version.js";

/**
 * Roll back a ONE Framework web application to a previous storage archive
 */
export async function rollback(
  options: RollbackOptions,
  cwd: string = process.cwd()
): Promise<RollbackResult> {
  const startTime = Date.now();
  const notify = options.onProgress || (() => {});

  // 1. Resolve configuration
  notify("config", "start", "Resolving environment configuration for rollback...");
  const configState = resolveConfig(
    {
      configPath: options.configPath,
      env: options.env,
      instance: options.instance,
      webAppName: options.webAppName,
      webAppPath: options.webAppPath,
      username: options.username,
      password: options.password,
      apiKey: options.apiKey,
      token: options.token,
      otp: options.otp,
      clientId: options.clientId,
    },
    cwd
  );

  const {
    instance,
    web_app_name,
    web_app_path,
    api_key,
    token,
    otp,
    client_id,
    username,
    password,
    env,
  } = configState.resolved;

  if (!instance) {
    throw new Error("Missing target instance URL for rollback");
  }
  if (!web_app_name && !web_app_path) {
    throw new Error("Missing web_app_name or web_app_path to identify application entity");
  }

  // 2. Connect and check server version (works unauthenticated)
  const client = new KodallNodeClient({
    baseUrl: instance,
    apiKey: api_key,
  });

  let serverSupportsVersioning = false;
  try {
    const sessionInfo = await client.session();
    if (!isProblem(sessionInfo) && sessionInfo.version) {
      serverSupportsVersioning = isVersionAtLeast(sessionInfo.version, "1.8.0");
    }
  } catch {
    // Non-fatal; fall back to legacy flow
  }

  // 3. Authenticate
  notify(
    "auth",
    "start",
    `Connecting to ${instance}...`
  );

  if (api_key) {
    notify("auth", "success", "API Key configured.");
  } else if (token) {
    const authRes = await client.auth({ accessToken: token });
    if (isProblem(authRes)) {
      throw new Error(`Authentication failed: ${authRes.detail || "Invalid OIDC token"}`);
    }
    notify("auth", "success", "OIDC token authentication successful.");
  } else {
    if (!username || !password) {
      throw new Error("Missing credentials (API Key, Token, or Username/Password) for rollback");
    }
    const authRes = await client.auth({ user: username, password, otp }, { clientId: client_id });
    if (isProblem(authRes)) {
      throw new Error(`Authentication failed: ${authRes.detail || "Invalid credentials"}`);
    }
    notify("auth", "success", "Authentication successful.");
  }

  // 4. Find the web_app entity on server
  notify("lookup", "start", `Locating web application entity "${web_app_name || "web_app"}"...`);

  let entityList: any[] = [];
  try {
    entityList = await client.fetch("FETCH web_app(key, name, path, id_storage_file)");
  } catch {
    try {
      entityList = await client.fetch("FETCH web_app(key, name, path)");
    } catch {
      entityList = [];
    }
  }

  const rawPath = web_app_path || (web_app_name ? `/${web_app_name}` : "/app");
  const normalizedPath = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  const targetEntity = entityList.find(
    (item: any) =>
      item.path === normalizedPath ||
      item.path === rawPath ||
      (web_app_name && item.name === web_app_name)
  );

  if (!targetEntity || !targetEntity.key) {
    throw new Error(
      `Web application "${web_app_name || normalizedPath}" not found on ${instance}. Cannot rollback nonexistent entity.`
    );
  }

  const entityKey = targetEntity.key;
  const fromStorageId = targetEntity.id_storage_file || targetEntity.storage;
  const finalAppName = web_app_name || targetEntity.name || "app";

  const stepsBack = options.stepsBack ?? 1;

  // 5a. New flow (>= 1.8.0): query server web_app_log for previous storage_file_version
  if (serverSupportsVersioning) {
    notify(
      "rollback",
      "start",
      `Querying server deployment log for entity (key: ${entityKey})...`
    );

    let targetStorageFileVersionKey: number | string | undefined;
    let targetFileName: string | undefined;

    try {
      const logs = await client.fetch<{
        key: number | string;
        status?: string;
        date_created?: string;
        storageFileVersionKey?: number | string;
        file_name?: string;
      }>(`FETCH web_app_log (key, log, uuid, status, date_created) {
          storage_file_version TO id_storage_file_version LINK TYPE LEFT (key AS storageFileVersionKey, file_name),
          web_app TO id_web_app FILTER AND (${entityKey})
      } ORDER BY key DESC`);
      // logs[0] = most recent deploy, logs[stepsBack] = N steps back
      // storageFileVersionKey may be null for pre-1.8.0 log entries (LEFT join)
      const target = logs[stepsBack];
      targetStorageFileVersionKey = target?.storageFileVersionKey;
      targetFileName = target?.file_name;
    } catch {
      throw new Error(
        `Failed to query deployment log from server. Cannot determine rollback target.`
      );
    }

    // Rollback requires both >= 1.8.0 AND a non-null storageFileVersionKey on the target entry
    if (!targetStorageFileVersionKey) {
      throw new Error(
        `Cannot rollback: target deployment log entry (${stepsBack} step(s) back) has no storage_file_version — ` +
        `it may be a pre-1.8.0 entry or an entry without a versioned file.`
      );
    }

    notify(
      "rollback",
      "start",
      `Updating entity (key: ${entityKey}) to storage_file_version ${targetStorageFileVersionKey}${targetFileName ? ` (${targetFileName})` : ""}...`
    );

    // Update ONLY id_storage_file_version on web_app
    const updateRes = await client.update({
      entity_name: "web_app",
      properties: {
        key: entityKey,
        id_storage_file_version: targetStorageFileVersionKey,
      },
    });

    if (isValidation(updateRes)) {
      throw new Error(`Rollback validation error: ${updateRes.detail}`);
    }
    if (isProblem(updateRes)) {
      throw new Error(`Rollback error: ${updateRes.detail}`);
    }

    const durationMs = Date.now() - startTime;
    notify(
      "rollback",
      "success",
      `Web application rolled back to storage_file_version ${targetStorageFileVersionKey} (entity key: ${entityKey}) in ${(durationMs / 1000).toFixed(2)}s!`
    );

    return {
      success: true,
      entityKey,
      fromStorageId,
      toStorageId: targetStorageFileVersionKey,
      webAppName: finalAppName,
      webAppPath: normalizedPath,
      durationMs,
    };
  }

  // 5b. Legacy flow (< 1.8.0): use local history + id_storage_file
  let targetStorageId = options.targetStorageId;

  if (!targetStorageId) {
    const previousRecord = getPreviousDeployment(cwd, env, stepsBack);
    if (!previousRecord) {
      throw new Error(
        `No previous deployment history found for environment "${env || "default"}" to roll back to.`
      );
    }
    targetStorageId = previousRecord.storageId;
  }

  notify(
    "rollback",
    "start",
    `Updating entity (key: ${entityKey}) to storage ID ${targetStorageId}...`
  );

  const updateRes = await client.update({
    entity_name: "web_app",
    properties: {
      key: entityKey,
      name: finalAppName,
      path: normalizedPath,
      id_storage_file: targetStorageId,
    },
  });

  if (isValidation(updateRes)) {
    throw new Error(`Rollback validation error: ${updateRes.detail}`);
  }
  if (isProblem(updateRes)) {
    throw new Error(`Rollback error: ${updateRes.detail}`);
  }

  const durationMs = Date.now() - startTime;
  notify(
    "rollback",
    "success",
    `Web application successfully rolled back to Storage ID ${targetStorageId} (Key: ${entityKey}) in ${(durationMs / 1000).toFixed(2)}s!`
  );

  // Record rollback event in local history (legacy only)
  recordDeployment({
    id: `rb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    env: env || "default",
    instance,
    entityKey,
    storageId: targetStorageId,
    webAppName: finalAppName,
    webAppPath: normalizedPath,
    action: "rollback",
    username: username || (api_key ? "api_key" : undefined),
    durationMs,
  });

  return {
    success: true,
    entityKey,
    fromStorageId,
    toStorageId: targetStorageId,
    webAppName: finalAppName,
    webAppPath: normalizedPath,
    durationMs,
  };
}
