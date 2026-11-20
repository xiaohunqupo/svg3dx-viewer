import * as THREE from "three";
import type { Value } from "./types.js";
import { parseSection2D } from "./section.js";
import { pathToPoints } from "./curves.js";

/** Flat number list → Vector3[] (ignores trailing incomplete triples). */
export function pointsFromValue(v: Value | undefined): THREE.Vector3[] {
  const flat = flattenNumbers(v);
  const out: THREE.Vector3[] = [];
  for (let i = 0; i + 2 < flat.length; i += 3) {
    out.push(new THREE.Vector3(flat[i]!, flat[i + 1]!, flat[i + 2]!));
  }
  return out;
}

function flattenNumbers(v: Value | undefined): number[] {
  if (v == null) return [];
  if (typeof v === "number") return [v];
  // Plain arrays, or TypedArray from serde-wasm-bindgen Vec<f64>
  if (Array.isArray(v) || ArrayBuffer.isView(v)) {
    const arr = v as ArrayLike<unknown>;
    const out: number[] = [];
    for (let i = 0; i < arr.length; i++) {
      const x = arr[i];
      if (typeof x === "number") out.push(x);
      else if (Array.isArray(x) || ArrayBuffer.isView(x)) {
        const inner = x as ArrayLike<unknown>;
        for (let j = 0; j < inner.length; j++) {
          const y = inner[j];
          if (typeof y === "number") out.push(y);
        }
      }
    }
    return out;
  }
  if (typeof v === "object" && v !== null && "points" in v) {
    return flattenNumbers((v as { points?: Value }).points);
  }
  return [];
}

export type Profile2D = {
  /** Closed ring in section (u,v); first point is NOT repeated. */
  ring: THREE.Vector2[];
};

/** Extract a 2D section ring from a core `section` map. */
export function parseProfile(section: Value | undefined): Profile2D | null {
  const sec = parseSection2D(section);
  if (!sec || sec.ring.length < 3) return null;
  return { ring: sec.ring };
}

type Frame = {
  origin: THREE.Vector3;
  /** Path tangent (section normal). */
  t: THREE.Vector3;
  /** Profile +u */
  n: THREE.Vector3;
  /** Profile +v */
  b: THREE.Vector3;
  /**
   * Second half of a sharp/miter join pair (same origin as previous,
   * different tangent). Outer bevel fill + inner miter; flat face normals.
   */
  bevelSeam?: boolean;
  /**
   * Second half of a chamfer cut pair. Same ring positions (bisector section),
   * different frame normals — hard crease, no extra fill (the cut edge is the
   * short path segment between the two cut vertices).
   */
  creaseSeam?: boolean;
};

/** World ring at one path station (after corner join resolution). */
type Slot = {
  pos: THREE.Vector3[];
  frame: Frame;
};

/** Default matches SVG/CSS `stroke-miterlimit` (Canvas/PDF often use 10). */
export const DEFAULT_MITER_LIMIT = 4;

/** Clamp author `miterLimit` to a usable ratio (≥ 1). */
export function resolveMiterLimit(raw: Value | undefined): number {
  const n =
    typeof raw === "number"
      ? raw
      : raw != null && Number.isFinite(Number(raw))
        ? Number(raw)
        : DEFAULT_MITER_LIMIT;
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

function dedupePolyline(pts: THREE.Vector3[]): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const p of pts) {
    if (out.length === 0 || out[out.length - 1]!.distanceToSquared(p) > 1e-12) {
      out.push(p.clone());
    }
  }
  return out;
}

function rotateAlign(
  v: THREE.Vector3,
  from: THREE.Vector3,
  to: THREE.Vector3
): THREE.Vector3 {
  const f = from.clone().normalize();
  const t = to.clone().normalize();
  const dot = THREE.MathUtils.clamp(f.dot(t), -1, 1);
  if (dot > 1 - 1e-8) return v.clone();
  if (dot < -1 + 1e-8) {
    // 180°: pick any perpendicular axis
    let axis = new THREE.Vector3(0, 1, 0).cross(f);
    if (axis.lengthSq() < 1e-12) axis = new THREE.Vector3(1, 0, 0).cross(f);
    axis.normalize();
    return v.clone().applyAxisAngle(axis, Math.PI);
  }
  const axis = new THREE.Vector3().crossVectors(f, t).normalize();
  const angle = Math.acos(dot);
  return v.clone().applyAxisAngle(axis, angle);
}

