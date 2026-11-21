import type { Object3D } from "three";
import type { GeometryInstruction } from "./types.js";

/**
 * Host extension points for scene construction.
 * The viewer does not interpret evaluation policy fields (e.g. `inactive`);
 * hosts that need special handling opt in via these hooks.
 */
export type SceneBuildHooks = {
  /** Return false to omit an instruction from the scene. Default: accept all. */
  acceptInstruction?: (inst: GeometryInstruction) => boolean;
  /** After a non-null Object3D is built from an instruction. */
  afterObjectBuilt?: (obj: Object3D, inst: GeometryInstruction) => void;
  /** After a glTF asset is attached under its placeholder. */
  afterGltfHydrated?: (placeholder: Object3D, instance: Object3D) => void;
};
