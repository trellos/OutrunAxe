import { describe, it, expect, beforeEach } from "vitest";
import {
  laneY,
  xForTimeInRow,
  ROW_HEIGHT,
  BAND_HEIGHT,
  LANE_PITCH,
  PX_PER_BEAT,
  BEATS_PER_ROW,
} from "./timelineMath";
import { BarAccumulator } from "./noteBars";
import { scaleSample, SCALE_BPM } from "./samples/scale";
import { bendSample } from "./samples/bends";
import { tapSample } from "./samples/taps";
import { repeatSample } from "./samples/repeats";

// ── helpers ─────────────────────────────────────────────────────────────────

/** Pixel x for a note at `time` seconds into a row at the given BPM. */
function x(time: number, bpm = SCALE_BPM) {
  return xForTimeInRow(time, bpm);
}

/** Run every event through a fresh BarAccumulator and return each bar rect. */
function accumulate(events: { time: number; midi: number; onsetId: number }[], bpm = SCALE_BPM) {
  const acc = new BarAccumulator(PX_PER_BEAT / 10);
  return events.map((e) => acc.feed(e.onsetId, x(e.time, bpm), laneY(e.midi)));
}

// ── laneY / pitch layout ────────────────────────────────────────────────────

describe("laneY — pitch-class lane positions", () => {
  it("C (lane 0) sits at the bottom of the row", () => {
    const expected = Math.round(ROW_HEIGHT - 4 - 0 * LANE_PITCH - LANE_PITCH / 2);
    expect(laneY(60)).toBe(expected); // C4
    expect(laneY(72)).toBe(expected); // C5 — same pitch class
  });

  it("B (lane 11) sits at the top of the row", () => {
    const expected = Math.round(ROW_HEIGHT - 4 - 11 * LANE_PITCH - LANE_PITCH / 2);
    expect(laneY(71)).toBe(expected); // B4
  });

  it("every note in C Major maps to a distinct lane", () => {
    const scaleMidi = [60, 62, 64, 65, 67, 69, 71]; // C D E F G A B
    const ys = scaleMidi.map(laneY);
    expect(new Set(ys).size).toBe(scaleMidi.length);
  });

  it("adjacent scale notes never overlap (≥1 px gap between bar edges)", () => {
    // Closest pair: E4–F4 (one semitone = one lane apart)
    const yE = laneY(64);
    const yF = laneY(65);
    // y increases downward; higher pitch → smaller y
    const higherY = Math.min(yE, yF); // top bar centre
    const lowerY  = Math.max(yE, yF); // bottom bar centre
    const topEdgeOfLower  = lowerY  - Math.floor(BAND_HEIGHT / 2);
    const botEdgeOfHigher = higherY + Math.ceil(BAND_HEIGHT / 2);
    expect(topEdgeOfLower - botEdgeOfHigher).toBeGreaterThanOrEqual(1);
  });

  it("all lane centres stay within row boundaries", () => {
    for (let midi = 48; midi <= 84; midi++) {
      const y = laneY(midi);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(ROW_HEIGHT);
    }
  });
});

// ── xForTimeInRow ────────────────────────────────────────────────────────────

describe("xForTimeInRow — time → pixel x", () => {
  it("t=0 → x=0", () => {
    expect(xForTimeInRow(0, 90)).toBe(0);
  });

  it("one beat → PX_PER_BEAT", () => {
    expect(xForTimeInRow(60 / 90, 90)).toBeCloseTo(PX_PER_BEAT);
  });

  it("full row (4 beats) → 4 × PX_PER_BEAT", () => {
    expect(xForTimeInRow(BEATS_PER_ROW * (60 / 90), 90)).toBeCloseTo(BEATS_PER_ROW * PX_PER_BEAT);
  });

  it("eighth note → 72 px at 90 BPM", () => {
    expect(xForTimeInRow((60 / 90) / 2, 90)).toBeCloseTo(72);
  });
});

