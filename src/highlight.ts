import type { Object3D, Mesh } from "three";
import { getPickData, matchesHighlight } from "./pick.js";

/**
 * Collects meshes matching a tree path and forwards them to an outline
 * consumer (typically three.js `OutlinePass.selectedObjects`).
 *
 * Does not modify materials — materials / fill stay fully readable while
 * editing, matching the official `webgl_postprocessing_outline` approach.
 */
export class SelectionHighlight {
  private path: string | null = null;
  private readonly apply: (objects: Object3D[]) => void;

  constructor(apply?: (objects: Object3D[]) => void) {
    this.apply = apply ?? (() => {});
  }

  get activePath(): string | null {
    return this.path;
  }

  clear(): void {
    this.path = null;
    this.apply([]);
  }

  /**
   * Highlight every mesh under `root` whose pick data matches `path`.
   * Pass `null` / `""` to clear.
   */
  set(root: Object3D, path: string | null | undefined): void {
    if (!path) {
      this.clear();
      return;
    }
    this.path = path;
    const selected: Object3D[] = [];
    root.traverse((obj) => {
      const data = getPickData(obj);
      if (!data || !matchesHighlight(data, path)) return;
      const mesh = obj as Mesh;
      if (!mesh.isMesh) return;
      selected.push(mesh);
    });
    this.apply(selected);
  }
}
