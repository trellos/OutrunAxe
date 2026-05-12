// Single source of truth for monophonic pitch detection.
//
// Both the live PitchTracker (rAF + AnalyserNode) and the offline test bench
// (decoded WebM/MP3 → fixed sample stride) feed buffers into THIS engine.
// One algorithm guaranteed across both — no parallel implementations to drift.
//
import { YIN, AMDF, Macleod, ACF2PLUS } from "pitchfinder";
import { freqToMidi, midiToName } from "./midi";
import {
  ONSET_CHUNK,
  newOnsetState,
  onsetGate,
  type OnsetState,
} from "./onsetGate";

export type Algorithm = "Macleod" | "YIN" | "AMDF" | "ACF2PLUS";

/** Fires within ~3ms of an attack (worklet cadence) once Phase C lands. */
export interface OnsetEvent {
  /** Monotonic across the engine's life. PitchUpdate / NoteEnd reference this. */
  id: number;
  /** Audio-clock time of the actual attack (onset-corrected, latency-biased). */
  time: number;
  /** Attack peak chunk RMS — useful for "how hard". */
  energy: number;
  /** True for hammer-on/pull-off (no audio attack); false for real plucks. */
  synthetic: boolean;
}

/** Fires when pitch is detected. May fire multiple times for a single note. */
export interface PitchUpdate {
  onsetId: number;
  time: number;
  freq: number;
  midi: number;
  name: string;
  /** Detector probability (0..1). 1.0 if the detector doesn't expose one. */
  confidence: number;
  /** preliminary = first reading post-attack; settled = locked / refined. */
  status: "preliminary" | "settled";
}

/** Fires once when a note ends. Note bounds are explicit, not timeout-based. */
export interface NoteEnd {
  onsetId: number;
  time: number;
  reason: "newOnset" | "silence" | "phase";
}

/** Discriminated union the engine emits per process() call. */
export type EngineEvent =
  | { type: "onset"; onset: OnsetEvent }
  | { type: "pitch"; pitch: PitchUpdate }
  | { type: "noteEnd"; noteEnd: NoteEnd };

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

const DEFAULT_FFT = 2048;        // 43ms @ 48kHz; fits inside one 16th-at-140 (107ms)
const MIN_FREQ = 70;
const MAX_FREQ = 1300;
const HISTORY_CLEAR_AFTER_SILENCE = 0.4;
const SILENCE_RMS = 0.01;
const SUSTAIN_INTERVAL = 0.06;    // 60ms — at least one mid-note pitch sample on a 107ms 16th

// Onset chunk size and the four gates (sharp-rise, above-floor, above-local,
// time/decay/energy) live in onsetGate.ts so the AudioWorklet and the
// offline analyzer can share the exact same logic. PitchEngine only owns
// the *post-gate* concerns: dup-window suppression, OnsetEvent emission,
// pitch detection, and the bend/hammer-on classifier.

// First-pitch thresholds intentionally strict. Macleod's low-confidence reads
// (~0.7) are dominated by subharmonic errors (×1/3 of the true fundamental),
// which neither octave-correction nor snap can recover (those only handle
// powers of 2). Better to wait an extra tick or two for the detector to
// stabilize at ≥0.95 confidence.
const PITCH_PROB_CAUTIOUS = 0.95;
const PITCH_PROB_EAGER = 0.90;
const PITCH_PROB_TRACKING = 0.55; // continuing a known note; bar is lower

// How long to hold a pending onset before running pitch detection. The
// fftSize buffer needs to be DOMINATED by post-attack audio, not pre-attack
// content. With a 2048-sample (43ms) buffer at 48kHz, waiting 25ms gives us
// 25ms new attack + 18ms previous content — new attack wins.
export const PITCH_DETECTION_DELAY = 0.025;

// Bend / hammer-on classifier. A pitch jump during sustain is a bend if its
// rate is below this; a hammer-on / pull-off if above. Bends max out around
// 1300¢/s for an aggressive 1.5-tone bend over 250ms; hammer-ons are
// instantaneous pitch swaps so they show up as the entire jump in one tick
// (~80ms) = much higher rate.
const BEND_RATE_THRESHOLD = 1500;

