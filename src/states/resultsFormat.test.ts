import { describe, it, expect } from "vitest";
import {
  formatDuration,
  formatDispatchTime,
  formatDispatchRows,
  type Dispatch,
} from "./resultsFormat";

describe("formatDuration", () => {
  it("formats sub-minute durations as m:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(5)).toBe("0:05");
    expect(formatDuration(42)).toBe("0:42");
  });

  it("formats multi-minute durations", () => {
    expect(formatDuration(60)).toBe("1:00");
    expect(formatDuration(95)).toBe("1:35");
    expect(formatDuration(605)).toBe("10:05");
  });

  it("floors fractional seconds", () => {
    expect(formatDuration(9.9)).toBe("0:09");
  });

  it("clamps negative and non-finite inputs to 0:00", () => {
    expect(formatDuration(-10)).toBe("0:00");
    expect(formatDuration(NaN)).toBe("0:00");
    expect(formatDuration(Infinity)).toBe("0:00");
  });
});

describe("formatDispatchTime", () => {
  it("uses +s.ss under a minute", () => {
    expect(formatDispatchTime(0)).toBe("+0.00s");
    expect(formatDispatchTime(3.421)).toBe("+3.42s");
    expect(formatDispatchTime(59.999)).toBe("+60.00s");
  });

  it("uses mm:ss.mmm at a minute or more", () => {
    expect(formatDispatchTime(60)).toBe("1:00.000");
    expect(formatDispatchTime(75.25)).toBe("1:15.250");
  });

  it("clamps negative/non-finite to +0.00s", () => {
    expect(formatDispatchTime(-5)).toBe("+0.00s");
    expect(formatDispatchTime(NaN)).toBe("+0.00s");
  });
});

describe("formatDispatchRows", () => {
  it("returns empty array for empty log", () => {
    expect(formatDispatchRows([])).toEqual([]);
  });

  it("normalizes times relative to the first dispatch by default", () => {
    const dispatches: Dispatch[] = [
      { pitchClass: "C", damage: 12, time: 100 },
      { pitchClass: "F#", damage: 8.5, time: 103.5 },
      { pitchClass: "A", damage: 20, time: 165 },
    ];
    const rows = formatDispatchRows(dispatches);
    expect(rows).toEqual([
      { pitchClass: "C", damage: "12.0", timeLabel: "+0.00s" },
      { pitchClass: "F#", damage: "8.5", timeLabel: "+3.50s" },
      { pitchClass: "A", damage: "20.0", timeLabel: "1:05.000" },
    ]);
  });

  it("honors an explicit reference time", () => {
    const dispatches: Dispatch[] = [
      { pitchClass: "C", damage: 12, time: 100 },
    ];
    const rows = formatDispatchRows(dispatches, { reference: 98 });
    expect(rows[0].timeLabel).toBe("+2.00s");
  });

  it("formats damage to one decimal", () => {
    const rows = formatDispatchRows([
      { pitchClass: "G", damage: 7, time: 0 },
    ]);
    expect(rows[0].damage).toBe("7.0");
  });

  it("clamps offsets to +0.00s when a row predates the reference", () => {
    // An explicit reference later than a dispatch must not produce a negative
    // label; the formatter floors offsets at zero.
    const rows = formatDispatchRows(
      [{ pitchClass: "C", damage: 3, time: 100 }],
      { reference: 110 },
    );
    expect(rows[0].timeLabel).toBe("+0.00s");
  });

  it("preserves order and per-row offsets for a large list", () => {
    const dispatches: Dispatch[] = Array.from({ length: 50 }, (_, i) => ({
      pitchClass: "C",
      damage: i,
      time: 100 + i * 0.5,
    }));
    const rows = formatDispatchRows(dispatches);
    expect(rows).toHaveLength(50);
    expect(rows[0].timeLabel).toBe("+0.00s");
    expect(rows[1].timeLabel).toBe("+0.50s");
    expect(rows[49].timeLabel).toBe("+24.50s");
    // Damage labels track each entry in order.
    expect(rows.map((r) => r.damage).slice(0, 3)).toEqual(["0.0", "1.0", "2.0"]);
  });

  it("rounds fractional damage to one decimal in rows", () => {
    const rows = formatDispatchRows([
      { pitchClass: "C", damage: 2.46, time: 0 },
      { pitchClass: "D", damage: 4.04, time: 1 },
    ]);
    expect(rows.map((r) => r.damage)).toEqual(["2.5", "4.0"]);
  });

  it("a single non-zero-time dispatch with no reference reads as the origin", () => {
    const rows = formatDispatchRows([
      { pitchClass: "C", damage: 3, time: 137.4 },
    ]);
    expect(rows[0].timeLabel).toBe("+0.00s");
  });
});
