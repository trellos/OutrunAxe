import { describe, it, expect } from "vitest";
import {
  chordForPitchClass,
  TRIAD_INTERVALS,
  CHORD_ROOT_MIDI_BASE,
} from "./chords";

describe("TRIAD_INTERVALS", () => {
  it("major is root, major third, perfect fifth", () => {
    expect(TRIAD_INTERVALS.major).toEqual([0, 4, 7]);
  });

  it("minor is root, minor third, perfect fifth", () => {
    expect(TRIAD_INTERVALS.minor).toEqual([0, 3, 7]);
  });
});

describe("chordForPitchClass", () => {
  it("C major triad voices C/E/G at the base octave", () => {
    expect(chordForPitchClass("C")).toEqual([
      CHORD_ROOT_MIDI_BASE,
      CHORD_ROOT_MIDI_BASE + 4,
      CHORD_ROOT_MIDI_BASE + 7,
    ]);
  });

  it("defaults to major", () => {
    expect(chordForPitchClass("A")).toEqual(chordForPitchClass("A", "major"));
  });

  it("A minor triad voices A/C/E", () => {
    const root = CHORD_ROOT_MIDI_BASE + 9; // A is 9 semitones above C
    expect(chordForPitchClass("A", "minor")).toEqual([root, root + 3, root + 7]);
  });

  it("root pitch class drives the chord root", () => {
    expect(chordForPitchClass("F#")[0]).toBe(CHORD_ROOT_MIDI_BASE + 6);
  });

  it("always returns three MIDI numbers", () => {
    for (const pc of ["C", "D#", "G", "B"] as const) {
      expect(chordForPitchClass(pc)).toHaveLength(3);
    }
  });
});
