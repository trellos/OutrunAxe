import type { NoteEvent } from "./index";

const EIGHTH = (60 / 90) / 2; // eighth note duration at 90 BPM

/**
 * A4 (MIDI 69) struck four times on consecutive eighth-note positions.
 * Each strike has a unique onsetId → four separate bars on the same lane.
 */
export const repeatSample: NoteEvent[] = [
  { time: 0 * EIGHTH, midi: 69, onsetId: 301 },
  { time: 1 * EIGHTH, midi: 69, onsetId: 302 },
  { time: 2 * EIGHTH, midi: 69, onsetId: 303 },
  { time: 3 * EIGHTH, midi: 69, onsetId: 304 },
];
