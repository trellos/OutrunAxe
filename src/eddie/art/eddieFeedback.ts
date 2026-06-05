// eddieFeedback — the shared note-feedback DETERMINATION for Infinite Eddie.
//
// The in-game timeline (EddieGrid, DOM) and the settings-screen timeline
// (EddieSettingsState, canvas) render to different surfaces, but they grade and
// colour the player's notes identically. That common logic lives HERE so the two
// screens can never drift apart: the colour palette, the note-bar colour rule,
// the timing-quality grade, the subdivision count, and the diamond colour +
// tile geometry. Each screen keeps only its own draw primitive (append a DOM
// tile vs. stroke a canvas path).

import { NOTE_NAMES } from "../../audio/midi";
import type { PitchClass } from "../../music/eddie/eddieTypes";

// --- Note-bar palette (GDD §8 warm gold/pink) ------------------------------
export const COLOR_ROOT = "#FFC837"; // bright gold — key root
export const COLOR_STRONG = "#FF6B9D"; // hot pink — 3rd/5th of the chord
export const COLOR_WEAK = "#FFB84D"; // warm orange — other in-key notes
export const COLOR_BOGUS = "#ff5a6e"; // red/pink — out-of-key notes

// --- Chord-tone row tints (always-on harmony cue) --------------------------
export const COLOR_CHORD_TINT_DARK = "#2D1B3D"; // deep purple — bass (root) row
export const COLOR_CHORD_TINT_MEDIUM = "#4A2E5A"; // lighter purple — 3rd/5th rows

/** Note-bar colour from pitch + key + chord context. `chordTones` are the pitch
 *  classes that count as the chord's 3rd/5th for the active measure (the root is
 *  handled here against `keyRoot`); pass null when the chord isn't known. */
export function noteColor(
  midi: number,
  keyRoot: string,
  chordTones: readonly PitchClass[] | null,
  inKey: boolean,
): string {
  if (!inKey) return COLOR_BOGUS;
  const pc = NOTE_NAMES[((midi % 12) + 12) % 12];
  if (pc === keyRoot) return COLOR_ROOT;
  if (chordTones && chordTones.includes(pc as PitchClass)) return COLOR_STRONG;
  return COLOR_WEAK;
}

/** Grade a note's timing: how close its position WITHIN its quarter (0..1) lands
 *  to the nearest musical subdivision point (eighth, sixteenth, or triplet).
 *  Returns 0 (loose) .. 1 (dead on the grid). */
export function timingQuality(fractionInQuarter: number): number {
  const f = ((fractionInQuarter % 1) + 1) % 1;
  const targets = [0, 1, 0.5, 0.25, 0.75, 1 / 3, 2 / 3];
  let best = 1;
  for (const t of targets) best = Math.min(best, Math.abs(f - t));
  // Worst-case nearest distance between the densest grid points is ~0.125.
  return Math.max(0, Math.min(1, 1 - best / 0.125));
}

/** The subdivision the player hit, from the count of notes in a quarter:
 *  1 = quarter, 2 = eighths, 3 = triplets, 4 = sixteenths. */
export function subdivisionCount(noteCount: number): number {
  return Math.max(1, Math.min(4, noteCount));
}

/** Diamond success colour for a timing quality: muted olive (loose) → vibrant
 *  gold (tight). Single source for both render surfaces. */
export function diamondColor(quality: number): string {
  const r = Math.round(150 + (255 - 150) * quality);
  const g = Math.round(135 + (215 - 135) * quality);
  const b = Math.round(70 + (0 - 70) * quality);
  const a = 0.5 + 0.4 * quality;
  return `rgba(${r},${g},${b},${a})`;
}

/** Diamond tile size for a quarter region `quarterW` wide split into `subdiv`
 *  diamonds across — tall (taller than wide) like argyle. */
export function diamondTile(quarterW: number, subdiv: number): { tileW: number; tileH: number } {
  const tileW = quarterW / subdiv;
  const tileH = Math.max(tileW * 1.7, 14);
  return { tileW, tileH };
}
