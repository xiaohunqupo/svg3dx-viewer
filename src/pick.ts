import type { Object3D } from "three";

/** Selection / pick metadata attached to THREE objects. */
export type Svg3dxPickData = {
  /**
   * Path returned when the user picks this object in the viewport
   * (e.g. `model:solid-view.0` or `defs:group-windows1.1`).
   */
  treePath: string;
  /**
   * Corresponding defs path for highlight matching when the object is a
   * model `<use>` instance of a defs group.
   */
  defsPath?: string;
  /** Defs group id when this object belongs to / instances a named group. */
  groupId?: string;
  nodeId?: string;
};

export function setPickData(obj: Object3D, data: Svg3dxPickData): void {
  obj.userData.svg3dx = data;
}

export function getPickData(obj: Object3D): Svg3dxPickData | undefined {
  const d = obj.userData?.svg3dx as Svg3dxPickData | undefined;
  return d?.treePath ? d : undefined;
}

/** Walk from `obj` up to find the first pick path. */
export function pickPathFromObject(obj: Object3D | null): string | null {
  let cur: Object3D | null = obj;
  while (cur) {
    const d = getPickData(cur);
    if (d?.treePath) return d.treePath;
    cur = cur.parent;
  }
  return null;
}

/**
 * Remap a cloned defs group under a model use: pick → model path,
 * highlight still matches defs paths via `defsPath`.
 */
export function remapAsModelUse(
  root: Object3D,
  usePath: string,
  groupId: string
): void {
  root.traverse((c) => {
    const prev = getPickData(c);
    const defsPath =
      prev?.defsPath ??
      (prev?.treePath?.startsWith("defs:") ? prev.treePath : `defs:${groupId}`);
    setPickData(c, {
      treePath: usePath,
      defsPath,
      // Keep a nested use's own group id so a hit can be mapped back to that
      // definition. The model-use root is already tagged with `groupId`.
      groupId: prev?.groupId ?? groupId,
      nodeId: prev?.nodeId,
    });
  });
}

/**
 * Whether an object's pick data should light up for the given tree selection path.
 */
export function matchesHighlight(
  data: Svg3dxPickData,
  path: string
): boolean {
  if (!path) return false;
  if (path.startsWith("style:")) {
    const gid = path.slice("style:".length);
    return data.groupId === gid || data.defsPath === `defs:${gid}`;
  }
  const tp = data.treePath;
  if (tp === path || tp.startsWith(`${path}.`)) return true;
  const dp = data.defsPath;
  if (dp && (dp === path || dp.startsWith(`${path}.`))) return true;
  if (data.groupId && path === `defs:${data.groupId}`) return true;
  return false;
}
