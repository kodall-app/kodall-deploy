import * as fs from "node:fs";
import * as path from "node:path";
import type { DeploymentRecord } from "./types.js";

export const DEFAULT_HISTORY_DIR = ".kodall-deploy";
export const LEGACY_HISTORY_DIR = ".one-deploy";
export const DEFAULT_HISTORY_FILENAME = "history.json";
export const LEGACY_HISTORY_FILENAME = ".kodall-deploy-history.json";
export const OLD_LEGACY_HISTORY_FILENAME = ".one-deploy-history.json";

/**
 * Resolve absolute path to the local history directory
 */
export function getHistoryDir(cwd: string = process.cwd()): string {
  const primary = path.resolve(cwd, DEFAULT_HISTORY_DIR);
  if (!fs.existsSync(primary) && fs.existsSync(path.resolve(cwd, LEGACY_HISTORY_DIR))) {
    return path.resolve(cwd, LEGACY_HISTORY_DIR);
  }
  return primary;
}

/**
 * Resolve absolute path to the history.json file
 */
export function getHistoryFilePath(cwd: string = process.cwd()): string {
  return path.resolve(getHistoryDir(cwd), DEFAULT_HISTORY_FILENAME);
}

/**
 * Ensure .kodall-deploy/ is added to the project's .gitignore file
 */
export function ensureGitIgnoreEntry(cwd: string = process.cwd()): void {
  const gitignorePath = path.resolve(cwd, ".gitignore");
  try {
    if (!fs.existsSync(gitignorePath)) {
      return;
    }
    const content = fs.readFileSync(gitignorePath, "utf-8");
    const lines = content.split(/\r?\n/);
    const hasEntry = lines.some(
      (l) =>
        l.trim() === ".kodall-deploy" ||
        l.trim() === ".kodall-deploy/" ||
        l.trim() === "/.kodall-deploy" ||
        l.trim() === "/.kodall-deploy/" ||
        l.trim() === ".one-deploy" ||
        l.trim() === ".one-deploy/"
    );

    if (!hasEntry) {
      const entry = "\n# Kodall deploy state\n.kodall-deploy/\n.one-deploy/\n";
      const newContent = content.endsWith("\n") ? `${content}${entry}` : `${content}\n${entry}`;
      fs.writeFileSync(gitignorePath, newContent, "utf-8");
    }
  } catch {
    // Non-fatal if .gitignore is read-only or inaccessible
  }
}

/**
 * Read all historical deployment records from .kodall-deploy/history.json (with legacy fallback)
 */
export function readDeploymentHistory(cwd: string = process.cwd()): DeploymentRecord[] {
  const filePath = getHistoryFilePath(cwd);
  const legacyFilePath = path.resolve(cwd, LEGACY_HISTORY_FILENAME);
  const oldLegacyFilePath = path.resolve(cwd, OLD_LEGACY_HISTORY_FILENAME);

  let targetPath = filePath;

  if (!fs.existsSync(filePath)) {
    if (fs.existsSync(legacyFilePath)) {
      targetPath = legacyFilePath;
    } else if (fs.existsSync(oldLegacyFilePath)) {
      targetPath = oldLegacyFilePath;
    }
  }

  if (!fs.existsSync(targetPath)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(targetPath, "utf-8");
    const data = JSON.parse(raw);
    if (Array.isArray(data)) {
      return data;
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Append or save a deployment record into .one-deploy/history.json
 */
export function recordDeployment(record: DeploymentRecord, cwd: string = process.cwd()): void {
  const dir = getHistoryDir(cwd);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Ensure project's .gitignore ignores .one-deploy/
  ensureGitIgnoreEntry(cwd);

  const filePath = getHistoryFilePath(cwd);
  const current = readDeploymentHistory(cwd);

  // Insert newest record at the front
  current.unshift(record);

  // Keep last 100 deployments
  const trimmed = current.slice(0, 100);

  fs.writeFileSync(filePath, JSON.stringify(trimmed, null, 2), "utf-8");

  // Clean up legacy root file if it exists
  const legacyFilePath = path.resolve(cwd, LEGACY_HISTORY_FILENAME);
  const oldLegacyFilePath = path.resolve(cwd, OLD_LEGACY_HISTORY_FILENAME);
  if (fs.existsSync(legacyFilePath)) {
    try {
      fs.unlinkSync(legacyFilePath);
    } catch {
      // Ignore
    }
  }
  if (fs.existsSync(oldLegacyFilePath)) {
    try {
      fs.unlinkSync(oldLegacyFilePath);
    } catch {
      // Ignore
    }
  }
}

/**
 * Query deployment history, optionally filtered by environment
 */
export function getDeploymentHistory(
  cwd: string = process.cwd(),
  env?: string
): DeploymentRecord[] {
  const records = readDeploymentHistory(cwd);
  if (!env) {
    return records;
  }
  return records.filter((r) => r.env?.toLowerCase() === env.toLowerCase());
}

/**
 * Get a previous deployment record relative to the latest
 * @param stepsBack Number of steps back (1 = immediately previous build, default: 1)
 */
export function getPreviousDeployment(
  cwd: string = process.cwd(),
  env?: string,
  stepsBack: number = 1
): DeploymentRecord | undefined {
  const history = getDeploymentHistory(cwd, env);
  if (history.length <= stepsBack) {
    return undefined;
  }
  return history[stepsBack];
}

/**
 * Clear local deployment history
 */
export function clearDeploymentHistory(cwd: string = process.cwd()): void {
  const filePath = getHistoryFilePath(cwd);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  const legacyFilePath = path.resolve(cwd, LEGACY_HISTORY_FILENAME);
  if (fs.existsSync(legacyFilePath)) {
    fs.unlinkSync(legacyFilePath);
  }
}
