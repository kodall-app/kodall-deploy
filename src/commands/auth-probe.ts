import { KodallNodeClient } from "../client/kodall-node-client.js";
import { isProblem } from "../client/types.js";

/**
 * Probe target instance to determine if it uses OAuth / OpenID Connect or standard basic auth.
 */
export async function probeAuthType(
  instanceUrl?: string
): Promise<{ isOidc: boolean; oidcIssuer?: string; name?: string }> {
  if (!instanceUrl) return { isOidc: false };
  try {
    const client = new KodallNodeClient({ baseUrl: instanceUrl });
    const sessionRes = await client.session();
    if (
      !isProblem(sessionRes) &&
      sessionRes.oidcIssuer &&
      sessionRes.oidcIssuer.trim()
    ) {
      return {
        isOidc: true,
        oidcIssuer: sessionRes.oidcIssuer,
        name: sessionRes.name,
      };
    }
  } catch {}
  return { isOidc: false };
}
