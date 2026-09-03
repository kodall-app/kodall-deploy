import * as path from "node:path";
import { DEFAULT_CONFIG_FILENAME, LEGACY_CONFIG_FILENAME } from "./config.js";
import { resolveProxyConfig } from "./proxy-resolver.js";
import { ProxyOptions } from "./types.js";

export interface HttpProxyRule {
  target: string;
  changeOrigin: boolean;
  secure: boolean;
  ws?: boolean;
  router?: (req?: any) => string | undefined;
}

export interface NextRewriteRule {
  source: string;
  destination: string;
}

/**
 * Returns a standard proxy table for Vite (server.proxy), Webpack (devServer.proxy), Rollup, etc.
 */
export function getDevProxy(options: ProxyOptions = {}): Record<string, HttpProxyRule> {
  const config = resolveProxyConfig(options);
  const result: Record<string, HttpProxyRule> = {};

  for (const p of config.proxyPaths) {
    result[p] = {
      target: config.instanceUrl,
      changeOrigin: config.changeOrigin,
      secure: config.secure,
      router: () => {
        const dynamicConfig = resolveProxyConfig(options);
        return dynamicConfig.instanceUrl;
      },
    };
  }

  return result;
}

/**
 * Alias for getDevProxy (for Vite users)
 */
export const getViteProxy = getDevProxy;

/**
 * Returns a Nitro devProxy table for Nuxt 3/4 (nitro.devProxy)
 */
export function getNitroProxy(options: ProxyOptions = {}): Record<string, HttpProxyRule> {
  const config = resolveProxyConfig(options);
  const result: Record<string, HttpProxyRule> = {};

  for (const p of config.proxyPaths) {
    const subpath = p.startsWith("/") ? p : `/${p}`;
    result[p] = {
      target: `${config.instanceUrl}${subpath}`,
      changeOrigin: config.changeOrigin,
      secure: config.secure,
    };
  }

  return result;
}

/**
 * Returns an inline Nuxt module definition for nuxt.config.ts with automatic config watching
 */
export function kodallProxyNuxt(options: ProxyOptions = {}) {
  const cwd = options.cwd || process.cwd();
  const configFileName = options.configPath || DEFAULT_CONFIG_FILENAME;
  const configFilePath = path.isAbsolute(configFileName)
    ? configFileName
    : path.resolve(cwd, configFileName);
  const legacyConfigPath = path.resolve(cwd, LEGACY_CONFIG_FILENAME);

  return function (_inlineOptions: any, nuxt: any) {
    const devProxy = getNitroProxy(options);
    if (nuxt && nuxt.options) {
      // Auto-watch config file for Nuxt dev server live reload
      nuxt.options.watch = nuxt.options.watch || [];
      if (!nuxt.options.watch.includes(configFilePath)) {
        nuxt.options.watch.push(configFilePath);
      }
      if (!nuxt.options.watch.includes(legacyConfigPath)) {
        nuxt.options.watch.push(legacyConfigPath);
      }

      nuxt.options.nitro = nuxt.options.nitro || {};
      nuxt.options.nitro.devProxy = {
        ...(nuxt.options.nitro.devProxy || {}),
        ...devProxy,
      };
    }
  };
}

/**
 * Returns Next.js async rewrites array for next.config.ts
 */
export function getNextRewrites(options: ProxyOptions = {}): NextRewriteRule[] {
  const config = resolveProxyConfig(options);
  const result: NextRewriteRule[] = [];

  for (const p of config.proxyPaths) {
    const subpath = p.startsWith("/") ? p : `/${p}`;
    result.push({
      source: `${subpath}/:path*`,
      destination: `${config.instanceUrl}${subpath}/:path*`,
    });
  }

  return result;
}

/**
 * Creates a dynamic Next.js App Router route handler for dev proxying.
 * Usage in app/api/[...proxy]/route.ts or app/[...proxy]/route.ts:
 * export const { GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS } = createNextProxyHandler();
 */
export function createNextProxyHandler(options: ProxyOptions = {}) {
  const handler = async (request: Request): Promise<Response> => {
    const config = resolveProxyConfig(options);
    const url = new URL(request.url);
    const targetUrl = new URL(url.pathname + url.search, config.instanceUrl);

    const headers = new Headers(request.headers);
    if (config.changeOrigin) {
      headers.set("host", new URL(config.instanceUrl).host);
    }

    const init: RequestInit = {
      method: request.method,
      headers,
      redirect: "manual",
    };

    if (request.method !== "GET" && request.method !== "HEAD") {
      if (request.body) {
        init.body = request.body;
        // @ts-ignore
        init.duplex = "half";
      }
    }

    const response = await fetch(targetUrl.toString(), init);
    const responseHeaders = new Headers(response.headers);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  };

  return {
    GET: handler,
    POST: handler,
    PUT: handler,
    DELETE: handler,
    PATCH: handler,
    HEAD: handler,
    OPTIONS: handler,
    handler,
  };
}

/**
 * Returns Angular CLI proxy configuration object (for proxy.conf.js / proxy.conf.json)
 */
export function getAngularProxy(options: ProxyOptions = {}): Record<string, HttpProxyRule> {
  return getDevProxy(options);
}
