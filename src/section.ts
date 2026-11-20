import * as THREE from "three";
import type { Value } from "./types.js";

export type Section2D = {
  /** Closed or open polyline in section (u,v); first ≠ last when closed. */
  ring: THREE.Vector2[];
  closed: boolean;
};

type Pose = {
  origin: THREE.Vector3;
  normal: THREE.Vector3;
  xDir: THREE.Vector3;
};

function num(v: Value | undefined, fallback = 0): number {
  return typeof v === "number" ? v : fallback;
}

function asMap(v: Value | undefined): Record<string, Value> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, Value>;
}

function vec3FromValue(
  v: Value | undefined,
  fallback: [number, number, number]
): THREE.Vector3 {
  if (Array.isArray(v) && v.length >= 3) {
    return new THREE.Vector3(Number(v[0]), Number(v[1]), Number(v[2]));
  }
  if (ArrayBuffer.isView(v) && (v as ArrayLike<number>).length >= 3) {
    const a = v as ArrayLike<number>;
    return new THREE.Vector3(Number(a[0]), Number(a[1]), Number(a[2]));
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

/** Build orthonormal frame: X̂ from xDir ∟ N̂, Ŷ = N̂ × X̂. */
export function sectionFrame(
  origin: THREE.Vector3,
  normal: THREE.Vector3,
  xDir: THREE.Vector3
): { origin: THREE.Vector3; x: THREE.Vector3; y: THREE.Vector3; n: THREE.Vector3 } {
  const n = normal.clone();
  if (n.lengthSq() < 1e-12) n.set(0, 0, 1);
  else n.normalize();

  let x = xDir.clone();
  x.addScaledVector(n, -x.dot(n));
  if (x.lengthSq() < 1e-12) {
    x = Math.abs(n.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    x.addScaledVector(n, -x.dot(n));
  }
  x.normalize();
  const y = new THREE.Vector3().crossVectors(n, x).normalize();
  return { origin: origin.clone(), x, y, n };
}

function resolvePose(
  section: Record<string, Value>,
  parent?: Partial<Pose>
): Pose {
  return {
    origin: vec3FromValue(
      section.origin,
      parent?.origin
        ? [parent.origin.x, parent.origin.y, parent.origin.z]
        : [0, 0, 0]
    ),
    normal: vec3FromValue(
      section.normal,
      parent?.normal
        ? [parent.normal.x, parent.normal.y, parent.normal.z]
        : [0, 0, 1]
    ),
    xDir: vec3FromValue(
      section.xDir,
      parent?.xDir
        ? [parent.xDir.x, parent.xDir.y, parent.xDir.z]
        : [1, 0, 0]
    ),
  };
}

/** Minimal SVG path subset: M/L/H/V/Z (+ relative). */
export function parseSvgPath2D(d: string): { points: THREE.Vector2[]; closed: boolean } {
  const points: THREE.Vector2[] = [];
  let closed = false;
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;

  const tokens = d.match(/[MmLlHhVvZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  let i = 0;
  let cmd = "M";

  const readNum = (): number => {
    const t = tokens[i++];
    return t != null ? Number(t) : 0;
  };

  const push = (x: number, y: number) => {
    cx = x;
    cy = y;
    const last = points[points.length - 1];
    if (last && last.distanceToSquared(new THREE.Vector2(x, y)) < 1e-16) return;
    points.push(new THREE.Vector2(x, y));
  };

  while (i < tokens.length) {
    const t = tokens[i]!;
    if (/^[MmLlHhVvZz]$/.test(t)) {
      cmd = t;
      i++;
    }

    switch (cmd) {
      case "M":
      case "m": {
        const rel = cmd === "m";
        const x = readNum();
        const y = readNum();
        const nx = rel ? cx + x : x;
        const ny = rel ? cy + y : y;
        push(nx, ny);
        startX = nx;
        startY = ny;
        cmd = rel ? "l" : "L";
        break;
      }
      case "L":
      case "l": {
        const rel = cmd === "l";
        const x = readNum();
        const y = readNum();
        push(rel ? cx + x : x, rel ? cy + y : y);
        break;
      }
      case "H":
      case "h": {
        const rel = cmd === "h";
        const x = readNum();
        push(rel ? cx + x : x, cy);
        break;
      }
      case "V":
      case "v": {
        const rel = cmd === "v";
        const y = readNum();
        push(cx, rel ? cy + y : y);
        break;
      }
      case "Z":
      case "z": {
        closed = true;
        cx = startX;
        cy = startY;
        break;
      }
      default:
        // Skip unknown numeric junk
        i++;
        break;
    }
  }

  if (
    points.length >= 2 &&
    points[0]!.distanceToSquared(points[points.length - 1]!) < 1e-12
  ) {
    points.pop();
    closed = true;
  }
  return { points, closed };
}

function shapeToPolyline2D(
  shape: Record<string, Value>,
  circleSegs: number
): { points: THREE.Vector2[]; closed: boolean } | null {
  const tag = typeof shape.tag === "string" ? shape.tag : "";

  if (tag === "path") {
    const d = typeof shape.d === "string" ? shape.d : "";
    if (!d) return null;
    const parsed = parseSvgPath2D(d);
    return parsed.points.length >= 2 ? parsed : null;
  }

  if (tag === "circle") {
    const cx = num(shape.cx);
    const cy = num(shape.cy);
    const r = num(shape.r, 1);
    const points: THREE.Vector2[] = [];
    for (let i = 0; i < circleSegs; i++) {
      const a = (i / circleSegs) * Math.PI * 2;
      points.push(new THREE.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
    }
    return { points, closed: true };
  }

  if (tag === "ellipse") {
    const cx = num(shape.cx);
    const cy = num(shape.cy);
    const rx = num(shape.rx, 1);
    const ry = num(shape.ry, rx);
    const points: THREE.Vector2[] = [];
    for (let i = 0; i < circleSegs; i++) {
      const a = (i / circleSegs) * Math.PI * 2;
      points.push(new THREE.Vector2(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry));
    }
    return { points, closed: true };
  }

  if (tag === "rect") {
    const x = num(shape.x);
    const y = num(shape.y);
    const w = num(shape.width, 1);
    const h = num(shape.height, 1);
    return {
      points: [
        new THREE.Vector2(x, y),
        new THREE.Vector2(x + w, y),
        new THREE.Vector2(x + w, y + h),
        new THREE.Vector2(x, y + h),
      ],
      closed: true,
    };
  }

  if (tag === "polygon" || tag === "polyline") {
    const flat: number[] = [];
    const pts = shape.points;
    if (typeof pts === "string") {
      for (const p of pts.trim().split(/[\s,]+/)) {
        const n = Number(p);
        if (Number.isFinite(n)) flat.push(n);
      }
    } else if (Array.isArray(pts)) {
      for (const x of pts) {
        if (typeof x === "number") flat.push(x);
      }
    }
    const points: THREE.Vector2[] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) {
      points.push(new THREE.Vector2(flat[i]!, flat[i + 1]!));
    }
    if (points.length < 2) return null;
    let closed = tag === "polygon";
    if (
      points.length >= 2 &&
      points[0]!.distanceToSquared(points[points.length - 1]!) < 1e-12
    ) {
      points.pop();
      closed = true;
    }
    return { points, closed };
  }

  return null;
}

export type Section2DParsed = Section2D & {
  /** Shape tag (`path` / `circle` / …). */
  tag: string;
};

export type SectionPolyline3D = {
  points: THREE.Vector3[];
  closed: boolean;
  tag: string;
};

/** All SVG shapes in a core `section` map → 2D polylines (document order). */
export function parseSectionShapes2D(
  sectionVal: Value | undefined,
  circleSegs = 32
): Section2DParsed[] {
  const map = asMap(sectionVal);
  if (!map) return [];
  const shapes = map.shapes;
  if (!Array.isArray(shapes) || shapes.length === 0) return [];
  const out: Section2DParsed[] = [];
  for (const raw of shapes) {
    const shape = asMap(raw as Value);
    if (!shape) continue;
    const poly = shapeToPolyline2D(shape, circleSegs);
    if (!poly || poly.points.length < 2) continue;
    const tag = typeof shape.tag === "string" ? shape.tag : "";
    out.push({ ring: poly.points, closed: poly.closed, tag });
  }
  return out;
}

/** First SVG shape in a core `section` map → 2D polyline. */
export function parseSection2D(
  sectionVal: Value | undefined,
  circleSegs = 32
): Section2DParsed | null {
  return parseSectionShapes2D(sectionVal, circleSegs)[0] ?? null;
}

function mapShapeToPolyline3D(
  sec2d: Section2DParsed,
  pose: Pose,
  forceClosed: boolean
): SectionPolyline3D | null {
  const frame = sectionFrame(pose.origin, pose.normal, pose.xDir);
  const points = sec2d.ring.map((uv) =>
    frame.origin.clone().addScaledVector(frame.x, uv.x).addScaledVector(frame.y, uv.y)
  );
  let closed = sec2d.closed || forceClosed;
  if (
    points.length >= 2 &&
    points[0]!.distanceToSquared(points[points.length - 1]!) < 1e-12
  ) {
    points.pop();
    closed = true;
  }
  return points.length >= 2
    ? { points, closed, tag: sec2d.tag }
    : null;
}

/**
 * Resolve `<s3dx:section>` (+ optional parent pose) to 3D polylines
 * (one per 2D shape, document order). When `forceClosed`, treat as rings.
 */
export function sectionToPolylines3D(
  sectionVal: Value | undefined,
  parentPose?: Partial<Pose>,
  opts?: { circleSegs?: number; forceClosed?: boolean }
): SectionPolyline3D[] {
  const map = asMap(sectionVal);
  if (!map) return [];
  const shapes = parseSectionShapes2D(sectionVal, opts?.circleSegs ?? 32);
  if (!shapes.length) return [];
  const pose = resolvePose(map, parentPose);
  const forceClosed = !!opts?.forceClosed;
  const out: SectionPolyline3D[] = [];
  for (const s of shapes) {
    const poly = mapShapeToPolyline3D(s, pose, forceClosed);
    if (poly) out.push(poly);
  }
  return out;
}

/**
 * Default revolve section `s3dx:transform` (no translation):
 * `matrix(1 0 0  0 0 1  0 -1 0  0 0 0)` — section-local XY → body XOZ
 * `(u,v,0) → (u, 0, v)`. Identity would leave the section on XY (⊥ body Z) → invalid.
 */
export const REVOLVE_DEFAULT_SECTION_XF = [
  1, 0, 0, 0, 0, 1, 0, -1, 0, 0, 0, 0,
] as const;

/** Standard section-local XY (used before the revolve default orientation xf). */
const SECTION_XY_POSE: Pose = {
  origin: new THREE.Vector3(0, 0, 0),
  normal: new THREE.Vector3(0, 0, 1),
  xDir: new THREE.Vector3(1, 0, 0),
};

const BODY_Z = new THREE.Vector3(0, 0, 1);

function sectionTransformMatrix(section: Record<string, Value>): THREE.Matrix4 | null {
  const xf = section.transform;
  if (!xf) return null;
  if (Array.isArray(xf) && xf.length >= 12) {
    return mat4x3FromList(xf as number[]);
  }
  const map = asMap(xf as Value);
  if (map && Array.isArray(map.m) && (map.m as number[]).length >= 12) {
    return mat4x3FromList(map.m as number[]);
  }
  return null;
}

function mat4x3FromList(m: ArrayLike<number>): THREE.Matrix4 {
  const mat = new THREE.Matrix4();
  mat.set(
    Number(m[0]), Number(m[3]), Number(m[6]), Number(m[9]),
    Number(m[1]), Number(m[4]), Number(m[7]), Number(m[10]),
    Number(m[2]), Number(m[5]), Number(m[8]), Number(m[11]),
    0, 0, 0, 1
  );
  return mat;
}

/**
 * Revolve: map section shapes into body-local space.
 * Plane must be parallel to body +Z after pose + transform; else invalid → [].
 * If neither pose attrs nor transform are set, inject REVOLVE_DEFAULT_SECTION_XF.
 */
export function sectionToRevolvePolylines3D(
  sectionVal: Value | undefined,
  opts?: { circleSegs?: number; forceClosed?: boolean }
): SectionPolyline3D[] {
  const map = asMap(sectionVal);
  if (!map) return [];
  const shapes = parseSectionShapes2D(sectionVal, opts?.circleSegs ?? 32);
  if (!shapes.length) return [];

  const hasPoseAttr =
    map.origin !== undefined || map.normal !== undefined || map.xDir !== undefined;
  const userXf = sectionTransformMatrix(map);
  const pose = resolvePose(map, SECTION_XY_POSE);
  const frame = sectionFrame(pose.origin, pose.normal, pose.xDir);

  // Unset everything → default XOZ orientation. Explicit pose without xf → identity xf.
  const xf =
    userXf ??
    (hasPoseAttr
      ? null
      : mat4x3FromList(REVOLVE_DEFAULT_SECTION_XF));

  // Transformed normal must be ⊥ body Z (plane ∥ Z).
  const nWorld = frame.n.clone();
  if (xf) nWorld.transformDirection(xf);
  if (Math.abs(nWorld.dot(BODY_Z)) > 1e-6) return [];

  const forceClosed = !!opts?.forceClosed;
  const out: SectionPolyline3D[] = [];
  for (const s of shapes) {
    const points = s.ring.map((uv) => {
      const p = frame.origin
        .clone()
        .addScaledVector(frame.x, uv.x)
        .addScaledVector(frame.y, uv.y);
      if (xf) p.applyMatrix4(xf);
      return p;
    });
    let closed = s.closed || forceClosed;
    if (
      points.length >= 2 &&
      points[0]!.distanceToSquared(points[points.length - 1]!) < 1e-12
    ) {
      points.pop();
      closed = true;
    }
    if (points.length >= 2) out.push({ points, closed, tag: s.tag });
  }
  return out;
}

/**
 * Resolve `<s3dx:section>` (+ optional parent pose) to a 3D polyline
 * (first shape only — prefer `sectionToPolylines3D` for multi-shape).
 */
export function sectionToPolyline3D(
  sectionVal: Value | undefined,
  parentPose?: Partial<Pose>,
  opts?: { circleSegs?: number; forceClosed?: boolean }
): SectionPolyline3D | null {
  return sectionToPolylines3D(sectionVal, parentPose, opts)[0] ?? null;
}

/** Closed path or closed circle — eligible for revolve end caps (triangulated). */
export function shapeAllowsRevolveCaps(tag: string, closed: boolean): boolean {
  if (!closed) return false;
  const t = tag.toLowerCase();
  return t === "path" || t === "circle";
}

/** Closed 3D ring (first ≠ last) for extrude / loft. */
export function sectionToRing3D(
  sectionVal: Value | undefined,
  parentPose?: Partial<Pose>,
  circleSegs = 32
): THREE.Vector3[] | null {
  const poly = sectionToPolyline3D(sectionVal, parentPose, {
    circleSegs,
    forceClosed: true,
  });
  if (!poly || poly.points.length < 3) return null;
  return poly.points;
}
