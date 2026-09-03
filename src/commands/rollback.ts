import { KodallNodeClient } from "../client/kodall-node-client.js";
import { DEFAULT_OAUTH_PORT, executeBrowserOAuthLogin } from "../client/pkce-auth.js";
import { isProblem } from "../client/types.js";
import { loadConfigFile } from "../core/config.js";
import { getDeploymentHistory } from "../core/history.js";
import { rollback } from "../core/rollback.js";
import { RollbackOptions } from "../core/types.js";
import { isVersionAtLeast } from "../core/version.js";
import { bold, cyan, dim, green, log, Spinner, yellow } from "../ui/logger.js";
import { askPassword, askSelect, askText } from "../ui/prompts.js";
import { probeAuthType } from "./auth-probe.js";

export async function handleRollback(
  configPath: string,
  targetStorageId?: string | number,
  initialEnv?: string,
  flags: any = {}
): Promise<void> {
  const { config: loadedConfig } = loadConfigFile(configPath);
  let targetEnv = initialEnv || flags.env;

  // If a specific storage ID was passed, auto-detect its environment from history
  if (targetStorageId && !targetEnv) {
    const allRecords = getDeploymentHistory(process.cwd());
    const matchedRecord = allRecords.find((r) => String(r.storageId) === String(targetStorageId));
    if (matchedRecord && matchedRecord.env) {
      targetEnv = matchedRecord.env;
    }
  }

  // Only prompt for environment if still unresolved and multiple environments exist
  if (!targetEnv && loadedConfig.environments && Object.keys(loadedConfig.environments).length > 0) {
    const envKeys = Object.keys(loadedConfig.environments);
    const defaultEnv = loadedConfig.default_env || envKeys[0];
    const defaultIdx = Math.max(0, envKeys.indexOf(defaultEnv));
    targetEnv = await askSelect("Select environment to roll back", envKeys, defaultIdx);
  }

  let user = flags.user;
  let pass = flags.password;

  const envConf = targetEnv && loadedConfig.environments ? loadedConfig.environments[targetEnv] : undefined;
  const targetInstance = flags.instance || envConf?.instance || (loadedConfig.default_env && loadedConfig.environments?.[loadedConfig.default_env]?.instance);
  const targetAppName = flags.name || envConf?.web_app_name || loadedConfig.web_app_name;

  if (!flags["api-key"] && !flags.token && !flags["oidc-token"] && !envConf?.api_key && !envConf?.token) {
    const authProbe = await probeAuthType(targetInstance);

    if (authProbe.isOidc) {
      console.log(
        `\n  ${cyan("ℹ")} ${bold("Authentication Mode:")} ${yellow("OAuth / OpenID Connect")}`
      );
      if (authProbe.oidcIssuer) {
        console.log(`    ${dim("IdP Realm:")} ${dim(authProbe.oidcIssuer)}`);
      }

      const client = new KodallNodeClient({ baseUrl: targetInstance! });
      const oidcProvider = await client.getOidcIssuer();
      if (oidcProvider) {
        console.log(dim("\n  Opening browser for login..."));
        const tokens = await executeBrowserOAuthLogin({
          oidcProvider,
          clientId: flags["client-id"] || "account",
          port: DEFAULT_OAUTH_PORT,
          onAuthUrl: (url) => {
            console.log(`  ${cyan("▶")} Opening login page in browser...`);
            console.log(dim(`    If it didn't open automatically: ${url}\n`));
          },
        });
        flags.token = tokens.accessToken;
        log.success("Captured OpenID Connect access token from browser login!");
      }
    } else {
      console.log(
        `\n  ${cyan("ℹ")} ${bold("Authentication Mode:")} ${green("Kodall Basic Login")}`
      );
      if (!user) {
        user = await askText("Kodall Username", process.env.USER || process.env.USERNAME);
      }
      if (!pass) {
        pass = await askPassword("Kodall Password");
      }
    }
  }

  let selectedStorageId = targetStorageId;

  // If no target storage ID was given, try querying server deployment logs (>= 1.8.0) or local history (< 1.8.0)
  if (!selectedStorageId) {
    let serverLogsFound = false;

    if (targetInstance) {
      try {
        const client = new KodallNodeClient({
          baseUrl: targetInstance,
          apiKey: flags["api-key"] || envConf?.api_key,
        });

        // Authenticate client
        const token = flags.token || flags["oidc-token"] || envConf?.token;
        if (!flags["api-key"] && !envConf?.api_key) {
          if (token) {
            await client.auth({ accessToken: token });
          } else if (user && pass) {
            await client.auth({ user, password: pass });
          }
        }

        const sessionInfo = await client.session();
        if (!isProblem(sessionInfo) && sessionInfo.version && isVersionAtLeast(sessionInfo.version, "1.8.0")) {
          const webAppFilter = targetAppName ? `FILTER AND (name == "${targetAppName}")` : "";
          const logs = await client.fetch<{
            key: number | string;
            status?: string;
            date_created?: string;
            path?: string;
            storageFileVersionKey?: number | string;
            file_name?: string;
          }>(`FETCH web_app_log (key, log, uuid, status, date_created, path) {
              storage_file_version TO id_storage_file_version LINK TYPE LEFT (key AS storageFileVersionKey, file_name),
              web_app TO id_web_app ${webAppFilter}
          }`);

          logs.sort((a, b) => Number(b.key) - Number(a.key));
          const versionLogs = logs.filter((l) => l.storageFileVersionKey != null);

          if (versionLogs.length > 0) {
            const choices = versionLogs.map((r, idx) => {
              const d = r.date_created ? new Date(r.date_created) : null;
              const dateStr = d && !isNaN(d.getTime()) ? d.toLocaleString() : (r.date_created || "-");
              const currentTag = idx === 0 ? " (CURRENT ACTIVE BUILD)" : "";
              const pathStr = r.path ? ` [path: ${r.path}]` : "";
              return `Version Key: ${r.storageFileVersionKey}${pathStr} - ${r.file_name || "web_app.zip"} (${dateStr})${currentTag}`;
            });

            const defaultIdx = choices.length > 1 ? 1 : 0;
            const chosenStr = await askSelect(
              "Select target deployment build to restore",
              choices,
              defaultIdx
            );

            const chosenIdx = choices.indexOf(chosenStr);
            selectedStorageId = versionLogs[chosenIdx]?.storageFileVersionKey;
            serverLogsFound = true;
          }
        }
      } catch {
        // Fall back to local history or prompt
      }
    }

    if (!serverLogsFound) {
      const envHistory = getDeploymentHistory(process.cwd(), targetEnv);
      if (envHistory.length > 0) {
        const choices = envHistory.map((r, idx) => {
          const d = new Date(r.timestamp);
          const dateStr = !isNaN(d.getTime()) ? d.toLocaleString() : r.timestamp;
          const currentTag = idx === 0 ? " (CURRENT ACTIVE BUILD)" : "";
          return `Storage ID: ${r.storageId} - ${r.webAppName} (${dateStr})${currentTag}`;
        });

        const defaultIdx = choices.length > 1 ? 1 : 0;
        const chosenStr = await askSelect(
          "Select target deployment build to restore",
          choices,
          defaultIdx
        );

        const chosenIdx = choices.indexOf(chosenStr);
        selectedStorageId = envHistory[chosenIdx]?.storageId;
      } else {
        selectedStorageId = await askText("Storage / Version ID to roll back to (e.g. 137)");
      }
    }
  }

  if (!selectedStorageId) {
    log.error("No storage ID specified for rollback.");
    return;
  }

  const spinner = new Spinner("", false);
  const rollbackOpts: RollbackOptions = {
    configPath,
    env: targetEnv,
    instance: flags.instance,
    webAppName: flags.name,
    webAppPath: flags.path,
    targetStorageId: selectedStorageId,
    username: user,
    password: pass,
    apiKey: flags["api-key"],
    token: flags.token || flags["oidc-token"],
    otp: flags.otp,
    clientId: flags["client-id"],
    ci: flags.ci,
    onProgress: (step, status, message) => {
      if (status === "start") spinner.start(message || `Rolling back ${step}...`);
      else if (status === "success") spinner.succeed(message);
      else if (status === "warn") spinner.warn(message);
      else if (status === "error") spinner.fail(message);
      else if (status === "info") {
        spinner.stop();
        if (message) log.info(message);
      }
    },
  };

  try {
    const result = await rollback(rollbackOpts);
    spinner.stop();
    console.log("");
    log.success(
      `Rollback successful! Restored Storage ID: ${bold(String(result.toStorageId))} (Entity: ${result.entityKey}) [${(result.durationMs / 1000).toFixed(2)}s]`
    );
  } catch (err) {
    spinner.stop();
    log.error(`Rollback failed: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}
