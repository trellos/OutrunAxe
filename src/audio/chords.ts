import { NOTE_NAMES } from "./midi";
import type { PitchClass } from "../music/keys";

/**
 * Pure (no WebAudio) chord helpers used by the enemy-dispatch sound.
 *
 * The dispatch chord's ROOT is the pitch class of the note that killed the
 * enemy, so the burst feels musically tied to the shot that landed it.
 */

/** Semitone offsets from the root for the supported triads. Exported so the
 *  audio layer and tests can reason about voicing without re-deriving them.
 *  Major triad = root, major third (+4), perfect fifth (+7); minor swaps the
 *  third for a minor third (+3). */
export const TRIAD_INTERVALS = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
} as const;

export type ChordMode = keyof typeof TRIAD_INTERVALS;

/**
 * Octave at which the chord root is voiced. MIDI 48 is C3 — low enough that
 * the triad sits under the per-note "good note" blips (which voice around
 * middle C / C4 = 60) without muddying them, while staying audible over the
 * drums. The whole triad therefore lives in the C3..C4 region.
 */
export const CHORD_ROOT_MIDI_BASE = 48;

/**
 * Build the absolute MIDI numbers for a triad whose root is `pc`.
 *
 * @param pc   Root pitch class (e.g. the killing note's pitch class).
 * @param mode "major" (default) or "minor" triad.
 * @returns    Three MIDI numbers [root, third, fifth], root voiced at
 *             {@link CHORD_ROOT_MIDI_BASE}'s octave so the chord stays in a
 *             consistent, low-ish register regardless of the pitch class.
 */
export function chordForPitchClass(pc: PitchClass, mode: ChordMode = "major"): number[] {
  const pcIndex = NOTE_NAMES.indexOf(pc);
  // Defensive: an unknown pitch class falls back to C so callers never get NaN
  // oscillator frequencies.
  const rootIdx = pcIndex < 0 ? 0 : pcIndex;
  const root = CHORD_ROOT_MIDI_BASE + rootIdx;
  return TRIAD_INTERVALS[mode].map((iv) => root + iv);
}
