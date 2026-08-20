import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import archiver from "archiver";

export interface ArchiveResult {
  archivePath: string;
  archiveBuffer: Buffer;
  sizeBytes: number;
  cleanup: () => void;
}

/**
 * Creates a zip archive of the specified source directory in a temporary OS directory
 */
export async function createArchive(
  srcDir: string,
  options: { level?: number } = {}
): Promise<ArchiveResult> {
  if (!fs.existsSync(srcDir)) {
    throw new Error(`Source directory does not exist: ${srcDir}`);
  }

  const compressionLevel = options.level ?? 9;

  const tempFileName = `kodall-deploy-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.zip`;
  const tempFilePath = path.join(os.tmpdir(), tempFileName);

  return new Promise<ArchiveResult>((resolve, reject) => {
    const output = fs.createWriteStream(tempFilePath);
    const archive = archiver("zip", {
      zlib: { level: compressionLevel },
    });

    output.on("close", () => {
      try {
        const buffer = fs.readFileSync(tempFilePath);
        const sizeBytes = archive.pointer();

        const cleanup = () => {
          try {
            if (fs.existsSync(tempFilePath)) {
              fs.unlinkSync(tempFilePath);
            }
          } catch {
            // Ignore cleanup deletion errors
          }
        };

        resolve({
          archivePath: tempFilePath,
          archiveBuffer: buffer,
          sizeBytes,
          cleanup,
        });
      } catch (err) {
        reject(err);
      }
    });

    archive.on("warning", (err: any) => {
      if (err.code === "ENOENT") {
        console.warn("Archiver warning:", err);
      } else {
        reject(err);
      }
    });

    archive.on("error", (err: any) => {
      // Clean up temp file on failure
      try {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      } catch {}
      reject(err);
    });

    archive.pipe(output);
    archive.directory(srcDir, false);
    archive.finalize();
  });
}
