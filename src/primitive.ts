import * as THREE from "three";
import type { GeometryInstruction, Value } from "./types.js";
import { mat4x3ToMatrix4 } from "./transform.js";
import { buildBoolOp } from "./bool.js";
import { setPickData } from "./pick.js";

function num(v: Value | undefined, fallback = 0): number {
  return typeof v === "number" ? v : fallback;
}

/**
 * Look up a param by SVG attr name (spec §3.2 lowerCamelCase).
 * Also accepts PascalCase leftovers for older hosts.
 */
function param(
  params: Record<string, Value>,
  name: string
): Value | undefined {
  if (name in params) return params[name];
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(params)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

function vec3(
  v: Value | undefined,
  fallback: [number, number, number] = [0, 0, 0]
): THREE.Vector3 {
  if (Array.isArray(v) && v.length >= 3 && typeof v[0] === "number") {
    return new THREE.Vector3(v[0], v[1] as number, v[2] as number);
  }
  return new THREE.Vector3(...fallback);
}

/** Align a Y-up cylinder/cone so its axis runs from `from` to `to`. */
function alignAxisY(
  geometry: THREE.BufferGeometry,
  from: THREE.Vector3,
  to: THREE.Vector3
): void {
  const dir = new THREE.Vector3().subVectors(to, from);
  const height = dir.length() || 1;
  dir.normalize();
  const quat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir
  );
  const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
  geometry.translate(0, 0, 0);
  // CylinderGeometry is centered on Y; keep centered then rotate+translate via matrix
  const m = new THREE.Matrix4();
  m.compose(mid, quat, new THREE.Vector3(1, 1, 1));
  // bake: geometry is already height along Y centered at origin
  void height;
  geometry.applyMatrix4(m);
}

function tagObject(
  obj: THREE.Object3D,
  treePath: string,
  opts: { groupId?: string; nodeId?: string; defsPath?: string } = {}
): void {
  const data = {
    treePath,
    defsPath: opts.defsPath ?? (treePath.startsWith("defs:") ? treePath : undefined),
    groupId: opts.groupId,
    nodeId: opts.nodeId,
  };
  obj.traverse((c) => {
    // Do not overwrite a more specific child path already set.
    const prev = c.userData?.svg3dx as { treePath?: string } | undefined;
    if (c !== obj && prev?.treePath && prev.treePath !== treePath) return;
    setPickData(c, data);
  });
}

/** Map a single instruction tree node to a THREE.Object3D. */
export function buildThreeObject(
  inst: GeometryInstruction,
  mode: string = "solid",
  treePath?: string
): THREE.Object3D | null {
  switch (inst.type) {
    case "primitive": {
      const obj = buildPrimitive(inst.kind, inst.params, inst.transform.m, mode);
      if (obj && treePath) {
        tagObject(obj, treePath, { nodeId: inst.node_id });
      }
      return obj;
    }
    case "group": {
      const g = new THREE.Group();
      if (inst.id) g.name = inst.id;
      const groupPath =
        treePath ?? (inst.id ? `defs:${inst.id}` : undefined);
      if (groupPath) {
        tagObject(g, groupPath, {
          groupId: inst.id ?? undefined,
          nodeId: inst.node_id,
        });
      }
      for (let i = 0; i < inst.children.length; i++) {
        const child = inst.children[i]!;
        const childPath = groupPath ? `${groupPath}.${i}` : undefined;
        const obj = buildThreeObject(child, mode, childPath);
        if (obj) {
          if (childPath) {
            tagObject(obj, childPath, {
              groupId: inst.id ?? undefined,
              nodeId: child.node_id,
            });
          }
          g.add(obj);
        }
      }
      g.updateMatrix();
      g.applyMatrix4(mat4x3ToMatrix4(inst.transform.m));
      return g;
    }
    case "bool_op": {
      const obj = buildBoolOp(inst, mode, (child, m) =>
        buildThreeObject(child, m ?? mode, treePath)
      );
      if (obj && treePath) {
        tagObject(obj, treePath, { nodeId: inst.node_id });
      }
      return obj;
    }
    case "instance": {
      const g = new THREE.Group();
      g.name = `use:${inst.group_id}`;
      if (treePath) {
        tagObject(g, treePath, {
          groupId: inst.group_id,
          nodeId: inst.node_id,
        });
      }
      g.applyMatrix4(mat4x3ToMatrix4(inst.transform.m));
      return g;
    }
    default:
      return null;
  }
}

