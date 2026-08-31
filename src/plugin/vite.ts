import { getDevProxy } from "../core/proxy-helpers.js";
import { ProxyOptions } from "../core/types.js";

/**
 * Universal Vite plugin for Kodall dev proxy
 */
export function kodallProxy(options: ProxyOptions = {}) {
  return {
    name: "kodall-proxy-plugin",
    config() {
      const proxyTable = getDevProxy(options);
      return {
        server: {
          proxy: proxyTable,
        },
      };
    },
  };
}

export default kodallProxy;
