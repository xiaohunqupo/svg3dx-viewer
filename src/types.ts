/** Mirrors svg3dx-core JSON output (serde). */

export type Value = number | number[] | boolean | string | Value[] | { [k: string]: Value };

export interface EvaluationResult {
  instructions: GeometryInstruction[];
  models: ModelDesc[];
  /** Document-defined materials from `<s3dx:materials>` (built-ins are host-side). */
  materials?: MaterialDesc[];
  active_model: string | null;
  warnings: string[];
  /** SMIL-shaped animation descriptors (draft 0.2 §10). */
  animations?: import("./animation/types.js").AnimationDesc[];
}

export interface MaterialDesc {
  id: string;
  /** RGBA sRGB, typically ∈ [0,1]. */
  color: [number, number, number, number] | number[];
  metalness: number;
  roughness: number;
}

export interface ModelDesc {
  id: string;
  mode: string;
  active: boolean;
  transform: { m: number[] };
  uses: { group_id: string; transform: { m: number[] } }[];
}

export type GeometryInstruction =
  | {
      type: "primitive";
      node_id: string;
      kind: string;
      params: Record<string, Value>;
      styles: Record<string, Value>;
      transform: { m: number[] };
    }
  | {
      type: "bool_op";
      node_id: string;
      op: "union" | "subtract" | "intersect";
      styles: Record<string, Value>;
      operands: GeometryInstruction[];
      transform: { m: number[] };
    }
  | {
      type: "instance";
      node_id: string;
      group_id: string;
      styles: Record<string, Value>;
      transform: { m: number[] };
    }
  | {
      type: "group";
      node_id: string;
      id: string | null;
      styles: Record<string, Value>;
      children: GeometryInstruction[];
      transform: { m: number[] };
      /** Present when evaluation retained a skipped condition branch. */
      inactive?: boolean;
    };
