import type { EvaluationResult } from "./types.js";

export type ParamMap = Record<string, string | number | boolean>;

type WasmPkg = {
  parse_svg3dx: (input: string) => unknown;
  parse_svg3dx_with_params: (
    input: string,
    params_json: string,
    model?: string | null,
    retain_inactive?: boolean | null
  ) => unknown;
  default?: unknown;
};

export type ParseSvgOptions = {
  /** Keep skipped if/if-not branches as `inactive` groups (default false). */
  retainInactive?: boolean;
};

let pkg: WasmPkg | null = null;
let initPromise: Promise<void> | null = null;

/**
 * serde-wasm-bindgen emits JS `Map` for Rust IndexMap/HashMap.
 * `JSON.stringify(Map)` becomes `{}`, which wiped geometry params (boxes → size 1).
 * Convert Maps (and nested structures) into plain objects first.
 */
function reviveMaps(value: unknown): unknown {
  if (value instanceof Map) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of value.entries()) {
      obj[String(k)] = reviveMaps(v);
    }
    return obj;
  }
  // serde-wasm-bindgen emits Float64Array for Vec<f64>; normalize to number[].
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return Array.from(value as unknown as ArrayLike<number>);
  }
  if (Array.isArray(value)) {
    return value.map(reviveMaps);
  }
  if (value && typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        obj[k] = reviveMaps(v);
      }
      return obj;
    }
  }
  return value;
}

function normalizeResult(raw: unknown): EvaluationResult {
  return reviveMaps(raw) as EvaluationResult;
}

async function defaultPkgImport(): Promise<WasmPkg> {
  // Resolved via bundler alias → ../svg3dx-core/pkg (see examples/embed/vite.config.ts)
  return import("svg3dx-ffi-wasm") as Promise<WasmPkg>;
}

/** Load WASM from svg3dx-core. Safe to call multiple times. */
export async function initWasm(
  importPkg: () => Promise<WasmPkg> = defaultPkgImport
): Promise<void> {
  if (pkg) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const loaded = await importPkg();
    const init = loaded.default;
    if (typeof init === "function") {
      await (init as (module_or_path?: unknown) => Promise<unknown>)();
    }
    pkg = loaded;
  })();
  return initPromise;
}

export async function parseSvg(
  svgText: string,
  params: ParamMap = {},
  model?: string,
  options: ParseSvgOptions = {}
): Promise<EvaluationResult> {
  await initWasm();
  if (!pkg) throw new Error("WASM not initialized");
  const retainInactive = options.retainInactive === true;
  const paramsJson = JSON.stringify(params);
  const raw =
    Object.keys(params).length > 0 || model || retainInactive
      ? pkg.parse_svg3dx_with_params(
          svgText,
          paramsJson,
          model ?? undefined,
          retainInactive ? true : undefined
        )
      : pkg.parse_svg3dx(svgText);
  return normalizeResult(raw);
}
