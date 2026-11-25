import type { Color, Line, Material, Mesh, Object3D } from "three";
import { getPickData, matchesHighlight } from "./pick.js";
import { SELECTION_EDGE } from "./selectionStyle.js";

type LineColorBackup = {
  material: Material & {
    color?: Color;
    depthTest?: boolean;
    needsUpdate?: boolean;
  };
  color: Color;
  depthTest: boolean;
  line: Line;
  renderOrder: number;
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
      this.collectHighlight(obj, selected);
    });
    this.apply(selected);
  }

  /**
   * Outline `node` and the geometry under it only.
   * Used when a defs path is instanced more than once and the pick must stay
   * on the use that was actually hit.
   */
  setSubtree(node: Object3D, path: string | null | undefined): void {
    this.restoreLines();
    this.path = path || null;
    const selected: Object3D[] = [];
    node.traverse((obj) => this.collectHighlight(obj, selected));
    this.apply(selected);
  }

  /** Outline these objects only (already filtered to one instance). */
  setObjects(objects: readonly Object3D[], path: string | null | undefined): void {
    this.restoreLines();
    this.path = path || null;
    const selected: Object3D[] = [];
    for (const obj of objects) this.collectHighlight(obj, selected);
    this.apply(selected);
  }

  private collectHighlight(obj: Object3D, selected: Object3D[]): void {
    const mesh = obj as Mesh;
    if (mesh.isMesh) {
      selected.push(mesh);
      return;
    }
    const line = obj as Line & { isLine?: boolean; isLineSegments?: boolean };
    if (line.isLine && !line.isLineSegments) {
      this.highlightLine(line);
    }
  }

  private highlightLine(line: Line): void {
    const mats = Array.isArray(line.material)
      ? line.material
      : [line.material];
    const prevOrder = line.renderOrder;
    for (const mat of mats) {
      if (!mat || !("color" in mat) || !(mat as { color?: Color }).color) continue;
      const colored = mat as Material & {
        color: Color;
        depthTest?: boolean;
        needsUpdate?: boolean;
      };
      this.lineBackups.push({
        material: colored,
        color: colored.color.clone(),
        depthTest: colored.depthTest !== false,
        line,
        renderOrder: prevOrder,
      });
      colored.color.copy(SELECTION_EDGE);
      // 2-point lines are often coaxial with solids (e.g. axis + cylinder) and
      // disappear under the mesh; draw the accent on top like a CAD overlay.
      colored.depthTest = false;
      colored.needsUpdate = true;
    }
    line.renderOrder = 998;
  }

  private restoreLines(): void {
    const seen = new Set<Line>();
    for (const b of this.lineBackups) {
      b.material.color?.copy(b.color);
      b.material.depthTest = b.depthTest;
      b.material.needsUpdate = true;
      if (!seen.has(b.line)) {
        b.line.renderOrder = b.renderOrder;
        seen.add(b.line);
      }
    }
    this.lineBackups = [];
  }
}
