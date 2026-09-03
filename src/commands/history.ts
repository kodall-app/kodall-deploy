import { KodallNodeClient } from "../client/kodall-node-client.js";
import { DEFAULT_OAUTH_PORT, executeBrowserOAuthLogin } from "../client/pkce-auth.js";
import { isProblem } from "../client/types.js";
import { loadConfigFile } from "../core/config.js";
import { getDeploymentHistory } from "../core/history.js";
import { DeploymentRecord } from "../core/types.js";
import { isVersionAtLeast } from "../core/version.js";
import { bold, cyan, dim, green, log, magenta, pad, red, yellow } from "../ui/logger.js";
import { askPassword, askText } from "../ui/prompts.js";
import { probeAuthType } from "./auth-probe.js";

/**
 * Display server web_app_log entries in a formatted table, grouped by web app name.
 */
export function displayServerHistory(
  logs: Array<{
    key: number | string;
    status?: string;
    date_created?: string;
    path?: string;
    storageFileVersionKey?: number | string;
    file_name?: string;
    _appName?: string;
  }>,
  envFilter: string | undefined,
  instance: string
): void {
  if (logs.length === 0) {
    console.log(yellow(`\nNo deployment history found${envFilter ? ` for environment "${envFilter}"` : ""}.\n`));
    return;
  }

  console.log(`\n${bold(cyan("Deployment History"))}${envFilter ? dim(` (filter: ${envFilter})`) : ""} ${dim(`— ${instance}`)}:\n`);

  // Group by _appName (tagged from which web_app_name was queried)
  const grouped = new Map<string, typeof logs>();
  for (const entry of logs) {
    const appLabel = entry._appName || "unknown";
    if (!grouped.has(appLabel)) grouped.set(appLabel, []);
    grouped.get(appLabel)!.push(entry);
  }

  for (const [appLabel, entries] of grouped) {
    console.log(`  ${bold(green(`[${appLabel}]`))}`);

    console.log(
      dim(
        "    " +
          pad("TIMESTAMP", 22) +
          pad("STATUS", 14) +
          pad("PATH", 22) +
          pad("VER KEY", 12) +
          "FILE"
      )
    );
    console.log(dim("    " + "─".repeat(95)));

    for (const entry of entries) {
      const d = entry.date_created ? new Date(entry.date_created) : null;
      const dateStr =
        d && !isNaN(d.getTime())
          ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
          : "-";

      const statusBadge =
        entry.status === "rollback"
          ? magenta("rollback")
          : entry.status === "error"
          ? red("error")
          : green(entry.status || "success");

      const routePath = entry.path ? dim(entry.path) : dim("-");
      const verKey =
        entry.storageFileVersionKey != null ? cyan(String(entry.storageFileVersionKey)) : dim("-");
      const fileName = entry.file_name ? dim(entry.file_name) : dim("-");

      console.log(
        "    " +
          pad(dim(dateStr), 22) +
          pad(statusBadge, 14) +
          pad(routePath, 22) +
          pad(verKey, 12) +
          fileName
      );
    }
    console.log("");
  }
}

export function displayHistory(records: DeploymentRecord[], envFilter?: string): void {
  if (records.length === 0) {
    console.log(yellow(`\nNo deployment history found${envFilter ? ` for environment "${envFilter}"` : ""}.\n`));
    return;
  }

  // Group records by environment
  const grouped: Record<string, DeploymentRecord[]> = {};
  for (const r of records) {
    const envName = r.env || "default";
    if (!grouped[envName]) {
      grouped[envName] = [];
    }
    grouped[envName].push(r);
  }

  console.log(`\n${bold(cyan("Deployment History"))}${envFilter ? dim(` (filter: ${envFilter})`) : ""}:\n`);

  for (const [envName, envRecords] of Object.entries(grouped)) {
    const instanceInfo = envRecords[0]?.instance ? dim(` (${envRecords[0].instance})`) : "";
    console.log(`  ${bold(green(`[${envName}]`))}${instanceInfo}`);
    console.log(
      dim(
        "    " +
          pad("TIMESTAMP", 20) +
          pad("ACTION", 14) +
          pad("STORAGE ID", 14) +
          pad("ENTITY KEY", 14) +
          pad("ROUTE PATH", 24) +
          "USER"
      )
    );
    console.log(dim("    " + "─".repeat(110)));

    for (const r of envRecords) {
      const d = new Date(r.timestamp);
      const dateStr = !isNaN(d.getTime())
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
        : r.timestamp.slice(0, 16);

      const actionBadge =
        r.action === "rollback"
          ? magenta("rollback")
          : r.action === "created"
          ? green("created")
          : cyan("updated");

      console.log(
        "    " +
          pad(dim(dateStr), 20) +
          pad(actionBadge, 14) +
          pad(cyan(String(r.storageId)), 14) +
          pad(dim(String(r.entityKey)), 14) +
          pad(r.webAppPath || "", 24) +
          dim(r.username || "-")
      );
    }
    console.log("");
  }
}

