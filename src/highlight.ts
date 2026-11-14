import * as THREE from "three";
import { getPickData, matchesHighlight } from "./pick.js";

const HIGHLIGHT_EMISSIVE = new THREE.Color(0xffaa33);
const HIGHLIGHT_INTENSITY = 0.55;

type MatBackup = {
  material: THREE.Material;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
  color?: THREE.Color;
};

type HighlightEntry = {
  object: THREE.Object3D;
  backups: MatBackup[];
};

/**
 * Applies / clears emissive highlight on meshes that match a tree path.
 */
export class SelectionHighlight {
  private entries: HighlightEntry[] = [];
  private path: string | null = null;

  get activePath(): string | null {
    return this.path;
  }

  clear(): void {
    for (const entry of this.entries) {
      for (const b of entry.backups) {
        const mat = b.material as THREE.MeshStandardMaterial & {
          color?: THREE.Color;
        };
        if (b.emissive && "emissive" in mat && mat.emissive) {
          mat.emissive.copy(b.emissive);
        }
        if (
          b.emissiveIntensity !== undefined &&
          "emissiveIntensity" in mat
        ) {
          (mat as THREE.MeshStandardMaterial).emissiveIntensity =
            b.emissiveIntensity;
        }
        if (b.color && mat.color) {
          mat.color.copy(b.color);
        }
      }
    }
    this.entries = [];
    this.path = null;
  }

  /**
   * Highlight every object under `root` whose pick data matches `path`.
   * Pass `null` / `""` to clear.
   */
  set(root: THREE.Object3D, path: string | null | undefined): void {
    this.clear();
    if (!path) return;
    this.path = path;

    root.traverse((obj) => {
      const data = getPickData(obj);
      if (!data || !matchesHighlight(data, path)) return;
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;

      const mats = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      const backups: MatBackup[] = [];
      for (const mat of mats) {
        const std = mat as THREE.MeshStandardMaterial;
        const backup: MatBackup = { material: mat };
        if ("emissive" in std && std.emissive) {
          backup.emissive = std.emissive.clone();
          backup.emissiveIntensity = std.emissiveIntensity ?? 1;
          std.emissive.copy(HIGHLIGHT_EMISSIVE);
          std.emissiveIntensity = HIGHLIGHT_INTENSITY;
        } else if ("color" in std && std.color) {
          backup.color = std.color.clone();
          std.color.lerp(HIGHLIGHT_EMISSIVE, 0.45);
        }
        backups.push(backup);
      }
      if (backups.length) this.entries.push({ object: obj, backups });
    });
  }
}
