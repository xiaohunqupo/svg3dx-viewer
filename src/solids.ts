import * as THREE from "three";
import type { Value } from "./types.js";
import { pointsFromValue } from "./sweep.js";
import {
  shapeAllowsRevolveCaps,
  sectionToPolylines3D,
  sectionToRevolvePolylines3D,
  sectionToRing3D,
  type SectionPolyline3D,
} from "./section.js";

/** Shared flat-shaded triangle accumulator. */
export class FlatMeshBuilder {
  positions: number[] = [];
  normals: number[] = [];

  pushTri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void {
    const n = new THREE.Vector3()
      .subVectors(b, a)
      .cross(new THREE.Vector3().subVectors(c, a));
    if (n.lengthSq() < 1e-20) return;
    n.normalize();
    for (const p of [a, b, c]) {
      this.positions.push(p.x, p.y, p.z);
      this.normals.push(n.x, n.y, n.z);
    }
  }

  pushQuad(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3
  ): void {
    this.pushTri(a, b, c);
    this.pushTri(a, c, d);
  }

  toGeometry(): THREE.BufferGeometry | null {
    if (this.positions.length === 0) return null;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(this.positions, 3)
    );
    geom.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(this.normals, 3)
    );
    return geom;
  }
}

function orthonormalFrame(
  lengthVec: THREE.Vector3,
  widthVec: THREE.Vector3
): { x: THREE.Vector3; y: THREE.Vector3; z: THREE.Vector3 } {
  const x = lengthVec.clone().normalize();
  if (x.lengthSq() < 1e-12) x.set(1, 0, 0);
  let y = widthVec.clone();
  y.addScaledVector(x, -y.dot(x));
  if (y.lengthSq() < 1e-12) {
    y = new THREE.Vector3(0, 1, 0);
    y.addScaledVector(x, -y.dot(x));
    if (y.lengthSq() < 1e-12) {
      y = new THREE.Vector3(0, 0, 1);
      y.addScaledVector(x, -y.dot(x));
    }
  }
  y.normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  return { x, y, z };
}

/**
 * Rectangular pyramid / frustum.
 * Spec: local origin = base center; height along lengthVec × widthVec.
 */
export function buildPyramidGeometry(
  length: number,
  width: number,
  height: number,
  topLength: number,
  topWidth: number,
  lengthVec: THREE.Vector3,
  widthVec: THREE.Vector3
): THREE.BufferGeometry | null {
  const L = Math.max(length, 1e-6);
  const W = Math.max(width, 1e-6);
  const H = Math.max(height, 1e-6);
  const tL = Math.max(topLength, 0);
  const tW = Math.max(topWidth, 0);
  const { x, y, z } = orthonormalFrame(lengthVec, widthVec);

  const map = (lx: number, ly: number, lz: number) =>
    new THREE.Vector3()
      .addScaledVector(x, lx)
      .addScaledVector(y, ly)
      .addScaledVector(z, lz);

  // Base centered at origin
  const b0 = map(-L / 2, -W / 2, 0);
  const b1 = map(L / 2, -W / 2, 0);
  const b2 = map(L / 2, W / 2, 0);
  const b3 = map(-L / 2, W / 2, 0);

  const mesh = new FlatMeshBuilder();
  // Base (−Z)
  mesh.pushQuad(b0, b3, b2, b1);

  const pointed = tL <= 1e-6 && tW <= 1e-6;
  if (pointed) {
    const apex = map(0, 0, H);
    mesh.pushTri(b0, b1, apex);
    mesh.pushTri(b1, b2, apex);
    mesh.pushTri(b2, b3, apex);
    mesh.pushTri(b3, b0, apex);
  } else {
    const t0 = map(-tL / 2, -tW / 2, H);
    const t1 = map(tL / 2, -tW / 2, H);
    const t2 = map(tL / 2, tW / 2, H);
    const t3 = map(-tL / 2, tW / 2, H);
    mesh.pushQuad(t0, t1, t2, t3); // top +Z
    mesh.pushQuad(b0, b1, t1, t0);
    mesh.pushQuad(b1, b2, t2, t1);
    mesh.pushQuad(b2, b3, t3, t2);
    mesh.pushQuad(b3, b0, t0, t3);
  }
  return mesh.toGeometry();
}

