import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { cyan, dim, green, yellow } from "./logger.js";

/**
 * Ask a standard text question
 */
export async function askText(
  question: string,
  defaultValue?: string,
  required = true
): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    const formattedDefault = defaultValue ? dim(` (${defaultValue})`) : "";
    const promptString = `${green("?")} ${question}${formattedDefault}: `;

    while (true) {
      const answer = (await rl.question(promptString)).trim();
      if (answer) {
        return answer;
      }
      if (defaultValue !== undefined) {
        return defaultValue;
      }
      if (!required) {
        return "";
      }
      console.log(yellow("This field is required."));
    }
  } finally {
    rl.close();
  }
}

/**
 * Ask for password with hidden/masked terminal input
 */
export async function askPassword(
  question: string,
  required = true
): Promise<string> {
  return new Promise((resolve) => {
    const promptString = `${green("?")} ${question}: `;
    process.stdout.write(promptString);

    const isRaw = process.stdin.isRaw;
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    let password = "";

    const onData = (chunk: Buffer) => {
      const str = chunk.toString("utf8");

      for (let i = 0; i < str.length; i++) {
        const char = str[i];
        const code = str.charCodeAt(i);

        if (code === 3) {
          // Ctrl+C
          if (process.stdin.setRawMode) process.stdin.setRawMode(isRaw ?? false);
          process.stdin.removeListener("data", onData);
          process.stdin.pause();
          process.stdout.write("\n");
          process.exit(130);
        } else if (code === 13 || code === 10) {
          // Enter
          if (required && password.length === 0) {
            process.stdout.write(`\n${yellow("Password is required.")}\n${promptString}`);
            password = "";
            continue;
          }
          if (process.stdin.setRawMode) process.stdin.setRawMode(isRaw ?? false);
          process.stdin.removeListener("data", onData);
          process.stdin.pause();
          process.stdout.write("\n");
          resolve(password);
          return;
        } else if (code === 8 || code === 127) {
          // Backspace
          if (password.length > 0) {
            password = password.slice(0, -1);
            process.stdout.write("\b \b");
          }
        } else if (code >= 32) {
          // Printable char
          password += char;
          process.stdout.write("*");
        }
      }
    };

    process.stdin.on("data", onData);
  });
}

/**
 * Ask a confirmation question (Y/n)
 */
export async function askConfirm(
  question: string,
  defaultYes = true
): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    const options = defaultYes ? "[Y/n]" : "[y/N]";
    const promptString = `${green("?")} ${question} ${dim(options)}: `;

    const answer = (await rl.question(promptString)).trim().toLowerCase();
    if (!answer) {
      return defaultYes;
    }
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

/**
 * Prompt user to select from a list of choices using arrow keys (↑/↓) or numbers
 */
export async function askSelect(
  question: string,
  choices: string[],
  defaultIndex = 0
): Promise<string> {
  if (choices.length === 0) {
    throw new Error("No choices provided for selection");
  }
  if (choices.length === 1) {
    return choices[0];
  }

  // Non-interactive / CI fallback
  if (!process.stdin.isTTY || process.env.CI) {
    const rl = readline.createInterface({ input, output });
    try {
      console.log(`${green("?")} ${question}:`);
      choices.forEach((choice, idx) => {
        console.log(`  ${idx + 1}) ${choice}`);
      });
      const answer = (await rl.question(`Select choice [${defaultIndex + 1}]: `)).trim();
      const num = parseInt(answer, 10);
      if (!isNaN(num) && num >= 1 && num <= choices.length) {
        return choices[num - 1];
      }
      return choices[defaultIndex];
    } finally {
      rl.close();
    }
  }

  // Interactive TTY arrow key selection
  return new Promise((resolve) => {
    let selectedIndex = Math.max(0, Math.min(defaultIndex, choices.length - 1));
    let hasRendered = false;

    // Hide cursor
    process.stdout.write("\x1b[?25l");

    const render = () => {
      if (hasRendered) {
        // Move cursor up by choices.length lines and clear
        process.stdout.write(`\x1b[${choices.length}A\r`);
      } else {
        console.log(`${green("?")} ${question} ${dim("(Use arrow keys ↑/↓ and Enter to select)")}:`);
        hasRendered = true;
      }

      for (let i = 0; i < choices.length; i++) {
        const isSelected = i === selectedIndex;
        const pointer = isSelected ? cyan("❯") : " ";
        const text = isSelected ? cyan(choices[i]) : dim(choices[i]);
        process.stdout.write(`\x1b[2K  ${pointer} ${text}\n`);
      }
    };

    render();

    const isRaw = process.stdin.isRaw;
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    const cleanup = () => {
      if (process.stdin.setRawMode) {
        process.stdin.setRawMode(isRaw ?? false);
      }
      process.stdin.removeListener("data", onData);
      process.stdin.pause();
      // Show cursor
      process.stdout.write("\x1b[?25h");
    };

    const onData = (chunk: Buffer) => {
      const key = chunk.toString();

      if (key === "\u0003") {
        // Ctrl+C
        cleanup();
        process.stdout.write("\n");
        process.exit(130);
      } else if (key === "\r" || key === "\n" || key === " ") {
        // Enter or Space
        cleanup();
        // Clear prompt and all choice lines completely
        for (let i = 0; i <= choices.length; i++) {
          process.stdout.write("\r\x1b[2K\x1b[1A");
        }
        process.stdout.write("\r\x1b[2K");
        console.log(`${green("?")} ${question}: ${cyan(choices[selectedIndex])}`);
        resolve(choices[selectedIndex]);
      } else if (key === "\u001b[A" || key === "k" || key === "K" || key === "w" || key === "W") {
        // Up arrow
        selectedIndex = (selectedIndex - 1 + choices.length) % choices.length;
        render();
      } else if (key === "\u001b[B" || key === "j" || key === "J" || key === "s" || key === "S") {
        // Down arrow
        selectedIndex = (selectedIndex + 1) % choices.length;
        render();
      } else {
        const num = parseInt(key, 10);
        if (!isNaN(num) && num >= 1 && num <= choices.length) {
          selectedIndex = num - 1;
          render();
        }
      }
    };

    process.stdin.on("data", onData);
  });
}
