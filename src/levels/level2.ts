import * as THREE from "three";
import type { LevelConfig } from "./level1";
import { buildSharedWaveSpawns } from "./waves";

function makeSubwayCurve(): THREE.CatmullRomCurve3 {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 22; i++) {
    const z = -i * 18;
    const x = Math.sin(i * 0.12) * 1.2;
    const y = 1.6 - i * 0.4;
    pts.push(new THREE.Vector3(x, y, z));
  }
  return new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.5);
}

export const level2: LevelConfig = {
  name: "Subway Mezzanine",
  bpm: 110,
  curve: makeSubwayCurve(),
  decorCount: 100,
  skyColor: 0x1a3a5a,
  fogColor: 0x0a2a3a,
  fogNear: 25,
  fogFar: 150,
  // All three levels share the same enemy schedule for now — see waves.ts.
  spawns: buildSharedWaveSpawns(),
};
