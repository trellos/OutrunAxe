import { describe, it, expect } from "vitest";
import {
  majorKeyPitchClasses,
  narrowKeys,
  keyConfidence,
  initialKeySet,
  ALL_MAJOR_KEYS,
} from "./keys";
import type { PitchClass } from "./keys";

describe("majorKeyPitchClasses", () => {
  it("C major contains exactly the 7 white keys", () => {
    const pcs = majorKeyPitchClasses("C");
    expect([...pcs].sort()).toEqual(["A", "B", "C", "D", "E", "F", "G"].sort());
  });

  it("G major contains F#, not F", () => {
    const pcs = majorKeyPitchClasses("G");
    expect(pcs.has("F#")).toBe(true);
    expect(pcs.has("F")).toBe(false);
  });

  it("every major key has exactly 7 pitch classes", () => {
    for (const [, pcs] of ALL_MAJOR_KEYS) {
      expect(pcs.size).toBe(7);
    }
  });
});

describe("narrowKeys", () => {
  it("playing C eliminates keys that don't contain C", () => {
    const all = initialKeySet();
    const narrowed = narrowKeys(all, "C");
    for (const key of narrowed) {
      expect(ALL_MAJOR_KEYS.get(key)!.has("C")).toBe(true);
    }
  });

  it("C+E+G leaves only keys containing all three", () => {
    let candidates = initialKeySet();
    for (const pc of ["C", "E", "G"] as PitchClass[]) {
      candidates = narrowKeys(candidates, pc);
    }
    for (const key of candidates) {
      const scale = ALL_MAJOR_KEYS.get(key)!;
      expect(scale.has("C") && scale.has("E") && scale.has("G")).toBe(true);
    }
  });

  it("all 7 notes of C major leaves exactly {C}", () => {
    let candidates = initialKeySet();
    for (const pc of ["C", "D", "E", "F", "G", "A", "B"] as PitchClass[]) {
      candidates = narrowKeys(candidates, pc);
    }
    expect(candidates.size).toBe(1);
    expect(candidates.has("C")).toBe(true);
  });

  it("returns empty set when no key matches (C, C#, D span three consecutive semitones)", () => {
    // No major key contains three consecutive semitones, so C + C# + D → empty.
    let candidates = initialKeySet();
    candidates = narrowKeys(candidates, "C");
    candidates = narrowKeys(candidates, "C#");
    candidates = narrowKeys(candidates, "D");
    expect(candidates.size).toBe(0);
  });
});

describe("keyConfidence", () => {
  it("12 candidates → confidence ~0", () => {
    expect(keyConfidence(initialKeySet())).toBeCloseTo(0);
  });

  it("1 candidate → confidence 1", () => {
    expect(keyConfidence(new Set<PitchClass>(["C"]))).toBe(1);
  });

  it("6 candidates → confidence 6/11 ≈ 0.545", () => {
    // Formula: 1 - (n-1)/11. With n=6: 1 - 5/11 = 6/11.
    const six = new Set<PitchClass>(["C", "D", "E", "F", "G", "A"]);
    expect(keyConfidence(six)).toBeCloseTo(6 / 11, 5);
  });

  it("confidence never decreases as candidates shrink via narrowKeys", () => {
    let candidates = initialKeySet();
    let prev = keyConfidence(candidates);
    for (const pc of ["C", "E", "G", "B", "D"] as PitchClass[]) {
      const next = narrowKeys(candidates, pc);
      if (next.size === 0) break;
      candidates = next;
      const conf = keyConfidence(candidates);
      expect(conf).toBeGreaterThanOrEqual(prev);
      prev = conf;
    }
  });
});

describe("initialKeySet", () => {
  it("contains all 12 pitch classes", () => {
    expect(initialKeySet().size).toBe(12);
  });

  it("returns independent sets on each call", () => {
    const a = initialKeySet();
    const b = initialKeySet();
    a.delete("C");
    expect(b.has("C")).toBe(true);
  });
});
