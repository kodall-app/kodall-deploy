import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KodallNodeClient } from "../src/client/kodall-node-client.js";

describe("KodallNodeClient", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should authenticate and store session cookies + CSRF token", async () => {
    const mockHeaders = new Headers();
    mockHeaders.append(
      "set-cookie",
      "one.erp.rest.csrf.token=test_csrf_token_xyz; Path=/"
    );
    mockHeaders.append("set-cookie", "sessionId=sess123; Path=/");

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ userName: "admin", userKey: 1 }), {
        status: 200,
        headers: mockHeaders,
      })
    );

    const client = new KodallNodeClient({ baseUrl: "https://mock.instance.com" });
    const session = await client.auth({ user: "admin", password: "password" });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://mock.instance.com/auth",
      expect.objectContaining({
        method: "POST",
      })
    );

    expect(client.cookieStore.getCsrfToken()).toBe("test_csrf_token_xyz");
    expect(client.cookieStore.getCookie("sessionId")).toBe("sess123");
    expect((session as any).userName).toBe("admin");
  });

  it("should inject CSRF token and Cookie headers in subsequent requests", async () => {
    const client = new KodallNodeClient({ baseUrl: "https://mock.instance.com" });
    client.cookieStore.setCookie("one.erp.rest.csrf.token", "my_csrf");
    client.cookieStore.setCookie("sess", "123");

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ key: 42 }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await client.fetch("FETCH web_app(key)");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://mock.instance.com/rest/fetch",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-CSRF-TOKEN": "my_csrf",
          "Cookie": "one.erp.rest.csrf.token=my_csrf; sess=123",
        }),
      })
    );

    expect(result).toEqual([{ key: 42 }]);
  });

  it("should upload file to /storage endpoint", async () => {
    const client = new KodallNodeClient({ baseUrl: "https://mock.instance.com" });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ id: 999, name: "web_app.zip" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const buffer = Buffer.from("dummy-zip-content");
    const res = await client.uploadFile(buffer, "web_app.zip");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://mock.instance.com/storage",
      expect.objectContaining({
        method: "POST",
      })
    );

    expect(res).toEqual([{ id: 999, name: "web_app.zip" }]);
  });

  it("should support entity create and update", async () => {
    const client = new KodallNodeClient({ baseUrl: "https://mock.instance.com" });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ key: 101, operation: "insert" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const createRes = await client.create({
      entity_name: "web_app",
      properties: { name: "test", path: "test", id_storage_file: 999 },
    });

    expect(createRes).toEqual({ key: 101, operation: "insert" });

    // Update
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ key: 101, operation: "update" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const updateRes = await client.update({
      entity_name: "web_app",
      properties: { key: 101, name: "test", path: "test", id_storage_file: 1000 },
    });

    expect(updateRes).toEqual({ key: 101, operation: "update" });
  });
});
