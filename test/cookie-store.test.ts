import { describe, expect, it } from "vitest";
import { CookieStore } from "../src/client/cookie-store.js";

describe("CookieStore", () => {
  it("should parse and store individual cookies", () => {
    const store = new CookieStore();
    store.parseAndSetCookie("session_id=abc123xyz; Path=/; HttpOnly");
    store.parseAndSetCookie("theme=dark; Path=/");

    expect(store.getCookie("session_id")).toBe("abc123xyz");
    expect(store.getCookie("theme")).toBe("dark");
    expect(store.getCookie("nonexistent")).toBeNull();
    expect(store.hasCookies()).toBe(true);
  });

  it("should parse Set-Cookie from Response headers", () => {
    const store = new CookieStore();
    const headers = new Headers();
    headers.append(
      "set-cookie",
      "one.erp.rest.csrf.token=token12345; Path=/; Secure"
    );
    headers.append("set-cookie", "JSESSIONID=sess789; Path=/");

    const mockResponse = new Response("ok", { headers });
    store.setFromResponse(mockResponse);

    expect(store.getCsrfToken()).toBe("token12345");
    expect(store.getCookie("JSESSIONID")).toBe("sess789");
  });

  it("should format cookies for outgoing request header", () => {
    const store = new CookieStore();
    store.setCookie("foo", "bar");
    store.setCookie("baz", "qux");

    const header = store.getCookieHeader();
    expect(header).toContain("foo=bar");
    expect(header).toContain("baz=qux");
  });

  it("should clear stored cookies", () => {
    const store = new CookieStore();
    store.setCookie("token", "val");
    expect(store.hasCookies()).toBe(true);

    store.clear();
    expect(store.hasCookies()).toBe(false);
    expect(store.getCookie("token")).toBeNull();
    expect(store.getCookieHeader()).toBe("");
  });
});
