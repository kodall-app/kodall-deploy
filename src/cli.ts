import { parseArgs } from "node:util";
import {
  DEFAULT_CONFIG_FILENAME,
  loadConfigFile,
  resolveConfig,
  saveConfigFile,
} from "./core/config.js";
import { deploy } from "./core/deployer.js";
import { DeployOptions, WebAppConfigFile } from "./core/types.js";
import { bold, cyan, dim, green, log, magenta, red, Spinner } from "./ui/logger.js";
import { askConfirm, askPassword, askSelect, askText } from "./ui/prompts.js";

const VERSION = "1.2.0";

const HELP_TEXT = `
${bold("kodall-one-deploy")} ${dim(`v${VERSION}`)}
Deploy web applications to ONE Framework / Kodall instances.

${bold("USAGE:")}
  $ one-deploy [options]
  $ npx kodall-one-deploy [options]

${bold("OPTIONS:")}
  -e, --env <name>          Target environment (e.g., dev, staging, prod)
  -i, --instance <url>      Instance base URL (e.g., https://app.domain.com)
  -n, --name <name>         WebApp name in ONE Framework
  -p, --path <path>         URL path where web app is served
  -d, --dist <dir>          Path to build directory containing index.html [default: ./dist]
  -u, --user <username>     ONE Framework login username
  -P, --password <password> ONE Framework login password
  -k, --api-key <key>       API key authentication (bypasses username/password)
  -c, --config <file>       Path to config file [default: config_web_app.json]
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
  $ one-deploy -e staging --dry-run # Validate and test staging deployment
  $ one-deploy --ci -u admin -P secret # Non-interactive CI deployment
`;

async function main() {
  const args = process.argv.slice(2);

  const optionsSchema = {
    env: { type: "string" as const, short: "e" },
    instance: { type: "string" as const, short: "i" },
    name: { type: "string" as const, short: "n" },
    path: { type: "string" as const, short: "p" },
    dist: { type: "string" as const, short: "d" },
    user: { type: "string" as const, short: "u" },
    password: { type: "string" as const, short: "P" },
    "api-key": { type: "string" as const, short: "k" },
    config: { type: "string" as const, short: "c" },
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
    process.exit(0);
  }

  if (flags.version) {
    console.log(VERSION);
    process.exit(0);
  }

  const isCi = flags.ci || flags["non-interactive"] || Boolean(process.env.CI);
  const configPath = flags.config || DEFAULT_CONFIG_FILENAME;

  console.log(`\n${bold(cyan("▶"))} ${bold("ONE Framework / Kodall Deployer")} ${dim(`v${VERSION}`)}\n`);

  // Handle --init command
  if (flags.init) {
    await handleInit(configPath);
    process.exit(0);
  }

  // Load existing config if available
  const { fileExists, config: loadedConfig } = loadConfigFile(configPath);

  let targetEnv = flags.env;

  // If no env flag provided, but multiple environments exist in config, prompt user
  if (!targetEnv && !isCi && loadedConfig.environments) {
    const envKeys = Object.keys(loadedConfig.environments);
    if (envKeys.length > 1) {
      const defaultEnv = loadedConfig.default_env || envKeys[0];
      const defaultIdx = Math.max(0, envKeys.indexOf(defaultEnv));
      targetEnv = await askSelect(
        "Select target deployment environment",
        envKeys,
        defaultIdx
      );
    }
  }

  // Prepare initial options from CLI flags
  const deployOpts: DeployOptions = {
    configPath,
    env: targetEnv,
    instance: flags.instance,
    webAppName: flags.name,
    webAppPath: flags.path,
    distPath: flags.dist,
    username: flags.user,
    password: flags.password,
    apiKey: flags["api-key"],
    ci: isCi,
    dryRun: flags["dry-run"],
  };

  // Inspect resolved configuration and identify missing fields
  let configState = resolveConfig(deployOpts);

  // If running interactively and config is missing base parameters, run interactive wizard
  if (!isCi) {
    if (!fileExists && !configState.resolved.instance) {
      console.log(dim("No configuration file found. Setting up web app parameters:\n"));

      const webAppName = await askText("WebApp Name", configState.resolved.web_app_name);
      const webAppPath = await askText("WebApp Path", configState.resolved.web_app_path || webAppName);
      const instance = await askText("ONE Framework Instance URL (e.g. https://instance.domain.com)", configState.resolved.instance);
      const distPath = await askText("Build Directory", configState.resolved.dist_path || "./dist");

      deployOpts.webAppName = webAppName;
      deployOpts.webAppPath = webAppPath;
      deployOpts.instance = instance;
      deployOpts.distPath = distPath;

      const shouldSave = await askConfirm(`Save configuration to ${configPath}?`, true);
      if (shouldSave) {
        const newConfigFile: WebAppConfigFile = {
          web_app_name: webAppName,
          web_app_path: webAppPath,
          instance: instance,
          dist_path: distPath,
        };
        saveConfigFile(configPath, newConfigFile);
        log.success(`Configuration saved to ${configPath}`);
      }

      configState = resolveConfig(deployOpts);
    }

    // Check credentials: if no api_key, prompt username & password if missing
    if (!configState.resolved.api_key) {
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
    process.exit(0);
  } catch (error) {
    spinner.stop();
    console.log("");
    log.error(bold(red("Deployment failed:")));
    console.error(dim((error as Error).message || String(error)));
    process.exit(1);
  }
}

async function handleInit(configPath: string) {
  console.log(bold("Initialize ONE Deploy Configuration:\n"));

  const multiEnv = await askConfirm("Do you want to configure multiple environments (dev, staging, prod)?", true);

  if (!multiEnv) {
    const webAppName = await askText("WebApp Name");
    const webAppPath = await askText("WebApp Path", webAppName);
    const instance = await askText("Instance URL (e.g. https://instance.domain.com)");
    const distPath = await askText("Build Directory", "./dist");
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

  const webAppName = await askText("WebApp Name (default across envs)");
  const webAppPath = await askText("WebApp Path", webAppName);
  const distPath = await askText("Build Directory", "./dist");

  const envs: Record<string, any> = {};

  const devUrl = await askText("Dev Instance URL", "https://dev.instance.onesoftware.ro");
  envs.dev = { instance: devUrl };

  const addStaging = await askConfirm("Add staging environment?", true);
  if (addStaging) {
    const stagingUrl = await askText("Staging Instance URL", "https://staging.instance.onesoftware.ro");
    envs.staging = { instance: stagingUrl };
  }

  const addProd = await askConfirm("Add prod environment?", true);
  if (addProd) {
    const prodUrl = await askText("Prod Instance URL", "https://app.instance.onesoftware.ro");
    envs.prod = { instance: prodUrl };
  }

  const config: WebAppConfigFile = {
    web_app_name: webAppName,
    web_app_path: webAppPath,
    dist_path: distPath,
    default_env: "dev",
    environments: envs,
  };

  saveConfigFile(configPath, config);
  log.success(`Multi-environment configuration written to ${configPath}`);
}

main().catch((err) => {
  log.error(`Unexpected fatal error: ${err.message}`);
  process.exit(1);
});
