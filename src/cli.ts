import { parseArgs } from "node:util";
import {
  DEFAULT_CONFIG_FILENAME,
  findTargetEnvironments,
  loadConfigFile,
  resolveConfig,
  saveConfigFile,
} from "./core/config.js";
import { deploy } from "./core/deployer.js";
import { DeployOptions, WebAppConfigFile } from "./core/types.js";
import { bold, cyan, dim, green, log, magenta, red, Spinner, yellow } from "./ui/logger.js";
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
      --add-env [name]      Add or update an environment in config_web_app.json
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
  $ one-deploy                      # Interactive or uses default_env
  $ one-deploy -e prod              # Deploy to production environment
  $ one-deploy --type prod          # Deploy to ALL production environments (e.g. prod-us, prod-eu)
  $ one-deploy --all                # Deploy to all configured environments
  $ one-deploy -e staging --dry-run # Validate and test staging deployment
  $ one-deploy --ci -u admin -P secret # Non-interactive CI deployment
`;

async function main() {
  const rawArgs = process.argv.slice(2);

  let explicitEnvPrompt = false;
  let explicitTypePrompt = false;
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
    "add-env": { type: "string" as const },
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
        } else if (mode === "Custom one-off deployment") {
          console.log(dim("\nEnter custom deployment parameters:\n"));
          const customInstance = await askText("ONE Framework Instance URL (e.g. https://instance.domain.com)");
          const customName = await askText("WebApp Name", loadedConfig.web_app_name || "my-app");
          const defaultPath = loadedConfig.web_app_path || (customName.startsWith("/") ? customName : `/${customName}`);
          const customPath = await askText("WebApp Path (URL route)", defaultPath);
          const customDist = await askText("Build Directory (containing index.html)", loadedConfig.dist_path || "./dist");
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

    if (!deployOpts.webAppName && !configState.resolved.web_app_name) {
      deployOpts.webAppName = await askText("WebApp Name");
      promptedAny = true;
    }

    if (!deployOpts.webAppPath && !configState.resolved.web_app_path) {
      const defaultPath = deployOpts.webAppName || configState.resolved.web_app_name || "app";
      const normalizedDefault = defaultPath.startsWith("/") ? defaultPath : `/${defaultPath}`;
      deployOpts.webAppPath = await askText("WebApp Path", normalizedDefault);
      promptedAny = true;
    }

    if (!deployOpts.instance && !configState.resolved.instance) {
      deployOpts.instance = await askText("ONE Framework Instance URL (e.g. https://instance.domain.com)");
      promptedAny = true;
    }

    if (!deployOpts.distPath && (!fileExists || !loadedConfig.dist_path)) {
      deployOpts.distPath = await askText("Build Directory (containing index.html)", "./dist");
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

  const webAppName = await askText("WebApp Name");
  const webAppPath = await askText("WebApp Path (URL route)", webAppName.startsWith("/") ? webAppName : `/${webAppName}`);
  const distPath = await askText("Build Directory (containing index.html)", "./dist");

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
    config.web_app_name = await askText("Global WebApp name", envName);
  }
  if (!config.web_app_path) {
    config.web_app_path = await askText("Global WebApp path", config.web_app_name);
  }
  if (!config.dist_path) {
    config.dist_path = "./dist";
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

main()
  .then(() => {
    process.stdin.pause();
  })
  .catch((err) => {
    log.error(`Unexpected fatal error: ${err.message}`);
    process.exit(1);
  });
