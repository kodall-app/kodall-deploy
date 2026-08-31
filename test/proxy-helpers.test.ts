import { describe, expect, it } from "vitest";
import {
  getAngularProxy,
  getDevProxy,
  getNextRewrites,
  getNitroProxy,
  getViteProxy,
  kodallProxyNuxt,
} from "../src/core/proxy-helpers.js";

describe("proxy-helpers", () => {
  const options = {
    instance: "https://dev.kodall.io",
    proxyPaths: ["/web-assets"],
  };

  describe("getDevProxy & getViteProxy", () => {
    it("returns correct proxy map for Vite", () => {
      const proxy = getDevProxy(options);
      expect(proxy["/auth"]).toEqual({
        target: "https://dev.kodall.io",
        changeOrigin: true,
        secure: true,
      });
      expect(proxy["/rest"]).toEqual({
        target: "https://dev.kodall.io",
        changeOrigin: true,
        secure: true,
      });
      expect(proxy["/storage"]).toEqual({
        target: "https://dev.kodall.io",
        changeOrigin: true,
        secure: true,
      });
      expect(proxy["/web-assets"]).toEqual({
        target: "https://dev.kodall.io",
        changeOrigin: true,
        secure: true,
      });
      expect(getViteProxy(options)).toEqual(proxy);
    });
  });

  describe("getNitroProxy", () => {
    it("returns correct proxy map with appended subpaths for Nuxt Nitro", () => {
      const nitroProxy = getNitroProxy(options);
      expect(nitroProxy["/auth"]).toEqual({
        target: "https://dev.kodall.io/auth",
        changeOrigin: true,
        secure: true,
      });
      expect(nitroProxy["/rest"]).toEqual({
        target: "https://dev.kodall.io/rest",
        changeOrigin: true,
        secure: true,
      });
      expect(nitroProxy["/storage"]).toEqual({
        target: "https://dev.kodall.io/storage",
        changeOrigin: true,
        secure: true,
      });
      expect(nitroProxy["/web-assets"]).toEqual({
        target: "https://dev.kodall.io/web-assets",
        changeOrigin: true,
        secure: true,
      });
    });
  });

  describe("kodallProxyNuxt", () => {
    it("attaches devProxy to Nuxt options object", () => {
      const nuxtModule = kodallProxyNuxt(options);
      const mockNuxt: any = { options: {} };
      nuxtModule({}, mockNuxt);

      expect(mockNuxt.options.nitro?.devProxy["/auth"]).toBeDefined();
      expect(mockNuxt.options.nitro?.devProxy["/auth"].target).toBe(
        "https://dev.kodall.io/auth"
      );
    });
  });

  describe("getNextRewrites", () => {
    it("returns Next.js rewrites rules array", () => {
      const rewrites = getNextRewrites(options);
      expect(rewrites).toContainEqual({
        source: "/auth/:path*",
        destination: "https://dev.kodall.io/auth/:path*",
      });
      expect(rewrites).toContainEqual({
        source: "/rest/:path*",
        destination: "https://dev.kodall.io/rest/:path*",
      });
      expect(rewrites).toContainEqual({
        source: "/storage/:path*",
        destination: "https://dev.kodall.io/storage/:path*",
      });
      expect(rewrites).toContainEqual({
        source: "/web-assets/:path*",
        destination: "https://dev.kodall.io/web-assets/:path*",
      });
    });
  });

  describe("getAngularProxy", () => {
    it("returns Angular proxy map", () => {
      const angularProxy = getAngularProxy(options);
      expect(angularProxy["/auth"]).toEqual({
        target: "https://dev.kodall.io",
        changeOrigin: true,
        secure: true,
      });
    });
  });
});
