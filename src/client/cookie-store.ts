/**
 * In-memory cookie store for managing session cookies and CSRF tokens in Node.js
 */
export class CookieStore {
  private cookies = new Map<string, string>();

  /**
   * Parse and store cookies from response headers
   */
  public setFromResponse(response: Response): void {
    let setCookieHeaders: string[] = [];

    if (typeof response.headers.getSetCookie === "function") {
      setCookieHeaders = response.headers.getSetCookie();
    } else {
      const raw = response.headers.get("set-cookie");
      if (raw) {
        setCookieHeaders = [raw];
      }
    }

    for (const header of setCookieHeaders) {
      this.parseAndSetCookie(header);
    }
  }

  /**
   * Parse a single Set-Cookie string
   */
  public parseAndSetCookie(setCookieStr: string): void {
    if (!setCookieStr || typeof setCookieStr !== "string") return;

    // A Set-Cookie header contains pairs like "name=value; Path=/; HttpOnly"
    // Also handle comma-separated cookies if multiple were collapsed
    const parts = setCookieStr.split(";")[0].trim();
    const equalsIdx = parts.indexOf("=");
    if (equalsIdx > 0) {
      const name = parts.substring(0, equalsIdx).trim();
      const value = parts.substring(equalsIdx + 1).trim();
      if (name) {
        this.cookies.set(name, value);
      }
    }
  }

  /**
   * Get value of a specific cookie
   */
  public getCookie(name: string): string | null {
    return this.cookies.get(name) ?? null;
  }

  /**
   * Set a cookie value directly
   */
  public setCookie(name: string, value: string): void {
    this.cookies.set(name, value);
  }

  /**
   * Get CSRF token if present
   */
  public getCsrfToken(): string | null {
    return (
      this.getCookie("one.erp.rest.csrf.token") ||
      this.getCookie("csrf.token") ||
      this.getCookie("csrf_token") ||
      null
    );
  }

  /**
   * Format all cookies for outgoing Cookie request header
   */
  public getCookieHeader(): string {
    const pairs: string[] = [];
    for (const [key, value] of this.cookies.entries()) {
      pairs.push(`${key}=${value}`);
    }
    return pairs.join("; ");
  }

  /**
   * Check if store has cookies
   */
  public hasCookies(): boolean {
    return this.cookies.size > 0;
  }

  /**
   * Clear all cookies
   */
  public clear(): void {
    this.cookies.clear();
  }
}
