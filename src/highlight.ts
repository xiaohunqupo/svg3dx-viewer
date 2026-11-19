import type { Color, Line, Material, Mesh, Object3D } from "three";
import { getPickData, matchesHighlight } from "./pick.js";
import { SELECTION_EDGE } from "./selectionStyle.js";

type LineColorBackup = {
  material: Material & { color?: Color };
  color: Color;
};

/**
 * Selection highlight for tree / pick paths.
 *
 * - Meshes → forwarded to an outline consumer (`OutlinePass.selectedObjects`).
 * - Curve wires (`THREE.Line` from `line` / `arc` / `path`) → temporary
 *   `LineBasicMaterial.color` swap (OutlinePass cannot outline lines).
 *
 * Skips `LineSegments` (e.g. hidden-line edge overlays) so solid selection
 * stays outline-only.
 */
export class SelectionHighlight {
  private path: string | null = null;
  private readonly apply: (objects: Object3D[]) => void;
  private lineBackups: LineColorBackup[] = [];

  constructor(apply?: (objects: Object3D[]) => void) {
    this.apply = apply ?? (() => {});
  }

  get activePath(): string | null {
    return this.path;
  }

  clear(): void {
    this.restoreLines();
    this.path = null;
    this.apply([]);
  }

  /**
   * Highlight every matching object under `root`.
   * Pass `null` / `""` to clear.
   */
  set(root: Object3D, path: string | null | undefined): void {
    this.restoreLines();
    if (!path) {
      this.path = null;
      this.apply([]);
      return;
    }
    this.path = path;
    const selected: Object3D[] = [];
    root.traverse((obj) => {
      const data = getPickData(obj);
      if (!data || !matchesHighlight(data, path)) return;
      const mesh = obj as Mesh;
      if (mesh.isMesh) {
        selected.push(mesh);
        return;
      }
      const line = obj as Line & { isLine?: boolean; isLineSegments?: boolean };
      if (line.isLine && !line.isLineSegments) {
        this.highlightLine(line);
      }
    });
    this.apply(selected);
  }

  private highlightLine(line: Line): void {
    const mats = Array.isArray(line.material)
      ? line.material
      : [line.material];
    for (const mat of mats) {
      if (!mat || !("color" in mat) || !(mat as { color?: Color }).color) continue;
      const colored = mat as Material & { color: Color };
      this.lineBackups.push({
        material: colored,
        color: colored.color.clone(),
      });
      colored.color.copy(SELECTION_EDGE);
    }
  }

  private restoreLines(): void {
    for (const b of this.lineBackups) {
      b.material.color?.copy(b.color);
    }
    this.lineBackups = [];
  }
}
