import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rollback } from "../src/core/rollback.js";

describe("Rollback Engine", () => {
  let server: http.Server;
  let serverUrl: string;
  let webAppEntity: any = {
    key: "entity_key_24",
    name: "test-app",
    path: "/test-app",
    id_storage_file: "101",
  };
  let updateCalled = false;
  let updatedStorageValue: any = null;
  let updateReturnsProblem = false;
  let updateReturnsValidation = false;
  let entityMissing = false;
  let fetchReturnsUnrelatedEntity = false;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = req.url || "";
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });

      req.on("end", () => {
        // Mock auth
        if (url === "/auth" && req.method === "POST") {
          const parsed = JSON.parse(body);
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

        // Mock query FETCH web_app
        if (url === "/rest/fetch" && req.method === "POST") {
          res.writeHead(200, { "Content-Type": "application/json" });
          if (entityMissing) {
            res.end(JSON.stringify([]));
            return;
          }
          if (fetchReturnsUnrelatedEntity) {
            res.end(JSON.stringify([{ key: 999, name: "other-app", path: "/other" }]));
            return;
          }
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
          webAppEntity.id_storage_file = updatedStorageValue;

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

  it("should fail rollback when target instance is missing", async () => {
    await expect(
      rollback({
        instance: "",
        webAppName: "test-app",
        silent: true,
      })
    ).rejects.toThrow("Missing target instance");
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

  it("should fail rollback when entity update returns validation or problem", async () => {
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
  });
});
