import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const embedDir = path.dirname(fileURLToPath(import.meta.url));
const viewerRoot = path.resolve(embedDir, "../..");
const coreRoot = process.env.SVG3DX_CORE_ROOT
  ? path.resolve(process.env.SVG3DX_CORE_ROOT)
  : path.resolve(viewerRoot, "../svg3dx-core");
const svg3dxRoot = process.env.SVG3DX_ROOT
  ? path.resolve(process.env.SVG3DX_ROOT)
  : path.resolve(viewerRoot, "../svg3dx");

export default defineConfig({
  root: embedDir,
  plugins: [
    wasm(),
    {
      name: "svg3dx-sample-api",
      configureServer(server) {
        server.middlewares.use("/api/sample", (_req, res) => {
          const sample = path.join(svg3dxRoot, "samples", "draft-0.1-example.svg");
          if (!fs.existsSync(sample)) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: `missing ${sample}` }));
            return;
          }
          res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
          fs.createReadStream(sample).pipe(res);
        });
      },
    },
  ],
  resolve: {
    alias: {
      "svg3dx-viewer": path.join(viewerRoot, "src/index.ts"),
      "svg3dx-ffi-wasm": path.join(coreRoot, "pkg/svg3dx_ffi_wasm.js"),
    },
  },
  server: {
    fs: { allow: [viewerRoot, coreRoot, svg3dxRoot] },
  },
  build: {
    target: "esnext",
    outDir: path.join(viewerRoot, "examples/embed-dist"),
    emptyOutDir: true,
  },
});
