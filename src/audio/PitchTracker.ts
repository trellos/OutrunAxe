// Live mic capture + pitch detection. Thin wrapper around PitchEngine: this
// file owns the mic stream and the rAF tick; PitchEngine owns the algorithm.
//
// See src/audio/PitchEngine.ts for the detection logic. Same engine is used
// by the offline test bench (src/test/analyze.ts), guaranteeing parity.

import { PitchEngine, type PitchReading } from "./PitchEngine";
import { getAudioContext } from "./AudioContextSingleton";

export type { PitchReading } from "./PitchEngine";

// 4096 samples (~85ms at 48kHz) gives Macleod enough periods to lock pitch
// reliably on guitar fundamentals. Smaller buffers visibly degrade detection
// quality. Latency cost is acceptable because onset detection (which drives
// dot position) operates at chunk-level resolution, not buffer-level.
const FFT_SIZE = 4096;
// Mic driver / OS capture pipeline — not exposed by any Web API.
// outputLatency is read live from AudioContext and added on top.
const INPUT_LATENCY_HINT = 0.05;

export class PitchTracker {
  private ctx: AudioContext;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private buffer: Float32Array<ArrayBuffer> | null = null;
  private engine: PitchEngine | null = null;
  private rafId: number | null = null;
  private listeners = new Set<(r: PitchReading) => void>();
  private levelListeners = new Set<(level: number) => void>();
  private beatProximityProvider: ((audioTime: number) => number) | null = null;
  // Fake-mic mode: when set, the engine reads from this pre-decoded audio
  // buffer instead of getUserMedia. Used by the runtime test harness to
  // pipe a known recording through the exact pipeline the live game uses.
  private fakeMicBuffer: AudioBuffer | null = null;
  private fakeSource: AudioBufferSourceNode | null = null;

  constructor() {
    this.ctx = getAudioContext();
  }

  get mediaStream() {
    return this.stream;
  }

  /** Configure to use a pre-decoded buffer as the mic source. Call before start(). */
  prepareFakeMic(audioBuffer: AudioBuffer) {
    this.fakeMicBuffer = audioBuffer;
  }

  /** Start the fake-mic playback. Call exactly once when the test should begin. */
  startFakeMicPlayback() {
    this.fakeSource?.start();
  }

  async start(): Promise<void> {
    if (this.analyser) return;

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    this.buffer = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));

    if (this.fakeMicBuffer) {
      // Test mode: feed the pre-decoded buffer through AnalyserNode without
      // playing it to speakers. AnalyserNode alone doesn't cause the audio
      // graph to actually pull samples from the source, so we also wire it
      // through a zero-gain node to the destination — that forces the render
      // thread to advance the source in real time without any audible output.
      this.fakeSource = this.ctx.createBufferSource();
      this.fakeSource.buffer = this.fakeMicBuffer;
      this.fakeSource.connect(this.analyser);
      const silent = this.ctx.createGain();
      silent.gain.value = 0;
      this.fakeSource.connect(silent);
      silent.connect(this.ctx.destination);
    } else {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      const source = this.ctx.createMediaStreamSource(this.stream);
      source.connect(this.analyser);
    }

    this.engine = new PitchEngine({
      sampleRate: this.ctx.sampleRate,
      fftSize: FFT_SIZE,
      algorithm: "Macleod",
      latencyBiasSec: this.totalBias(),
    });

    this.tick();
  }

  stop() {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.analyser = null;
    this.buffer = null;
    this.engine = null;
  }

  reset() {
    this.engine?.reset();
  }

  /**
   * Optional. If set, returns 0..1 = "is a note expected at this audio time?".
   * The engine relaxes thresholds when it's high.
   */
  setBeatProximityProvider(fn: ((audioTime: number) => number) | null) {
    this.beatProximityProvider = fn;
  }

  onPitch(fn: (r: PitchReading) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onLevel(fn: (level: number) => void) {
    this.levelListeners.add(fn);
    return () => this.levelListeners.delete(fn);
  }

  private tick = () => {
    this.rafId = requestAnimationFrame(this.tick);
    if (!this.analyser || !this.buffer || !this.engine) return;
    this.analyser.getFloatTimeDomainData(this.buffer);

    // Push current latency in case outputLatency changed since startup.
    this.engine.setLatencyBias(this.totalBias());

    // Cheap RMS for the title-screen mic-level pulse.
    let sumSq = 0;
    for (let i = 0; i < this.buffer.length; i++) sumSq += this.buffer[i] * this.buffer[i];
    const rms = Math.sqrt(sumSq / this.buffer.length);
    this.levelListeners.forEach((fn) => fn(rms));

    const now = this.ctx.currentTime;
    const beatProximity = this.beatProximityProvider?.(now) ?? 0;
    const readings = this.engine.process(this.buffer, now, { beatProximity });
    for (const r of readings) {
      this.listeners.forEach((fn) => fn(r));
    }
  };

  private totalBias() {
    const out = this.ctx.outputLatency ?? 0;
    return out + INPUT_LATENCY_HINT;
  }
}
