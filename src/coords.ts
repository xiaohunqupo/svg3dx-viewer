import * as THREE from "three";

/** svg3dx world up: +Z (XY = SVG plane). */
export const WORLD_UP = new THREE.Vector3(0, 0, 1);

/**
 * Default view direction (camera looks along this vector).
 * (−1,+1,−1): SVG-like X-right / Y-up-on-drawing feel, common CAD iso.
 */
export const DEFAULT_VIEW_DIR = new THREE.Vector3(-1, 1, -1).normalize();

/** Eye offset from target (= −viewDir): place camera along (+1,−1,+1). */
export const DEFAULT_EYE_OFFSET = DEFAULT_VIEW_DIR.clone().negate();

/**
 * ViewHelper +Z home: eye along +Z looking onto the XOY plane.
 * Same direction as clicking the ViewHelper Z handle.
 */
export const TOP_EYE_OFFSET = new THREE.Vector3(0, 0, 1);

/**
 * Apply svg3dx Z-up to Three.js globals used by lookAt / lights / new Object3D.
 * Call once before creating cameras, controls, or helpers.
 */
export function applyWorldUp(): void {
  THREE.Object3D.DEFAULT_UP.copy(WORLD_UP);
}