/** Prism: polygon base extruded along normal by height. */
export function buildPrismGeometry(
  pointsVal: Value | undefined,
  height: number,
  normalVal: Value | undefined
): THREE.BufferGeometry | null {
  const pts = pointsFromValue(pointsVal);
  if (pts.length < 3) return null;
  // Drop closing duplicate
  if (pts[0]!.distanceToSquared(pts[pts.length - 1]!) < 1e-12) pts.pop();
  if (pts.length < 3) return null;

  let normal: THREE.Vector3;
  if (
    (Array.isArray(normalVal) || ArrayBuffer.isView(normalVal)) &&
    (normalVal as ArrayLike<number>).length >= 3
  ) {
    const a = normalVal as ArrayLike<number>;
    normal = new THREE.Vector3(Number(a[0]), Number(a[1]), Number(a[2]));
  } else {
    normal = new THREE.Vector3()
      .subVectors(pts[1]!, pts[0]!)
      .cross(new THREE.Vector3().subVectors(pts[2]!, pts[0]!));
  }
  if (normal.lengthSq() < 1e-12) normal.set(0, 0, 1);
  else normal.normalize();

  const h = Math.max(height, 1e-6);
  const top = pts.map((p) => p.clone().addScaledVector(normal, h));
  const mesh = new FlatMeshBuilder();

  // Bottom: reverse winding so outward = −normal
  const o = new THREE.Vector3();
  for (const p of pts) o.add(p);
  o.multiplyScalar(1 / pts.length);
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    mesh.pushTri(o, pts[j]!, pts[i]!);
  }

  // Top
  const ot = o.clone().addScaledVector(normal, h);
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    mesh.pushTri(ot, top[i]!, top[j]!);
  }

  // Sides
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    mesh.pushQuad(pts[i]!, pts[j]!, top[j]!, top[i]!);
  }
  return mesh.toGeometry();
}

/** Distance from point to axis (cylinder radius in the local frame). */
function radiusAboutAxis(
  p: THREE.Vector3,
  origin: THREE.Vector3,
  axis: THREE.Vector3
): number {
  const v = p.clone().sub(origin);
  const axial = axis.dot(v);
  return Math.sqrt(Math.max(0, v.lengthSq() - axial * axial));
}

/** Revolve body axis: always +Z through the body / section origin. */
const REVOLVE_AXIS = new THREE.Vector3(0, 0, 1);
const REVOLVE_ORIGIN = new THREE.Vector3(0, 0, 0);

/**
 * Revolve one XOZ profile about body +Z (CCW for positive angle).
 * Caps (when requested) are triangulated end faces (fan from ring centroid).
 */
