import { resolveProxyConfig } from "./proxy-resolver.js";
import { ProxyOptions } from "./types.js";

export interface HttpProxyRule {
  target: string;
  changeOrigin: boolean;
  secure: boolean;
  ws?: boolean;
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
 * Returns an inline Nuxt module definition for nuxt.config.ts
 */
export function kodallProxyNuxt(options: ProxyOptions = {}) {
  return function (_inlineOptions: any, nuxt: any) {
    const devProxy = getNitroProxy(options);
    if (nuxt && nuxt.options) {
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
 * Returns Angular CLI proxy configuration object (for proxy.conf.js / proxy.conf.json)
 */
export function getAngularProxy(options: ProxyOptions = {}): Record<string, HttpProxyRule> {
  return getDevProxy(options);
}
