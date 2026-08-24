import { CookieStore } from "./cookie-store.js";
import { DEFAULT_OAUTH_PORT, executeBrowserOAuthLogin } from "./pkce-auth.js";
import {
  AuthCredential,
  Entity,
  OidcTokens,
  OpenIdProvider,
  Operation,
  Problem,
  Session,
  StorageResponse,
  UserPassword,
  Validation,
  isProblem,
  isValidation,
} from "./types.js";

export interface KodallNodeClientOptions {
  baseUrl: string;
  apiKey?: string;
  cookieStore?: CookieStore;
}

export class KodallNodeClient {
  public readonly baseUrl: string;
  public readonly apiKey?: string;
  public readonly cookieStore: CookieStore;
  private oidcIssuerConfig: OpenIdProvider | null | undefined = undefined;

  constructor(options: KodallNodeClientOptions) {
    let url = (options.baseUrl || "").trim();
    if (url.endsWith("/")) {
      url = url.slice(0, -1);
    }
    this.baseUrl = url;
    this.apiKey = options.apiKey;
    this.cookieStore = options.cookieStore || new CookieStore();
  }

  /**
   * Build standard headers including CSRF token, API Key, and session cookies
   */
  public headers(contentType?: string | null): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json, application/problem+json, */*",
    };

    if (contentType) {
      headers["Content-Type"] = contentType;
    }

    if (this.cookieStore.hasCookies()) {
      headers["Cookie"] = this.cookieStore.getCookieHeader();
    }

    const csrfToken = this.cookieStore.getCsrfToken();
    if (csrfToken) {
      headers["X-CSRF-TOKEN"] = csrfToken;
    } else if (this.apiKey) {
      headers["X-API-Key"] = this.apiKey;
    }

    return headers;
  }

  /**
   * Discovers OpenID Connect / OAuth provider information if server is configured with OIDC
   */
  public async getOidcIssuer(): Promise<OpenIdProvider | null> {
    if (this.oidcIssuerConfig !== undefined) {
      return this.oidcIssuerConfig;
    }

    const sessionRes = await this.session();
    if (isProblem(sessionRes) || !sessionRes.oidcIssuer || !sessionRes.oidcIssuer.trim()) {
      this.oidcIssuerConfig = null;
      return null;
    }

    const issuerUrl = sessionRes.oidcIssuer.endsWith("/")
      ? sessionRes.oidcIssuer
      : `${sessionRes.oidcIssuer}/`;
    const wellKnownUrl = `${issuerUrl}.well-known/openid-configuration`;

    const wellKnownRes = await fetch(wellKnownUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!wellKnownRes.ok) {
      throw new Error(
        `Unable to get OpenID configuration from ${wellKnownUrl} (${wellKnownRes.status}: ${wellKnownRes.statusText})`
      );
    }

    this.oidcIssuerConfig = (await wellKnownRes.json()) as OpenIdProvider;
    return this.oidcIssuerConfig;
  }

  /**
   * Authenticate with OpenID Connect / OAuth access token
   */
  public async openIdAuth(tokens: OidcTokens): Promise<Session | Problem> {
    const url = `${this.baseUrl}/auth`;
    const headers: Record<string, string> = {
      Accept: "application/json, */*",
      "Oidc-Auth-Token": tokens.accessToken,
    };
    if (tokens.refreshToken) {
      headers["Oidc-Refresh-Token"] = tokens.refreshToken;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
    });

    this.cookieStore.setFromResponse(response);

    if (!response.ok) {
      const errorText = await response.text();
      try {
        return JSON.parse(errorText) as Problem;
      } catch {
        throw new Error(
          `OpenID authentication failed with status ${response.status}: ${errorText || response.statusText}`
        );
      }
    }