function revolveOneProfile(
  poly: SectionPolyline3D,
  angleDeg: number,
  solid: boolean
): THREE.BufferGeometry | null {
  const pts = poly.points;
  if (pts.length < 2) return null;
  const closed = poly.closed;
  const canCap = solid && shapeAllowsRevolveCaps(poly.tag, closed);
  const axis = REVOLVE_AXIS;
  const axisOrigin = REVOLVE_ORIGIN;

  const angle = THREE.MathUtils.clamp(angleDeg, 0, 360);
  const full = angle >= 360 - 1e-3;
  const segs = Math.max(32, Math.ceil(96 * (angle / 360)));
  // Positive angle = CCW about +Z (right-hand rule).
  const theta = ((full ? 360 : angle) * Math.PI) / 180;
  const m = pts.length;
  const cols = full ? segs : segs + 1;
  const profileEdges = closed ? m : m - 1;

  const at = (profileIndex: number, col: number): THREE.Vector3 => {
    const a = (col / segs) * theta;
    const q = new THREE.Quaternion().setFromAxisAngle(axis, a);
    return pts[profileIndex]!
      .clone()
      .sub(axisOrigin)
      .applyQuaternion(q)
      .add(axisOrigin);
  };

  /**
   * Outward normal for a surface of revolution of a profile edge.
   * In the (r,z) half-plane, CCW profile → outward 2D normal (dz, -dr);
   * lift to 3D as  dz·radialHat − dr·axis.
   */
  const stripNormal = (
    p: THREE.Vector3,
    r0: number,
    z0: number,
    r1: number,
    z1: number
  ): THREE.Vector3 => {
    const dr = r1 - r0;
    const dz = z1 - z0;
    const v = p.clone().sub(axisOrigin);
    const axial = axis.dot(v);
    const radial = v.addScaledVector(axis, -axial);
    const rLen = radial.length();
    const radialHat =
      rLen > 1e-10
        ? radial.multiplyScalar(1 / rLen)
        : new THREE.Vector3(1, 0, 0);
    const n = new THREE.Vector3()
      .addScaledVector(radialHat, dz)
      .addScaledVector(axis, -dr);
    if (n.lengthSq() < 1e-16) return radialHat.clone();
    return n.normalize();
  };

  const rz = pts.map((p) => {
    const v = p.clone().sub(axisOrigin);
    return { r: radiusAboutAxis(p, axisOrigin, axis), z: axis.dot(v) };
  });

  let areaRz = 0;
  for (let i = 0; i < m; i++) {
    const a = rz[i]!;
    const b = rz[(i + 1) % m]!;
    areaRz += a.r * b.z - a.z * b.r;
  }
  const ccw = areaRz >= 0;

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let base = 0;

  for (let e = 0; e < profileEdges; e++) {
    const j0 = e;
    const j1 = closed ? (e + 1) % m : e + 1;
    const ra = rz[j0]!;
    const rb = rz[j1]!;
    const r0 = ccw ? ra.r : rb.r;
    const z0 = ccw ? ra.z : rb.z;
    const r1 = ccw ? rb.r : ra.r;
    const z1 = ccw ? rb.z : ra.z;
    const row0 = ccw ? j0 : j1;
    const row1 = ccw ? j1 : j0;

    for (let col = 0; col < cols; col++) {
      const p0 = at(row0, col);
      const p1 = at(row1, col);
      const n0 = stripNormal(p0, r0, z0, r1, z1);
      const n1 = stripNormal(p1, r0, z0, r1, z1);
      positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
      normals.push(n0.x, n0.y, n0.z, n1.x, n1.y, n1.z);
    }
    for (let i = 0; i < segs; i++) {
      const i0 = i;
      const i1 = full ? (i + 1) % segs : i + 1;
      const a = base + i0 * 2;
      const b = base + i0 * 2 + 1;
      const c = base + i1 * 2 + 1;
      const d = base + i1 * 2;
      indices.push(a, d, c, a, c, b);
    }
    base += cols * 2;
  }

  const side = new THREE.BufferGeometry();
  side.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  side.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  side.setIndex(indices);

  if (!canCap || full || !closed) return side;

  // Triangulated end caps (fan from ring centroid).
  const caps = new FlatMeshBuilder();
  const ringAt = (col: number): THREE.Vector3[] => {
    const out: THREE.Vector3[] = [];
    for (let j = 0; j < m; j++) out.push(at(j, col));
    return out;
  };
  const rStart = ringAt(0);
  const rEnd = ringAt(cols - 1);
  const c0 = centroid(rStart);
  const cN = centroid(rEnd);
  for (let j = 0; j < m; j++) {
    const j1 = (j + 1) % m;
    caps.pushTri(c0, rStart[j1]!, rStart[j]!);
    caps.pushTri(cN, rEnd[j]!, rEnd[j1]!);
  }
  const capGeom = caps.toGeometry();
  if (!capGeom) return side;
  return mergeGeometriesKeepNormals(side, capGeom);
}

/**
 * Revolve section 2D shapes in the revolve body frame.
 *
 * - Axis = body +Z through body origin; positive `angle` = CCW
 * - Section pose / `transform` relative to the body; plane must ∥ body Z
 * - Multiple 2D shapes each revolve independently (no union)
 * - Closed path / circle get triangulated end caps when `solid` and angle < 360°
 */