function initialNormal(
  t: THREE.Vector3,
  orient: string,
  refDir: THREE.Vector3 | null
): THREE.Vector3 {
  if ((orient === "fixed" || orient === "parallel") && refDir) {
    const n = refDir.clone().addScaledVector(t, -refDir.dot(t));
    if (n.lengthSq() > 1e-12) return n.normalize();
  }
  // World +Z is up (svg3dx): path along +X → n=+Y (in-plane), b=+Z (height).
  let n = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 0, 1), t);
  if (n.lengthSq() < 1e-12) {
    // Path ∥ ±Z — fall back to +Y as reference.
    n = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), t);
  }
  return n.normalize();
}

/** Cosine threshold: below this, treat as a sharp corner (split frames / fillet). */
const CORNER_DOT = Math.cos((25 * Math.PI) / 180);

/**
 * Expand a control polyline with automatic round corners (fillet).
 * `bevel` / `miter` leave vertices as-is (frame join differs later).
 */
export function applyPathCorners(
  path: THREE.Vector3[],
  corner: string,
  cornerRadius: number | undefined
): THREE.Vector3[] {
  const pts = dedupePolyline(path);
  if (pts.length < 3) return pts;
  const mode = corner === "auto" ? "round" : corner;
  if (mode !== "round") return pts;

  let R = cornerRadius;
  if (R == null || !(R > 0)) {
    let minEdge = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      minEdge = Math.min(minEdge, pts[i]!.distanceTo(pts[i + 1]!));
    }
    R = Math.max(minEdge * 0.25, 1e-6);
  }

  const out: THREE.Vector3[] = [pts[0]!.clone()];
  for (let i = 1; i < pts.length - 1; i++) {
    const A = pts[i - 1]!;
    const B = pts[i]!;
    const C = pts[i + 1]!;
    const lenIn = B.distanceTo(A);
    const lenOut = C.distanceTo(B);
    if (lenIn < 1e-9 || lenOut < 1e-9) continue;

    const u = A.clone().sub(B).normalize(); // B → A
    const v = C.clone().sub(B).normalize(); // B → C
    const dot = THREE.MathUtils.clamp(u.dot(v), -1, 1);
    // Nearly straight: keep vertex
    if (dot < -CORNER_DOT) {
      out.push(B.clone());
      continue;
    }
    // Folded back on itself: keep
    if (dot > CORNER_DOT && u.cross(v).lengthSq() < 1e-10) {
      out.push(B.clone());
      continue;
    }
    // Skip tiny deflection (same as frame sharp test on path tangents)
    const tin = B.clone().sub(A).normalize();
    const tout = C.clone().sub(B).normalize();
    if (tin.dot(tout) >= CORNER_DOT) {
      out.push(B.clone());
      continue;
    }

    const alpha = Math.acos(dot); // angle at B between u and v
    if (!(alpha > 1e-6) || alpha >= Math.PI - 1e-6) {
      out.push(B.clone());
      continue;
    }

    const maxTrim = Math.min(lenIn, lenOut) * 0.49;

    // round fillet
    const half = alpha / 2;
    const tanHalf = Math.tan(half);
    if (!(tanHalf > 1e-9)) {
      out.push(B.clone());
      continue;
    }
    let t = R / tanHalf; // trim along edges
    let r = R;
    if (t > maxTrim) {
      t = maxTrim;
      r = t * tanHalf;
    }
    const p1 = B.clone().addScaledVector(u, t);
    const p2 = B.clone().addScaledVector(v, t);
    const sinHalf = Math.sin(half);
    if (!(sinHalf > 1e-9)) {
      out.push(B.clone());
      continue;
    }
    const center = B.clone().addScaledVector(
      u.clone().add(v).normalize(),
      r / sinHalf
    );

    // Arc from p1 to p2 around center; angle = π - alpha (turn angle)
    const a0 = p1.clone().sub(center);
    const a1 = p2.clone().sub(center);
    const planeN = new THREE.Vector3().crossVectors(u, v);
    if (planeN.lengthSq() < 1e-12) {
      out.push(p1, p2);
      continue;
    }
    planeN.normalize();
    const ang = Math.acos(
      THREE.MathUtils.clamp(
        a0.clone().normalize().dot(a1.clone().normalize()),
        -1,
        1
      )
    );
    // Orient: rotate a0 toward a1 around planeN
    const cross = new THREE.Vector3().crossVectors(a0, a1);
    const sign = cross.dot(planeN) >= 0 ? 1 : -1;
    const sweep = sign * ang;
    // Dense enough for smooth Gouraud shading on the bend (~4° / segment).
    const segs = Math.max(12, Math.ceil((Math.abs(sweep) * 180) / Math.PI / 4));
    out.push(p1);
    for (let s = 1; s < segs; s++) {
      const fr = s / segs;
      out.push(
        center
          .clone()
          .add(a0.clone().applyAxisAngle(planeN, sweep * fr))
      );
    }
    out.push(p2);
  }
  out.push(pts[pts.length - 1]!.clone());
  return dedupePolyline(out);
}

