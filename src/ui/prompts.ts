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
 * Prompt user to select from a list of choices
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

  const rl = readline.createInterface({ input, output });
  try {
    console.log(`${green("?")} ${question}:`);
    choices.forEach((choice, idx) => {
      const marker = idx === defaultIndex ? cyan("❯") : " ";
      console.log(`  ${marker} ${idx + 1}) ${choice}`);
    });

    while (true) {
      const promptString = `Enter number ${dim(`(1-${choices.length})`)} [${defaultIndex + 1}]: `;
      const answer = (await rl.question(promptString)).trim();

      if (!answer) {
        return choices[defaultIndex];
      }

      const num = parseInt(answer, 10);
      if (!isNaN(num) && num >= 1 && num <= choices.length) {
        return choices[num - 1];
      }

      // Check if user typed the name directly
      const matched = choices.find((c) => c.toLowerCase() === answer.toLowerCase());
      if (matched) {
        return matched;
      }

      console.log(yellow(`Please enter a valid choice between 1 and ${choices.length}`));
    }
  } finally {
    rl.close();
  }
}