export function buildRevolveGeometry(
  sectionVal: Value | undefined,
  angleDeg: number,
  solidRaw?: Value | undefined
): THREE.BufferGeometry | null {
  const solid = solidRaw === false || solidRaw === "false" ? false : true;
  const polys = sectionToRevolvePolylines3D(sectionVal, { forceClosed: false });
  if (!polys.length) return null;

  let merged: THREE.BufferGeometry | null = null;
  for (const poly of polys) {
    const g = revolveOneProfile(poly, angleDeg, solid);
    if (!g) continue;
    if (!merged) {
      merged = g;
      continue;
    }
    merged = mergeGeometriesKeepNormals(merged, g);
  }
  return merged;
}

function mergeGeometriesKeepNormals(
  a: THREE.BufferGeometry,
  b: THREE.BufferGeometry
): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const append = (g: THREE.BufferGeometry) => {
    const p = g.getAttribute("position");
    let n = g.getAttribute("normal");
    if (!n) {
      g.computeVertexNormals();
      n = g.getAttribute("normal");
    }
    const idx = g.getIndex();
    if (idx) {
      for (let i = 0; i < idx.count; i++) {
        const vi = idx.getX(i);
        pos.push(p.getX(vi), p.getY(vi), p.getZ(vi));
        nrm.push(n.getX(vi), n.getY(vi), n.getZ(vi));
      }
    } else {
      for (let i = 0; i < p.count; i++) {
        pos.push(p.getX(i), p.getY(i), p.getZ(i));
        nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      }
    }
    g.dispose();
  };
  append(a);
  append(b);
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  return out;
}

function centroid(pts: THREE.Vector3[]): THREE.Vector3 {
  const c = new THREE.Vector3();
  for (const p of pts) c.add(p);
  return c.multiplyScalar(1 / Math.max(pts.length, 1));
}

/** General indexed mesh (glTF-style). */
export function buildMeshGeometry(
  params: Record<string, Value>
): THREE.BufferGeometry | null {
  const mode =
    typeof params.mode === "string" ? params.mode : "triangles";
  if (mode !== "triangles" && mode !== "triangle-strip" && mode !== "triangle-fan") {
    console.warn(`[svg3dx-three] mesh mode '${mode}' not rendered yet`);
    return null;
  }

  const posFlat = flattenScalar(params.position);
  if (posFlat.length < 9) return null;
  const vertexCount = Math.floor(posFlat.length / 3);

  const indexBase =
    typeof params.indexBase === "number" ? params.indexBase : 0;
  let indices: number[] = [];
  if (Array.isArray(params.index)) {
    const raw = params.index.map(Number);
    for (const i of raw) {
      indices.push(i - indexBase);
    }
  } else {
    for (let i = 0; i < vertexCount; i++) indices.push(i);
  }

  // Expand strip / fan to triangles
  if (mode === "triangle-strip") {
    const tri: number[] = [];
    for (let i = 0; i + 2 < indices.length; i++) {
      if (i % 2 === 0) tri.push(indices[i]!, indices[i + 1]!, indices[i + 2]!);
      else tri.push(indices[i + 1]!, indices[i]!, indices[i + 2]!);
    }
    indices = tri;
  } else if (mode === "triangle-fan") {
    const tri: number[] = [];
    const i0 = indices[0]!;
    for (let i = 1; i + 1 < indices.length; i++) {
      tri.push(i0, indices[i]!, indices[i + 1]!);
    }
    indices = tri;
  }

  if (indices.length < 3 || indices.length % 3 !== 0) return null;

  const nrmFlat = flattenScalar(params.normal);
  const hasNormals = nrmFlat.length >= vertexCount * 3;

  // Emit flat-shaded unique verts per triangle for stable lighting
  const mesh = new FlatMeshBuilder();
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const ia = indices[i]!;
    const ib = indices[i + 1]!;
    const ic = indices[i + 2]!;
    if (
      ia < 0 ||
      ib < 0 ||
      ic < 0 ||
      ia >= vertexCount ||
      ib >= vertexCount ||
      ic >= vertexCount
    ) {
      continue;
    }
    const a = new THREE.Vector3(
      posFlat[ia * 3]!,
      posFlat[ia * 3 + 1]!,
      posFlat[ia * 3 + 2]!
    );
    const b = new THREE.Vector3(
      posFlat[ib * 3]!,
      posFlat[ib * 3 + 1]!,
      posFlat[ib * 3 + 2]!
    );
    const c = new THREE.Vector3(
      posFlat[ic * 3]!,
      posFlat[ic * 3 + 1]!,
      posFlat[ic * 3 + 2]!
    );

    if (hasNormals) {
      // Average of corner normals as face normal fallback; prefer geometric
      mesh.pushTri(a, b, c);
    } else {
      mesh.pushTri(a, b, c);
    }
  }
  return mesh.toGeometry();
}

