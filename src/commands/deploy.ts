import { KodallNodeClient } from "../client/kodall-node-client.js";
import { DEFAULT_OAUTH_PORT, executeBrowserOAuthLogin } from "../client/pkce-auth.js";
import { checkBuildStatus, runBuild } from "../core/build-check.js";
import { findTargetEnvironments, loadConfigFile, resolveConfig, saveConfigFile } from "../core/config.js";
import { deploy } from "../core/deployer.js";
import { detectFramework } from "../core/detector.js";
import { DeployOptions, WebAppConfigFile } from "../core/types.js";
import { bold, cyan, dim, green, log, magenta, red, Spinner, yellow } from "../ui/logger.js";
import { askConfirm, askPassword, askSelect, askText } from "../ui/prompts.js";
import { probeAuthType } from "./auth-probe.js";
import { handleInitCI } from "./ci.js";
import { handleManageEnvs } from "./envs.js";
import { displayHistoryForEnv } from "./history.js";
import { handleRollback } from "./rollback.js";
import { handleStatusDashboard } from "./status.js";

export async function ensureBuildFresh(distPath: string, flags: any, isCi: boolean): Promise<boolean> {
  if (flags["no-build"]) {
    return true;
  }

  const buildStatus = checkBuildStatus(distPath);

  if (flags.build) {
    console.log(cyan("\n▸ Executing project build (--build)..."));
    const spinner = new Spinner("Building web application...", false);
    spinner.start("Building web application...");
    const buildRes = await runBuild();
    if (!buildRes.success) {
      spinner.fail(`Build failed: ${buildRes.error}`);
      return false;
    }
    spinner.succeed(`Build completed in ${(buildRes.durationMs / 1000).toFixed(2)}s!`);
    return true;
  }

  if (isCi) {
    return true;
  }

  if (!buildStatus.exists && buildStatus.hasBuildScript) {
    const doBuild = await askConfirm(
      `Build directory "${distPath}" is missing. Run "npm run build" now?`,
      true
    );
    if (doBuild) {
      const spinner = new Spinner("Building web application...", false);
      spinner.start("Building web application...");
      const buildRes = await runBuild();
      if (!buildRes.success) {
        spinner.fail(`Build failed: ${buildRes.error}`);
        return false;
      }
      spinner.succeed(`Build completed in ${(buildRes.durationMs / 1000).toFixed(2)}s!`);
      return true;
    }
  } else if (buildStatus.isStale && buildStatus.hasBuildScript) {
    const fileHint = buildStatus.newestSourceFile ? ` (modified: ${buildStatus.newestSourceFile})` : "";
    const doBuild = await askConfirm(
      `Source files were modified after the last build${fileHint}. Rebuild before deploying?`,
      true
    );
    if (doBuild) {
      const spinner = new Spinner("Building web application...", false);
      spinner.start("Building web application...");
      const buildRes = await runBuild();
      if (!buildRes.success) {
        spinner.fail(`Build failed: ${buildRes.error}`);
        return false;
      }
      spinner.succeed(`Build completed in ${(buildRes.durationMs / 1000).toFixed(2)}s!`);
      return true;
    }
  }

  return true;
}

