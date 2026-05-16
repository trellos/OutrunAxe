import * as THREE from "three";

const OUTLINE_MAT = new THREE.MeshBasicMaterial({
  color: 0x000000,
  side: THREE.BackSide,
});

export function addOutline(mesh: THREE.Mesh, scale = 1.05): THREE.Mesh {
  const outline = new THREE.Mesh(mesh.geometry, OUTLINE_MAT);
  outline.scale.setScalar(scale);
  outline.renderOrder = -1;
  mesh.add(outline);
  return outline;
}
