// AudioWorkletProcessor that runs onset detection on the audio render
// thread. Posts a message over its port whenever a chunk fires an accepted
// onset. The main thread (PitchTracker) listens, schedules pitch detection,
// and emits the OnsetEvent / PitchUpdate / NoteEnd stream from PitchEngine.
//
// Cadence: the audio thread delivers 128-sample quanta. We accumulate into
// 512-sample chunks (4 quanta) before running the gate — same chunk size
// the offline analyzer uses, so the two paths agree on which signals fire.
//
// IMPORTANT: this file runs in the AudioWorkletGlobalScope, which has no
// `window`, no `setTimeout`, no module imports outside of the worklet
// runtime. Vite handles bundling via `?worker&url` (see vite.config.ts).

import {
  ONSET_CHUNK,
  newOnsetState,
  onsetGate,
  type OnsetState,
} from "./onsetGate";

/** Message posted over the worklet port when a chunk fires an onset. */
export interface OnsetMessage {
  type: "onset";
  /** Audio-clock time of the START of the firing chunk. */
  time: number;
  /** RMS of the firing chunk — useful as an energy hint. */
  rms: number;
}

declare const sampleRate: number;
declare const currentTime: number;
declare const currentFrame: number;

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  ctor: new () => AudioWorkletProcessor,
): void;

class OnsetProcessor extends AudioWorkletProcessor {
  private state: OnsetState = newOnsetState();
  /** Rolling 512-sample chunk buffer. Filled in 128-sample increments. */
  private chunk = new Float32Array(ONSET_CHUNK);
  private chunkFill = 0;
  /**
   * Sample index (since worklet start) of the FIRST sample currently
   * accumulated in `chunk`. Used to compute the chunk's audio-clock time.
   */
  private chunkStartFrame = 0;

  constructor() {
    super();
    this.port.onmessage = (e) => {
      if (e.data === "reset") {
        this.state = newOnsetState();
        this.chunkFill = 0;
        this.chunkStartFrame = currentFrame;
      }
    };
    this.chunkStartFrame = currentFrame;
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const ch0 = input[0];
    if (!ch0 || ch0.length === 0) return true;

    // Loudest-channel selection — pick the channel with the highest energy
    // this quantum rather than averaging, so a silent channel can't dilute a
    // loud one. The actual mic path delivers a single channel from
    // getUserMedia; this branch is defensive for multi-channel inputs.
    let mono: Float32Array;
    if (input.length === 1) {
      mono = ch0;
    } else {
      let loudest = 0;
      let bestSumSq = -1;
      for (let c = 0; c < input.length; c++) {
        const data = input[c];
        let sumSq = 0;
        for (let i = 0; i < ch0.length; i++) sumSq += data[i] * data[i];
        if (sumSq > bestSumSq) {
          bestSumSq = sumSq;
          loudest = c;
        }
      }
      mono = input[loudest];
    }

    let read = 0;
    while (read < mono.length) {
      const room = ONSET_CHUNK - this.chunkFill;
      const take = Math.min(room, mono.length - read);
      this.chunk.set(mono.subarray(read, read + take), this.chunkFill);
      this.chunkFill += take;
      read += take;

      if (this.chunkFill === ONSET_CHUNK) {
        // Chunk is full — compute RMS and run the gate.
        let s = 0;
        for (let i = 0; i < ONSET_CHUNK; i++) {
          const v = this.chunk[i];
          s += v * v;
        }
        const rms = Math.sqrt(s / ONSET_CHUNK);
        const chunkStartTime = this.chunkStartFrame / sampleRate;
        const chunkEndTime = (this.chunkStartFrame + ONSET_CHUNK) / sampleRate;

        if (onsetGate(rms, chunkStartTime, chunkEndTime, this.state)) {
          const msg: OnsetMessage = {
            type: "onset",
            time: chunkStartTime,
            rms,
          };
          this.port.postMessage(msg);
        }

        this.chunkStartFrame += ONSET_CHUNK;
        this.chunkFill = 0;
      }
    }

    return true;
  }
}

registerProcessor("onset-processor", OnsetProcessor);
