// Pure formatting helpers for the level-complete results screen.
//
// These are deliberately framework-free (no DOM, no Three.js) so the strings
// shown on the results card and the strings asserted in unit tests come from
// the SAME code path and can never drift apart.

export interface Dispatch {
  pitchClass: string;
  /** Total damage taken to dispatch the enemy (its maxHp). */
  damage: number;
  /** Audio-clock time of the killing blow, in seconds (absolute, may be large). */
  time: number;
}

export interface DispatchRow {
  pitchClass: string;
  /** Damage formatted to one decimal, e.g. "12.0". */
  damage: string;
  /** Time relative to the reference, formatted for display, e.g. "+3.42s". */
  timeLabel: string;
}

export interface FormatDispatchOpts {
  /**
   * Reference time (audio-clock seconds) that dispatch times are measured
   * against. When omitted, the first dispatch's time is used so the first row
   * reads as the run's origin.
   */
  reference?: number;
}

/** Clamp to a finite number, falling back to 0 for NaN/Infinity. */
function safeNumber(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

/**
 * Format an absolute (or relative) duration in seconds as `mm:ss`. Negative or
 * non-finite inputs are treated as 0. Used for the run's TOTAL TIME row.
 */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, safeNumber(seconds));
  const mins = Math.floor(total / 60);
  const secs = Math.floor(total % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Format a dispatch's offset (relative to the reference time) as a short,
 * readable label. Under a minute it reads `+s.ss` (e.g. "+3.42s"); a minute or
 * more it reads `mm:ss.mmm` so long runs stay legible.
 */
export function formatDispatchTime(offsetSeconds: number): string {
  const offset = Math.max(0, safeNumber(offsetSeconds));
  if (offset < 60) {
    return `+${offset.toFixed(2)}s`;
  }
  const mins = Math.floor(offset / 60);
  const secs = Math.floor(offset % 60);
  const millis = Math.round((offset - Math.floor(offset)) * 1000);
  return `${mins}:${secs.toString().padStart(2, "0")}.${millis
    .toString()
    .padStart(3, "0")}`;
}

/**
 * Turn the raw dispatch log into display-ready rows. Times are normalized so
 * the first dispatch (or the supplied reference) reads as the origin. Returns
 * an empty array for an empty log so callers can handle the empty case.
 */
export function formatDispatchRows(
  dispatches: readonly Dispatch[],
  opts: FormatDispatchOpts = {},
): DispatchRow[] {
  if (dispatches.length === 0) return [];

  const reference =
    opts.reference !== undefined
      ? safeNumber(opts.reference)
      : safeNumber(dispatches[0].time);

  return dispatches.map((d) => ({
    pitchClass: d.pitchClass,
    damage: safeNumber(d.damage).toFixed(1),
    timeLabel: formatDispatchTime(safeNumber(d.time) - reference),
  }));
}
