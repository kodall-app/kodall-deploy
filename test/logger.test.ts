import { describe, expect, it, vi } from "vitest";
import {
  bold,
  colors,
  cyan,
  dim,
  green,
  log,
  magenta,
  pad,
  red,
  Spinner,
  stripAnsi,
  yellow,
} from "../src/ui/logger.js";

describe("Logger & ANSI UI Utilities", () => {
  it("should wrap text with ANSI color codes", () => {
    expect(green("hello")).toBe(`${colors.green}hello${colors.reset}`);
    expect(red("hello")).toBe(`${colors.red}hello${colors.reset}`);
    expect(yellow("hello")).toBe(`${colors.yellow}hello${colors.reset}`);
    expect(cyan("hello")).toBe(`${colors.cyan}hello${colors.reset}`);
    expect(dim("hello")).toBe(`${colors.dim}hello${colors.reset}`);
    expect(bold("hello")).toBe(`${colors.bold}hello${colors.reset}`);
    expect(magenta("hello")).toBe(`${colors.magenta}hello${colors.reset}`);
  });

  it("should strip ANSI characters properly", () => {
    const colored = `${colors.green}Hello ${colors.bold}World${colors.reset}`;
    expect(stripAnsi(colored)).toBe("Hello World");
    expect(stripAnsi("Plain text")).toBe("Plain text");
  });

  it("should pad text according to visible width ignoring ANSI codes", () => {
    const colored = green("abc");
    const padded = pad(colored, 10);
    expect(stripAnsi(padded)).toBe("abc       ");
    expect(stripAnsi(padded).length).toBe(10);
  });

  it("should log info, success, warn, error, and plain messages", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    log.info("info message");
    expect(logSpy).toHaveBeenCalled();

    log.success("success message");
    expect(logSpy).toHaveBeenCalled();

    log.warn("warn message");
    expect(logSpy).toHaveBeenCalled();

    log.plain("plain message");
    expect(logSpy).toHaveBeenCalled();

    log.error("error message");
    expect(errorSpy).toHaveBeenCalled();

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  describe("Spinner", () => {
    it("should start, update, and stop spinner without error", () => {
      const spinner = new Spinner("Loading...", false);
      spinner.start("Starting...");
      spinner.setText("Working...");
      spinner.stop();
    });

    it("should log success, fail, and warn messages on completion", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const spinner = new Spinner("Test", false);
      spinner.succeed("Done successfully");
      expect(logSpy).toHaveBeenCalled();

      spinner.fail("Failed");
      expect(errorSpy).toHaveBeenCalled();

      spinner.warn("Warning");
      expect(logSpy).toHaveBeenCalled();

      // Test with default text
      spinner.succeed();
      spinner.fail();
      spinner.warn();

      logSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it("should handle interactive mode render and timer", async () => {
      const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      const spinner = new Spinner("Interactive test");
      (spinner as any).isInteractive = true;
      spinner.start("Interactive loading");
      // Call start again while timer is active to test clearInterval branch
      spinner.start("Restarting loading");
      spinner.setText("Updated text");
      (spinner as any).render();

      await new Promise((r) => setTimeout(r, 100)); // allow timer tick

      spinner.stop();
      expect(writeSpy).toHaveBeenCalledWith("\r\x1b[K");

      writeSpy.mockRestore();
    });

    it("should detect interactive TTY in constructor when stdout.isTTY is true and not CI", () => {
      const origTTY = process.stdout.isTTY;
      const origCI = process.env.CI;
      process.stdout.isTTY = true;
      delete process.env.CI;

      const spinner = new Spinner("TTY test");
      expect((spinner as any).isInteractive).toBe(true);

      process.stdout.isTTY = origTTY;
      process.env.CI = origCI;
    });

    it("should no-op when render is called in non-interactive mode", () => {
      const spinner = new Spinner("Non-interactive");
      (spinner as any).isInteractive = false;
      expect(() => (spinner as any).render()).not.toThrow();
    });
  });
});