function projectPerp(v: THREE.Vector3, t: THREE.Vector3): THREE.Vector3 | null {
  const p = v.clone().addScaledVector(t, -v.dot(t));
  return p.lengthSq() > 1e-12 ? p.normalize() : null;
}

/**
 * Section frame at a point: profile (u,v) → n, b; path tangent → t.
 * - frenet: parallel-transport previous frame (banks with the turn)
 * - fixed: IFC FixedReference — profile +u (=n) from projecting refDir
 * - parallel: keep profile +v (=b) aligned with refDir (no bank / Z-up style)
 */
function makeFrame(
  origin: THREE.Vector3,
  t: THREE.Vector3,
  prev: Frame | null,
  orient: string,
  refDir: THREE.Vector3 | null
): Frame {
  let n: THREE.Vector3;
  if (orient === "fixed" && refDir) {
    const projected = projectPerp(refDir, t);
    if (projected) {
      n = projected;
    } else if (prev) {
      n = rotateAlign(prev.n, prev.t, t);
    } else {
      n = initialNormal(t, "frenet", null);
    }
  } else if (orient === "parallel" && refDir) {
    // b ≈ refDir (projected); n = up × t so that t×n = up after ortho.
    const up = projectPerp(refDir, t);
    if (up) {
      n = new THREE.Vector3().crossVectors(up, t).normalize();
    } else if (prev) {
      n = rotateAlign(prev.n, prev.t, t);
    } else {
      n = initialNormal(t, "frenet", null);
    }
  } else if (prev) {
    n = rotateAlign(prev.n, prev.t, t);
  } else {
    n = initialNormal(t, orient, refDir);
  }
  let b = new THREE.Vector3().crossVectors(t, n).normalize();
  if (b.lengthSq() < 1e-12) {
    // Degenerate n∥t — rebuild from a world axis.
    n = initialNormal(t, "frenet", null);
    b = new THREE.Vector3().crossVectors(t, n).normalize();
  }
  n = new THREE.Vector3().crossVectors(b, t).normalize();
  // Keep frame chirality continuous — prevents ±b flips at fixed-ref singularities
  // (refDir nearly parallel to tangent), which otherwise double the height AABB
  // and make `fixed` look like a thick upright wall similar to `frenet`.
  if (prev && b.dot(prev.b) < 0) {
    b.negate();
    n.negate();
  }
  return { origin: origin.clone(), t: t.clone(), n, b };
}

/**
 * Frames along a polyline.
 * - round: dense samples, single frames (smooth normals)
 * - bevel / miter: dual frames with bevelSeam (bevel fill / miter join)
 */
function buildFrames(
  path: THREE.Vector3[],
  orient: string,
  refDir: THREE.Vector3 | null,
  corner: string = "round"
): Frame[] {
  const pts = dedupePolyline(path);
  if (pts.length < 2) return [];

  const frames: Frame[] = [];
  const tFirst = pts[1]!.clone().sub(pts[0]!).normalize();
  frames.push(makeFrame(pts[0]!, tFirst, null, orient, refDir));

  for (let i = 1; i < pts.length; i++) {
    const prev = frames[frames.length - 1]!;
    if (i === pts.length - 1) {
      const t = pts[i]!.clone().sub(pts[i - 1]!).normalize();
      frames.push(makeFrame(pts[i]!, t, prev, orient, refDir));
      continue;
    }

    const tin = pts[i]!.clone().sub(pts[i - 1]!).normalize();
    const tout = pts[i + 1]!.clone().sub(pts[i]!).normalize();
    const kink = tin.dot(tout) < CORNER_DOT;

    if (kink && (corner === "bevel" || corner === "miter")) {
      frames.push(makeFrame(pts[i]!, tin, prev, orient, refDir));
      const afterIn = frames[frames.length - 1]!;
      const out = makeFrame(pts[i]!, tout, afterIn, orient, refDir);
      out.bevelSeam = true;
      frames.push(out);
    } else {
      const sum = tin.clone().add(tout);
      const t =
        sum.lengthSq() < 1e-12 ? tout.clone() : sum.normalize();
      frames.push(makeFrame(pts[i]!, t, prev, orient, refDir));
    }
  }

  return frames;
}

function sectionPoint(frame: Frame, uv: THREE.Vector2): THREE.Vector3 {
  return frame.origin
    .clone()
    .addScaledVector(frame.n, uv.x)
    .addScaledVector(frame.b, uv.y);
}

