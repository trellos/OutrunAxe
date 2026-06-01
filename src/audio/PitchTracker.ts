// Live mic capture + pitch detection. The audio render thread does ONSET
// DETECTION (in onsetWorklet.ts, ~2.7 ms quanta, no rAF throttling). The
// main thread does PITCH DETECTION on demand: each onset message schedules
// a setTimeout `PITCH_DETECTION_DELAY` later, which reads the AnalyserNode
// buffer and asks PitchEngine to detect pitch. PitchEngine retains all the
// post-onset event-shaping logic (dup-window, hammer-on classifier,
// silence-driven NoteEnds, sustain emissions).
//
// Public API unchanged from Phase B:
//   tracker.onOnset(fn) / onPitchUpdate(fn) / onNoteEnd(fn) / onLevel(fn)
//   tracker.endActive(reason) / reset() / start() / stop()

import {
  PitchEngine,
  PITCH_DETECTION_DELAY,
  type EngineEvent,
  type OnsetEvent,
  type PitchUpdate,
  type NoteEnd,
} from "./PitchEngine";
import { getAudioContext } from "./AudioContextSingleton";
import workletUrl from "./onsetWorklet.ts?worker&url";
import type { OnsetMessage } from "./onsetWorklet";

export type { OnsetEvent, PitchUpdate, NoteEnd } from "./PitchEngine";

const FFT_SIZE = 2048;
const INPUT_LATENCY_HINT = 0.05;
const PITCH_DETECTION_DELAY_MS = PITCH_DETECTION_DELAY * 1000;
/** Cadence for sustain pitch detection (re-reads the AnalyserNode buffer
 *  while a note is active so bend updates and silence end can fire). */
const SUSTAIN_PITCH_INTERVAL_MS = 30;

export class PitchTracker {
  private ctx: AudioContext;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private buffer: Float32Array<ArrayBuffer> | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private engine: PitchEngine | null = null;
  private rafId: number | null = null;
  private sustainTimerId: number | null = null;
  private onsetListeners = new Set<(e: OnsetEvent) => void>();
  private pitchListeners = new Set<(u: PitchUpdate) => void>();
  private endListeners = new Set<(e: NoteEnd) => void>();
  private levelListeners = new Set<(level: number) => void>();
  private beatProximityProvider: ((audioTime: number) => number) | null = null;
  private fakeMicBuffer: AudioBuffer | null = null;
  private fakeSource: AudioBufferSourceNode | null = null;

  constructor() {
    this.ctx = getAudioContext();
  }

  get mediaStream() {
    return this.stream;
  }

  prepareFakeMic(audioBuffer: AudioBuffer) {
    this.fakeMicBuffer = audioBuffer;
  }

  /** Start the prepared fake-mic source. `when` (audio-clock time) schedules
   *  playback to begin exactly then — used to align a calibration file with the
   *  first scored measure; omit for immediate start. */
  startFakeMicPlayback(when?: number) {
    this.fakeSource?.start(when);
  }

