import type { NoteEvent } from "./index";

/**
 * Guitar bend: G4 (MIDI 67) bent up to A4 (MIDI 69) over 200 ms.
 * All reads share the same onsetId → one bar that stays on the G lane
 * regardless of how far the pitch bends.
 */
export const bendSample: NoteEvent[] = [
  { time: 0.00, midi: 67.0, onsetId: 100 }, // G4
  { time: 0.05, midi: 67.5, onsetId: 100 }, // G4 + 50 cents
  { time: 0.10, midi: 68.0, onsetId: 100 }, // G#4
  { time: 0.15, midi: 68.5, onsetId: 100 }, // G#4 + 50 cents
  { time: 0.20, midi: 69.0, onsetId: 100 }, // A4 (full bend)
];
