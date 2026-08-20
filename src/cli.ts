import { parseArgs } from "node:util";
import { checkBuildStatus, runBuild } from "./core/build-check.js";
import {
  DEFAULT_CONFIG_FILENAME,
  findTargetEnvironments,
  loadConfigFile,
  resolveConfig,
  saveConfigFile,
} from "./core/config.js";
import { deploy } from "./core/deployer.js";
import { detectFramework } from "./core/detector.js";
import {
  cloneEnvironment,
  EnvironmentInfo,
  listEnvironments,
  removeEnvironment,
  setDefaultEnvironment,
} from "./core/env-manager.js";
import { getDeploymentHistory } from "./core/history.js";
import { rollback } from "./core/rollback.js";
import { checkAllEnvironmentsStatus } from "./core/status.js";
import {
  DeploymentRecord,
  DeployOptions,
  RemoteEnvironmentStatus,
  RollbackOptions,
  WebAppConfigFile,
} from "./core/types.js";
import { bold, cyan, dim, green, log, magenta, pad, red, Spinner, yellow } from "./ui/logger.js";
import { askConfirm, askPassword, askSelect, askText } from "./ui/prompts.js";

const VERSION = "1.2.0";

const HELP_TEXT = `
${bold("kodall-one-deploy")} ${dim(`v${VERSION}`)}
Deploy web applications to ONE Framework / Kodall instances.

${bold("USAGE:")}
  $ one-deploy [options]
  $ npx kodall-one-deploy [options]

${bold("OPTIONS:")}
  -e, --env <name>          Target environment(s) (e.g., dev, prod, or comma-separated "dev,staging")
  -t, --type <type>         Deploy all environments of given type (e.g., dev, staging, prod)
      --all                 Deploy to ALL configured environments sequentially
  -i, --instance <url>      Instance base URL (e.g., https://app.domain.com)
  -n, --name <name>         WebApp name in ONE Framework
  -p, --path <path>         URL path where web app is served
  -d, --dist <dir>          Path to build directory containing index.html [default: ./dist]
  -u, --user <username>     ONE Framework login username
  -P, --password <password> ONE Framework login password
  -k, --api-key <key>       API key authentication (bypasses username/password)
  -c, --config <file>       Path to config file [default: config_web_app.json]
  -l, --list-envs           List all configured environments in a table
  -s, --status [env]        Display live status & health dashboard for environment(s)
      --add-env [name]      Add or update an environment in config_web_app.json
      --remove-env [name]   Remove an environment from configuration
      --clone-env <src> [dst] Duplicate/clone an existing environment
      --set-default <name>  Set default deployment environment
  -H, --history             Display deployment history for environment(s)
  -R, --rollback [storage]  Roll back web application to a previous storage build
      --build               Force running "npm run build" before deploying
      --no-build            Skip build check and build prompts
      --no-health-check     Skip post-deployment live HTTP health check ping
      --ci                  Non-interactive CI mode (fail if required parameters are missing)
      --dry-run             Validate build, test auth and query entity without mutating
      --init                Interactively generate or update config_web_app.json
  -v, --version             Display CLI version
  -h, --help                Display this help message

${bold("ENVIRONMENT VARIABLES:")}
  ONE_ENV, KODALL_ENV               Target environment name
  ONE_INSTANCE, KODALL_INSTANCE     Instance URL
  ONE_APP_NAME, KODALL_APP_NAME     WebApp name
  ONE_APP_PATH, KODALL_APP_PATH     WebApp URL path
  ONE_DIST_PATH, KODALL_DIST_PATH   Build directory path
  ONE_USERNAME, ONE_USER            Login username
  ONE_PASSWORD                      Login password
  ONE_API_KEY, KODALL_API_KEY       API key

${bold("EXAMPLES:")}
  $ one-deploy                      # Interactive deployment menu
  $ one-deploy -e prod              # Deploy to production environment
  $ one-deploy --type prod          # Deploy to ALL production environments (e.g. prod-us, prod-eu)
  $ one-deploy --all                # Deploy to all configured environments
  $ one-deploy -H -e prod           # View deployment history for production
  $ one-deploy --rollback -e prod   # Interactively roll back prod to a previous build
  $ one-deploy --rollback 137       # Roll back directly to storage ID 137
  $ one-deploy -e staging --dry-run # Validate and test staging deployment
  $ one-deploy --ci -u admin -P secret # Non-interactive CI deployment
`;

