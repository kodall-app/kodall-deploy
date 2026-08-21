import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { BuildCheckResult } from "./types.js";

const DEFAULT_SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".js",
  ".tsx",
  ".jsx",
  ".vue",
  ".svelte",
  ".astro",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".json",
  ".graphql",
  ".gql",
  ".md",
  ".mdx",
]);

const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".one-deploy",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".output",
  ".turbo",
  ".cache",
  "coverage",
  "dist",
  "build",
  "out",
]);

const IGNORED_FILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "kodall-webapp.config.json",
  "config_web_app.json",
  ".one-deploy-history.json",
]);

/**
 * Checks if a build directory is missing or stale compared to project source files
 */
export function checkBuildStatus(
  distPath: string = "./dist",
  cwd: string = process.cwd()
): BuildCheckResult {
  const resolvedDist = path.resolve(cwd, distPath);
  const indexHtmlPath = path.resolve(resolvedDist, "index.html");

  const packageJsonPath = path.resolve(cwd, "package.json");
  let hasBuildScript = false;

  if (fs.existsSync(packageJsonPath)) {
    try {
      const raw = fs.readFileSync(packageJsonPath, "utf-8");
      const pkg = JSON.parse(raw);
      if (pkg.scripts && pkg.scripts.build) {
        hasBuildScript = true;
      }
    } catch {
      // Ignore JSON parse errors
    }
  }

  let distMtime: number | undefined;
  const exists = fs.existsSync(resolvedDist) && fs.existsSync(indexHtmlPath);

  if (exists) {
    try {
      distMtime = fs.statSync(indexHtmlPath).mtimeMs;
    } catch {
      distMtime = undefined;
    }
  }

  // Scan project tree for the latest source modification time
  let newestSourceFile: string | undefined;
  let newestSourceMtime = 0;

  function walk(dir: string, depth = 0) {
    if (depth > 8) return; // Prevent excessive deep recursion

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relative = path.relative(cwd, fullPath);

      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name) || fullPath === resolvedDist) {
          continue;
        }
        walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        if (IGNORED_FILES.has(entry.name)) {
          continue;
        }

        const ext = path.extname(entry.name).toLowerCase();
        if (DEFAULT_SOURCE_EXTENSIONS.has(ext)) {
          try {
            const stat = fs.statSync(fullPath);
            if (stat.mtimeMs > newestSourceMtime) {
              newestSourceMtime = stat.mtimeMs;
              newestSourceFile = relative.replace(/\\/g, "/");
            }
          } catch {
            // Ignore unreadable files
          }
        }
      }
    }
  }

  walk(cwd);

  const isStale =
    exists &&
    distMtime !== undefined &&
    newestSourceMtime > distMtime + 1500; // 1.5s tolerance for filesystem clock variance

  return {
    exists,
    isStale,
    hasBuildScript,
    distPath,
    newestSourceFile,
    newestSourceMtime: newestSourceMtime > 0 ? newestSourceMtime : undefined,
    distMtime,
  };
}

/**
 * Executes the project's build script (npm run build)
 */
export async function runBuild(
  cwd: string = process.cwd()
): Promise<{ success: boolean; durationMs: number; error?: string }> {
  const startTime = Date.now();

  return new Promise((resolve) => {
    // Determine npm binary depending on OS
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = spawn(npmCmd, ["run", "build"], {
      cwd,
      stdio: "inherit",
      shell: true,
    });

    child.on("close", (code) => {
      const durationMs = Date.now() - startTime;
      if (code === 0) {
        resolve({ success: true, durationMs });
      } else {
        resolve({
          success: false,
          durationMs,
          error: `Build command failed with exit code ${code}`,
        });
      }
    });

    child.on("error", (err) => {
      const durationMs = Date.now() - startTime;
      resolve({
        success: false,
        durationMs,
        error: `Could not execute build command: ${err.message}`,
      });
    });
  });
}
