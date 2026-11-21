import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { Value } from "./types.js";
import {
  type MaterialLibrary,
  resolveAppearance,
} from "./materials.js";

/**
 * Normative glTF Y-up → svg3dx Z-up basis conversion C (§3.2.5):
 * (x,y,z)_glTF ↦ (x, -z, y)_svg3dx  ≡  RotX(+90°).
 * Column-major 4×4 matching Three.Matrix4.
 */
export const GLTF_Y_UP_TO_Z_UP = new THREE.Matrix4().set(
  1, 0, 0, 0,
  0, 0, -1, 0,
  0, 1, 0, 0,
  0, 0, 0, 1
);

export const SVG3DX_GLTF_PENDING = "svg3dxGltfPending";

export interface GltfPendingData {
  href: string;
  styles: Record<string, Value>;
  mode: string;
}

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group>>();

export type GltfAssetUrlMap = Record<string, string>;

/**
 * Resolve `href` for loading.
 * 1. Absolute / blob / http(s) IRIs as-is
 * 2. Else look up `assetUrls` (studio local sidecars: `assets/foo.glb` → blob:)
 * 3. Else resolve against document base URL (SVG-style)
 */
export function resolveGltfUrl(
  href: string,
  documentBaseUrl?: string,
  assetUrls?: GltfAssetUrlMap
): string {
  const trimmed = href.trim();
  if (!trimmed) return trimmed;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(trimmed)) {
    return trimmed;
  }
  const mapped =
    assetUrls?.[trimmed] ??
    assetUrls?.[trimmed.replace(/^\.\//, "")] ??
    assetUrls?.[decodeURIComponent(trimmed)];
  if (mapped) return mapped;

  const base =
    documentBaseUrl && documentBaseUrl.length > 0
      ? documentBaseUrl
      : typeof window !== "undefined"
        ? window.location.href
        : "file:///";
  try {
    return new URL(trimmed, base).href;
  } catch {
    return trimmed;
  }
}

function loadGltfScene(url: string): Promise<THREE.Group> {
  const hit = cache.get(url);
  if (hit) return hit.then((g) => g.clone(true));
  const p = new Promise<THREE.Group>((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        const root = new THREE.Group();
        root.name = "gltf-asset";
        root.add(gltf.scene);
        resolve(root);
      },
      undefined,
      (err) => reject(err)
    );
  });
  cache.set(url, p);
  return p.then((g) => g.clone(true));
}

/**
 * Optional fill × material multiply onto glTF mesh base colors (§3.2.5 / §8.4).
 * Only applied when styles explicitly carry fill or material (not mere defaults).
 */
function applyOptionalAppearance(
  root: THREE.Object3D,
  styles: Record<string, Value>,
  library: MaterialLibrary
): void {
  const hasFill = styles.fill !== undefined;
  const hasMaterial = styles.material !== undefined;
  if (!hasFill && !hasMaterial) return;

  const appearance = resolveAppearance(styles, library);
  const [fr, fg, fb, fa] = appearance.color;

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    // clone(true) shares materials with the cache — clone before mutating.
    const src = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const cloned = src.map((mat) => {
      if (!mat || !("color" in mat)) return mat;
      const m = (mat as THREE.MeshStandardMaterial).clone();
      if (m.color) {
        m.color.r *= fr;
        m.color.g *= fg;
        m.color.b *= fb;
      }
      if ("opacity" in m && typeof m.opacity === "number") {
        m.opacity *= fa;
        m.transparent = m.transparent || fa < 0.999;
      }
      if ("metalness" in m && hasMaterial) {
        m.metalness = appearance.metalness;
        m.roughness = appearance.roughness;
      }
      m.needsUpdate = true;
      return m;
    });
    mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0]!;
  });
}

/**
 * Walk the scene graph and replace glTF placeholders with loaded assets.
 * Applies C at the instance root before authored element transform (already on placeholder).
 */
export async function hydrateGltfPlaceholders(
  root: THREE.Object3D,
  documentBaseUrl: string | undefined,
  library: MaterialLibrary,
  assetUrls?: GltfAssetUrlMap
): Promise<void> {
  const placeholders: THREE.Object3D[] = [];
  root.traverse((obj) => {
    if (obj.userData?.[SVG3DX_GLTF_PENDING]) placeholders.push(obj);
  });
  if (!placeholders.length) return;

  await Promise.all(
    placeholders.map(async (placeholder) => {
      const data = placeholder.userData[SVG3DX_GLTF_PENDING] as GltfPendingData;
      delete placeholder.userData[SVG3DX_GLTF_PENDING];
      const href = data?.href?.trim();
      if (!href) {
        console.warn("[svg3dx-viewer] s3dx:gltf missing href");
        return;
      }
      if (href.startsWith("data:")) {
        console.warn(
          "[svg3dx-viewer] s3dx:gltf data: URIs are not allowed; skipped"
        );
        return;
      }
      if (href.startsWith("#")) {
        console.warn(
          "[svg3dx-viewer] s3dx:gltf href must not be a fragment (#id); skipped"
        );
        return;
      }
      const url = resolveGltfUrl(href, documentBaseUrl, assetUrls);
      try {
        const asset = await loadGltfScene(url);
        applyOptionalAppearance(asset, data.styles ?? {}, library);
        const bridge = new THREE.Group();
        bridge.name = "gltf-y-up-to-z-up";
        bridge.applyMatrix4(GLTF_Y_UP_TO_Z_UP);
        bridge.add(asset);
        placeholder.add(bridge);
      } catch (err) {
        console.warn(
          `[svg3dx-viewer] failed to load glTF '${href}' → ${url}:`,
          err
        );
      }
    })
  );
}

/** Clear the in-memory glTF clone cache (e.g. on document close). */
export function clearGltfCache(): void {
  cache.clear();
}
