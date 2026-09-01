import { afterEach, describe, expect, it, vi } from "vitest";
import {
  executeBrowserOAuthLogin,
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
  openUrlInBrowser,
} from "../src/client/pkce-auth.js";
import { KodallNodeClient } from "../src/client/kodall-node-client.js";
import * as childProcess from "node:child_process";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFile: vi.fn(),
  };
});

describe("PKCE Browser OAuth Login", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should generate cryptographically random verifier, challenge, and state", () => {
    const verifier1 = generateCodeVerifier();
    const verifier2 = generateCodeVerifier();
    expect(verifier1).not.toBe(verifier2);
    expect(verifier1.length).toBeGreaterThanOrEqual(43);

    const challenge1 = generateCodeChallenge(verifier1);
    const challenge2 = generateCodeChallenge(verifier1);
    expect(challenge1).toBe(challenge2);

    const state1 = generateState();
    const state2 = generateState();
    expect(state1).not.toBe(state2);
  });

  it("should openUrlInBrowser without throwing across platforms", () => {
    const originalPlatform = process.platform;
    try {
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });
      expect(() => openUrlInBrowser("https://example.com")).not.toThrow();

      Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
      expect(() => openUrlInBrowser("https://example.com")).not.toThrow();

      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
      expect(() => openUrlInBrowser("https://example.com")).not.toThrow();
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    }
    expect(childProcess.execFile).toHaveBeenCalled();
  });


  it("should start local loopback server, capture authorization code, and exchange tokens", async () => {
    const oidcProvider = {
      issuer: "https://auth.example.com/realms/test",
      authorization_endpoint: "https://auth.example.com/realms/test/protocol/openid-connect/auth",
      token_endpoint: "https://auth.example.com/realms/test/protocol/openid-connect/token",
    };

    globalThis.fetch = vi.fn().mockImplementation((url: string, init: any) => {
      if (url.startsWith("http://localhost:") || url.startsWith("http://127.0.0.1:")) {
        return originalFetch(url, init);
      }
      if (url === oidcProvider.token_endpoint) {
        const body = init?.body?.toString() || "";
        if (body.includes("code=mock-auth-code-123")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                access_token: "captured-jwt-access-token",
                refresh_token: "captured-jwt-refresh-token",
              }),
              { status: 200 }
            )
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ error_description: "Invalid code" }), { status: 400 })
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    let generatedAuthUrl = "";
    const loginPromise = executeBrowserOAuthLogin({
      oidcProvider,
      clientId: "account",
      port: 3999,
      openBrowser: false,
      onAuthUrl: (url) => {
        generatedAuthUrl = url;
      },
    });

    // Wait a brief moment for the loopback server to listen
    await new Promise((r) => setTimeout(r, 50));

    expect(generatedAuthUrl).toContain("https://auth.example.com");
    expect(generatedAuthUrl).toContain("client_id=account");

    const authUrlObj = new URL(generatedAuthUrl);
    const state = authUrlObj.searchParams.get("state");

    // Simulate browser redirect back to local server with authorization code
    const callbackRes = await originalFetch(`http://localhost:3999/?code=mock-auth-code-123&state=${state}`);
    expect(callbackRes.status).toBe(200);
    const html = await callbackRes.text();
    expect(html).toContain("Authentication Successful");

    const tokens = await loginPromise;
    expect(tokens.accessToken).toBe("captured-jwt-access-token");
    expect(tokens.refreshToken).toBe("captured-jwt-refresh-token");
  });

  it("should handle error callback from IdP gracefully", async () => {
    const oidcProvider = {
      issuer: "https://auth.example.com/realms/test",
      authorization_endpoint: "https://auth.example.com/realms/test/protocol/openid-connect/auth",
      token_endpoint: "https://auth.example.com/realms/test/protocol/openid-connect/token",
    };

    globalThis.fetch = vi.fn().mockImplementation((url: string, init: any) => {
      if (url.startsWith("http://localhost:") || url.startsWith("http://127.0.0.1:")) {
        return originalFetch(url, init);
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    const loginPromise = executeBrowserOAuthLogin({
      oidcProvider,
      clientId: "account",
      port: 3998,
      openBrowser: false,
    });
    // Prevent unhandled rejection warning
    loginPromise.catch(() => {});

    await new Promise((r) => setTimeout(r, 50));

    // Simulate error response from IdP with special HTML characters to test escaping
    const callbackRes = await originalFetch(
      `http://localhost:3998/?error=access_denied&error_description=${encodeURIComponent('<script>alert("xss & \'1\'")</script>')}`
    );
    expect(callbackRes.status).toBe(400);
    const errorHtml = await callbackRes.text();
    expect(errorHtml).toContain("&lt;script&gt;alert(&quot;xss &amp; &#39;1&#39;&quot;)&lt;/script&gt;");

    await expect(loginPromise).rejects.toThrow('OAuth Error from IdP: <script>alert("xss & \'1\'")</script>');
  });


  it("should handle missing code or exchange failure", async () => {
    const oidcProvider = {
      issuer: "https://auth.example.com/realms/test",
      authorization_endpoint: "https://auth.example.com/realms/test/protocol/openid-connect/auth",
      token_endpoint: "https://auth.example.com/realms/test/protocol/openid-connect/token",
    };

    globalThis.fetch = vi.fn().mockImplementation((url: string, init: any) => {
      if (url.startsWith("http://localhost:") || url.startsWith("http://127.0.0.1:")) {
        return originalFetch(url, init);
      }
      if (url === oidcProvider.token_endpoint) {
        return Promise.resolve(
          new Response(JSON.stringify({ error_description: "Invalid grant code" }), { status: 400 })
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    const loginPromise = executeBrowserOAuthLogin({
      oidcProvider,
      clientId: "account",
      port: 3997,
      openBrowser: false,
    });
    // Prevent unhandled rejection warning
    loginPromise.catch(() => {});

    await new Promise((r) => setTimeout(r, 50));

    // Simulate callback with invalid code that fails exchange
    const callbackRes = await originalFetch(
      `http://localhost:3997/?code=invalid-code-123`
    );
    expect(callbackRes.status).toBe(200);

    await expect(loginPromise).rejects.toThrow("Token exchange failed: Invalid grant code");
  });

  it("should execute loginWithBrowser on KodallNodeClient", async () => {
    const oidcSample = {
      oidcIssuer: "https://auth.example.com/realms/test/",
    };
    const openIdConfig = {
      issuer: "https://auth.example.com/realms/test",
      authorization_endpoint: "https://auth.example.com/realms/test/protocol/openid-connect/auth",
      token_endpoint: "https://auth.example.com/realms/test/protocol/openid-connect/token",
    };

    globalThis.fetch = vi.fn().mockImplementation((url: string, init: any) => {
      if (url.startsWith("http://localhost:") || url.startsWith("http://127.0.0.1:")) {
        return originalFetch(url, init);
      }
      if (url === "https://mock.instance.com/auth" && init?.method === "GET") {
        return Promise.resolve(new Response(JSON.stringify(oidcSample), { status: 200 }));
      }
      if (url === "https://auth.example.com/realms/test/.well-known/openid-configuration") {
        return Promise.resolve(new Response(JSON.stringify(openIdConfig), { status: 200 }));
      }
      if (url === openIdConfig.token_endpoint) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              access_token: "browser-access-token",
              refresh_token: "browser-refresh-token",
            }),
            { status: 200 }
          )
        );
      }
      if (url === "https://mock.instance.com/auth" && init?.method === "POST") {
        return Promise.resolve(
          new Response(JSON.stringify({ userName: "browser_user", userKey: 99 }), { status: 200 })
        );
      }
      return Promise.reject(new Error(`Unexpected: ${url}`));
    });

    const client = new KodallNodeClient({ baseUrl: "https://mock.instance.com" });

    let capturedUrl = "";
    const loginPromise = client.loginWithBrowser({
      port: 3996,
      openBrowser: false,
      onAuthUrl: (url) => {
        capturedUrl = url;
      },
    });

    await new Promise((r) => setTimeout(r, 50));
    const authUrlObj = new URL(capturedUrl);
    const state = authUrlObj.searchParams.get("state");

    await originalFetch(`http://localhost:3996/?code=test-code&state=${state}`);
    const session = await loginPromise;

    expect((session as any).userName).toBe("browser_user");
  });

  it("should open browser when openBrowser is true", async () => {
    const oidcProvider = {
      issuer: "https://auth.example.com/realms/test",
      authorization_endpoint: "https://auth.example.com/realms/test/protocol/openid-connect/auth",
      token_endpoint: "https://auth.example.com/realms/test/protocol/openid-connect/token",
    };

    globalThis.fetch = vi.fn().mockImplementation((url: string, init: any) => {
      if (url.startsWith("http://localhost:") || url.startsWith("http://127.0.0.1:")) {
        return originalFetch(url, init);
      }
      if (url === oidcProvider.token_endpoint) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              access_token: "browser-access-token",
              refresh_token: "browser-refresh-token",
            }),
            { status: 200 }
          )
        );
      }
      return Promise.reject(new Error(`Unexpected: ${url}`));
    });

    let capturedUrl = "";
    const loginPromise = executeBrowserOAuthLogin({
      oidcProvider,
      clientId: "account",
      port: 3995,
      openBrowser: true,
      onAuthUrl: (url) => {
        capturedUrl = url;
      },
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(childProcess.execFile).toHaveBeenCalled();

    const authUrlObj = new URL(capturedUrl);
    const state = authUrlObj.searchParams.get("state");

    await originalFetch(`http://localhost:3995/?code=test-code&state=${state}`);
    const tokens = await loginPromise;
    expect(tokens.accessToken).toBe("browser-access-token");
  });

  it("should timeout if user does not authenticate within timeoutMs", async () => {
    const oidcProvider = {
      issuer: "https://auth.example.com/realms/test",
      authorization_endpoint: "https://auth.example.com/realms/test/protocol/openid-connect/auth",
      token_endpoint: "https://auth.example.com/realms/test/protocol/openid-connect/token",
    };

    const loginPromise = executeBrowserOAuthLogin({
      oidcProvider,
      clientId: "account",
      port: 3994,
      openBrowser: false,
      timeoutMs: 40,
    });

    await expect(loginPromise).rejects.toThrow("Browser authentication timed out");
  });

  it("should handle EADDRINUSE port conflict and other server errors", async () => {
    const oidcProvider = {
      issuer: "https://auth.example.com/realms/test",
      authorization_endpoint: "https://auth.example.com/realms/test/protocol/openid-connect/auth",
      token_endpoint: "https://auth.example.com/realms/test/protocol/openid-connect/token",
    };

    // 1. Occupy a port with an existing server
    const blocker = (await import("node:http")).createServer();
    await new Promise<void>((resolve) => blocker.listen(3993, "localhost", () => resolve()));

    try {
      const loginPromise = executeBrowserOAuthLogin({
        oidcProvider,
        clientId: "account",
        port: 3993,
        openBrowser: false,
      });

      await expect(loginPromise).rejects.toThrow("Port 3993 is already in use");
    } finally {
      blocker.close();
    }
  });




  it("should handle unexpected error thrown during request handling in loopback server", async () => {
    const oidcProvider = {
      issuer: "https://auth.example.com/realms/test",
      authorization_endpoint: "https://auth.example.com/realms/test/protocol/openid-connect/auth",
      token_endpoint: "https://auth.example.com/realms/test/protocol/openid-connect/token",
    };

    globalThis.fetch = vi.fn().mockImplementation((url: string, init: any) => {
      if (url.startsWith("http://localhost:") || url.startsWith("http://127.0.0.1:")) {
        return originalFetch(url, init);
      }
      if (url === oidcProvider.token_endpoint) {
        return Promise.reject(new Error("Fatal connection break"));
      }
      return Promise.reject(new Error(`Unexpected: ${url}`));
    });

    const loginPromise = executeBrowserOAuthLogin({
      oidcProvider,
      clientId: "account",
      port: 3992,
      openBrowser: false,
    });
    loginPromise.catch(() => {});

    await new Promise((r) => setTimeout(r, 50));
    const callbackRes = await originalFetch("http://localhost:3992/?code=any-code");
    expect(callbackRes.status).toBe(200);

    await expect(loginPromise).rejects.toThrow("Fatal connection break");
  });

  it("should return 400 when request to loopback server has no code and no error", async () => {
    const oidcProvider = {
      issuer: "https://auth.example.com/realms/test",
      authorization_endpoint: "https://auth.example.com/realms/test/protocol/openid-connect/auth",
      token_endpoint: "https://auth.example.com/realms/test/protocol/openid-connect/token",
    };

    const loginPromise = executeBrowserOAuthLogin({
      oidcProvider,
      clientId: "account",
      port: 3991,
      openBrowser: false,
      timeoutMs: 100,
    });
    loginPromise.catch(() => {});

    await new Promise((r) => setTimeout(r, 50));
    const faviconRes = await originalFetch("http://localhost:3991/favicon.ico");
    expect(faviconRes.status).toBe(204);

    const callbackRes = await originalFetch("http://localhost:3991/");
    expect(callbackRes.status).toBe(400);
    expect(await callbackRes.text()).toContain("Missing authorization code.");

    await expect(loginPromise).rejects.toThrow("Browser authentication timed out");
  });

  it("should reject when callback state does not match generated state", async () => {
    const oidcProvider = {
      issuer: "https://auth.example.com/realms/test",
      authorization_endpoint: "https://auth.example.com/realms/test/protocol/openid-connect/auth",
      token_endpoint: "https://auth.example.com/realms/test/protocol/openid-connect/token",
    };

    const loginPromise = executeBrowserOAuthLogin({
      oidcProvider,
      clientId: "account",
      port: 3990,
      openBrowser: false,
    });
    loginPromise.catch(() => {});

    await new Promise((r) => setTimeout(r, 50));
    const callbackRes = await originalFetch("http://localhost:3990/?code=any-code&state=wrong-state");
    expect(callbackRes.status).toBe(400);
    expect(await callbackRes.text()).toContain("Invalid state parameter");

    await expect(loginPromise).rejects.toThrow("OAuth state parameter mismatch");
  });
});






