// Tempo-locked beat scheduler. Owns the audio clock and the phase machine for
// the whole game.
//
// Pattern: Chris Wilson's lookahead scheduler. A setInterval ticks every
// ~25ms; each tick we look ~100ms ahead and queue any beats whose audio-clock
// time falls inside that window. Beats are queued at exact audioContext times
// so timing is sample-accurate regardless of JS jitter.

import { getAudioContext } from "./AudioContextSingleton";
import { DrumSynth } from "./DrumSynth";
import { BeepSynth } from "./BeepSynth";

export type Phase = "idle" | "preroll" | "countIn" | "playing" | "done";

export interface BeatInfo {
  beat: number;          // monotonic counter from when click started
  time: number;          // audio-clock time the beat will sound
  phase: Phase;
  beatInPhase: number;   // 0..3 inside the current measure, or count-in beat
  measureInPlay: number; // 0..3 during 'playing', else -1
}

const SCHEDULE_INTERVAL_MS = 25;
const LOOKAHEAD_SEC = 0.1;
const COUNT_IN_BEATS = 4;
const PLAY_BEATS = 16; // 4 measures × 4 beats

/** ±window in seconds around an expected attack position. Shared with the
 *  offline test bench so both callers use identical beat-proximity logic. */
export const BEAT_PROXIMITY_WINDOW = 0.05;
/** Beat subdivisions as fractions of a beat (1 = quarter, 0.5 = 8th, 1/3 = triplet 8th). */
export const BEAT_PROXIMITY_SUBS_OF_BEAT = [1, 0.5, 1 / 3] as const;

export class Conductor {
  private ctx: AudioContext;
  private master: GainNode;
  private drums: DrumSynth;
  private beeps: BeepSynth;

  private bpm = 90;
  private startTime = 0;       // audio time of beat 0
  private nextBeat = 0;        // next beat index to schedule
  private playStartBeat = -1;  // beat at which count-in begins
  private phase: Phase = "idle";
  private timer: number | null = null;
  private beatLog: BeatInfo[] = []; // recent scheduled beats (for visuals)
  private listeners = new Set<(b: BeatInfo) => void>();
  private phaseListeners = new Set<(p: Phase) => void>();

  constructor() {
    this.ctx = getAudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(this.ctx.destination);
    this.drums = new DrumSynth(this.ctx, this.master);
    this.beeps = new BeepSynth(this.ctx, this.master);
  }

  get currentBpm() { return this.bpm; }
  get currentPhase() { return this.phase; }
  get audioTime() { return this.ctx.currentTime; }
  get muted() { return this.master.gain.value === 0; }

  setMuted(muted: boolean) {
    this.master.gain.value = muted ? 0 : 0.7;
  }

  setBpm(bpm: number) {
    if (this.phase !== "idle" && this.phase !== "preroll") return;
    const clamped = Math.max(60, Math.min(120, bpm));
    if (this.phase === "preroll") {
      // Re-anchor so the next scheduled beat lands at the same audio time but
      // future beats use the new spacing.
      const now = this.ctx.currentTime;
      const oldSpacing = 60 / this.bpm;
      const beatsElapsed = Math.max(0, Math.floor((now - this.startTime) / oldSpacing));
      this.bpm = clamped;
      const newSpacing = 60 / this.bpm;
      this.startTime = now - beatsElapsed * newSpacing;
      this.nextBeat = beatsElapsed + 1;
    } else {
      this.bpm = clamped;
    }
  }

  startPreroll() {
    if (this.phase !== "idle") return;
    void this.ctx.resume();
    this.phase = "preroll";
    this.startTime = this.ctx.currentTime + 0.1;
    this.nextBeat = 0;
    this.scheduler();
    this.timer = window.setInterval(() => this.scheduler(), SCHEDULE_INTERVAL_MS);
    this.emitPhase();
  }

  triggerPlay() {
    if (this.phase !== "preroll") return;
    // Schedule count-in to begin at the next downbeat (beat where index % 4 === 0).
    const upcoming = Math.max(this.nextBeat, this.beatsElapsed() + 1);
    const remainder = upcoming % 4;
    this.playStartBeat = remainder === 0 ? upcoming : upcoming + (4 - remainder);
  }

  stop() {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.phase = "idle";
    this.playStartBeat = -1;
    this.beatLog = [];
    this.emitPhase();
  }

