import { describe, expect, it } from "vitest";
import { kodallProxy } from "../src/plugin/vite.js";

describe("vite-plugin", () => {
  it("creates a valid Vite plugin object with server proxy configuration and dynamic router", () => {
    const plugin = kodallProxy({
      instance: "https://dev.kodall.io",
      proxyPaths: ["/web-assets"],
    });

    expect(plugin.name).toBe("kodall-proxy-plugin");
    expect(typeof plugin.config).toBe("function");

    const configResult = plugin.config();
    expect(configResult.server.proxy["/auth"]).toMatchObject({
      target: "https://dev.kodall.io",
      changeOrigin: true,
      secure: true,
    });
    expect(typeof configResult.server.proxy["/auth"].router).toBe("function");
    expect(configResult.server.proxy["/auth"].router?.()).toBe("https://dev.kodall.io");

    expect(configResult.server.proxy["/web-assets"]).toMatchObject({
      target: "https://dev.kodall.io",
      changeOrigin: true,
      secure: true,
    });
  });
});