function flattenScalar(v: Value | undefined): number[] {
  if (v == null) return [];
  if (typeof v === "number") return [v];
  if (Array.isArray(v)) {
    const out: number[] = [];
    for (const x of v) {
      if (typeof x === "number") out.push(x);
      else if (Array.isArray(x)) {
        for (const y of x) if (typeof y === "number") out.push(y);
      }
    }
    return out;
  }
  return [];
}

/** @deprecated Prefer sectionToRing3D from ./section.js */
export function profileToRing3D(
  section: Value | undefined,
  circleSegs = 32
): THREE.Vector3[] | null {
  return sectionToRing3D(section, undefined, circleSegs);
}

function ringCentroid(ring: THREE.Vector3[]): THREE.Vector3 {
  const c = new THREE.Vector3();
  for (const p of ring) c.add(p);
  return c.multiplyScalar(1 / Math.max(ring.length, 1));
}

function sectionBasis(ring: THREE.Vector3[]): {
  center: THREE.Vector3;
  normal: THREE.Vector3;
  u: THREE.Vector3;
  v: THREE.Vector3;
} {
  const center = ringCentroid(ring);
  let normal = new THREE.Vector3();
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!.clone().sub(center);
    const b = ring[(i + 1) % ring.length]!.clone().sub(center);
    normal.add(new THREE.Vector3().crossVectors(a, b));
  }
  if (normal.lengthSq() < 1e-12) normal.set(0, 0, 1);
  else normal.normalize();

  let u = new THREE.Vector3(1, 0, 0);
  if (Math.abs(normal.dot(u)) > 0.9) u.set(0, 1, 0);
  u.addScaledVector(normal, -u.dot(normal)).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u).normalize();
  return { center, normal, u, v };
}

/** Ensure ring is CCW when viewed along −normal (u×v frame). */
function ensureCcw(
  ring: THREE.Vector3[],
  u: THREE.Vector3,
  v: THREE.Vector3
): THREE.Vector3[] {
  const c = ringCentroid(ring);
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!.clone().sub(c);
    const b = ring[(i + 1) % ring.length]!.clone().sub(c);
    area += a.dot(u) * b.dot(v) - a.dot(v) * b.dot(u);
  }
  return area >= 0 ? ring : ring.slice().reverse();
}

/**
 * Densify a ring by splitting every edge into `perEdge` equal segments.
 * Original vertices (corners) are kept exactly — no polar chamfering.
 */
function densifyRing(ring: THREE.Vector3[], perEdge: number): THREE.Vector3[] {
  const div = Math.max(1, perEdge);
  const out: THREE.Vector3[] = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    for (let k = 0; k < div; k++) {
      out.push(new THREE.Vector3().lerpVectors(a, b, k / div));
    }
  }
  return out;
}

/** Ray from `origin` in direction (cosθ·u + sinθ·v) → first hit on ring. */
function hitRingAtAngle(
  ring: THREE.Vector3[],
  origin: THREE.Vector3,
  u: THREE.Vector3,
  v: THREE.Vector3,
  theta: number
): THREE.Vector3 {
  const dx = Math.cos(theta);
  const dy = Math.sin(theta);
  let hit: THREE.Vector3 | null = null;
  let bestS = Infinity;
  const n = ring.length;

  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    const ax = a.clone().sub(origin).dot(u);
    const ay = a.clone().sub(origin).dot(v);
    const bx = b.clone().sub(origin).dot(u);
    const by = b.clone().sub(origin).dot(v);
    const ex = bx - ax;
    const ey = by - ay;
    const det = ex * dy - ey * dx;
    if (Math.abs(det) < 1e-14) continue;
    const s = (ex * ay - ey * ax) / det;
    const t = (dx * ay - dy * ax) / det;
    if (t < -1e-8 || t > 1 + 1e-8 || s <= 1e-8) continue;
    if (s < bestS) {
      bestS = s;
      hit = new THREE.Vector3().lerpVectors(
        a,
        b,
        THREE.MathUtils.clamp(t, 0, 1)
      );
    }
  }
  if (hit) return hit;

  const dir = new THREE.Vector3()
    .addScaledVector(u, dx)
    .addScaledVector(v, dy);
  let best = ring[0]!;
  let bestDot = -Infinity;
  for (const p of ring) {
    const d = p.clone().sub(origin).dot(dir);
    if (d > bestDot) {
      bestDot = d;
      best = p;
    }
  }
  return best.clone();
}

