// Single source of truth for turning a stream of pitch updates into solid
// horizontal note bars on a 2D canvas. Reused by BOTH hud/Timeline.ts and
// hud/MenuPulse.ts so there is exactly one bar-grouping implementation to
// reason about (mirrors the codebase's "no parallel implementations" ethos —
// see PitchEngine's header).
//
// Why this exists: a sustained note arrives as many PitchUpdate reads. Real
// mic guitar input wobbles ≥2 semitones between sustain reads, so grouping by
// time/pitch proximity fragments one held note into a row of disconnected
// dots. The engine already gives us the correct grouping key: `onsetId` is
// monotonic and IDENTICAL for every sustain read of one note (synthetic
// keyboard notes get a unique random negative onsetId). So we group STRICTLY
// by onsetId: same id => extend the current bar; new id => finalize and start
// a fresh bar. Pitch wobble never splits a bar.

/** The full rectangle-extent of a bar to (re)draw on the canvas. */
export interface BarRect {
  x0: number;
  x1: number;
  y: number;
}

interface CurrentBar {
  onsetId: number;
  x0: number;
  x1: number;
  y: number;
}

export class BarAccumulator {
  private current: CurrentBar | null = null;

  /**
   * Seed width for a brand-new bar so a single short note (one onset, maybe
   * one update) still reads as a small bar rather than nothing.
   */
  constructor(private minWidth: number) {}

  /**
   * Feed one pitch update.
   *  - Same onsetId as the current bar: extend it (x1 grows monotonically)
   *    and return the full bar extent to redraw. y stays the bar's first y so
   *    pitch wobble during sustain doesn't make the bar jump or split.
   *  - New onsetId (or first ever): finalize the old bar implicitly, start a
   *    fresh bar seeded at `x` with `minWidth`, and return that.
   * Always returns the bar rect to draw (never null in normal use; null only
   * defensively guarded by callers).
   */
  feed(onsetId: number, x: number, y: number): BarRect | null {
    if (this.current && this.current.onsetId === onsetId) {
      // Same note still sounding — extend the bar. Guard against a stray
      // backwards time reading so the bar never shrinks.
      if (x > this.current.x1) this.current.x1 = x;
      return { x0: this.current.x0, x1: this.current.x1, y: this.current.y };
    }
    // New pluck / hammer-on / different note: start a fresh bar with a
    // minimum readable width so short notes still show.
    this.current = {
      onsetId,
      x0: x,
      x1: x + this.minWidth,
      y,
    };
    return { x0: this.current.x0, x1: this.current.x1, y: this.current.y };
  }

  /**
   * Clear the current bar so the next fed update starts a brand-new bar.
   * Callers invoke this on a row/measure boundary so a note that visually
   * wrapped doesn't get extended across the discontinuity.
   */
  reset(): void {
    this.current = null;
  }
}
