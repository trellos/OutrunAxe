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
    // Moderate: 8 enemies across THREE root keys (G, B, D). G + B share only D
    // and F#; D + G share many; B + D share F# — the player has to commit to
    // one key per enemy. travelBeats = 12 (≈ 2.6 s at 110 BPM, three measures
    // of read time). HP 2.5 normal / 4 boss matches the root-multiplier
    // damage table (BulletSystem.ts).
    const schedule: Array<{ beat: number; pc: PitchClass; lane: number; hp: number }> = [
      { beat: 8,    pc: "G", lane: -1.5, hp: 2.5 },
      { beat: 10,   pc: "B", lane:  1.5, hp: 2.5 },
      { beat: 12.5, pc: "D", lane: -1,   hp: 2.5 },
      { beat: 15,   pc: "G", lane:  1,   hp: 2.5 },
      { beat: 17,   pc: "B", lane: -2,   hp: 2.5 },
      { beat: 19.5, pc: "D", lane:  2,   hp: 2.5 },
      { beat: 22,   pc: "G", lane: -0.5, hp: 2.5 },
      { beat: 24,   pc: "B", lane:  1,   hp: 4   },
      { beat: 26.5, pc: "D", lane: -1.5, hp: 4   },
      { beat: 28,   pc: "G", lane:  0.5, hp: 4   },
      { beat: 30,   pc: "B", lane:  0,   hp: 4   },
    ];
    const spawns: EnemySpawn[] = schedule.map((s) => ({
      beat: s.beat,
      pitchClass: s.pc,
      travelBeats: 12,
      hp: s.hp,
      lane: s.lane,
    }));
    return spawns;
  })(),
};
