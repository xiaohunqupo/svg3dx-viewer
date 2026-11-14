import * as THREE from "three";

/** Convert svg3dx 12-number matrix (column-major 3×3 + translation) to THREE.Matrix4. */
export function mat4x3ToMatrix4(m: number[]): THREE.Matrix4 {
  if (m.length !== 12) {
    return new THREE.Matrix4();
  }
  // columns: (a,b,c), (d,e,f), (g,h,i), (tx,ty,tz)
  const mat = new THREE.Matrix4();
  mat.set(
    m[0], m[3], m[6], m[9],
    m[1], m[4], m[7], m[10],
    m[2], m[5], m[8], m[11],
    0, 0, 0, 1
  );
  return mat;
}