function polarAngle(
  p: THREE.Vector3,
  origin: THREE.Vector3,
  u: THREE.Vector3,
  v: THREE.Vector3
): number {
  const d = p.clone().sub(origin);
  return Math.atan2(d.dot(v), d.dot(u));
}

/** Extrude a closed section along dir × length. */
export function buildExtrudeGeometry(
  sectionVal: Value | undefined,
  dirVal: Value | undefined,
  length: number,
  parentPose?: {
    origin?: THREE.Vector3;
    normal?: THREE.Vector3;
    xDir?: THREE.Vector3;
  }
): THREE.BufferGeometry | null {
  const ring = sectionToRing3D(sectionVal, parentPose);
  if (!ring) return null;

  let dir = new THREE.Vector3(0, 0, 1);
  if (
    (Array.isArray(dirVal) || ArrayBuffer.isView(dirVal)) &&
    (dirVal as ArrayLike<number>).length >= 3
  ) {
    const a = dirVal as ArrayLike<number>;
    dir.set(Number(a[0]), Number(a[1]), Number(a[2]));
  } else if (parentPose?.normal) {
    dir.copy(parentPose.normal);
  }
  if (dir.lengthSq() < 1e-12) dir.set(0, 0, 1);
  else dir.normalize();

  const h = Math.max(length, 1e-6);
  const top = ring.map((p) => p.clone().addScaledVector(dir, h));
  const mesh = new FlatMeshBuilder();
  const m = ring.length;

  const o = ringCentroid(ring);
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    mesh.pushTri(o, ring[j]!, ring[i]!); // bottom −dir
  }
  const ot = o.clone().addScaledVector(dir, h);
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    mesh.pushTri(ot, top[i]!, top[j]!);
  }
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    mesh.pushQuad(ring[i]!, ring[j]!, top[j]!, top[i]!);
  }
  return mesh.toGeometry();
}

/** Loft blend law: remap t∈[0,1] → s∈[0,1]. Unknown → linear. */
function applyLoftBlend(t: number, blend: string): number {
  const x = Math.min(1, Math.max(0, t));
  switch (blend) {
    case "sine":
      return Math.sin((Math.PI * x) / 2);
    case "cosine":
      return 0.5 - 0.5 * Math.cos(Math.PI * x);
    case "tan":
      return Math.tan((Math.PI * x) / 4);
    case "cotan":
      return 1 - Math.tan((Math.PI * (1 - x)) / 4);
    case "linear":
    default:
      return x;
  }
}

/**
 * Loft / thru-sections between ≥2 sections (each carries its own pose).
 *
 * Shape: fewest-vertex ring is the driver (keeps true corners via edge densify);
 * other sections are matched by polar angle.
 *
 * Lighting: one continuous side mesh (shared verts around the perimeter) so
 * shading blends across panel seams — important for rect↔circle (天圆地方).
 * Intermediate sections densify along the loft so non-planar quads don't facet.
 * Caps stay flat-shaded and hard-edged against the side.
 * `blend` remaps the section-to-section parameter (趋近律).
 */
