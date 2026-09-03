#!/usr/bin/env node

import { parseArgs } from "node:util";
import { handleInitCI } from "./commands/ci.js";
import { handleDeployCommand } from "./commands/deploy.js";
import {
  handleAddEnv,
  handleClearActive,
  handleCloneEnv,
  handleListEnvs,
  handleRemoveEnv,
  handleSetDefault,
  handleUseEnv,
} from "./commands/envs.js";
import { displayHistoryForEnv } from "./commands/history.js";
import { handleInit } from "./commands/init.js";
import { handleRollback } from "./commands/rollback.js";
import { handleStatusDashboard } from "./commands/status.js";
import { DEFAULT_CONFIG_FILENAME, migrateLegacyConfigFile } from "./core/config.js";
import { bold, cyan, dim, log } from "./ui/logger.js";

const VERSION = "1.2.3";

const HELP_TEXT = `
${bold("kodall-deploy")} ${dim(`v${VERSION}`)}
Deploy web applications to Kodall instances and manage local dev proxies.

${bold("USAGE:")}
  $ kodall-deploy [command] [options]
  $ one-deploy [command] [options]
  $ npx kodall-deploy [command] [options]

${bold("COMMANDS:")}
  use [env]                 Set active local dev proxy environment (untracked)
  switch [env]              Alias for 'use'

${bold("OPTIONS:")}
  -e, --env <name>          Target environment(s) (e.g., dev, prod, or comma-separated "dev,staging")
  -t, --type <type>         Deploy all environments of given type (e.g., dev, staging, prod)
      --all                 Deploy to ALL configured environments sequentially
  -i, --instance <url>      Instance base URL (e.g., https://app.domain.com)
  -n, --name <name>         WebApp name in Kodall
  -p, --path <path>         URL path where web app is served
  -d, --dist <dir>          Path to build directory containing index.html [default: ./dist]
  -u, --user <username>     Kodall login username
  -P, --password <password> Kodall login password
  -k, --api-key <key>       API key authentication (bypasses username/password)
      --token <token>       OAuth / OpenID Connect access token (bypasses username/password)
  -O, --otp <code>          One-Time Password / 2FA code for authentication
      --client-id <id>      OAuth / OpenID Connect Client ID [default: admin-cli]
  -c, --config <file>       Path to config file [default: kodall-webapp.config.json]
  -l, --list-envs           List all configured environments in a table
  -s, --status [env]        Display live status & health dashboard for environment(s)
      --use [name]          Set active local dev proxy environment (untracked)
      --clear-active        Clear active local dev proxy environment override
      --add-env [name]      Add or update an environment in kodall-webapp.config.json
      --remove-env [name]   Remove an environment from configuration
      --clone-env <src> [dst] Duplicate/clone an existing environment
      --set-default <name>  Set default deployment environment in config file
      --save-config         When using 'use', also save as default in config file
  -H, --history             Display deployment history for environment(s)
  -R, --rollback [storage]  Roll back web application to a previous storage build
      --build               Force running "npm run build" before deploying
      --no-build            Skip build check and build prompts
      --no-health-check     Skip post-deployment live HTTP health check ping
      --init-ci             Generate CI/CD pipeline (GitHub Actions, GitLab CI, Bitbucket)
      --ci                  Non-interactive CI mode (fail if required parameters are missing)
      --dry-run             Validate build, test auth and query entity without mutating
      --init                Interactively generate or update kodall-webapp.config.json
      --debug               Print detailed debug info and stack traces on error
  -v, --version             Display CLI version
  -h, --help                Display this help message

${bold("ENVIRONMENT VARIABLES:")}
  KODALL_ENV, ONE_ENV               Target environment name
  KODALL_INSTANCE, ONE_INSTANCE     Instance URL
  KODALL_APP_NAME, ONE_APP_NAME     WebApp name
  KODALL_APP_PATH, ONE_APP_PATH     WebApp URL path
  KODALL_DIST_PATH, ONE_DIST_PATH   Build directory path
  KODALL_USERNAME, ONE_USERNAME     Login username
  KODALL_PASSWORD, ONE_PASSWORD     Login password
  KODALL_API_KEY, ONE_API_KEY       API key
  KODALL_TOKEN, ONE_TOKEN           OAuth / OpenID Connect access token
  KODALL_OTP, ONE_OTP               One-Time Password (OTP / 2FA)
  KODALL_CLIENT_ID, ONE_CLIENT_ID   OAuth Client ID

${bold("EXAMPLES:")}
  $ kodall-deploy use staging       # Switch local dev proxy to staging (clean git)
  $ kodall-deploy use               # Interactively select active proxy environment
  $ kodall-deploy --set-default dev # Set default deployment environment in config file
  $ kodall-deploy -l                # List all configured environments
  $ kodall-deploy                   # Interactive deployment menu
  $ kodall-deploy -e prod           # Deploy to production environment
  $ kodall-deploy --type prod       # Deploy to ALL production environments (e.g. prod-us, prod-eu)
  $ kodall-deploy --all             # Deploy to all configured environments
  $ kodall-deploy -H -e prod        # View deployment history for production
  $ kodall-deploy --rollback -e prod # Interactively roll back prod to a previous build
  $ kodall-deploy --rollback 137    # Roll back directly to storage ID 137
  $ kodall-deploy -e staging --dry-run # Validate and test staging deployment
  $ kodall-deploy --ci -u admin -P secret # Non-interactive CI deployment
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
  let explicitUse = false;
  let useEnvName: string | undefined;
  let explicitClearActive = false;

  if (rawArgs[0] === "use" || rawArgs[0] === "switch" || rawArgs[0] === "set-env") {
    rawArgs.shift();
    const target = rawArgs[0] && !rawArgs[0].startsWith("-") ? rawArgs.shift() : undefined;
    useEnvName = target;
    explicitUse = true;
  }

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
    if (arg === "--use") {
      const nextArg = rawArgs[i + 1];
      if (nextArg && !nextArg.startsWith("-")) {
        useEnvName = nextArg;
        i++;
      }
      explicitUse = true;
      continue;
    }
    if (arg.startsWith("--use=")) {
      useEnvName = arg.split("=")[1];
      explicitUse = true;
      continue;
    }
    if (arg === "--clear-active") {
      explicitClearActive = true;
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
    token: { type: "string" as const },
    "oidc-token": { type: "string" as const },
    otp: { type: "string" as const, short: "O" },
    "client-id": { type: "string" as const },
    config: { type: "string" as const, short: "c" },
    "list-envs": { type: "boolean" as const, short: "l", default: false },
    status: { type: "string" as const, short: "s" },
    use: { type: "string" as const },
    "clear-active": { type: "boolean" as const, default: false },
    "add-env": { type: "string" as const },
    "remove-env": { type: "string" as const },
    "clone-env": { type: "string" as const },
    "set-default": { type: "string" as const },
    "save-config": { type: "boolean" as const, default: false },
    global: { type: "boolean" as const, default: false },
    history: { type: "boolean" as const, short: "H", default: false },
    rollback: { type: "string" as const, short: "R" },
    build: { type: "boolean" as const, default: false },
    "no-build": { type: "boolean" as const, default: false },
    "health-check": { type: "boolean" as const, default: true },
    "no-health-check": { type: "boolean" as const, default: false },
    "init-ci": { type: "boolean" as const, default: false },
    ci: { type: "boolean" as const, default: false },
    "non-interactive": { type: "boolean" as const, default: false },
    "dry-run": { type: "boolean" as const, default: false },
    init: { type: "boolean" as const, default: false },
    debug: { type: "boolean" as const, default: false },
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
    console.log(dim("Run 'kodall-deploy --help' for usage."));
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

  const configPath = flags.config || DEFAULT_CONFIG_FILENAME;

  if (!flags.config) {
    const migration = migrateLegacyConfigFile(process.cwd());
    if (migration.migrated) {
      log.info(
        `Migrated legacy configuration to ${DEFAULT_CONFIG_FILENAME} (multi-environment format).`
      );
    }
  }

  console.log(`\n${bold(cyan("▶"))} ${bold("Kodall Deployer")} ${dim(`v${VERSION}`)}\n`);

  // Handle --list-envs command
  if (flags["list-envs"] || explicitListEnvs) {
    await handleListEnvs(configPath);
    return;
  }

  // Handle --clear-active command
  if (flags["clear-active"] || explicitClearActive) {
    await handleClearActive();
    return;
  }

  // Handle use / switch command (local proxy active env)
  if (flags.use !== undefined || explicitUse) {
    const target = useEnvName || flags.use || undefined;
    await handleUseEnv(configPath, target, Boolean(flags["save-config"] || flags.global));
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
    await displayHistoryForEnv(configPath, targetEnv, flags);
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

  // Handle --init-ci command
  if (flags["init-ci"]) {
    await handleInitCI(configPath);
    return;
  }

  // Handle --init command
  if (flags.init) {
    await handleInit(configPath);
    return;
  }

  // Default: Execute Deployment flow
  await handleDeployCommand(configPath, flags, {
    explicitEnvPrompt,
    explicitTypePrompt,
  });
}

main()
  .then(() => {
    process.stdin.pause();
  })
  .catch((err) => {
    log.error(`Unexpected fatal error: ${err.message}`);
    process.exit(1);
  });
