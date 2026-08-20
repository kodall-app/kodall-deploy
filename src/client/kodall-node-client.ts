import { CookieStore } from "./cookie-store.js";
import {
  Entity,
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
   * Authenticate with username and password
   */
  public async auth(credential: UserPassword): Promise<Session | Problem> {
    const url = `${this.baseUrl}/auth`;

    // Try JSON auth first (standard Kodall), fallback to form urlencoded if needed
    let response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, */*",
      },
      body: JSON.stringify(credential),
    });

    if (response.status === 400 || response.status === 415) {
      // Fallback for legacy ONE Framework instances expecting form-urlencoded
      const formBody = new URLSearchParams({
        user: credential.user,
        password: credential.password,
      });
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json, */*",
        },
        body: formBody.toString(),
      });
    }

    this.cookieStore.setFromResponse(response);

    if (!response.ok) {
      const errorText = await response.text();
      try {
        const errorJson = JSON.parse(errorText);
        return errorJson as Problem;
      } catch {
        throw new Error(
          `Authentication failed with status ${response.status}: ${errorText || response.statusText}`
        );
      }
    }

    const data = (await response.json()) as Session | Problem;
    return data;
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
    fileName = "web_app.zip"
  ): Promise<StorageResponse | Validation | Problem> {
    const url = `${this.baseUrl}/storage`;

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
}
