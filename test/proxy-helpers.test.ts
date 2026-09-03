import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG_FILENAME } from "../src/core/config.js";
import {
  createNextProxyHandler,
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
    it("returns correct proxy map for Vite with dynamic router", () => {
      const proxy = getDevProxy(options);
      expect(proxy["/auth"]).toMatchObject({
        target: "https://dev.kodall.io",
        changeOrigin: true,
        secure: true,
      });
      expect(typeof proxy["/auth"].router).toBe("function");
      expect(proxy["/auth"].router?.()).toBe("https://dev.kodall.io");

      expect(proxy["/rest"]).toMatchObject({
        target: "https://dev.kodall.io",
        changeOrigin: true,
        secure: true,
      });
      expect(typeof proxy["/rest"].router).toBe("function");

      expect(proxy["/storage"]).toMatchObject({
        target: "https://dev.kodall.io",
        changeOrigin: true,
        secure: true,
      });
      expect(typeof proxy["/storage"].router).toBe("function");

      expect(proxy["/web-assets"]).toMatchObject({
        target: "https://dev.kodall.io",
        changeOrigin: true,
        secure: true,
      });
      expect(typeof proxy["/web-assets"].router).toBe("function");

      const viteProxy = getViteProxy(options);
      expect(viteProxy["/auth"]).toMatchObject({
        target: "https://dev.kodall.io",
        changeOrigin: true,
        secure: true,
      });
      expect(typeof viteProxy["/auth"].router).toBe("function");
    });

    it("dynamically resolves target via router function without restarting", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kodall-dynamic-proxy-"));
      try {
        const configFile = path.join(tmpDir, DEFAULT_CONFIG_FILENAME);
        fs.writeFileSync(
          configFile,
          JSON.stringify({
            default_env: "dev",
            environments: {
              dev: { instance: "https://dev.instance.com" },
              staging: { instance: "https://staging.instance.com" },
            },
          })
        );

        const proxy = getDevProxy({ cwd: tmpDir });
        expect(typeof proxy["/auth"].router).toBe("function");
        expect(proxy["/auth"].router?.()).toBe("https://dev.instance.com");

        // Now change default_env in config file on disk (like `kodall-deploy use staging`)
        fs.writeFileSync(
          configFile,
          JSON.stringify({
            default_env: "staging",
            environments: {
              dev: { instance: "https://dev.instance.com" },
              staging: { instance: "https://staging.instance.com" },
            },
          })
        );

        // Without recreating proxy table, router() dynamically returns staging URL immediately!
        expect(proxy["/auth"].router?.()).toBe("https://staging.instance.com");
      } finally {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {}
      }
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
    it("attaches devProxy and watches config files in Nuxt options object", () => {
      const nuxtModule = kodallProxyNuxt(options);
      const mockNuxt: any = { options: {} };
      nuxtModule({}, mockNuxt);

      expect(mockNuxt.options.nitro?.devProxy["/auth"]).toBeDefined();
      expect(mockNuxt.options.nitro?.devProxy["/auth"].target).toBe(
        "https://dev.kodall.io/auth"
      );
      expect(Array.isArray(mockNuxt.options.watch)).toBe(true);
      expect(mockNuxt.options.watch.length).toBeGreaterThanOrEqual(1);
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

  describe("createNextProxyHandler execution", () => {
    it("handles incoming request by proxying to target with fetch", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          statusText: "OK",
          headers: { "content-type": "application/json" },
        })
      );
      vi.stubGlobal("fetch", mockFetch);

      const routeHandlers = createNextProxyHandler(options);
      const req = new Request("http://localhost:3000/rest/users?page=1", {
        method: "POST",
        headers: { authorization: "Bearer xyz" },
        body: JSON.stringify({ name: "Alice" }),
      });

      const res = await routeHandlers.POST(req);
      expect(res.status).toBe(200);
      expect(mockFetch).toHaveBeenCalled();

      const getReq = new Request("http://localhost:3000/rest/ping", { method: "GET" });
      const getRes = await routeHandlers.GET(getReq);
      expect(getRes.status).toBe(200);

      vi.unstubAllGlobals();
    });
  });

  describe("kodallProxyNuxt with absolute path", () => {
    it("handles absolute configPath correctly", () => {
      const absConfigPath = path.resolve(process.cwd(), "custom-config.json");
      const moduleFn = kodallProxyNuxt({ configPath: absConfigPath, instance: "https://dev.kodall.io" });
      const nuxt = { options: { watch: [], nitro: {} } };
      moduleFn({}, nuxt);
      expect(nuxt.options.watch).toContain(absConfigPath);
    });
  });

  describe("getAngularProxy", () => {
    it("returns Angular proxy map", () => {
      const angularProxy = getAngularProxy(options);
      expect(angularProxy["/auth"]).toMatchObject({
        target: "https://dev.kodall.io",
        changeOrigin: true,
        secure: true,
      });
      expect(typeof angularProxy["/auth"].router).toBe("function");
    });
  });

  describe("unslashed paths handling", () => {
    it("prefixes unslashed proxyPaths with / for Nitro and Next", () => {
      const customOpts = {
        instance: "https://dev.kodall.io",
        proxyPaths: ["custom-api"],
      };
      const nitroProxy = getNitroProxy(customOpts);
      expect(nitroProxy["/custom-api"].target).toBe("https://dev.kodall.io/custom-api");

      const rewrites = getNextRewrites(customOpts);
      expect(rewrites).toContainEqual({
        source: "/custom-api/:path*",
        destination: "https://dev.kodall.io/custom-api/:path*",
      });
    });
  });
});


