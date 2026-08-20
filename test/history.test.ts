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
        instance: "https://prod.kodall.ro",
        entityKey: "24",
        storageId: "102",
        webAppName: "my-app",
        webAppPath: "/app",
        action: "updated",
      },
      tempDir
    );

    const devHistory = getDeploymentHistory(tempDir, "dev");
    expect(devHistory.length).toBe(1);
    expect(devHistory[0].env).toBe("dev");

    const prodHistory = getDeploymentHistory(tempDir, "prod");
    expect(prodHistory.length).toBe(1);
    expect(prodHistory[0].env).toBe("prod");
  });

  it("should retrieve previous deployment and handle out-of-bounds", () => {
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
    recordDeployment(
      {
        id: "dep-2",
        timestamp: "2026-08-20T11:00:00.000Z",
        env: "dev",
        instance: "https://dev.kodall.ro",
        entityKey: "24",
        storageId: "102",
        webAppName: "my-app",
        webAppPath: "/app",
        action: "updated",
      },
      tempDir
    );

    const prev = getPreviousDeployment(tempDir, "dev", 1);
    expect(prev?.id).toBe("dep-1");

    const notFound = getPreviousDeployment(tempDir, "dev", 5);
    expect(notFound).toBeUndefined();
  });

  it("should clear deployment history files", () => {
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

    // Create legacy file too
    fs.writeFileSync(path.join(tempDir, ".one-deploy-history.json"), "[]");

    clearDeploymentHistory(tempDir);
    expect(readDeploymentHistory(tempDir)).toEqual([]);
  });

  it("should ensure .gitignore ignores .one-deploy/", () => {
    const gitignorePath = path.join(tempDir, ".gitignore");
    fs.writeFileSync(gitignorePath, "node_modules\n", "utf-8");

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

    expect(fs.readFileSync(gitignorePath, "utf-8")).toContain(".one-deploy/");

    // When .one-deploy/ is already present, do not duplicate
    recordDeployment(
      {
        id: "dep-2",
        timestamp: "2026-08-20T11:00:00.000Z",
        env: "dev",
        instance: "https://dev.kodall.ro",
        entityKey: "24",
        storageId: "102",
        webAppName: "my-app",
        webAppPath: "/app",
        action: "updated",
      },
      tempDir
    );
    expect(fs.readFileSync(gitignorePath, "utf-8")).toContain(".one-deploy/");
  });

  it("should read from legacy history file and clean it up on new record", () => {
    const legacyPath = path.join(tempDir, ".one-deploy-history.json");
    fs.writeFileSync(
      legacyPath,
      JSON.stringify([
        {
          id: "legacy-dep",
          timestamp: "2026-08-20T09:00:00.000Z",
          env: "dev",
          instance: "https://dev.kodall.ro",
          entityKey: "24",
          storageId: "99",
          webAppName: "my-app",
          webAppPath: "/app",
          action: "created",
        },
      ]),
      "utf-8"
    );

    // Should read legacy record
    const history = readDeploymentHistory(tempDir);
    expect(history.length).toBe(1);
    expect(history[0].id).toBe("legacy-dep");

    // Recording new deployment should migrate and remove legacy file
    recordDeployment(
      {
        id: "new-dep",
        timestamp: "2026-08-20T10:00:00.000Z",
        env: "dev",
        instance: "https://dev.kodall.ro",
        entityKey: "24",
        storageId: "100",
        webAppName: "my-app",
        webAppPath: "/app",
        action: "updated",
      },
      tempDir
    );

    expect(fs.existsSync(legacyPath)).toBe(false);
    const updated = readDeploymentHistory(tempDir);
    expect(updated.length).toBe(2);
  });

  it("should handle corrupted json and non-array json gracefully", () => {
    const historyDir = path.join(tempDir, ".one-deploy");
    fs.mkdirSync(historyDir, { recursive: true });

    // Non-array JSON
    fs.writeFileSync(path.join(historyDir, "history.json"), "{}", "utf-8");
    expect(readDeploymentHistory(tempDir)).toEqual([]);

    // Corrupted JSON
    fs.writeFileSync(path.join(historyDir, "history.json"), "invalid-json-content", "utf-8");
    expect(readDeploymentHistory(tempDir)).toEqual([]);
  });
});
