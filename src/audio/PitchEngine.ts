// Single source of truth for monophonic pitch detection.
//
// Both the live PitchTracker (rAF + AnalyserNode) and the offline test bench
// (decoded WebM/MP3 → fixed sample stride) feed buffers into THIS engine.
// One algorithm guaranteed across both — no parallel implementations to drift.
//
// Algorithm in order:
//   1. Onset detection on per-chunk RMS within the buffer (CHUNK must exceed
//      one period of the lowest pitch to avoid phase-noise false triggers).
//   2. Pitch detection via the configured detector (Macleod by default —
//      designed for monophonic music; YIN is available for comparison).
//   3. Octave correction against the geometric mean of recent emissions
//      (suppresses sub-harmonic locks like F#2 ↔ F#4).
//   4. 3-tap median filter on raw readings (kills single-frame strays).
//   5. New-note gate: a pitch jump without a fresh onset is rejected;
//      sustain readings emit every 80ms for line extension.
//   6. Onset-corrected timestamps: first-of-note readings carry the detected
//      onset time, not when YIN/Macleod finally locked.

import { YIN, AMDF, Macleod, ACF2PLUS } from "pitchfinder";

export type Algorithm = "Macleod" | "YIN" | "AMDF" | "ACF2PLUS";

export interface PitchReading {
  freq: number;     // Hz, post octave correction
  time: number;     // audio-clock time of the note's actual start (onset-corrected)
  isNewNote: boolean;
}

export interface ProcessHints {
  /**
   * 0..1 confidence that a note is expected at this moment (near a beat,
   * eighth, or triplet edge). Lets the engine emit sooner with lower
   * confidence at musical positions while staying cautious elsewhere.
   */
  beatProximity?: number;
}

export interface EngineConfig {
  sampleRate: number;
  fftSize?: number;
  algorithm?: Algorithm;
  yinThreshold?: number;
  /** Total round-trip pipeline latency to subtract at emit time. */
  latencyBiasSec?: number;
}

const DEFAULT_FFT = 4096;
const MIN_FREQ = 70;
const MAX_FREQ = 1300;
const ONSET_CHUNK = 512;          // 10.7ms at 48kHz; > period of low E2
const ONSET_MIN_RMS = 0.008;
const HISTORY_CLEAR_AFTER_SILENCE = 0.4;
const SILENCE_RMS = 0.01;
const SUSTAIN_INTERVAL = 0.08;

// Onset gating is *tempo-independent*. A new onset is accepted only when:
//   1. ~50ms hard floor has passed (sanity guard, not a musical window).
//   2. The current chunk's RMS rose sharply from the immediately previous
//      chunk (ONSET_RATIO).
//   3. The current chunk's RMS is significantly higher than the LOCAL
//      MINIMUM observed since the last accepted onset (LOCAL_MIN_RATIO).
//   4. The local minimum has decayed to less than DECAY_REQUIRED × the
//      previous attack's peak. This blocks multi-spike attack envelopes
//      (initial click + secondary string-settle 80-150ms later): the dip
//      between the spikes is shallow, so the local min never falls far
//      enough below the click's peak to allow the secondary to fire.
//      A real new pluck after a sustained decay easily satisfies this.
//
// All thresholds look at signal SHAPE, not elapsed time — works at any tempo.
const ONSET_HARD_FLOOR = 0.05;
const ONSET_RATIO = 1.6;        // chunk-to-chunk rise required
const LOCAL_MIN_RATIO = 1.8;    // rise over local-minimum-since-last-onset required
const DECAY_REQUIRED = 0.5;     // local min must be < this × peak-since-last-onset
const PITCH_PROB_CAUTIOUS = 0.92;
const PITCH_PROB_EAGER = 0.70;

// Detector returns either a number (older algos) or a {freq, probability}.
// Normalised here so the engine always sees both fields.
interface DetectorResult {
  freq: number;
  probability: number;
}
type Detector = (data: Float32Array) => DetectorResult | null;

export class PitchEngine {
  readonly sampleRate: number;
  readonly fftSize: number;
  readonly latencyBiasSec: number;
  private detector: Detector;

