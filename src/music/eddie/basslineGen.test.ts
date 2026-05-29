import { describe, it, expect } from "vitest";
import { generateBassline } from "./basslineGen";
import { keyPitchClasses, type PitchClass, type KeyMode } from "../keys";

/** Deterministic RNG: replays a fixed list of values then repeats the last. */
function seq(values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

const KEYS: Array<[PitchClass, KeyMode]> = [
  ["E", "major"],
  ["A", "minor"],
  ["G", "major"],
  ["C", "minor"],
  ["C", "major"],
];

describe("generateBassline", () => {
  it("covers exactly 4 measures with 1-2 notes each", () => {
    for (const [root, mode] of KEYS) {
      const notes = generateBassline(root, mode, seq([0.1, 0.2, 0.3, 0.4, 0.6]));
      const measures = new Set(notes.map((n) => n.measure));
      expect([...measures].sort()).toEqual([0, 1, 2, 3]);
      for (let m = 0; m < 4; m++) {
        const count = notes.filter((n) => n.measure === m).length;
        expect(count).toBeGreaterThanOrEqual(1);
        expect(count).toBeLessThanOrEqual(2);
      }
      // Every measure has a downbeat (beat 0) note defining the chord.
      for (let m = 0; m < 4; m++) {
        expect(notes.some((n) => n.measure === m && n.beat === 0)).toBe(true);
      }
    }
  });

  it("emits only in-key pitch classes and chord tones", () => {
    for (const [root, mode] of KEYS) {
      const inKey = keyPitchClasses(root, mode);
      const notes = generateBassline(root, mode, seq([0.0, 0.5, 0.9, 0.1, 0.4]));
      for (const n of notes) {
        expect(inKey.has(n.pitchClass)).toBe(true);
        expect(n.chordTones.length).toBe(3);
        for (const ct of n.chordTones) expect(inKey.has(ct)).toBe(true);
        // The downbeat note's pitch class is the root of its chord triad.
        if (n.beat === 0) expect(n.chordTones[0]).toBe(n.pitchClass);
      }
    }
  });

  it("is deterministic under an injected RNG", () => {
    const a = generateBassline("E", "major", seq([0.2, 0.7, 0.1, 0.9, 0.3]));
    const b = generateBassline("E", "major", seq([0.2, 0.7, 0.1, 0.9, 0.3]));
    expect(b).toEqual(a);
  });

  it("varies progression with the RNG draw", () => {
    // Different first draw selects a different progression -> different notes.
    const first = generateBassline("C", "major", seq([0.0, 0.5, 0.5, 0.5, 0.9]));
    const last = generateBassline("C", "major", seq([0.99, 0.5, 0.5, 0.5, 0.9]));
    expect(last.map((n) => n.pitchClass)).not.toEqual(first.map((n) => n.pitchClass));
  });
});
