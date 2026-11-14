import * as THREE from "three";
import { buildThreeObject } from "./primitive.js";
import { resolveActiveModel } from "./model.js";
import { mat4x3ToMatrix4 } from "./transform.js";
import { remapAsModelUse } from "./pick.js";
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
   */
  fromResult(result: EvaluationResult, modeOverride?: string): void {
    this.clear();
    for (const w of result.warnings) {
      console.warn("[svg3dx-viewer]", w);
    }
    const model = resolveActiveModel(result);
    const mode = modeOverride ?? model?.mode ?? "solid";

    const groupsById = new Map<string, GeometryInstruction>();
    for (const inst of result.instructions) {
      if (inst.type === "group" && inst.id) {
        groupsById.set(inst.id, inst);
      }
    }

    if (model && model.uses.length > 0) {
      for (let i = 0; i < model.uses.length; i++) {
        const use = model.uses[i]!;
        const src = groupsById.get(use.group_id);
        if (!src) {
          console.warn(
            `[svg3dx-viewer] model '${model.id}' references missing group '${use.group_id}'`
          );
          continue;
        }
        const defsPath = `defs:${use.group_id}`;
        const obj = buildThreeObject(src, mode, defsPath);
        if (!obj) continue;
        const usePath = `model:${model.id}.${i}`;
        obj.name = `use:${use.group_id}`;
        remapAsModelUse(obj, usePath, use.group_id);
        if (use.transform?.m?.length) {
          obj.applyMatrix4(mat4x3ToMatrix4(use.transform.m));
        }
        this.root.add(obj);
      }
      return;
    }

    for (const inst of result.instructions) {
      const path =
        inst.type === "group" && inst.id ? `defs:${inst.id}` : undefined;
      const obj = buildThreeObject(inst, mode, path);
      if (obj) this.root.add(obj);
    }
  }

  fitCamera(
    camera: THREE.PerspectiveCamera,
    controls?: { target: THREE.Vector3; update: () => void }
  ): void {
    const box = new THREE.Box3().setFromObject(this.root);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const dist = maxDim * 1.8;
    camera.position.set(center.x + dist, center.y + dist * 0.7, center.z + dist);
    camera.near = Math.max(0.1, dist / 100);
    camera.far = dist * 100;
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.copy(center);
      controls.update();
    } else {
      camera.lookAt(center);
    }
  }
}

function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = (m as THREE.Mesh).material;
    if (mat) {
      const mats = Array.isArray(mat) ? mat : [mat];
      for (const item of mats) item.dispose();
    }
  });
}
