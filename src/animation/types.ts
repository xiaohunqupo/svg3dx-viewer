/** Mirrors svg3dx-core `AnimationDesc` (draft 0.2 §10). */

export type AnimationTiming = {
  from: string;
  to: string;
  dur: string;
  /** Play count as authored (`0` = indefinite). Omitted ⇒ once (`1`). */
  repeat?: string | null;
  fill?: string | null;
  begin?: string | null;
  calc_mode?: string | null;
};

export type AnimateTransformType = "translate" | "rotate" | "scale";

export type AnimationDesc =
  | {
      kind: "param";
      attribute_name: string;
      parent_id?: string | null;
      parent_tag: string;
      root_scope: boolean;
      timing: AnimationTiming;
    }
  | {
      kind: "transform";
      attribute_name: string;
      transform_type: AnimateTransformType;
      parent_id?: string | null;
      parent_tag: string;
      timing: AnimationTiming;
    };
