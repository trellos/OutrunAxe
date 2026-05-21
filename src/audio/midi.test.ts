import { describe, it, expect } from "vitest";
import { freqToMidi, midiToName, midiToPitchClass, NOTE_NAMES } from "./midi";

describe("NOTE_NAMES", () => {
  it("has exactly 12 entries", () => {
    expect(NOTE_NAMES.length).toBe(12);
  });

  it("starts with C and ends with B", () => {
    expect(NOTE_NAMES[0]).toBe("C");
    expect(NOTE_NAMES[11]).toBe("B");
  });
});

describe("freqToMidi", () => {
  it("440 Hz → MIDI 69 (A4)", () => {
    expect(freqToMidi(440)).toBe(69);
  });

  it("261.63 Hz → MIDI 60 (C4, middle C)", () => {
    expect(freqToMidi(261.63)).toBe(60);
  });

  it("880 Hz → MIDI 81 (A5, one octave up)", () => {
    expect(freqToMidi(880)).toBe(81);
  });

  it("220 Hz → MIDI 57 (A3, one octave down)", () => {
    expect(freqToMidi(220)).toBe(57);
  });
});

describe("midiToName", () => {
  it("MIDI 69 → A4", () => {
    expect(midiToName(69)).toBe("A4");
  });

  it("MIDI 60 → C4", () => {
    expect(midiToName(60)).toBe("C4");
  });

  it("MIDI 0 → C-1", () => {
    expect(midiToName(0)).toBe("C-1");
  });

  it("MIDI 127 → G9", () => {
    expect(midiToName(127)).toBe("G9");
  });
});

describe("midiToPitchClass", () => {
  it("MIDI 60 (C4) → 'C'", () => {
    expect(midiToPitchClass(60)).toBe("C");
  });

  it("MIDI 61 (C#4) → 'C#'", () => {
    expect(midiToPitchClass(61)).toBe("C#");
  });

  it("is octave-invariant: 48, 60, 72 all → 'C'", () => {
    expect(midiToPitchClass(48)).toBe("C");
    expect(midiToPitchClass(60)).toBe("C");
    expect(midiToPitchClass(72)).toBe("C");
  });

  it("handles negative MIDI values gracefully", () => {
    expect(midiToPitchClass(-12)).toBe("C");
  });
});
