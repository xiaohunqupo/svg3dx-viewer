import * as THREE from "three";
import type { AnimateTransformType, AnimationTiming } from "./types.js";

/** Parse `2s` / `500ms` → seconds. */
export function parseDurationSecs(s: string): number | null {
  const t = s.trim();
  if (t.endsWith("ms")) {
    const n = Number(t.slice(0, -2).trim());
    return Number.isFinite(n) && n >= 0 ? n / 1000 : null;
  }
  const rest = t.endsWith("s") ? t.slice(0, -1).trim() : t;
  const n = Number(rest);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function parseTriple(s: string): [number, number, number] | null {
  const nums = s
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  if (nums.length !== 3 || nums.some((n) => !Number.isFinite(n))) return null;
  return [nums[0], nums[1], nums[2]];
}

/** Progress in [0,1] within the active cycle, or null when not applying. */
export function animationProgress(
  timing: AnimationTiming,
  timeSecs: number
): number | null {
  const dur = parseDurationSecs(timing.dur);
  if (dur == null) return null;
  const begin = timing.begin
    ? (parseDurationSecs(timing.begin) ?? 0)
    : 0;
  if (timeSecs < begin) return null;
  if (dur <= 0) return 1;
  const local = timeSecs - begin;
  const { indefinite, count } = parseRepeat(timing.repeat);
  const total = indefinite ? Infinity : dur * count;
  const fillFreeze = timing.fill === "freeze";
  if (!indefinite && local >= total) {
    return fillFreeze ? 1 : null;
  }
  const cycle = local % dur;
  return Math.min(1, Math.max(0, cycle / dur));
}

/** `0` = indefinite; positive integer = play count; invalid/omitted ⇒ once. */
export function parseRepeat(
  raw: string | null | undefined
): { indefinite: boolean; count: number } {
  if (raw == null || !String(raw).trim()) return { indefinite: false, count: 1 };
  const t = String(raw).trim();
  if (!/^\d+$/.test(t)) return { indefinite: false, count: 1 };
  const n = Number(t);
  if (n === 0) return { indefinite: true, count: Infinity };
  return { indefinite: false, count: n };
}

/** Approach-law weight — same set as loft `blend` (§3.2 / §10.1). */
export function calcModeWeight(mode: string | null | undefined, t: number): number {
  const x = Math.min(1, Math.max(0, t));
  switch ((mode ?? "linear").trim()) {
    case "sine":
      return Math.sin((Math.PI * x) / 2);
    case "cosine":
      return 0.5 - 0.5 * Math.cos(Math.PI * x);
    case "tan":
      return Math.tan((Math.PI * x) / 4);
    case "cotan":
      return 1 - Math.tan((Math.PI * (1 - x)) / 4);
    default:
      return x;
  }
}

function easedProgress(
  timing: AnimationTiming,
  timeSecs: number
): number | null {
  const t = animationProgress(timing, timeSecs);
  if (t == null) return null;
  return calcModeWeight(timing.calc_mode, t);
}

/** Sample a scalar `from`→`to` at document time. */
export function sampleScalar(
  timing: AnimationTiming,
  timeSecs: number
): number | null {
  const s = easedProgress(timing, timeSecs);
  if (s == null) return null;
  const a = Number(timing.from.trim());
  const b = Number(timing.to.trim());
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return a + (b - a) * s;
}

/** Build M_anim(t) as a THREE.Matrix4 (M = T·R·S, Euler XYZ degrees — matches core). */
export function sampleAnimateTransformMatrix(
  type: AnimateTransformType,
  timing: AnimationTiming,
  timeSecs: number
): THREE.Matrix4 | null {
  const s = easedProgress(timing, timeSecs);
  if (s == null) return null;
  const a = parseTriple(timing.from);
  const b = parseTriple(timing.to);
  if (!a || !b) return null;
  const v: [number, number, number] = [
    a[0] + (b[0] - a[0]) * s,
    a[1] + (b[1] - a[1]) * s,
    a[2] + (b[2] - a[2]) * s,
  ];
  const mat = new THREE.Matrix4();
  switch (type) {
    case "translate":
      mat.makeTranslation(v[0], v[1], v[2]);
      break;
    case "rotate": {
      const e = new THREE.Euler(
        THREE.MathUtils.degToRad(v[0]),
        THREE.MathUtils.degToRad(v[1]),
        THREE.MathUtils.degToRad(v[2]),
        "XYZ"
      );
      mat.makeRotationFromEuler(e);
      break;
    }
    case "scale":
      mat.makeScale(v[0], v[1], v[2]);
      break;
    default:
      return null;
  }
  return mat;
}
