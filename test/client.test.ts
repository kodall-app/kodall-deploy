import { afterEach, describe, expect, it, vi } from "vitest";
import { KodallNodeClient } from "../src/client/kodall-node-client.js";
import {
  isJsonResponse,
  isOperation,
  isProblem,
  isStorage,
  isValidation,
} from "../src/client/types.js";

describe("KodallNodeClient", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should handle empty baseUrl and strip trailing slashes", () => {
    const client = new KodallNodeClient({ baseUrl: "" });
    expect(client.baseUrl).toBe("");

    const clientWithSlash = new KodallNodeClient({ baseUrl: "https://example.com/" });
    expect(clientWithSlash.baseUrl).toBe("https://example.com");
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

    const client = new KodallNodeClient({ baseUrl: "https://mock.instance.com/" });
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

  it("should handle authentication fallback on 400/415 to form-urlencoded", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("Bad Request", { status: 400 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ userName: "admin", userKey: 1 }), {
          status: 200,
        })
      );

    const client = new KodallNodeClient({ baseUrl: "https://mock.instance.com" });
    const session = await client.auth({ user: "admin", password: "password" });
    expect((session as any).userName).toBe("admin");
  });

  it("should throw or return Problem on authentication failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "Invalid password", status: 401 }), {
        status: 401,
      })
    );

    const client = new KodallNodeClient({ baseUrl: "https://mock.instance.com" });
    const result = await client.auth({ user: "admin", password: "wrong" });
    expect(isProblem(result)).toBe(true);

    // Non-JSON error text
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("Server Crashed", {
        status: 500,
      })
    );

    await expect(client.auth({ user: "admin", password: "wrong" })).rejects.toThrow("Authentication failed");

    // Empty errorText fallback to statusText
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("", {
        status: 500,
        statusText: "Internal Server Error",
      })
    );
    await expect(client.auth({ user: "admin", password: "wrong" })).rejects.toThrow("Internal Server Error");
  });

  it("should verify session and handle errors", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ userName: "admin" }), {
        status: 200,
      })
    );

    const client = new KodallNodeClient({ baseUrl: "https://mock.instance.com" });
    const session = await client.session();
    expect((session as any).userName).toBe("admin");

    // Session Problem JSON error
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "Session expired" }), {
        status: 401,
      })
    );
    const problem = await client.session();
    expect(isProblem(problem)).toBe(true);

    // Session text error
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("Unauthorized", {
        status: 401,
      })
    );
    await expect(client.session()).rejects.toThrow("Session check failed");

    // Empty text fallback to statusText
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("", {
        status: 401,
        statusText: "Unauthorized",
      })
    );
    await expect(client.session()).rejects.toThrow("Unauthorized");
  });

  it("should inject API Key headers when no CSRF token is present", () => {
    const client = new KodallNodeClient({
      baseUrl: "https://mock.instance.com",
      apiKey: "secret-key-123",
    });

    const headers = client.headers("application/json");
    expect(headers["X-API-Key"]).toBe("secret-key-123");
    expect(headers["Content-Type"]).toBe("application/json");
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
          Cookie: "one.erp.rest.csrf.token=my_csrf; sess=123",
        }),
      })
    );

    expect(result).toEqual([{ key: 42 }]);
  });

  it("should throw error on fetch query failure", async () => {
    const client = new KodallNodeClient({ baseUrl: "https://mock.instance.com" });
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("Syntax Error", {
        status: 400,
        statusText: "Bad Request",
      })
    );

    await expect(client.fetch("INVALID QUERY")).rejects.toThrow("Fetch query failed");

    // Empty text fallback
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("", {
        status: 400,
        statusText: "Bad Request",
      })
    );
    await expect(client.fetch("INVALID QUERY")).rejects.toThrow("Bad Request");
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

  it("should throw error on storage upload failure", async () => {
    const client = new KodallNodeClient({ baseUrl: "https://mock.instance.com" });
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Disk full" }), {
        status: 500,
      })
    );

    await expect(client.uploadFile(Buffer.from("abc"), "test.zip")).rejects.toThrow("Upload file failed");
  });

  it("should support entity create and update", async () => {
    const client = new KodallNodeClient({ baseUrl: "https://mock.instance.com" });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ key: 101, operation: "insert" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const created = await client.create({
      entity_name: "web_app",
      properties: { name: "my-app", path: "/my-app" },
    });

    expect(created).toEqual({ key: 101, operation: "insert" });

    // Test error when creating entity with key defined
    await expect(
      client.create({
        entity_name: "web_app",
        properties: { key: 101, name: "my-app" },
      })
    ).rejects.toThrow("Entity has key defined; use update()");

    // Test update
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ key: 101, operation: "update" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const updated = await client.update({
      entity_name: "web_app",
      properties: { key: 101, name: "my-app-v2" },
    });

    expect(updated).toEqual({ key: 101, operation: "update" });

    // Test error when updating entity without key
    await expect(
      client.update({
        entity_name: "web_app",
        properties: { name: "my-app-v2" },
      })
    ).rejects.toThrow("requires a properties.key");

    // Test generic create failure
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "DB Error" }), {
        status: 500,
      })
    );

    await expect(
      client.create({
        entity_name: "web_app",
        properties: { name: "fail-app" },
      })
    ).rejects.toThrow("Create entity failed");

    // Test generic update failure
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "DB Error" }), {
        status: 500,
      })
    );

    await expect(
      client.update({
        entity_name: "web_app",
        properties: { key: 101, name: "fail-app" },
      })
    ).rejects.toThrow("Update entity failed");
  });

  describe("Type Guards", () => {
    it("should correctly identify Validation, Problem, Operation, Storage, and JsonResponse", () => {
      expect(isValidation({ discriminator: "validation", messages: [] })).toBe(true);
      expect(isValidation(null)).toBe(false);
      expect(isValidation({})).toBe(false);

      expect(isProblem({ detail: "error", title: "problem" })).toBe(true);
      expect(isProblem(null)).toBe(false);
      expect(isProblem({ discriminator: "validation", detail: "error" })).toBe(false);

      expect(isOperation({ key: 1, operation: "update" })).toBe(true);
      expect(isOperation({ key: 1 })).toBe(false);

      expect(isStorage([{ id: 123, name: "file.zip" }])).toBe(true);
      expect(isStorage([])).toBe(false);
      expect(isStorage("not array")).toBe(false);

      const jsonResp = new Response("{}", {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
      expect(isJsonResponse(jsonResp)).toBe(true);

      const plainResp = new Response("text", {
        headers: { "Content-Type": "text/plain" },
      });
      expect(isJsonResponse(plainResp)).toBe(false);
    });
  });
});