// Real guitar pluck has a secondary string-settle spike 100–200 ms after the
// initial attack — same string still vibrating, same pitch. Without this
// gate the engine fires a phantom OnsetEvent for every plucked note. When a
// candidate onset lands inside this window of the last EMITTED onset, we
// defer the emission until pitch is read; if the new pitch class matches
// the last emitted pitch class, drop the candidate as a settle artefact.
// Cost: ~25 ms onset latency for tentative onsets. Limitation: legitimate
// same-pitch repeats inside this window are also suppressed.
const DUPLICATE_ONSET_WINDOW = 0.25;

interface DetectorResult {
  freq: number;
  probability: number;
}
type Detector = (data: Float32Array) => DetectorResult | null;

export class PitchEngine {
  readonly sampleRate: number;
  readonly fftSize: number;
  latencyBiasSec: number;
  private detector: Detector;

  // Per-note state machine:
  //   idle ──[onset]──► awaitingFirstPitch ──[firstPitch]──► active
  //   active ──[silence/phase/newOnset]──► idle
  //   active ──[hammer-on]──► awaitingFirstPitch (new onsetId)
  // currentNoteIsActive=true in both awaitingFirstPitch and active states.
  private currentOnsetId = 0;     // 0 = no active note
  private nextOnsetId = 1;
  private currentNoteIsActive = false;
  /** True between OnsetEvent emit and first PitchUpdate(preliminary) emit. */
  private awaitingFirstPitch = false;

  // Per-emission state.
  private lastFreq = 0;
  private lastEmitTime = 0;

  // Onset / envelope state. lastOnsetTime, lastOnsetChunkRms, and localMin
  // all live inside `onsetState` (shared shape with the AudioWorklet's
  // own state instance). Mutated by onsetGate during the offline scan path
  // and by acceptChunkOnset when an onset is delivered from the worklet.
  private onsetState: OnsetState = newOnsetState();
  private silenceStart = 0;
  private inSilence = false;
  private freqHistory: number[] = [];

  // String-settle suppression state. lastEmittedNoteTime / Midi track the
  // last Preliminary PitchUpdate we propagated; pendingDuplicateOnset holds
  // a tentative onset whose emission is deferred until its pitch is known.
  private lastEmittedNoteTime = 0;
  private lastEmittedNoteMidi = -1;
  private pendingDuplicateOnset: { time: number; energy: number } | null = null;

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
   * Offline / live-rAF entry point. Scans the buffer for an onset chunk
   * (running it through the shared `onsetGate`), feeds any accepted onset
   * to `acceptChunkOnset`, then runs `detectPitch` on the same buffer.
   *
   * The AudioWorklet path doesn't call this — it calls `acceptChunkOnset`
   * directly when its quantum-cadence onset detector fires, then schedules
   * `detectPitch` on the main thread once enough post-attack audio has
   * accumulated in the AnalyserNode.
   *
   * `audioTime` is the audio-clock time of the LAST sample in the buffer.
   */
  process(
    buffer: Float32Array,
    audioTime: number,
    hints: ProcessHints = {},
  ): EngineEvent[] {
    const out: EngineEvent[] = [];

    // Reset prevChunkRms each call — the offline scan walks 4 chunks of a
    // (possibly overlapping) buffer per tick, which only forms a contiguous
    // chunk stream when tickStep === ONSET_CHUNK. Resetting per call keeps
    // the legacy non-aligned (live rAF) cadence behaving as it always did.
    this.onsetState.prevChunkRms = 0;

    // Walk the buffer in 512-sample chunks. The LAST chunk in the buffer
    // that satisfies all gates wins (matches the prior process() semantics).
    let acceptedTime = -1;
    let acceptedRms = 0;
    for (let c = 0; c + ONSET_CHUNK <= buffer.length; c += ONSET_CHUNK) {
      let s = 0;
      for (let i = 0; i < ONSET_CHUNK; i++) {
        const v = buffer[c + i];
        s += v * v;
      }
      const r = Math.sqrt(s / ONSET_CHUNK);
      const chunkEndTime =
        audioTime - (buffer.length - (c + ONSET_CHUNK)) / this.sampleRate;
      const chunkStartTime = chunkEndTime - ONSET_CHUNK / this.sampleRate;
      if (onsetGate(r, chunkStartTime, chunkEndTime, this.onsetState)) {
        acceptedTime = chunkStartTime;
        acceptedRms = r;
      }
    }
    if (acceptedTime >= 0) {
      out.push(...this.acceptChunkOnset(acceptedTime, acceptedRms));
      // The chunk-detection branch returns early in the original engine.
      // Preserving that: don't run pitch detection in the same tick — the
      // next tick will pick it up once PITCH_DETECTION_DELAY has elapsed.
      return out;
    }

    out.push(...this.detectPitch(buffer, audioTime, hints));
    return out;
  }

