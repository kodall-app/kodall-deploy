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

  it("should handle empty baseUrl, double protocols, and strip trailing slashes", () => {
    const client = new KodallNodeClient({ baseUrl: "" });
    expect(client.baseUrl).toBe("");

    const clientWithDoubleProto = new KodallNodeClient({ baseUrl: "https://https://example.com/" });
    expect(clientWithDoubleProto.baseUrl).toBe("https://example.com");


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

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/auth")) {
        return Promise.resolve(
          new Response(JSON.stringify({ userName: "admin", userKey: 1 }), {
            status: 200,
            headers: mockHeaders,
          })
        );
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });

    const client = new KodallNodeClient({ baseUrl: "https://mock.instance.com/" });
    const session = await client.auth({ user: "admin", password: "password" });

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
    const session = await client.basicAuth({ user: "admin", password: "password" });
    expect((session as any).userName).toBe("admin");

    // With OTP in fallback
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("Unsupported", { status: 415 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ userName: "admin_otp" }), { status: 200 })
      );
    const sessionOtp = await client.basicAuth({ user: "admin", password: "pwd", otp: "123456" });
    expect((sessionOtp as any).userName).toBe("admin_otp");
  });

  it("should handle non-JSON error in openIdAuth", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("Gateway Crash HTML", { status: 502, statusText: "Bad Gateway" })
    );
    const client = new KodallNodeClient({ baseUrl: "https://mock.instance.com" });
    await expect(client.openIdAuth({ accessToken: "bad-token" })).rejects.toThrow(
      "OpenID authentication failed with status 502"
    );
  });


  it("should throw or return Problem on authentication failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "Invalid password", status: 401 }), {
        status: 401,
      })
    );

    const client = new KodallNodeClient({ baseUrl: "https://mock.instance.com" });
    const result = await client.basicAuth({ user: "admin", password: "wrong" });
    expect(isProblem(result)).toBe(true);

    // Non-JSON error text
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("Server Crashed", {
        status: 500,
      })
    );

    await expect(client.basicAuth({ user: "admin", password: "wrong" })).rejects.toThrow("Authentication failed");

    // Empty errorText fallback to statusText
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("", {
        status: 500,
        statusText: "Internal Server Error",
      })
    );
    await expect(client.basicAuth({ user: "admin", password: "wrong" })).rejects.toThrow("Internal Server Error");
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

  it("should discover OIDC OpenID configuration and handle getOidcIssuer", async () => {
    const oidcSample = {
      clientAdress: "31.5.199.97",
      oidcIssuer: "https://dev-accounts.oneerp.ro/realms/isjtm/",
      name: "ONE Framework Server",
      isSecure: true,
      version: "1.7.2",
    };

    const openIdConfig = {
      issuer: "https://dev-accounts.oneerp.ro/realms/isjtm",
      authorization_endpoint: "https://dev-accounts.oneerp.ro/realms/isjtm/protocol/openid-connect/auth",
      token_endpoint: "https://dev-accounts.oneerp.ro/realms/isjtm/protocol/openid-connect/token",
      userinfo_endpoint: "https://dev-accounts.oneerp.ro/realms/isjtm/protocol/openid-connect/userinfo",
    };

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "https://mock.instance.com/auth") {
        return Promise.resolve(new Response(JSON.stringify(oidcSample), { status: 200 }));
      }
      if (url === "https://dev-accounts.oneerp.ro/realms/isjtm/.well-known/openid-configuration") {
        return Promise.resolve(new Response(JSON.stringify(openIdConfig), { status: 200 }));
      }
      return Promise.reject(new Error(`Unknown URL ${url}`));
    });

    const client = new KodallNodeClient({ baseUrl: "https://mock.instance.com" });
    const issuer = await client.getOidcIssuer();

    expect(issuer).toBeDefined();
    expect(issuer?.token_endpoint).toBe("https://dev-accounts.oneerp.ro/realms/isjtm/protocol/openid-connect/token");

    // Test caching (subsequent call returns cached without fetch)
    const cached = await client.getOidcIssuer();
    expect(cached).toBe(issuer);

    // When instance has oidcIssuer without trailing slash
    const clientNoSlash = new KodallNodeClient({ baseUrl: "https://noslash.instance.com" });
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "https://noslash.instance.com/auth") {
        return Promise.resolve(new Response(JSON.stringify({ oidcIssuer: "https://dev-accounts.oneerp.ro/realms/isjtm" }), { status: 200 }));
      }
      if (url === "https://dev-accounts.oneerp.ro/realms/isjtm/.well-known/openid-configuration") {
        return Promise.resolve(new Response(JSON.stringify(openIdConfig), { status: 200 }));
      }
      return Promise.reject(new Error(`Unknown: ${url}`));
    });
    expect(await clientNoSlash.getOidcIssuer()).toBeDefined();

    // When instance has no oidcIssuer
    const clientNoOidc = new KodallNodeClient({ baseUrl: "https://native.instance.com" });
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ name: "ONE" }), { status: 200 }));
    expect(await clientNoOidc.getOidcIssuer()).toBeNull();


    // When well-known openid-configuration returns 404
    const clientFailOidc = new KodallNodeClient({ baseUrl: "https://fail.instance.com" });
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "https://fail.instance.com/auth") {
        return Promise.resolve(new Response(JSON.stringify({ oidcIssuer: "https://bad-oidc.com/" }), { status: 200 }));
      }
      return Promise.resolve(new Response("Not Found", { status: 404, statusText: "Not Found" }));
    });
    await expect(clientFailOidc.getOidcIssuer()).rejects.toThrow("Unable to get OpenID configuration");
  });

  it("should authenticate via OpenID Connect tokens", async () => {
    const mockHeaders = new Headers();
    mockHeaders.append("set-cookie", "one.erp.rest.csrf.token=oidc_csrf; Path=/");

    globalThis.fetch = vi.fn().mockImplementation((url: string, init: any) => {
      const headerVal = init?.headers?.["Oidc-Auth-Token"] || init?.headers?.["Oidc-auth-token"];
      if (url.endsWith("/auth") && headerVal === "my-access-token") {
        return Promise.resolve(
          new Response(JSON.stringify({ userName: "oidc_user", userKey: 42 }), {
            status: 200,
            headers: mockHeaders,
          })
        );
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: "Invalid token" }), { status: 401 }));
    });

    const client = new KodallNodeClient({ baseUrl: "https://mock.instance.com" });
    const session = await client.openIdAuth({
      accessToken: "my-access-token",
      refreshToken: "my-refresh-token",
    });

    expect((session as any).userName).toBe("oidc_user");
    expect(client.cookieStore.getCsrfToken()).toBe("oidc_csrf");

    // Failed token auth
    const failedSession = await client.openIdAuth({ accessToken: "invalid-token" });
    expect(isProblem(failedSession)).toBe(true);
  });

  it("should perform full OAuth2 password grant flow when server has OIDC configured", async () => {
    const oidcSample = {
      oidcIssuer: "https://dev-accounts.oneerp.ro/realms/isjtm/",
    };
    const openIdConfig = {
      issuer: "https://dev-accounts.oneerp.ro/realms/isjtm",
      token_endpoint: "https://dev-accounts.oneerp.ro/realms/isjtm/protocol/openid-connect/token",
    };

    globalThis.fetch = vi.fn().mockImplementation((url: string, init: any) => {
      if (url === "https://mock.instance.com/auth" && init?.method === "GET") {
        return Promise.resolve(new Response(JSON.stringify(oidcSample), { status: 200 }));
      }
      if (url === "https://dev-accounts.oneerp.ro/realms/isjtm/.well-known/openid-configuration") {
        return Promise.resolve(new Response(JSON.stringify(openIdConfig), { status: 200 }));
      }
      if (url === "https://dev-accounts.oneerp.ro/realms/isjtm/protocol/openid-connect/token") {
        const body = init?.body?.toString() || "";
        if (body.includes("username=testuser") && body.includes("password=correct")) {
          return Promise.resolve(
            new Response(JSON.stringify({ access_token: "jwt-token-123", refresh_token: "ref-123" }), {
              status: 200,
            })
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ error_description: "Invalid user credentials" }), {
            status: 400,
          })
        );
      }
      if (url === "https://mock.instance.com/auth" && init?.method === "POST") {
        const headerVal = init?.headers?.["Oidc-Auth-Token"] || init?.headers?.["Oidc-auth-token"];
        if (headerVal === "jwt-token-123") {
          return Promise.resolve(new Response(JSON.stringify({ userName: "testuser" }), { status: 200 }));
        }
      }
      return Promise.reject(new Error(`Unexpected: ${url}`));
    });

    const client = new KodallNodeClient({ baseUrl: "https://mock.instance.com" });
    const result = await client.auth({ user: "testuser", password: "correct" });
    expect((result as any).userName).toBe("testuser");

    // Invalid credentials at token endpoint
    const badClient = new KodallNodeClient({ baseUrl: "https://mock.instance.com" });
    const badResult = await badClient.auth({ user: "testuser", password: "wrong" });
    expect(isProblem(badResult)).toBe(true);
    expect((badResult as any).detail).toContain("Invalid user credentials");

    // Direct access token auth
    const tokenResult = await client.auth({ accessToken: "jwt-token-123" });
    expect((tokenResult as any).userName).toBe("testuser");
  });

  it("should send OTP in basic auth headers and payload", async () => {
    let capturedHeaders: any;
    let capturedBody: any;

    globalThis.fetch = vi.fn().mockImplementation((url: string, init: any) => {
      if (url.endsWith("/auth")) {
        capturedHeaders = init?.headers;
        capturedBody = JSON.parse(init?.body || "{}");
        return Promise.resolve(new Response(JSON.stringify({ userName: "admin" }), { status: 200 }));
      }
      return Promise.reject(new Error("Unknown"));
    });

    const client = new KodallNodeClient({ baseUrl: "https://mock.instance.com" });
    const session = await client.basicAuth({ user: "admin", password: "pwd", otp: "654321" });

    expect(capturedHeaders["X-OTP"]).toBe("654321");
    expect(capturedBody.otp).toBe("654321");
    expect((session as any).userName).toBe("admin");
  });

  it("should forward OTP / TOTP parameter to OAuth2 token endpoint", async () => {
    const oidcSample = {
      oidcIssuer: "https://dev-accounts.oneerp.ro/realms/isjtm/",
    };
    const openIdConfig = {
      issuer: "https://dev-accounts.oneerp.ro/realms/isjtm",
      token_endpoint: "https://dev-accounts.oneerp.ro/realms/isjtm/protocol/openid-connect/token",
    };

    let capturedTokenBody = "";

    globalThis.fetch = vi.fn().mockImplementation((url: string, init: any) => {
      if (url === "https://mock.instance.com/auth" && init?.method === "GET") {
        return Promise.resolve(new Response(JSON.stringify(oidcSample), { status: 200 }));
      }
      if (url === "https://dev-accounts.oneerp.ro/realms/isjtm/.well-known/openid-configuration") {
        return Promise.resolve(new Response(JSON.stringify(openIdConfig), { status: 200 }));
      }
      if (url === "https://dev-accounts.oneerp.ro/realms/isjtm/protocol/openid-connect/token") {
        capturedTokenBody = init?.body?.toString() || "";
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: "jwt-token-otp" }), { status: 200 })
        );
      }
      if (url === "https://mock.instance.com/auth" && init?.method === "POST") {
        return Promise.resolve(new Response(JSON.stringify({ userName: "otp-user" }), { status: 200 }));
      }
      return Promise.reject(new Error("Unknown"));
    });

    const client = new KodallNodeClient({ baseUrl: "https://mock.instance.com" });
    const result = await client.auth({ user: "otp-user", password: "pwd", otp: "123456" });

    expect(capturedTokenBody).toContain("totp=123456");
    expect(capturedTokenBody).toContain("otp=123456");
    expect((result as any).userName).toBe("otp-user");
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

  describe("fetchLatestStorageFileVersion", () => {
    it("should return the newest storage_file_version record", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            { key: 105, file_name: "latest.zip" },
            { key: 104, file_name: "older.zip" },
          ]),
          { status: 200 }
        )
      );

      const client = new KodallNodeClient({ baseUrl: "https://mock.instance.com" });
      const latest = await client.fetchLatestStorageFileVersion(42);
      expect(latest).toEqual({ key: 105, file_name: "latest.zip" });
    });

    it("should return null if no versions exist or fetch throws", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify([]), { status: 200 })
      );

      const client = new KodallNodeClient({ baseUrl: "https://mock.instance.com" });
      expect(await client.fetchLatestStorageFileVersion(42)).toBeNull();

      globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network fail"));
      expect(await client.fetchLatestStorageFileVersion(42)).toBeNull();
    });
  });

  describe("loginWithBrowser error handling", () => {
    it("should throw when target instance has no OAuth / OpenID Connect configured", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200 })
      );

      const client = new KodallNodeClient({ baseUrl: "https://mock.instance.com" });
      await expect(client.loginWithBrowser()).rejects.toThrow(
        "Target instance does not have OAuth / OpenID Connect configured"
      );
    });
  });

  describe("auth candidate client ID retry and failure", () => {
    it("should retry next candidate client ID on invalid_client error", async () => {
      const oidcSample = {
        oidcIssuer: "https://auth.example.com/realms/test/",
      };
      const openIdConfig = {
        issuer: "https://auth.example.com/realms/test",
        token_endpoint: "https://auth.example.com/token",
      };

      let attempt = 0;
      globalThis.fetch = vi.fn().mockImplementation((url: string, init: any) => {
        if (url === "https://mock.instance.com/auth" && init?.method === "GET") {
          return Promise.resolve(new Response(JSON.stringify(oidcSample), { status: 200 }));
        }
        if (url === "https://auth.example.com/realms/test/.well-known/openid-configuration") {
          return Promise.resolve(new Response(JSON.stringify(openIdConfig), { status: 200 }));
        }
        if (url === openIdConfig.token_endpoint) {
          attempt++;
          if (attempt === 1) {
            return Promise.resolve(
              new Response(JSON.stringify({ error: "invalid_client", error_description: "Invalid client" }), {
                status: 400,
              })
            );
          }
          return Promise.resolve(
            new Response(JSON.stringify({ access_token: "second-client-token" }), { status: 200 })
          );
        }
        if (url === "https://mock.instance.com/auth" && init?.method === "POST") {
          return Promise.resolve(new Response(JSON.stringify({ userName: "admin" }), { status: 200 }));
        }
        return Promise.reject(new Error(`Unexpected: ${url}`));
      });

      const client = new KodallNodeClient({ baseUrl: "https://mock.instance.com" });
      const session = await client.auth({ user: "admin", password: "pwd" });
      expect((session as any).userName).toBe("admin");
    });

    it("should return last error detail when all candidate client IDs fail", async () => {
      const oidcSample = {
        oidcIssuer: "https://auth.example.com/realms/test/",
      };
      const openIdConfig = {
        issuer: "https://auth.example.com/realms/test",
        token_endpoint: "https://auth.example.com/token",
      };

      globalThis.fetch = vi.fn().mockImplementation((url: string, init: any) => {
        if (url === "https://mock.instance.com/auth" && init?.method === "GET") {
          return Promise.resolve(new Response(JSON.stringify(oidcSample), { status: 200 }));
        }
        if (url === "https://auth.example.com/realms/test/.well-known/openid-configuration") {
          return Promise.resolve(new Response(JSON.stringify(openIdConfig), { status: 200 }));
        }
        if (url === openIdConfig.token_endpoint) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: "invalid_client", error_description: "Bad client" }), {
              status: 400,
            })
          );
        }
        return Promise.reject(new Error(`Unexpected: ${url}`));
      });

      const client = new KodallNodeClient({ baseUrl: "https://mock.instance.com" });
      const result = await client.auth({ user: "admin", password: "pwd" });
      expect((result as any).detail).toBe("Bad client");
    });

    it("should throw when no authentication method is provided", async () => {
      const client = new KodallNodeClient({ baseUrl: "https://mock.instance.com" });
      await expect(client.auth({} as any)).rejects.toThrow("No authentication method configured");
    });
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

