/** Test note-event sequences used by timeline.test.ts. */
export * from "./scale";
export * from "./bends";
export * from "./taps";
export * from "./repeats";

export interface NoteEvent {
  /** Audio time in seconds from the row start. */
  time: number;
  /** MIDI note number (may be fractional for pitch bends). */
  midi: number;
  /** Unique onset identifier — same value for every read of a sustained note. */
  onsetId: number;
}
