import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearDeploymentHistory,
  getDeploymentHistory,
  getPreviousDeployment,
  readDeploymentHistory,
  recordDeployment,
} from "../src/core/history.js";
import { DeploymentRecord } from "../src/core/types.js";

describe("History Storage Layer", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kodall-history-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should record and read deployment events in reverse chronological order", () => {
    const record1: DeploymentRecord = {
      id: "dep-1",
      timestamp: "2026-08-20T10:00:00.000Z",
      env: "dev",
      instance: "https://dev.kodall.ro",
      entityKey: "24",
      storageId: "101",
      webAppName: "my-app",
      webAppPath: "/app",
      action: "created",
      username: "admin",
      durationMs: 250,
    };

    const record2: DeploymentRecord = {
      id: "dep-2",
      timestamp: "2026-08-20T11:00:00.000Z",
      env: "dev",
      instance: "https://dev.kodall.ro",
      entityKey: "24",
      storageId: "102",
      webAppName: "my-app",
      webAppPath: "/app",
      action: "updated",
      username: "admin",
      durationMs: 180,
    };

    recordDeployment(record1, tempDir);
    recordDeployment(record2, tempDir);

    const history = readDeploymentHistory(tempDir);
    expect(history.length).toBe(2);
    expect(history[0].id).toBe("dep-2"); // Newest first
    expect(history[1].id).toBe("dep-1");
  });

  it("should filter history by environment", () => {
    recordDeployment(
      {
        id: "dep-dev",
        timestamp: "2026-08-20T10:00:00.000Z",
        env: "dev",
        instance: "https://dev.kodall.ro",
        entityKey: "24",
        storageId: "101",
        webAppName: "my-app",
        webAppPath: "/app",
        action: "created",
      },
      tempDir
    );

    recordDeployment(
      {
        id: "dep-prod",
        timestamp: "2026-08-20T11:00:00.000Z",
        env: "prod",
        instance: "https://app.kodall.ro",
        entityKey: "25",
        storageId: "102",
        webAppName: "my-app",
        webAppPath: "/app",
        action: "created",
      },
      tempDir
    );

    const devHistory = getDeploymentHistory(tempDir, "dev");
    const prodHistory = getDeploymentHistory(tempDir, "prod");
    const allHistory = getDeploymentHistory(tempDir);

    expect(devHistory.length).toBe(1);
    expect(devHistory[0].env).toBe("dev");
    expect(prodHistory.length).toBe(1);
    expect(prodHistory[0].env).toBe("prod");
    expect(allHistory.length).toBe(2);
  });

  it("should retrieve previous deployment record correctly", () => {
    recordDeployment(
      {
        id: "dep-old",
        timestamp: "2026-08-20T10:00:00.000Z",
        env: "prod",
        instance: "https://app.kodall.ro",
        entityKey: "25",
        storageId: "100",
        webAppName: "my-app",
        webAppPath: "/app",
        action: "created",
      },
      tempDir
    );

    recordDeployment(
      {
        id: "dep-current",
        timestamp: "2026-08-20T12:00:00.000Z",
        env: "prod",
        instance: "https://app.kodall.ro",
        entityKey: "25",
        storageId: "101",
        webAppName: "my-app",
        webAppPath: "/app",
        action: "updated",
      },
      tempDir
    );

    const prev = getPreviousDeployment(tempDir, "prod", 1);
    expect(prev).toBeDefined();
    expect(prev?.storageId).toBe("100");
    expect(prev?.id).toBe("dep-old");
  });

  it("should clear deployment history file", () => {
    recordDeployment(
      {
        id: "dep-1",
        timestamp: "2026-08-20T10:00:00.000Z",
        env: "dev",
        instance: "https://dev.kodall.ro",
        entityKey: "24",
        storageId: "101",
        webAppName: "my-app",
        webAppPath: "/app",
        action: "created",
      },
      tempDir
    );

    expect(readDeploymentHistory(tempDir).length).toBe(1);
    clearDeploymentHistory(tempDir);
    expect(readDeploymentHistory(tempDir).length).toBe(0);
  });

  it("should store history inside .one-deploy/history.json and auto-update .gitignore", () => {
    // Create initial .gitignore
    const gitignorePath = path.join(tempDir, ".gitignore");
    fs.writeFileSync(gitignorePath, "node_modules/\ndist/\n", "utf-8");

    recordDeployment(
      {
        id: "dep-1",
        timestamp: "2026-08-20T10:00:00.000Z",
        env: "dev",
        instance: "https://dev.kodall.ro",
        entityKey: "24",
        storageId: "101",
        webAppName: "my-app",
        webAppPath: "/app",
        action: "created",
      },
      tempDir
    );

    // Verify .one-deploy/history.json exists
    const historyJsonPath = path.join(tempDir, ".one-deploy", "history.json");
    expect(fs.existsSync(historyJsonPath)).toBe(true);

    // Verify .gitignore was updated
    const updatedGitignore = fs.readFileSync(gitignorePath, "utf-8");
    expect(updatedGitignore).toContain(".one-deploy/");
  });
});

