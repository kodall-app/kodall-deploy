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
      if (url.includes("/my-app")) {
        return Promise.resolve(new Response("OK", { status: 200 }));
      }
      return Promise.reject(new Error(`Unhandled mock URL: ${url}`));
    });

    const progressSteps: string[] = [];
    const result = await deploy(
      {
        instance: "https://mock.instance.com",
        webAppName: "my-app",
        webAppPath: "my-app",
        distPath: distDir,
        username: "admin",
        password: "password123",
        onProgress: (step) => progressSteps.push(step),
      },
      tempDir
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("created");
    expect(result.storageId).toBe(555);
    expect(result.entityKey).toBe(42);
    expect(result.archiveSizeBytes).toBeGreaterThan(0);
    expect(progressSteps.length).toBeGreaterThan(0);
  });

  it("should update existing entity when fetch query finds existing key", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
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
      if (url.includes("/my-app")) {
        return Promise.resolve(new Response("Not Found", { status: 404 }));
      }
      return Promise.reject(new Error(`Unhandled mock URL: ${url}`));
    });

    const result = await deploy(
      {
        instance: "https://mock.instance.com",
        webAppName: "my-app",
        webAppPath: "my-app",
        distPath: distDir,
        apiKey: "api-token-123",
      },
      tempDir
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("updated");
    expect(result.storageId).toBe(777);
    expect(result.entityKey).toBe(88);
  });

  it("should support dry-run mode without mutating data", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/auth")) {
        return Promise.resolve(
          new Response(JSON.stringify({ userName: "admin" }), { status: 200 })
        );
      }
      if (url.endsWith("/rest/fetch")) {
        return Promise.resolve(
          new Response(JSON.stringify([{ key: 99 }]), { status: 200 })
        );
      }
      return Promise.reject(new Error(`Should not call: ${url}`));
    });

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
    expect(result.entityKey).toBe(99);
  });

  it("should fail deployment when required parameters are missing", async () => {
    await expect(
      deploy(
        {
          instance: "",
          webAppName: "",
          ci: true,
        },
        tempDir
      )
    ).rejects.toThrow("Missing required deployment parameter");
  });

  it("should throw error when create entity fails with problem or validation", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/auth")) {
        return Promise.resolve(new Response(JSON.stringify({ userName: "admin" }), { status: 200 }));
      }
      if (url.endsWith("/rest/fetch")) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      if (url.endsWith("/storage")) {
        return Promise.resolve(new Response(JSON.stringify([{ id: 111, name: "app.zip" }]), { status: 200 }));
      }
      if (url.endsWith("/rest/entity/web_app")) {
        return Promise.resolve(new Response(JSON.stringify({ detail: "Database duplicate entry" }), { status: 400 }));
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    await expect(
      deploy(
        {
          instance: "https://mock.instance.com",
          webAppName: "my-app",
          webAppPath: "my-app",
          distPath: distDir,
          username: "admin",
          password: "password123",
          healthCheck: false,
        },
        tempDir
      )
    ).rejects.toThrow("Create error: Database duplicate entry");

    // Validation error on create
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/auth")) return Promise.resolve(new Response(JSON.stringify({ userName: "admin" }), { status: 200 }));
      if (url.endsWith("/rest/fetch")) return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      if (url.endsWith("/storage")) return Promise.resolve(new Response(JSON.stringify([{ id: 111, name: "app.zip" }]), { status: 200 }));
      if (url.endsWith("/rest/entity/web_app")) {
        return Promise.resolve(new Response(JSON.stringify({ discriminator: "validation", detail: "Invalid path name" }), { status: 400 }));
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    await expect(
      deploy(
        {
          instance: "https://mock.instance.com",
          webAppName: "my-app",
          webAppPath: "my-app",
          distPath: distDir,
          username: "admin",
          password: "password123",
          healthCheck: false,
        },
        tempDir
      )
    ).rejects.toThrow("Create validation error");
  });

  it("should throw error when update entity fails with problem or validation", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/auth")) {
        return Promise.resolve(new Response(JSON.stringify({ userName: "admin" }), { status: 200 }));
      }
      if (url.endsWith("/rest/fetch")) {
        return Promise.resolve(new Response(JSON.stringify([{ key: 22 }]), { status: 200 }));
      }
      if (url.endsWith("/storage")) {
        return Promise.resolve(new Response(JSON.stringify([{ id: 222, name: "app.zip" }]), { status: 200 }));
      }
      if (url.endsWith("/rest/entity/web_app/22")) {
        return Promise.resolve(new Response(JSON.stringify({ detail: "Permission denied" }), { status: 403 }));
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    await expect(
      deploy(
        {
          instance: "https://mock.instance.com",
          webAppName: "my-app",
          webAppPath: "my-app",
          distPath: distDir,
          username: "admin",
          password: "password123",
          healthCheck: false,
        },
        tempDir
      )
    ).rejects.toThrow("Update error: Permission denied");

    // Validation error on update
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/auth")) return Promise.resolve(new Response(JSON.stringify({ userName: "admin" }), { status: 200 }));
      if (url.endsWith("/rest/fetch")) return Promise.resolve(new Response(JSON.stringify([{ key: 22 }]), { status: 200 }));
      if (url.endsWith("/storage")) return Promise.resolve(new Response(JSON.stringify([{ id: 222, name: "app.zip" }]), { status: 200 }));
      if (url.endsWith("/rest/entity/web_app/22")) {
        return Promise.resolve(new Response(JSON.stringify({ discriminator: "validation", detail: "Invalid entity key" }), { status: 400 }));
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    await expect(
      deploy(
        {
          instance: "https://mock.instance.com",
          webAppName: "my-app",
          webAppPath: "my-app",
          distPath: distDir,
          username: "admin",
          password: "password123",
          healthCheck: false,
        },
        tempDir
      )
    ).rejects.toThrow("Update validation error");
  });

  it("should deploy successfully using OpenID Connect token", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string, init: any) => {
      if (url.endsWith("/auth")) {
        const headerVal = init?.headers?.["Oidc-Auth-Token"] || init?.headers?.["Oidc-auth-token"];
        if (headerVal === "my-valid-oidc-token") {
          return Promise.resolve(new Response(JSON.stringify({ userName: "oidc-admin" }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ detail: "Invalid token" }), { status: 401 }));
      }
      if (url.endsWith("/rest/fetch")) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      if (url.endsWith("/storage")) {
        return Promise.resolve(new Response(JSON.stringify([{ id: 888, name: "app.zip" }]), { status: 200 }));
      }
      if (url.endsWith("/rest/entity/web_app")) {
        return Promise.resolve(new Response(JSON.stringify({ key: 99, operation: "insert" }), { status: 200 }));
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    const result = await deploy(
      {
        instance: "https://mock.instance.com",
        webAppName: "oidc-app",
        webAppPath: "oidc-app",
        distPath: distDir,
        token: "my-valid-oidc-token",
        healthCheck: false,
      },
      tempDir
    );

    expect(result.success).toBe(true);
    expect(result.storageId).toBe(888);
  });

  it("should support server versioning >= 1.8.0 and attach id_storage_file_version", async () => {
    let capturedEntityProperties: any = null;

    globalThis.fetch = vi.fn().mockImplementation((url: string, init: any) => {
      if (url.endsWith("/auth")) {
        return Promise.resolve(
          new Response(JSON.stringify({ version: "1.8.0", userName: "admin" }), { status: 200 })
        );
      }

      if (url.endsWith("/storage")) {
        return Promise.resolve(
          new Response(JSON.stringify([{ id: 900, name: "app.zip" }]), { status: 200 })
        );
      }
      if (url.endsWith("/rest/fetch")) {
        const body = init?.body || "";
        if (body.includes("FETCH storage_file_version")) {
          return Promise.resolve(
            new Response(JSON.stringify([{ key: 456, file_name: "v1.zip" }]), { status: 200 })
          );
        }
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      if (url.includes("/rest/entity/web_app")) {
        capturedEntityProperties = JSON.parse(init.body).properties;
        return Promise.resolve(
          new Response(JSON.stringify({ key: 123, operation: "insert" }), { status: 200 })
        );
      }

      if (url.includes("/versioned-app")) {
        // Return 500 to exercise health check warning branch
        return Promise.resolve(new Response("Server Error", { status: 500, statusText: "Internal Server Error" }));
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    const result = await deploy(
      {
        instance: "https://mock.instance.com",
        webAppName: "versioned-app",
        webAppPath: "/versioned-app",
        distPath: distDir,
        apiKey: "test-key",
      },
      tempDir
    );

    expect(result.success).toBe(true);
    expect(capturedEntityProperties.id_storage_file_version).toBe(456);
    expect(result.healthCheck?.ok).toBe(false);
  });

  it("should throw when storage upload returns non-storage format", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/auth")) {
        return Promise.resolve(new Response(JSON.stringify({ userName: "admin" }), { status: 200 }));
      }
      if (url.endsWith("/rest/fetch")) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      if (url.endsWith("/storage")) {
        return Promise.resolve(new Response(JSON.stringify({ status: "unexpected" }), { status: 200 }));
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    await expect(
      deploy(
        {
          instance: "https://mock.instance.com",
          webAppName: "test-app",
          webAppPath: "/test-app",
          distPath: distDir,
          apiKey: "test-key",
          healthCheck: false,
        },
        tempDir
      )
    ).rejects.toThrow("Unexpected storage response");
  });

  it("should throw when storage upload returns validation error or problem", async () => {
    // Validation
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/auth")) {
        return Promise.resolve(new Response(JSON.stringify({ userName: "admin" }), { status: 200 }));
      }
      if (url.endsWith("/rest/fetch")) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      if (url.endsWith("/storage")) {
        return Promise.resolve(
          new Response(JSON.stringify({ discriminator: "validation", detail: "Quota exceeded" }), {
            status: 400,
          })
        );
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    await expect(
      deploy(
        {
          instance: "https://mock.instance.com",
          webAppName: "test-app",
          webAppPath: "/test-app",
          distPath: distDir,
          apiKey: "test-key",
          healthCheck: false,
        },
        tempDir
      )
    ).rejects.toThrow("Storage upload validation failed: Quota exceeded");

    // Problem
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/auth")) {
        return Promise.resolve(new Response(JSON.stringify({ userName: "admin" }), { status: 200 }));
      }
      if (url.endsWith("/rest/fetch")) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      if (url.endsWith("/storage")) {
        return Promise.resolve(
          new Response(JSON.stringify({ detail: "Disk full" }), { status: 500 })
        );
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    await expect(
      deploy(
        {
          instance: "https://mock.instance.com",
          webAppName: "test-app",
          webAppPath: "/test-app",
          distPath: distDir,
          apiKey: "test-key",
          healthCheck: false,
        },
        tempDir
      )
    ).rejects.toThrow("Storage upload failed: Disk full");
  });

  it("should handle schema fallback when first entity query throws", async () => {
    let fetchCount = 0;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/auth")) {
        return Promise.resolve(new Response(JSON.stringify({ userName: "admin" }), { status: 200 }));
      }
      if (url.endsWith("/rest/fetch")) {
        fetchCount++;
        if (fetchCount === 1) {
          return Promise.reject(new Error("Schema join error"));
        }
        return Promise.resolve(
          new Response(JSON.stringify([{ key: 888, id_storage_file: 77 }]), { status: 200 })
        );
      }
      if (url.includes("/storage")) {
        return Promise.resolve(new Response(JSON.stringify([{ id: 77, name: "app.zip" }]), { status: 200 }));
      }

      if (url.includes("/rest/entity/web_app")) {
        return Promise.resolve(new Response(JSON.stringify({ key: 888, operation: "update" }), { status: 200 }));
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    const result = await deploy(
      {
        instance: "https://mock.instance.com",
        webAppName: "test-app",
        webAppPath: "/test-app",
        distPath: distDir,
        apiKey: "test-key",
        healthCheck: false,
      },
      tempDir
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("updated");
    expect(result.entityKey).toBe(888);
  });

  it("should handle error when both entity queries throw and create new entity", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/auth")) {
        return Promise.resolve(new Response(JSON.stringify({ userName: "admin" }), { status: 200 }));
      }
      if (url.endsWith("/rest/fetch")) {
        return Promise.reject(new Error("Database offline"));
      }
      if (url.includes("/storage")) {
        return Promise.resolve(new Response(JSON.stringify([{ id: 100, name: "app.zip" }]), { status: 200 }));
      }
      if (url.includes("/rest/entity/web_app")) {
        return Promise.resolve(new Response(JSON.stringify({ key: 999, operation: "insert" }), { status: 200 }));
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    const result = await deploy(
      {
        instance: "https://mock.instance.com",
        webAppName: "new-app",
        webAppPath: "/new-app",
        distPath: distDir,
        apiKey: "test-key",
        healthCheck: false,
      },
      tempDir
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("created");
    expect(result.entityKey).toBe(999);
  });

  it("should resolve existingStorageId via id_storage_file_version query", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string, init: any) => {
      if (url.endsWith("/auth")) {
        return Promise.resolve(new Response(JSON.stringify({ version: "1.8.0", userName: "admin" }), { status: 200 }));
      }
      if (url.endsWith("/rest/fetch")) {
        const body = init?.body || "";
        if (body.includes("FETCH web_app")) {
          return Promise.resolve(
            new Response(JSON.stringify([{ key: 111, path: "/version-app", id_storage_file_version: 777 }]), {
              status: 200,
            })
          );
        }
        if (body.includes("FETCH storage_file_version(id_storage_file)")) {
          return Promise.resolve(
            new Response(JSON.stringify([{ id_storage_file: 333 }]), { status: 200 })
          );
        }
        if (body.includes("FETCH storage_file_version")) {
          return Promise.resolve(
            new Response(JSON.stringify([{ key: 888, file_name: "app.zip" }]), { status: 200 })
          );
        }
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      if (url.includes("/storage")) {
        return Promise.resolve(new Response(JSON.stringify([{ id: 333, name: "app.zip" }]), { status: 200 }));
      }
      if (url.includes("/rest/entity/web_app")) {
        return Promise.resolve(new Response(JSON.stringify({ key: 111, operation: "update" }), { status: 200 }));
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    const result = await deploy(
      {
        instance: "https://mock.instance.com",
        webAppName: "version-app",
        webAppPath: "/version-app",
        distPath: distDir,
        apiKey: "test-key",
        healthCheck: false,
      },
      tempDir
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("updated");
    expect(result.storageId).toBe(333);
  });

  it("should handle non-fatal errors in sfv fetch, health check, and legacy history write", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string, init: any) => {
      if (url.endsWith("/auth")) {
        return Promise.resolve(new Response(JSON.stringify({ version: "1.7.0", userName: "admin" }), { status: 200 }));
      }
      if (url.endsWith("/rest/fetch")) {
        const body = init?.body || "";
        if (body.includes("FETCH web_app")) {
          return Promise.resolve(
            new Response(JSON.stringify([{ key: 111, path: "/error-app", id_storage_file_version: 777 }]), {
              status: 200,
            })
          );
        }
        if (body.includes("FETCH storage_file_version(id_storage_file)")) {
          return Promise.reject(new Error("SFV query failed"));
        }
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      if (url.includes("/storage")) {
        return Promise.resolve(new Response(JSON.stringify([{ id: 444, name: "app.zip" }]), { status: 200 }));
      }
      if (url.includes("/rest/entity/web_app")) {
        return Promise.resolve(new Response(JSON.stringify({ key: 111, operation: "update" }), { status: 200 }));
      }
      if (url.includes("/error-app/index.html") || url.includes("/error-app/")) {
        return Promise.reject(new Error("Health check network timeout"));
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    // Make history directory invalid to trigger recordDeployment error
    const historyDir = path.join(tempDir, ".kodall-deploy");
    fs.writeFileSync(historyDir, "file-not-dir");

    const result = await deploy(
      {
        instance: "https://mock.instance.com",
        webAppName: "error-app",
        webAppPath: "/error-app",
        distPath: distDir,
        apiKey: "test-key",
        healthCheck: true,
      },
      tempDir
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("updated");
  });

  it("should fail deploy when token authentication returns problem", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/auth")) {
        return Promise.resolve(
          new Response(JSON.stringify({ type: "Problem", title: "Unauthorized", detail: "Invalid token" }), {
            status: 401,
          })
        );
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    await expect(
      deploy(
        {
          instance: "https://mock.instance.com",
          webAppName: "error-app",
          webAppPath: "/error-app",
          distPath: distDir,
          token: "invalid-token",
        },
        tempDir
      )
    ).rejects.toThrow("Authentication error: Invalid token");
  });

  it("should fail deploy when username/password authentication returns problem", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/auth")) {
        return Promise.resolve(
          new Response(JSON.stringify({ type: "Problem", title: "Forbidden", detail: "Bad user or pass" }), {
            status: 403,
          })
        );
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    await expect(
      deploy(
        {
          instance: "https://mock.instance.com",
          webAppName: "error-app",
          webAppPath: "/error-app",
          distPath: distDir,
          username: "baduser",
          password: "badpassword",
        },
        tempDir
      )
    ).rejects.toThrow("Authentication error: Bad user or pass");
  });

  it("should fail deploy when dist directory is invalid or index.html is missing", async () => {
    const invalidDist = path.join(tempDir, "missing-dist-folder");
    await expect(
      deploy(
        {
          instance: "https://mock.instance.com",
          webAppName: "error-app",
          webAppPath: "/error-app",
          distPath: invalidDist,
          apiKey: "test-key",
        },
        tempDir
      )
    ).rejects.toThrow("Build directory does not exist");
  });


  it("should handle session version check failure gracefully during deploy", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/auth") && !url.includes("POST")) {
        return Promise.reject(new Error("Session query network failure"));
      }
      if (url.endsWith("/auth")) {
        return Promise.resolve(new Response(JSON.stringify({ userName: "admin" }), { status: 200 }));
      }
      if (url.endsWith("/rest/fetch")) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      if (url.includes("/storage")) {
        return Promise.resolve(new Response(JSON.stringify([{ id: 888, name: "app.zip" }]), { status: 200 }));
      }
      if (url.includes("/rest/entity/web_app")) {
        return Promise.resolve(new Response(JSON.stringify({ key: 111, operation: "create" }), { status: 200 }));
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    const result = await deploy(
      {
        instance: "https://mock.instance.com",
        webAppName: "session-fail-app",
        webAppPath: "/session-fail-app",
        distPath: distDir,
        apiKey: "test-key",
        healthCheck: false,
      },
      tempDir
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("created");
  });
});









