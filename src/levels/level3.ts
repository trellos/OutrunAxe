import * as THREE from "three";
import type { LevelConfig } from "./level1";
import { buildSharedWaveSpawns } from "./waves";

function makeRooftopCurve(): THREE.CatmullRomCurve3 {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 26; i++) {
    const z = -i * 20;
    const x = Math.sin(i * 0.5) * 6;
    const y = 1.6 + i * 0.3;
    pts.push(new THREE.Vector3(x, y, z));
  }
  return new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.5);
}

export const level3: LevelConfig = {
  name: "Rooftop Skyline",
  bpm: 130,
  curve: makeRooftopCurve(),
  decorCount: 60,
  skyColor: 0x05020f,
  fogColor: 0x1a0a3a,
  fogNear: 40,
  fogFar: 220,
  // All three levels share the same enemy schedule for now — see waves.ts.
  spawns: buildSharedWaveSpawns(),
};
