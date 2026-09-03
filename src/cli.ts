#!/usr/bin/env node

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
import { parseCliArgs, VERSION } from "./commands/options.js";
import { handleRollback } from "./commands/rollback.js";
import { handleStatusDashboard } from "./commands/status.js";
import { DEFAULT_CONFIG_FILENAME, migrateLegacyConfigFile } from "./core/config.js";
import { getHelpText } from "./ui/help.js";
import { bold, cyan, dim, log } from "./ui/logger.js";

async function main() {
  const { flags, commands } = parseCliArgs(process.argv.slice(2));

  if (flags.help) {
    console.log(getHelpText(VERSION));
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

  if (commands.listEnvs) {
    await handleListEnvs(configPath);
    return;
  }

  if (commands.clearActive) {
    await handleClearActive();
    return;
  }

  if (commands.use) {
    await handleUseEnv(configPath, commands.useTarget, Boolean(flags["save-config"] || flags.global));
    return;
  }

  if (commands.status) {
    const target = commands.statusTarget || flags.env;
    await handleStatusDashboard(configPath, target, flags);
    return;
  }

  if (commands.removeEnv) {
    await handleRemoveEnv(configPath, commands.removeTarget);
    return;
  }

  if (commands.cloneEnv) {
    await handleCloneEnv(configPath, commands.cloneSource, commands.cloneTarget);
    return;
  }

  if (commands.setDefault) {
    await handleSetDefault(configPath, commands.setDefaultTarget);
    return;
  }

  if (commands.history) {
    await displayHistoryForEnv(configPath, flags.env, flags);
    return;
  }

  if (commands.rollback) {
    await handleRollback(configPath, commands.rollbackStorageId, flags.env, flags);
    return;
  }

  if (flags["add-env"] !== undefined) {
    await handleAddEnv(configPath, flags["add-env"] || undefined);
    return;
  }

  if (flags["init-ci"]) {
    await handleInitCI(configPath);
    return;
  }

  if (flags.init) {
    await handleInit(configPath);
    return;
  }

  await handleDeployCommand(configPath, flags, {
    explicitEnvPrompt: commands.explicitEnvPrompt,
    explicitTypePrompt: commands.explicitTypePrompt,
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
