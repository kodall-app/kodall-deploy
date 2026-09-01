import { describe, expect, it } from "vitest";
import { isVersionAtLeast, parseVersion } from "../src/core/version.js";

describe("Version Utilities", () => {
  describe("parseVersion", () => {
    it("should parse standard semver strings", () => {
      expect(parseVersion("1.8.0")).toEqual([1, 8, 0]);
      expect(parseVersion("2.1.3")).toEqual([2, 1, 3]);
      expect(parseVersion("0.0.1")).toEqual([0, 0, 1]);
    });

    it("should strip pre-release suffixes", () => {
      expect(parseVersion("1.8.0-SNAPSHOT")).toEqual([1, 8, 0]);
      expect(parseVersion("2.0.0-RC1")).toEqual([2, 0, 0]);
      expect(parseVersion("1.0.0-beta.2")).toEqual([1, 0, 0]);
    });

    it("should fallback missing parts to 0", () => {
      expect(parseVersion("1.8")).toEqual([1, 8, 0]);
      expect(parseVersion("1")).toEqual([1, 0, 0]);
      expect(parseVersion("")).toEqual([0, 0, 0]);
    });
  });

  describe("isVersionAtLeast", () => {
    it("should return true when actual equals minimum", () => {
      expect(isVersionAtLeast("1.8.0", "1.8.0")).toBe(true);
      expect(isVersionAtLeast("1.8.0-SNAPSHOT", "1.8.0")).toBe(true);
    });

    it("should return true when actual is greater than minimum", () => {
      expect(isVersionAtLeast("1.9.0", "1.8.0")).toBe(true);
      expect(isVersionAtLeast("2.0.0", "1.8.0")).toBe(true);
      expect(isVersionAtLeast("1.8.1", "1.8.0")).toBe(true);
      expect(isVersionAtLeast("1.8.0-SNAPSHOT", "1.7.9")).toBe(true);
    });

    it("should return false when actual is less than minimum", () => {
      expect(isVersionAtLeast("1.7.9", "1.8.0")).toBe(false);
      expect(isVersionAtLeast("0.9.0", "1.0.0")).toBe(false);
      expect(isVersionAtLeast("1.8.0", "1.8.1")).toBe(false);
      expect(isVersionAtLeast("1.7.0", "1.8.0")).toBe(false);
    });
  });
});