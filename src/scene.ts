import * as THREE from "three";
import { DEFAULT_EYE_OFFSET, WORLD_UP } from "./coords.js";
import { buildThreeObject } from "./primitive.js";
import { resolveActiveModel } from "./model.js";
import { mat4x3ToMatrix4 } from "./transform.js";
import { remapAsModelUse } from "./pick.js";
import { materialLibraryFromResult } from "./materials.js";
import { buildSvg2dObjects } from "./svg2d.js";
import { recomputeBoolFallbacks } from "./bool.js";
import {
  hydrateGltfPlaceholders,
  SVG3DX_GLTF_INSTANCE,
  type GltfAssetUrlMap,
} from "./gltf.js";
import type { EvaluationResult, GeometryInstruction } from "./types.js";

export interface FitCameraOptions {
  /**
   * Eye offset from target (default: CAD iso).
   * Use `TOP_EYE_OFFSET` for the ViewHelper +Z (top-down) home.
   */
  eyeOffset?: THREE.Vector3;
  /** Frame this object instead of the whole scene root. */
  object?: THREE.Object3D;
}

/** Low-level scene binder: EvaluationResult → THREE objects. */
export class Svg3dxViewer {
  readonly scene: THREE.Scene;
  readonly root: THREE.Group;
  /**
   * With a model active, also keep each defs group — hidden — at that group's
   * own transform, so an editor can show the definition in world space.
   */
  includeDefsWorld = false;

  constructor(scene?: THREE.Scene) {
    this.scene = scene ?? new THREE.Scene();
    this.root = new THREE.Group();
    this.root.name = "svg3dx";
    this.scene.add(this.root);
  }

  clear(): void {
    while (this.root.children.length) {
      const child = this.root.children[0];
      this.root.remove(child);
      disposeObject(child);
    }
  }

  /**
   * Bind evaluated geometry into the scene.
   * When a model is active, its `<s3dx:use>` references are shown
   * (each with that use's `s3dx:transform`). With `includeDefsWorld`, each
   * defs group is also kept hidden at the group's own transform.
   * Ordinary SVG 2D tags (text/rect/…) become XY-plane primitives when `svgText` is set.
   */
  /**
   * Bind evaluated geometry into the scene, then asynchronously load any
   * `s3dx:gltf` placeholders (relative `href` resolved against `documentBaseUrl`).
   */
  async fromResult(
    result: EvaluationResult,
    modeOverride?: string,
    svgText?: string,
    documentBaseUrl?: string,
    assetUrls?: GltfAssetUrlMap
  ): Promise<void> {
    this.clear();
    for (const w of result.warnings) {
      console.warn("[svg3dx-viewer]", w);
    }
    const model = resolveActiveModel(result);
    const mode = modeOverride ?? model?.mode ?? "solid";
    const library = materialLibraryFromResult(result.materials);

    const groupsById = new Map<string, GeometryInstruction>();
    for (const inst of result.instructions) {
      if (inst.type === "group" && inst.id) {
        groupsById.set(inst.id, inst);
      }
    }

    if (model && model.uses.length > 0) {
      for (let i = 0; i < model.uses.length; i++) {
        const use = model.uses[i]!;
        if (!use.group_id) continue;
        const src = groupsById.get(use.group_id);
        if (!src) {
          console.warn(
            `[svg3dx-viewer] model '${model.id}' references missing group '${use.group_id}'`
          );
          continue;
        }
        const defsPath = `defs:${use.group_id}`;
        const obj = buildThreeObject(src, mode, defsPath, library);
        if (!obj) continue;
        const usePath = `model:${model.id}.${i}`;
        obj.name = `use:${use.group_id}`;
        remapAsModelUse(obj, usePath, use.group_id);
        if (use.transform?.m?.length) {
          obj.applyMatrix4(mat4x3ToMatrix4(use.transform.m));
        }
        this.root.add(obj);
      }
      if (this.includeDefsWorld) {
        for (const [id, src] of groupsById) {
          const obj = buildThreeObject(src, mode, `defs:${id}`, library);
          if (!obj) continue;
          obj.name = `defs-world:${id}`;
          obj.visible = false;
          obj.userData.defsWorld = id;
          this.root.add(obj);
        }
      }
    } else {
      for (const inst of result.instructions) {
        const path =
          inst.type === "group" && inst.id ? `defs:${inst.id}` : undefined;
        const obj = buildThreeObject(inst, mode, path, library);
        if (obj) this.root.add(obj);
      }
    }

    if (svgText) {
      const svg2d = buildSvg2dObjects(svgText);
      if (svg2d) this.root.add(svg2d);
    }

    await hydrateGltfPlaceholders(
      this.root,
      documentBaseUrl,
      library,
      assetUrls
    );
    // Boolean + glTF was deferred (empty placeholders); retry CSG now meshes exist.
    recomputeBoolFallbacks(this.root, mode, library);
  }

