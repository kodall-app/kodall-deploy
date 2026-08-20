import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deploy } from "../src/core/deployer.js";

describe("Deployer Pipeline", () => {
  let tempDir: string;
  let distDir: string;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kodall-deploy-test-"));
    distDir = path.join(tempDir, "dist");
    fs.mkdirSync(distDir);
    fs.writeFileSync(path.join(distDir, "index.html"), "<html><body>App</body></html>");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("should complete full deployment and create new entity if not found", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/auth")) {
        const headers = new Headers();
        headers.append("set-cookie", "one.erp.rest.csrf.token=csrf_123; Path=/");
        return Promise.resolve(
          new Response(JSON.stringify({ userName: "admin" }), { status: 200, headers })
        );
      }
      if (url.endsWith("/rest/fetch")) {
        // Return empty array (entity does not exist yet)
        return Promise.resolve(
          new Response(JSON.stringify([]), { status: 200 })
        );
      }
      if (url.endsWith("/storage")) {
        return Promise.resolve(
          new Response(JSON.stringify([{ id: 555, name: "web_app.zip" }]), { status: 200 })
        );
      }
      if (url.endsWith("/rest/entity/web_app")) {
        return Promise.resolve(
          new Response(JSON.stringify({ key: 42, operation: "insert" }), { status: 200 })
        );
      }
      return Promise.reject(new Error(`Unhandled mock URL: ${url}`));
    });

    const result = await deploy(
      {
        instance: "https://mock.instance.com",
        webAppName: "my-app",
        webAppPath: "my-app",
        distPath: distDir,
        username: "admin",
        password: "password123",
      },
      tempDir
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("created");
    expect(result.storageId).toBe(555);
    expect(result.entityKey).toBe(42);
    expect(result.archiveSizeBytes).toBeGreaterThan(0);
  });

  it("should update existing entity when fetch query finds existing key", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/auth")) {
        return Promise.resolve(
          new Response(JSON.stringify({ userName: "admin" }), { status: 200 })
        );
      }
      if (url.endsWith("/rest/fetch")) {
        // Return existing entity key
        return Promise.resolve(
          new Response(JSON.stringify([{ key: 88 }]), { status: 200 })
        );
      }
      if (url.endsWith("/storage")) {
        return Promise.resolve(
          new Response(JSON.stringify([{ id: 777, name: "web_app.zip" }]), { status: 200 })
        );
      }
      if (url.endsWith("/rest/entity/web_app/88")) {
        return Promise.resolve(
          new Response(JSON.stringify({ key: 88, operation: "update" }), { status: 200 })
        );
      }
      return Promise.reject(new Error(`Unhandled mock URL: ${url}`));
    });

    const result = await deploy(
      {
        instance: "https://mock.instance.com",
        webAppName: "my-app",
        webAppPath: "my-app",
        distPath: distDir,
        username: "admin",
        password: "password123",
      },
      tempDir
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("updated");
    expect(result.storageId).toBe(777);
    expect(result.entityKey).toBe(88);
  });

  it("should support dry-run mode without modifying storage or entity", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/auth")) {
        return Promise.resolve(
          new Response(JSON.stringify({ userName: "admin" }), { status: 200 })
        );
      }
      if (url.endsWith("/rest/fetch")) {
        return Promise.resolve(
          new Response(JSON.stringify([{ key: 88 }]), { status: 200 })
        );
      }
      return Promise.reject(new Error(`Should not call during dry run: ${url}`));
    });
    globalThis.fetch = fetchMock;

    const result = await deploy(
      {
        instance: "https://mock.instance.com",
        webAppName: "my-app",
        webAppPath: "my-app",
        distPath: distDir,
        username: "admin",
        password: "password123",
        dryRun: true,
      },
      tempDir
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("dry-run");
    expect(result.entityKey).toBe(88);
  });
});
