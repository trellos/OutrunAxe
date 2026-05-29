import * as THREE from "three";
import type { KeyMode, PitchClass } from "../music/keys";
import { buildSharedWaveSpawns } from "./waves";

export interface EnemySpawn {
  beat: number;
  pitchClass: PitchClass;
  /** Tonic of the key the enemy lives in. Defaults to `pitchClass`. Allowing
   *  this to differ lets a wave put several distinctly-labelled enemies all
   *  inside one shared key (e.g. wave 1 = all in C major). */
  keyRoot?: PitchClass;
  /** Major vs natural minor. Used by wave 3+ to add relative-minor enemies
   *  alongside their major counterparts. */
  keyMode?: KeyMode;
  travelBeats: number;
  hp: number;
  lane: number;
}

export interface LevelConfig {
  name: string;
  bpm: number;
  curve: THREE.CatmullRomCurve3;
  spawns: EnemySpawn[];
  decorCount: number;
  skyColor: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
}

function makeStripMallCurve(): THREE.CatmullRomCurve3 {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i++) {
    const z = -i * 20;
    const x = Math.sin(i * 0.35) * 4;
    pts.push(new THREE.Vector3(x, 1.6, z));
  }
  return new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.5);
}

export const level1: LevelConfig = {
  name: "Strip Mall Sunset",
  bpm: 90,
  curve: makeStripMallCurve(),
  decorCount: 80,
  skyColor: 0x1a0f2e,
  fogColor: 0x2a1145,
  fogNear: 30,
  fogFar: 180,
  // All three levels share the same enemy schedule — for now levels differ
  // only in background and tempo. See src/levels/waves.ts.
  spawns: buildSharedWaveSpawns(),
};