    return (await response.json()) as Session | Problem;
  }

  /**
   * Standard Basic Auth with username and password
   */
  public async basicAuth(credential: UserPassword): Promise<Session | Problem> {
    const url = `${this.baseUrl}/auth`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, */*",
    };
    if (credential.otp) {
      headers["X-OTP"] = credential.otp;
      headers["Otp"] = credential.otp;
    }

    let response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(credential),
    });

    if (response.status === 400 || response.status === 415) {
      const formParams: Record<string, string> = {
        user: credential.user,
        password: credential.password,
      };
      if (credential.otp) {
        formParams.otp = credential.otp;
        formParams.totp = credential.otp;
      }
      const formBody = new URLSearchParams(formParams);
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json, */*",
          ...(credential.otp ? { "X-OTP": credential.otp } : {}),
        },
        body: formBody.toString(),
      });
    }

    this.cookieStore.setFromResponse(response);

    if (!response.ok) {
      const errorText = await response.text();
      try {
        return JSON.parse(errorText) as Problem;
      } catch {
        throw new Error(
          `Authentication failed with status ${response.status}: ${errorText || response.statusText}`
        );
      }
    }

    return (await response.json()) as Session | Problem;
  }

  /**
   * Universal authenticate method:
   * Inspects server /auth first. If OAuth/OIDC is configured on server, uses OIDC flow;
   * otherwise uses Basic username/password. Also accepts direct OidcTokens and OTP codes.
   */
  public async auth(
    credential: AuthCredential,
    options?: { clientId?: string; otp?: string }
  ): Promise<Session | Problem> {
    if ("accessToken" in credential) {
      return this.openIdAuth(credential);
    }

    if ("user" in credential && "password" in credential) {
      let oidcProvider: OpenIdProvider | null = null;
      try {
        oidcProvider = await this.getOidcIssuer();
      } catch {
        // Fallback to basic auth if OIDC check fails
      }

      if (oidcProvider && oidcProvider.token_endpoint) {
        const candidateClientIds = [
          options?.clientId,
          "admin-cli",
          "account",
          "account-console",
          "one-web",
        ].filter(Boolean) as string[];

        let lastErrorDetail = `OAuth authentication failed at ${oidcProvider.issuer}`;

        for (const clientId of candidateClientIds) {
          const tokenParams: Record<string, string> = {
            grant_type: "password",
            username: credential.user,
            password: credential.password,
            client_id: clientId,
          };

          const otpCode = credential.otp || options?.otp;
          if (otpCode) {
            tokenParams.totp = otpCode;
            tokenParams.otp = otpCode;
          }

          const tokenBody = new URLSearchParams(tokenParams);

          const tokenRes = await fetch(oidcProvider.token_endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Accept: "application/json",
            },
            body: tokenBody.toString(),
          });

          if (tokenRes.ok) {
            const tokenData = (await tokenRes.json()) as {
              access_token: string;
              refresh_token?: string;
            };

            return this.openIdAuth({
              accessToken: tokenData.access_token,
              refreshToken: tokenData.refresh_token,
            });
          }

          const errText = await tokenRes.text();
          let errJson: any;
          try {
            errJson = JSON.parse(errText);
          } catch {}

          const errorName = errJson?.error;
          const errorDesc = errJson?.error_description || errorName || `Status ${tokenRes.status}`;

          // If client_id is invalid, try next candidate client
          if (
            errorName === "invalid_client" ||
            errorName === "unauthorized_client" ||
            errorDesc.toLowerCase().includes("invalid client")
          ) {
            lastErrorDetail = errorDesc;
            continue;
          }

          // If error is invalid_grant (wrong password / wrong user / OTP required), return immediately
          return {
            detail: errorDesc,
          };
        }

        return {
          detail: lastErrorDetail,
        };
      }

      return this.basicAuth(credential);
    }

    throw new Error("No authentication method configured");
  }

  /**
   * Interactive Browser Login via OAuth 2.0 PKCE.
   * Discovers OIDC issuer, starts local callback server,
   * opens browser, and receives authorization code & access token.
   */
  public async loginWithBrowser(options?: {
    clientId?: string;
    port?: number;
    scopes?: string;
    timeoutMs?: number;
    openBrowser?: boolean;
    onAuthUrl?: (url: string) => void;
  }): Promise<Session | Problem> {
    const oidcProvider = await this.getOidcIssuer();
    if (!oidcProvider || !oidcProvider.authorization_endpoint || !oidcProvider.token_endpoint) {
      throw new Error("Target instance does not have OAuth / OpenID Connect configured");
    }

    const tokens = await executeBrowserOAuthLogin({
      oidcProvider,
      clientId: options?.clientId || "account",
      port: options?.port || DEFAULT_OAUTH_PORT,
      scopes: options?.scopes || "openid profile email",
      timeoutMs: options?.timeoutMs || 120000,
      openBrowser: options?.openBrowser ?? true,
      onAuthUrl: options?.onAuthUrl,
    });

    return this.openIdAuth(tokens);
  }

  /**
   * Verify session / connection or API key validity
   */
  public async session(): Promise<Session | Problem> {
    const url = `${this.baseUrl}/auth`;
    const response = await fetch(url, {
      method: "GET",
      headers: this.headers("application/json"),
    });

    this.cookieStore.setFromResponse(response);

    if (!response.ok) {
      const errorText = await response.text();
      try {
        return JSON.parse(errorText) as Problem;
      } catch {
        throw new Error(
          `Session check failed with status ${response.status}: ${errorText || response.statusText}`
        );
      }
    }

    return (await response.json()) as Session | Problem;
  }

  /**
   * Fetch entities via Kodall / ONE fetch query language
   * Example: FETCH web_app(key) FILTER AND(name == "foo", path == "bar")
   */
  public async fetch<T = any>(query: string): Promise<T[]> {
    const url = `${this.baseUrl}/rest/fetch`;
    const response = await fetch(url, {
      method: "POST",
      headers: this.headers("text/plain; charset=UTF-8"),
      body: query,
    });

    this.cookieStore.setFromResponse(response);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Fetch query failed (${response.status}): ${errorText || response.statusText}`
      );
    }

    return (await response.json()) as T[];
  }

  /**
   * Create a new entity in Kodall
   */
  public async create(
    entity: Entity
  ): Promise<Operation | Validation | Problem> {
    if (entity.properties && entity.properties.key !== undefined) {
      throw new Error("Entity has key defined; use update() instead of create()");
    }

    const url = `${this.baseUrl}/rest/entity/${entity.entity_name}`;
    const response = await fetch(url, {
      method: "POST",
      headers: this.headers("application/json"),
      body: JSON.stringify(entity),
    });

    this.cookieStore.setFromResponse(response);

    const result = (await response.json()) as Operation | Validation | Problem;
    if (!response.ok && !isValidation(result) && !isProblem(result)) {
      throw new Error(
        `Create entity failed (${response.status}): ${JSON.stringify(result)}`
      );
    }

    return result;
  }

  /**
   * Update an existing entity in Kodall
   */
  public async update(
    entity: Entity
  ): Promise<Operation | Validation | Problem> {
    const key = entity.properties?.key;
    if (key === undefined || key === null) {
      throw new Error("Entity requires a properties.key to update");
    }

    const url = `${this.baseUrl}/rest/entity/${entity.entity_name}/${key}`;
    const response = await fetch(url, {
      method: "POST",
      headers: this.headers("application/json"),
      body: JSON.stringify(entity),
    });

    this.cookieStore.setFromResponse(response);

    const result = (await response.json()) as Operation | Validation | Problem;
    if (!response.ok && !isValidation(result) && !isProblem(result)) {
      throw new Error(
        `Update entity failed (${response.status}): ${JSON.stringify(result)}`
      );
    }

    return result;
  }

  /**
   * Upload a file archive to Kodall storage (/storage endpoint)
   */
  public async uploadFile(
    fileBuffer: Buffer | Uint8Array,
    fileName = "web_app.zip",
    storageKey?: number | string
  ): Promise<StorageResponse | Validation | Problem> {
    const url = storageKey ? `${this.baseUrl}/storage/${storageKey}` : `${this.baseUrl}/storage`;

    const blob = new Blob([fileBuffer], { type: "application/zip" });
    const formData = new FormData();
    formData.append("file", blob, fileName);

    // Pass null contentType so fetch auto-generates multipart/form-data boundary
    const headers = this.headers(null);

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: formData,
    });

    this.cookieStore.setFromResponse(response);

    const result = (await response.json()) as StorageResponse | Validation | Problem;
    if (!response.ok && !isValidation(result) && !isProblem(result)) {
      throw new Error(
        `Upload file failed (${response.status}): ${JSON.stringify(result)}`
      );
    }

    return result;
  }

  /**
   * Fetch the latest storage_file_version for a given storage file ID.
   * Server returns versions ORDER BY version DESC → results[0] is the newest.
   * Returns null if not found or query fails.
   */
  public async fetchLatestStorageFileVersion(
    storageId: number | string
  ): Promise<{ key: number | string; file_name?: string } | null> {
    try {
      const query = `FETCH storage_file_version(key, file_name) FILTER AND (id_storage_file == ${storageId})`;
      const results = await this.fetch<{ key: number | string; file_name?: string }>(query);
      return results?.[0] ?? null; // [0] = newest (server returns DESC by version)
    } catch {
      return null;
    }
  }
}
