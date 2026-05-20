import type { NoteEvent } from "./index";

/**
 * Hammer-on / tap run: four rapid notes in quick succession, each a new onset.
 * E4→G4→A4→C5 ascending pentatonic fragment, ~60 ms apart.
 */
export const tapSample: NoteEvent[] = [
  { time: 0.00, midi: 64, onsetId: 201 }, // E4
  { time: 0.06, midi: 67, onsetId: 202 }, // G4
  { time: 0.12, midi: 69, onsetId: 203 }, // A4
  { time: 0.18, midi: 72, onsetId: 204 }, // C5
];
