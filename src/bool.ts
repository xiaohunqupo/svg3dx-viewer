import * as THREE from "three";
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from "three-bvh-csg";
import type { GeometryInstruction } from "./types.js";

type BuildFn = (
  inst: GeometryInstruction,
  mode?: string
) => THREE.Object3D | null;

/**
 * Boolean ops via three-bvh-csg. On failure, falls back to a named group of operands.
 */
export function buildBoolOp(
  inst: Extract<GeometryInstruction, { type: "bool_op" }>,
  mode: string,
  build: BuildFn
): THREE.Object3D | null {
  const operands: THREE.Object3D[] = [];
  for (const child of inst.operands) {
    const obj = build(child, mode);
    if (obj) operands.push(obj);
  }
  if (operands.length === 0) return null;
  if (operands.length === 1) return operands[0];

  try {
    const opMap = {
      union: ADDITION,
      subtract: SUBTRACTION,
      intersect: INTERSECTION,
    } as const;
    const op = opMap[inst.op];
    const evaluator = new Evaluator();

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

    let acc = toBrush(operands[0]);
    if (!acc) return fallbackGroup(inst.op, operands);

    for (let i = 1; i < operands.length; i++) {
      const next = toBrush(operands[i]);
      if (!next) continue;
      acc = evaluator.evaluate(acc, next, op);
    }

    const out = new THREE.Mesh(
      acc.geometry,
      new THREE.MeshStandardMaterial({
        color: 0x88aacc,
        metalness: 0.1,
        roughness: 0.6,
        side: THREE.DoubleSide,
      })
    );
    out.name = `bool-${inst.op}`;
    return out;
  } catch (err) {
    console.warn("[svg3dx-three] CSG failed, showing operands:", err);
    return fallbackGroup(inst.op, operands);
  }
}

function fallbackGroup(op: string, operands: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  g.name = `bool-${op}`;
  g.userData.svg3dxBoolFallback = true;
  for (const o of operands) g.add(o);
  return g;
}