/** Outward normal of a CCW 2D edge (viewed along +t). */
function edgeOutward2D(a: THREE.Vector2, b: THREE.Vector2): THREE.Vector2 {
  const e = new THREE.Vector2().subVectors(b, a);
  const n = new THREE.Vector2(e.y, -e.x);
  return n.lengthSq() > 1e-20 ? n.normalize() : new THREE.Vector2(1, 0);
}

/** Map a 2D section normal into the path frame. */
function frameNormal(frame: Frame, n2: THREE.Vector2): THREE.Vector3 {
  return new THREE.Vector3()
    .addScaledVector(frame.n, n2.x)
    .addScaledVector(frame.b, n2.y)
    .normalize();
}

/**
 * Closest-point midpoint of two rulings (Pa∥tin and Pb∥tout).
 * For planar corners this is the true wall-wall miter intersection.
 */
function miterPoint(
  Pa: THREE.Vector3,
  tin: THREE.Vector3,
  Pb: THREE.Vector3,
  tout: THREE.Vector3
): THREE.Vector3 {
  const d1 = tin.clone().normalize();
  const d2 = tout.clone().normalize();
  const w0 = Pa.clone().sub(Pb);
  const a = d1.dot(d1);
  const b = d1.dot(d2);
  const c = d2.dot(d2);
  const d = d1.dot(w0);
  const e = d2.dot(w0);
  const denom = a * c - b * b;
  if (Math.abs(denom) < 1e-14) {
    return Pa.clone().add(Pb).multiplyScalar(0.5);
  }
  const t = (b * e - c * d) / denom;
  const s = (a * e - b * d) / denom;
  const q1 = Pa.clone().addScaledVector(d1, t);
  const q2 = Pb.clone().addScaledVector(d2, s);
  return q1.add(q2).multiplyScalar(0.5);
}

/**
 * Profile vertex on the convex (outer) side of a path turn?
 * `tin+tout` points to the convex diagonal; the fillet center lies opposite.
 * On the incoming section, outer offsets therefore have negative dot with
 * `tin+tout` (e.g. +X→+Z: convex=(1,0,1), outer≈−Z, inner≈+Z).
 */
function isOutsideVertex(
  offset: THREE.Vector3,
  tin: THREE.Vector3,
  tout: THREE.Vector3
): boolean {
  const convex = tin.clone().add(tout);
  if (convex.lengthSq() < 1e-12) return true;
  return offset.dot(convex) < 1e-10;
}

function miterLengthOk(
  M: THREE.Vector3,
  C: THREE.Vector3,
  Pa: THREE.Vector3,
  limit: number
): boolean {
  const base = Pa.distanceTo(C);
  if (base < 1e-10) return true;
  return M.distanceTo(C) <= base * limit + 1e-6;
}

/** Join style for one side of a bend (`miter` vs bevel-like). */
function joinModeForSide(corner: string): "bevel" | "miter" {
  return corner === "miter" ? "miter" : "bevel";
}

/**
 * Resolve one profile vertex across a dual-frame corner.
 * Outer (convex) and inner (concave) sides may use different join modes —
 * same split as common CAD / Blender Bevel outer·inner miters.
 * - miter: wall-wall intersection (miter limit → bevel fallback)
 * - bevel / round (when not path-filleted): outer keeps both section ends (fill patch);
 *   inner collapses to the wall intersection so volumes don't overlap.
 */
function joinProfileVertex(
  fin: Frame,
  fout: Frame,
  uv: THREE.Vector2,
  outerCorner: string,
  innerCorner: string,
  miterLimit: number
): { pin: THREE.Vector3; pout: THREE.Vector3 } {
  const Pa = sectionPoint(fin, uv);
  const Pb = sectionPoint(fout, uv);
  const C = fin.origin;
  const offset = Pa.clone().sub(C);
  const outside = isOutsideVertex(offset, fin.t, fout.t);
  const M = miterPoint(Pa, fin.t, Pb, fout.t);
  const mode = joinModeForSide(outside ? outerCorner : innerCorner);

  if (mode === "miter") {
    if (miterLengthOk(M, C, Pa, miterLimit)) {
      return { pin: M.clone(), pout: M.clone() };
    }
    return { pin: Pa, pout: Pb };
  }

  // bevel-like: inner → miter collapse; outer → keep both ends
  if (!outside && miterLengthOk(M, C, Pa, miterLimit * 2)) {
    return { pin: M.clone(), pout: M.clone() };
  }
  return { pin: Pa, pout: Pb };
}

