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

/** Mark hydrated glTF subtrees so scene clear does not dispose shared cache GPU resources. */
export const SVG3DX_GLTF_INSTANCE = "svg3dxGltfInstance";

export interface GltfPendingData {
  href: string;
  styles: Record<string, Value>;
  mode: string;
}

const cache = new Map<string, Promise<THREE.Group>>();

export type GltfAssetUrlMap = Record<string, string>;

function safeDecodeUri(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function lookupAssetUrl(
  ref: string,
  assetUrls?: GltfAssetUrlMap
): string | undefined {
  if (!assetUrls) return undefined;
  const trimmed = ref.trim();
  if (!trimmed) return undefined;
  const decoded = safeDecodeUri(trimmed);
  const noDot = trimmed.replace(/^\.\//, "");
  const baseName = trimmed.split(/[/\\]/).pop() ?? trimmed;
  return (
    assetUrls[trimmed] ??
    assetUrls[noDot] ??
    assetUrls[decoded] ??
    assetUrls[baseName] ??
    assetUrls[`assets/${baseName}`]
  );
}

/**
 * Resolve `href` for loading.
 * 1. Absolute / blob / http(s) IRIs as-is
 * 2. Else look up `assetUrls` (studio local sidecars: `assets/foo.glb` → blob:)
 * 3. Else resolve against document base URL (SVG-style)
 *
 * `documentBaseUrl === ""` means package / sidecar-only mode: do **not** fall
 * back to `window.location.href`. Returns `""` when unresolved in that mode
 * (caller should skip load).
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
  const mapped = lookupAssetUrl(trimmed, assetUrls);
  if (mapped) return mapped;

  // Explicit empty base: host supplies sidecars only (`.svg3dxz` / IndexedDB).
  if (documentBaseUrl === "") {
    return "";
  }

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

/**
 * Remap buffer / texture URLs that GLTFLoader resolves relative to a blob: or
 * package entry so studio sidecars (and package-mode relatives) still load.
 */
function makeLoader(
  documentBaseUrl: string | undefined,
  assetUrls: GltfAssetUrlMap | undefined
): GLTFLoader {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    const mapped = lookupAssetUrl(url, assetUrls);
    if (mapped) return mapped;

    // Absolute blob/http that already resolved — keep unless package mode forbids.
    if (/^(?:blob:|data:|https?:|\/\/)/i.test(url)) {
      return url;
    }

    const resolved = resolveGltfUrl(url, documentBaseUrl, assetUrls);
    return resolved || url;
  });
  return new GLTFLoader(manager);
}

function loadGltfScene(
  url: string,
  documentBaseUrl: string | undefined,
  assetUrls: GltfAssetUrlMap | undefined
): Promise<THREE.Group> {
  const hit = cache.get(url);
  if (hit) return hit.then((g) => g.clone(true));
  const loader = makeLoader(documentBaseUrl, assetUrls);
  let pending: Promise<THREE.Group>;
  pending = new Promise<THREE.Group>((resolve, reject) => {
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
  }).catch((err) => {
    // Only drop *this* attempt — a newer load of the same URL may already be cached.
    if (cache.get(url) === pending) cache.delete(url);
    throw err;
  });
  cache.set(url, pending);
  return pending.then((g) => g.clone(true));
}

/**
 * Optional fill × material multiply onto glTF mesh base colors (§3.2.5 / §8.4).
 * Only applied when styles explicitly carry fill or `--material` (not mere defaults).
 * Fill is sRGB (same as ordinary primitives); glTF `color` is already linear.
 */
function applyOptionalAppearance(
  root: THREE.Object3D,
  styles: Record<string, Value>,
  library: MaterialLibrary
): void {
  const hasFill = styles.fill !== undefined;
  // Core stores presentation `material="…"` as `--material` (see materials.ts).
  const hasMaterial = styles["--material"] !== undefined;
  if (!hasFill && !hasMaterial) return;

  const appearance = resolveAppearance(styles, library);
  const [fr, fg, fb, fa] = appearance.color;
  const tint = new THREE.Color().setRGB(fr, fg, fb, THREE.SRGBColorSpace);

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    // clone(true) shares materials with the cache — clone before mutating.
    const src = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const cloned = src.map((mat) => {
      if (!mat || !("color" in mat)) return mat;
      const m = (mat as THREE.MeshStandardMaterial).clone();
      m.userData.svg3dxOwnedMaterial = true;
      if (m.color) m.color.multiply(tint);
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

/** Map viewer display mode onto hydrated glTF meshes (clone materials first). */
function applyDisplayMode(root: THREE.Object3D, mode: string): void {
  if (mode !== "wireframe" && mode !== "hidden-line") return;

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const src = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const cloned = src.map((mat) => {
      if (!mat) return mat;
      const m = mat.clone();
      m.userData.svg3dxOwnedMaterial = true;
      if ("wireframe" in m) {
        (m as THREE.MeshStandardMaterial).wireframe = mode === "wireframe";
      }
      m.needsUpdate = true;
      return m;
    });
    mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0]!;

    if (mode === "hidden-line" && !mesh.userData.svg3dxGltfEdges) {
      const edges = new THREE.EdgesGeometry(mesh.geometry);
      const line = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({ color: 0x222222 })
      );
      line.userData.svg3dxGltfEdges = true;
      mesh.add(line);
      mesh.userData.svg3dxGltfEdges = true;
    }
  });
}

export type GltfHydrateHooks = {
  /** After a glTF asset is attached under its placeholder. */
  afterInstance?: (placeholder: THREE.Object3D, instance: THREE.Object3D) => void;
};

/**
 * Walk the scene graph and replace glTF placeholders with loaded assets.
 * Applies C at the instance root before authored element transform (already on placeholder).
 * `includeDefsWorld` copies also hydrate (cache clone; no second network fetch).
 */
export async function hydrateGltfPlaceholders(
  root: THREE.Object3D,
  documentBaseUrl: string | undefined,
  library: MaterialLibrary,
  assetUrls?: GltfAssetUrlMap,
  hooks: GltfHydrateHooks = {}
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
      if (!url) {
        console.warn(
          `[svg3dx-viewer] s3dx:gltf '${href}' not in document asset map (package mode); skipped`
        );
        return;
      }
      try {
        const asset = await loadGltfScene(url, documentBaseUrl, assetUrls);
        applyOptionalAppearance(asset, data.styles ?? {}, library);
        applyDisplayMode(asset, data.mode ?? "solid");
        const bridge = new THREE.Group();
        bridge.name = "gltf-y-up-to-z-up";
        bridge.userData[SVG3DX_GLTF_INSTANCE] = true;
        bridge.applyMatrix4(GLTF_Y_UP_TO_Z_UP);
        bridge.add(asset);
        hooks.afterInstance?.(placeholder, bridge);
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

/**
 * Drop cached load promises. Does **not** dispose GPU resources — clones share
 * geometry/textures with the cache root; disposing would break live scenes.
 * Scene clear still disposes per-instance tint materials (`svg3dxOwnedMaterial`).
 */
export function clearGltfCache(): void {
  cache.clear();
}
