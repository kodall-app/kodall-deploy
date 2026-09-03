import { describe, expect, it, vi } from "vitest";
import { KodallNodeClient } from "../src/client/kodall-node-client.js";
import { probeAuthType } from "../src/commands/auth-probe.js";

describe("commands/auth-probe", () => {
  it("should return isOidc false if instanceUrl is undefined", async () => {
    const res = await probeAuthType(undefined);
    expect(res).toEqual({ isOidc: false });
  });

  it("should return isOidc false if session has no oidcIssuer", async () => {
    vi.spyOn(KodallNodeClient.prototype, "session").mockResolvedValueOnce({
      authenticated: false,
    } as any);

    const res = await probeAuthType("https://dev.kodall.ro");
    expect(res).toEqual({ isOidc: false });
  });

  it("should return isOidc true and issuer when oidcIssuer is returned", async () => {
    vi.spyOn(KodallNodeClient.prototype, "session").mockResolvedValueOnce({
      authenticated: false,
      oidcIssuer: "https://auth.company.com/realms/kodall",
      name: "realm",
    } as any);

    const res = await probeAuthType("https://dev.kodall.ro");
    expect(res.isOidc).toBe(true);
    expect(res.oidcIssuer).toBe("https://auth.company.com/realms/kodall");
    expect(res.name).toBe("realm");
  });

  it("should catch errors and return isOidc false", async () => {
    vi.spyOn(KodallNodeClient.prototype, "session").mockRejectedValueOnce(
      new Error("Network offline")
    );

    const res = await probeAuthType("https://dev.kodall.ro");
    expect(res).toEqual({ isOidc: false });
  });
});
