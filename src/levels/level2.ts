import * as THREE from "three";
import type { PitchClass } from "../music/keys";
import type { LevelConfig, EnemySpawn } from "./level1";

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
  spawns: (() => {
    // Moderate: 12 enemies in G major (G A B C D E F#). F# lets the key
    // resolver narrow off C major. Spread beats 2..15 with 2-3 enemy clusters
    // on downbeats 5/9/13; ~3 hp=2 enemies. travelBeats stays 4 at 110 BPM.
    const schedule: Array<{ beat: number; pc: PitchClass; lane: number; hp: number }> = [
      { beat: 2, pc: "G", lane: -2, hp: 1 },
      { beat: 3, pc: "A", lane: 1.5, hp: 1 },
      { beat: 5, pc: "B", lane: -1, hp: 1 },
      { beat: 5, pc: "D", lane: 2, hp: 1 },
      { beat: 5.5, pc: "F#", lane: 0, hp: 2 },
      { beat: 7, pc: "E", lane: -1.5, hp: 1 },
      { beat: 8.5, pc: "G", lane: 1, hp: 1 },
      { beat: 9, pc: "C", lane: -2, hp: 1 },
      { beat: 9.5, pc: "F#", lane: 2, hp: 2 },
      { beat: 11, pc: "A", lane: -1, hp: 1 },
      { beat: 13, pc: "B", lane: 1.5, hp: 1 },
      { beat: 13.5, pc: "D", lane: -0.5, hp: 2 },
    ];
    const spawns: EnemySpawn[] = schedule.map((s) => ({
      beat: s.beat,
      pitchClass: s.pc,
      travelBeats: 4,
      hp: s.hp,
      lane: s.lane,
    }));
    return spawns;
  })(),
};
