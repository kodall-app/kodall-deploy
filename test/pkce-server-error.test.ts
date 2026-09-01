import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

vi.mock("node:http", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    createServer: () => {
      const ee = new EventEmitter();
      (ee as any).listen = () => {
        process.nextTick(() => {
          ee.emit("error", new Error("Fatal socket crash"));
        });
      };
      (ee as any).close = vi.fn();
      return ee;
    },
  };
});

describe("PKCE Generic Server Error", () => {
  it("should reject when server emits generic error", async () => {
    const { executeBrowserOAuthLogin } = await import("../src/client/pkce-auth.js");
    const oidcProvider = {
      issuer: "https://auth.example.com/realms/test",
      authorization_endpoint: "https://auth.example.com/auth",
      token_endpoint: "https://auth.example.com/token",
    };

    await expect(
      executeBrowserOAuthLogin({
        oidcProvider,
        port: 3988,
        openBrowser: false,
      })
    ).rejects.toThrow("Fatal socket crash");
  });
});
