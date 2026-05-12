// Offline pitch-detection harness. Feeds decoded audio through the SAME
// PitchEngine the live PitchTracker uses, so results are guaranteed to match
// what the live game would produce on the same audio (modulo cadence — see
// note on tickStep).
//
// The engine now emits OnsetEvent/PitchUpdate/NoteEnd. This file converts
// them back to a flat `DetectedNote[]` for the test bench UI / verifier.

import { PitchEngine, type Algorithm } from "../audio/PitchEngine";
import { freqToMidi, midiToName } from "../audio/midi";

export interface DetectedNote {
  time: number;
  freq: number;
  midi: number;
  name: string;
  source: "onset" | "fallback";
}

export interface RawTick {
  time: number;
  rms: number;
  rawFreq: number | null;
  correctedFreq: number;
  rawName: string;
  correctedName: string;
  onsetFlag: boolean;
}

export interface AnalyzeOptions {
  fftSize?: number;
  tickStep?: number;
  yinThreshold?: number;
  inputLatencyHint?: number; // applied as PitchEngine latency bias
  algorithm?: Algorithm;
  /** 0..1 hint per tick — pass-through to PitchEngine.process. */
  beatProximityProvider?: (audioTime: number) => number;
}

export function analyze(
  samples: Float32Array,
  sampleRate: number,
  opts: AnalyzeOptions = {},
): DetectedNote[] {
  const fftSize = opts.fftSize ?? 2048;
  const step = opts.tickStep ?? 512;

  const engine = new PitchEngine({
    sampleRate,
    fftSize,
    algorithm: opts.algorithm ?? "Macleod",
    yinThreshold: opts.yinThreshold ?? 0.10,
    latencyBiasSec: opts.inputLatencyHint ?? 0,
  });

  const buffer = new Float32Array(fftSize);
  const out: DetectedNote[] = [];

  // Track current onset id so PitchUpdates without a paired OnsetEvent (e.g.
  // continuation reads) can still be rendered.
  let lastOnsetTime = 0;

  for (let cursor = fftSize; cursor <= samples.length; cursor += step) {
    buffer.set(samples.subarray(cursor - fftSize, cursor));
    const tickTime = cursor / sampleRate;

    const beatProximity = opts.beatProximityProvider?.(tickTime) ?? 0;
    const events = engine.process(buffer, tickTime, { beatProximity });
    for (const e of events) {
      if (e.type === "onset") {
        lastOnsetTime = e.onset.time;
      } else if (e.type === "pitch") {
        const midi = freqToMidi(e.pitch.freq);
        out.push({
          // For a preliminary pitch (the first reading of a new note), use
          // the onset time so the dot anchors at the attack. Subsequent
          // settled readings use their own time.
          time: e.pitch.status === "preliminary" ? lastOnsetTime : e.pitch.time,
          freq: e.pitch.freq,
          midi,
          name: midiToName(midi),
          source: e.pitch.status === "preliminary" ? "onset" : "fallback",
        });
      }
      // noteEnd events are dropped here — the test bench doesn't render them
      // as DetectedNotes. The verifier consumes them separately if needed.
    }
  }

  return out;
}

/**
 * Per-tick trace for diagnosis. Bypasses the engine — just dumps per-tick RMS.
 */
export function analyzeRaw(
  samples: Float32Array,
  _sampleRate: number,
  opts: AnalyzeOptions = {},
): RawTick[] {
  const fftSize = opts.fftSize ?? 2048;
  const step = opts.tickStep ?? 512;
  const buffer = new Float32Array(fftSize);

  const out: RawTick[] = [];
  for (let cursor = fftSize; cursor <= samples.length; cursor += step) {
    buffer.set(samples.subarray(cursor - fftSize, cursor));
    const time = cursor / _sampleRate;

    let sumSq = 0;
    for (let i = 0; i < buffer.length; i++) sumSq += buffer[i] * buffer[i];
    const rms = Math.sqrt(sumSq / buffer.length);

    out.push({
      time,
      rms,
      rawFreq: null,
      correctedFreq: 0,
      rawName: "-",
      correctedName: "-",
      onsetFlag: false,
    });
  }
  return out;
}

/** Per-window RMS for waveform visualisation. */
export function envelope(samples: Float32Array, windowSize: number): Float32Array {
  const out = new Float32Array(Math.ceil(samples.length / windowSize));
  for (let w = 0; w < out.length; w++) {
    const start = w * windowSize;
    const end = Math.min(start + windowSize, samples.length);
    let s = 0;
    for (let i = start; i < end; i++) s += samples[i] * samples[i];
    out[w] = Math.sqrt(s / (end - start));
  }
  return out;
}
