import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  checkAllEnvironmentsStatus,
  checkSingleEnvironmentStatus,
  classifyHealthState,
} from "../src/core/status.js";
import { DEFAULT_CONFIG_FILENAME } from "../src/core/config.js";

describe("Live Remote Status Dashboard", () => {
  let server: http.Server;
  let serverUrl: string;
  let tempDir: string;
  let configPath: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = req.url || "";
      if (url === "/dev-app") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html><body>Online App</body></html>");
      } else if (url === "/staging-down") {
        res.writeHead(503, { "Content-Type": "text/html" });
        res.end("Service Unavailable - Backend Down");
      } else if (url === "/protected-app") {
        res.writeHead(401, { "Content-Type": "text/plain" });
        res.end("Unauthorized");
      } else if (url === "/server-error") {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal Server Error");
      } else if (url === "/auth" && req.method === "POST") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ userName: "admin" }));
      } else if (url === "/rest/fetch" && req.method === "POST") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify([{ key: 102, id: 102, properties: { id_storage_file: 144 } }]));
      } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address() as { port: number };
        serverUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterAll(() => {
    server.close();
  });

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kodall-status-test-"));
    configPath = path.join(tempDir, DEFAULT_CONFIG_FILENAME);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("classifyHealthState", () => {
    it("should classify 200 and 300 range as ONLINE", () => {
      expect(classifyHealthState(200)).toBe("ONLINE");
      expect(classifyHealthState(204)).toBe("ONLINE");
      expect(classifyHealthState(302)).toBe("ONLINE");
    });

    it("should classify 404 as NOT_FOUND", () => {
      expect(classifyHealthState(404)).toBe("NOT_FOUND");
    });

    it("should classify 401 and 403 as PROTECTED", () => {
      expect(classifyHealthState(401)).toBe("PROTECTED");
      expect(classifyHealthState(403)).toBe("PROTECTED");
    });

    it("should classify 502, 503, 504 and 0 as OFFLINE", () => {
      expect(classifyHealthState(502)).toBe("OFFLINE");
      expect(classifyHealthState(503)).toBe("OFFLINE");
      expect(classifyHealthState(504)).toBe("OFFLINE");
      expect(classifyHealthState(0)).toBe("OFFLINE");
      expect(classifyHealthState(408)).toBe("OFFLINE");
    });

    it("should classify 500 as ERROR", () => {
      expect(classifyHealthState(500)).toBe("ERROR");
    });
  });

  describe("checkSingleEnvironmentStatus", () => {
    it("should check online environment status and query entity storage ID (with path without leading slash)", async () => {
      const status = await checkSingleEnvironmentStatus(
        {
          name: "dev",
          isDefault: true,
          type: "dev",
          instance: serverUrl,
          webAppName: "dev-app",
          webAppPath: "dev-app", // No leading slash
          distPath: "./dist",
          hasApiKey: false,
        },
        { username: "admin", password: "123" }
      );

      expect(status.env).toBe("dev");
      expect(status.state).toBe("ONLINE");
      expect(status.httpStatus).toBe(200);
      expect(status.webAppPath).toBe("/dev-app");
      expect(status.entityKey).toBe(102);
      expect(status.storageId).toBe(144);
    });

    it("should gracefully handle entity query network failure", async () => {
      const status = await checkSingleEnvironmentStatus(
        {
          name: "dev",
          isDefault: true,
          type: "dev",
          instance: serverUrl,
          webAppName: "dev-app",
          webAppPath: "/dev-app",
          distPath: "./dist",
          hasApiKey: true,
        }
      );

      expect(status.state).toBe("ONLINE");
    });

    it("should detect 503 Service Unavailable as OFFLINE", async () => {
      const status = await checkSingleEnvironmentStatus({
        name: "staging",
        isDefault: false,
        type: "staging",
        instance: serverUrl,
        webAppName: "staging-down",
        webAppPath: "/staging-down",
        distPath: "./dist",
        hasApiKey: false,
      });

      expect(status.state).toBe("OFFLINE");
      expect(status.httpStatus).toBe(503);
    });

    it("should detect 404 as NOT_FOUND", async () => {
      const status = await checkSingleEnvironmentStatus({
        name: "prod",
        isDefault: false,
        type: "prod",
        instance: serverUrl,
        webAppName: "missing",
        webAppPath: "/missing",
        distPath: "./dist",
        hasApiKey: false,
      });

      expect(status.state).toBe("NOT_FOUND");
      expect(status.httpStatus).toBe(404);
    });

    it("should handle environment with empty instance gracefully", async () => {
      const status = await checkSingleEnvironmentStatus({
        name: "empty",
        isDefault: false,
        type: "dev",
        instance: "",
        webAppName: "empty",
        webAppPath: "/empty",
        distPath: "./dist",
        hasApiKey: false,
      });

      expect(status.state).toBe("OFFLINE");
      expect(status.error).toBeDefined();
    });
  });

  describe("checkAllEnvironmentsStatus", () => {
    it("should check all configured environments in parallel", async () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          web_app_name: "test-app",
          default_env: "dev",
          environments: {
            dev: {
              instance: serverUrl,
              web_app_path: "/dev-app",
            },
            staging: {
              instance: serverUrl,
              web_app_path: "/staging-down",
            },
          },
        }),
        "utf-8"
      );

      const statuses = await checkAllEnvironmentsStatus(configPath, undefined, tempDir);
      expect(statuses.length).toBe(2);

      const devStatus = statuses.find((s) => s.env === "dev");
      expect(devStatus?.state).toBe("ONLINE");
      expect(devStatus?.isDefault).toBe(true);

      const stagingStatus = statuses.find((s) => s.env === "staging");
      expect(stagingStatus?.state).toBe("OFFLINE");
      expect(stagingStatus?.isDefault).toBe(false);
    });

    it("should filter by environment name", async () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          environments: {
            dev: { instance: serverUrl, web_app_path: "/dev-app" },
            prod: { instance: serverUrl, web_app_path: "/dev-app" },
          },
        }),
        "utf-8"
      );

      const statuses = await checkAllEnvironmentsStatus(configPath, "dev", tempDir);
      expect(statuses.length).toBe(1);
      expect(statuses[0].env).toBe("dev");
    });

    it("should throw error when config file does not exist", async () => {
      await expect(
        checkAllEnvironmentsStatus("missing.json", undefined, tempDir)
      ).rejects.toThrow("does not exist");
    });

    it("should throw error when filtered environment is not found", async () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          environments: { dev: { instance: serverUrl } },
        }),
        "utf-8"
      );

      await expect(
        checkAllEnvironmentsStatus(configPath, "prod", tempDir)
      ).rejects.toThrow("not found");
    });
  });
});