  /**
   * Called by the worklet path (and by `process` for the offline path) when
   * a chunk-level onset has passed all `onsetGate` gates. Decides whether
   * to emit OnsetEvent immediately or defer for string-settle confirmation
   * (same-pitch-class duplicate suppression).
   *
   * `time` is the audio-clock time of the START of the firing chunk.
   * `energy` is the chunk's RMS — propagated to the OnsetEvent.
   *
   * The worklet has already updated its own OnsetState; we sync ours here
   * so subsequent offline scans (e.g. the test bench) see a consistent
   * lastOnsetTime/Rms/localMin.
   */
  acceptChunkOnset(time: number, energy: number): EngineEvent[] {
    const out: EngineEvent[] = [];
    this.onsetState.lastOnsetTime = time;
    this.onsetState.lastOnsetChunkRms = energy;
    this.onsetState.localMin = energy;

    const inDupWindow =
      this.lastEmittedNoteTime > 0 &&
      time - this.lastEmittedNoteTime < DUPLICATE_ONSET_WINDOW;
    if (inDupWindow) {
      this.pendingDuplicateOnset = { time, energy };
      return out;
    }

    if (this.currentNoteIsActive) {
      out.push(this.endActiveNote(time, "newOnset"));
    }
    this.currentOnsetId = this.nextOnsetId++;
    this.currentNoteIsActive = true;
    this.awaitingFirstPitch = true;
    this.lastFreq = 0;
    out.push({
      type: "onset",
      onset: {
        id: this.currentOnsetId,
        time: time - this.latencyBiasSec,
        energy,
        synthetic: false,
      },
    });
    return out;
  }

  /**
   * Run pitch detection on a buffer. Emits PitchUpdate (preliminary or
   * settled), synthetic hammer-on/pull-off OnsetEvents, and silence-driven
   * NoteEnds. Idempotent across many calls per note.
   *
   * The worklet path calls this on a setTimeout scheduled
   * `PITCH_DETECTION_DELAY` after each onset; the offline path calls it
   * once per tick.
   */
  detectPitch(
    buffer: Float32Array,
    audioTime: number,
    hints: ProcessHints = {},
  ): EngineEvent[] {
    const out: EngineEvent[] = [];
    const prox = Math.max(0, Math.min(1, hints.beatProximity ?? 0));

    // ---- RMS / silence ----
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
      // Sustained silence ends the active note exactly once.
      if (
        this.currentNoteIsActive &&
        audioTime - this.silenceStart > 0.1
      ) {
        out.push(this.endActiveNote(audioTime, "silence"));
      }
      return out;
    }
    this.inSilence = false;

    // ---- Pitch detection ----
    const det = this.detector(buffer);
    if (det === null || det.freq < MIN_FREQ || det.freq > MAX_FREQ) return out;

    // Confidence threshold: stricter to LOCK a new note, lax to TRACK an
    // existing one (where pitch can wobble during bends or detector jitter).
    const minProb = this.awaitingFirstPitch
      ? lerp(PITCH_PROB_CAUTIOUS, PITCH_PROB_EAGER, prox)
      : PITCH_PROB_TRACKING;
    if (det.probability < minProb) return out;

