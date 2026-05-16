import * as THREE from "three";
import type { PitchClass } from "../music/keys";
import type { LevelConfig, EnemySpawn } from "./level1";

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
  spawns: (() => {
    // Hard but fair: 16 enemies in E minor/major flavor (E F# G A B C D#).
    // Spread beats 2..15 with up to 4-enemy bursts on downbeats 5/9/13 and a
    // hp=3 boss finale at beat 15. travelBeats raised to 4 (130 BPM is fast).
    const schedule: Array<{ beat: number; pc: PitchClass; lane: number; hp: number }> = [
      { beat: 2, pc: "E", lane: -2, hp: 1 },
      { beat: 3, pc: "F#", lane: 1.5, hp: 1 },
      { beat: 4, pc: "G", lane: -1, hp: 2 },
      { beat: 5, pc: "B", lane: -2, hp: 1 },
      { beat: 5, pc: "A", lane: 0, hp: 1 },
      { beat: 5.5, pc: "D#", lane: 2, hp: 2 },
      { beat: 6, pc: "C", lane: -1.5, hp: 1 },
      { beat: 8, pc: "E", lane: 1, hp: 2 },
      { beat: 9, pc: "F#", lane: -2, hp: 1 },
      { beat: 9, pc: "B", lane: 0, hp: 1 },
      { beat: 9.5, pc: "G", lane: 2, hp: 2 },
      { beat: 11, pc: "A", lane: -1, hp: 1 },
      { beat: 12, pc: "C", lane: 1.5, hp: 2 },
      { beat: 13, pc: "D#", lane: -2, hp: 1 },
      { beat: 13.5, pc: "F#", lane: 0.5, hp: 2 },
      { beat: 15, pc: "E", lane: 0, hp: 3 },
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
