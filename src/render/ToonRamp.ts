import * as THREE from "three";

export function makeToonRamp(steps = 3): THREE.DataTexture {
  const arr = new Uint8Array(steps);
  for (let i = 0; i < steps; i++) {
    arr[i] = Math.round(((i + 1) / steps) * 255);
  }
  const tex = new THREE.DataTexture(arr, steps, 1, THREE.RedFormat);
  tex.needsUpdate = true;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

let shared: THREE.DataTexture | null = null;
export function sharedToonRamp(): THREE.DataTexture {
  if (!shared) shared = makeToonRamp(3);
  return shared;
}
