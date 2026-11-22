import * as THREE from "three";
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from "three-bvh-csg";
import type { GeometryInstruction, Value } from "./types.js";
import {
  type MaterialLibrary,
  resolveAppearance,
  toThreeMaterial,
} from "./materials.js";
import { SVG3DX_GLTF_PENDING } from "./gltf.js";

type BuildFn = (
  inst: GeometryInstruction,
  mode?: string,
  operandIndex?: number
) => THREE.Object3D | null;

type BoolOpName = "union" | "subtract" | "intersect";

const OP_MAP = {
  union: ADDITION,
  subtract: SUBTRACTION,
  intersect: INTERSECTION,
} as const;

/**
 * Boolean ops via three-bvh-csg. On failure, falls back to a named group of operands.
 * Result appearance uses the bool container's styles (fill × material).
 */
export function buildBoolOp(
  inst: Extract<GeometryInstruction, { type: "bool_op" }>,
  mode: string,
  build: BuildFn,
  library: MaterialLibrary = new Map()
): THREE.Object3D | null {
  const operands: THREE.Object3D[] = [];
  for (let i = 0; i < inst.operands.length; i++) {
    const child = inst.operands[i]!;
    const obj = build(child, mode, i);
    if (obj) operands.push(obj);
  }
  if (operands.length === 0) return null;
  if (operands.length === 1) return operands[0];

  // glTF triangles exist only after hydrate; fall back and retry after load (§3.3).
  if (operands.some(hasGltfPending)) {
    console.warn(
      "[svg3dx-three] boolean with s3dx:gltf deferred until after mesh load — showing operands meantime"
    );
    return fallbackGroup(inst.op, operands, inst.styles);
  }

  try {
    return csgFromOperands(operands, inst.op, mode, library, inst.styles);
  } catch (err) {
    console.warn("[svg3dx-three] CSG failed, showing operands:", err);
    return fallbackGroup(inst.op, operands, inst.styles);
  }
}

/**
 * After glTF hydrate, re-run CSG on deferred boolean fallback groups.
 * Deepest groups first so nested bools resolve inside-out.
 */
export function recomputeBoolFallbacks(
  root: THREE.Object3D,
  mode: string,
  library: MaterialLibrary
): void {
  root.updateMatrixWorld(true);
  const groups: THREE.Object3D[] = [];
  root.traverse((obj) => {
    if (obj.userData?.svg3dxBoolFallback) groups.push(obj);
  });
  groups.sort((a, b) => objectDepth(b) - objectDepth(a));

  for (const g of groups) {
    const parent = g.parent;
    if (!parent) continue;
    if (hasGltfPending(g)) continue;

    const op = (g.userData.svg3dxBoolOp as BoolOpName | undefined) ?? "union";
    const styles = (g.userData.svg3dxBoolStyles ?? {}) as Record<string, Value>;
    const children = [...g.children];
    if (children.length < 2) continue;

    let result: THREE.Object3D | null = null;
    try {
      result = csgFromOperands(children, op, mode, library, styles);
    } catch (err) {
      console.warn("[svg3dx-three] deferred CSG failed, keeping operands:", err);
      continue;
    }
    if (!result) continue;

    // CSG brushes used matrixWorld → result is in world space; convert to parent local.
    parent.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(parent.matrixWorld).invert();
    result.applyMatrix4(inv);
    parent.add(result);
    parent.remove(g);
  }
}

function csgFromOperands(
  operands: THREE.Object3D[],
  op: BoolOpName,
  mode: string,
  library: MaterialLibrary,
  styles: Record<string, Value> | undefined
): THREE.Object3D | null {
  const evaluator = new Evaluator();
  const csgOp = OP_MAP[op];

  const toBrush = (obj: THREE.Object3D): Brush | null => {
    const meshes: THREE.Mesh[] = [];
    obj.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) meshes.push(c as THREE.Mesh);
    });
    const mesh = meshes[0];
    if (!mesh?.geometry) return null;
    mesh.updateWorldMatrix(true, false);
    const brush = new Brush(mesh.geometry.clone());
    brush.material = mesh.material;
    brush.applyMatrix4(mesh.matrixWorld);
    brush.updateMatrixWorld(true);
    return brush;
  };

  let acc = toBrush(operands[0]!);
  if (!acc) return null;

  let combined = false;
  for (let i = 1; i < operands.length; i++) {
    const next = toBrush(operands[i]!);
    if (!next) continue;
    acc = evaluator.evaluate(acc, next, csgOp);
    combined = true;
  }
  if (!combined) return null;

  const appearance = resolveAppearance(styles, library);
  const out = new THREE.Mesh(acc.geometry, toThreeMaterial(appearance, mode));
  out.name = `bool-${op}`;
  return out;
}

function hasGltfPending(obj: THREE.Object3D): boolean {
  let found = false;
  obj.traverse((c) => {
    if (c.userData?.[SVG3DX_GLTF_PENDING]) found = true;
  });
  return found;
}

function objectDepth(obj: THREE.Object3D): number {
  let d = 0;
  let p: THREE.Object3D | null = obj;
  while (p) {
    d++;
    p = p.parent;
  }
  return d;
}

function fallbackGroup(
  op: BoolOpName,
  operands: THREE.Object3D[],
  styles: Record<string, Value> | undefined
): THREE.Group {
  const g = new THREE.Group();
  g.name = `bool-${op}`;
  g.userData.svg3dxBoolFallback = true;
  g.userData.svg3dxBoolOp = op;
  g.userData.svg3dxBoolStyles = styles ?? {};
  for (const o of operands) g.add(o);
  return g;
}
