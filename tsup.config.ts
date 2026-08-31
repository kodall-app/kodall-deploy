import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
    "plugin/vite": "src/plugin/vite.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node18",
  shims: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
