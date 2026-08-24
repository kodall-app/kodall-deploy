/**
 * Parse a semver-like version string, ignoring pre-release suffixes.
 * Examples: "1.8.0-SNAPSHOT" → [1, 8, 0], "2.1.3" → [2, 1, 3]
 */
export function parseVersion(raw: string): [number, number, number] {
  const clean = raw.split("-")[0].trim(); // strip -SNAPSHOT, -RC1, etc.
  const parts = clean.split(".").map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/**
 * Returns true if `actual` version is >= `minimum`.
 * Handles pre-release suffixes (e.g. "1.8.0-SNAPSHOT" >= "1.8.0" → true).
 */
export function isVersionAtLeast(actual: string, minimum: string): boolean {
  const [aMaj, aMin, aPatch] = parseVersion(actual);
  const [mMaj, mMin, mPatch] = parseVersion(minimum);
  if (aMaj !== mMaj) return aMaj > mMaj;
  if (aMin !== mMin) return aMin > mMin;
  return aPatch >= mPatch;
}