  /**
   * Frame the camera on scene content.
   * @returns `true` when bounds were non-empty and the camera was framed;
   * `false` when empty (still resets to a safe iso so OrbitControls is not singular).
   */
  fitCamera(
    camera: THREE.PerspectiveCamera,
    controls?: { target: THREE.Vector3; update: () => void },
    options: FitCameraOptions = {}
  ): boolean {
    const target = options.object ?? this.root;
    target.updateMatrixWorld(true);
    const box = new THREE.Box3();
    expandVisibleBounds(box, target);
    const eye = (options.eyeOffset ?? DEFAULT_EYE_OFFSET).clone().normalize();
    // Always Z-up so OrbitControls orbits around world +Z (CAD-style).
    camera.up.copy(WORLD_UP);
    if (box.isEmpty()) {
      // Camera at origin + target at origin makes OrbitControls unusable.
      const dist = 10;
      camera.position.set(eye.x * dist, eye.y * dist, eye.z * dist);
      camera.near = 0.1;
      camera.far = 10000;
      camera.updateProjectionMatrix();
      if (controls) {
        controls.target.set(0, 0, 0);
        controls.update();
      } else {
        camera.lookAt(0, 0, 0);
      }
      return false;
    }
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    // Sphere covering the AABB — more stable than maxDim for iso framing.
    const radius = Math.max(size.length() * 0.5, 1e-3);
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const aspect = Math.max(camera.aspect || 1, 1e-4);
    // Fit sphere in both vertical and horizontal FOV (account for canvas aspect).
    const fitH = radius / Math.tan(fov / 2);
    const fitW = radius / (Math.tan(fov / 2) * aspect);
    const dist = Math.max(fitH, fitW) * 1.35;
    camera.position.set(
      center.x + eye.x * dist,
      center.y + eye.y * dist,
      center.z + eye.z * dist
    );
    camera.near = Math.max(0.1, dist / 100);
    camera.far = dist * 100;
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.copy(center);
      controls.update();
    } else {
      camera.lookAt(center);
    }
    return true;
  }
}

const _fitBox = new THREE.Box3();

/** Bounds of `object` and its visible descendants. Hidden branches are left out. */
function expandVisibleBounds(box: THREE.Box3, object: THREE.Object3D): void {
  if (!object.visible) return;
  const geometry = (object as THREE.Mesh).geometry;
  if (geometry) {
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (geometry.boundingBox && !geometry.boundingBox.isEmpty()) {
      _fitBox.copy(geometry.boundingBox).applyMatrix4(object.matrixWorld);
      box.union(_fitBox);
    }
  }
  for (const child of object.children) expandVisibleBounds(box, child);
}

function underGltfInstance(obj: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = obj;
  while (p) {
    if (p.userData?.[SVG3DX_GLTF_INSTANCE]) return true;
    p = p.parent;
  }
  return false;
}

function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((c) => {
    const m = c as THREE.Mesh;
    // glTF instances share geometry/textures with the loader cache — do not dispose
    // those; only drop per-instance materials cloned for fill/--material tint.
    if (underGltfInstance(c)) {
      const mat = m.material;
      if (!mat) return;
      for (const item of Array.isArray(mat) ? mat : [mat]) {
        if (item?.userData?.svg3dxOwnedMaterial) item.dispose();
      }
      return;
    }
    if (m.geometry) m.geometry.dispose();
    const mat = m.material;
    if (mat) {
      const mats = Array.isArray(mat) ? mat : [mat];
      for (const item of mats) {
        const map = (item as THREE.MeshBasicMaterial).map;
        if (map) map.dispose();
        item.dispose();
      }
    }
  });
}
