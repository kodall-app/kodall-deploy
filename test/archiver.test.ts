import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createArchive } from "../src/core/archiver.js";

describe("Archiver", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kodall-archiver-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("should compress directory to zip file with default or custom level and clean up properly", async () => {
    fs.writeFileSync(path.join(tempDir, "index.html"), "<html><body>App</body></html>");
    fs.writeFileSync(path.join(tempDir, "bundle.js"), "console.log('test')");

    const archive = await createArchive(tempDir, { level: 5 });

    expect(archive.sizeBytes).toBeGreaterThan(0);
    expect(archive.archiveBuffer.length).toBe(archive.sizeBytes);
    expect(fs.existsSync(archive.archivePath)).toBe(true);

    // Test cleanup
    archive.cleanup();
    expect(fs.existsSync(archive.archivePath)).toBe(false);

    // Idempotent cleanup call
    archive.cleanup();
  });

  it("should fail when target directory does not exist", async () => {
    await expect(createArchive(path.join(tempDir, "nonexistent-dir"))).rejects.toThrow();
  });
});
