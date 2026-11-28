/**
 * tsc emits dist/*.js from src/*.ts and leaves plain JS (ViewHelper) behind.
 * createViewer.js imports ./vendor/ViewHelper.js, so copy those files into dist.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "src", "vendor");
const destDir = path.join(root, "dist", "vendor");

if (!fs.existsSync(srcDir)) {
  console.error(`vendor dir missing: ${srcDir}`);
  process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });
for (const name of fs.readdirSync(srcDir)) {
  if (!name.endsWith(".js") && !name.endsWith(".d.ts")) continue;
  fs.copyFileSync(path.join(srcDir, name), path.join(destDir, name));
}
