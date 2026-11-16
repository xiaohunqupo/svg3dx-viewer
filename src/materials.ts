import * as THREE from "three";
import type { MaterialDesc, Value } from "./types.js";

/** Resolved metallic-roughness appearance (after fill × material.color). */
export interface ResolvedAppearance {
  color: [number, number, number, number];
  metalness: number;
  roughness: number;
  /** Built-in keyword or document id (for diagnostics). */
  materialId: string;
}

export type MaterialLibrary = Map<string, MaterialDesc>;

/** Spec §8.5 built-in presets. `default` is a neutral multiplier. */
export const BUILTIN_MATERIALS: Record<
  string,
  Omit<MaterialDesc, "id">
> = {
  // metalness 0 so neutral white stays bright even before envMap is available
  default: { color: [1, 1, 1, 1], metalness: 0, roughness: 0.6 },
  steel: { color: [0.56, 0.57, 0.58, 1], metalness: 1, roughness: 0.35 },
  stainless: { color: [0.7, 0.7, 0.72, 1], metalness: 1, roughness: 0.25 },
  aluminum: { color: [0.91, 0.92, 0.92, 1], metalness: 1, roughness: 0.3 },
  copper: { color: [0.95, 0.64, 0.54, 1], metalness: 1, roughness: 0.35 },
  brass: { color: [0.88, 0.78, 0.45, 1], metalness: 1, roughness: 0.3 },
  plastic: { color: [0.85, 0.85, 0.85, 1], metalness: 0, roughness: 0.45 },
  rubber: { color: [0.15, 0.15, 0.15, 1], metalness: 0, roughness: 0.85 },
  concrete: { color: [0.55, 0.55, 0.52, 1], metalness: 0, roughness: 0.9 },
  glass: { color: [0.9, 0.95, 1.0, 0.25], metalness: 0, roughness: 0.05 },
  wood: { color: [0.55, 0.35, 0.18, 1], metalness: 0, roughness: 0.75 },
};

/** Default fill when the element does not declare one (legacy viewer blue-gray). */
export const DEFAULT_FILL: [number, number, number, number] = [
  0.53, 0.67, 0.8, 1,
];

export function materialLibraryFromResult(
  materials: MaterialDesc[] | undefined | null
): MaterialLibrary {
  const map: MaterialLibrary = new Map();
  if (!materials) return map;
  for (const m of materials) {
    if (m?.id) map.set(m.id, m);
  }
  return map;
}

/** Parse RGBA from a style value (vector, number, or space-separated string). */
export function parseRgba(
  value: Value | undefined,
  fallback: [number, number, number, number]
): [number, number, number, number] {
  if (value == null) return [...fallback] as [number, number, number, number];
  if (typeof value === "number") {
    return [value, value, value, 1];
  }
  if (typeof value === "string") {
    const parts = value.trim().split(/\s+/).map(Number);
    if (parts.length >= 4 && parts.every((n) => Number.isFinite(n))) {
      return [parts[0]!, parts[1]!, parts[2]!, parts[3]!];
    }
    if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
      return [parts[0]!, parts[1]!, parts[2]!, 1];
    }
    return [...fallback] as [number, number, number, number];
  }
  if (Array.isArray(value)) {
    const nums = value.map(Number);
    if (nums.length >= 4 && nums.every((n) => Number.isFinite(n))) {
      return [nums[0]!, nums[1]!, nums[2]!, nums[3]!];
    }
    if (nums.length === 3 && nums.every((n) => Number.isFinite(n))) {
      return [nums[0]!, nums[1]!, nums[2]!, 1];
    }
  }
  return [...fallback] as [number, number, number, number];
}

function parseOpacity(value: Value | undefined): number {
  if (value == null) return 1;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : 1;
  }
  return 1;
}

function materialRef(styles: Record<string, Value> | undefined): string {
  const v = styles?.["--material"];
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  return "default";
}

