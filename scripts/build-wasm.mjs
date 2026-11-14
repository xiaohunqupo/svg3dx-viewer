import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const viewerRoot = path.resolve(here, "..");
const coreRoot = process.env.SVG3DX_CORE_ROOT
  ? path.resolve(process.env.SVG3DX_CORE_ROOT)
  : path.resolve(viewerRoot, "../svg3dx-core");
const crate = path.join(coreRoot, "crates", "svg3dx-ffi-wasm");
const outDir = path.join(coreRoot, "pkg");

if (!fs.existsSync(crate)) {
  console.error(`svg3dx-core wasm crate not found: ${crate}`);
  console.error("Set SVG3DX_CORE_ROOT or place svg3dx-core as a sibling directory.");
  process.exit(1);
}

const r = spawnSync(
  "wasm-pack",
  ["build", crate, "--target", "bundler", "--out-dir", outDir, "--out-name", "svg3dx_ffi_wasm"],
  {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, CARGO_TARGET_DIR: path.join(coreRoot, "target") },
  }
);
process.exit(r.status ?? 1);
