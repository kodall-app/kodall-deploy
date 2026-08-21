import { execFile } from "node:child_process";
import * as crypto from "node:crypto";
import * as http from "node:http";
import { OidcTokens, OpenIdProvider } from "./types.js";

function base64URLEncode(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export function generateCodeVerifier(): string {
  return base64URLEncode(crypto.randomBytes(32));
}

export function generateCodeChallenge(verifier: string): string {
  return base64URLEncode(crypto.createHash("sha256").update(verifier).digest());
}

export function generateState(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function openUrlInBrowser(url: string): void {
  try {
    const platform = process.platform;
    if (platform === "win32") {
      execFile("rundll32", ["url.dll,FileProtocolHandler", url], () => {});
    } else if (platform === "darwin") {
      execFile("open", [url], () => {});
    } else {
      execFile("xdg-open", [url], () => {});
    }
  } catch {}
}

export const DEFAULT_OAUTH_PORT = 38421;

export interface BrowserLoginOptions {
  oidcProvider: OpenIdProvider;
  clientId?: string;
  port?: number;
  scopes?: string;
  timeoutMs?: number;
  openBrowser?: boolean;
  onAuthUrl?: (url: string) => void;
}

/**
 * Execute OAuth 2.0 PKCE Authorization Code flow via a temporary local loopback server.
 * Opens the user's browser, waits for Keycloak/SSO authentication, captures the authorization code,
 * and exchanges it at the token endpoint for OpenID access and refresh tokens.
 */
export async function executeBrowserOAuthLogin(
  options: BrowserLoginOptions
): Promise<OidcTokens> {
  const {
    oidcProvider,
    clientId = "account",
    port = DEFAULT_OAUTH_PORT,
    scopes = "openid profile email",
    timeoutMs = 120000,
    openBrowser = true,
    onAuthUrl,
  } = options;

  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);
  const state = generateState();

  return new Promise<OidcTokens>((resolve, reject) => {
    let timer: NodeJS.Timeout | null = null;

    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url || "/", `http://localhost:${port}`);

        if (reqUrl.pathname === "/favicon.ico") {
          res.writeHead(204);
          res.end();
          return;
        }

        const code = reqUrl.searchParams.get("code");
        const error = reqUrl.searchParams.get("error");
        const errorDescription = reqUrl.searchParams.get("error_description");

        if (error) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <title>Authentication Failed</title>
              <style>
                body { font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #f8fafc; }
                .card { text-align: center; padding: 2.5rem; background: #1e293b; border-radius: 12px; max-width: 480px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.3); }
                h1 { color: #f87171; margin-bottom: 0.75rem; font-size: 1.5rem; }
                p { color: #94a3b8; line-height: 1.5; }
              </style>
            </head>
            <body>
              <div class="card">
                <h1>Authentication Failed</h1>
                <p>${errorDescription || error}</p>
                <p>You can close this window and return to your terminal.</p>
              </div>
            </body>
            </html>
          `);
          cleanup();
          reject(new Error(`OAuth Error from IdP: ${errorDescription || error}`));
          return;
        }

        if (!code) {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("Missing authorization code.");
          return;
        }

        // Render success page to the browser with automatic tab close and close connection
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          Connection: "close",
        });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <title>Authentication Successful</title>
            <style>
              body { font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #f8fafc; }
              .card { text-align: center; padding: 2.5rem; background: #1e293b; border-radius: 12px; max-width: 480px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.3); border: 1px solid #334155; }
              h1 { color: #38bdf8; margin-bottom: 0.75rem; font-size: 1.5rem; }
              p { color: #94a3b8; line-height: 1.5; margin: 0.5rem 0; }
              .badge { display: inline-block; background: #064e3b; color: #34d399; font-weight: 600; padding: 0.25rem 0.75rem; border-radius: 9999px; margin-bottom: 1rem; font-size: 0.875rem; }
            </style>
          </head>
          <body>
            <div class="card">
              <div class="badge">&#10003; Logged In</div>
              <h1>Authentication Successful!</h1>
              <p>You have successfully logged in via ONE / OpenID Connect.</p>
              <p>This tab will close automatically, or you can return to your terminal.</p>
            </div>
            <script>
              setTimeout(function() {
                try {
                  window.open('', '_self', '');
                  window.close();
                } catch(e) {}
              }, 1200);
            </script>
          </body>
          </html>
        `);

        cleanup();

        // Exchange authorization code for access & refresh tokens
        const redirectUri = `http://localhost:${port}`;
        const tokenParams = new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          code,
          code_verifier: verifier,
          redirect_uri: redirectUri,
        });

        const tokenRes = await fetch(oidcProvider.token_endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: tokenParams.toString(),
        });

        if (!tokenRes.ok) {
          const errText = await tokenRes.text();
          let errDesc = errText;
          try {
            const errJson = JSON.parse(errText);
            errDesc = errJson.error_description || errJson.error || errText;
          } catch {}
          reject(new Error(`Token exchange failed: ${errDesc}`));
          return;
        }

        const tokenData = (await tokenRes.json()) as {
          access_token: string;
          refresh_token?: string;
        };

        resolve({
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
        });
      } catch (err) {
        cleanup();
        reject(err);
      }
    });

    function cleanup() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      try {
        if (typeof (server as any).closeAllConnections === "function") {
          (server as any).closeAllConnections();
        }
        server.close();
      } catch {}
    }

    server.on("error", (err: any) => {
      cleanup();
      if (err.code === "EADDRINUSE") {
        reject(
          new Error(
            `Port ${port} is already in use by another application. Free port ${port} or use an API Key (--api-key).`
          )
        );
      } else {
        reject(err);
      }
    });

    server.listen(port, "localhost", () => {
      const redirectUri = `http://localhost:${port}`;
      const authParams = new URLSearchParams({
        protocol: "oauth2",
        response_type: "code",
        accessType: "online",
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: scopes,
        code_challenge_method: "S256",
        code_challenge: challenge,
        state: state,
      });

      const authUrl = `${oidcProvider.authorization_endpoint}?${authParams.toString()}`;

      if (onAuthUrl) {
        onAuthUrl(authUrl);
      }

      if (openBrowser) {
        openUrlInBrowser(authUrl);
      }

      timer = setTimeout(() => {
        cleanup();
        reject(new Error("Browser authentication timed out after 2 minutes."));
      }, timeoutMs);
    });
  });
}