  onBeat(fn: (b: BeatInfo) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onPhaseChange(fn: (p: Phase) => void) {
    this.phaseListeners.add(fn);
    return () => this.phaseListeners.delete(fn);
  }

  /** Wall-clock measure index (0..3) the playhead is currently inside, or -1. */
  currentPlayMeasure(): number {
    if (this.phase !== "playing" || this.playStartBeat < 0) return -1;
    const playedBeat = this.beatsElapsed() - (this.playStartBeat + COUNT_IN_BEATS);
    if (playedBeat < 0 || playedBeat >= PLAY_BEATS) return -1;
    return Math.floor(playedBeat / 4);
  }

  /** Audio-clock time at which the given play measure (0..3) begins. */
  measureStartTime(measureIdx: number): number {
    const beat = this.playStartBeat + COUNT_IN_BEATS + measureIdx * 4;
    return this.startTime + beat * (60 / this.bpm);
  }

  /**
   * 0..1 estimate of "is a note expected to start at this moment?". 1 right
   * on an expected attack position (quarter / eighth / triplet 8th), falling
   * linearly to 0 at BEAT_PROXIMITY_WINDOW away. Used by PitchEngine to relax
   * thresholds near expected positions, trading false positives at quiet
   * moments for lower latency at musical moments.
   */
  proximityToExpectedAttack(audioTime: number): number {
    if (this.phase !== "playing" || this.playStartBeat < 0) return 0;
    const beatDur = 60 / this.bpm;
    const playStart = this.measureStartTime(0);
    const into = audioTime - playStart;
    if (into < 0 || into > PLAY_BEATS * beatDur) return 0;

    let minDist = Infinity;
    for (const frac of BEAT_PROXIMITY_SUBS_OF_BEAT) {
      const sub = frac * beatDur;
      const closest = Math.round(into / sub) * sub;
      const dist = Math.abs(into - closest);
      if (dist < minDist) minDist = dist;
    }

    if (minDist >= BEAT_PROXIMITY_WINDOW) return 0;
    return 1 - minDist / BEAT_PROXIMITY_WINDOW;
  }

  /**
   * Which play measure (0..3) contains the given audio-clock time, or -1 if
   * outside the play window. Used for onset-corrected note placement so a
   * backdated onset near a bar line lands in the right bar.
   *
   * A small grace period (1/16 of a beat) is allowed before measure 0 so a
   * note plucked just before the downbeat still counts toward the first bar
   * instead of being dropped.
   */
  measureForTime(audioTime: number): number {
    if (this.playStartBeat < 0) return -1;
    const beatDur = 60 / this.bpm;
    const grace = beatDur / 16;
    const playStart = this.measureStartTime(0);
    const into = audioTime - (playStart - grace);
    if (into < 0) return -1;
    const beat = Math.floor(into / beatDur);
    if (beat >= PLAY_BEATS) return -1;
    return Math.floor(beat / 4);
  }

  measureDuration(): number {
    return 4 * (60 / this.bpm);
  }

  private beatsElapsed(): number {
    return Math.floor((this.ctx.currentTime - this.startTime) / (60 / this.bpm));
  }

  private scheduler() {
    const horizon = this.ctx.currentTime + LOOKAHEAD_SEC;
    const spb = 60 / this.bpm;

    while (this.startTime + this.nextBeat * spb < horizon) {
      const time = this.startTime + this.nextBeat * spb;
      const info = this.classify(this.nextBeat, time);

      if (info.phase === "countIn") {
        this.beeps.beep(time, info.beatInPhase === 0);
      } else if (info.phase === "preroll" || info.phase === "playing") {
        this.playDrumPattern(info.beatInPhase, time);
      }

      this.beatLog.push(info);
      if (this.beatLog.length > 32) this.beatLog.shift();
      this.listeners.forEach((fn) => fn(info));

      this.nextBeat++;

      if (info.phase === "playing" && info.measureInPlay === 3 && info.beatInPhase === 3) {
        // Last beat of the last measure has been scheduled. Let it ring out,
        // then transition to done.
        const endAt = time + spb;
        const delay = Math.max(0, (endAt - this.ctx.currentTime) * 1000);
        window.setTimeout(() => this.finish(), delay);
      }
    }

    this.maybeAdvancePhase();
  }

  private classify(beat: number, _time: number): BeatInfo {
    let phase: Phase = this.phase;
    let beatInPhase = beat % 4;
    let measureInPlay = -1;

    if (this.playStartBeat >= 0 && beat >= this.playStartBeat) {
      const sincePlay = beat - this.playStartBeat;
      if (sincePlay < COUNT_IN_BEATS) {
        phase = "countIn";
        beatInPhase = sincePlay;
      } else if (sincePlay < COUNT_IN_BEATS + PLAY_BEATS) {
        phase = "playing";
        const playedBeat = sincePlay - COUNT_IN_BEATS;
        measureInPlay = Math.floor(playedBeat / 4);
        beatInPhase = playedBeat % 4;
      }
    }

    return { beat, time: _time, phase, beatInPhase, measureInPlay };
  }

  private maybeAdvancePhase() {
    if (this.playStartBeat < 0) return;
    const elapsed = this.beatsElapsed();
    const sincePlay = elapsed - this.playStartBeat;
    let next: Phase = this.phase;
    if (sincePlay < 0) next = "preroll";
    else if (sincePlay < COUNT_IN_BEATS) next = "countIn";
    else if (sincePlay < COUNT_IN_BEATS + PLAY_BEATS) next = "playing";
    if (next !== this.phase) {
      this.phase = next;
      this.emitPhase();
    }
  }

  private playDrumPattern(beatInBar: number, time: number) {
    // Standard rock pattern: kick on 1 & 3, snare on 2 & 4, hat every beat.
    if (beatInBar === 0 || beatInBar === 2) this.drums.kick(time);
    if (beatInBar === 1 || beatInBar === 3) this.drums.snare(time);
    this.drums.hat(time);
  }

  private finish() {
    this.phase = "done";
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.emitPhase();
  }

  private emitPhase() {
    this.phaseListeners.forEach((fn) => fn(this.phase));
  }
}
