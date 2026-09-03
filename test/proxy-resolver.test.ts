import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { DEFAULT_CONFIG_FILENAME } from "../src/core/config.js";
import { setActiveEnvironment } from "../src/core/env-manager.js";
import {
  DEFAULT_PROXY_PATHS,
  matchesProxyPath,
  normalizePath,
  normalizeUrl,
  resolveProxyConfig,
} from "../src/core/proxy-resolver.js";

describe("proxy-resolver", () => {
  let tmpDir: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kodall-proxy-test-"));
    process.env = { ...originalEnv };
    delete process.env.KODALL_ENV;
    delete process.env.ONE_ENV;
    delete process.env.KODALL_INSTANCE;
    delete process.env.ONE_INSTANCE;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  describe("normalizePath & normalizeUrl", () => {
    it("normalizes path with leading slash and removes trailing slash", () => {
      expect(normalizePath("web-assets")).toBe("/web-assets");
      expect(normalizePath("/web-assets/")).toBe("/web-assets");
      expect(normalizePath("")).toBe("/");
      expect(normalizePath("/")).toBe("/");
    });

    it("normalizes baseUrl without trailing slash", () => {
      expect(normalizeUrl("https://dev.kodall.io/")).toBe("https://dev.kodall.io");
      expect(normalizeUrl("https://dev.kodall.io///")).toBe("https://dev.kodall.io");
      expect(normalizeUrl("http://localhost:8080")).toBe("http://localhost:8080");
    });
  });

  describe("matchesProxyPath", () => {
    const paths = ["/auth", "/rest", "/storage", "/web-assets"];

    it("matches exact route", () => {
      expect(matchesProxyPath("/auth", paths)).toBe(true);
      expect(matchesProxyPath("/rest", paths)).toBe(true);
      expect(matchesProxyPath("/web-assets", paths)).toBe(true);
    });

    it("matches subroutes and query params", () => {
      expect(matchesProxyPath("/auth/login", paths)).toBe(true);
      expect(matchesProxyPath("/rest/fetch?limit=10", paths)).toBe(true);
      expect(matchesProxyPath("/web-assets/images/logo.png", paths)).toBe(true);
      expect(matchesProxyPath("web-assets/test", paths)).toBe(true);
    });

    it("does not match non-proxy routes", () => {
      expect(matchesProxyPath("/", paths)).toBe(false);
      expect(matchesProxyPath("/index.html", paths)).toBe(false);
      expect(matchesProxyPath("/about", paths)).toBe(false);
      expect(matchesProxyPath("/authentication", paths)).toBe(false);
      expect(matchesProxyPath("/restore", paths)).toBe(false);
    });
  });

  describe("resolveProxyConfig", () => {
    it("resolves default config when no file exists", () => {
      const result = resolveProxyConfig({ cwd: tmpDir });
      expect(result.instanceUrl).toBe("http://localhost:8080");
      expect(result.proxyPaths).toEqual(DEFAULT_PROXY_PATHS);
      expect(result.changeOrigin).toBe(true);
      expect(result.secure).toBe(true);
    });

    it("resolves target from kodall-webapp.config.json environments and default_env", () => {
      const config = {
        web_app_name: "Test App",
        default_env: "dev",
        environments: {
          dev: {
            type: "dev",
            instance: "https://dev.kodall.io",
          },
          staging: {
            type: "staging",
            instance: "https://staging.kodall.io",
          },
        },
      };
      fs.writeFileSync(
        path.join(tmpDir, DEFAULT_CONFIG_FILENAME),
        JSON.stringify(config, null, 2)
      );

      const result = resolveProxyConfig({ cwd: tmpDir });
      expect(result.instanceUrl).toBe("https://dev.kodall.io");
      expect(result.envName).toBe("dev");
    });

    it("respects explicit env option over default_env", () => {
      const config = {
        default_env: "dev",
        environments: {
          dev: { instance: "https://dev.kodall.io" },
          staging: { instance: "https://staging.kodall.io" },
        },
      };
      fs.writeFileSync(
        path.join(tmpDir, DEFAULT_CONFIG_FILENAME),
        JSON.stringify(config, null, 2)
      );

      const result = resolveProxyConfig({ cwd: tmpDir, env: "staging" });
      expect(result.instanceUrl).toBe("https://staging.kodall.io");
      expect(result.envName).toBe("staging");
    });

    it("respects KODALL_ENV environment variable", () => {
      const config = {
        default_env: "dev",
        environments: {
          dev: { instance: "https://dev.kodall.io" },
          local: { instance: "http://localhost:8181" },
        },
      };
      fs.writeFileSync(
        path.join(tmpDir, DEFAULT_CONFIG_FILENAME),
        JSON.stringify(config, null, 2)
      );

      process.env.KODALL_ENV = "local";
      const result = resolveProxyConfig({ cwd: tmpDir });
      expect(result.instanceUrl).toBe("http://localhost:8181");
      expect(result.envName).toBe("local");
    });

    it("respects explicit instance override", () => {
      const result = resolveProxyConfig({
        cwd: tmpDir,
        instance: "https://custom.backend.io/",
      });
      expect(result.instanceUrl).toBe("https://custom.backend.io");
    });

    it("merges custom proxy_paths from root and environment", () => {
      const config = {
        default_env: "dev",
        proxy_paths: ["/web-assets", "/media"],
        environments: {
          dev: {
            instance: "https://dev.kodall.io",
            proxy_paths: ["/dev-only-mock"],
          },
        },
      };
      fs.writeFileSync(
        path.join(tmpDir, DEFAULT_CONFIG_FILENAME),
        JSON.stringify(config, null, 2)
      );

      const result = resolveProxyConfig({
        cwd: tmpDir,
        proxyPaths: ["/extra-cli-path"],
      });

      expect(result.proxyPaths).toContain("/auth");
      expect(result.proxyPaths).toContain("/rest");
      expect(result.proxyPaths).toContain("/storage");
      expect(result.proxyPaths).toContain("/web-assets");
      expect(result.proxyPaths).toContain("/media");
      expect(result.proxyPaths).toContain("/dev-only-mock");
      expect(result.proxyPaths).toContain("/extra-cli-path");
    });

    it("falls back to first environment when default_env is not specified", () => {
      const config = {
        environments: {
          staging: {
            instance: "https://staging.kodall.io",
          },
        },
      };
      fs.writeFileSync(
        path.join(tmpDir, DEFAULT_CONFIG_FILENAME),
        JSON.stringify(config, null, 2)
      );

      const result = resolveProxyConfig({ cwd: tmpDir });
      expect(result.instanceUrl).toBe("https://staging.kodall.io");
      expect(result.envName).toBe("staging");
    });

    it("falls back to first environment instance when selected env has no instance", () => {
      const config = {
        default_env: "emptyEnv",
        environments: {
          prod: {
            instance: "https://prod.kodall.io",
          },
          emptyEnv: {
            type: "dev",
          },
        },
      };
      fs.writeFileSync(
        path.join(tmpDir, DEFAULT_CONFIG_FILENAME),
        JSON.stringify(config, null, 2)
      );

      const result = resolveProxyConfig({ cwd: tmpDir, env: "emptyEnv" });
      expect(result.instanceUrl).toBe("https://prod.kodall.io");
    });

    it("resolves local active environment override from .kodall-deploy/active-env over default_env", () => {
      const config = {
        default_env: "dev",
        environments: {
          dev: { instance: "https://dev.kodall.io" },
          staging: { instance: "https://staging.kodall.io" },
        },
      };
      fs.writeFileSync(
        path.join(tmpDir, DEFAULT_CONFIG_FILENAME),
        JSON.stringify(config, null, 2)
      );

      // Set local active proxy override to staging
      setActiveEnvironment("staging", tmpDir, path.join(tmpDir, DEFAULT_CONFIG_FILENAME));

      const result = resolveProxyConfig({ cwd: tmpDir });
      expect(result.instanceUrl).toBe("https://staging.kodall.io");
      expect(result.envName).toBe("staging");
      expect(result.isLocalOverride).toBe(true);
    });

    it("respects default_proxy_env when set in config file over default_env", () => {
      const config = {
        default_env: "prod",
        default_proxy_env: "staging",
        environments: {
          prod: { instance: "https://app.kodall.io" },
          staging: { instance: "https://staging.kodall.io" },
        },
      };
      fs.writeFileSync(
        path.join(tmpDir, DEFAULT_CONFIG_FILENAME),
        JSON.stringify(config, null, 2)
      );

      const result = resolveProxyConfig({ cwd: tmpDir });
      expect(result.instanceUrl).toBe("https://staging.kodall.io");
      expect(result.envName).toBe("staging");
    });

    it("should handle normalizeUrl with empty string and matchesProxyPath edge cases", () => {
      expect(normalizeUrl("")).toBe("");
      expect(matchesProxyPath("", ["/auth"])).toBe(false);
      expect(matchesProxyPath("/auth/", ["/auth/"])).toBe(true);
      expect(matchesProxyPath("/auth?token=123", ["/auth"])).toBe(true);
    });
  });
});



