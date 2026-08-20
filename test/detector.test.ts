import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectFramework, sanitizeProjectName } from "../src/core/detector.js";

describe("Framework Detector & Name Sanitizer", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kodall-detector-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("sanitizeProjectName", () => {
    it("should strip npm scopes and invalid characters", () => {
      expect(sanitizeProjectName("@kodall/one-portal")).toBe("one-portal");
      expect(sanitizeProjectName("@my-org/web_app.v2")).toBe("web_app.v2");
      expect(sanitizeProjectName("my application name!")).toBe("my-application-name");
      expect(sanitizeProjectName("---app---")).toBe("app");
      expect(sanitizeProjectName("")).toBe("my-app");
    });
  });

  describe("detectFramework", () => {
    it("should detect Vite project", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          name: "@acme/vite-dashboard",
          devDependencies: {
            vite: "^5.0.0",
          },
          scripts: {
            build: "vite build",
          },
        }),
        "utf-8"
      );

      const detected = detectFramework(tempDir);
      expect(detected.framework).toBe("Vite");
      expect(detected.distPath).toBe("./dist");
      expect(detected.appName).toBe("vite-dashboard");
      expect(detected.hasBuildScript).toBe(true);
    });

    it("should detect Next.js project with ./out directory default", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          name: "nextjs-app",
          dependencies: {
            next: "14.1.0",
            react: "^18.2.0",
          },
        }),
        "utf-8"
      );

      const detected = detectFramework(tempDir);
      expect(detected.framework).toBe("Next.js");
      expect(detected.distPath).toBe("./out");
      expect(detected.appName).toBe("nextjs-app");
    });

    it("should detect Angular project", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          name: "angular-portal",
          dependencies: {
            "@angular/core": "^17.0.0",
          },
        }),
        "utf-8"
      );

      const detected = detectFramework(tempDir);
      expect(detected.framework).toBe("Angular");
      expect(detected.distPath).toBe("./dist");
      expect(detected.appName).toBe("angular-portal");
    });

    it("should detect SvelteKit project", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          name: "svelte-app",
          devDependencies: {
            "@sveltejs/kit": "^2.0.0",
          },
        }),
        "utf-8"
      );

      const detected = detectFramework(tempDir);
      expect(detected.framework).toBe("SvelteKit");
      expect(detected.distPath).toBe("./build");
      expect(detected.appName).toBe("svelte-app");
    });

    it("should detect Nuxt project", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          name: "nuxt-site",
          devDependencies: {
            nuxt: "^3.10.0",
          },
        }),
        "utf-8"
      );

      const detected = detectFramework(tempDir);
      expect(detected.framework).toBe("Nuxt");
      expect(detected.distPath).toBe("./.output/public");
      expect(detected.appName).toBe("nuxt-site");
    });

    it("should detect Pure Static HTML project when root index.html exists", () => {
      fs.writeFileSync(path.join(tempDir, "index.html"), "<!DOCTYPE html><html></html>", "utf-8");

      const detected = detectFramework(tempDir);
      expect(detected.framework).toBe("Static HTML");
      expect(detected.distPath).toBe(".");
      expect(detected.hasBuildScript).toBe(false);
    });

    it("should fallback to inspecting existing candidate directories on disk", () => {
      // Create a ./build/index.html directory
      const buildDir = path.join(tempDir, "build");
      fs.mkdirSync(buildDir, { recursive: true });
      fs.writeFileSync(path.join(buildDir, "index.html"), "<html></html>", "utf-8");

      const detected = detectFramework(tempDir);
      expect(detected.distPath).toBe("./build");
    });
  });
});
