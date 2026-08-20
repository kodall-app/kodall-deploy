import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkBuildStatus } from "../src/core/build-check.js";

describe("Build Status Checker", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kodall-build-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should report missing build when dist/index.html does not exist", () => {
    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        name: "test-app",
        scripts: { build: "vite build" },
      }),
      "utf-8"
    );

    const result = checkBuildStatus("./dist", tempDir);
    expect(result.exists).toBe(false);
    expect(result.isStale).toBe(false);
    expect(result.hasBuildScript).toBe(true);
  });

  it("should report fresh build when dist is newer than all source files", async () => {
    // 1. Create a source file with past timestamp
    const srcDir = path.join(tempDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    const srcFile = path.join(srcDir, "main.ts");
    fs.writeFileSync(srcFile, "console.log('hello');", "utf-8");

    const pastTime = new Date(Date.now() - 10000);
    fs.utimesSync(srcFile, pastTime, pastTime);

    // 2. Create dist/index.html with current timestamp
    const distDir = path.join(tempDir, "dist");
    fs.mkdirSync(distDir, { recursive: true });
    const indexFile = path.join(distDir, "index.html");
    fs.writeFileSync(indexFile, "<html></html>", "utf-8");

    const result = checkBuildStatus("./dist", tempDir);
    expect(result.exists).toBe(true);
    expect(result.isStale).toBe(false);
  });

  it("should report stale build when a source file is newer than dist/index.html", () => {
    // 1. Create dist/index.html with past timestamp
    const distDir = path.join(tempDir, "dist");
    fs.mkdirSync(distDir, { recursive: true });
    const indexFile = path.join(distDir, "index.html");
    fs.writeFileSync(indexFile, "<html></html>", "utf-8");

    const pastTime = new Date(Date.now() - 10000);
    fs.utimesSync(indexFile, pastTime, pastTime);

    // 2. Create a source file in app/ (Nuxt style) with recent timestamp
    const appDir = path.join(tempDir, "app");
    fs.mkdirSync(appDir, { recursive: true });
    const pageFile = path.join(appDir, "app.vue");
    fs.writeFileSync(pageFile, "<template><div>Updated</div></template>", "utf-8");

    const now = new Date();
    fs.utimesSync(pageFile, now, now);

    const result = checkBuildStatus("./dist", tempDir);
    expect(result.exists).toBe(true);
    expect(result.isStale).toBe(true);
    expect(result.newestSourceFile).toBe("app/app.vue");
  });

  it("should ignore node_modules, .git, and .one-deploy modifications", () => {
    // 1. Create dist/index.html with past timestamp
    const distDir = path.join(tempDir, "dist");
    fs.mkdirSync(distDir, { recursive: true });
    const indexFile = path.join(distDir, "index.html");
    fs.writeFileSync(indexFile, "<html></html>", "utf-8");

    const pastTime = new Date(Date.now() - 5000);
    fs.utimesSync(indexFile, pastTime, pastTime);

    // 2. Create files in node_modules and .one-deploy with current timestamp
    const nmDir = path.join(tempDir, "node_modules", "some-pkg");
    fs.mkdirSync(nmDir, { recursive: true });
    fs.writeFileSync(path.join(nmDir, "index.js"), "module.exports = {};", "utf-8");

    const oneDir = path.join(tempDir, ".one-deploy");
    fs.mkdirSync(oneDir, { recursive: true });
    fs.writeFileSync(path.join(oneDir, "history.json"), "[]", "utf-8");

    const result = checkBuildStatus("./dist", tempDir);
    expect(result.exists).toBe(true);
    expect(result.isStale).toBe(false);
  });
});
