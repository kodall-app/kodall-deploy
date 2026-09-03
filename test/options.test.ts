import { describe, expect, it, vi } from "vitest";
import { OPTIONS_SCHEMA, parseCliArgs, VERSION } from "../src/commands/options.js";

describe("CLI Options Parser", () => {
  it("should export VERSION and OPTIONS_SCHEMA", () => {
    expect(VERSION).toBe("1.2.3");
    expect(OPTIONS_SCHEMA.env).toBeDefined();
    expect(OPTIONS_SCHEMA.instance).toBeDefined();
  });

  it("should parse use and switch subcommands", () => {
    const res1 = parseCliArgs(["use", "staging"]);
    expect(res1.commands.use).toBe(true);
    expect(res1.commands.useTarget).toBe("staging");

    const res2 = parseCliArgs(["switch", "dev"]);
    expect(res2.commands.use).toBe(true);
    expect(res2.commands.useTarget).toBe("dev");

    const res3 = parseCliArgs(["set-env"]);
    expect(res3.commands.use).toBe(true);
  });

  it("should parse flags and short forms correctly", () => {
    const res = parseCliArgs(["-e", "prod", "-i", "https://app.kodall.ro", "-l", "--clear-active", "-H", "-t", "prod"]);
    expect(res.flags.env).toBe("prod");
    expect(res.flags.instance).toBe("https://app.kodall.ro");
    expect(res.commands.listEnvs).toBe(true);
    expect(res.commands.clearActive).toBe(true);
    expect(res.commands.history).toBe(true);
  });

  it("should parse inline equality flags (=)", () => {
    const res = parseCliArgs([
      "--status=prod",
      "--remove-env=dev",
      "--clone-env=dev",
      "--set-default=dev",
      "--use=staging",
      "--rollback=137",
      "-e=",
      "-t=",
    ]);
    expect(res.commands.status).toBe(true);
    expect(res.commands.statusTarget).toBe("prod");
    expect(res.commands.removeEnv).toBe(true);
    expect(res.commands.removeTarget).toBe("dev");
    expect(res.commands.cloneEnv).toBe(true);
    expect(res.commands.cloneSource).toBe("dev");
    expect(res.commands.setDefault).toBe(true);
    expect(res.commands.setDefaultTarget).toBe("dev");
    expect(res.commands.use).toBe(true);
    expect(res.commands.useTarget).toBe("staging");
    expect(res.commands.rollback).toBe(true);
    expect(res.commands.rollbackStorageId).toBe("137");
    expect(res.commands.explicitEnvPrompt).toBe(true);
    expect(res.commands.explicitTypePrompt).toBe(true);

    const resEmpty = parseCliArgs(["--rollback="]);
    expect(resEmpty.commands.rollback).toBe(true);

    const resArg = parseCliArgs(["--rollback", "101"]);
    expect(resArg.commands.rollback).toBe(true);
    expect(resArg.commands.rollbackStorageId).toBe("101");
  });

  it("should handle separate value args and bare flags", () => {
    const res = parseCliArgs([
      "-e",
      "-t",
      "--list",
      "-s",
      "prod-status",
      "--remove-env",
      "dev-remove",
      "--copy-env",
      "srcEnv",
      "dstEnv",
      "--set-default",
      "prod-target",
      "--use",
      "dev-target",
      "--rollback",
    ]);
    expect(res.commands.explicitEnvPrompt).toBe(true);
    expect(res.commands.explicitTypePrompt).toBe(true);
    expect(res.commands.listEnvs).toBe(true);
    expect(res.commands.status).toBe(true);
    expect(res.commands.statusTarget).toBe("prod-status");
    expect(res.commands.removeEnv).toBe(true);
    expect(res.commands.removeTarget).toBe("dev-remove");
    expect(res.commands.cloneEnv).toBe(true);
    expect(res.commands.cloneSource).toBe("srcEnv");
    expect(res.commands.cloneTarget).toBe("dstEnv");
    expect(res.commands.setDefault).toBe(true);
    expect(res.commands.setDefaultTarget).toBe("prod-target");
    expect(res.commands.use).toBe(true);
    expect(res.commands.useTarget).toBe("dev-target");
    expect(res.commands.rollback).toBe(true);
  });

  it("should handle parse error and exit", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    parseCliArgs(["--unknown-invalid-flag-xyz"]);
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });
});