export function buildPrimitive(
  kind: string,
  params: Record<string, Value>,
  transform: number[],
  mode: string
): THREE.Object3D | null {
  let geometry: THREE.BufferGeometry | null = null;

  switch (kind) {
    case "box": {
      // Spec: length / width / height along lengthVec × widthVec frame.
      const l = num(param(params, "length"), 1);
      const w = num(param(params, "width"), 1);
      const h = num(param(params, "height"), 1);
      geometry = new THREE.BoxGeometry(l, w, h);
      // BoxGeometry is XYZ-centered; host transform owns placement.
      break;
    }
    case "sphere": {
      const r = num(param(params, "radius"), 1);
      geometry = new THREE.SphereGeometry(r, 32, 16);
      const center = vec3(param(params, "center"));
      geometry.translate(center.x, center.y, center.z);
      break;
    }
    case "cylinder": {
      const d = num(param(params, "diameter"), 1);
      const bottom = vec3(param(params, "bottomCenterPt"));
      const top = vec3(param(params, "topCenterPt"), [0, 0, 1]);
      const height = bottom.distanceTo(top) || 1;
      geometry = new THREE.CylinderGeometry(d / 2, d / 2, height, 32);
      alignAxisY(geometry, bottom, top);
      break;
    }
    case "sector-cylinder":
    case "cutcylinder": {
      // Spec: `sector-cylinder` (OCC MakeCylinder(r, h, angle)).
      // `cutcylinder` is a legacy alias.
      const d = num(param(params, "diameter"), 1);
      const bottom = vec3(param(params, "bottomCenterPt"));
      const top = vec3(param(params, "topCenterPt"), [0, 0, 1]);
      const angleDeg = THREE.MathUtils.clamp(
        num(param(params, "angle"), 360),
        0,
        360
      );
      const height = bottom.distanceTo(top) || 1;
      geometry = buildSectorCylinderGeometry(d / 2, height, angleDeg);
      alignAxisY(geometry, bottom, top);
      break;
    }
    case "cone": {
      const bottomD = num(param(params, "bottomDiameter"), 1);
      const topD = num(param(params, "topDiameter"), 0);
      const bottom = vec3(param(params, "bottomCenterPt"));
      const top = vec3(param(params, "topCenterPt"), [0, 0, 1]);
      const height = bottom.distanceTo(top) || 1;
      // THREE CylinderGeometry(radiusTop, radiusBottom, height) — swap to match bottom→top
      geometry = new THREE.CylinderGeometry(topD / 2, bottomD / 2, height, 32);
      alignAxisY(geometry, bottom, top);
      break;
    }
    case "torus": {
      const d1 = num(param(params, "diameter1"), 1);
      const d2 = num(param(params, "diameter2"), 0.2);
      const angleDeg = num(param(params, "angle"), 360);
      const center = vec3(param(params, "torusCenterPt"));
      const normal = vec3(param(params, "normal"), [0, 0, 1]).normalize();
      geometry = new THREE.TorusGeometry(
        d1 / 2,
        d2 / 2,
        16,
        48,
        (angleDeg * Math.PI) / 180
      );
      // TorusGeometry lies in XY; rotate so local Z aligns with Normal
      const quat = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        normal
      );
      geometry.applyQuaternion(quat);
      geometry.translate(center.x, center.y, center.z);
      break;
    }
    case "triangles": {
      geometry = buildTrianglesGeometry(params);
      if (!geometry) return null;
      break;
    }
    default:
      console.warn(`[svg3dx-three] unsupported primitive: ${kind}`);
      return null;
  }

  return meshFromGeometry(geometry, transform, mode);
}

/**
 * Closed sector-cylinder in Three's Y-up / (sinθ, cosθ) frame:
 * curved wall + sector caps + two radial cut faces.
 */
function buildSectorCylinderGeometry(
  radius: number,
  height: number,
  angleDeg: number
): THREE.BufferGeometry {
  const angle = THREE.MathUtils.clamp(angleDeg, 0, 360);
  const radialSegments = Math.max(8, Math.ceil(32 * (angle / 360)));

  if (angle >= 360 - 1e-3) {
    return new THREE.CylinderGeometry(
      radius,
      radius,
      height,
      radialSegments
    );
  }

  const thetaLength = (angle * Math.PI) / 180;
  // Open torso only — built-in caps leave the radial cuts open and are easy to
  // confuse when merging custom walls; we add caps + walls ourselves.
  const torso = new THREE.CylinderGeometry(
    radius,
    radius,
    height,
    radialSegments,
    1,
    true,
    0,
    thetaLength
  );
  return mergeBufferGeometries([
    torso,
    sectorCapFace(radius, height / 2, thetaLength, radialSegments, true),
    sectorCapFace(radius, -height / 2, thetaLength, radialSegments, false),
    radialCutFace(radius, height, 0, true),
    radialCutFace(radius, height, thetaLength, false),
  ]);
}

