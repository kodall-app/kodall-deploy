import * as http from "node:http";
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

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = req.url || "";
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });

      req.on("end", () => {
        // Mock query FETCH web_app
        if (url === "/rest/fetch" && req.method === "POST") {
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
});
