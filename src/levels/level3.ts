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
    // Hard: 10 enemies across FOUR root keys (E, A, F#, C#). Lots of shared
    // notes between adjacent keys but no single in-key note hits all four —
    // the player has to actually read the label, not just spray scale notes.
    // travelBeats = 12 (≈ 2.2 s at 130 BPM, still three measures). hp 2.5
    // normal / 4 boss / 5 final to give the multi-key pressure some teeth.
    const schedule: Array<{ beat: number; pc: PitchClass; lane: number; hp: number }> = [
      { beat: 8,    pc: "E",  lane: -1.5, hp: 2.5 },
      { beat: 9.5,  pc: "A",  lane:  1.5, hp: 2.5 },
      { beat: 11,   pc: "F#", lane: -1,   hp: 2.5 },
      { beat: 13,   pc: "C#", lane:  1,   hp: 2.5 },
      { beat: 15,   pc: "E",  lane: -2,   hp: 2.5 },
      { beat: 17,   pc: "A",  lane:  2,   hp: 2.5 },
      { beat: 18.5, pc: "F#", lane: -0.5, hp: 2.5 },
      { beat: 20,   pc: "C#", lane:  0.5, hp: 2.5 },
      { beat: 22,   pc: "E",  lane: -1,   hp: 4   },
      { beat: 24,   pc: "A",  lane:  1,   hp: 4   },
      { beat: 26,   pc: "F#", lane: -2,   hp: 4   },
      { beat: 28,   pc: "C#", lane:  2,   hp: 4   },
      { beat: 30,   pc: "E",  lane:  0,   hp: 5   },
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
