// A small "signal chain" indicator for the menu screens. It runs a looping
// 1-measure metronome (a Conductor parked in 'preroll' so it emits drums
// forever) plus a PitchTracker, and draws incoming pitches as bars on a
// single-measure timeline row — identical rendering to hud/Timeline.ts. This
// lets the player confirm mic/keyboard input works before a level starts.
//
// Lifecycle: construct + start() in a state's enter(), tick() in update(),
// stop() in exit(). stop() MUST fully tear down (tracker, conductor, DOM,
// listeners) so the menu→loadout→levelselect→level→results→retry loop never
// stacks audio clocks.

import { Conductor } from "../audio/Conductor";
import { PitchTracker } from "../audio/PitchTracker";
import { getAudioContext } from "../audio/AudioContextSingleton";

const KEY_TO_MIDI: Record<string, number> = {
  KeyZ: 48, KeyS: 49, KeyX: 50, KeyD: 51, KeyC: 52, KeyV: 53,
  KeyG: 54, KeyB: 55, KeyH: 56, KeyN: 57, KeyJ: 58, KeyM: 59,
  Comma: 60, KeyL: 61, Period: 62, Semicolon: 63, Slash: 64,
};

const BEATS = 4;
const PX_PER_BEAT = 36;
const ROW_HEIGHT = 44;
const MIDI_MIN = 40;
const MIDI_MAX = 76;
const BAND_HEIGHT = 6;

interface LastPoint {
  x: number;
  y: number;
  time: number;
  midi: number;
}

export class MenuPulse {
  private container: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private conductor: Conductor;
  private tracker: PitchTracker;
  private offBeat?: () => boolean;
  private offTracker?: () => boolean;
  private bpm = 96;
  // Audio time of the current measure window's beat 0. Advances one measure
  // at a time so plotting wraps cleanly and the row clears each loop.
  private measureStart = -1;
  private last: LastPoint | null = null;
  private stopped = false;
  private keyHandler?: (e: KeyboardEvent) => void;

  constructor(parent: HTMLElement) {
    this.container = document.createElement("div");
    this.container.className = "outrun-timeline outrun-menupulse";

    const label = document.createElement("div");
    label.className = "menupulse-label";
    label.textContent = "SIGNAL CHAIN";
    this.container.appendChild(label);

    this.canvas = document.createElement("canvas");
    this.canvas.width = BEATS * PX_PER_BEAT;
    this.canvas.height = ROW_HEIGHT;
    this.canvas.className = "timeline-row";
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;

    parent.appendChild(this.container);

    this.conductor = new Conductor();
    this.conductor.setBpm(this.bpm);
    this.bpm = this.conductor.currentBpm;
    this.tracker = new PitchTracker();

    this.drawGrid();
  }

  async start(): Promise<void> {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") await ctx.resume();

    // Parked in 'preroll' the conductor never advances phase (no triggerPlay),
    // so it emits a drum beat every beat forever — a free looping metronome.
    this.conductor.startPreroll();

    this.offBeat = this.conductor.onBeat((info) => {
      if (this.stopped) return;
      // Each measure downbeat opens a fresh single-measure window.
      if (info.beat % BEATS === 0) {
        this.measureStart = info.time;
        this.last = null;
        this.drawGrid();
      }
    });

    this.offTracker = this.tracker.onPitchUpdate((u) => {
      if (this.stopped) return;
      this.plotPitch(u.time, u.midi);
    });

    // The keyboard piano is an instrument on the menus too: make sound and
    // feed the tracker so the signal chain reads with or without a mic.
    this.keyHandler = (e: KeyboardEvent) => {
      if (this.stopped || e.repeat) return;
      const midi = KEY_TO_MIDI[e.code];
      if (midi === undefined) return;
      const t = this.conductor.audioTime;
      this.playTone(midi, t);
      this.tracker.emitSyntheticNote(midi, t);
    };
    window.addEventListener("keydown", this.keyHandler);

    try {
      await this.tracker.start();
    } catch (err) {
      // Mic denied/unavailable — keyboard input still flows through the
      // tracker (via synthetic notes), so the chain indicator still works.
      console.warn("[menu-pulse] mic denied or unavailable", err);
    }
  }

  private playTone(midi: number, audioTime: number) {
    const ctx = getAudioContext();
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, audioTime);
    gain.gain.linearRampToValueAtTime(0.18, audioTime + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, audioTime + 0.35);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 220;
    osc.connect(hp).connect(gain).connect(ctx.destination);
    osc.start(audioTime);
    osc.stop(audioTime + 0.4);
  }

  tick() {
    // Beats/pitches are event-driven; nothing per-frame, but keep a hook so
    // states can call update()->tick() uniformly.
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.keyHandler) window.removeEventListener("keydown", this.keyHandler);
    this.keyHandler = undefined;
    this.offBeat?.();
    this.offTracker?.();
    this.tracker.stop();
    this.conductor.stop();
    this.container.remove();
  }

  private drawGrid() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(26, 15, 46, 0.55)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let b = 0; b <= BEATS; b++) {
      const x = b * PX_PER_BEAT;
      const isMeasure = b % BEATS === 0;
      ctx.strokeStyle = isMeasure ? "rgba(255,43,214,0.7)" : "rgba(74,42,122,0.5)";
      ctx.lineWidth = isMeasure ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(74,42,122,0.25)";
    ctx.lineWidth = 0.5;
    for (let b = 0; b < BEATS; b++) {
      for (let sub = 1; sub < 4; sub++) {
        const x = b * PX_PER_BEAT + (sub * PX_PER_BEAT) / 4;
        ctx.beginPath();
        ctx.moveTo(x, ROW_HEIGHT * 0.25);
        ctx.lineTo(x, ROW_HEIGHT * 0.75);
        ctx.stroke();
      }
    }
  }

  private plotPitch(audioTime: number, midi: number) {
    if (this.measureStart < 0) return;
    const beatDur = 60 / this.bpm;
    const span = BEATS * beatDur;
    const into = audioTime - this.measureStart;
    if (into < 0 || into > span) return;
    const x = (into / beatDur) * PX_PER_BEAT;
    const norm = Math.max(0, Math.min(1, (midi - MIDI_MIN) / (MIDI_MAX - MIDI_MIN)));
    const y = ROW_HEIGHT - norm * (ROW_HEIGHT - 8) - 4;
    const ctx = this.ctx;
    ctx.fillStyle = "#00f0ff";

    const sameBar =
      this.last !== null &&
      audioTime - this.last.time < beatDur / 8 &&
      audioTime >= this.last.time &&
      Math.abs(midi - this.last.midi) < 2;

    if (sameBar && this.last) {
      const x0 = Math.min(this.last.x, x);
      const x1 = Math.max(this.last.x, x);
      ctx.fillRect(x0, y - BAND_HEIGHT / 2, Math.max(1, x1 - x0), BAND_HEIGHT);
    } else {
      ctx.fillRect(x, y - BAND_HEIGHT / 2, 2, BAND_HEIGHT);
    }

    this.last = { x, y, time: audioTime, midi };
  }
}
