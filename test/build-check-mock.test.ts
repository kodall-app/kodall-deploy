import { afterEach, describe, expect, it, vi } from "vitest";

import * as path from "node:path";

let mockStatFail = false;

vi.mock("node:fs", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    statSync: (p: any, options: any) => {
      if (mockStatFail && (String(p).includes("index.html") || String(p).endsWith(".ts"))) {
        throw new Error("Simulated stat error");
      }
      return actual.statSync(p, options);
    },
  };
});

describe("Build Check fs mocks", () => {
  let tempDir: string = "";

  afterEach(async () => {
    mockStatFail = false;
    if (tempDir) {
      const fs = await import("node:fs");
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it("should handle statSync errors inside checkBuildStatus", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kodall-build-mock-"));
    const distDir = path.join(tempDir, "dist");
    fs.mkdirSync(distDir);
    fs.writeFileSync(path.join(distDir, "index.html"), "<html></html>");
    fs.writeFileSync(path.join(tempDir, "app.ts"), "console.log(1);");

    mockStatFail = true;
    const { checkBuildStatus } = await import("../src/core/build-check.js");
    const res = checkBuildStatus("./dist", tempDir);
    expect(res.exists).toBe(true);
  });
});

