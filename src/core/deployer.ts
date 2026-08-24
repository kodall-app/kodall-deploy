import { KodallNodeClient } from "../client/kodall-node-client.js";
import { isOperation, isProblem, isStorage, isValidation } from "../client/types.js";
import { createArchive } from "./archiver.js";
import { resolveConfig, validateDistDirectory } from "./config.js";
import { recordDeployment } from "./history.js";
import { DeployOptions, DeployResult, ResolvedConfig } from "./types.js";
import { isVersionAtLeast } from "./version.js";

/**
 * Execute deployment to ONE Framework / Kodall instance
 */
export async function deploy(
  options: DeployOptions = {},
  cwd = process.cwd()
): Promise<DeployResult> {
  const startTime = Date.now();
  const notify = options.onProgress ?? (() => {});

  // 1. Resolve configuration
  notify("config", "start", "Resolving deployment configuration...");
  const { resolved, missing, targetEnv } = resolveConfig(options, cwd);

  if (missing.length > 0) {
    const errorMsg = `Missing required deployment parameter(s): ${missing.join(", ")}`;
    notify("config", "error", errorMsg);
    throw new Error(errorMsg);
  }

  const config = resolved as ResolvedConfig;
  notify(
    "config",
    "success",
    `Target: ${config.instance} (App: ${config.web_app_name}, Path: /${config.web_app_path.replace(/^\//, "")}${targetEnv ? `, Env: ${targetEnv}` : ""})`
  );

  // 2. Validate build directory & index.html
  notify("validate", "start", `Validating build directory: ${config.dist_path}...`);
  const distCheck = validateDistDirectory(config.dist_path, cwd);
  if (!distCheck.valid) {
    notify("validate", "error", distCheck.error);
    throw new Error(distCheck.error);
  }
  notify("validate", "success", "Build directory valid (index.html found).");

  // 3. Create zip archive
  notify("archive", "start", "Creating zip archive in temporary directory...");
  const archive = await createArchive(distCheck.resolvedDistPath);
  notify(
    "archive",
    "success",
    `Archive created (${(archive.sizeBytes / 1024).toFixed(1)} KB).`
  );

  const client = new KodallNodeClient({
    baseUrl: config.instance,
    apiKey: config.api_key,
  });

  // Check server version capabilities (works unauthenticated)
  let serverSupportsVersioning = false;
  try {
    const sessionInfo = await client.session();
    if (!isProblem(sessionInfo) && sessionInfo.version) {
      serverSupportsVersioning = isVersionAtLeast(sessionInfo.version, "1.8.0");
    }
  } catch {
    // Non-fatal; fall back to legacy flow
  }

  try {
    // 4. Authenticate
    if (config.api_key) {
      notify("auth", "start", "Verifying API key authentication...");
      notify("auth", "success", "API Key configured.");
    } else if (config.token) {
      notify("auth", "start", "Authenticating via OpenID Connect token...");
      const authRes = await client.auth({ accessToken: config.token });
      if (isProblem(authRes)) {
        throw new Error(`Authentication error: ${authRes.detail}`);
      }
      notify("auth", "success", "OIDC token authentication successful.");
    } else {
      notify(
        "auth",
        "start",
        `Authenticating with instance as user "${config.username}"...`
      );
      const authRes = await client.auth(
        {
          user: config.username!,
          password: config.password!,
          otp: config.otp,
        },
        { clientId: config.client_id }
      );

      if (isProblem(authRes)) {
        throw new Error(`Authentication error: ${authRes.detail}`);
      }
      notify("auth", "success", "Authentication successful.");
    }

    // 5. Query existing web_app entity
    notify(
      "fetch",
      "start",
      `Checking for existing entity (name="${config.web_app_name}", path="${config.web_app_path}")...`
    );
    let existingKey: number | string | undefined;
    let existingStorageId: number | string | undefined;
    try {
      const query = serverSupportsVersioning
        ? `FETCH web_app(key, name, path, id_storage_file_version) {
            storage_file_version TO id_storage_file_version LINK TYPE LEFT (id_storage_file)
          }`
        : `FETCH web_app(key, name, path, id_storage_file)`;
      const queryData = await client.fetch<{
        key: number | string;
        name?: string;
        path?: string;
        id_storage_file?: number | string;
        id_storage_file_version?: number | string;
        storage_file_version?: { id_storage_file?: number | string };
      }>(query);

      if (Array.isArray(queryData) && queryData.length > 0) {
        // Find existing app by matching unique path or name, or fallback to single result key
        const match = queryData.find(
          (item) =>
            item.path === config.web_app_path ||
            item.name === config.web_app_name ||
            (!item.path && !item.name && queryData.length === 1)
        );
        existingKey = match?.key;
        existingStorageId =
          match?.id_storage_file ??
          match?.storage_file_version?.id_storage_file;

        // If storage file ID is still missing but we have a version key, query storage_file_version
        if (!existingStorageId && match?.id_storage_file_version) {
          try {
            const sfvList = await client.fetch<{ id_storage_file?: number | string }>(
              `FETCH storage_file_version(id_storage_file) FILTER AND (key == ${match.id_storage_file_version})`
            );
            if (sfvList?.[0]?.id_storage_file) {
              existingStorageId = sfvList[0].id_storage_file;
            }
          } catch {
            // Non-fatal
          }
        }
      }
    } catch {
      try {
        const fallbackData = await client.fetch<{
          key: number | string;
          name?: string;
          path?: string;
          id_storage_file?: number | string;
        }>("FETCH web_app(key, name, path, id_storage_file)");
        const match = fallbackData.find(
          (item) =>
            item.path === config.web_app_path ||
            item.name === config.web_app_name ||
            (!item.path && !item.name && fallbackData.length === 1)
        );
        existingKey = match?.key;
        existingStorageId = match?.id_storage_file;
      } catch {
        existingKey = undefined;
        existingStorageId = undefined;
      }
    }

    if (options.dryRun) {
      notify(
        "dry-run",
        "info",
        `[DRY-RUN] Would ${existingKey ? `update entity key "${existingKey}"` : "create new entity"} with archive size ${(archive.sizeBytes / 1024).toFixed(1)} KB.`
      );
      return {
        success: true,
        action: "dry-run",
        entityKey: existingKey,
        archiveSizeBytes: archive.sizeBytes,
        durationMs: Date.now() - startTime,
      };
    }

    // 6. Upload archive to storage
    notify(
      "upload",
      "start",
      `Uploading ${(archive.sizeBytes / 1024).toFixed(1)} KB archive to /storage...`
    );
    const storageRes = await client.uploadFile(
      archive.archiveBuffer,
      "web_app.zip",
      existingStorageId
    );

    if (isValidation(storageRes)) {
      throw new Error(`Storage upload validation failed: ${storageRes.detail}`);
    }
    if (isProblem(storageRes)) {
      throw new Error(`Storage upload failed: ${storageRes.detail}`);
    }
    if (!isStorage(storageRes)) {
      throw new Error(`Unexpected storage response: ${JSON.stringify(storageRes)}`);
    }

    const storageId = storageRes[0].id;
    notify("upload", "success", `Archive uploaded (Storage ID: ${storageId}).`);

    // 7. Fetch storage_file_version (>= 1.8.0 only)
    let storageFileVersionKey: number | string | undefined;
    if (serverSupportsVersioning) {
      const sfv = await client.fetchLatestStorageFileVersion(storageId);
      storageFileVersionKey = sfv?.key;
      if (storageFileVersionKey) {
        notify("upload", "info", `Storage file version key: ${storageFileVersionKey} (${sfv?.file_name ?? "web_app.zip"}).`);
      }
    }

    // 8. Create or Update WebApp entity
    let action: "created" | "updated" = "created";
    let finalKey: number | string;

    const webAppProperties: Record<string, any> = {
      name: config.web_app_name,
      path: config.web_app_path,
      ...(existingKey ? { key: existingKey } : {}),
    };

    if (serverSupportsVersioning && storageFileVersionKey) {
      webAppProperties.id_storage_file_version = storageFileVersionKey;
    } else {
      webAppProperties.id_storage_file = storageId;
    }

    const webAppEntity = {
      entity_name: "web_app",
      properties: webAppProperties,
    };

    if (existingKey) {
      notify("entity", "start", `Updating existing web_app entity (key: ${existingKey})...`);
      const updateRes = await client.update(webAppEntity);
      if (isValidation(updateRes)) {
        throw new Error(`Update validation error: ${updateRes.detail}`);
      }
      if (isProblem(updateRes)) {
        throw new Error(`Update error: ${updateRes.detail}`);
      }
      action = "updated";
      finalKey = isOperation(updateRes) ? updateRes.key : existingKey;
    } else {
      notify("entity", "start", `Creating new web_app entity...`);
      const createRes = await client.create(webAppEntity);
      if (isValidation(createRes)) {
        throw new Error(`Create validation error: ${createRes.detail}`);
      }
      if (isProblem(createRes)) {
        throw new Error(`Create error: ${createRes.detail}`);
      }
      action = "created";
      finalKey = isOperation(createRes) ? createRes.key : "created";
    }

    notify(
      "entity",
      "success",
      `Web application successfully ${action} (Entity Key: ${finalKey})!`
    );

    // 8. Live Health Check Ping
    let healthResult: any;
    if (options.healthCheck !== false) {
      const liveUrl = `${config.instance}${config.web_app_path}`;
      notify("health", "start", `Checking live endpoint: ${liveUrl}...`);
      try {
        const { checkEndpointHealth } = await import("./health.js");
        healthResult = await checkEndpointHealth(liveUrl);
        if (healthResult.ok) {
          notify(
            "health",
            "success",
            `Live check passed: ${liveUrl} (${healthResult.status} ${healthResult.statusText}) [${healthResult.durationMs}ms]`
          );
        } else {
          notify(
            "health",
            "warn",
            `Live endpoint check: ${liveUrl} returned ${healthResult.status} ${healthResult.statusText}`
          );
        }
      } catch {
        // Non-fatal if health check ping fails
      }
    }

    const durationMs = Date.now() - startTime;

    // Record deployment event in local history (legacy servers only)
    // On >= 1.8.0, the server writes web_app_log automatically
    if (!serverSupportsVersioning) {
      try {
        recordDeployment(
          {
            id: `dep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            timestamp: new Date().toISOString(),
            env: targetEnv || config.env || "default",
            instance: config.instance,
            entityKey: finalKey,
            storageId,
            webAppName: config.web_app_name,
            webAppPath: config.web_app_path,
            action,
            username: config.username || (config.api_key ? "api_key" : undefined),
            durationMs,
          },
          cwd
        );
      } catch {
        // Non-fatal if history writing fails
      }
    }

    return {
      success: true,
      storageId,
      entityKey: finalKey,
      action,
      archiveSizeBytes: archive.sizeBytes,
      healthCheck: healthResult,
      durationMs,
    };
  } finally {
    // Always clean up temp archive
    archive.cleanup();
  }
}
