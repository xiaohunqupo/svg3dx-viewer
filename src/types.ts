/** Mirrors svg3dx-core JSON output (serde). */

export type Value = number | number[] | boolean | string | Value[] | { [k: string]: Value };

export interface EvaluationResult {
  instructions: GeometryInstruction[];
  models: ModelDesc[];
  active_model: string | null;
  warnings: string[];
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
    };