/** Resolved outer / inner corner types (+ radii) for a sweep / pipe. */
export type CornerSides = {
  outer: string;
  inner: string;
  outerRadius: number | undefined;
  innerRadius: number | undefined;
};

function readCornerToken(raw: Value | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.trim().toLowerCase();
  return s || undefined;
}

function readCornerRadius(raw: Value | undefined): number | undefined {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : undefined;
  }
  if (raw == null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Resolve outer/inner corner attrs (default each side to `round`). */
export function resolveCornerSides(
  outerCornerRaw?: Value | undefined,
  innerCornerRaw?: Value | undefined,
  outerCornerRadiusRaw?: Value | undefined,
  innerCornerRadiusRaw?: Value | undefined
): CornerSides {
  return {
    outer: readCornerToken(outerCornerRaw) ?? "round",
    inner: readCornerToken(innerCornerRaw) ?? "round",
    outerRadius: readCornerRadius(outerCornerRadiusRaw),
    innerRadius: readCornerRadius(innerCornerRadiusRaw),
  };
}

/**
 * When both sides are `round`, fillet the centerline.
 * Otherwise keep path kinks and join per-side in profile space.
 */
function pathShapeFromSides(
  sides: CornerSides
): { mode: string; radius: number | undefined } | null {
  if (sides.outer === sides.inner && sides.outer === "round") {
    return {
      mode: "round",
      radius: sides.outerRadius ?? sides.innerRadius,
    };
  }
  return null;
}

/** Bisector section frame between two same-origin frames (for chamfer crease). */
function bisectorFrame(fin: Frame, fout: Frame): Frame {
  const sum = fin.t.clone().add(fout.t);
  const t =
    sum.lengthSq() < 1e-12 ? fout.t.clone() : sum.normalize();
  const n = rotateAlign(fin.n, fin.t, t);
  let b = new THREE.Vector3().crossVectors(t, n).normalize();
  const nOrtho = new THREE.Vector3().crossVectors(b, t).normalize();
  if (b.dot(fin.b) < 0) {
    b.negate();
    nOrtho.negate();
  }
  return { origin: fin.origin.clone(), t, n: nOrtho, b };
}

/**
 * Expand frames → slots with corner joins applied.
 * - bevelSeam: outer/inner join (sharp/miter; sides may differ)
 * - creaseSeam: shared bisector ring, dual normals (chamfer hard edge)
 */
function buildSlots(
  frames: Frame[],
  ring: THREE.Vector2[],
  outerCorner: string,
  innerCorner: string,
  miterLimit: number
): Slot[] {
  const slots: Slot[] = [];
  for (let i = 0; i < frames.length; ) {
    const f0 = frames[i]!;
    const f1 = frames[i + 1];
    if (f1?.bevelSeam) {
      const pin: THREE.Vector3[] = [];
      const pout: THREE.Vector3[] = [];
      for (const uv of ring) {
        const j = joinProfileVertex(
          f0,
          f1,
          uv,
          outerCorner,
          innerCorner,
          miterLimit
        );
        pin.push(j.pin);
        pout.push(j.pout);
      }
      slots.push({ pos: pin, frame: f0 });
      slots.push({ pos: pout, frame: f1 });
      i += 2;
    } else if (f1?.creaseSeam) {
      const pos = ring.map((uv) => sectionPoint(bisectorFrame(f0, f1), uv));
      slots.push({ pos, frame: f0 });
      slots.push({
        pos: pos.map((p) => p.clone()),
        frame: f1,
      });
      i += 2;
    } else {
      slots.push({
        pos: ring.map((uv) => sectionPoint(f0, uv)),
        frame: f0,
      });
      i += 1;
    }
  }
  return slots;
}

const COLLAPSE_EPS2 = 1e-16;

/** Flat-shaded tri (unique verts + face normal) — used for sharp bevel patches. */
function appendFlatTri(
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  positions: number[],
  normals: number[],
  indices: number[]
): void {
  const n = new THREE.Vector3()
    .subVectors(b, a)
    .cross(new THREE.Vector3().subVectors(c, a));
  if (n.lengthSq() < 1e-20) return;
  n.normalize();
  const base = positions.length / 3;
  for (const p of [a, b, c]) {
    positions.push(p.x, p.y, p.z);
    normals.push(n.x, n.y, n.z);
  }
  indices.push(base, base + 1, base + 2);
}

/**
 * Sharp/miter outer fill between a dual-frame pair — flat face normals so the
 * corner reads as a hard crease, not a rounded Gouraud blend.
 */
function appendFlatBevelBetween(
  s0: Slot,
  s1: Slot,
  ring: THREE.Vector2[],
  positions: number[],
  normals: number[],
  indices: number[],
  reverse = false
): void {
  const m = ring.length;
  for (let j = 0; j < m; j++) {
    const j1 = (j + 1) % m;
    const a0 = s0.pos[j]!;
    const a1 = s0.pos[j1]!;
    const b0 = s1.pos[j]!;
    const b1 = s1.pos[j1]!;
    const collapse0 = a0.distanceToSquared(b0) < COLLAPSE_EPS2;
    const collapse1 = a1.distanceToSquared(b1) < COLLAPSE_EPS2;
    if (collapse0 && collapse1) continue;

    if (reverse) {
      if (collapse0 && !collapse1) appendFlatTri(a1, b1, a0, positions, normals, indices);
      else if (collapse1 && !collapse0) appendFlatTri(a0, a1, b0, positions, normals, indices);
      else {
        appendFlatTri(a1, a0, b0, positions, normals, indices);
        appendFlatTri(a1, b0, b1, positions, normals, indices);
      }
    } else if (collapse0 && !collapse1) {
      appendFlatTri(a1, b1, a0, positions, normals, indices);
    } else if (collapse1 && !collapse0) {
      appendFlatTri(a0, a1, b0, positions, normals, indices);
    } else {
      appendFlatTri(a0, a1, b1, positions, normals, indices);
      appendFlatTri(a0, b1, b0, positions, normals, indices);
    }
  }
}

/**
 * Smooth path-frame strip over a contiguous run of slots (no bevel seam inside).
 * Hard crease across section corners; smooth along arc bends.
 */
function appendSmoothSlotRun(
  slots: Slot[],
  ring: THREE.Vector2[],
  positions: number[],
  normals: number[],
  indices: number[],
  reverse = false
): void {
  const m = ring.length;
  const S = slots.length;
  if (S < 2 || m < 2) return;

  for (let j = 0; j < m; j++) {
    const j1 = (j + 1) % m;
    const n2 = edgeOutward2D(ring[j]!, ring[j1]!);
    const base = positions.length / 3;

    for (let i = 0; i < S; i++) {
      const slot = slots[i]!;
      const p0 = slot.pos[j]!;
      const p1 = slot.pos[j1]!;
      const n = frameNormal(slot.frame, n2);
      if (reverse) {
        positions.push(p1.x, p1.y, p1.z, p0.x, p0.y, p0.z);
        normals.push(-n.x, -n.y, -n.z, -n.x, -n.y, -n.z);
      } else {
        positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
        normals.push(n.x, n.y, n.z, n.x, n.y, n.z);
      }
    }

    for (let i = 0; i < S - 1; i++) {
      const a = base + i * 2;
      const b = a + 1;
      const c = a + 3;
      const d = a + 2;
      indices.push(a, b, c, a, c, d);
    }
  }
}

/**
 * Side walls from resolved slots.
 * - bevelSeam: flat fill patch (sharp)
 * - creaseSeam: split normals only (chamfer) — no extra face
 * - otherwise: smooth path-frame strip
 */
function appendSlottedSideStrips(
  slots: Slot[],
  ring: THREE.Vector2[],
  positions: number[],
  normals: number[],
  indices: number[],
  reverse = false
): void {
  const S = slots.length;
  if (S < 2 || ring.length < 2) return;

  let runStart = 0;
  for (let i = 1; i <= S; i++) {
    const atBevel = i < S && !!slots[i]!.frame.bevelSeam;
    const atCrease = i < S && !!slots[i]!.frame.creaseSeam;
    const atEnd = i === S;
    if (!atBevel && !atCrease && !atEnd) continue;

    // Smooth run covering slots[runStart .. i) (ends at fin before a seam).
    if (i - runStart >= 2) {
      appendSmoothSlotRun(
        slots.slice(runStart, i),
        ring,
        positions,
        normals,
        indices,
        reverse
      );
    }
    if (atBevel) {
      appendFlatBevelBetween(
        slots[i - 1]!,
        slots[i]!,
        ring,
        positions,
        normals,
        indices,
        reverse
      );
    }
    // creaseSeam: no fill — duplicated ring with different normals is enough
    if (atBevel || atCrease) runStart = i;
  }
}

/**
 * Pipe / tube walls: same seam split as sweep sides.
 */
function appendSlottedRadialWall(
  slots: Slot[],
  ringLen: number,
  positions: number[],
  normals: number[],
  indices: number[],
  inward: boolean
): void {
  const S = slots.length;
  if (S < 2 || ringLen < 3) return;

  const appendRadialRun = (run: Slot[]) => {
    const R = run.length;
    if (R < 2) return;
    const base = positions.length / 3;
    for (let i = 0; i < R; i++) {
      const slot = run[i]!;
      const C = slot.frame.origin;
      for (let j = 0; j < ringLen; j++) {
        const p = slot.pos[j]!;
        const n = inward
          ? C.clone().sub(p).normalize()
          : p.clone().sub(C).normalize();
        positions.push(p.x, p.y, p.z);
        normals.push(n.x, n.y, n.z);
      }
    }
    for (let i = 0; i < R - 1; i++) {
      for (let j = 0; j < ringLen; j++) {
        const j1 = (j + 1) % ringLen;
        const a = base + i * ringLen + j;
        const b = base + i * ringLen + j1;
        const c = base + (i + 1) * ringLen + j1;
        const d = base + (i + 1) * ringLen + j;
        if (inward) indices.push(a, d, c, a, c, b);
        else indices.push(a, b, c, a, c, d);
      }
    }
  };

  const flatRing = Array.from({ length: ringLen }, (_, j) => {
    const a = (j / ringLen) * Math.PI * 2;
    return new THREE.Vector2(Math.cos(a), Math.sin(a));
  });

  let runStart = 0;
  for (let i = 1; i <= S; i++) {
    const atBevel = i < S && !!slots[i]!.frame.bevelSeam;
    const atCrease = i < S && !!slots[i]!.frame.creaseSeam;
    const atEnd = i === S;
    if (!atBevel && !atCrease && !atEnd) continue;
    if (i - runStart >= 2) appendRadialRun(slots.slice(runStart, i));
    if (atBevel) {
      appendFlatBevelBetween(
        slots[i - 1]!,
        slots[i]!,
        flatRing,
        positions,
        normals,
        indices,
        inward
      );
    }
    if (atBevel || atCrease) runStart = i;
  }
}

/**
 * Build a swept solid (or open shell) from a 2D section along a 3D polyline.
 * Outer / inner corner types may differ (CAD-style); equal `round`
 * still fillets the centerline. Mixed or bevel/miter keeps path kinks and
 * joins each profile vertex by the side it lies on.
 */
export function buildSweepGeometry(
  sectionVal: Value | undefined,
  pathVal: Value | undefined,
  orientRaw: Value | undefined,
  refDirVal: Value | undefined,
  solidRaw: Value | undefined,
  outerCornerRaw?: Value | undefined,
  innerCornerRaw?: Value | undefined,
  outerCornerRadiusRaw?: Value | undefined,
  innerCornerRadiusRaw?: Value | undefined,
  miterLimitRaw?: Value | undefined
): THREE.BufferGeometry | null {
  const profile = parseProfile(sectionVal);
  const rawPts = pathToPoints(pathVal);
  if (!profile || rawPts.length < 2) return null;

  const orient =
    typeof orientRaw === "string" ? orientRaw.toLowerCase() : "frenet";
  const solid = solidRaw === false || solidRaw === "false" ? false : true;
  const sides = resolveCornerSides(
    outerCornerRaw,
    innerCornerRaw,
    outerCornerRadiusRaw,
    innerCornerRadiusRaw
  );
  const miterLimit = resolveMiterLimit(miterLimitRaw);

  let refDir: THREE.Vector3 | null = null;
  const refNums = flattenNumbers(refDirVal);
  if (refNums.length >= 3) {
    refDir = new THREE.Vector3(refNums[0]!, refNums[1]!, refNums[2]!);
    if (refDir.lengthSq() < 1e-12) refDir = null;
    else refDir.normalize();
  }

  const shaped = pathShapeFromSides(sides);
  const pathPts = shaped
    ? applyPathCorners(rawPts, shaped.mode, shaped.radius)
    : dedupePolyline(rawPts);
  // Equal round → shaped path; otherwise dual-frame joins at kinks.
  const frameStyle = shaped ? shaped.mode : "bevel";
  const frames = buildFrames(pathPts, orient, refDir, frameStyle);
  if (frames.length < 2) return null;

  const ring = profile.ring;
  const m = ring.length;
  const slots = buildSlots(
    frames,
    ring,
    sides.outer,
    sides.inner,
    miterLimit
  );
  if (slots.length < 2) return null;

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  appendSlottedSideStrips(slots, ring, positions, normals, indices);

  if (solid) {
    const s0 = slots[0]!;
    const o0 = s0.frame.origin.clone();
    for (let j = 0; j < m; j++) {
      const j1 = (j + 1) % m;
      appendFlatTri(
        o0,
        s0.pos[j1]!,
        s0.pos[j]!,
        positions,
        normals,
        indices
      );
    }
    const sN = slots[slots.length - 1]!;
    const oN = sN.frame.origin.clone();
    for (let j = 0; j < m; j++) {
      const j1 = (j + 1) % m;
      appendFlatTri(
        oN,
        sN.pos[j]!,
        sN.pos[j1]!,
        positions,
        normals,
        indices
      );
    }
  }

  if (positions.length === 0) return null;

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geom.setIndex(indices);
  return geom;
}

function circleRing(radius: number, segs = 32): THREE.Vector2[] {
  const ring: THREE.Vector2[] = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    ring.push(new THREE.Vector2(Math.cos(a) * radius, Math.sin(a) * radius));
  }
  return ring;
}

