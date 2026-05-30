// Generates a simple rock bass line for Infinite Eddie (GDD §6.2).
//
// Rules (v1): pick a diatonic I–IV–V-ish rock movement in the selected key;
// one note in most measures, two in at most one or two; EVERY pitch class is
// in the selected key. `chordTones` for each note is the diatonic triad built
// on that scale degree (root, 3rd, 5th stacked within the key's 7-note scale),
// so the scorer's chord-tone bonus stays pure, key-agnostic membership logic.
//
// Determinism: all randomness flows through the injected `rng` (default
// Math.random), so tests pin a sequence and assert exact output.

import { NOTE_NAMES } from "../../audio/midi";
import { keyPitchClasses, type PitchClass, type KeyMode } from "../keys";
import type { BasslineNote } from "./eddieTypes";

const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10];

/**
 * Candidate rock progressions expressed as scale degrees (0-indexed: 0 = I,
 * 3 = IV, 4 = V, 5 = vi). One entry per bassline measure (always 4). All are
 * diatonic so every resulting note lands in key for both major and minor.
 */
const PROGRESSIONS: number[][] = [
  [0, 3, 4, 0], // I  IV V  I  — classic
  [0, 4, 5, 3], // I  V  vi IV — pop-rock
  [0, 5, 3, 4], // I  vi IV V  — 50s changes
  [0, 3, 0, 4], // I  IV I  V  — blues-ish
];

/** Build the ordered 7-note scale (as pitch classes) for the key. */
function scaleFor(keyRoot: PitchClass, keyMode: KeyMode): PitchClass[] {
  const intervals = keyMode === "minor" ? MINOR_INTERVALS : MAJOR_INTERVALS;
  const rootIdx = NOTE_NAMES.indexOf(keyRoot);
  return intervals.map((iv) => NOTE_NAMES[(rootIdx + iv) % 12]);
}

/** The diatonic triad (root, 3rd, 5th) stacked on `degree` within `scale`. */
function diatonicTriad(scale: PitchClass[], degree: number): PitchClass[] {
  return [degree, degree + 2, degree + 4].map((d) => scale[d % scale.length]);
}

export function generateBassline(
  keyRoot: PitchClass,
  keyMode: KeyMode,
  rng: () => number = Math.random,
): BasslineNote[] {
  const scale = scaleFor(keyRoot, keyMode);
  const progression = PROGRESSIONS[Math.floor(rng() * PROGRESSIONS.length) % PROGRESSIONS.length];

  const notes: BasslineNote[] = [];
  for (let measure = 0; measure < 4; measure++) {
    const degree = progression[measure];
    const pitchClass = scale[degree % scale.length];
    const chordTones = diatonicTriad(scale, degree);

    // The downbeat note (beat 0) defines the active chord for the measure's
    // chord-tone bonus — always present.
    notes.push({ measure, beat: 0, pitchClass, chordTones });
  }

  // Decide which (at most two) measures get a second note, deterministically.
  const measureOrder = [0, 1, 2, 3];
  // Fisher–Yates with the injected rng so selection is deterministic in tests.
  for (let i = measureOrder.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = measureOrder[i];
    measureOrder[i] = measureOrder[j];
    measureOrder[j] = tmp;
  }
  const walkupCount = 1 + (rng() < 0.5 ? 1 : 0); // 1 or 2 measures get a 2nd note
  const walkupMeasures = new Set(measureOrder.slice(0, walkupCount));

  for (const measure of walkupMeasures) {
    const base = notes.find((n) => n.measure === measure)!;
    // Second note = the 5th of the chord (chordTones[2]), a stock rock walk.
    notes.push({
      measure,
      beat: 2,
      pitchClass: base.chordTones[2],
      chordTones: base.chordTones,
    });
  }

  // Stable order: by measure, then beat — so loop playback reads left to right.
  notes.sort((a, b) => (a.measure - b.measure) || (a.beat - b.beat));

  // Defensive guarantee: every emitted pitch class is in key. This should
  // always hold by construction (diatonic scale degrees), but assert so a
  // future progression edit can't silently leak an out-of-key note.
  const inKey = keyPitchClasses(keyRoot, keyMode);
  for (const n of notes) {
    if (!inKey.has(n.pitchClass)) {
      throw new Error(`basslineGen produced out-of-key note ${n.pitchClass} in ${keyRoot} ${keyMode}`);
    }
  }

  return notes;
}
