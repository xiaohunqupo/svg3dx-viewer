import type { Camera, Object3D, Vector3, WebGLRenderer } from "three";

export class ViewHelper extends Object3D {
  constructor(camera: Camera, domElement: HTMLElement);
  animating: boolean;
  center: Vector3;
  render(renderer: WebGLRenderer): void;
  handleClick(event: PointerEvent): boolean;
  setLabels(labelX?: string, labelY?: string, labelZ?: string): void;
  setLabelStyle(font?: string, color?: string, radius?: number): void;
  update(delta: number): void;
  dispose(): void;
}
