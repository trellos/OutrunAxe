import type { NoteEvent } from "./index";

export const SCALE_BPM = 90;
// One eighth note = half a beat
const EIGHTH = (60 / SCALE_BPM) / 2;

// C4 D4 E4 F4 G4 A4 B4 C5 — one eighth note each, on the beat grid
const C_MAJOR_MIDI = [60, 62, 64, 65, 67, 69, 71, 72] as const;

/** Eight consecutive eighth notes of C Major starting at row time 0. */
export const scaleSample: NoteEvent[] = C_MAJOR_MIDI.map((midi, i) => ({
  time: i * EIGHTH,
  midi,
  onsetId: i + 1,
}));
