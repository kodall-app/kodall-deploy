/**
 * Zero-dependency ANSI terminal colors and utilities
 */
export const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

export function green(text: string): string {
  return `${colors.green}${text}${colors.reset}`;
}

export function red(text: string): string {
  return `${colors.red}${text}${colors.reset}`;
}

export function yellow(text: string): string {
  return `${colors.yellow}${text}${colors.reset}`;
}

export function cyan(text: string): string {
  return `${colors.cyan}${text}${colors.reset}`;
}

export function dim(text: string): string {
  return `${colors.dim}${text}${colors.reset}`;
}

export function bold(text: string): string {
  return `${colors.bold}${text}${colors.reset}`;
}

export function magenta(text: string): string {
  return `${colors.magenta}${text}${colors.reset}`;
}

export const log = {
  info: (msg: string) => console.log(`${cyan("ℹ")} ${msg}`),
  success: (msg: string) => console.log(`${green("✔")} ${msg}`),
  warn: (msg: string) => console.log(`${yellow("⚠")} ${msg}`),
  error: (msg: string) => console.error(`${red("✖")} ${msg}`),
  plain: (msg: string) => console.log(msg),
};

/**
 * Lightweight zero-dependency terminal spinner
 */
export class Spinner {
  private static frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private timer: NodeJS.Timeout | null = null;
  private currentFrame = 0;
  private text: string = "";
  private isInteractive: boolean;

  constructor(initialText = "", silent = false) {
    this.text = initialText;
    this.isInteractive =
      !silent &&
      Boolean(process.stdout && process.stdout.isTTY) &&
      !process.env.CI;
  }

  public start(text?: string): this {
    if (text) this.text = text;

    if (!this.isInteractive) {
      if (this.text) {
        log.info(this.text);
      }
      return this;
    }

    if (this.timer) {
      clearInterval(this.timer);
    }

    this.currentFrame = 0;
    this.render();
    this.timer = setInterval(() => {
      this.currentFrame = (this.currentFrame + 1) % Spinner.frames.length;
      this.render();
    }, 80);

    return this;
  }

  public setText(text: string): void {
    this.text = text;
    if (this.isInteractive) {
      this.render();
    }
  }

  public succeed(text?: string): void {
    this.stop();
    const message = text || this.text;
    console.log(`${green("✔")} ${message}`);
  }

  public fail(text?: string): void {
    this.stop();
    const message = text || this.text;
    console.error(`${red("✖")} ${message}`);
  }

  public warn(text?: string): void {
    this.stop();
    const message = text || this.text;
    console.log(`${yellow("⚠")} ${message}`);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.isInteractive) {
      process.stdout.write("\r\x1b[K"); // Clear line
    }
  }

  private render(): void {
    if (!this.isInteractive) return;
    const frame = cyan(Spinner.frames[this.currentFrame]);
    process.stdout.write(`\r${frame} ${this.text}`);
  }
}
