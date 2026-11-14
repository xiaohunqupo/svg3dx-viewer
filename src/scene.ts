import * as THREE from "three";
import { buildThreeObject } from "./primitive.js";
import { resolveActiveModel } from "./model.js";
import type { EvaluationResult } from "./types.js";

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

  fromResult(result: EvaluationResult, modeOverride?: string): void {
    this.clear();
    for (const w of result.warnings) {
      console.warn("[svg3dx-viewer]", w);
    }
    const model = resolveActiveModel(result);
    const mode = modeOverride ?? model?.mode ?? "solid";
    for (const inst of result.instructions) {
      const obj = buildThreeObject(inst, mode);
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
    if (m.material) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) mat.dispose();
    }
  });
}
