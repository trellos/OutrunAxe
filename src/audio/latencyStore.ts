// Single source of truth for the persisted Infinite Eddie latency calibration.
// Measured from the player on the settings screen (the guided quarter-note
// gate), applied by PitchTracker, and read back by the settings UI. Keeping the
// key + parse in one place avoids the two readers drifting apart.

const LS_KEY = "eddie.latencyMs";

/** Persisted calibration in milliseconds, or null if never calibrated. */
export function readLatencyMs(): number | null {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v !== null && !Number.isNaN(parseFloat(v))) return parseFloat(v);
  } catch {
    /* storage unavailable (private mode, etc.) */
  }
  return null;
}

/** Persist the calibration, in milliseconds. */
export function writeLatencyMs(ms: number): void {
  try {
    localStorage.setItem(LS_KEY, String(Math.round(ms)));
  } catch {
    /* storage unavailable */
  }
}
