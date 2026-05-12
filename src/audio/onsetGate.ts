// Pure onset-detection gate. No DOM / Web Audio dependencies — importable
// by both the AudioWorkletProcessor (which streams 512-sample chunks on the
// audio render thread) and the offline test bench / live PitchTracker
// (which mirror the same logic on whatever cadence is convenient).
//
// State is mutated in place by `onsetGate(chunkRms, chunkStartTime,
// chunkEndTime, state)`. Returns `true` when the chunk satisfies all four
// gates (sharp-rise + above-floor + above-local-floor + the time/decay/
// energy gates against the last accepted onset). On a true return, the
// state has already been updated to reflect the new onset.

/** Length of the analysis chunk, in samples. 512 @ 48kHz = ~10.7 ms. */
export const ONSET_CHUNK = 512;

/** Floor on absolute chunk RMS — anything quieter is silence noise. */
export const ONSET_MIN_RMS = 0.008;
/** Chunk RMS must be at least this × the previous chunk's RMS to count as a sharp rise. */
export const ONSET_RATIO = 1.6;
/** Chunk RMS must be at least this × the running min-since-last-onset. */
export const LOCAL_MIN_RATIO = 1.8;

/** No two onsets ever closer than this (sanity floor on inter-onset interval). */
export const ONSET_HARD_FLOOR = 0.03;

/**
 * Suppress chunk-RMS bumps inside this window of the last accepted onset.
 * Real guitar plucks have a secondary string-settle spike 80–100 ms after
 * the initial attack — must stay under the inter-attack interval at our
 * target tempo (16ths@140 BPM = 107 ms) so legitimate fast attacks aren't
 * suppressed.
 */
export const ATTACK_SPIKE_WINDOW = 0.100;

/**
 * After the spike window, the previous note's body must have decayed to at
 * most this fraction of its attack-peak chunkRMS before a new onset is
 * allowed. Catches mid-body chunk-RMS fluctuations on real recordings
 * where the body sustains close to attack levels for hundreds of ms.
 */
export const DECAY_REQUIRED = 0.5;

/**
 * Real new plucks have comparable energy to their predecessor. Body-decay
 * fluctuations that satisfy sharpRise + above-localMin are typically much
 * quieter than a real attack — rejecting onsets whose chunk RMS is below
 * this fraction of the last accepted onset catches them. Limitation:
 * intentionally soft re-plucks (ghost notes) are also suppressed.
 */
export const ONSET_ENERGY_FLOOR_RATIO = 0.4;

export interface OnsetState {
  /** Audio-clock time of the START of the last accepted onset's chunk. */
  lastOnsetTime: number;
  /** RMS of the last accepted onset's chunk — used by decay + energy gates. */
  lastOnsetChunkRms: number;
  /** Running minimum chunk RMS seen since the last accepted onset. */
  localMin: number;
  /** Previous chunk's RMS — used for the sharp-rise check. */
  prevChunkRms: number;
}

export function newOnsetState(): OnsetState {
  return {
    lastOnsetTime: 0,
    lastOnsetChunkRms: 0,
    localMin: Infinity,
    prevChunkRms: 0,
  };
}

/**
 * Called once per 512-sample chunk. Mutates `state` and returns `true` if
 * the chunk fires an accepted onset. When true, the state has been updated
 * (lastOnsetTime, lastOnsetChunkRms, localMin reset to this chunk).
 *
 * `chunkStartTime` is the audio-clock time of the first sample in the chunk;
 * `chunkEndTime` is one sample past the last (i.e. start + ONSET_CHUNK / sr).
 */
export function onsetGate(
  chunkRms: number,
  chunkStartTime: number,
  chunkEndTime: number,
  state: OnsetState,
): boolean {
  // Update running localMin only for chunks AFTER the last onset. Without
  // this guard, scans whose buffer still spans pre-attack silence pull
  // localMin down to ~0 — which trivially satisfies DECAY_REQUIRED and lets
  // mid-body fluctuations fire as onsets.
  if (chunkEndTime > state.lastOnsetTime && chunkRms < state.localMin) {
    state.localMin = chunkRms;
  }

  // Seed prevRms so the first chunk after silence (no predecessor) can pass
  // the sharp-rise check on its own merits — the absolute floor still
  // gates against silence noise.
  const prevRms =
    state.prevChunkRms > 0 ? state.prevChunkRms : ONSET_MIN_RMS / ONSET_RATIO;
  const sharpRise = chunkRms > prevRms * ONSET_RATIO;
  const aboveFloor = chunkRms > ONSET_MIN_RMS;
  const aboveLocalFloor =
    state.localMin === Infinity || chunkRms > state.localMin * LOCAL_MIN_RATIO;

  state.prevChunkRms = chunkRms;

  if (!sharpRise || !aboveFloor || !aboveLocalFloor) return false;

  // Time-based gates against the last accepted onset.
  if (chunkStartTime <= state.lastOnsetTime + ONSET_HARD_FLOOR) return false;
  if (chunkStartTime <= state.lastOnsetTime + ATTACK_SPIKE_WINDOW) return false;

  const decayedEnough =
    state.lastOnsetChunkRms === 0 ||
    state.localMin <= state.lastOnsetChunkRms * DECAY_REQUIRED;
  const energyEnough =
    state.lastOnsetChunkRms === 0 ||
    chunkRms >= state.lastOnsetChunkRms * ONSET_ENERGY_FLOOR_RATIO;
  if (!decayedEnough || !energyEnough) return false;

  // Accept — update state for the next chunk's gating.
  state.lastOnsetTime = chunkStartTime;
  state.lastOnsetChunkRms = chunkRms;
  state.localMin = chunkRms;
  return true;
}

/**
 * Helper for callers that have a Float32Array chunk in hand — computes RMS
 * over the chunk and runs the gate. Returns the result of `onsetGate`.
 */
export function onsetGateOnSamples(
  chunk: Float32Array,
  chunkStartTime: number,
  chunkEndTime: number,
  state: OnsetState,
): boolean {
  let s = 0;
  for (let i = 0; i < chunk.length; i++) s += chunk[i] * chunk[i];
  const rms = Math.sqrt(s / chunk.length);
  return onsetGate(rms, chunkStartTime, chunkEndTime, state);
}