export async function handleDeployCommand(
  configPath: string,
  flags: any,
  promptsState: { explicitEnvPrompt?: boolean; explicitTypePrompt?: boolean } = {}
): Promise<void> {
  const isCi = flags.ci || flags["non-interactive"] || Boolean(process.env.CI);
  const { fileExists, config: loadedConfig } = loadConfigFile(configPath);

  let customDeployOpts: Partial<DeployOptions> | null = null;
  let selectedType: string | undefined = flags.type;
  let selectedAll: boolean = flags.all || false;
  let selectedEnv: string | undefined = flags.env;

  // Handle explicit -e or -t without values (prompt list directly)
  if (promptsState.explicitEnvPrompt && !isCi) {
    const envKeys = loadedConfig.environments ? Object.keys(loadedConfig.environments) : [];
    if (envKeys.length > 0) {
      const defaultEnv = loadedConfig.default_env || envKeys[0];
      const defaultIdx = Math.max(0, envKeys.indexOf(defaultEnv));
      selectedEnv = await askSelect("Select target deployment environment", envKeys, defaultIdx);
    } else {
      console.log(yellow("No environments found in configuration."));
      selectedEnv = await askText("Target environment name (e.g. dev, staging, prod)", "dev");
    }
  } else if (promptsState.explicitTypePrompt && !isCi) {
    const envKeys = loadedConfig.environments ? Object.keys(loadedConfig.environments) : [];
    const typesSet = new Set<string>();
    for (const k of envKeys) {
      const envObj = loadedConfig.environments?.[k];
      const t = envObj?.type || (k.includes("prod") ? "prod" : k.includes("staging") ? "staging" : k.includes("dev") ? "dev" : "custom");
      typesSet.add(t);
    }
    ["dev", "staging", "prod"].forEach((t) => typesSet.add(t));
    const availableTypes = Array.from(typesSet);
    selectedType = await askSelect("Select environment type to deploy", availableTypes, 0);
  }

  // If running interactively with no explicit target flags, show the main deployment menu
  if (!isCi && !flags.env && !flags.type && !flags.all && !flags.instance) {
    if (fileExists && loadedConfig.environments && Object.keys(loadedConfig.environments).length > 0) {
      const envKeys = Object.keys(loadedConfig.environments);
      const menuChoices = [
        "Select specific environment",
        "Deploy by environment type (dev / staging / prod)",
        "Deploy to ALL environments",
        "Custom one-off deployment",
        "View deployment history",
        "Rollback to a previous build",
        "Live remote status dashboard",
        "Manage environments",
        "Generate CI/CD deployment workflow",
      ];
      const BACK_OPTION = "Back";

      while (true) {
        const mode = await askSelect("How would you like to deploy?", menuChoices, 0);

        if (mode === "Select specific environment") {
          const defaultEnv = loadedConfig.default_env || envKeys[0];
          const defaultIdx = Math.max(0, envKeys.indexOf(defaultEnv));
          const chosen = await askSelect(
            "Select target deployment environment",
            [...envKeys, BACK_OPTION],
            defaultIdx
          );
          if (chosen === BACK_OPTION) {
            continue;
          }
          selectedEnv = chosen;
          break;
        } else if (mode === "Deploy by environment type (dev / staging / prod)") {
          const typesSet = new Set<string>();
          for (const k of envKeys) {
            const envObj = loadedConfig.environments[k];
            const t = envObj?.type || (k.includes("prod") ? "prod" : k.includes("staging") ? "staging" : k.includes("dev") ? "dev" : "custom");
            typesSet.add(t);
          }
          ["dev", "staging", "prod"].forEach((t) => typesSet.add(t));
          const availableTypes = Array.from(typesSet);
          const chosenType = await askSelect(
            "Select environment type to deploy",
            [...availableTypes, BACK_OPTION],
            0
          );
          if (chosenType === BACK_OPTION) {
            continue;
          }
          selectedType = chosenType;
          break;
        } else if (mode === "Deploy to ALL environments") {
          selectedAll = true;
          break;
        } else if (mode === "View deployment history") {
          const envChoices = ["All environments", ...envKeys, BACK_OPTION];
          const chosenEnv = await askSelect("View history for which environment?", envChoices, 0);
          if (chosenEnv === BACK_OPTION) {
            continue;
          }
          const filter = chosenEnv === "All environments" ? undefined : chosenEnv;
          await displayHistoryForEnv(configPath, filter, flags);
          continue;
        } else if (mode === "Rollback to a previous build") {
          await handleRollback(configPath, undefined, undefined, flags);
          return;
        } else if (mode === "Live remote status dashboard") {
          await handleStatusDashboard(configPath, undefined, flags);
          continue;
        } else if (mode === "Manage environments") {
          await handleManageEnvs(configPath);
          continue;
        } else if (mode === "Generate CI/CD deployment workflow") {
          await handleInitCI(configPath);
          continue;
        } else if (mode === "Custom one-off deployment") {
          console.log(dim("\nEnter custom deployment parameters:\n"));
          const detected = detectFramework(process.cwd());
          const customInstance = await askText("Kodall Instance URL (e.g. https://instance.domain.com)");
          const customName = await askText("WebApp Name", loadedConfig.web_app_name || detected.appName || "my-app");
          const defaultPath = loadedConfig.web_app_path || (customName.startsWith("/") ? customName : `/${customName}`);
          const customPath = await askText("WebApp Path (URL route)", defaultPath);
          const customDist = await askText("Build Directory (containing index.html)", loadedConfig.dist_path || detected.distPath || "./dist");
          const customApiKey = await askText("API Key (optional, press Enter to skip)", undefined, false);

          customDeployOpts = {
            instance: customInstance,
            webAppName: customName,
            webAppPath: customPath,
            distPath: customDist,
            apiKey: customApiKey || undefined,
          };

          const saveAsEnv = await askConfirm(`Save this as a new environment in ${configPath}?`, false);
          if (saveAsEnv) {
            const typeChoices = ["dev", "staging", "prod", "test", "custom"];
            const newEnvName = await askText("New environment name (e.g. uat, client-a, prod-eu)");
            const newEnvType = await askSelect(`Select environment type for "${newEnvName}"`, typeChoices, 0);

            if (!loadedConfig.environments) loadedConfig.environments = {};
            loadedConfig.environments[newEnvName] = {
              type: newEnvType,
              instance: customInstance,
              web_app_name: customName,
              web_app_path: customPath,
              dist_path: customDist,
              ...(customApiKey ? { api_key: customApiKey } : {}),
            };

            saveConfigFile(configPath, loadedConfig);
            log.success(`Saved environment "${newEnvName}" to ${configPath}!`);
          }
          break;
        }
      }
    }
  }

  // Check multi-environment targets (--all, --type, comma-separated -e)
  const matchedTargets = findTargetEnvironments(
    { env: selectedEnv, type: selectedType, all: selectedAll },
    loadedConfig
  );

  // Multi-environment batch deployment
  if (matchedTargets.length > 1) {
    console.log(
      bold(`Matched ${matchedTargets.length} environments: `) +
        cyan(matchedTargets.join(", "))
    );

    if (!isCi) {
      const confirmMulti = await askConfirm(
        `Deploy to all ${matchedTargets.length} environments sequentially?`,
        true
      );
      if (!confirmMulti) {
        log.warn("Deployment cancelled.");
        return;
      }
    }

    let batchUser = flags.user;
    let batchPass = flags.password;
    const targetTokens: Record<string, string> = {};
    const targetApiKeys: Record<string, string> = {};
    const realmTokens: Record<string, string> = {};

    // If running interactively, check if any target needs credentials
    if (!isCi && !flags["api-key"] && !flags.token && !flags["oidc-token"]) {
      for (const target of matchedTargets) {
        const envConf = loadedConfig.environments?.[target];
        if (envConf?.api_key || envConf?.token) continue;

        const targetInstance =
          envConf?.instance ||
          flags.instance ||
          (loadedConfig.default_env && loadedConfig.environments?.[loadedConfig.default_env]?.instance);
        const probe = await probeAuthType(targetInstance);

        if (probe.isOidc) {
          const client = new KodallNodeClient({ baseUrl: targetInstance! });
          const oidcProvider = await client.getOidcIssuer();
          if (oidcProvider) {
            const realmKey = `${oidcProvider.issuer || probe.oidcIssuer || targetInstance}::${flags["client-id"] || "account"}`;
            if (realmTokens[realmKey]) {
              targetTokens[target] = realmTokens[realmKey];
              console.log(
                `\n  ${cyan("ℹ")} [${bold(target)}] Reusing active OpenID session for realm (${dim(oidcProvider.issuer || probe.oidcIssuer || targetInstance || "")})`
              );
              continue;
            }

            console.log(
              `\n  ${cyan("ℹ")} [${bold(target)}] uses ${yellow("OAuth / OpenID Connect")} (${dim(probe.oidcIssuer || targetInstance || "")})`
            );
            console.log(dim(`\n  Opening browser for login for [${target}]...`));
            const tokens = await executeBrowserOAuthLogin({
              oidcProvider,
              clientId: flags["client-id"] || "account",
              port: DEFAULT_OAUTH_PORT,
              onAuthUrl: (url) => {
                console.log(`  ${cyan("▶")} Opening login page in browser...`);
                console.log(dim(`    If it didn't open automatically: ${url}\n`));
              },
            });
            targetTokens[target] = tokens.accessToken;
            realmTokens[realmKey] = tokens.accessToken;
            log.success(`Captured OpenID Connect access token for [${target}]!`);
            await new Promise((r) => setTimeout(r, 250));
          }
        }
      }

      const needsNativeAuth = matchedTargets.some((t) => {
        const envConf = loadedConfig.environments?.[t];
        return !envConf?.api_key && !envConf?.token && !targetTokens[t] && !targetApiKeys[t];
      });

      if (needsNativeAuth && (!batchUser || !batchPass)) {
        console.log(dim("\nEnter credentials for Kodall environments:"));
        if (!batchUser) {
          batchUser = await askText("Kodall Username", process.env.USER || process.env.USERNAME);
        }
        if (!batchPass) {
          batchPass = await askPassword("Kodall Password");
        }
      }
    }

    // Ensure build is fresh before starting batch deployment
    const effectiveBatchDist = flags.dist || loadedConfig.dist_path || "./dist";
    const buildOk = await ensureBuildFresh(effectiveBatchDist, flags, isCi);
    if (!buildOk) {
      process.exitCode = 1;
      return;
    }

    const results: Array<{ env: string; result?: any; error?: string }> = [];
    let hasFailures = false;

    for (const target of matchedTargets) {
      console.log(`\n${bold(cyan(`▶ [${target}] Deploying...`))}`);

      const deployOpts: DeployOptions = {
        configPath,
        env: target,
        instance: flags.instance,
        webAppName: flags.name,
        webAppPath: flags.path,
        distPath: flags.dist,
        username: batchUser,
        password: batchPass,
        apiKey: flags["api-key"] || targetApiKeys[target],
        token: flags.token || flags["oidc-token"] || targetTokens[target],
        ci: isCi,
        dryRun: flags["dry-run"],
        healthCheck: !flags["no-health-check"],
      };

      const spinner = new Spinner("", false);
      deployOpts.onProgress = (step, status, message) => {
        if (status === "start") spinner.start(message || `Processing ${step}...`);
        else if (status === "success") spinner.succeed(message);
        else if (status === "warn") spinner.warn(message);
        else if (status === "error") spinner.fail(message);
        else if (status === "info") {
          spinner.stop();
          if (message) log.info(message);
        }
      };

      try {
        const res = await deploy(deployOpts);
        spinner.stop();
        results.push({ env: target, result: res });
      } catch (err: any) {
        spinner.stop();
        hasFailures = true;
        const errMsg = err?.message || String(err);
        const causeMsg = err?.cause?.message ? ` (Cause: ${err.cause.message})` : "";
        results.push({ env: target, error: `${errMsg}${causeMsg}` });
        log.error(`[${target}] Failed: ${errMsg}${causeMsg}`);
        if ((flags.debug || process.env.DEBUG) && err?.stack) {
          console.error(dim(err.stack));
        }
      }
    }

    console.log(`\n${bold("================ DEPLOYMENT SUMMARY ================")}`);
    for (const item of results) {
      if (item.result) {
        const r = item.result;
        console.log(
          `  ${green("✔")} ${bold(item.env.padEnd(16))} → ${r.action || "deployed"}` +
            (r.entityKey ? ` (Key: ${r.entityKey})` : "") +
            (r.storageId ? ` (Storage: ${r.storageId})` : "") +
            dim(` [${(r.durationMs / 1000).toFixed(2)}s]`)
        );
      } else {
        console.log(`  ${red("✖")} ${bold(item.env.padEnd(16))} → ${red(item.error || "Failed")}`);
      }
    }
    console.log(bold("====================================================\n"));

    process.exitCode = hasFailures ? 1 : 0;
    return;
  }

  // Single environment target resolution
  let targetEnv = matchedTargets.length === 1 ? matchedTargets[0] : selectedEnv;

  // Prepare initial options from CLI flags or custom one-off menu
  const deployOpts: DeployOptions = {
    configPath,
    env: targetEnv,
    instance: flags.instance || customDeployOpts?.instance,
    webAppName: flags.name || customDeployOpts?.webAppName,
    webAppPath: flags.path || customDeployOpts?.webAppPath,
    distPath: flags.dist || customDeployOpts?.distPath,
    username: flags.user,
    password: flags.password,
    apiKey: flags["api-key"] || customDeployOpts?.apiKey,
    token: flags.token || flags["oidc-token"] || customDeployOpts?.token,
    otp: flags.otp || customDeployOpts?.otp,
    clientId: flags["client-id"] || customDeployOpts?.clientId,
    ci: isCi,
    dryRun: flags["dry-run"],
  };

  // Inspect resolved configuration and identify missing fields
  let configState = resolveConfig(deployOpts);

  // If running interactively, prompt for any missing required parameters
  if (!isCi) {
    let promptedAny = false;
    const detected = detectFramework(process.cwd());

    if (!deployOpts.webAppName && !configState.resolved.web_app_name) {
      deployOpts.webAppName = await askText("WebApp Name", detected.appName);
      promptedAny = true;
    }

    if (!deployOpts.webAppPath && !configState.resolved.web_app_path) {
      const defaultPath = deployOpts.webAppName || configState.resolved.web_app_name || detected.appName || "app";
      const normalizedDefault = defaultPath.startsWith("/") ? defaultPath : `/${defaultPath}`;
      deployOpts.webAppPath = await askText("WebApp Path", normalizedDefault);
      promptedAny = true;
    }

    if (!deployOpts.instance && !configState.resolved.instance) {
      deployOpts.instance = await askText("Kodall Instance URL (e.g. https://instance.domain.com)");
      promptedAny = true;
    }

    if (!deployOpts.distPath && (!fileExists || !loadedConfig.dist_path)) {
      deployOpts.distPath = await askText("Build Directory (containing index.html)", detected.distPath || "./dist");
      promptedAny = true;
    }

    // If no config file exists and we prompted for core parameters, offer to save
    if (!fileExists && promptedAny) {
      const shouldSave = await askConfirm(`Save configuration to ${configPath}?`, true);
      if (shouldSave) {
        const newConfigFile: WebAppConfigFile = {
          web_app_name: deployOpts.webAppName || configState.resolved.web_app_name,
          web_app_path: deployOpts.webAppPath || configState.resolved.web_app_path,
          dist_path: deployOpts.distPath || configState.resolved.dist_path,
          default_env: "dev",
          environments: {
            dev: {
              type: "dev",
              instance: (deployOpts.instance || configState.resolved.instance)!,
            },
          },
        };
        saveConfigFile(configPath, newConfigFile);
        log.success(`Configuration saved to ${configPath}`);
      }
    }

    configState = resolveConfig(deployOpts);

    // Check credentials: if no api_key and no token, prompt username & password if missing
    if (
      !configState.resolved.api_key &&
      !flags["api-key"] &&
      !configState.resolved.token &&
      !flags.token &&
      !flags["oidc-token"]
    ) {
      const targetInstance = deployOpts.instance || configState.resolved.instance;
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
          deployOpts.token = tokens.accessToken;
          log.success("Captured OpenID Connect access token from browser login!");
        }
      } else {
        console.log(
          `\n  ${cyan("ℹ")} ${bold("Authentication Mode:")} ${green("Kodall Basic Login")}`
        );
        if (!deployOpts.username && !configState.resolved.username) {
          deployOpts.username = await askText("Kodall Username", process.env.USER || process.env.USERNAME);
        }
        if (!deployOpts.password && !configState.resolved.password) {
          deployOpts.password = await askPassword("Kodall Password");
        }
      }
    }
  }

  // Ensure build is fresh before starting single deployment
  const effectiveSingleDist = deployOpts.distPath || configState.resolved.dist_path || "./dist";
  const buildOk = await ensureBuildFresh(effectiveSingleDist, flags, isCi);
  if (!buildOk) {
    process.exitCode = 1;
    return;
  }

  deployOpts.healthCheck = !flags["no-health-check"];

  // Spinner & progress handling
  const spinner = new Spinner("", false);

  deployOpts.onProgress = (step, status, message) => {
    if (status === "start") {
      spinner.start(message || `Processing ${step}...`);
    } else if (status === "success") {
      spinner.succeed(message);
    } else if (status === "warn") {
      spinner.warn(message);
    } else if (status === "error") {
      spinner.fail(message);
    } else if (status === "info") {
      spinner.stop();
      if (message) log.info(message);
    }
  };

  try {
    const result = await deploy(deployOpts);
    spinner.stop();

    console.log("");
    if (result.action === "dry-run") {
      log.success(
        bold(magenta("Dry-run completed successfully!")) +
          dim(` (Elapsed: ${(result.durationMs / 1000).toFixed(2)}s)`)
      );
    } else {
      log.success(
        bold(green(`Deployment successful!`)) +
          ` Action: ${bold(result.action || "deployed")}` +
          (result.entityKey ? ` (Key: ${result.entityKey})` : "") +
          (result.storageId ? ` (Storage: ${result.storageId})` : "") +
          dim(` [${(result.durationMs / 1000).toFixed(2)}s]`)
      );

      if (result.healthCheck?.ok) {
        console.log(`  ${green("✔")} ${bold("Live URL:")} ${cyan(result.healthCheck.url)} ${dim(`(${result.healthCheck.status} ${result.healthCheck.statusText})`)}`);
      } else if (result.healthCheck?.status) {
        console.log(`  ${yellow("⚠")} ${bold("Live URL check:")} ${result.healthCheck.url} ${dim(`(Status: ${result.healthCheck.status} ${result.healthCheck.statusText})`)}`);
      }
    }
    process.exitCode = 0;
  } catch (error: any) {
    spinner.stop();
    console.log("");
    log.error(bold(red("Deployment failed:")));
    const errMsg = error?.message || String(error);
    const causeMsg = error?.cause?.message ? `\n  ${dim(`Cause: ${error.cause.message}`)}` : "";
    console.error(red(`  ${errMsg}`) + causeMsg);
    if (flags.debug || process.env.DEBUG) {
      if (error?.stack) {
        console.error(dim(`\nStack trace:\n${error.stack}`));
      }
      if (error?.cause?.stack) {
        console.error(dim(`\nCause stack trace:\n${error.cause.stack}`));
      }
    } else {
      console.log(dim("\n  (Tip: Re-run with --debug for full stack trace)"));
    }
    process.exitCode = 1;
  }
}
