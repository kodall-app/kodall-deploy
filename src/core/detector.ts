import * as fs from "node:fs";
import * as path from "node:path";
import type { DetectedProject } from "./types.js";

/**
 * Sanitize a package name or directory name into a clean web_app name / path
 */
export function sanitizeProjectName(name: string): string {
  if (!name) return "my-app";
  let cleaned = name.trim();
  // Remove npm scope (e.g. @org/my-app -> my-app)
  if (cleaned.startsWith("@") && cleaned.includes("/")) {
    cleaned = cleaned.split("/")[1] || cleaned;
  }
  // Replace invalid URL characters with hyphen
  cleaned = cleaned.replace(/[^a-zA-Z0-9_.-]/g, "-").replace(/-+/g, "-");
  // Remove leading/trailing dashes
  cleaned = cleaned.replace(/^-+|-+$/g, "");
  return cleaned || "my-app";
}

/**
 * Automatically inspect project files and dependencies to detect framework and smart build directory
 */
export function detectFramework(cwd: string = process.cwd()): DetectedProject {
  const packageJsonPath = path.resolve(cwd, "package.json");
  let appName = sanitizeProjectName(path.basename(cwd));
  let framework = "Custom";
  let distPath = "./dist";
  let hasBuildScript = false;

  let pkg: any = null;
  if (fs.existsSync(packageJsonPath)) {
    try {
      const raw = fs.readFileSync(packageJsonPath, "utf-8");
      pkg = JSON.parse(raw);
      if (pkg.name) {
        appName = sanitizeProjectName(pkg.name);
      }
      if (pkg.scripts && pkg.scripts.build) {
        hasBuildScript = true;
      }
    } catch {
      // Ignore JSON parse errors
    }
  }

  // 1. Dependency-based framework detection
  if (pkg) {
    const allDeps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    };

    if (allDeps["next"]) {
      framework = "Next.js";
      distPath = "./out";
    } else if (allDeps["@sveltejs/kit"]) {
      framework = "SvelteKit";
      distPath = "./build";
    } else if (allDeps["nuxt"] || allDeps["nuxt3"]) {
      framework = "Nuxt";
      distPath = "./.output/public";
    } else if (allDeps["@remix-run/react"] || allDeps["@remix-run/dev"]) {
      framework = "Remix";
      distPath = "./build/client";
    } else if (allDeps["@angular/core"] || allDeps["@angular/cli"]) {
      framework = "Angular";
      const browserDir = `./dist/${appName}/browser`;
      if (fs.existsSync(path.resolve(cwd, browserDir))) {
        distPath = browserDir;
      } else {
        distPath = "./dist";
      }
    } else if (allDeps["astro"]) {
      framework = "Astro";
      distPath = "./dist";
    } else if (allDeps["react-scripts"]) {
      framework = "Create React App";
      distPath = "./build";
    } else if (allDeps["vite"]) {
      framework = "Vite";
      distPath = "./dist";
    } else if (allDeps["@vue/cli-service"]) {
      framework = "Vue CLI";
      distPath = "./dist";
    } else if (allDeps["gatsby"]) {
      framework = "Gatsby";
      distPath = "./public";
    } else if (allDeps["parcel"]) {
      framework = "Parcel";
      distPath = "./dist";
    } else if (allDeps["webpack"]) {
      framework = "Webpack";
      distPath = fs.existsSync(path.resolve(cwd, "./build")) ? "./build" : "./dist";
    } else if (allDeps["react"] || allDeps["react-dom"]) {
      framework = "React";
      distPath = fs.existsSync(path.resolve(cwd, "./build")) ? "./build" : "./dist";
    } else if (allDeps["vue"]) {
      framework = "Vue";
      distPath = "./dist";
    } else if (allDeps["solid-js"]) {
      framework = "SolidJS";
      distPath = "./dist";
    } else if (allDeps["preact"]) {
      framework = "Preact";
      distPath = "./dist";
    } else if (allDeps["@11ty/eleventy"] || allDeps["eleventy"]) {
      framework = "Eleventy";
      distPath = "./_site";
    } else if (pkg.name) {
      framework = "Node.js WebApp";
    }
  }

  // 2. Filesystem-based inspection fallback if distPath does not exist on disk
  if (!fs.existsSync(path.resolve(cwd, distPath))) {
    const candidateDirs = [
      "./dist",
      "./build",
      "./out",
      "./public",
      "./_site",
      "./.output/public",
    ];

    for (const candidate of candidateDirs) {
      const indexFile = path.resolve(cwd, candidate, "index.html");
      if (fs.existsSync(indexFile)) {
        distPath = candidate;
        if (framework === "Custom") {
          framework = "Static WebApp";
        }
        break;
      }
    }

    // Check if root directory contains index.html (Static HTML site)
    if (!fs.existsSync(path.resolve(cwd, distPath))) {
      const rootIndex = path.resolve(cwd, "index.html");
      if (fs.existsSync(rootIndex)) {
        distPath = ".";
        framework = "Static HTML";
      }
    }
  }

  return {
    framework,
    distPath,
    appName,
    hasBuildScript,
  };
}
