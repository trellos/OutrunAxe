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

  it("an unknown pitch class falls back to a C root (no NaN)", () => {
    // Cast through unknown: callers should never pass this, but the helper
    // must stay defensive so the oscillator never gets a NaN frequency.
    const chord = chordForPitchClass("H" as unknown as Parameters<typeof chordForPitchClass>[0]);
    expect(chord).toEqual(chordForPitchClass("C"));
    expect(chord.every((n) => Number.isFinite(n))).toBe(true);
  });

  it("every pitch class yields three strictly ascending MIDI notes", () => {
    const ALL = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
    for (const pc of ALL) {
      for (const mode of ["major", "minor"] as const) {
        const [root, third, fifth] = chordForPitchClass(pc, mode);
        expect(third).toBeGreaterThan(root);
        expect(fifth).toBeGreaterThan(third);
      }
    }
  });

  it("the root is voiced at the base octave for every pitch class", () => {
    const ALL = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
    ALL.forEach((pc, idx) => {
      // Root = base + pitch-class index (0..11), so the whole chord lives in
      // the C3..C4 region regardless of which note killed the enemy.
      expect(chordForPitchClass(pc)[0]).toBe(CHORD_ROOT_MIDI_BASE + idx);
      expect(chordForPitchClass(pc)[0]).toBeGreaterThanOrEqual(CHORD_ROOT_MIDI_BASE);
      expect(chordForPitchClass(pc)[0]).toBeLessThan(CHORD_ROOT_MIDI_BASE + 12);
    });
  });

  it("minor mode lowers the third by one semitone vs major (fifth unchanged)", () => {
    for (const pc of ["C", "E", "G", "A#"] as const) {
      const maj = chordForPitchClass(pc, "major");
      const min = chordForPitchClass(pc, "minor");
      expect(min[0]).toBe(maj[0]); // same root
      expect(min[1]).toBe(maj[1] - 1); // minor third is one semitone lower
      expect(min[2]).toBe(maj[2]); // perfect fifth unchanged
    }
  });
});