/**
 * Swept disk / hollow pipe along a polyline (spec `s3dx:pipe`).
 * Section always perpendicular to path tangent (frenet transport).
 */
export function buildPipeGeometry(
  radius: number,
  innerRadius: number | undefined,
  pathVal: Value | undefined,
  outerCornerRaw?: Value | undefined,
  innerCornerRaw?: Value | undefined,
  outerCornerRadiusRaw?: Value | undefined,
  innerCornerRadiusRaw?: Value | undefined,
  miterLimitRaw?: Value | undefined
): THREE.BufferGeometry | null {
  const R = Math.max(radius, 1e-6);
  const rawPts = pathToPoints(pathVal);
  if (rawPts.length < 2) return null;

  const sides = resolveCornerSides(
    outerCornerRaw,
    innerCornerRaw,
    outerCornerRadiusRaw,
    innerCornerRadiusRaw
  );
  const miterLimit = resolveMiterLimit(miterLimitRaw);
  const shaped = pathShapeFromSides(sides);
  const pathPts = shaped
    ? applyPathCorners(rawPts, shaped.mode, shaped.radius)
    : dedupePolyline(rawPts);
  const frameStyle = shaped ? shaped.mode : "bevel";
  const frames = buildFrames(pathPts, "frenet", null, frameStyle);
  if (frames.length < 2) return null;

  const hasInner =
    innerRadius != null &&
    Number.isFinite(innerRadius) &&
    innerRadius > 1e-6 &&
    innerRadius < R - 1e-6;
  const ri = hasInner ? (innerRadius as number) : 0;

  const outer = circleRing(R);
  const inner = hasInner ? circleRing(ri) : null;
  const m = outer.length;
  const outerSlots = buildSlots(
    frames,
    outer,
    sides.outer,
    sides.inner,
    miterLimit
  );
  if (outerSlots.length < 2) return null;

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  appendSlottedRadialWall(
    outerSlots,
    m,
    positions,
    normals,
    indices,
    false
  );

  if (inner) {
    const innerSlots = buildSlots(
      frames,
      inner,
      sides.outer,
      sides.inner,
      miterLimit
    );
    appendSlottedRadialWall(
      innerSlots,
      m,
      positions,
      normals,
      indices,
      true
    );
    const s0 = outerSlots[0]!;
    const sN = outerSlots[outerSlots.length - 1]!;
    const i0s = innerSlots[0]!;
    const iNs = innerSlots[innerSlots.length - 1]!;
    for (let j = 0; j < m; j++) {
      const j1 = (j + 1) % m;
      appendFlatTri(
        s0.pos[j]!,
        i0s.pos[j]!,
        i0s.pos[j1]!,
        positions,
        normals,
        indices
      );
      appendFlatTri(
        s0.pos[j]!,
        i0s.pos[j1]!,
        s0.pos[j1]!,
        positions,
        normals,
        indices
      );
      appendFlatTri(
        sN.pos[j]!,
        sN.pos[j1]!,
        iNs.pos[j1]!,
        positions,
        normals,
        indices
      );
      appendFlatTri(
        sN.pos[j]!,
        iNs.pos[j1]!,
        iNs.pos[j]!,
        positions,
        normals,
        indices
      );
    }
  } else {
    const s0 = outerSlots[0]!;
    const o0 = s0.frame.origin.clone();
    for (let j = 0; j < m; j++) {
      const j1 = (j + 1) % m;
      appendFlatTri(
        o0,
        s0.pos[j1]!,
        s0.pos[j]!,
        positions,
        normals,
        indices
      );
    }
    const sN = outerSlots[outerSlots.length - 1]!;
    const oN = sN.frame.origin.clone();
    for (let j = 0; j < m; j++) {
      const j1 = (j + 1) % m;
      appendFlatTri(
        oN,
        sN.pos[j]!,
        sN.pos[j1]!,
        positions,
        normals,
        indices
      );
    }
  }

  if (positions.length === 0) return null;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geom.setIndex(indices);
  return geom;
}
