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
import { BarAccumulator } from "./noteBars";

const KEY_TO_MIDI: Record<string, number> = {
  KeyZ: 48, KeyS: 49, KeyX: 50, KeyD: 51, KeyC: 52, KeyV: 53,
  KeyG: 54, KeyB: 55, KeyH: 56, KeyN: 57, KeyJ: 58, KeyM: 59,
  Comma: 60, KeyL: 61, Period: 62, Semicolon: 63, Slash: 64,
};

const BEATS = 4;
// One looping 4-beat measure spanning a compact strip at the very top.
const PX_PER_BEAT = 120;
const ROW_HEIGHT = 24;
const MIDI_MIN = 40;
const MIDI_MAX = 76;
// Thin horizontal segment, not a tall block that covers the title/character.
const BAND_HEIGHT = 3;
// Brief bright pulse fades over this window after its beat fires.
const PULSE_FADE_MS = 150;

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
  // Same shared bar grouper as hud/Timeline.ts: group strictly by onsetId so
  // a sustained note draws as one solid bar instead of fragmenting on wobble.
  private bars = new BarAccumulator(PX_PER_BEAT / 10);
  private overlay: HTMLCanvasElement;
  private overlayCtx: CanvasRenderingContext2D;
  private rafId = 0;
  private stopped = false;
  private keyHandler?: (e: KeyboardEvent) => void;

  constructor(parent: HTMLElement) {
    this.container = document.createElement("div");
    this.container.className = "outrun-timeline outrun-menupulse";
    this.container.style.position = "relative";

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

    // Transparent, non-interactive beat-pulse overlay layered over the row.
    this.overlay = document.createElement("canvas");
    this.overlay.width = BEATS * PX_PER_BEAT;
    this.overlay.height = ROW_HEIGHT;
    this.overlay.style.position = "absolute";
    this.overlay.style.left = "0";
    this.overlay.style.bottom = "0";
    this.overlay.style.pointerEvents = "none";
    this.container.appendChild(this.overlay);
    this.overlayCtx = this.overlay.getContext("2d")!;

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
        // Each measure window opens fresh — a new bar must start cleanly.
        this.bars.reset();
        this.drawGrid();
      }
    });

    this.offTracker = this.tracker.onPitchUpdate((u) => {
      if (this.stopped) return;
      this.plotPitch(u.time, u.midi, u.onsetId);
    });

    // Private rAF loop owned by MenuPulse — pulse drawn on the overlay only.
    const tick = () => {
      this.drawPulse();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);

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
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.offBeat?.();
    this.offTracker?.();
    this.tracker.stop();
    this.conductor.stop();
    this.overlay.remove();
    this.container.remove();
  }

  /**
   * Pulse the vertical beat line for the beat currently being recorded in the
   * active measure window. Drawn ONLY on the transparent overlay — the note
   * canvas is never cleared/redrawn here. Pulses whenever a window is open.
   */
  private drawPulse() {
    const ctx = this.overlayCtx;
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    if (this.stopped || this.measureStart < 0) return;

    const beatDur = 60 / this.bpm;
    const into = this.conductor.audioTime - this.measureStart;
    if (into < 0 || into > BEATS * beatDur) return;

    const beatIdx = Math.floor(into / beatDur);
    if (beatIdx < 0 || beatIdx >= BEATS) return;

    const sinceBeatMs = (into - beatIdx * beatDur) * 1000;
    const alpha = Math.max(0, 1 - sinceBeatMs / PULSE_FADE_MS);
    if (alpha <= 0) return;

    const x = beatIdx * PX_PER_BEAT;
    ctx.strokeStyle = `rgba(0, 240, 255, ${alpha})`;
    ctx.lineWidth = 3;
    ctx.shadowColor = "rgba(0, 240, 255, 0.9)";
    ctx.shadowBlur = 8 * alpha;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, this.overlay.height);
    ctx.stroke();
    ctx.shadowBlur = 0;
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

  private plotPitch(audioTime: number, midi: number, onsetId: number) {
    if (this.measureStart < 0) return;
    const beatDur = 60 / this.bpm;
    const span = BEATS * beatDur;
    const into = audioTime - this.measureStart;
    if (into < 0 || into > span) return;
    const clamped = Math.max(0, Math.min(span, into));
    const x = (clamped / beatDur) * PX_PER_BEAT;
    const norm = Math.max(0, Math.min(1, (midi - MIDI_MIN) / (MIDI_MAX - MIDI_MIN)));
    const pad = Math.min(4, ROW_HEIGHT / 4);
    const y = ROW_HEIGHT - norm * (ROW_HEIGHT - 2 * pad) - pad;
    const ctx = this.ctx;
    ctx.fillStyle = "#00f0ff";

    // Group strictly by onsetId (see hud/noteBars.ts) so a sustained note is
    // one solid bar even when mic pitch wobbles ≥2 semitones between reads.
    const bar = this.bars.feed(onsetId, x, y);
    if (!bar) return;
    ctx.fillRect(
      bar.x0,
      bar.y - BAND_HEIGHT / 2,
      Math.max(1, bar.x1 - bar.x0),
      BAND_HEIGHT,
    );
  }
}