  async start(): Promise<void> {
    if (this.analyser) return;

    // Load the onset worklet module. Vite serves the worklet at workletUrl
    // already bundled — onsetGate.ts is inlined into the worklet bundle.
    await this.ctx.audioWorklet.addModule(workletUrl);

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    this.buffer = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));

    this.workletNode = new AudioWorkletNode(this.ctx, "onset-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    this.workletNode.port.onmessage = (e) => this.handleOnsetMessage(e.data);

    if (this.fakeMicBuffer) {
      this.fakeSource = this.ctx.createBufferSource();
      this.fakeSource.buffer = this.fakeMicBuffer;
      this.fakeSource.connect(this.analyser);
      this.fakeSource.connect(this.workletNode);
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
      source.connect(this.workletNode);
    }

    // Worklet output is unused but must connect somewhere or the node may
    // be paused by the implementation. Route through a silent gain.
    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    this.workletNode.connect(sink);
    sink.connect(this.ctx.destination);

    this.engine = new PitchEngine({
      sampleRate: this.ctx.sampleRate,
      fftSize: FFT_SIZE,
      algorithm: "Macleod",
      latencyBiasSec: this.totalBias(),
    });

    // Lightweight rAF only for the level meter — onset detection is in the
    // worklet, pitch detection is scheduled per-onset.
    this.tick();
  }

  stop() {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    if (this.sustainTimerId !== null) clearTimeout(this.sustainTimerId);
    this.sustainTimerId = null;
    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      this.workletNode.disconnect();
    }
    this.workletNode = null;
    this.analyser = null;
    this.buffer = null;
    this.engine = null;
  }

  reset() {
    this.engine?.reset();
    this.workletNode?.port.postMessage("reset");
  }

  /** Force-end the current note (e.g. on phase change out of "playing"). */
  endActive(reason: "phase" | "silence" | "newOnset", time?: number) {
    const evt = this.engine?.endActive(reason, time);
    if (evt && evt.type === "noteEnd") {
      this.endListeners.forEach((fn) => fn(evt.noteEnd));
    }
  }

  setBeatProximityProvider(fn: ((audioTime: number) => number) | null) {
    this.beatProximityProvider = fn;
  }

  onOnset(fn: (e: OnsetEvent) => void) {
    this.onsetListeners.add(fn);
    return () => this.onsetListeners.delete(fn);
  }

  onPitchUpdate(fn: (u: PitchUpdate) => void) {
    this.pitchListeners.add(fn);
    return () => this.pitchListeners.delete(fn);
  }

  onNoteEnd(fn: (e: NoteEnd) => void) {
    this.endListeners.add(fn);
    return () => this.endListeners.delete(fn);
  }

  onLevel(fn: (level: number) => void) {
    this.levelListeners.add(fn);
    return () => this.levelListeners.delete(fn);
  }

  emitSyntheticNote(midi: number, audioTime: number) {
    const u: PitchUpdate = {
      onsetId: -Math.floor(Math.random() * 1e9),
      time: audioTime,
      freq: 440 * Math.pow(2, (midi - 69) / 12),
      midi,
      name: "",
      confidence: 1,
      status: "settled",
    };
    this.pitchListeners.forEach((fn) => fn(u));
  }

  /** Worklet posted an onset. Push it through the engine's dup-window check
   *  and schedule the first pitch read. */
  private handleOnsetMessage(msg: OnsetMessage) {
    if (msg.type !== "onset" || !this.engine) return;
    this.engine.setLatencyBias(this.totalBias());
    const events = this.engine.acceptChunkOnset(msg.time, msg.rms);
    this.publishEvents(events);
    // Schedule the first pitch read once the buffer is dominated by post-
    // attack audio. Sustain reads start cycling thereafter.
    setTimeout(() => this.runPitchRead(), PITCH_DETECTION_DELAY_MS);
    this.scheduleSustainRead();
  }

  /** Periodic pitch read while a note is active — drives bend updates and
   *  silence-driven NoteEnds. Self-rescheduling. */
  private scheduleSustainRead() {
    if (this.sustainTimerId !== null) return;
    const tick = () => {
      this.sustainTimerId = null;
      if (!this.engine) return;
      this.runPitchRead();
      // Keep sustain reads going while a note is active OR until the engine
      // emits a NoteEnd (which it'll do on silence). We stop scheduling
      // once the engine has no active note AND no awaiting-first-pitch.
      if (this.engine && this.shouldKeepSustainPolling()) {
        this.sustainTimerId = window.setTimeout(tick, SUSTAIN_PITCH_INTERVAL_MS);
      }
    };
    this.sustainTimerId = window.setTimeout(tick, SUSTAIN_PITCH_INTERVAL_MS);
  }

  /** True if the engine still has an active note that needs sustain reads. */
  private shouldKeepSustainPolling(): boolean {
    return !!this.engine?.hasActiveNote();
  }

  private runPitchRead() {
    if (!this.engine || !this.analyser || !this.buffer) return;
    this.analyser.getFloatTimeDomainData(this.buffer);
    const now = this.ctx.currentTime;
    const beatProximity = this.beatProximityProvider?.(now) ?? 0;
    const events = this.engine.detectPitch(this.buffer, now, { beatProximity });
    this.publishEvents(events);
  }

  private publishEvents(events: EngineEvent[]) {
    for (const e of events) {
      if (e.type === "onset") this.onsetListeners.forEach((fn) => fn(e.onset));
      else if (e.type === "pitch") this.pitchListeners.forEach((fn) => fn(e.pitch));
      else this.endListeners.forEach((fn) => fn(e.noteEnd));
    }
  }

  /** rAF-paced level meter only. Onset / pitch run off the worklet path. */
  private tick = () => {
    this.rafId = requestAnimationFrame(this.tick);
    if (!this.analyser || !this.buffer) return;
    this.analyser.getFloatTimeDomainData(this.buffer);
    let sumSq = 0;
    for (let i = 0; i < this.buffer.length; i++) sumSq += this.buffer[i] * this.buffer[i];
    const rms = Math.sqrt(sumSq / this.buffer.length);
    this.levelListeners.forEach((fn) => fn(rms));
  };

  private totalBias() {
    const out = this.ctx.outputLatency ?? 0;
    return out + INPUT_LATENCY_HINT;
  }
}
