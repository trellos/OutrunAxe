// Shared enemy-spawn schedule used by every level. Levels currently differ
// only in background, BPM, and curve — the actual gameplay (which enemies
// spawn and when) is identical.
//
// Layout: PLAY_BEATS = 128 (32 measures). A wave of enemies enters every 8
// measures (every 32 beats), so the play window holds four waves of escalating
// difficulty:
//
//   Wave 1 (measures 0–7)   easy   — all enemies share one key (C major).
//   Wave 2 (measures 8–15)  medium — two keys sharing 5 notes (C maj + D maj).
//   Wave 3 (measures 16–23) hard   — a key and its relative minor
//                                    (C maj + A min — identical pitch set, but
//                                    different roots, so root-shots diverge).
//   Wave 4 (measures 24–31) hardest— two keys plus one relative minor
//                                    (C maj + G maj + E min, the rel. minor
//                                    of G). Three roots to track simultaneously.
//
// Every enemy uses travelBeats = 12 (3 measures of approach) so the player
// has plenty of read time. Arrivals are spread inside each wave so a wave
// reads as 6–7 distinct beats, not a wall.

import type { KeyMode, PitchClass } from "../music/keys";
import type { EnemySpawn } from "./level1";

const TRAVEL_BEATS = 12;
const HP_NORMAL = 2.5;
const HP_BOSS = 4;

interface WaveEnemy {
  /** Beat OFFSET from the wave start (not absolute). */
  offset: number;
  pitchClass: PitchClass;
  keyRoot: PitchClass;
  keyMode: KeyMode;
  lane: number;
  hp: number;
}

interface Wave {
  startBeat: number;
  enemies: WaveEnemy[];
}

// Wave 1 — single key (C major). Every enemy lives in C major; only their
// labels (= root-shot trigger) differ, drawn from the C-major scale.
const WAVE_1: Wave = {
  startBeat: 0,
  enemies: [
    { offset: 8,  pitchClass: "C", keyRoot: "C", keyMode: "major", lane: -1.5, hp: HP_NORMAL },
    { offset: 12, pitchClass: "E", keyRoot: "C", keyMode: "major", lane:  1.5, hp: HP_NORMAL },
    { offset: 16, pitchClass: "G", keyRoot: "C", keyMode: "major", lane: -1,   hp: HP_NORMAL },
    { offset: 20, pitchClass: "D", keyRoot: "C", keyMode: "major", lane:  1,   hp: HP_NORMAL },
    { offset: 24, pitchClass: "F", keyRoot: "C", keyMode: "major", lane: -2,   hp: HP_NORMAL },
    { offset: 28, pitchClass: "C", keyRoot: "C", keyMode: "major", lane:  0,   hp: HP_NORMAL },
  ],
};

// Wave 2 — two keys sharing 5 notes. C major = {C D E F G A B}, D major =
// {D E F# G A B C#}. Shared: {D E G A B} (5 notes). C-only: F, C. D-only: F#,
// C#. Mix labels so the player needs to read each enemy.
const WAVE_2: Wave = {
  startBeat: 32,
  enemies: [
    { offset: 4,  pitchClass: "C",  keyRoot: "C", keyMode: "major", lane: -1.5, hp: HP_NORMAL },
    { offset: 8,  pitchClass: "D",  keyRoot: "D", keyMode: "major", lane:  1.5, hp: HP_NORMAL },
    { offset: 12, pitchClass: "F",  keyRoot: "C", keyMode: "major", lane: -1,   hp: HP_NORMAL },
    { offset: 16, pitchClass: "F#", keyRoot: "D", keyMode: "major", lane:  1,   hp: HP_NORMAL },
    { offset: 20, pitchClass: "G",  keyRoot: "C", keyMode: "major", lane: -2,   hp: HP_NORMAL },
    { offset: 24, pitchClass: "C#", keyRoot: "D", keyMode: "major", lane:  2,   hp: HP_NORMAL },
    { offset: 28, pitchClass: "D",  keyRoot: "D", keyMode: "major", lane:  0,   hp: HP_BOSS  },
  ],
};

// Wave 3 — C major + A minor (the relative minor of C). They share the same
// pitch set {C D E F G A B}, so an in-key note hits both groups; but the
// roots diverge — C-major enemies root on C, A-minor enemies root on A. The
// player now has to track two tonal centres inside one scale.
const WAVE_3: Wave = {
  startBeat: 64,
  enemies: [
    { offset: 4,  pitchClass: "C", keyRoot: "C", keyMode: "major", lane: -1.5, hp: HP_NORMAL },
    { offset: 8,  pitchClass: "A", keyRoot: "A", keyMode: "minor", lane:  1.5, hp: HP_NORMAL },
    { offset: 12, pitchClass: "E", keyRoot: "C", keyMode: "major", lane: -1,   hp: HP_NORMAL },
    { offset: 16, pitchClass: "A", keyRoot: "A", keyMode: "minor", lane:  1,   hp: HP_NORMAL },
    { offset: 20, pitchClass: "C", keyRoot: "C", keyMode: "major", lane: -2,   hp: HP_NORMAL },
    { offset: 24, pitchClass: "A", keyRoot: "A", keyMode: "minor", lane:  2,   hp: HP_BOSS  },
    { offset: 28, pitchClass: "C", keyRoot: "C", keyMode: "major", lane:  0,   hp: HP_BOSS  },
  ],
};

// Wave 4 — C major + G major + E minor (E minor is the relative minor of G).
//   C major: {C D E F G A B}
//   G major: {G A B C D E F#}
//   E minor: {E F# G A B C D} (= G-major pitch set)
// Some notes hit all three groups; some narrow to one. Three roots to track
// — the hardest tier.
const WAVE_4: Wave = {
  startBeat: 96,
  enemies: [
    { offset: 4,  pitchClass: "C",  keyRoot: "C", keyMode: "major", lane: -1.5, hp: HP_NORMAL },
    { offset: 8,  pitchClass: "G",  keyRoot: "G", keyMode: "major", lane:  1.5, hp: HP_NORMAL },
    { offset: 12, pitchClass: "E",  keyRoot: "E", keyMode: "minor", lane: -1,   hp: HP_NORMAL },
    { offset: 16, pitchClass: "F#", keyRoot: "G", keyMode: "major", lane:  1,   hp: HP_NORMAL },
    { offset: 20, pitchClass: "F",  keyRoot: "C", keyMode: "major", lane: -2,   hp: HP_NORMAL },
    { offset: 24, pitchClass: "E",  keyRoot: "E", keyMode: "minor", lane:  2,   hp: HP_BOSS  },
    { offset: 28, pitchClass: "C",  keyRoot: "C", keyMode: "major", lane:  0,   hp: HP_BOSS  },
  ],
};

const WAVES: Wave[] = [WAVE_1, WAVE_2, WAVE_3, WAVE_4];

export function buildSharedWaveSpawns(): EnemySpawn[] {
  const out: EnemySpawn[] = [];
  for (const w of WAVES) {
    for (const e of w.enemies) {
      out.push({
        beat: w.startBeat + e.offset,
        pitchClass: e.pitchClass,
        keyRoot: e.keyRoot,
        keyMode: e.keyMode,
        travelBeats: TRAVEL_BEATS,
        hp: e.hp,
        lane: e.lane,
      });
    }
  }
  return out;
}