/**
 * Top-level history display: queries server web_app_log on >= 1.8.0, falls back to local history.
 * Groups environments by instance to avoid multiple auth prompts for the same server.
 * Includes web_app name/path in the FETCH result for client-side filtering — no entityKey pre-fetch needed.
 */
export async function displayHistoryForEnv(
  configPath: string,
  env: string | undefined,
  flags: any
): Promise<void> {
  const { config: loadedConfig } = loadConfigFile(configPath);

  const envKeys = env
    ? [env]
    : loadedConfig.environments
    ? Object.keys(loadedConfig.environments)
    : [];

  if (envKeys.length === 0) {
    displayHistory(getDeploymentHistory(process.cwd(), env), env);
    return;
  }

  // Group envs by instance URL — one auth + one fetch per server
  const instanceMap = new Map<
    string,
    { apiKey?: string; token?: string; webAppNames: string[]; webAppPaths: string[] }
  >();

  for (const envName of envKeys) {
    const envConf = loadedConfig.environments?.[envName];
    const instance = flags.instance || envConf?.instance;
    if (!instance) continue;

    const apiKey = flags["api-key"] || envConf?.api_key;
    const token = flags.token || flags["oidc-token"] || envConf?.token;
    const webAppName = envConf?.web_app_name || loadedConfig.web_app_name;
    const webAppPath = flags.path || envConf?.web_app_path || loadedConfig.web_app_path;

    if (!instanceMap.has(instance)) {
      instanceMap.set(instance, { apiKey, token, webAppNames: [], webAppPaths: [] });
    }
    const entry = instanceMap.get(instance)!;
    if (webAppName && !entry.webAppNames.includes(webAppName)) entry.webAppNames.push(webAppName);
    if (webAppPath && !entry.webAppPaths.includes(webAppPath)) entry.webAppPaths.push(webAppPath);
  }

  let serverUsed = false;

  for (const [instance, { apiKey, token, webAppNames }] of instanceMap) {
    try {
      const client = new KodallNodeClient({ baseUrl: instance, apiKey });

      // Version check — works unauthenticated
      const sessionInfo = await client.session();
      if (isProblem(sessionInfo) || !sessionInfo.version) continue;
      if (!isVersionAtLeast(sessionInfo.version, "1.8.0")) continue;

      // Authenticate
      if (!apiKey) {
        if (token) {
          const authRes = await client.auth({ accessToken: token });
          if (isProblem(authRes)) continue;
        } else {
          // Prompt interactively
          const authProbe = await probeAuthType(instance);
          if (authProbe.isOidc) {
            const oidcProvider = await client.getOidcIssuer();
            if (oidcProvider) {
              console.log(dim("\n  Opening browser for login..."));
              const tokens = await executeBrowserOAuthLogin({
                oidcProvider,
                clientId: flags["client-id"] || "account",
                port: DEFAULT_OAUTH_PORT,
                onAuthUrl: (url) => console.log(dim(`  Login URL: ${url}`)),
              });
              const authRes = await client.openIdAuth(tokens);
              if (isProblem(authRes)) continue;
            }
          } else {
            const user = await askText("Kodall Username", process.env.USER || process.env.USERNAME);
            const pass = await askPassword("Kodall Password");
            const authRes = await client.auth({ user, password: pass });
            if (isProblem(authRes)) continue;
          }
        }
      }

      const namesToQuery = webAppNames.length > 0 ? webAppNames : [undefined];
      const allLogs: Array<{
        key: number | string;
        status?: string;
        date_created?: string;
        path?: string;
        storageFileVersionKey?: number | string;
        file_name?: string;
        _appName?: string;
      }> = [];

      for (const appName of namesToQuery) {
        const webAppFilter = appName ? `FILTER AND (name == "${appName}")` : "";
        const query = `FETCH web_app_log (key, log, uuid, status, date_created, path) {
            storage_file_version TO id_storage_file_version LINK TYPE LEFT (key AS storageFileVersionKey, file_name),
            web_app TO id_web_app ${webAppFilter}
        }`;
        const result = await client.fetch<{
          key: number | string;
          status?: string;
          date_created?: string;
          path?: string;
          storageFileVersionKey?: number | string;
          file_name?: string;
        }>(query);
        for (const entry of result) {
          allLogs.push({ ...entry, _appName: appName });
        }
      }

      // Sort newest first client-side
      allLogs.sort((a, b) => Number(b.key) - Number(a.key));

      displayServerHistory(allLogs, env, instance);
      serverUsed = true;
    } catch (err) {
      log.warn(`Could not fetch deployment history from server (${instance}): ${(err as Error).message}`);
    }
  }

  if (!serverUsed) {
    const records = getDeploymentHistory(process.cwd(), env);
    if (records.length === 0) {
      console.log(yellow(`\nNo deployment history found${env ? ` for environment "${env}"` : ""}.\n`));
    } else {
      displayHistory(records, env);
    }
  }
}