export function buildLoftGeometry(
  sectionsVal: Value | undefined,
  solidRaw: Value | undefined,
  blendRaw: Value | undefined
): THREE.BufferGeometry | null {
  if (!Array.isArray(sectionsVal) || sectionsVal.length < 2) return null;
  const solid = solidRaw === false || solidRaw === "false" ? false : true;
  const blend =
    typeof blendRaw === "string" ? blendRaw.toLowerCase() : "linear";

  const rawRings: THREE.Vector3[][] = [];
  for (const p of sectionsVal) {
    const ring = sectionToRing3D(p as Value, undefined, 64);
    if (!ring) return null;
    rawRings.push(ring);
  }

  const basis = sectionBasis(rawRings[0]!);
  const oriented = rawRings.map((r) => ensureCcw(r, basis.u, basis.v));

  let driverIdx = 0;
  for (let i = 1; i < oriented.length; i++) {
    if (oriented[i]!.length < oriented[driverIdx]!.length) driverIdx = i;
  }
  const driver = oriented[driverIdx]!;
  const nEdges = driver.length;
  const perEdge = Math.max(16, Math.ceil(96 / Math.max(nEdges, 1)));
  const driverDense = densifyRing(driver, perEdge);
  const count = driverDense.length;
  const driverCenter = ringCentroid(driver);

  const angles = driverDense.map((p) =>
    polarAngle(p, driverCenter, basis.u, basis.v)
  );
  for (let i = 1; i < angles.length; i++) {
    while (angles[i]! - angles[i - 1]! > Math.PI) angles[i]! -= Math.PI * 2;
    while (angles[i]! - angles[i - 1]! < -Math.PI) angles[i]! += Math.PI * 2;
  }

  const rings: THREE.Vector3[][] = oriented.map((r, idx) => {
    if (idx === driverIdx) return driverDense;
    const c = ringCentroid(r);
    return angles.map((theta) => hitRingAtAngle(r, c, basis.u, basis.v, theta));
  });

  const S = rings.length;
  const centers = rings.map((r) => ringCentroid(r));
  // Locals relative to section centers — blend law morphs SHAPE only;
  // centers (pose) still advance linearly in t. Using the same factor for
  // both made every blend law sample the identical surface (only tessellation
  // density changed), so examples looked the same.
  const locals: THREE.Vector3[][] = rings.map((r, ri) =>
    r.map((p) => p.clone().sub(centers[ri]!))
  );

  const loftDiv = Math.max(16, Math.ceil(64 / Math.max(S - 1, 1)));
  const skin: THREE.Vector3[][] = [];
  for (let s = 0; s < S - 1; s++) {
    for (let ti = 0; ti < loftDiv; ti++) {
      const t = ti / loftDiv;
      const shapeW = applyLoftBlend(t, blend);
      const c = new THREE.Vector3().lerpVectors(
        centers[s]!,
        centers[s + 1]!,
        t
      );
      const row: THREE.Vector3[] = [];
      for (let i = 0; i < count; i++) {
        const local = new THREE.Vector3().lerpVectors(
          locals[s]![i]!,
          locals[s + 1]![i]!,
          shapeW
        );
        row.push(c.clone().add(local));
      }
      skin.push(row);
    }
  }
  skin.push(rings[S - 1]!.map((p) => p.clone()));

  const rows = skin.length;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let s = 0; s < rows; s++) {
    for (let i = 0; i < count; i++) {
      const p = skin[s]![i]!;
      positions.push(p.x, p.y, p.z);
    }
  }
  // Continuous around: last sample shares verts with first — no hard panel seams.
  for (let s = 0; s < rows - 1; s++) {
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      const a = s * count + i;
      const b = s * count + j;
      const c = (s + 1) * count + j;
      const d = (s + 1) * count + i;
      indices.push(a, b, c, a, c, d);
    }
  }

  const side = new THREE.BufferGeometry();
  side.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  side.setIndex(indices);
  side.computeVertexNormals();

  if (!solid) return side;

  // Caps from original (undensified) rings — flat, true polygon/circle silhouette.
  const caps = new FlatMeshBuilder();
  const first = oriented[0]!;
  const last = oriented[oriented.length - 1]!;
  const c0 = ringCentroid(first);
  const cN = ringCentroid(last);
  for (let i = 0; i < first.length; i++) {
    const j = (i + 1) % first.length;
    caps.pushTri(c0, first[j]!, first[i]!);
  }
  for (let i = 0; i < last.length; i++) {
    const j = (i + 1) % last.length;
    caps.pushTri(cN, last[i]!, last[j]!);
  }
  const capGeom = caps.toGeometry();
  if (!capGeom) return side;
  return mergeGeometriesKeepNormals(side, capGeom);
}
