import { afterEach, describe, expect, it, vi } from "vitest";
import {
  executeBrowserOAuthLogin,
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
  openUrlInBrowser,
} from "../src/client/pkce-auth.js";
import { KodallNodeClient } from "../src/client/kodall-node-client.js";
import { isProblem } from "../src/client/types.js";

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
    expect(() => openUrlInBrowser("https://example.com")).not.toThrow();
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

    // Simulate error response from IdP
    const callbackRes = await originalFetch(
      `http://localhost:3998/?error=access_denied&error_description=User%20cancelled%20login`
    );
    expect(callbackRes.status).toBe(400);

    await expect(loginPromise).rejects.toThrow("OAuth Error from IdP: User cancelled login");
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
});
