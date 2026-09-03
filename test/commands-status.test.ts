import { describe, expect, it, vi } from "vitest";
import { displayStatusDashboard, handleStatusDashboard } from "../src/commands/status.js";
import * as statusCore from "../src/core/status.js";
import { RemoteEnvironmentStatus } from "../src/core/types.js";
import { log } from "../src/ui/logger.js";

describe("commands/status", () => {
  it("should display empty message when no statuses provided", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    displayStatusDashboard([]);
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("should display formatted table with ONLINE, NOT_FOUND, PROTECTED, OFFLINE, and ERROR badges", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const statuses: RemoteEnvironmentStatus[] = [
      {
        env: "dev",
        isDefault: true,
        instanceUrl: "https://dev.kodall.ro",
        state: "ONLINE",
        httpStatus: 200,
        httpStatusText: "OK",
        latencyMs: 85,
        storageId: 101,
        entityKey: 202,
        webAppName: "app",
        webAppPath: "/app",
      },
      {
        env: "staging",
        isDefault: false,
        instanceUrl: "https://staging.kodall.ro",
        state: "NOT_FOUND",
        httpStatus: 404,
        httpStatusText: "Not Found",
        latencyMs: 120,
        webAppName: "app",
        webAppPath: "/staging",
      },
      {
        env: "prod",
        isDefault: false,
        instanceUrl: "https://app.kodall.ro",
        state: "PROTECTED",
        httpStatus: 401,
        httpStatusText: "Unauthorized",
        latencyMs: 60,
        webAppName: "app",
        webAppPath: "/prod",
      },
      {
        env: "offline-env",
        isDefault: false,
        instanceUrl: "https://offline.kodall.ro",
        state: "OFFLINE",
        httpStatus: 0,
        httpStatusText: "",
        latencyMs: 0,
        error: "Unreachable",
        webAppName: "app",
        webAppPath: "/offline",
      },
      {
        env: "no-resp-env",
        isDefault: false,
        instanceUrl: "https://no-resp.kodall.ro",
        state: "OFFLINE",
        httpStatus: 0,
        httpStatusText: "",
        latencyMs: 0,
        webAppName: "app",
        webAppPath: "/no-resp",
      },
      {
        env: "broken-env",
        isDefault: false,
        instanceUrl: undefined as any,
        state: "ERROR",
        httpStatus: 500,
        httpStatusText: "Internal Error",
        latencyMs: 300,
        webAppName: "app",
        webAppPath: undefined as any,
      },
    ];

    displayStatusDashboard(statuses);
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("should handle handleStatusDashboard successfully", async () => {
    vi.spyOn(statusCore, "checkAllEnvironmentsStatus").mockResolvedValueOnce([
      {
        env: "dev",
        isDefault: true,
        instanceUrl: "https://dev.kodall.ro",
        state: "ONLINE",
        httpStatus: 200,
        httpStatusText: "OK",
        latencyMs: 40,
        webAppName: "app",
        webAppPath: "/app",
      },
    ]);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleStatusDashboard("kodall-webapp.config.json", undefined, { user: "admin", password: "pwd" });
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("should handle error in handleStatusDashboard", async () => {
    vi.spyOn(statusCore, "checkAllEnvironmentsStatus").mockRejectedValueOnce(
      new Error("Status check failed")
    );
    const errorSpy = vi.spyOn(log, "error").mockImplementation(() => {});
    await handleStatusDashboard("kodall-webapp.config.json");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Status check failed"));
    errorSpy.mockRestore();
  });
});
