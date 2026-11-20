import * as THREE from "three";

/**
 * World XY reference plane (svg3dx Z-up): outer rectangle + semi-transparent fill.
 * No interior grid lines — AxesHelper owns the RGB frame.
 */
export class PlaneHelper extends THREE.Group {
  readonly isSvg3dxPlaneHelper = true;

  private readonly border: THREE.LineLoop;
  private readonly fill: THREE.Mesh;

  constructor(size = 10, color: THREE.ColorRepresentation = 0x7eb6e8) {
    super();
    this.name = "svg3dx-world-plane";

    const half = size / 2;
    const c = new THREE.Color(color);

    const borderGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-half, -half, 0),
      new THREE.Vector3(half, -half, 0),
      new THREE.Vector3(half, half, 0),
      new THREE.Vector3(-half, half, 0),
    ]);
    // Priority: AxesHelper > PlaneHelper > other scene solids (see createViewer).
    const planeRenderOrder = 1;

    const borderMat = new THREE.LineBasicMaterial({
      color: c,
      toneMapped: false,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      // Bias toward camera so coplanar entity edges lose to the frame.
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.border = new THREE.LineLoop(borderGeom, borderMat);
    this.border.name = "svg3dx-world-plane-border";
    this.border.renderOrder = planeRenderOrder;

    const fillGeom = new THREE.PlaneGeometry(size, size);
    const fillMat = new THREE.MeshBasicMaterial({
      color: c,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      // Win z-fighting against coplanar entity faces; still occluded when behind.
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.fill = new THREE.Mesh(fillGeom, fillMat);
    this.fill.name = "svg3dx-world-plane-fill";
    this.fill.renderOrder = planeRenderOrder;

    this.add(this.fill);
    this.add(this.border);
    this.renderOrder = planeRenderOrder;
  }

  dispose(): void {
    this.border.geometry.dispose();
    (this.border.material as THREE.Material).dispose();
    this.fill.geometry.dispose();
    (this.fill.material as THREE.Material).dispose();
  }
}
