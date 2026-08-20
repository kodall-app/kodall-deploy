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

  it("should compress directory to zip file and clean up properly", async () => {
    // Create dummy files to zip
    fs.writeFileSync(path.join(tempDir, "index.html"), "<html><body>App</body></html>");
    fs.writeFileSync(path.join(tempDir, "bundle.js"), "console.log('test')");

    const archive = await createArchive(tempDir);

    expect(archive.sizeBytes).toBeGreaterThan(0);
    expect(archive.archiveBuffer.length).toBe(archive.sizeBytes);
    expect(fs.existsSync(archive.archivePath)).toBe(true);

    // Test cleanup
    archive.cleanup();
    expect(fs.existsSync(archive.archivePath)).toBe(false);
  });
});
