/// <reference types="vite/client" />

declare module "svg3dx-ffi-wasm" {
  export function parse_svg3dx(input: string): unknown;
  export function parse_svg3dx_json(input: string): string;
  export function parse_svg3dx_with_params(
    input: string,
    params_json: string,
    model?: string | null
  ): unknown;
  export default function init(module_or_path?: unknown): Promise<unknown>;
}

declare module "three/addons/controls/OrbitControls.js" {
  import type { Camera, EventDispatcher } from "three";
  export class OrbitControls extends EventDispatcher {
    constructor(object: Camera, domElement?: HTMLElement);
    enableDamping: boolean;
    target: import("three").Vector3;
    update(): boolean;
  }
}