/** `url(#id)` → id; otherwise return the keyword as-is. */
export function parseMaterialRef(ref: string): { kind: "id" | "keyword"; value: string } {
  const m = /^url\(\s*#([^)\s]+)\s*\)$/i.exec(ref.trim());
  if (m) return { kind: "id", value: m[1]! };
  return { kind: "keyword", value: ref.trim() };
}

export function resolveMaterialDesc(
  ref: string,
  library: MaterialLibrary,
  warnings?: string[]
): { id: string; desc: Omit<MaterialDesc, "id"> } {
  const parsed = parseMaterialRef(ref);
  if (parsed.kind === "id") {
    const custom = library.get(parsed.value);
    if (custom) {
      return {
        id: custom.id,
        desc: {
          color: normalizeColor4(custom.color),
          metalness: custom.metalness,
          roughness: custom.roughness,
        },
      };
    }
    warnings?.push(
      `unknown material url(#${parsed.value}) — falling back to default`
    );
    return { id: "default", desc: { ...BUILTIN_MATERIALS.default! } };
  }
  const builtin = BUILTIN_MATERIALS[parsed.value];
  if (builtin) {
    return { id: parsed.value, desc: { ...builtin } };
  }
  warnings?.push(
    `unknown material '${parsed.value}' — falling back to default`
  );
  return { id: "default", desc: { ...BUILTIN_MATERIALS.default! } };
}

function normalizeColor4(
  c: number[] | [number, number, number, number]
): [number, number, number, number] {
  if (c.length >= 4) return [c[0]!, c[1]!, c[2]!, c[3]!];
  if (c.length === 3) return [c[0]!, c[1]!, c[2]!, 1];
  return [1, 1, 1, 1];
}

export function composeColor(
  fill: [number, number, number, number],
  materialColor: [number, number, number, number],
  opacity = 1
): [number, number, number, number] {
  return [
    fill[0] * materialColor[0],
    fill[1] * materialColor[1],
    fill[2] * materialColor[2],
    fill[3] * materialColor[3] * opacity,
  ];
}

/** Resolve fill × material from instruction styles. */
export function resolveAppearance(
  styles: Record<string, Value> | undefined,
  library: MaterialLibrary,
  warnings?: string[]
): ResolvedAppearance {
  const fill = parseRgba(styles?.fill, DEFAULT_FILL);
  const opacity = parseOpacity(styles?.opacity);
  const ref = materialRef(styles);
  const { id, desc } = resolveMaterialDesc(ref, library, warnings);
  const matColor = normalizeColor4(desc.color);
  return {
    color: composeColor(fill, matColor, opacity),
    metalness: desc.metalness,
    roughness: desc.roughness,
    materialId: id,
  };
}

/** Spec colors are sRGB; Three.js materials expect working/linear color. */
function srgbColor(r: number, g: number, b: number): THREE.Color {
  return new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
}

export function toThreeMaterial(
  appearance: ResolvedAppearance,
  mode: string,
  opts: { vertexColors?: boolean } = {}
): THREE.Material {
  const [r, g, b, a] = appearance.color;
  const color = srgbColor(r, g, b);
  const transparent = a < 1 - 1e-6;
  const vertexColors = !!opts.vertexColors;

  if (mode === "wireframe") {
    return new THREE.MeshBasicMaterial({
      color,
      wireframe: true,
      transparent,
      opacity: a,
      vertexColors,
      side: THREE.DoubleSide,
    });
  }

  return new THREE.MeshStandardMaterial({
    color,
    metalness: appearance.metalness,
    roughness: appearance.roughness,
    transparent,
    opacity: a,
    depthWrite: !transparent,
    vertexColors,
    side: THREE.DoubleSide,
  });
}

export function toThreeLineMaterial(
  appearance: ResolvedAppearance
): THREE.LineBasicMaterial {
  const [r, g, b, a] = appearance.color;
  return new THREE.LineBasicMaterial({
    color: srgbColor(r, g, b),
    transparent: a < 1 - 1e-6,
    opacity: a,
  });
}
