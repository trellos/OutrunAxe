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
    // Tutorial wave: TWO keys (C major and E major) so the key-narrowing puzzle
    // is actually visible. Shared notes E/A/B hit both groups; C/D/F/G hit only
    // C-rooted enemies; F#/G#/C#/D# hit only E-rooted enemies.
    //
    // travelBeats = 12 (3 measures) for every spawn — the player has a full
    // three measures from spawn to arrival, plenty of read time. Arrivals are
    // spread across the play window so each enemy reads as a distinct wave.
    // hp = 2.5 for early enemies pairs with the root-note 2.5× damage bonus
    // (BulletSystem) so: 2 non-root in-key notes chip (≈2.0), root + non-root
    // kills (≈3.5), single full-confidence root one-shots (=2.5).
    const schedule: Array<{ beat: number; pc: PitchClass; lane: number; hp: number }> = [
      { beat: 8,    pc: "C", lane: -1.5, hp: 2.5 },
      { beat: 12,   pc: "E", lane:  1.5, hp: 2.5 },
      { beat: 16,   pc: "C", lane: -1,   hp: 2.5 },
      { beat: 19,   pc: "E", lane:  1,   hp: 2.5 },
      { beat: 22,   pc: "C", lane: -2,   hp: 2.5 },
      { beat: 24,   pc: "E", lane:  2,   hp: 2.5 },
      { beat: 26.5, pc: "C", lane: -0.5, hp: 4   },
      { beat: 29,   pc: "E", lane:  0.5, hp: 4   },
    ];
    return schedule.map((s) => ({
      beat: s.beat,
      pitchClass: s.pc,
      travelBeats: 12,
      hp: s.hp,
      lane: s.lane,
    }));
  })(),
};
