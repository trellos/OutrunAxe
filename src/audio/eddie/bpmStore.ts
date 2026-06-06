// Single source of truth for the persisted Infinite Eddie tempo. Chosen on the
// settings screen and restored on the next page load so the player's BPM
// survives a reload. Mirrors latencyStore: key + parse live in one place so
// readers can't drift apart.

const LS_KEY = "eddie.bpm";

/** Persisted BPM, or null if never set / unavailable. */
export function readBpm(): number | null {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v !== null && !Number.isNaN(parseFloat(v))) return parseFloat(v);
  } catch {
    /* storage unavailable (private mode, etc.) */
  }
  return null;
}

/** Persist the chosen BPM. */
export function writeBpm(bpm: number): void {
  try {
    localStorage.setItem(LS_KEY, String(Math.round(bpm)));
  } catch {
    /* storage unavailable */
  }
}
