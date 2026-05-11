// Offline pitch-detection harness. Feeds decoded audio through the SAME
// PitchEngine the live PitchTracker uses, so results are guaranteed to match
// what the live game would produce on the same audio (modulo cadence — see
// note on tickStep).

import { PitchEngine, type Algorithm } from "../audio/PitchEngine";

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

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function freqToMidi(freq: number): number {
  return Math.round(69 + 12 * Math.log2(freq / 440));
}
function midiToName(midi: number): string {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
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

  for (let cursor = fftSize; cursor <= samples.length; cursor += step) {
    buffer.set(samples.subarray(cursor - fftSize, cursor));
    const tickTime = cursor / sampleRate;

    const beatProximity = opts.beatProximityProvider?.(tickTime) ?? 0;
    const readings = engine.process(buffer, tickTime, { beatProximity });
    for (const r of readings) {
      const midi = freqToMidi(r.freq);
      out.push({
        time: r.time,
        freq: r.freq,
        midi,
        name: midiToName(midi),
        source: r.isNewNote ? "onset" : "fallback",
      });
    }
  }

  return out;
}

/**
 * Per-tick trace for diagnosis. Bypasses the engine's gates — runs a *second*
 * pass over the audio with a fresh detector, mirroring the engine's setup but
 * returning what YIN/Macleod sees at every tick.
 *
 * Used only by the test bench UI; not part of the live path.
 */
export function analyzeRaw(
  samples: Float32Array,
  sampleRate: number,
  opts: AnalyzeOptions = {},
): RawTick[] {
  // Lightweight raw view: just dump per-tick RMS + the engine's emissions
  // mapped back to their tick. The detailed YIN/Macleod-by-tick trace from
  // the prior implementation was useful during diagnosis but is no longer
  // worth maintaining a second algorithm path for. If we need it again, add
  // an introspection hook on PitchEngine instead.
  const fftSize = opts.fftSize ?? 2048;
  const step = opts.tickStep ?? 512;
  const buffer = new Float32Array(fftSize);

  const out: RawTick[] = [];
  for (let cursor = fftSize; cursor <= samples.length; cursor += step) {
    buffer.set(samples.subarray(cursor - fftSize, cursor));
    const time = cursor / sampleRate;

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
