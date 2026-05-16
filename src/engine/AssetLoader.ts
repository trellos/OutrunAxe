import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as skeletonClone } from "three/addons/utils/SkeletonUtils.js";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";

// Served from public/assets at site root by Vite.
const CHARACTER_URL = "assets/character.glb";

const loader = new GLTFLoader();
const cache = new Map<string, Promise<GLTF>>();

function load(url: string): Promise<GLTF> {
  let pending = cache.get(url);
  if (!pending) {
    pending = new Promise<GLTF>((resolve, reject) => {
      loader.load(url, resolve, undefined, reject);
    });
    cache.set(url, pending);
  }
  return pending;
}

/**
 * Loads (and caches) the rigged character GLB. Resolves with the raw GLTF;
 * callers should clone the scene via cloneScene() before adding to the graph.
 */
export function loadCharacter(): Promise<GLTF> {
  return load(CHARACTER_URL);
}

/**
 * Deep-clones a loaded GLTF scene, preserving skinned-mesh bone bindings via
 * SkeletonUtils. Returns an independent Object3D safe to mutate per instance.
 */
export function cloneScene(gltf: GLTF): THREE.Object3D {
  return skeletonClone(gltf.scene) as THREE.Object3D;
}
