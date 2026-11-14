import type { EvaluationResult } from "./types.js";

export type ParamMap = Record<string, string | number | boolean>;

type WasmPkg = {
  parse_svg3dx: (input: string) => unknown;
  parse_svg3dx_with_params: (
    input: string,
    params_json: string,
    model?: string | null
  ) => unknown;
  default?: unknown;
};

let pkg: WasmPkg | null = null;
let initPromise: Promise<void> | null = null;

function normalizeResult(raw: unknown): EvaluationResult {
  return JSON.parse(JSON.stringify(raw)) as EvaluationResult;
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
  model?: string
): Promise<EvaluationResult> {
  await initWasm();
  if (!pkg) throw new Error("WASM not initialized");
  const paramsJson = JSON.stringify(params);
  const raw =
    Object.keys(params).length > 0 || model
      ? pkg.parse_svg3dx_with_params(svgText, paramsJson, model ?? undefined)
      : pkg.parse_svg3dx(svgText);
  return normalizeResult(raw);
}