    // Octave-correct only when locking a new note (using cross-note history).
    // During sustain of an active note, snap to the current note's octave
    // instead — the detector occasionally latches onto a subharmonic which
    // would otherwise register as a 1200¢ "hammer-on". Bends max at 300¢
    // (≈0.25 in log2 space) so an octave snap never disturbs them.
    let freq: number;
    if (this.currentNoteIsActive && !this.awaitingFirstPitch && this.lastFreq > 0) {
      freq = snapToOctaveOf(det.freq, this.lastFreq);
    } else {
      freq = this.octaveCorrect(det.freq);
    }

    const cents = this.lastFreq > 0 ? 1200 * Math.log2(freq / this.lastFreq) : Infinity;

    // Tentative onset deferred for string-settle / slide check. Run pitch
    // detection; drop the tentative if the new pitch class matches the last
    // emitted (string-settle artefact) OR is exactly one semitone away
    // (Bug 5: a sliding finger between adjacent scale notes momentarily
    // sounds the chromatic in-between pitch — F→F#→G, A→A#→B, etc. Real
    // 8th-note scale plays sit OUTSIDE the dup window so the legitimate
    // step still fires; only mid-slide reads inside the window are killed.)
    if (this.pendingDuplicateOnset) {
      if (audioTime - this.pendingDuplicateOnset.time < PITCH_DETECTION_DELAY) return out;

      const newMidi = freqToMidi(freq);
      const samePitch =
        this.lastEmittedNoteMidi >= 0 &&
        ((newMidi % 12) + 12) % 12 === ((this.lastEmittedNoteMidi % 12) + 12) % 12;
      const chromaticNeighbor =
        this.lastEmittedNoteMidi >= 0 &&
        Math.abs(newMidi - this.lastEmittedNoteMidi) === 1;
      if (samePitch || chromaticNeighbor) {
        this.pendingDuplicateOnset = null;
        return out;
      }

      // Real new note that just happened to land inside the suppression
      // window (e.g. a fast scale step). Promote it.
      if (this.currentNoteIsActive) {
        out.push(this.endActiveNote(this.pendingDuplicateOnset.time, "newOnset"));
      }
      const onsetTime = this.pendingDuplicateOnset.time - this.latencyBiasSec;
      this.currentOnsetId = this.nextOnsetId++;
      this.currentNoteIsActive = true;
      out.push({
        type: "onset",
        onset: {
          id: this.currentOnsetId,
          time: onsetTime,
          energy: this.pendingDuplicateOnset.energy,
          synthetic: false,
        },
      });
      out.push({
        type: "pitch",
        pitch: {
          onsetId: this.currentOnsetId,
          time: onsetTime,
          freq,
          midi: newMidi,
          name: midiToName(newMidi),
          confidence: det.probability,
          status: "preliminary",
        },
      });
      this.lastEmittedNoteTime = this.pendingDuplicateOnset.time;
      this.lastEmittedNoteMidi = newMidi;
      this.pendingDuplicateOnset = null;
      this.awaitingFirstPitch = false;
      this.lastFreq = freq;
      this.lastEmitTime = audioTime;
      this.freqHistory.push(freq);
      if (this.freqHistory.length > 5) this.freqHistory.shift();
      return out;
    }

    if (this.awaitingFirstPitch && this.currentNoteIsActive) {
      // Wait until enough post-attack audio has accumulated for Macleod to
      // lock the new pitch (not the previous note's tail).
      if (audioTime - this.onsetState.lastOnsetTime < PITCH_DETECTION_DELAY) return out;

      const newMidi = freqToMidi(freq);
      out.push({
        type: "pitch",
        pitch: {
          onsetId: this.currentOnsetId,
          time: this.onsetState.lastOnsetTime - this.latencyBiasSec,
          freq,
          midi: newMidi,
          name: midiToName(newMidi),
          confidence: det.probability,
          status: "preliminary",
        },
      });
      this.lastEmittedNoteTime = this.onsetState.lastOnsetTime;
      this.lastEmittedNoteMidi = newMidi;
      this.awaitingFirstPitch = false;
      this.lastFreq = freq;
      this.lastEmitTime = audioTime;
      this.freqHistory.push(freq);
      if (this.freqHistory.length > 5) this.freqHistory.shift();
      return out;
    }

    // Past this point we're handling a SUSTAIN reading on an active note.
    if (!this.currentNoteIsActive) return out;

