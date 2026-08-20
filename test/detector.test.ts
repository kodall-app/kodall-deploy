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
    });

    it("should detect Nuxt project", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          name: "nuxt-app",
          dependencies: {
            nuxt: "^3.10.0",
          },
        }),
        "utf-8"
      );

      const detected = detectFramework(tempDir);
      expect(detected.framework).toBe("Nuxt");
      expect(detected.distPath).toBe("./.output/public");
    });

    it("should detect Remix project", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          name: "remix-app",
          devDependencies: {
            "@remix-run/dev": "^2.6.0",
          },
        }),
        "utf-8"
      );

      const detected = detectFramework(tempDir);
      expect(detected.framework).toBe("Remix");
      expect(detected.distPath).toBe("./build/client");
    });

    it("should detect Create React App project", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          name: "cra-app",
          dependencies: {
            "react-scripts": "^5.0.1",
          },
        }),
        "utf-8"
      );

      const detected = detectFramework(tempDir);
      expect(detected.framework).toBe("Create React App");
      expect(detected.distPath).toBe("./build");
    });

    it("should detect Astro project", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          name: "astro-app",
          dependencies: {
            astro: "^4.0.0",
          },
        }),
        "utf-8"
      );

      const detected = detectFramework(tempDir);
      expect(detected.framework).toBe("Astro");
      expect(detected.distPath).toBe("./dist");
    });

    it("should detect Vue CLI project", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          name: "vue-app",
          devDependencies: {
            "@vue/cli-service": "^5.0.0",
          },
        }),
        "utf-8"
      );

      const detected = detectFramework(tempDir);
      expect(detected.framework).toBe("Vue CLI");
      expect(detected.distPath).toBe("./dist");
    });

    it("should detect Gatsby project", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ name: "gatsby-app", dependencies: { gatsby: "^5.0.0" } }),
        "utf-8"
      );
      const detected = detectFramework(tempDir);
      expect(detected.framework).toBe("Gatsby");
      expect(detected.distPath).toBe("./public");
    });

    it("should detect Parcel, Webpack, SolidJS, Preact, Eleventy", () => {
      // Parcel
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ dependencies: { parcel: "^2.0.0" } }),
        "utf-8"
      );
      expect(detectFramework(tempDir).framework).toBe("Parcel");

      // Webpack
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ dependencies: { webpack: "^5.0.0" } }),
        "utf-8"
      );
      expect(detectFramework(tempDir).framework).toBe("Webpack");

      // SolidJS
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ dependencies: { "solid-js": "^1.0.0" } }),
        "utf-8"
      );
      expect(detectFramework(tempDir).framework).toBe("SolidJS");

      // Pure Vue
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ dependencies: { vue: "^3.0.0" } }),
        "utf-8"
      );
      expect(detectFramework(tempDir).framework).toBe("Vue");

      // Preact
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ dependencies: { preact: "^10.0.0" } }),
        "utf-8"
      );
      expect(detectFramework(tempDir).framework).toBe("Preact");

      // Eleventy
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ dependencies: { "@11ty/eleventy": "^2.0.0" } }),
        "utf-8"
      );
      expect(detectFramework(tempDir).framework).toBe("Eleventy");
    });

    it("should fallback to Static HTML when index.html exists in root without package.json", () => {
      fs.writeFileSync(path.join(tempDir, "index.html"), "<html><body>Static HTML</body></html>", "utf-8");

      const detected = detectFramework(tempDir);
      expect(detected.framework).toBe("Static HTML");
      expect(detected.distPath).toBe(".");
    });

    it("should detect existing build folders if package.json has unknown framework", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          name: "generic-app",
        }),
        "utf-8"
      );
      fs.mkdirSync(path.join(tempDir, "out"));
      fs.writeFileSync(path.join(tempDir, "out", "index.html"), "<html></html>", "utf-8");

      const detected = detectFramework(tempDir);
      expect(detected.distPath).toBe("./out");
      expect(detected.framework).toBe("Node.js WebApp");
    });
  });
});
