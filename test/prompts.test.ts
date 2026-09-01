import { beforeEach, describe, expect, it, vi } from "vitest";

const mockQuestion = vi.fn();
const mockClose = vi.fn();

vi.mock("node:readline/promises", () => ({
  createInterface: () => ({
    question: mockQuestion,
    close: mockClose,
  }),
}));

import { askConfirm, askPassword, askSelect, askText } from "../src/ui/prompts.js";

describe("Prompt Utilities", () => {
  beforeEach(() => {
    mockQuestion.mockReset();
    mockClose.mockReset();
  });

  describe("askText", () => {
    it("should return user input", async () => {
      mockQuestion.mockResolvedValueOnce("my-app");
      const result = await askText("Enter app name");
      expect(result).toBe("my-app");
    });

    it("should return default value when user enters blank", async () => {
      mockQuestion.mockResolvedValueOnce("");
      const result = await askText("Enter app name", "default-app");
      expect(result).toBe("default-app");
    });

    it("should return empty string when not required and user enters blank", async () => {
      mockQuestion.mockResolvedValueOnce("");
      const result = await askText("Optional field", undefined, false);
      expect(result).toBe("");
    });

    it("should reprompt when required field is left blank without default", async () => {
      mockQuestion.mockResolvedValueOnce("").mockResolvedValueOnce("valid-input");
      const result = await askText("Required field", undefined, true);
      expect(result).toBe("valid-input");
    });
  });


  describe("askConfirm", () => {
    it("should return true when user inputs y / yes", async () => {
      mockQuestion.mockResolvedValueOnce("y");
      const result = await askConfirm("Are you sure?");
      expect(result).toBe(true);
    });

    it("should return false when user inputs n / no", async () => {
      mockQuestion.mockResolvedValueOnce("n");
      const result = await askConfirm("Are you sure?");
      expect(result).toBe(false);
    });

    it("should return defaultYes value when input is blank", async () => {
      mockQuestion.mockResolvedValueOnce("");
      expect(await askConfirm("Continue?", true)).toBe(true);

      mockQuestion.mockResolvedValueOnce("");
      expect(await askConfirm("Continue?", false)).toBe(false);
    });
  });

  describe("askPassword", () => {
    it("should capture masked password input and resolve on enter", async () => {

      const passwordPromise = askPassword("Enter secret");

      // Type "p", "a", "s", "s", Backspace, "s", Enter
      process.stdin.emit("data", Buffer.from("p"));
      process.stdin.emit("data", Buffer.from("a"));
      process.stdin.emit("data", Buffer.from("s"));
      process.stdin.emit("data", Buffer.from("s"));
      process.stdin.emit("data", Buffer.from("\x08")); // Backspace
      process.stdin.emit("data", Buffer.from("s"));
      process.stdin.emit("data", Buffer.from("\r")); // Enter

      const result = await passwordPromise;
      expect(result).toBe("pass");
    });

    it("should reprompt when required password is empty", async () => {
      const passwordPromise = askPassword("Enter secret", true);

      // Hit Enter immediately (empty), then type "abc", Enter
      process.stdin.emit("data", Buffer.from("\r"));
      process.stdin.emit("data", Buffer.from("abc\r"));

      const result = await passwordPromise;
      expect(result).toBe("abc");
    });

    it("should handle Ctrl+C interrupt in askPassword", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);

      askPassword("Enter secret");
      process.stdin.emit("data", Buffer.from("\u0003"));

      expect(exitSpy).toHaveBeenCalledWith(130);
      exitSpy.mockRestore();

      // With setRawMode defined
      const origSetRaw = process.stdin.setRawMode;
      const mockSetRaw = vi.fn();
      process.stdin.setRawMode = mockSetRaw;

      const exitSpy2 = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
      askPassword("Enter secret");
      process.stdin.emit("data", Buffer.from("\u0003"));
      expect(exitSpy2).toHaveBeenCalledWith(130);
      expect(mockSetRaw).toHaveBeenCalled();

      exitSpy2.mockRestore();
      process.stdin.setRawMode = origSetRaw;
    });


    it("should toggle raw mode if setRawMode is available during askPassword", async () => {
      const origSetRaw = process.stdin.setRawMode;
      const mockSetRaw = vi.fn();
      process.stdin.setRawMode = mockSetRaw;

      const passwordPromise = askPassword("Enter secret");
      process.stdin.emit("data", Buffer.from("secret\r"));
      await passwordPromise;

      expect(mockSetRaw).toHaveBeenCalledWith(true);
      expect(mockSetRaw).toHaveBeenCalledWith(false);

      process.stdin.setRawMode = origSetRaw;
    });
  });



  describe("askSelect", () => {
    it("should throw when choices array is empty", async () => {
      await expect(askSelect("Choose:", [])).rejects.toThrow("No choices provided");
    });

    it("should return the only choice if choices length is 1", async () => {
      const result = await askSelect("Choose:", ["only-one"]);
      expect(result).toBe("only-one");
    });

    it("should handle non-interactive / CI numeric selection", async () => {
      const origCI = process.env.CI;
      process.env.CI = "true";

      mockQuestion.mockResolvedValueOnce("2");
      const result = await askSelect("Pick env", ["dev", "staging", "prod"]);
      expect(result).toBe("staging");

      process.env.CI = origCI;
    });

    it("should fallback to default choice in non-interactive mode on blank input", async () => {
      const origCI = process.env.CI;
      process.env.CI = "true";

      mockQuestion.mockResolvedValueOnce("");
      const result = await askSelect("Pick env", ["dev", "staging", "prod"], 1);
      expect(result).toBe("staging");

      process.env.CI = origCI;
    });

    it("should handle interactive TTY selection with arrow keys and Enter", async () => {
      const origTTY = process.stdin.isTTY;
      const origCI = process.env.CI;
      process.stdin.isTTY = true;
      delete process.env.CI;

      const selectPromise = askSelect("Select target", ["item1", "item2", "item3"], 0);

      // Down arrow -> item2
      process.stdin.emit("data", Buffer.from("\u001b[B"));
      // Down arrow -> item3
      process.stdin.emit("data", Buffer.from("\u001b[B"));
      // Up arrow -> item2
      process.stdin.emit("data", Buffer.from("\u001b[A"));
      // Enter
      process.stdin.emit("data", Buffer.from("\r"));

      const result = await selectPromise;
      expect(result).toBe("item2");

      process.stdin.isTTY = origTTY;
      process.env.CI = origCI;
    });

    it("should handle direct numeric key press in interactive mode", async () => {
      const origTTY = process.stdin.isTTY;
      const origCI = process.env.CI;
      process.stdin.isTTY = true;
      delete process.env.CI;

      const selectPromise = askSelect("Select target", ["item1", "item2", "item3"], 0);

      // Press '3'
      process.stdin.emit("data", Buffer.from("3"));
      // Press Enter
      process.stdin.emit("data", Buffer.from("\r"));

      const result = await selectPromise;
      expect(result).toBe("item3");

      process.stdin.isTTY = origTTY;
      process.env.CI = origCI;
    });

    it("should handle Ctrl+C interrupt in interactive mode", async () => {
      const origTTY = process.stdin.isTTY;
      const origCI = process.env.CI;
      process.stdin.isTTY = true;
      delete process.env.CI;

      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);

      askSelect("Select target", ["item1", "item2"], 0);

      // Emit Ctrl+C
      process.stdin.emit("data", Buffer.from("\u0003"));
      expect(exitSpy).toHaveBeenCalledWith(130);

      exitSpy.mockRestore();
      process.stdin.isTTY = origTTY;
      process.env.CI = origCI;
    });

    it("should toggle raw mode if setRawMode is available on process.stdin", async () => {
      const origTTY = process.stdin.isTTY;
      const origCI = process.env.CI;
      const origSetRawMode = process.stdin.setRawMode;

      process.stdin.isTTY = true;
      delete process.env.CI;
      const mockSetRaw = vi.fn();
      process.stdin.setRawMode = mockSetRaw;

      const selectPromise = askSelect("Select target", ["item1", "item2"], 0);
      process.stdin.emit("data", Buffer.from("\r"));
      await selectPromise;

      expect(mockSetRaw).toHaveBeenCalledWith(true);
      expect(mockSetRaw).toHaveBeenCalledWith(false);

      process.stdin.setRawMode = origSetRawMode;
      process.stdin.isTTY = origTTY;
      process.env.CI = origCI;
    });
  });

});
