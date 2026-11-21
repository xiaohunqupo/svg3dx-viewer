import * as THREE from "three";
import type { GeometryInstruction, Value } from "./types.js";
import { mat4x3ToMatrix4 } from "./transform.js";
import { buildBoolOp } from "./bool.js";
import { getPickData, setPickData } from "./pick.js";
import { buildPipeGeometry, buildSweepGeometry } from "./sweep.js";
import {
  buildArcGeometry,
  buildLineGeometry,
  buildPathGeometry,
} from "./curves.js";
import {
  buildExtrudeGeometry,
  buildLoftGeometry,
  buildPrismGeometry,
  buildPyramidGeometry,
  buildRevolveGeometry,
} from "./solids.js";
import {
  type MaterialLibrary,
  resolveAppearance,
  toThreeLineMaterial,
  toThreeMaterial,
} from "./materials.js";
import { SVG3DX_GLTF_PENDING, type GltfPendingData } from "./gltf.js";

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
  // TypedArray from wasm before revive (defensive)
  if (ArrayBuffer.isView(v) && (v as ArrayLike<number>).length >= 3) {
    const a = v as ArrayLike<number>;
    return new THREE.Vector3(Number(a[0]), Number(a[1]), Number(a[2]));
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

/**
 * Align Z-up sector geometry (θ=0 along local +X) so local +Z runs `from`→`to`.
 * Azimuth zero follows world +X projected into the plane ⊥ axis (OCC Ax2 style);
 * if axis ∥ +X, fall back to +Y.
 */
function alignAxisZ(
  geometry: THREE.BufferGeometry,
  from: THREE.Vector3,
  to: THREE.Vector3
): void {
  const zAxis = new THREE.Vector3().subVectors(to, from);
  if (zAxis.lengthSq() < 1e-20) zAxis.set(0, 0, 1);
  else zAxis.normalize();

  let xAxis = new THREE.Vector3(1, 0, 0);
  xAxis.addScaledVector(zAxis, -xAxis.dot(zAxis));
  if (xAxis.lengthSq() < 1e-12) {
    xAxis.set(0, 1, 0);
    xAxis.addScaledVector(zAxis, -xAxis.dot(zAxis));
  }
  xAxis.normalize();
  // Local Z-up RH: +Z→axis, +X→xRef, +Y→axis×xRef (so X×Y=Z).
  const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();

  const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
  const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  m.setPosition(mid);
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
  treePath?: string,
  library: MaterialLibrary = new Map()
): THREE.Object3D | null {
  switch (inst.type) {
    case "primitive": {
      const obj = buildPrimitive(
        inst.kind,
        inst.params,
        inst.transform.m,
        mode,
        inst.styles,
        library
      );
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
        const obj = buildThreeObject(child, mode, childPath, library);
        if (obj) {
          if (childPath) {
            const ownGroup = getPickData(obj)?.groupId;
            tagObject(obj, childPath, {
              // An inlined use already carries the target group id. Do not
              // replace it with the parent group's id — that hides the use.
              groupId: ownGroup ?? inst.id ?? undefined,
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
      const obj = buildBoolOp(
        inst,
        mode,
        (child, m) => buildThreeObject(child, m ?? mode, treePath, library),
        library
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
  mode: string,
  styles: Record<string, Value> = {},
  library: MaterialLibrary = new Map()
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
      // `cutcylinder` is a legacy alias. θ=0 at +X, CCW about axis.
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
      alignAxisZ(geometry, bottom, top);
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
    case "wedge": {
      // Spec §3.2 / AutoCAD WEDGE: taper along length toward the thin end.
      // topLength = upper-face length from the thick end (0 → pointed).
      const l = Math.max(num(param(params, "length"), 1), 1e-6);
      const w = Math.max(num(param(params, "width"), 1), 1e-6);
      const h = Math.max(num(param(params, "height"), 1), 1e-6);
      const topL = THREE.MathUtils.clamp(num(param(params, "topLength"), 0), 0, l);
      const lengthDir = vec3(param(params, "lengthVec"), [1, 0, 0]);
      const widthDir = vec3(param(params, "widthVec"), [0, 1, 0]);
      geometry = buildWedgeGeometry(l, w, h, topL, lengthDir, widthDir);
      break;
    }
    case "pyramid": {
      const l = Math.max(num(param(params, "length"), 1), 1e-6);
      const w = Math.max(num(param(params, "width"), 1), 1e-6);
      const h = Math.max(num(param(params, "height"), 1), 1e-6);
      const topL = Math.max(num(param(params, "topLength"), 0), 0);
      const topWRaw = param(params, "topWidth");
      const topW =
        topWRaw === undefined ? topL : Math.max(num(topWRaw, topL), 0);
      geometry = buildPyramidGeometry(
        l,
        w,
        h,
        topL,
        topW,
        vec3(param(params, "lengthVec"), [1, 0, 0]),
        vec3(param(params, "widthVec"), [0, 1, 0])
      );
      if (!geometry) return null;
      break;
    }
    case "prism": {
      geometry = buildPrismGeometry(
        param(params, "points"),
        num(param(params, "height"), 1),
        param(params, "normal")
      );
      if (!geometry) return null;
      break;
    }
    case "line": {
      geometry = buildLineGeometry(param(params, "from"), param(params, "to"));
      if (!geometry) return null;
      return curveFromGeometry(geometry, transform, styles, library);
    }
    case "arc": {
      geometry = buildArcGeometry(params);
      if (!geometry) return null;
      return curveFromGeometry(geometry, transform, styles, library);
    }
    case "path": {
      geometry = buildPathGeometry(params);
      if (!geometry) return null;
      return curveFromGeometry(geometry, transform, styles, library);
    }
    case "extrude":
    case "polylinestretch": {
      {
        const origin = vec3(param(params, "origin"), [0, 0, 0]);
        const normal = vec3(param(params, "normal"), [0, 0, 1]);
        const xDir = vec3(param(params, "xDir"), [1, 0, 0]);
        const dirVal = param(params, "dir") ?? param(params, "normal");
        geometry = buildExtrudeGeometry(
          param(params, "section"),
          dirVal,
          num(param(params, "length"), 1),
          { origin, normal, xDir }
        );
      }
      if (!geometry) return null;
      break;
    }
    case "loft": {
      geometry = buildLoftGeometry(
        param(params, "sections"),
        param(params, "solid"),
        param(params, "blend")
      );
      if (!geometry) return null;
      break;
    }
    case "revolve": {
      // Axis = body +Z; section pose/transform relative to body; plane must ∥ Z.
      geometry = buildRevolveGeometry(
        param(params, "section"),
        num(param(params, "angle"), 360),
        param(params, "solid")
      );
      if (!geometry) return null;
      break;
    }
    case "sweep": {
      geometry = buildSweepGeometry(
        param(params, "section"),
        param(params, "path"),
        param(params, "orient"),
        param(params, "refDir"),
        param(params, "solid"),
        param(params, "outerCorner"),
        param(params, "innerCorner"),
        param(params, "outerCornerRadius"),
        param(params, "innerCornerRadius"),
        param(params, "miterLimit")
      );
      if (!geometry) return null;
      break;
    }
    case "pipe": {
      const inner = param(params, "innerRadius");
      geometry = buildPipeGeometry(
        num(param(params, "radius"), 1),
        inner === undefined ? undefined : num(inner, 0),
        param(params, "path"),
        param(params, "outerCorner"),
        param(params, "innerCorner"),
        param(params, "outerCornerRadius"),
        param(params, "innerCornerRadius"),
        param(params, "miterLimit")
      );
      if (!geometry) return null;
      break;
    }
    case "gltf": {
      const hrefVal = param(params, "href");
      const href =
        typeof hrefVal === "string"
          ? hrefVal
          : hrefVal != null
            ? String(hrefVal)
            : "";
      const g = new THREE.Group();
      g.name = "gltf";
      const pending: GltfPendingData = { href, styles, mode };
      g.userData[SVG3DX_GLTF_PENDING] = pending;
      g.applyMatrix4(mat4x3ToMatrix4(transform));
      return g;
    }
    default:
      console.warn(`[svg3dx-three] unsupported primitive: ${kind}`);
      return null;
  }

  const hasVertexColors = !!geometry.getAttribute("color");
  return meshFromGeometry(geometry, transform, mode, styles, library, hasVertexColors);
}

/**
 * AutoCAD-style wedge in local length×width×height, then baked into
 * lengthVec / widthVec / (lengthVec×widthVec) world axes.
 *
 * Corner at origin; thick face at length=0; thin end at +length.
 * `topLength` is the top-face extent along length from the thick end
 * (OCC `ltx`); 0 collapses the top to the thick-end ridge.
 *
 * Each triangle owns its own verts + flat normal so sharp edges light correctly.
 */
function buildWedgeGeometry(
  length: number,
  width: number,
  height: number,
  topLength: number,
  lengthVec: THREE.Vector3,
  widthVec: THREE.Vector3
): THREE.BufferGeometry {
  const xAxis = lengthVec.clone().normalize();
  if (xAxis.lengthSq() < 1e-12) xAxis.set(1, 0, 0);

  let yAxis = widthVec.clone();
  yAxis.addScaledVector(xAxis, -yAxis.dot(xAxis));
  if (yAxis.lengthSq() < 1e-12) {
    yAxis = new THREE.Vector3(0, 1, 0);
    yAxis.addScaledVector(xAxis, -yAxis.dot(xAxis));
    if (yAxis.lengthSq() < 1e-12) {
      yAxis = new THREE.Vector3(0, 0, 1);
      yAxis.addScaledVector(xAxis, -yAxis.dot(xAxis));
    }
  }
  yAxis.normalize();
  const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();

  const map = (lx: number, ly: number, lz: number): THREE.Vector3 =>
    new THREE.Vector3()
      .addScaledVector(xAxis, lx)
      .addScaledVector(yAxis, ly)
      .addScaledVector(zAxis, lz);

  // Corner labels in local (length, width, height):
  //   a000 -------- aL00          top ridge / top face at z=height
  //    |  bottom z=0  |
  //   a0W0 -------- aLW0
  const a000 = map(0, 0, 0);
  const aL00 = map(length, 0, 0);
  const aLW0 = map(length, width, 0);
  const a0W0 = map(0, width, 0);
  const a00H = map(0, 0, height);
  const a0WH = map(0, width, height);

  const positions: number[] = [];
  const normals: number[] = [];

  /** a→b→c must be CCW when viewed from outside; normal = (b−a)×(c−a). */
  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    const n = new THREE.Vector3()
      .subVectors(b, a)
      .cross(new THREE.Vector3().subVectors(c, a));
    if (n.lengthSq() < 1e-20) return;
    n.normalize();
    for (const p of [a, b, c]) {
      positions.push(p.x, p.y, p.z);
      normals.push(n.x, n.y, n.z);
    }
  };

  /** a→b→c→d CCW from outside. */
  const pushQuad = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3
  ) => {
    pushTri(a, b, c);
    pushTri(a, c, d);
  };

  // Bottom (−Z): a000 → a0W0 → aLW0 → aL00
  pushQuad(a000, a0W0, aLW0, aL00);
  // Thick end (−X): a000 → a00H → a0WH → a0W0
  pushQuad(a000, a00H, a0WH, a0W0);

  if (topLength <= 1e-6) {
    // Slope: a00H → aL00 → aLW0 → a0WH
    pushQuad(a00H, aL00, aLW0, a0WH);
    // −Y / +Y triangular sides
    pushTri(a000, aL00, a00H);
    pushTri(a0W0, a0WH, aLW0);
  } else {
    const aT0H = map(topLength, 0, height);
    const aTWH = map(topLength, width, height);
    // Top (+Z)
    pushQuad(a00H, aT0H, aTWH, a0WH);
    // Slope
    pushQuad(aT0H, aL00, aLW0, aTWH);
    // −Y / +Y
    pushQuad(a000, aL00, aT0H, a00H);
    pushQuad(a0W0, a0WH, aTWH, aLW0);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  return geom;
}

/**
 * Closed sector-cylinder in Z-up local frame (OCC-style):
 * - axis along +Z, centered at origin
 * - θ=0 at +X: (r·cosθ, r·sinθ, z); CCW toward +Y about +Z
 * - curved wall + sector caps + two radial cut faces
 */
function buildSectorCylinderGeometry(
  radius: number,
  height: number,
  angleDeg: number
): THREE.BufferGeometry {
  const angle = THREE.MathUtils.clamp(angleDeg, 0, 360);
  const radialSegments = Math.max(8, Math.ceil(32 * (angle / 360)));

  if (angle >= 360 - 1e-3) {
    // Full cylinder: Three is Y-up — rotate to Z-up for alignAxisZ.
    const full = new THREE.CylinderGeometry(
      radius,
      radius,
      height,
      radialSegments
    );
    full.rotateX(Math.PI / 2);
    return full;
  }

  const thetaLength = (angle * Math.PI) / 180;
  return mergeBufferGeometries([
    sectorCurvedWall(radius, height, thetaLength, radialSegments),
    sectorCapFace(radius, height / 2, thetaLength, radialSegments, true),
    sectorCapFace(radius, -height / 2, thetaLength, radialSegments, false),
    radialCutFace(radius, height, 0, true),
    radialCutFace(radius, height, thetaLength, false),
  ]);
}

/** Lateral wall: θ from 0..thetaLength, z from −h/2..+h/2. */
function sectorCurvedWall(
  radius: number,
  height: number,
  thetaLength: number,
  segments: number
): THREE.BufferGeometry {
  const z0 = -height / 2;
  const z1 = height / 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * thetaLength;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const x = radius * c;
    const y = radius * s;
    positions.push(x, y, z0, x, y, z1);
    normals.push(c, s, 0, c, s, 0);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 3;
    const d = a + 2;
    indices.push(a, d, c, a, c, b);
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

/** Flat sector disk at z = ±height/2 (θ=0 at +X). */
function sectorCapFace(
  radius: number,
  z: number,
  thetaLength: number,
  segments: number,
  top: boolean
): THREE.BufferGeometry {
  const positions: number[] = [0, 0, z];
  const nz = top ? 1 : -1;
  const normals: number[] = [0, 0, nz];
  const indices: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * thetaLength;
    positions.push(
      radius * Math.cos(theta),
      radius * Math.sin(theta),
      z
    );
    normals.push(0, 0, nz);
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
 * Radial cut wall from axis to rim at `theta` (θ=0 → +X).
 * `atStart`: outward = −tangent (−Y at θ=0); else +tangent.
 */
function radialCutFace(
  radius: number,
  height: number,
  theta: number,
  atStart: boolean
): THREE.BufferGeometry {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const z0 = -height / 2;
  const z1 = height / 2;
  // Tangent ∂/∂θ = (−r sin, r cos) → unit (−s, c); outward for start = −tangent.
  const nx = atStart ? s : -s;
  const ny = atStart ? -c : c;

  const positions = new Float32Array([
    0,
    0,
    z0,
    radius * c,
    radius * s,
    z0,
    radius * c,
    radius * s,
    z1,
    0,
    0,
    z1,
  ]);
  const normals = new Float32Array([
    nx,
    ny,
    0,
    nx,
    ny,
    0,
    nx,
    ny,
    0,
    nx,
    ny,
    0,
  ]);
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

function meshFromGeometry(
  geometry: THREE.BufferGeometry,
  transform: number[],
  mode: string,
  styles: Record<string, Value>,
  library: MaterialLibrary,
  vertexColors = false
): THREE.Object3D {
  const appearance = resolveAppearance(styles, library);
  const material = toThreeMaterial(appearance, mode, { vertexColors });

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

function curveFromGeometry(
  geometry: THREE.BufferGeometry,
  transform: number[],
  styles: Record<string, Value>,
  library: MaterialLibrary
): THREE.Object3D {
  const appearance = resolveAppearance(styles, library);
  const line = new THREE.Line(geometry, toThreeLineMaterial(appearance));
  line.applyMatrix4(mat4x3ToMatrix4(transform));
  return line;
}
