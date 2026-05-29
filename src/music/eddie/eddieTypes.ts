// Shared contracts for the "Infinite Eddie" jam-for-16-bars score-run mode.
//
// This file is the contract surface between Gameplay, Art, and Sound (GDD §6).
// It is published FIRST so Art and Sound can compile against stable types.
// PitchClass/KeyMode come from the existing music key tables in
// src/music/keys.ts — Infinite Eddie reuses the same pitch-class vocabulary as
// combat so the scorer can share KeyResolver's pitchFired stream.

import type { PitchClass, KeyMode } from "../keys";

// Re-export so downstream modules (Art/Sound) can pull the key vocabulary from
// the contract surface without reaching into combat's key tables directly.
export type { PitchClass, KeyMode } from "../keys";

// ---------------------------------------------------------------------------
// 6.1 Settings -> mode handoff
// ---------------------------------------------------------------------------

/** Everything the settings screen produces and hands to the play state. */
export interface EddieConfig {
  bpm: number; // 60..200, default 120
  keyRoot: PitchClass; // "C", "E", ...
  keyMode: KeyMode; // "major" | "minor"
  bassline: BasslineNote[]; // 4 intro measures' worth (see 6.2), loops thereafter
  /** Which scored measure (0..15) is tagged for 8th notes. Lands in grid row 2
   *  or 3 (i.e. scored measure 4..11). */
  eighthTagMeasure: number;
  /** Which scored measure (0..15) is tagged for 16th notes. Lands in grid row 3
   *  or 4 (i.e. scored measure 8..15) and is always a different measure than
   *  eighthTagMeasure. */
  sixteenthTagMeasure: number;
}

// ---------------------------------------------------------------------------
// 6.2 Bassline data format
// ---------------------------------------------------------------------------

export interface BasslineNote {
  /** 0..3 — which of the 4 bassline measures this note belongs to. The play
   *  state loops this 4-measure pattern across all 20 measures (intro + scored),
   *  so scored measure m uses bassline measure (m % 4). */
  measure: number;
  /** Beat offset within the measure where the bass note starts: 0..3 (quarter
   *  positions only for v1). The FIRST note of each measure (beat 0) defines the
   *  active chord for that measure's chord-tone bonus. */
  beat: number;
  /** Pitch class of the bass note (the chord root for that span). */
  pitchClass: PitchClass;
  /** The chord tones for the bonus check: typically [root, 3rd, 5th] of the
   *  triad implied by this bass note within the selected key. Ending a
   *  quarter-note on any of these pitch classes earns the chord-tone bonus.
   *  Precomputed by basslineGen so the scorer stays pure key-agnostic logic. */
  chordTones: PitchClass[];
}

/**
 * Generate a simple rock bass line diatonic to the selected key: 4 measures,
 * 1–2 notes per measure, every pitchClass in key. Deterministic under an
 * injected RNG. Implemented in basslineGen.ts (owned by Gameplay).
 */
export type GenerateBassline = (
  keyRoot: PitchClass,
  keyMode: KeyMode,
  rng?: () => number,
) => BasslineNote[];

// ---------------------------------------------------------------------------
// 6.3 Per-quarter-note scoring
// ---------------------------------------------------------------------------

export type EddieScoreKind =
  | "quarter" // baseline scored quarter
  | "eighth" // 8th-note subdivision bonus present in this quarter
  | "sixteenth" // 16th-note subdivision bonus present in this quarter
  | "chordTone" // ended on a chord tone of the bass's current chord
  | "eighthTagClear" // the 8th-tagged measure played all-8ths
  | "sixteenthTagClear" // the 16th-tagged measure played all-16ths
  | "outOfKey"; // note(s) not in key — zero points, still emitted for feedback

export interface EddieScoreEvent {
  /** Total points awarded for this scoring opportunity (>=0). */
  points: number;
  /** Score multiplier that drove `points` (1 = baseline). Bigger multiple =>
   *  bigger juice (see 6.4). */
  multiplier: number;
  measure: number; // scored measure index 0..15
  beat: number; // quarter index within the measure 0..3
  /** Tags describing what earned points this quarter (may be multiple). */
  kinds: EddieScoreKind[];
  /** Pixel-space origin hint for particles: where this note sits on the grid.
   *  Art may ignore and recompute from (measure,beat); provided for convenience.
   *  Null if the play state can't resolve it yet. */
  originHint: { x: number; y: number } | null;
  audioTime: number; // event audio-clock time
}

export type EddieScorerEvents = {
  eddieScore: EddieScoreEvent;
  /** Cumulative running total after applying the latest eddieScore. */
  eddieTotal: { total: number; lastDelta: number; audioTime: number };
};

// ---------------------------------------------------------------------------
// 6.4 Juice events
// ---------------------------------------------------------------------------

export type EddieJuiceEvents = {
  /** Camera/background shake. magnitude grows with score multiplier. */
  eddieShake: { magnitude: number; audioTime: number };
  /** Particles should fly from origin to the score readout. */
  eddieParticles: {
    from: { x: number; y: number };
    count: number; // scales with points
    color: string; // hex; Art may override per variant
    audioTime: number;
  };
  /** Light a grid measure on fire. tier 1 = 8th clear, tier 2 = 16th clear. */
  eddieFire: { measure: number; tier: 1 | 2; audioTime: number };
  /** Background should pulse on this beat (Art interpolates the decay). */
  eddieBeatPulse: { beatInMeasure: number; downbeat: boolean; audioTime: number };
  /** The score number should visually increment to `total`. */
  eddieScorePop: { total: number; delta: number; audioTime: number };
};
