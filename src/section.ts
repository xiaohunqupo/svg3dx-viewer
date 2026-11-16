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

/** First SVG shape in a core `section` map → 2D polyline. */
export function parseSection2D(
  sectionVal: Value | undefined,
  circleSegs = 32
): Section2D | null {
  const map = asMap(sectionVal);
  if (!map) return null;
  const shapes = map.shapes;
  if (!Array.isArray(shapes) || shapes.length === 0) return null;
  const first = asMap(shapes[0] as Value);
  if (!first) return null;
  const poly = shapeToPolyline2D(first, circleSegs);
  if (!poly || poly.points.length < 2) return null;
  return { ring: poly.points, closed: poly.closed };
}

/**
 * Resolve `<s3dx:section>` (+ optional parent pose) to a 3D polyline.
 * When `forceClosed`, treat as ring (extrude / loft / closed revolve).
 */
export function sectionToPolyline3D(
  sectionVal: Value | undefined,
  parentPose?: Partial<Pose>,
  opts?: { circleSegs?: number; forceClosed?: boolean }
): { points: THREE.Vector3[]; closed: boolean } | null {
  const map = asMap(sectionVal);
  if (!map) return null;
  const sec2d = parseSection2D(sectionVal, opts?.circleSegs ?? 32);
  if (!sec2d) return null;

  const pose = resolvePose(map, parentPose);
  const frame = sectionFrame(pose.origin, pose.normal, pose.xDir);
  const points = sec2d.ring.map((uv) =>
    frame.origin.clone().addScaledVector(frame.x, uv.x).addScaledVector(frame.y, uv.y)
  );
  let closed = sec2d.closed || !!opts?.forceClosed;
  if (
    points.length >= 2 &&
    points[0]!.distanceToSquared(points[points.length - 1]!) < 1e-12
  ) {
    points.pop();
    closed = true;
  }
  return points.length >= 2 ? { points, closed } : null;
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