  private lastFreq = 0;
  private lastEmitTime = 0;
  private lastOnsetTime = 0;
  private silenceStart = 0;
  private inSilence = false;
  private freqHistory: number[] = [];
  // Lowest and highest chunk RMS observed since the last accepted onset.
  // Both drive the decay-aware onset gate: a new onset requires the signal
  // to have decayed (localMin small relative to peakSinceLastOnset) AND to
  // have risen sharply from that floor.
  private localMin = Infinity;
  private peakSinceLastOnset = 0;
  // Hold the onset for one process() call so the buffer fills with the new
  // attack's audio before pitch detection runs. Without this, the first
  // reading after an onset sees mostly pre-attack content (silence or the
  // tail of the previous note) and Macleod can't lock the new pitch.
  private pendingOnset: { time: number; firstPitch: number | null } | null = null;

  constructor(config: EngineConfig) {
    this.sampleRate = config.sampleRate;
    this.fftSize = config.fftSize ?? DEFAULT_FFT;
    this.latencyBiasSec = config.latencyBiasSec ?? 0;
    this.detector = this.buildDetector(
      config.algorithm ?? "Macleod",
      config.yinThreshold ?? 0.10,
    );
  }

  /**
   * Process one buffer (length = fftSize) and return any emissions.
   * `audioTime` is the audio-clock time of the LAST sample in the buffer.
   * `hints.beatProximity` (0..1) relaxes thresholds near expected note
   * positions — see ONSET_RATIO_* and PITCH_PROB_* constants.
   */
  process(
    buffer: Float32Array,
    audioTime: number,
    hints: ProcessHints = {},
  ): PitchReading[] {
    const out: PitchReading[] = [];
    const prox = Math.max(0, Math.min(1, hints.beatProximity ?? 0));
    const minProb = lerp(PITCH_PROB_CAUTIOUS, PITCH_PROB_EAGER, prox);

    // ---- Onset detection ----
    // Walk chunks within this buffer. prevRms is LOCAL — buffers overlap
    // heavily across ticks, so persisting it would compare audio backwards
    // in time. localMin DOES persist across ticks; it tracks the envelope's
    // lowest point since the last accepted onset.
    let onsetSampleIdx = -1;
    let onsetChunkRms = 0;
    let prevRms = -1;
    for (let c = 0; c + ONSET_CHUNK <= buffer.length; c += ONSET_CHUNK) {
      let s = 0;
      for (let i = 0; i < ONSET_CHUNK; i++) {
        const v = buffer[c + i];
        s += v * v;
      }
      const r = Math.sqrt(s / ONSET_CHUNK);

      // Track local minimum and running peak since last onset.
      if (r < this.localMin) this.localMin = r;
      if (r > this.peakSinceLastOnset) this.peakSinceLastOnset = r;

      const sharpRise = prevRms > 0 && r > prevRms * ONSET_RATIO;
      const aboveFloor = r > ONSET_MIN_RMS;
      const aboveLocalFloor =
        this.localMin === Infinity || r > this.localMin * LOCAL_MIN_RATIO;
      // Block multi-spike: require the dip since the last onset to be deep
      // enough that we know we're seeing a fresh decay-then-rise, not the
      // shallow trough between two halves of a single attack envelope.
      const decayedEnough =
        this.peakSinceLastOnset === 0 ||
        this.localMin < this.peakSinceLastOnset * DECAY_REQUIRED;

      if (sharpRise && aboveFloor && aboveLocalFloor && decayedEnough) {
        onsetSampleIdx = c;
        onsetChunkRms = r;
      }
      prevRms = r;
    }
    if (onsetSampleIdx >= 0) {
      const samplesAgo = buffer.length - onsetSampleIdx;
      const candidate = audioTime - samplesAgo / this.sampleRate;
      if (candidate > this.lastOnsetTime + ONSET_HARD_FLOOR) {
        this.lastOnsetTime = candidate;
        // Hold the emission. Pitch detection on THIS buffer would see mostly
        // pre-attack audio (Macleod uses the whole 85ms window, but only the
        // last 10-15ms contains the new attack). Defer by one process() call
        // so the next buffer has 25-30ms of post-attack audio for Macleod to
        // lock onto.
        this.pendingOnset = { time: candidate, firstPitch: null };
        // Reset both envelope trackers — the NEXT onset will be measured
        // against this onset's energy peak and the dip that follows.
        this.localMin = onsetChunkRms;
        this.peakSinceLastOnset = onsetChunkRms;
        return out;
      }
    }

    // ---- RMS gate ----
    let sumSq = 0;
    for (let i = 0; i < buffer.length; i++) sumSq += buffer[i] * buffer[i];
    const rms = Math.sqrt(sumSq / buffer.length);

    if (rms < SILENCE_RMS) {
      this.lastFreq = 0;
      if (!this.inSilence) {
        this.inSilence = true;
        this.silenceStart = audioTime;
      } else if (audioTime - this.silenceStart > HISTORY_CLEAR_AFTER_SILENCE) {
        this.freqHistory.length = 0;
      }
      return out;
    }
    this.inSilence = false;

    // ---- Pitch detection ----
    // No median filter — emit on the FIRST valid reading (priority: speed
    // over robustness on dirty input). Confidence gating via `minProb`
    // suppresses transient-attack mis-locks instead.
    const det = this.detector(buffer);
    if (det === null || det.freq < MIN_FREQ || det.freq > MAX_FREQ) return out;
    if (det.probability < minProb) return out;

    const freq = this.octaveCorrect(det.freq);

    const cents = this.lastFreq > 0 ? 1200 * Math.log2(freq / this.lastFreq) : Infinity;
    const hasPending = this.pendingOnset !== null;

    // Pitch jump without a fresh onset → transient mis-detect. Skip when
    // we have a pending onset, since the pitch jump IS the new note.
    if (this.lastFreq > 0 && Math.abs(cents) >= 50 && !hasPending) return out;

    const isNewNote = hasPending;
    if (!isNewNote && audioTime - this.lastEmitTime < SUSTAIN_INTERVAL) return out;

    this.lastFreq = freq;
    this.lastEmitTime = audioTime;

    let emitTime: number;
    if (this.pendingOnset) {
      emitTime = this.pendingOnset.time - this.latencyBiasSec;
      this.pendingOnset = null;
    } else {
      emitTime = audioTime - this.latencyBiasSec;
    }

    out.push({ freq, time: emitTime, isNewNote });

    this.freqHistory.push(freq);
    if (this.freqHistory.length > 5) this.freqHistory.shift();

    return out;
  }

