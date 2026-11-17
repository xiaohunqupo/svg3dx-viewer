import * as THREE from "three";
import { DEFAULT_EYE_OFFSET, WORLD_UP } from "./coords.js";
import { buildThreeObject } from "./primitive.js";
import { resolveActiveModel } from "./model.js";
import { mat4x3ToMatrix4 } from "./transform.js";
import { remapAsModelUse } from "./pick.js";
import { materialLibraryFromResult } from "./materials.js";
import { buildSvg2dObjects } from "./svg2d.js";
import type { EvaluationResult, GeometryInstruction } from "./types.js";

/** Low-level scene binder: EvaluationResult → THREE objects. */
export class Svg3dxViewer {
  readonly scene: THREE.Scene;
  readonly root: THREE.Group;

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
   * When a model is active, only its `<s3dx:use>` references are shown
   * (each with that use's `s3dx:transform`) — not every defs group.
   * Ordinary SVG 2D tags (text/rect/…) become XY-plane primitives when `svgText` is set.
   */
  fromResult(
    result: EvaluationResult,
    modeOverride?: string,
    svgText?: string
  ): void {
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
  }

  /**
   * Frame the camera on scene content.
   * @returns `true` when bounds were non-empty and the camera was framed;
   * `false` when empty (still resets to a safe iso so OrbitControls is not singular).
   */
  fitCamera(
    camera: THREE.PerspectiveCamera,
    controls?: { target: THREE.Vector3; update: () => void }
  ): boolean {
    const box = new THREE.Box3().setFromObject(this.root);
    camera.up.copy(WORLD_UP);
    if (box.isEmpty()) {
      // Camera at origin + target at origin makes OrbitControls unusable.
      const dist = 10;
      camera.position.set(
        DEFAULT_EYE_OFFSET.x * dist,
        DEFAULT_EYE_OFFSET.y * dist,
        DEFAULT_EYE_OFFSET.z * dist
      );
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
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const dist = maxDim * 1.8;
    // Default iso: viewDir (−1,+1,−1) → eye along (+1,−1,+1)
    camera.position.set(
      center.x + DEFAULT_EYE_OFFSET.x * dist,
      center.y + DEFAULT_EYE_OFFSET.y * dist,
      center.z + DEFAULT_EYE_OFFSET.z * dist
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

function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = (m as THREE.Mesh).material;
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
