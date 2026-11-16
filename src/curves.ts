import * as THREE from "three";
import type { Value } from "./types.js";
import { pointsFromValue } from "./sweep.js";

function asMap(v: Value | undefined): Record<string, Value> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, Value>;
}

function num(v: Value | undefined, fallback = 0): number {
  return typeof v === "number" ? v : fallback;
}

function vec3(
  v: Value | undefined,
  fallback?: [number, number, number]
): THREE.Vector3 | null {
  if (Array.isArray(v) && v.length >= 3) {
    return new THREE.Vector3(Number(v[0]), Number(v[1]), Number(v[2]));
  }
  if (ArrayBuffer.isView(v) && (v as ArrayLike<number>).length >= 3) {
    const a = v as ArrayLike<number>;
    return new THREE.Vector3(Number(a[0]), Number(a[1]), Number(a[2]));
  }
  if (fallback) return new THREE.Vector3(...fallback);
  return null;
}

function arcFrame(
  center: THREE.Vector3,
  normal: THREE.Vector3,
  xDir?: THREE.Vector3 | null
): { x: THREE.Vector3; y: THREE.Vector3; n: THREE.Vector3 } {
  const n = normal.clone();
  if (n.lengthSq() < 1e-12) n.set(0, 0, 1);
  else n.normalize();

  let x = xDir?.clone() ?? new THREE.Vector3(1, 0, 0);
  x.addScaledVector(n, -x.dot(n));
  if (x.lengthSq() < 1e-12) {
    x = Math.abs(n.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    x.addScaledVector(n, -x.dot(n));
  }
  x.normalize();
  const y = new THREE.Vector3().crossVectors(n, x).normalize();
  return { x, y, n };
}

function angleOnArc(
  p: THREE.Vector3,
  center: THREE.Vector3,
  x: THREE.Vector3,
  y: THREE.Vector3
): number {
  const d = p.clone().sub(center);
  return Math.atan2(d.dot(y), d.dot(x));
}

/** Sample a core `arc` map to polyline points (includes endpoints). */
export function sampleArc(
  arc: Record<string, Value>,
  segs = 32
): THREE.Vector3[] | null {
  const center = vec3(arc.center);
  const normal = vec3(arc.normal, [0, 0, 1]);
  if (!center || !normal) return null;

  const xDir = vec3(arc.xDir);
  const frame = arcFrame(center, normal, xDir);
  let radius = num(arc.radius, NaN);
  let startAngle = (num(arc.startAngle) * Math.PI) / 180;
  let sweep = (num(arc.angle, NaN) * Math.PI) / 180;

  const from = vec3(arc.from);
  const to = vec3(arc.to);

  if (from && to) {
    const r0 = from.distanceTo(center);
    const r1 = to.distanceTo(center);
    if (!Number.isFinite(radius) || radius <= 0) radius = (r0 + r1) / 2;
    startAngle = angleOnArc(from, center, frame.x, frame.y);
    const endAngle = angleOnArc(to, center, frame.x, frame.y);
    sweep = endAngle - startAngle;
    // Default minor arc (≤180°)
    if (sweep > Math.PI) sweep -= Math.PI * 2;
    if (sweep < -Math.PI) sweep += Math.PI * 2;
    if (typeof arc.angle === "number") {
      sweep = (arc.angle * Math.PI) / 180;
    }
  }

  if (!Number.isFinite(radius) || radius <= 0) return null;
  if (!Number.isFinite(sweep) || Math.abs(sweep) < 1e-12) {
    // Degenerate: single point or use full circle if angle missing with radius only
    if (typeof arc.angle !== "number" && !from && !to) return null;
  }

  const n = Math.max(2, Math.ceil(segs * (Math.abs(sweep) / (Math.PI * 2))));
  const out: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = startAngle + (sweep * i) / n;
    out.push(
      center
        .clone()
        .addScaledVector(frame.x, Math.cos(a) * radius)
        .addScaledVector(frame.y, Math.sin(a) * radius)
    );
  }
  return out;
}

function sampleSegment(seg: Record<string, Value>): THREE.Vector3[] | null {
  const tag = typeof seg.tag === "string" ? seg.tag : "";
  if (tag === "line") {
    const from = vec3(seg.from);
    const to = vec3(seg.to);
    if (!to) return null;
    if (!from) return [to];
    return [from, to];
  }
  if (tag === "arc") return sampleArc(seg);
  return null;
}

/**
 * Resolve a core path value (`points` and/or `segments`) to a 3D polyline.
 * Consecutive segment joints are de-duplicated.
 */
export function pathToPoints(pathVal: Value | undefined): THREE.Vector3[] {
  if (pathVal == null) return [];
  if (Array.isArray(pathVal)) return pointsFromValue(pathVal);

  const map = asMap(pathVal);
  if (!map) return [];

  const segments = map.segments;
  if (Array.isArray(segments) && segments.length > 0) {
    const out: THREE.Vector3[] = [];
    for (const s of segments) {
      const seg = asMap(s as Value);
      if (!seg) continue;
      const pts = sampleSegment(seg);
      if (!pts || pts.length === 0) continue;
      for (const p of pts) {
        if (
          out.length === 0 ||
          out[out.length - 1]!.distanceToSquared(p) > 1e-12
        ) {
          out.push(p);
        }
      }
    }
    return out;
  }

  return pointsFromValue(map.points ?? pathVal);
}

export function buildLineGeometry(
  fromVal: Value | undefined,
  toVal: Value | undefined
): THREE.BufferGeometry | null {
  const from = vec3(fromVal);
  const to = vec3(toVal);
  if (!from || !to || from.distanceToSquared(to) < 1e-16) return null;
  const g = new THREE.BufferGeometry();
  g.setFromPoints([from, to]);
  return g;
}

export function buildArcGeometry(
  arcParams: Record<string, Value>
): THREE.BufferGeometry | null {
  const pts = sampleArc(arcParams);
  if (!pts || pts.length < 2) return null;
  const g = new THREE.BufferGeometry();
  g.setFromPoints(pts);
  return g;
}

export function buildPathGeometry(
  pathVal: Value | undefined
): THREE.BufferGeometry | null {
  const pts = pathToPoints(pathVal);
  if (pts.length < 2) return null;
  const g = new THREE.BufferGeometry();
  g.setFromPoints(pts);
  return g;
}
