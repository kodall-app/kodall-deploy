import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rollback } from "../src/core/rollback.js";
import { recordDeployment } from "../src/core/history.js";

describe("Rollback Engine", () => {
  let server: http.Server;
  let serverUrl: string;
  let serverVersion: string | null = null;
  let webAppEntity: any = {
    key: "entity_key_24",
    name: "test-app",
    path: "/test-app",
    id_storage_file: "101",
  };
  let updateCalled = false;
  let updatedStorageValue: any = null;
  let updatedVersionValue: any = null;
  let updatedPathValue: any = null;
  let updateReturnsProblem = false;
  let updateReturnsValidation = false;
  let entityMissing = false;
  let fetchReturnsUnrelatedEntity = false;
  let fetchThrowsForLog = false;
  let fetchThrowsFirstEntityQuery = false;
  let fetchThrowsAllEntityQueries = false;
  let sessionThrows = false;
  let mockLogs: any[] = [];


  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = req.url || "";
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });

      req.on("end", () => {
        // Mock session version check
        if (url === "/auth" && req.method === "GET") {
          if (sessionThrows) {
            res.writeHead(500, { "Content-Type": "text/plain" });
            res.end("Session failure");
            return;
          }
          if (serverVersion) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ version: serverVersion, userName: "admin" }));
          } else {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ version: "1.7.0", userName: "admin" }));
          }
          return;
        }


        // Mock auth
        if (url === "/auth" && req.method === "POST") {
          const oidcToken = req.headers["oidc-auth-token"];
          if (oidcToken === "valid-token") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ userName: "oidc-user" }));
            return;
          }
          if (oidcToken === "invalid-token") {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ detail: "Token expired" }));
            return;
          }

          let parsed: any = {};
          try {
            parsed = JSON.parse(body || "{}");
          } catch {}

          if (parsed.user === "admin" && parsed.password === "correct") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ userName: "admin" }));
            return;
          } else {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ detail: "Bad credentials" }));
            return;
          }
        }


        // Mock query FETCH
        if (url === "/rest/fetch" && req.method === "POST") {
          if (body.includes("web_app_log")) {
            if (fetchThrowsForLog) {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ detail: "Database query error" }));
              return;
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(mockLogs));
            return;
          }

          if (fetchThrowsAllEntityQueries) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ detail: "Fatal query error" }));
            return;
          }

          if (fetchThrowsFirstEntityQuery && body.includes("id_storage_file")) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ detail: "Column does not exist" }));
            return;
          }


          if (entityMissing) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify([]));
            return;
          }
          if (fetchReturnsUnrelatedEntity) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify([{ key: 999, name: "other-app", path: "/other" }]));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify([
              {
                key: webAppEntity.key,
                name: webAppEntity.name,
                path: webAppEntity.path,
                id_storage_file: webAppEntity.id_storage_file,
              },
            ])
          );
          return;
        }



        // Mock entity update
        if (url === `/rest/entity/web_app/${webAppEntity.key}` && req.method === "POST") {
          if (updateReturnsValidation) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ discriminator: "validation", detail: "Invalid storage id" }));
            return;
          }
          if (updateReturnsProblem) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ detail: "Database lock error" }));
            return;
          }

          updateCalled = true;
          const parsed = JSON.parse(body);
          updatedStorageValue = parsed.properties.id_storage_file;
          updatedVersionValue = parsed.properties.id_storage_file_version;
          updatedPathValue = parsed.properties.path;
          if (updatedStorageValue !== undefined) {
            webAppEntity.id_storage_file = updatedStorageValue;
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ key: webAppEntity.key, operation: "update" }));
          return;
        }

        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ detail: "Not found" }));
      });
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

  it("should repoint web_app entity storage to targetStorageId without re-uploading", async () => {
    serverVersion = null;
    updateCalled = false;
    updatedStorageValue = null;
    updateReturnsProblem = false;
    updateReturnsValidation = false;
    entityMissing = false;
    fetchReturnsUnrelatedEntity = false;

    const result = await rollback({
      instance: serverUrl,
      webAppName: "test-app",
      webAppPath: "/test-app",
      targetStorageId: "99",
      apiKey: "mock-api-key",
      silent: true,
    });

    expect(result.success).toBe(true);
    expect(result.toStorageId).toBe("99");
    expect(result.entityKey).toBe("entity_key_24");
    expect(updateCalled).toBe(true);
    expect(updatedStorageValue).toBe("99");
  });

  it("should support username and password authentication during rollback", async () => {
    updateCalled = false;
    const result = await rollback({
      instance: serverUrl,
      webAppName: "test-app",
      webAppPath: "/test-app",
      targetStorageId: "99",
      username: "admin",
      password: "correct",
      silent: true,
    });

    expect(result.success).toBe(true);
    expect(updateCalled).toBe(true);
  });

  it("should support OIDC token authentication during rollback", async () => {
    updateCalled = false;
    const result = await rollback({
      instance: serverUrl,
      webAppName: "test-app",
      webAppPath: "/test-app",
      targetStorageId: "99",
      token: "valid-token",
      silent: true,
    });

    expect(result.success).toBe(true);
    expect(updateCalled).toBe(true);

    await expect(
      rollback({
        instance: serverUrl,
        webAppName: "test-app",
        targetStorageId: "99",
        token: "invalid-token",
        silent: true,
      })
    ).rejects.toThrow("Authentication failed: Token expired");
  });

  it("should fail rollback when credentials are bad or missing", async () => {
    // Missing credentials
    await expect(
      rollback({
        instance: serverUrl,
        webAppName: "test-app",
        targetStorageId: "99",
        silent: true,
      })
    ).rejects.toThrow("Missing credentials");

    // Bad password
    await expect(
      rollback({
        instance: serverUrl,
        webAppName: "test-app",
        targetStorageId: "99",
        username: "admin",
        password: "wrong",
        silent: true,
      })
    ).rejects.toThrow("Authentication failed: Bad credentials");
  });

  it("should fail rollback when target instance or app identifiers are missing", async () => {
    await expect(
      rollback({
        instance: "",
        webAppName: "test-app",
        silent: true,
      })
    ).rejects.toThrow("Missing target instance");

    await expect(
      rollback({
        instance: serverUrl,
        silent: true,
      })
    ).rejects.toThrow("Missing web_app_name or web_app_path");
  });

  it("should rollback using local history on legacy servers when stepsBack is specified", async () => {
    serverVersion = null;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kodall-rb-hist-"));
    try {
      recordDeployment(
        {
          id: "dep1",
          timestamp: new Date().toISOString(),
          env: "dev",
          instance: serverUrl,
          entityKey: "entity_key_24",
          storageId: 10,
          webAppName: "test-app",
          webAppPath: "/test-app",
          action: "created",
        },
        tempDir
      );
      recordDeployment(
        {
          id: "dep2",
          timestamp: new Date().toISOString(),
          env: "dev",
          instance: serverUrl,
          entityKey: "entity_key_24",
          storageId: 20,
          webAppName: "test-app",
          webAppPath: "/test-app",
          action: "updated",
        },
        tempDir
      );

      updateCalled = false;
      const result = await rollback(
        {
          instance: serverUrl,
          webAppName: "test-app",
          env: "dev",
          stepsBack: 1,
          apiKey: "mock-api-key",
          silent: true,
        },
        tempDir
      );

      expect(result.success).toBe(true);
      expect(result.toStorageId).toBe(10);
      expect(updateCalled).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should fail rollback when stepsBack is requested without history", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kodall-rb-test-"));
    try {
      await expect(
        rollback(
          {
            instance: serverUrl,
            webAppName: "test-app",
            stepsBack: 1,
            apiKey: "mock-api-key",
            silent: true,
          },
          tempDir
        )
      ).rejects.toThrow("No previous deployment history found");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should fail rollback when entity is not found on instance", async () => {
    entityMissing = true;
    await expect(
      rollback({
        instance: serverUrl,
        webAppName: "nonexistent-app",
        targetStorageId: "123",
        apiKey: "mock-api-key",
        silent: true,
      })
    ).rejects.toThrow("Cannot rollback nonexistent entity");
    entityMissing = false;

    // When entity list contains unrelated entities
    fetchReturnsUnrelatedEntity = true;
    await expect(
      rollback({
        instance: serverUrl,
        webAppName: "test-app",
        targetStorageId: "123",
        apiKey: "mock-api-key",
        silent: true,
      })
    ).rejects.toThrow("Cannot rollback nonexistent entity");
    fetchReturnsUnrelatedEntity = false;
  });

  it("should rollback on server >= 1.8.0 using web_app_log and id_storage_file_version", async () => {
    serverVersion = "1.8.0";
    updateCalled = false;
    updatedVersionValue = null;
    updatedPathValue = null;
    fetchThrowsForLog = false;
    mockLogs = [
      { key: 102, storageFileVersionKey: 502, file_name: "v2.zip", path: "/test-app" },
      { key: 101, storageFileVersionKey: 501, file_name: "v1.zip", path: "/test-app-old" },
    ];

    const result = await rollback({
      instance: serverUrl,
      webAppName: "test-app",
      webAppPath: "/test-app",
      stepsBack: 1,
      apiKey: "mock-api-key",
      silent: true,
    });

    expect(result.success).toBe(true);
    expect(result.toStorageId).toBe(501);
    expect(updatedVersionValue).toBe(501);
    expect(updatedPathValue).toBe("/test-app-old");
    expect(updateCalled).toBe(true);

    // Explicit targetStorageId on server >= 1.8.0
    updateCalled = false;
    const directResult = await rollback({
      instance: serverUrl,
      webAppName: "test-app",
      targetStorageId: 777,
      apiKey: "mock-api-key",
      silent: true,
    });
    expect(directResult.success).toBe(true);
    expect(directResult.toStorageId).toBe(777);
    expect(updatedVersionValue).toBe(777);

    // Error querying web_app_log
    fetchThrowsForLog = true;
    await expect(
      rollback({
        instance: serverUrl,
        webAppName: "test-app",
        stepsBack: 1,
        apiKey: "mock-api-key",
        silent: true,
      })
    ).rejects.toThrow("Failed to query deployment log from server");
    fetchThrowsForLog = false;

    // Log entry without storageFileVersionKey
    mockLogs = [
      { key: 102, storageFileVersionKey: 502 },
      { key: 101, storageFileVersionKey: null },
    ];
    await expect(
      rollback({
        instance: serverUrl,
        webAppName: "test-app",
        stepsBack: 1,
        apiKey: "mock-api-key",
        silent: true,
      })
    ).rejects.toThrow("has no storage_file_version");
  });

  it("should fail rollback when entity update returns validation or problem", async () => {
    serverVersion = null;
    updateReturnsValidation = true;
    await expect(
      rollback({
        instance: serverUrl,
        webAppName: "test-app",
        targetStorageId: "123",
        apiKey: "mock-api-key",
        silent: true,
      })
    ).rejects.toThrow("Rollback validation error");
    updateReturnsValidation = false;

    updateReturnsProblem = true;
    await expect(
      rollback({
        instance: serverUrl,
        webAppName: "test-app",
        targetStorageId: "123",
        apiKey: "mock-api-key",
        silent: true,
      })
    ).rejects.toThrow("Rollback error: Database lock error");
    updateReturnsProblem = false;

    // And with serverVersion >= 1.8.0
    serverVersion = "1.8.0";
    updateReturnsValidation = true;
    await expect(
      rollback({
        instance: serverUrl,
        webAppName: "test-app",
        targetStorageId: 777,
        apiKey: "mock-api-key",
        silent: true,
      })
    ).rejects.toThrow("Rollback validation error");
    updateReturnsValidation = false;

    updateReturnsProblem = true;
    await expect(
      rollback({
        instance: serverUrl,
        webAppName: "test-app",
        targetStorageId: 777,
        apiKey: "mock-api-key",
        silent: true,
      })
    ).rejects.toThrow("Rollback error: Database lock error");
    updateReturnsProblem = false;
  });

  it("should handle schema fallback query during entity lookup", async () => {
    serverVersion = null;
    fetchThrowsFirstEntityQuery = true;

    const result = await rollback({
      instance: serverUrl,
      webAppName: "test-app",
      targetStorageId: 999,
      apiKey: "mock-api-key",
      silent: true,
    });

    expect(result.success).toBe(true);
    expect(updatedStorageValue).toBe(999);
    fetchThrowsFirstEntityQuery = false;
  });

  it("should fail rollback when all entity lookup queries throw", async () => {
    serverVersion = null;
    fetchThrowsAllEntityQueries = true;

    await expect(
      rollback({
        instance: serverUrl,
        webAppName: "test-app",
        targetStorageId: 999,
        apiKey: "mock-api-key",
        silent: true,
      })
    ).rejects.toThrow("Cannot rollback nonexistent entity");


    fetchThrowsAllEntityQueries = false;
  });

  it("should handle session version check throwing during rollback initialization", async () => {
    sessionThrows = true;
    serverVersion = null;

    const result = await rollback({
      instance: serverUrl,
      webAppName: "test-app",
      targetStorageId: 999,
      apiKey: "mock-api-key",
      silent: true,
    });

    expect(result.success).toBe(true);
    sessionThrows = false;
  });
});





