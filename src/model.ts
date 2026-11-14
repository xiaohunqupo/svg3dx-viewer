import type { EvaluationResult, ModelDesc } from "./types.js";

export function resolveActiveModel(result: EvaluationResult): ModelDesc | null {
  if (result.active_model) {
    return result.models.find((m) => m.id === result.active_model) ?? null;
  }
  return result.models.find((m) => m.active) ?? result.models[0] ?? null;
}
