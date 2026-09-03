import { parseArgs } from "node:util";
import { dim, log } from "../ui/logger.js";

export const VERSION = "1.2.3";

export const OPTIONS_SCHEMA = {
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

export interface ParsedCliResult {
  flags: any;
  commands: {
    listEnvs: boolean;
    clearActive: boolean;
    use: boolean;
    useTarget?: string;
    status: boolean;
    statusTarget?: string;
    removeEnv: boolean;
    removeTarget?: string;
    cloneEnv: boolean;
    cloneSource?: string;
    cloneTarget?: string;
    setDefault: boolean;
    setDefaultTarget?: string;
    history: boolean;
    rollback: boolean;
    rollbackStorageId?: string;
    explicitEnvPrompt: boolean;
    explicitTypePrompt: boolean;
  };
}

export function parseCliArgs(rawInput: string[] = process.argv.slice(2)): ParsedCliResult {
  const rawArgs = [...rawInput];

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

  let parsed: any;
  try {
    parsed = parseArgs({
      args,
      options: OPTIONS_SCHEMA,
      allowPositionals: false,
    });
  } catch (err) {
    log.error((err as Error).message);
    console.log(dim("Run 'kodall-deploy --help' for usage."));
    process.exit(1);
  }

  const flags = parsed.values;

  return {
    flags,
    commands: {
      listEnvs: Boolean(flags["list-envs"] || explicitListEnvs),
      clearActive: Boolean(flags["clear-active"] || explicitClearActive),
      use: Boolean(flags.use !== undefined || explicitUse),
      useTarget: useEnvName || flags.use || undefined,
      status: Boolean(flags.status !== undefined || explicitStatus),
      statusTarget: statusEnvName || flags.status || undefined,
      removeEnv: Boolean(flags["remove-env"] !== undefined || explicitRemoveEnv),
      removeTarget: removeEnvName || flags["remove-env"] || undefined,
      cloneEnv: Boolean(flags["clone-env"] !== undefined || explicitCloneEnv),
      cloneSource,
      cloneTarget,
      setDefault: Boolean(flags["set-default"] !== undefined || explicitSetDefault),
      setDefaultTarget: setDefaultEnvName || flags["set-default"] || undefined,
      history: Boolean(flags.history || explicitHistory),
      rollback: Boolean(flags.rollback !== undefined || explicitRollback || rollbackStorageId),
      rollbackStorageId: rollbackStorageId || flags.rollback,
      explicitEnvPrompt,
      explicitTypePrompt,
    },
  };
}
