import { afterEach, describe, expect, it, vi } from "vitest";

import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

vi.mock("../src/core/health.js", () => {
  return {
    checkEndpointHealth: () => {
      throw new Error("Unexpected synchronous throw in health checker");
    },
  };
});

describe("Deployer health check throw test", () => {
  const originalFetch = globalThis.fetch;
  let tempDir: string = "";

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (tempDir) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it("should catch unexpected throw from health checker and continue", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kodall-dep-hth-"));
    const distDir = path.join(tempDir, "dist");
    fs.mkdirSync(distDir);
    fs.writeFileSync(path.join(distDir, "index.html"), "<html></html>");

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/auth")) {
        return Promise.resolve(new Response(JSON.stringify({ version: "1.8.0", userName: "admin" }), { status: 200 }));
      }
      if (url.endsWith("/rest/fetch")) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      if (url.includes("/storage")) {
        return Promise.resolve(new Response(JSON.stringify([{ id: 777, name: "app.zip" }]), { status: 200 }));
      }
      if (url.includes("/rest/entity/web_app")) {
        return Promise.resolve(new Response(JSON.stringify({ key: 111, operation: "create" }), { status: 200 }));
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    const { deploy } = await import("../src/core/deployer.js");
    const result = await deploy(
      {
        instance: "https://mock.instance.com",
        webAppName: "health-throw-app",
        webAppPath: "/health-throw-app",
        distPath: distDir,
        apiKey: "test-key",
        healthCheck: true,
      },
      tempDir
    );

    expect(result.success).toBe(true);
  });
});

