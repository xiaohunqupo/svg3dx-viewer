import type { EvaluationResult } from "./types.js";

/**
 * Whether the document opts into svg3dx evaluation (`svg3d="true"` on the root).
 * Spec: absent / false → treat as ordinary SVG (2D only).
 */
export function isSvg3dxDocument(svgText: string): boolean {
  if (typeof DOMParser === "undefined") {
    return /\bsvg3d\s*=\s*["']?true["']?/i.test(svgText);
  }
  const parsed = new DOMParser().parseFromString(svgText, "image/svg+xml");
  if (parsed.querySelector("parsererror")) return false;
  const root = parsed.documentElement;
  if (!root || root.localName.toLowerCase() !== "svg") return false;
  const v = (root.getAttribute("svg3d") ?? "").trim().toLowerCase();
  return v === "true" || v === "1";
}

export function emptyEvaluationResult(
  warnings: string[] = []
): EvaluationResult {
  return {
    instructions: [],
    models: [],
    active_model: null,
    warnings,
  };
}