    const dtSinceOnset = audioTime - this.onsetState.lastOnsetTime;
    const dtSinceEmit = audioTime - this.lastEmitTime;

    // Within the first ~120ms of the attack, suppress pitch jumps — they're
    // transient mis-locks (Macleod briefly latching on a harmonic). 120ms
    // covers the attack burst and initial body before harmonic content
    // settles. Real hammer-ons / pull-offs fire after the player has held
    // the note for at least an 8th note (>200ms at typical tempos).
    const inTransient = dtSinceOnset < 0.12;
    if (Math.abs(cents) >= 50 && inTransient) return out;

    // Implausible pitch jumps during sustain are detector failures (Macleod
    // briefly locking onto noise or onto the previous note's residual). No
    // physical guitar technique on a single pluck spans more than a perfect
    // 5th (~700¢); anything beyond is wobble — skip the reading without
    // updating state so we don't fabricate spurious hammer-on events.
    if (Math.abs(cents) > 700) return out;

    if (Math.abs(cents) >= 50 && !inTransient) {
      // Real pitch change. Classify as bend (smooth) or hammer-on (abrupt).
      const ratePerSec = dtSinceEmit > 0 ? Math.abs(cents) / dtSinceEmit : Infinity;
      if (ratePerSec >= BEND_RATE_THRESHOLD) {
        // Hammer-on / pull-off — synthesise a new onset on the same note id.
        out.push(this.endActiveNote(audioTime, "newOnset"));
        this.currentOnsetId = this.nextOnsetId++;
        this.currentNoteIsActive = true;
        this.onsetState.lastOnsetTime = audioTime;
        const newMidi = freqToMidi(freq);
        out.push({
          type: "onset",
          onset: {
            id: this.currentOnsetId,
            time: audioTime - this.latencyBiasSec,
            energy: 0, // unknown; sustain RMS would be a better placeholder
            synthetic: true,
          },
        });
        out.push({
          type: "pitch",
          pitch: {
            onsetId: this.currentOnsetId,
            time: audioTime - this.latencyBiasSec,
            freq,
            midi: newMidi,
            name: midiToName(newMidi),
            confidence: det.probability,
            // First reading of a fresh note (hammer-on or pull-off). Marked
            // preliminary so consumers treat it as a note start, not a bend.
            status: "preliminary",
          },
        });
        this.lastEmittedNoteTime = audioTime;
        this.lastEmittedNoteMidi = newMidi;
        this.lastFreq = freq;
        this.lastEmitTime = audioTime;
        this.freqHistory.length = 0;
        this.freqHistory.push(freq);
        return out;
      }
      // Otherwise fall through and emit as a bend update on the same onsetId.
    }

    // Sustain emission gate (rate limit).
    if (dtSinceEmit < SUSTAIN_INTERVAL && Math.abs(cents) < 50) return out;

    const midi = freqToMidi(freq);
    out.push({
      type: "pitch",
      pitch: {
        onsetId: this.currentOnsetId,
        time: audioTime - this.latencyBiasSec,
        freq,
        midi,
        name: midiToName(midi),
        confidence: det.probability,
        status: "settled",
      },
    });

    this.lastFreq = freq;
    this.lastEmitTime = audioTime;
    this.freqHistory.push(freq);
    if (this.freqHistory.length > 5) this.freqHistory.shift();

