import type { HealthCheckResult } from "./types.js";

/**
 * Checks the live HTTP health of a deployed web application endpoint
 */
export async function checkEndpointHealth(
  url: string,
  timeoutMs: number = 8000
): Promise<HealthCheckResult> {
  const startTime = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": "kodall-deploy/health-check",
      },
    });

    const durationMs = Date.now() - startTime;
    const ok = response.status >= 200 && response.status < 400;

    return {
      url,
      ok,
      status: response.status,
      statusText: response.statusText || (ok ? "OK" : "Error"),
      durationMs,
    };
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    const isTimeout = err.name === "AbortError";

    return {
      url,
      ok: false,
      status: isTimeout ? 408 : 0,
      statusText: isTimeout ? "Request Timeout" : "Network Error",
      durationMs,
      error: err.message || "Failed to reach endpoint",
    };
  } finally {
    clearTimeout(timer);
  }
}

