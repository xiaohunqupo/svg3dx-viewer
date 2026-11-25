import type { EvaluationResult, Value } from "./types.js";
import type { ParamMap } from "./wasm.js";

export interface ParamDesc {
  name: string;
  value: string | number | boolean;
  /** Inferred from current value */
  kind: "number" | "boolean" | "string" | "vector";
}

/** Collect editable external-style params from current values + optional seed map. */
export function listParams(
  current: ParamMap,
  result?: EvaluationResult | null
): ParamDesc[] {
  const names = new Set<string>(Object.keys(current));
  // Heuristic: surface common CSS custom props mentioned in warnings is too weak;
  // host should seed params. Also expose model id as read-only context separately.
  void result;

  return [...names].sort().map((name) => {
    const value = current[name];
    return { name, value, kind: kindOf(value) };
  });
}

function kindOf(v: string | number | boolean): ParamDesc["kind"] {
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "number") return "number";
  if (typeof v === "string" && /^-?\d+(\.\d+)?(\s+-?\d+(\.\d+)?){1,}$/.test(v.trim())) {
    return "vector";
  }
  return "string";
}

function isDirectParamValue(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  const lower = s.toLowerCase();
  return !lower.includes("var(") && !lower.includes("calc(");
}

/**
 * Read `:root` direct literals (external-param whitelist / UI seed).
 * These are DOM defaults — not host overrides. Spec §2.3: only
 * explicitly supplied external params outrank animation samples.
 */
export function extractStyleParams(svgText: string): ParamMap {
  const out: ParamMap = {};
  const rootBlock =
    /:root\s*\{([^}]*)\}/gi;
  let block: RegExpExecArray | null;
  while ((block = rootBlock.exec(svgText))) {
    const body = block[1] ?? "";
    const re = /--([A-Za-z_][\w-]*)\s*:\s*([^;]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body))) {
      const name = m[1];
      const raw = m[2].trim();
      if (!isDirectParamValue(raw)) continue;
      if (name in out) continue;
      out[name] = parseLiteral(raw);
    }
  }
  return out;
}

export function paramValuesEqual(
  a: string | number | boolean | undefined,
  b: string | number | boolean | undefined
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (typeof a === "number" && typeof b === "number") return a === b;
  return String(a) === String(b);
}

/**
 * Drop overrides whose keys left the `:root` whitelist (after document edit).
 */
export function pruneOverridesToSeed(
  overrides: ParamMap,
  seed: ParamMap
): ParamMap {
  const out: ParamMap = {};
  for (const [k, v] of Object.entries(overrides)) {
    if (k in seed) out[k] = v;
  }
  return out;
}

/**
 * ParamsBar / ParamPanel emit the full display map. Keep only values that
 * differ from the DOM seed so animation can still drive unpinned keys.
 */
export function externalOverridesFromDisplay(
  display: ParamMap,
  seed: ParamMap
): ParamMap {
  const out: ParamMap = {};
  for (const [k, v] of Object.entries(display)) {
    if (!(k in seed)) continue;
    if (!paramValuesEqual(v, seed[k])) out[k] = v;
  }
  return out;
}

function parseLiteral(raw: string): string | number | boolean {
  if (/^true$/i.test(raw)) return true;
  if (/^false$/i.test(raw)) return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

export function valueToInputString(v: string | number | boolean | Value): string {
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.join(" ");
  return String(v);
}
