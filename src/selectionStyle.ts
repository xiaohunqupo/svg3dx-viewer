import * as THREE from "three";

/**
 * Shared selection accent used by OutlinePass (meshes) and SelectionHighlight
 * (curve wires). Always warm gold.
 *
 * Stock OutlinePass uses AdditiveBlending (official demo on dark bg). That
 * washes out on light page gray (three.js#12030). Studio therefore always
 * uses NormalBlending + an alpha overlay so light/dark share one path and
 * the edge stays gold.
 */
export const SELECTION_EDGE = new THREE.Color(0xff9a2e);
export const SELECTION_EDGE_HIDDEN = new THREE.Color(0xb36a10);

export type SelectionOutlineTuning = {
  edgeStrength: number;
  edgeThickness: number;
  edgeGlow: number;
};

/** Same outline weight for light and dark. */
export const SELECTION_OUTLINE_TUNING: SelectionOutlineTuning = {
  edgeStrength: 5,
  edgeThickness: 2.5,
  edgeGlow: 0.2,
};

/**
 * Gold edge with coverage in alpha (pairs with NormalBlending).
 * Keeps hue from the edge color buffer instead of premultiplied wash.
 */
export const OUTLINE_OVERLAY_FS_ALPHA = /* glsl */ `
varying vec2 vUv;

uniform sampler2D maskTexture;
uniform sampler2D edgeTexture1;
uniform sampler2D edgeTexture2;
uniform sampler2D patternTexture;
uniform float edgeStrength;
uniform float edgeGlow;
uniform bool usePatternTexture;

void main() {
	vec4 edgeValue1 = texture2D(edgeTexture1, vUv);
	vec4 edgeValue2 = texture2D(edgeTexture2, vUv);
	vec4 maskColor = texture2D(maskTexture, vUv);
	vec4 edgeValue = edgeValue1 + edgeValue2 * edgeGlow;
	float intensity = max(edgeValue.r, max(edgeValue.g, edgeValue.b));
	vec3 rgb = intensity > 1e-4 ? edgeValue.rgb / intensity : vec3(0.0);
	float alpha = clamp(edgeStrength * maskColor.r * intensity, 0.0, 1.0);
	if (usePatternTexture) {
		vec4 patternColor = texture2D(patternTexture, 6.0 * vUv);
		float visibilityFactor = 1.0 - maskColor.g > 0.0 ? 1.0 : 0.5;
		alpha = max(alpha, visibilityFactor * (1.0 - maskColor.r) * (1.0 - patternColor.r));
	}
	gl_FragColor = vec4(rgb, alpha);
}
`;

/** Reset shared gold colors (idempotent). */
export function applySelectionEdgeColors(): void {
  SELECTION_EDGE.set(0xff9a2e);
  SELECTION_EDGE_HIDDEN.set(0xb36a10);
}
