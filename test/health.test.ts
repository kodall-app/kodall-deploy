import * as http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkEndpointHealth } from "../src/core/health.js";

describe("Health Check Ping", () => {
  let server: http.Server;
  let serverUrl: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = req.url || "";
      if (url === "/live-test") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html><body>OK</body></html>");
      } else if (url === "/error-test") {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Server Error");
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

  it("should return ok: true for 200 responses", async () => {
    const result = await checkEndpointHealth(`${serverUrl}/live-test`);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("should return ok: false for 404 responses", async () => {
    const result = await checkEndpointHealth(`${serverUrl}/nonexistent`);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });

  it("should return ok: false for 500 responses", async () => {
    const result = await checkEndpointHealth(`${serverUrl}/error-test`);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
  });

  it("should handle network connection errors gracefully without throwing", async () => {
    const result = await checkEndpointHealth("http://127.0.0.1:59999/down");
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
});
