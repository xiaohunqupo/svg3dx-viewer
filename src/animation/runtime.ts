import * as THREE from "three";
import { getPickData } from "../pick.js";
import type { ParamMap } from "../wasm.js";
import {
  parseDurationSecs,
  parseRepeat,
  sampleAnimateTransformMatrix,
  sampleScalar,
} from "./sample.js";
import type { AnimationDesc } from "./types.js";

export type TransformBinding = {
  desc: Extract<AnimationDesc, { kind: "transform" }>;
  object: THREE.Object3D;
  /** Authored transform matrix after eval (before animation). */
  baseMatrix: THREE.Matrix4;
};

/**
 * Host-side animation clock state for one loaded document.
 * Param tracks → sampled overrides for re-eval; transform tracks → scene matrices.
 */
export class AnimationRuntime {
  private descs: AnimationDesc[] = [];
  private transformBindings: TransformBinding[] = [];
  private playing = false;
  private docTime = 0;
  private lastParamKey = "";

  reset(descs: AnimationDesc[] | undefined | null): void {
    this.descs = Array.isArray(descs) ? descs.slice() : [];
    this.transformBindings = [];
    this.docTime = 0;
    this.lastParamKey = "";
    this.playing = this.descs.length > 0;
  }

  clear(): void {
    this.descs = [];
    this.transformBindings = [];
    this.playing = false;
    this.docTime = 0;
    this.lastParamKey = "";
  }

  get hasAnimations(): boolean {
    return this.descs.length > 0;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  setPlaying(playing: boolean): void {
    this.playing = playing && this.descs.length > 0;
  }

  resetClock(): void {
    this.docTime = 0;
    this.lastParamKey = "";
  }

  getDocTime(): number {
    return this.docTime;
  }

  /** Seek document time (seconds). Does not apply samples — call `applyFrame(0)`. */
  setDocTime(timeSecs: number): void {
    this.docTime = Math.max(0, timeSecs);
    this.lastParamKey = "";
  }

  /**
   * Scrubber length: longest single cycle among animations (indefinite uses `dur`).
   * Falls back to 1s when none parse.
   */
  getLoopDuration(): number {
    let max = 0;
    for (const desc of this.descs) {
      const timing = desc.timing;
      const dur = parseDurationSecs(timing.dur) ?? 0;
      const begin = timing.begin
        ? (parseDurationSecs(timing.begin) ?? 0)
        : 0;
      const { indefinite, count } = parseRepeat(timing.repeat);
      const cycles = indefinite ? 1 : Math.max(1, count);
      max = Math.max(max, begin + dur * cycles);
    }
    return max > 0 ? max : 1;
  }

  /** Re-bind transform targets after a scene rebuild. */
  bindTransforms(root: THREE.Object3D): void {
    this.transformBindings = [];
    for (const desc of this.descs) {
      if (desc.kind !== "transform") continue;
      const id = desc.parent_id;
      if (!id) continue;
      const object = findObjectByGroupId(root, id);
      if (!object) continue;
      object.updateMatrix();
      this.transformBindings.push({
        desc,
        object,
        baseMatrix: object.matrix.clone(),
      });
    }
  }

  /**
   * Advance clock (when playing) and apply samples at the current document time.
   * Pass `{ force: true }` to sample while paused (scrubber).
   */
  applyFrame(
    deltaSecs: number,
    options: { force?: boolean } = {}
  ): { paramOverrides: ParamMap; paramsChanged: boolean } | null {
    if (this.descs.length === 0) return null;
    if (!this.playing && !options.force) return null;
    if (this.playing) this.docTime += Math.max(0, deltaSecs);
    return this.sampleAtDocTime();
  }

  /** Apply param + transform samples at `docTime` without advancing the clock. */
  sampleAtDocTime(): {
    paramOverrides: ParamMap;
    paramsChanged: boolean;
  } {
    const paramOverrides: ParamMap = {};
    for (const desc of this.descs) {
      if (desc.kind !== "param" || !desc.root_scope) continue;
      const v = sampleScalar(desc.timing, this.docTime);
      if (v == null) continue;
      const bare = desc.attribute_name.replace(/^--/, "");
      paramOverrides[bare] = v;
    }

    const key = JSON.stringify(paramOverrides);
    const paramsChanged = key !== this.lastParamKey;
    if (paramsChanged) this.lastParamKey = key;

    for (const bind of this.transformBindings) {
      const mAnim = sampleAnimateTransformMatrix(
        bind.desc.transform_type,
        bind.desc.timing,
        this.docTime
      );
      if (!mAnim) {
        bind.object.matrix.copy(bind.baseMatrix);
      } else {
        bind.object.matrix.copy(bind.baseMatrix);
        bind.object.matrix.premultiply(mAnim);
      }
      bind.object.matrix.decompose(
        bind.object.position,
        bind.object.quaternion,
        bind.object.scale
      );
      bind.object.matrixWorldNeedsUpdate = true;
    }

    return { paramOverrides, paramsChanged };
  }
}

/** Prefer shallowest object whose pick data groupId / nodeId matches. */
export function findObjectByGroupId(
  root: THREE.Object3D,
  groupId: string
): THREE.Object3D | null {
  let best: THREE.Object3D | null = null;
  let bestDepth = Infinity;
  root.traverse((obj) => {
    const data = getPickData(obj);
    const nameMatch = obj.name === groupId;
    const idMatch =
      data?.groupId === groupId || data?.nodeId === groupId;
    if (!nameMatch && !idMatch) return;
    let depth = 0;
    for (let p = obj.parent; p; p = p.parent) depth += 1;
    if (depth < bestDepth) {
      bestDepth = depth;
      best = obj;
    }
  });
  return best;
}
