/**
 * Repro: select defs group, move, rebind — does it fly away?
 * Run: node scripts/repro-defs-transform.mjs
 */
import * as THREE from "three";
import { readFileSync } from "fs";
import { createRequire } from "module";
import { pathToFileURL } from "url";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewerRoot = path.resolve(__dirname, "..");
const corePkg = path.resolve(viewerRoot, "../svg3dx-core/pkg/svg3dx_ffi_wasm.js");

const wasm = await import(pathToFileURL(corePkg).href);
const { buildThreeObject } = await import(
  pathToFileURL(path.join(viewerRoot, "src/primitive.ts")).href
).catch(async () => {
  // Prefer dist when ts direct import fails
  return import(pathToFileURL(path.join(viewerRoot, "dist/primitive.js")).href);
});
const { mat4x3ToMatrix4 } = await import(
  pathToFileURL(path.join(viewerRoot, "dist/transform.js")).href
);
const { remapAsModelUse } = await import(
  pathToFileURL(path.join(viewerRoot, "dist/pick.js")).href
);

function to12(mat) {
  const e = mat.elements;
  return [e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10], e[12], e[13], e[14]].map(
    (x) => +x.toFixed(4)
  );
}

function worldPos(obj) {
  obj.updateMatrixWorld(true);
  const p = new THREE.Vector3();
  obj.getWorldPosition(p);
  return [p.x, p.y, p.z].map((x) => +x.toFixed(4));
}

function buildScene(result) {
  const root = new THREE.Group();
  root.name = "svg3dx";
  const groupsById = new Map();
  for (const inst of result.instructions) {
    if (inst.type === "group" && inst.id) groupsById.set(inst.id, inst);
  }
  const model = result.models.find((m) => m.active) || result.models[0];
  for (let i = 0; i < model.uses.length; i++) {
    const use = model.uses[i];
    const src = groupsById.get(use.group_id);
    if (!src) continue;
    const obj = buildThreeObject(src, "solid", `defs:${use.group_id}`);
    if (!obj) continue;
    remapAsModelUse(obj, `model:${model.id}.${i}`, use.group_id);
    if (use.transform?.m?.length) obj.applyMatrix4(mat4x3ToMatrix4(use.transform.m));
    obj.name = `use:${use.group_id}`;
    root.add(obj);
  }
  for (const [id, src] of groupsById) {
    const obj = buildThreeObject(src, "solid", `defs:${id}`);
    if (!obj) continue;
    obj.name = `defs-world:${id}`;
    obj.visible = false;
    obj.userData.defsWorld = id;
    root.add(obj);
  }
  return root;
}

const samples = [
  path.resolve(viewerRoot, "../svg3dx/samples/draft-0.1-box.svg3dx"),
  path.resolve(viewerRoot, "../svg3dx/samples/draft-0.1-bool.svg3dx"),
  path.resolve(viewerRoot, "../svg3dx/samples/draft-0.1-materials.svg3dx"),
];

for (const sample of samples) {
  const name = path.basename(sample);
  const svg = readFileSync(sample, "utf8");
  const result = wasm.parse_svg3dx(svg);
  const root = buildScene(result);
  console.log("\\n===", name, "===");
  for (const c of root.children) {
    console.log(
      c.name,
      "vis=" + c.visible,
      "localTx=" + to12(c.matrix).slice(9),
      "world=" + worldPos(c)
    );
  }

  // Pick first defs-world group and simulate move like gizmo on defs view
  const dw = root.children.find((c) => c.userData.defsWorld);
  if (!dw) {
    console.log("no defs-world");
    continue;
  }
  const before = worldPos(dw);
  dw.position.x += 100;
  dw.updateMatrix();
  const committed = to12(dw.matrix);
  console.log("commit matrix tx", committed.slice(9), "from defs-world", dw.userData.defsWorld);

  // Write transform into a synthetic re-eval: patch group transform in instructions
  const gid = dw.userData.defsWorld;
  const inst = result.instructions.find((i) => i.type === "group" && i.id === gid);
  if (inst) {
    inst.transform = { m: committed };
  }
  // Also patch XML-less: rebuild from patched instructions
  const root2 = buildScene(result);
  const dw2 = root2.children.find((c) => c.userData.defsWorld === gid);
  const use2 = root2.children.find((c) => c.name === `use:${gid}`);
  console.log(
    "after rebind defs-world world",
    dw2 ? worldPos(dw2) : null,
    "use world",
    use2 ? worldPos(use2) : null,
    "expected world",
    [before[0] + 100, before[1], before[2]]
  );
}
