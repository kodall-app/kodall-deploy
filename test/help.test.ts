import { describe, expect, it } from "vitest";
import { getHelpText } from "../src/ui/help.js";

describe("Help UI", () => {
  it("should generate help text containing usage and version", () => {
    const text = getHelpText("1.2.3");
    expect(text).toContain("kodall-deploy");
    expect(text).toContain("v1.2.3");
    expect(text).toContain("USAGE:");
    expect(text).toContain("OPTIONS:");
    expect(text).toContain("ENVIRONMENT VARIABLES:");
  });
});