    return out;
  }

  /** True iff there's a currently-active note (between OnsetEvent and
   *  NoteEnd). Used by PitchTracker to know when to keep polling pitch. */
  hasActiveNote(): boolean {
    return this.currentNoteIsActive || this.awaitingFirstPitch;
  }

  /**
   * Externally-triggered note end (e.g. PlayScene transitioning out of
   * "playing" phase). Returns the event if there was an active note.
   */
  endActive(reason: "phase" | "silence" | "newOnset", time?: number): EngineEvent | null {
    if (!this.currentNoteIsActive) return null;
    return this.endActiveNote(time ?? this.lastEmitTime, reason);
  }

  private endActiveNote(
    time: number,
    reason: "newOnset" | "silence" | "phase",
  ): EngineEvent {
    const evt: EngineEvent = {
      type: "noteEnd",
      noteEnd: {
        onsetId: this.currentOnsetId,
        time: time - this.latencyBiasSec,
        reason,
      },
    };
    this.currentNoteIsActive = false;
    this.awaitingFirstPitch = false;
    return evt;
  }

  reset() {
    this.lastFreq = 0;
    this.lastEmitTime = 0;
    this.onsetState = newOnsetState();
    this.silenceStart = 0;
    this.inSilence = false;
    this.freqHistory.length = 0;
    this.currentNoteIsActive = false;
    this.awaitingFirstPitch = false;
    this.lastEmittedNoteTime = 0;
    this.lastEmittedNoteMidi = -1;
    this.pendingDuplicateOnset = null;
    // Don't reset the onset id counter — keep ids monotonic across resets so
    // a stale event from a previous session can't be confused for a new one.
    this.currentOnsetId = 0;
  }

  setLatencyBias(seconds: number) {
    this.latencyBiasSec = seconds;
  }

  private octaveCorrect(freq: number): number {
    // Run with even one history entry — a single bad reading otherwise enters
    // freqHistory uncorrected and pulls the geometric anchor toward the wrong
    // octave for every subsequent reading, compounding indefinitely.
    if (this.freqHistory.length < 1) return freq;
    const logCenter =
      this.freqHistory.reduce((s, v) => s + Math.log2(v), 0) /
      this.freqHistory.length;

    const rawDist = Math.abs(Math.log2(freq) - logCenter);
    let best = freq;
    let bestDist = rawDist;

    // Includes integer multiples (×3, ×6) so 1/3-subharmonic errors from
    // Macleod can recover to the true fundamental, not just powers of 2.
    for (const factor of [1 / 6, 0.25, 1 / 3, 0.5, 2, 3, 4, 6, 8]) {
      const candidate = freq * factor;
      if (candidate < MIN_FREQ || candidate > MAX_FREQ) continue;
      const dist = Math.abs(Math.log2(candidate) - logCenter);
      if (dist < bestDist) {
        best = candidate;
        bestDist = dist;
      }
    }

    // Only commit the snap if it's a clear win — i.e. the raw is *far* from
    // the anchor and the snap target is much closer. Threshold 1.4 octaves
    // lets a real ±1-octave melodic jump pass through (raw and snap target
    // are equidistant; diff = 1.0) while still recovering 1/3-subharmonic
    // detector errors (raw dist ~1.58 octaves, snap dist ~0; diff ~1.58).
    const SNAP_DIFF_THRESHOLD = 1.4;
    if (rawDist - bestDist < SNAP_DIFF_THRESHOLD) return freq;
    return best;
  }

  private buildDetector(algo: Algorithm, threshold: number): Detector {
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

/**
 * If `freq` is within 200¢ of an octave-shifted version of `anchor`, snap to
 * that octave so a half/double-frequency detector latch is corrected back to
 * the active note. Returns `freq` unchanged when no near-octave match exists
 * (e.g. a real hammer-on to a different pitch class).
 */
function snapToOctaveOf(freq: number, anchor: number): number {
  let best = freq;
  let bestDist = Math.abs(Math.log2(freq) - Math.log2(anchor));
  // Powers of 2 only — during sustain we trust that the player is on the
  // SAME pitch class as the locked note, so 1/3 subharmonic errors should
  // snap to the same pitch class via ×3, not stay as a different note.
  // Add ×3, ×6, 1/3, 1/6 for the same reason as octaveCorrect.
  for (const factor of [1 / 6, 0.25, 1 / 3, 0.5, 2, 3, 4, 6]) {
    const candidate = freq * factor;
    if (candidate < MIN_FREQ || candidate > MAX_FREQ) continue;
    const dist = Math.abs(Math.log2(candidate) - Math.log2(anchor));
    if (dist < bestDist) {
      best = candidate;
      bestDist = dist;
    }
  }
  // Only snap if the best match is within 200¢ of the anchor — beyond that
  // it's not really an octave/subharmonic artefact, it's a genuine pitch
  // change (a real bend or hammer-on to a different pitch class).
  return bestDist < (200 / 1200) ? best : freq;
}