  reset() {
    this.lastFreq = 0;
    this.lastEmitTime = 0;
    this.lastOnsetTime = 0;
    this.silenceStart = 0;
    this.inSilence = false;
    this.freqHistory.length = 0;
    this.localMin = Infinity;
    this.peakSinceLastOnset = 0;
    this.pendingOnset = null;
  }

  /** Update the latency bias live — useful when AudioContext.outputLatency changes. */
  setLatencyBias(seconds: number) {
    (this as { latencyBiasSec: number }).latencyBiasSec = seconds;
  }

  /** Snap a raw reading to the octave closest to the recent geometric mean. */
  private octaveCorrect(freq: number): number {
    if (this.freqHistory.length < 2) return freq;
    const logCenter =
      this.freqHistory.reduce((s, v) => s + Math.log2(v), 0) /
      this.freqHistory.length;

    let best = freq;
    let bestDist = Math.abs(Math.log2(freq) - logCenter);

    for (const factor of [0.25, 0.5, 2, 4, 8]) {
      const candidate = freq * factor;
      if (candidate < MIN_FREQ || candidate > MAX_FREQ) continue;
      const dist = Math.abs(Math.log2(candidate) - logCenter);
      if (dist < bestDist) {
        best = candidate;
        bestDist = dist;
      }
    }
    return best;
  }

  private buildDetector(algo: Algorithm, threshold: number): Detector {
    // Non-Macleod algorithms don't expose a probability; treat them as
    // always-confident (1.0) so confidence gating becomes a no-op for them.
    switch (algo) {
      case "YIN": {
        const d = YIN({ sampleRate: this.sampleRate, threshold });
        return (b) => {
          const v = d(b);
          return typeof v === "number" ? { freq: v, probability: 1.0 } : null;
        };
      }
      case "Macleod": {
        const d = Macleod({ sampleRate: this.sampleRate, bufferSize: this.fftSize });
        return (b) => {
          const v = d(b);
          if (v === null) return null;
          if (typeof v === "number") return { freq: v, probability: 1.0 };
          return { freq: v.freq, probability: v.probability };
        };
      }
      case "AMDF": {
        const d = AMDF({ sampleRate: this.sampleRate });
        return (b) => {
          const v = d(b);
          return typeof v === "number" ? { freq: v, probability: 1.0 } : null;
        };
      }
      case "ACF2PLUS": {
        const d = ACF2PLUS({ sampleRate: this.sampleRate });
        return (b) => {
          const v = d(b);
          return typeof v === "number" ? { freq: v, probability: 1.0 } : null;
        };
      }
    }
  }
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
