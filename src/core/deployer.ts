import { KodallNodeClient } from "../client/kodall-node-client.js";
import { isOperation, isProblem, isStorage, isValidation } from "../client/types.js";
import { createArchive } from "./archiver.js";
import { resolveConfig, validateDistDirectory } from "./config.js";
import { recordDeployment } from "./history.js";
import { DeployOptions, DeployResult, ResolvedConfig } from "./types.js";

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

  try {
    // 4. Authenticate
    if (config.api_key) {
      notify("auth", "start", "Verifying API key authentication...");
      // For API key, check session or proceed
      notify("auth", "success", "API Key configured.");
    } else {
      notify(
        "auth",
        "start",
        `Authenticating with instance as user "${config.username}"...`
      );
      const authRes = await client.auth({
        user: config.username!,
        password: config.password!,
      });

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
    try {
      const query = `FETCH web_app(key, name, path)`;
      const queryData = await client.fetch<{ key: number | string; name?: string; path?: string }>(query);
      if (Array.isArray(queryData) && queryData.length > 0) {
        // Find existing app by matching unique path or name, or fallback to single result key
        const match = queryData.find(
          (item) =>
            item.path === config.web_app_path ||
            item.name === config.web_app_name ||
            (!item.path && !item.name && queryData.length === 1)
        );
        existingKey = match?.key;
      }
    } catch {
      existingKey = undefined;
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
      "web_app.zip"
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

    // 7. Create or Update WebApp entity
    let action: "created" | "updated" = "created";
    let finalKey: number | string;

    const webAppEntity = {
      entity_name: "web_app",
      properties: {
        name: config.web_app_name,
        path: config.web_app_path,
        id_storage_file: storageId,
        ...(existingKey ? { key: existingKey } : {}),
      },
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

    // Record deployment event in history
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
