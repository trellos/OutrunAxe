import * as THREE from "three";
import type { PitchClass } from "../music/keys";

export interface EnemySpawn {
  beat: number;
  pitchClass: PitchClass;
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
  spawns: (() => {
    const cMajor: PitchClass[] = ["C", "D", "E", "F", "G", "A", "B", "C"];
    // Gentle tutorial, threat-ramped: 10 enemies. `beat` is the ARRIVAL beat
    // (when the enemy reaches the player). Every enemy uses travelBeats =
    // beat + 4 so it SPAWNS at the count-in downbeat — the whole wave is
    // visible from the count-in, just far away. The eased approach curve
    // (Enemy.update) holds them at distance until late, and arrivals are
    // packed into the 3rd/4th measures (beats 11..15.5) so nothing is "very
    // close" until the player has had a few measures. All hp=1 except the
    // final two so the matching loop is learned unhurried.
    const schedule: Array<{ beat: number; pcIdx: number; lane: number; hp: number }> = [
      { beat: 11, pcIdx: 0, lane: -2, hp: 1 },
      { beat: 12, pcIdx: 2, lane: 2, hp: 1 },
      { beat: 12.5, pcIdx: 4, lane: -1, hp: 1 },
      { beat: 13, pcIdx: 1, lane: 1.5, hp: 1 },
      { beat: 13.5, pcIdx: 3, lane: -2, hp: 1 },
      { beat: 14, pcIdx: 5, lane: 0, hp: 1 },
      { beat: 14.5, pcIdx: 6, lane: 2, hp: 1 },
      { beat: 15, pcIdx: 0, lane: -1.5, hp: 1 },
      { beat: 15.25, pcIdx: 4, lane: 1, hp: 2 },
      { beat: 15.5, pcIdx: 7, lane: 0, hp: 2 },
    ];
    return schedule.map((s) => ({
      beat: s.beat,
      pitchClass: cMajor[s.pcIdx],
      travelBeats: s.beat + 4,
      hp: s.hp,
      lane: s.lane,
    }));
  })(),
};