async function main() {
  const rawArgs = process.argv.slice(2);

  let explicitEnvPrompt = false;
  let explicitTypePrompt = false;
  let explicitHistory = false;
  let explicitRollback = false;
  let rollbackStorageId: string | undefined;
  let explicitListEnvs = false;
  let explicitStatus = false;
  let statusEnvName: string | undefined;
  let explicitRemoveEnv = false;
  let removeEnvName: string | undefined;
  let explicitCloneEnv = false;
  let cloneSource: string | undefined;
  let cloneTarget: string | undefined;
  let explicitSetDefault = false;
  let setDefaultEnvName: string | undefined;
  const args: string[] = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === "-e" || arg === "--env") {
      const nextArg = rawArgs[i + 1];
      if (!nextArg || nextArg.startsWith("-")) {
        explicitEnvPrompt = true;
        continue;
      }
    }
    if (arg === "-t" || arg === "--type") {
      const nextArg = rawArgs[i + 1];
      if (!nextArg || nextArg.startsWith("-")) {
        explicitTypePrompt = true;
        continue;
      }
    }
    if (arg === "-l" || arg === "--list-envs" || arg === "--list") {
      explicitListEnvs = true;
      continue;
    }
    if (arg === "-s" || arg === "--status") {
      const nextArg = rawArgs[i + 1];
      if (nextArg && !nextArg.startsWith("-")) {
        statusEnvName = nextArg;
        i++;
      }
      explicitStatus = true;
      continue;
    }
    if (arg.startsWith("--status=") || arg.startsWith("-s=")) {
      statusEnvName = arg.split("=")[1];
      explicitStatus = true;
      continue;
    }
    if (arg === "--remove-env" || arg === "--delete-env") {
      const nextArg = rawArgs[i + 1];
      if (nextArg && !nextArg.startsWith("-")) {
        removeEnvName = nextArg;
        i++;
      }
      explicitRemoveEnv = true;
      continue;
    }
    if (arg.startsWith("--remove-env=")) {
      removeEnvName = arg.split("=")[1];
      explicitRemoveEnv = true;
      continue;
    }
    if (arg === "--clone-env" || arg === "--copy-env") {
      const src = rawArgs[i + 1];
      const dst = rawArgs[i + 2];
      if (src && !src.startsWith("-")) {
        cloneSource = src;
        i++;
        if (dst && !dst.startsWith("-")) {
          cloneTarget = dst;
          i++;
        }
      }
      explicitCloneEnv = true;
      continue;
    }
    if (arg.startsWith("--clone-env=")) {
      const val = arg.split("=")[1];
      if (val) cloneSource = val;
      explicitCloneEnv = true;
      continue;
    }
    if (arg === "--set-default") {
      const nextArg = rawArgs[i + 1];
      if (nextArg && !nextArg.startsWith("-")) {
        setDefaultEnvName = nextArg;
        i++;
      }
      explicitSetDefault = true;
      continue;
    }
    if (arg.startsWith("--set-default=")) {
      setDefaultEnvName = arg.split("=")[1];
      explicitSetDefault = true;
      continue;
    }
    if (arg === "-H" || arg === "--history") {
      explicitHistory = true;
      continue;
    }
    if (arg === "-R" || arg === "--rollback") {
      const nextArg = rawArgs[i + 1];
      if (nextArg && !nextArg.startsWith("-")) {
        rollbackStorageId = nextArg;
        i++;
      } else {
        explicitRollback = true;
      }
      continue;
    }
    if (arg.startsWith("--rollback=")) {
      const val = arg.split("=")[1];
      if (val) {
        rollbackStorageId = val;
      } else {
        explicitRollback = true;
      }
      continue;
    }
    if (arg.startsWith("-e=") || arg.startsWith("--env=")) {
      const val = arg.split("=")[1];
      if (!val) {
        explicitEnvPrompt = true;
        continue;
      }
    }
    if (arg.startsWith("-t=") || arg.startsWith("--type=")) {
      const val = arg.split("=")[1];
      if (!val) {
        explicitTypePrompt = true;
        continue;
      }
    }
    args.push(arg);
  }

  const optionsSchema = {
    env: { type: "string" as const, short: "e" },
    type: { type: "string" as const, short: "t" },
    all: { type: "boolean" as const, default: false },
    instance: { type: "string" as const, short: "i" },
    name: { type: "string" as const, short: "n" },
    path: { type: "string" as const, short: "p" },
    dist: { type: "string" as const, short: "d" },
    user: { type: "string" as const, short: "u" },
    password: { type: "string" as const, short: "P" },
    "api-key": { type: "string" as const, short: "k" },
    config: { type: "string" as const, short: "c" },
    "list-envs": { type: "boolean" as const, short: "l", default: false },
    status: { type: "string" as const, short: "s" },
    "add-env": { type: "string" as const },
    "remove-env": { type: "string" as const },
    "clone-env": { type: "string" as const },
    "set-default": { type: "string" as const },
    history: { type: "boolean" as const, short: "H", default: false },
    rollback: { type: "string" as const, short: "R" },
    build: { type: "boolean" as const, default: false },
    "no-build": { type: "boolean" as const, default: false },
    "health-check": { type: "boolean" as const, default: true },
    "no-health-check": { type: "boolean" as const, default: false },
    ci: { type: "boolean" as const, default: false },
    "non-interactive": { type: "boolean" as const, default: false },
    "dry-run": { type: "boolean" as const, default: false },
    init: { type: "boolean" as const, default: false },
    version: { type: "boolean" as const, short: "v", default: false },
    help: { type: "boolean" as const, short: "h", default: false },
  };

  let parsed: ReturnType<typeof parseArgs<{ options: typeof optionsSchema }>>;
  try {
    parsed = parseArgs({
      args,
      options: optionsSchema,
      allowPositionals: false,
    });
  } catch (err) {
    log.error((err as Error).message);
    console.log(dim("Run 'one-deploy --help' for usage."));
    process.exit(1);
  }

  const flags = parsed.values;

  if (flags.help) {
    console.log(HELP_TEXT);
    return;
  }

  if (flags.version) {
    console.log(VERSION);
    return;
  }

  const isCi = flags.ci || flags["non-interactive"] || Boolean(process.env.CI);
  const configPath = flags.config || DEFAULT_CONFIG_FILENAME;

  console.log(`\n${bold(cyan("▶"))} ${bold("ONE Framework / Kodall Deployer")} ${dim(`v${VERSION}`)}\n`);

  // Handle --list-envs command
  if (flags["list-envs"] || explicitListEnvs) {
    await handleListEnvs(configPath);
    return;
  }

  // Handle --status command
  if (flags.status !== undefined || explicitStatus) {
    const targetEnv = statusEnvName || flags.status || flags.env;
    await handleStatusDashboard(configPath, targetEnv, flags);
    return;
  }

  // Handle --remove-env command
  if (flags["remove-env"] !== undefined || explicitRemoveEnv) {
    await handleRemoveEnv(configPath, removeEnvName || flags["remove-env"] || undefined);
    return;
  }

  // Handle --clone-env command
  if (flags["clone-env"] !== undefined || explicitCloneEnv) {
    await handleCloneEnv(configPath, cloneSource || flags["clone-env"] || undefined, cloneTarget);
    return;
  }

  // Handle --set-default command
  if (flags["set-default"] !== undefined || explicitSetDefault) {
    await handleSetDefault(configPath, setDefaultEnvName || flags["set-default"] || undefined);
    return;
  }

  // Handle --history command
  if (flags.history || explicitHistory) {
    const targetEnv = flags.env;
    const records = getDeploymentHistory(process.cwd(), targetEnv);
    displayHistory(records, targetEnv);
    return;
  }

  // Handle --rollback command
  if (flags.rollback !== undefined || explicitRollback || rollbackStorageId) {
    const targetStorage = rollbackStorageId || flags.rollback;
    await handleRollback(configPath, targetStorage, flags.env, flags);
    return;
  }

  // Handle --add-env command
  if (flags["add-env"] !== undefined) {
    await handleAddEnv(configPath, flags["add-env"] || undefined);
    return;
  }

  // Handle --init command
  if (flags.init) {
    await handleInit(configPath);
    return;
  }

  // Load existing config if available
  const { fileExists, config: loadedConfig } = loadConfigFile(configPath);

  let customDeployOpts: Partial<DeployOptions> | null = null;
  let selectedType: string | undefined = flags.type;
  let selectedAll: boolean = flags.all || false;
  let selectedEnv: string | undefined = flags.env;

  // Handle explicit -e or -t without values (prompt list directly)
  if (explicitEnvPrompt && !isCi) {
    const envKeys = loadedConfig.environments ? Object.keys(loadedConfig.environments) : [];
    if (envKeys.length > 0) {
      const defaultEnv = loadedConfig.default_env || envKeys[0];
      const defaultIdx = Math.max(0, envKeys.indexOf(defaultEnv));
      selectedEnv = await askSelect("Select target deployment environment", envKeys, defaultIdx);
    } else {
      console.log(yellow("No environments found in configuration."));
      selectedEnv = await askText("Target environment name (e.g. dev, staging, prod)", "dev");
    }
  } else if (explicitTypePrompt && !isCi) {
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
        "📜 View deployment history",
        "⏮️  Rollback to a previous build",
        "📊 Live remote status dashboard",
        "⚙️  Manage environments",
      ];
      const BACK_OPTION = "↩ Back";

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
        } else if (mode === "📜 View deployment history") {
          const envChoices = ["All environments", ...envKeys, BACK_OPTION];
          const chosenEnv = await askSelect("View history for which environment?", envChoices, 0);
          if (chosenEnv === BACK_OPTION) {
            continue;
          }
          const filter = chosenEnv === "All environments" ? undefined : chosenEnv;
          displayHistory(getDeploymentHistory(process.cwd(), filter), filter);
          continue;
        } else if (mode === "⏮️  Rollback to a previous build") {
          await handleRollback(configPath, undefined, undefined, flags);
          return;
        } else if (mode === "📊 Live remote status dashboard") {
          await handleStatusDashboard(configPath, undefined, flags);
          continue;
        } else if (mode === "⚙️  Manage environments") {
          await handleManageEnvs(configPath);
          continue;
        } else if (mode === "Custom one-off deployment") {
          console.log(dim("\nEnter custom deployment parameters:\n"));
          const detected = detectFramework(process.cwd());
          const customInstance = await askText("ONE Framework Instance URL (e.g. https://instance.domain.com)");
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

          const saveAsEnv = await askConfirm("Save this as a new environment in config_web_app.json?", false);
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

    // If running interactively, check if any target needs credentials
    if (!isCi && !flags["api-key"]) {
      const needsAuth = matchedTargets.some((t) => {
        const envConf = loadedConfig.environments?.[t];
        return !envConf?.api_key && !loadedConfig.api_key;
      });

      if (needsAuth && (!batchUser || !batchPass)) {
        console.log(dim("\nEnter credentials for environments without configured API keys:"));
        if (!batchUser) {
          batchUser = await askText("ONE Username", process.env.USER || process.env.USERNAME);
        }
        if (!batchPass) {
          batchPass = await askPassword("ONE Password");
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
        apiKey: flags["api-key"],
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
      } catch (err) {
        spinner.stop();
        hasFailures = true;
        results.push({ env: target, error: (err as Error).message });
        log.error(`[${target}] Failed: ${(err as Error).message}`);
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
      deployOpts.instance = await askText("ONE Framework Instance URL (e.g. https://instance.domain.com)");
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
          instance: deployOpts.instance || configState.resolved.instance,
          dist_path: deployOpts.distPath || configState.resolved.dist_path,
        };
        saveConfigFile(configPath, newConfigFile);
        log.success(`Configuration saved to ${configPath}`);
      }
    }

    configState = resolveConfig(deployOpts);

    // Check credentials: if no api_key, prompt username & password if missing
    if (!configState.resolved.api_key && !flags["api-key"]) {
      if (!deployOpts.username && !configState.resolved.username) {
        deployOpts.username = await askText("ONE Username", process.env.USER || process.env.USERNAME);
      }
      if (!deployOpts.password && !configState.resolved.password) {
        deployOpts.password = await askPassword("ONE Password");
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
  } catch (error) {
    spinner.stop();
    console.log("");
    log.error(bold(red("Deployment failed:")));
    console.error(dim((error as Error).message || String(error)));
    process.exitCode = 1;
  }
}

async function handleInit(configPath: string) {
  const { fileExists } = loadConfigFile(configPath);

  if (fileExists) {
    console.log(yellow(`Found existing configuration at ${configPath}.`));
    const action = await askSelect("What would you like to do?", [
      "Add / update an environment",
      "Re-initialize / overwrite configuration",
    ]);

    if (action === "Add / update an environment") {
      await handleAddEnv(configPath);
      return;
    }
  }

  console.log(bold("Initialize ONE Deploy Configuration:\n"));

  const detected = detectFramework(process.cwd());
  console.log(
    dim("  " + "─".repeat(50)) + "\n" +
    `  ${cyan("ℹ")} ${bold("Detected Project:")}   ${bold(green(detected.framework))}\n` +
    `  ${cyan("▸")} ${dim("Suggested App Name:")} ${cyan(detected.appName)}\n` +
    `  ${cyan("▸")} ${dim("Build Output Path:")}  ${cyan(detected.distPath)}\n` +
    dim("  " + "─".repeat(50)) + "\n"
  );

  const webAppName = await askText("WebApp Name", detected.appName);
  const defaultPath = webAppName.startsWith("/") ? webAppName : `/${webAppName}`;
  const webAppPath = await askText("WebApp Path (URL route)", defaultPath);
  const distPath = await askText("Build Directory (containing index.html)", detected.distPath || "./dist");

  const multiEnv = await askConfirm("Do you want to configure multiple environments (dev, staging, prod, custom)?", true);

  if (!multiEnv) {
    const instance = await askText("Instance URL (e.g. https://instance.domain.com)");
    const apiKey = await askText("API Key (optional, press enter to skip)", undefined, false);

    const cfg: WebAppConfigFile = {
      web_app_name: webAppName,
      web_app_path: webAppPath,
      instance,
      dist_path: distPath,
      ...(apiKey ? { api_key: apiKey } : {}),
    };

    saveConfigFile(configPath, cfg);
    log.success(`Configuration written to ${configPath}`);
    return;
  }

  const envs: Record<string, any> = {};

  // Setup helper for an environment
  const configureEnv = async (envName: string, defaultUrl?: string, defaultType?: string) => {
    console.log(`\n${cyan(`▸ Configuring [${envName}] environment:`)}`);
    const typeChoices = ["dev", "staging", "prod", "test", "custom"];
    const inferredType = defaultType || (envName.toLowerCase().includes("prod") ? "prod" : envName.toLowerCase().includes("staging") ? "staging" : envName.toLowerCase().includes("dev") ? "dev" : "custom");
    const defaultIdx = Math.max(0, typeChoices.indexOf(inferredType));
    
    let envType = await askSelect(`Select environment type for "${envName}"`, typeChoices, defaultIdx);
    if (envType === "custom") {
      envType = await askText("Custom type name", "custom");
    }

    const instance = await askText(`Instance URL for "${envName}"`, defaultUrl);
    
    // Ask if custom path or inherit default
    const customPath = await askText(
      `Custom URL path for "${envName}" (press Enter to inherit "${webAppPath}")`,
      undefined,
      false
    );

    // Ask if custom build dist or inherit default
    const customDist = await askText(
      `Custom build directory for "${envName}" (press Enter to inherit "${distPath}")`,
      undefined,
      false
    );

    const apiKey = await askText(`API Key for "${envName}" (optional, press Enter to skip)`, undefined, false);

    envs[envName] = {
      ...(envType ? { type: envType } : {}),
      instance,
      ...(customPath ? { web_app_path: customPath.startsWith("/") ? customPath : `/${customPath}` } : {}),
      ...(customDist ? { dist_path: customDist } : {}),
      ...(apiKey ? { api_key: apiKey } : {}),
    };
  };

  // Configure dev
  await configureEnv("dev", "https://dev.instance.kodall.ro", "dev");

  // Configure staging
  const addStaging = await askConfirm("Add staging environment?", true);
  if (addStaging) {
    await configureEnv("staging", "https://staging.instance.kodall.ro", "staging");
  }

  // Configure prod
  const addProd = await askConfirm("Add prod environment?", true);
  if (addProd) {
    await configureEnv("prod", "https://app.instance.kodall.ro", "prod");
  }

  // Allow adding any additional custom environments
  while (true) {
    const addAnother = await askConfirm("Add another custom environment (e.g. client-a, qa, prod-eu)?", false);
    if (!addAnother) break;
    const customEnvName = await askText("Custom environment name");
    await configureEnv(customEnvName);
  }

  const envNames = Object.keys(envs);
  const defaultEnv = envNames.length > 1
    ? await askSelect("Select default deployment environment", envNames, 0)
    : envNames[0];

  const config: WebAppConfigFile = {
    web_app_name: webAppName,
    web_app_path: webAppPath,
    dist_path: distPath,
    default_env: defaultEnv,
    environments: envs,
  };

  saveConfigFile(configPath, config);
  console.log("");
  log.success(`Multi-environment configuration written to ${configPath}`);
}

async function handleAddEnv(configPath: string, initialEnvName?: string) {
  const { fileExists, config } = loadConfigFile(configPath);

  if (!fileExists) {
    console.log(yellow(`No ${configPath} found. Creating a new multi-environment configuration.`));
  }

  let envName = initialEnvName;
  const existingEnvs = config.environments ? Object.keys(config.environments) : [];

  if (!envName) {
    if (existingEnvs.length > 0) {
      const NEW_OPTION = "➕ Add new environment...";
      const selected = await askSelect(
        "Select an existing environment to edit or add a new one",
        [...existingEnvs, NEW_OPTION]
      );

      if (selected === NEW_OPTION) {
        envName = await askText("Environment name (e.g. uat, client-a, prod-eu)");
      } else {
        envName = selected;
      }
    } else {
      envName = await askText("Environment name to add (e.g. dev, staging, prod, client-a)");
    }
  }

  const existingData = config.environments?.[envName] || {};
  const typeChoices = ["dev", "staging", "prod", "test", "custom"];
  const inferredType =
    existingData.type ||
    (envName.toLowerCase().includes("prod")
      ? "prod"
      : envName.toLowerCase().includes("staging")
      ? "staging"
      : envName.toLowerCase().includes("dev")
      ? "dev"
      : "custom");

  const defaultIdx = Math.max(0, typeChoices.indexOf(inferredType));
  let envType = await askSelect(`Select environment type for "${envName}"`, typeChoices, defaultIdx);
  if (envType === "custom") {
    envType = await askText("Custom type name", existingData.type || "custom");
  }

  const instanceUrl = await askText(
    `Instance URL for "${envName}"`,
    existingData.instance || "https://dev.instance.kodall.ro"
  );

  const customPath = await askText(
    `Custom WebApp path for "${envName}" (press Enter to use "${config.web_app_path || "default"}")`,
    existingData.web_app_path,
    false
  );

  const apiKey = await askText(
    `API Key for "${envName}" (optional, press Enter to skip)`,
    existingData.api_key,
    false
  );

  const customDist = await askText(
    `Custom build path for "${envName}" (press Enter to use "${config.dist_path || "./dist"}")`,
    existingData.dist_path,
    false
  );

  if (!config.environments) {
    config.environments = {};
  }

  if (!config.web_app_name) {
    const detected = detectFramework(process.cwd());
    config.web_app_name = await askText("Global WebApp name", detected.appName || envName);
  }
  if (!config.web_app_path) {
    const defaultPath = config.web_app_name.startsWith("/") ? config.web_app_name : `/${config.web_app_name}`;
    config.web_app_path = await askText("Global WebApp path", defaultPath);
  }
  if (!config.dist_path) {
    const detected = detectFramework(process.cwd());
    config.dist_path = detected.distPath || "./dist";
  }
  if (!config.default_env) {
    config.default_env = envName;
  }

  config.environments[envName] = {
    ...(envType ? { type: envType } : {}),
    instance: instanceUrl,
    ...(customPath ? { web_app_path: customPath.startsWith("/") ? customPath : `/${customPath}` } : {}),
    ...(apiKey ? { api_key: apiKey } : {}),
    ...(customDist ? { dist_path: customDist } : {}),
  };

  saveConfigFile(configPath, config);
  console.log("");
  log.success(`Environment "${envName}" saved to ${configPath}!`);
}

async function ensureBuildFresh(distPath: string, flags: any, isCi: boolean): Promise<boolean> {
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

function displayHistory(records: DeploymentRecord[], envFilter?: string): void {
  if (records.length === 0) {
    console.log(yellow(`\nNo deployment history found${envFilter ? ` for environment "${envFilter}"` : ""}.`));
    console.log(dim("Deployments are automatically recorded to .one-deploy-history.json on success.\n"));
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

  console.log(`\n${bold(cyan("📜 Deployment History"))}${envFilter ? dim(` (filter: ${envFilter})`) : ""}:\n`);

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

async function handleRollback(
  configPath: string,
  targetStorageId?: string | number,
  initialEnv?: string,
  flags: any = {}
) {
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

  const envHistory = getDeploymentHistory(process.cwd(), targetEnv);
  let selectedStorageId = targetStorageId;

  if (!selectedStorageId) {
    if (envHistory.length === 0) {
      console.log(yellow(`\nNo deployment history found${targetEnv ? ` for environment "${targetEnv}"` : ""}.`));
      selectedStorageId = await askText("Storage ID to roll back to (e.g. 137)");
    } else {
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
    }
  }

  if (!selectedStorageId) {
    log.error("No storage ID specified for rollback.");
    return;
  }

  let user = flags.user;
  let pass = flags.password;

  const envConf = targetEnv && loadedConfig.environments ? loadedConfig.environments[targetEnv] : loadedConfig;
  if (!flags["api-key"] && !envConf?.api_key) {
    if (!user) user = await askText("ONE Username", process.env.USER || process.env.USERNAME);
    if (!pass) pass = await askPassword("ONE Password");
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

function displayEnvsTable(envs: EnvironmentInfo[]): void {
  if (envs.length === 0) {
    console.log(yellow("\nNo environments configured. Run 'one-deploy --init' or '--add-env' to add one.\n"));
    return;
  }

  console.log(`\n${bold(cyan("⚙️  Configured Environments:"))}\n`);
  console.log(
    "  " +
      dim(
        pad("DEFAULT", 10) +
        pad("ENV NAME", 18) +
        pad("TYPE", 14) +
        pad("AUTH", 14) +
        pad("ROUTE PATH", 24) +
        "INSTANCE URL"
      )
  );
  console.log(dim("  " + "─".repeat(120)));

  for (const env of envs) {
    const defaultTag = env.isDefault ? green(bold("  ★")) : "";
    const nameStr = env.isDefault ? bold(cyan(env.name)) : bold(env.name);
    const typeStr =
      env.type === "prod"
        ? red(env.type)
        : env.type === "staging"
        ? yellow(env.type)
        : cyan(env.type);

    const authStr = env.hasApiKey ? green("API Key") : dim("Username");
    const routeStr = env.webAppPath || "/";
    const instanceStr = env.instance || "-";

    console.log(
      "  " +
        pad(defaultTag, 10) +
        pad(nameStr, 18) +
        pad(typeStr, 14) +
        pad(authStr, 14) +
        pad(routeStr, 24) +
        dim(instanceStr)
    );
  }
  console.log("");
}

async function handleListEnvs(configPath: string) {
  const envs = listEnvironments(configPath);
  displayEnvsTable(envs);
}

function displayStatusDashboard(statuses: RemoteEnvironmentStatus[]): void {
  if (statuses.length === 0) {
    console.log(yellow("\nNo environments configured to check.\n"));
    return;
  }

  console.log(`\n${bold(cyan("📊 Live Remote Environment Status:"))}\n`);
  console.log(
    "  " +
      dim(
        pad("DEFAULT", 10) +
        pad("ENV NAME", 16) +
        pad("HEALTH", 16) +
        pad("HTTP CODE", 16) +
        pad("LATENCY", 12) +
        pad("STORAGE ID", 14) +
        pad("ENTITY KEY", 14) +
        pad("ROUTE PATH", 20) +
        "INSTANCE URL"
      )
  );
  console.log(dim("  " + "─".repeat(150)));

  for (const s of statuses) {
    const defaultTag = s.isDefault ? green(bold("  ★")) : "";
    const nameStr = s.isDefault ? bold(cyan(s.env)) : bold(s.env);

    let healthBadge: string;
    if (s.state === "ONLINE") {
      healthBadge = green(bold("● ONLINE"));
    } else if (s.state === "NOT_FOUND") {
      healthBadge = yellow("○ NOT FOUND");
    } else if (s.state === "PROTECTED") {
      healthBadge = yellow("🔒 PROTECTED");
    } else if (s.state === "OFFLINE") {
      healthBadge = red("○ OFFLINE");
    } else {
      healthBadge = red("▲ ERROR");
    }

    const httpCodeStr =
      s.httpStatus > 0
        ? `${s.httpStatus} ${s.httpStatusText}`
        : s.error
        ? dim("Unreachable")
        : dim("No resp");

    const latencyStr = s.latencyMs > 0 ? `${s.latencyMs}ms` : "-";
    const storageStr = s.storageId !== undefined ? cyan(String(s.storageId)) : dim("-");
    const entityStr = s.entityKey !== undefined ? dim(String(s.entityKey)) : dim("-");
    const routeStr = s.webAppPath || "/";
    const instanceStr = s.instanceUrl || "-";

    console.log(
      "  " +
        pad(defaultTag, 10) +
        pad(nameStr, 16) +
        pad(healthBadge, 16) +
        pad(httpCodeStr, 16) +
        pad(latencyStr, 12) +
        pad(storageStr, 14) +
        pad(entityStr, 14) +
        pad(routeStr, 20) +
        dim(instanceStr)
    );
  }
  console.log("");
}

async function handleStatusDashboard(configPath: string, envFilter?: string, flags?: any) {
  const spinner = new Spinner("Pinging remote instances and checking live status...", false);
  spinner.start("Pinging remote instances and checking live status...");

  try {
    const statuses = await checkAllEnvironmentsStatus(
      configPath,
      envFilter,
      process.cwd(),
      flags?.user && flags?.password ? { username: flags.user, password: flags.password } : undefined
    );
    spinner.stop();
    displayStatusDashboard(statuses);
  } catch (err: any) {
    spinner.stop();
    log.error(`Status check failed: ${err.message}`);
  }
}

async function handleRemoveEnv(configPath: string, envName?: string) {
  const { fileExists, config } = loadConfigFile(configPath);
  if (!fileExists || !config.environments || Object.keys(config.environments).length === 0) {
    log.error(`No environments found in ${configPath}`);
    return;
  }

  let target = envName;
  const envKeys = Object.keys(config.environments);

  if (!target) {
    target = await askSelect("Select environment to remove", envKeys, 0);
  }

  if (!config.environments[target]) {
    log.error(`Environment "${target}" does not exist in ${configPath}`);
    return;
  }

  const confirm = await askConfirm(`Are you sure you want to delete environment "${target}"?`, false);
  if (!confirm) {
    log.info("Cancelled.");
    return;
  }

  const res = removeEnvironment(target, configPath);
  log.success(`Environment "${target}" removed from ${configPath}!`);
  if (res.newDefault) {
    log.info(`New default environment: "${res.newDefault}"`);
  }
}

async function handleCloneEnv(configPath: string, sourceName?: string, targetName?: string) {
  const { fileExists, config } = loadConfigFile(configPath);
  if (!fileExists || !config.environments || Object.keys(config.environments).length === 0) {
    log.error(`No environments found in ${configPath}`);
    return;
  }

  const envKeys = Object.keys(config.environments);
  let src = sourceName;
  if (!src) {
    src = await askSelect("Select source environment to clone", envKeys, 0);
  }

  if (!config.environments[src]) {
    log.error(`Source environment "${src}" does not exist in ${configPath}`);
    return;
  }

  let dst = targetName;
  if (!dst) {
    dst = await askText(`New environment name (cloned from "${src}")`);
  }

  if (config.environments[dst]) {
    log.error(`Target environment "${dst}" already exists in ${configPath}`);
    return;
  }

  const srcData = config.environments[src];
  const newInstance = await askText(`Instance URL for "${dst}"`, srcData.instance || "https://dev.instance.kodall.ro");
  const newPath = await askText(`URL route for "${dst}" (press Enter to inherit "${srcData.web_app_path || config.web_app_path || "/app"}")`, srcData.web_app_path, false);
  const newApiKey = await askText(`API Key for "${dst}" (optional, press Enter to inherit)`, srcData.api_key, false);

  cloneEnvironment(
    src,
    dst,
    {
      instance: newInstance,
      ...(newPath ? { web_app_path: newPath.startsWith("/") ? newPath : `/${newPath}` } : {}),
      ...(newApiKey ? { api_key: newApiKey } : {}),
    },
    configPath
  );

  log.success(`Environment "${dst}" created (cloned from "${src}") in ${configPath}!`);
}

async function handleSetDefault(configPath: string, envName?: string) {
  const { fileExists, config } = loadConfigFile(configPath);
  if (!fileExists || !config.environments || Object.keys(config.environments).length === 0) {
    log.error(`No environments found in ${configPath}`);
    return;
  }

  const envKeys = Object.keys(config.environments);
  let target = envName;
  if (!target) {
    target = await askSelect("Select environment to set as default", envKeys, 0);
  }

  if (!config.environments[target]) {
    log.error(`Environment "${target}" does not exist in ${configPath}`);
    return;
  }

  setDefaultEnvironment(target, configPath);
  log.success(`Default environment set to "${target}" in ${configPath}!`);
}

async function handleManageEnvs(configPath: string) {
  const BACK_OPTION = "↩ Back";
  const choices = [
    "📋 List configured environments",
    "➕ Add or edit an environment",
    "🗑️  Remove an environment",
    "📑 Clone / duplicate an environment",
    "⭐ Set default environment",
    BACK_OPTION,
  ];

  while (true) {
    const action = await askSelect("Environment Management:", choices, 0);
    if (action === BACK_OPTION) {
      break;
    } else if (action === "📋 List configured environments") {
      await handleListEnvs(configPath);
    } else if (action === "➕ Add or edit an environment") {
      await handleAddEnv(configPath);
    } else if (action === "🗑️  Remove an environment") {
      await handleRemoveEnv(configPath);
    } else if (action === "📑 Clone / duplicate an environment") {
      await handleCloneEnv(configPath);
    } else if (action === "⭐ Set default environment") {
      await handleSetDefault(configPath);
    }
  }
}

main()
  .then(() => {
    process.stdin.pause();
  })
  .catch((err) => {
    log.error(`Unexpected fatal error: ${err.message}`);
    process.exit(1);
  });
