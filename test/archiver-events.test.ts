import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

let emitCloseError = false;
let emitNonEnoent = false;

vi.mock("archiver", () => {
  return {
    default: () => {
      const ee = new EventEmitter();
      let stream: any = null;
      (ee as any).pipe = vi.fn((s) => {
        stream = s;
      });
      (ee as any).directory = vi.fn();
      (ee as any).finalize = vi.fn(() => {
        if (emitCloseError) {
          const fsMod = require("node:fs");
          const osMod = require("node:os");
          // remove all tmp zip files to make readFileSync fail
          const tmpDir = osMod.tmpdir();
          const files = fsMod.readdirSync(tmpDir);
          for (const f of files) {
            if (f.startsWith("kodall-archive-") && f.endsWith(".zip")) {
              try {
                fsMod.unlinkSync(require("node:path").join(tmpDir, f));
              } catch {}
            }
          }
          process.nextTick(() => stream?.emit("close"));
          return;
        }

        if (emitNonEnoent) {
          ee.emit("warning", new Error("Generic archiver warning"));
          return;
        }
        const warnEnoent: any = new Error("Not found");
        warnEnoent.code = "ENOENT";
        ee.emit("warning", warnEnoent);

        setTimeout(() => {
          ee.emit("error", new Error("Archiver failed fatal"));
        }, 10);
      });
      return ee;
    },
  };
});

describe("Archiver events", () => {
  it("should handle ENOENT warning and error events", async () => {
    const { createArchive } = await import("../src/core/archiver.js");
    await expect(createArchive(".")).rejects.toThrow("Archiver failed fatal");
  });

  it("should reject on non-ENOENT warning", async () => {
    emitNonEnoent = true;
    const { createArchive } = await import("../src/core/archiver.js");
    await expect(createArchive(".")).rejects.toThrow("Generic archiver warning");
  });

  it("should reject when readFileSync throws inside close listener", async () => {
    emitCloseError = true;
    const { createArchive } = await import("../src/core/archiver.js");
    await expect(createArchive(".")).rejects.toThrow();
  });
});