/** Flat sector disk at y = ±height/2 (Three theta: x=r·sinθ, z=r·cosθ). */
function sectorCapFace(
  radius: number,
  y: number,
  thetaLength: number,
  segments: number,
  top: boolean
): THREE.BufferGeometry {
  const positions: number[] = [0, y, 0];
  const ny = top ? 1 : -1;
  const normals: number[] = [0, ny, 0];
  const indices: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * thetaLength;
    positions.push(radius * Math.sin(theta), y, radius * Math.cos(theta));
    normals.push(0, ny, 0);
  }
  for (let i = 0; i < segments; i++) {
    if (top) indices.push(0, i + 1, i + 2);
    else indices.push(0, i + 2, i + 1);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geom.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geom.setIndex(indices);
  return geom;
}

/**
 * Radial cut wall from axis to rim at `theta`.
 * `atStart`: face at thetaStart (outward = −tangent); else at thetaEnd (+tangent).
 */
function radialCutFace(
  radius: number,
  height: number,
  theta: number,
  atStart: boolean
): THREE.BufferGeometry {
  const s = Math.sin(theta);
  const c = Math.cos(theta);
  const y0 = -height / 2;
  const y1 = height / 2;
  // Outward: start → (−cos, 0, sin); end → (cos, 0, −sin).
  const nx = atStart ? -c : c;
  const nz = atStart ? s : -s;

  const positions = new Float32Array([
    0,
    y0,
    0,
    radius * s,
    y0,
    radius * c,
    radius * s,
    y1,
    radius * c,
    0,
    y1,
    0,
  ]);
  const normals = new Float32Array([
    nx,
    0,
    nz,
    nx,
    0,
    nz,
    nx,
    0,
    nz,
    nx,
    0,
    nz,
  ]);
  // Winding [0,1,2,0,2,3] yields start-outward; reverse for the end wall.
  const indices = atStart ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geom.setIndex(indices);
  return geom;
}

function mergeBufferGeometries(
  geoms: THREE.BufferGeometry[]
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;

  for (const g of geoms) {
    const pos = g.getAttribute("position");
    const nrm = g.getAttribute("normal");
    if (!pos) continue;
    if (!nrm) g.computeVertexNormals();
    const nrmAttr = g.getAttribute("normal");
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (nrmAttr) {
        normals.push(nrmAttr.getX(i), nrmAttr.getY(i), nrmAttr.getZ(i));
      } else {
        normals.push(0, 1, 0);
      }
    }
    const idx = g.getIndex();
    if (idx) {
      for (let i = 0; i < idx.count; i++) {
        indices.push(idx.getX(i) + vertexOffset);
      }
    } else {
      for (let i = 0; i < pos.count; i++) {
        indices.push(vertexOffset + i);
      }
    }
    vertexOffset += pos.count;
    g.dispose();
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  out.setIndex(indices);
  return out;
}

function buildTrianglesGeometry(
  params: Record<string, Value>
): THREE.BufferGeometry | null {
  const points = params.point;
  const index = params.index;
  if (!Array.isArray(points) || !Array.isArray(index)) return null;

  const positions = new Float32Array(points.map(Number));
  const indices: number[] = [];
  for (let i = 0; i + 2 < index.length; i += 3) {
    // spec: 1-based indices
    indices.push(Number(index[i]) - 1, Number(index[i + 1]) - 1, Number(index[i + 2]) - 1);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setIndex(indices);

  const normalVal = param(params, "normal");
  if (Array.isArray(normalVal)) {
    const normals = new Float32Array(normalVal.map(Number));
    geom.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  } else {
    geom.computeVertexNormals();
  }
  return geom;
}

function meshFromGeometry(
  geometry: THREE.BufferGeometry,
  transform: number[],
  mode: string
): THREE.Object3D {
  const material =
    mode === "wireframe"
      ? new THREE.MeshBasicMaterial({ color: 0x88aacc, wireframe: true })
      : new THREE.MeshStandardMaterial({
          color: 0x88aacc,
          metalness: 0.1,
          roughness: 0.6,
          side: THREE.DoubleSide,
        });

  const mesh = new THREE.Mesh(geometry, material);
  const xf = mat4x3ToMatrix4(transform);

  if (mode === "hidden-line") {
    const edges = new THREE.EdgesGeometry(geometry);
    const line = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x222222 })
    );
    const g = new THREE.Group();
    g.add(mesh);
    g.add(line);
    g.applyMatrix4(xf);
    return g;
  }

  mesh.applyMatrix4(xf);
  return mesh;
}