// ── scale sample ─────────────────────────────────────────────────────────────

describe("scale sample — C Major eighth notes at 90 BPM", () => {
  let bars: ReturnType<typeof accumulate>;

  beforeEach(() => { bars = accumulate(scaleSample); });

  it("produces 8 bars (one per note)", () => {
    expect(bars.length).toBe(8);
    expect(bars.every(Boolean)).toBe(true);
  });

  it("bars are spaced 72 px apart (one eighth note each)", () => {
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i]!.x0).toBeCloseTo(bars[i - 1]!.x0 + 72, 1);
    }
  });

  it("C4 (index 0) and C5 (index 7) land on the same lane", () => {
    expect(bars[0]!.y).toBe(bars[7]!.y);
  });

  it("produces 7 distinct y lanes (C4 and C5 share one)", () => {
    expect(new Set(bars.map((b) => b!.y)).size).toBe(7);
  });

  it("all bars fit within the row width", () => {
    const rowWidth = BEATS_PER_ROW * PX_PER_BEAT;
    for (const bar of bars) {
      expect(bar!.x0).toBeGreaterThanOrEqual(0);
      expect(bar!.x1).toBeLessThanOrEqual(rowWidth + PX_PER_BEAT / 10 + 1);
    }
  });
});

// ── bend sample ──────────────────────────────────────────────────────────────

describe("bend sample — G4 bent to A4", () => {
  it("all five reads share x0 (one bar, same onset)", () => {
    const acc = new BarAccumulator(PX_PER_BEAT / 10);
    const bars = bendSample.map((e) => acc.feed(e.onsetId, x(e.time), laneY(e.midi))!);
    const x0 = bars[0].x0;
    for (const bar of bars) expect(bar.x0).toBe(x0);
  });

  it("bar lane is fixed at G4 even though pitch bends to A4", () => {
    const acc = new BarAccumulator(PX_PER_BEAT / 10);
    const bars = bendSample.map((e) => acc.feed(e.onsetId, x(e.time), laneY(e.midi))!);
    const gLane = laneY(67);
    for (const bar of bars) expect(bar.y).toBe(gLane);
  });

  it("bar x1 grows monotonically as the bend sustains", () => {
    const acc = new BarAccumulator(PX_PER_BEAT / 10);
    let prev = -Infinity;
    for (const e of bendSample) {
      const bar = acc.feed(e.onsetId, x(e.time), laneY(e.midi))!;
      expect(bar.x1).toBeGreaterThanOrEqual(prev);
      prev = bar.x1;
    }
  });
});

// ── tap sample ───────────────────────────────────────────────────────────────

describe("tap sample — rapid hammer-ons", () => {
  it("produces 4 separate bars (one per onsetId)", () => {
    expect(new Set(accumulate(tapSample).map((b) => b!.x0)).size).toBe(4);
  });

  it("bar x0 positions are strictly increasing", () => {
    const bars = accumulate(tapSample);
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i]!.x0).toBeGreaterThan(bars[i - 1]!.x0);
    }
  });

  it("each tap lands on a distinct pitch-class lane", () => {
    // E4(4), G4(7), A4(9), C5(0) — four different pitch classes
    expect(new Set(accumulate(tapSample).map((b) => b!.y)).size).toBe(4);
  });
});

// ── repeat sample ─────────────────────────────────────────────────────────────

describe("repeat sample — A4 struck 4 times", () => {
  it("produces 4 separate bars (unique onsetIds)", () => {
    expect(new Set(accumulate(repeatSample).map((b) => b!.x0)).size).toBe(4);
  });

  it("all bars land on the A4 lane", () => {
    const aLane = laneY(69);
    for (const bar of accumulate(repeatSample)) expect(bar!.y).toBe(aLane);
  });

  it("bars are spaced 72 px apart (eighth-note grid)", () => {
    const bars = accumulate(repeatSample);
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i]!.x0).toBeCloseTo(bars[i - 1]!.x0 + 72, 1);
    }
  });
});
