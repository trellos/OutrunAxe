// EddieSettingsState — the Infinite Eddie settings screen (GDD §1, §6.1, §9).
//
// Lets the player pick a tempo (default 120, 4/4 fixed) and a key (12 tones +
// Major/Minor), starting from a RANDOM key in {E,A,G,C} × {major,minor}. It
// auditions the live 80s beat + generated bass (Sound's EddieAudioRig) and a
// live 4-measure input timeline (proving the mic/keyboard signal chain),
// regenerates the bassline whenever the key changes, and mounts Art's juicy
// PLAY button which hands a fully-populated EddieConfig to InfiniteEddieState.
//
// One audio clock: a single Eddie-sized Conductor parked in 'preroll' drives
// BOTH the audio rig (so the beat/bass loop forever, like MenuPulse's
// metronome) AND the input timeline. Timing reads the Conductor clock; only the
// canvas pulse interpolates against rAF (GDD §2). exit() tears everything down.

import type { Game, GameState } from "../engine/Game";
import { Conductor } from "../audio/Conductor";
import { PitchTracker } from "../audio/PitchTracker";
import { getAudioContext } from "../audio/AudioContextSingleton";
import { BarAccumulator } from "../hud/noteBars";
import { NOTE_NAMES } from "../audio/midi";
import { generateBassline } from "../music/eddie/basslineGen";
import type { EddieConfig, PitchClass, KeyMode } from "../music/eddie/eddieTypes";
import {
  createEddieAudio,
  type EddieAudioRig,
} from "../audio/eddie/eddieAudioFactory";
import {
  createEddiePlayButton,
  type EddiePlayButton,
} from "../eddie/art/EddiePlayButton";
import { InfiniteEddieState } from "./InfiniteEddieState";
import { LevelState } from "./LevelState";
import { PerfHud } from "../hud/PerfHud";
import "../eddie/art/settings-themes.css";

const PLAY_BUTTON_VARIANT = "option-1" as const;
const AUDIO_VARIANT = "option-1" as const;

const DEFAULT_BPM = 120;
const MIN_BPM = 60;
const MAX_BPM = 200;
const BPM_STEP = 5;

// Initial random key is drawn from this restricted set (GDD §1 / §9).
const RANDOM_KEY_ROOTS: PitchClass[] = ["E", "A", "G", "C"];
const RANDOM_KEY_MODES: KeyMode[] = ["major", "minor"];

// --- Input timeline geometry (MenuPulse-style, but 4 measures wide) ---------
const BEATS = 4;
const PX_PER_BEAT = 120;
const LANES = 12;
const LANE_PITCH = 7;
const BAND_HEIGHT = 5;
const LANE_PAD = 4;
const ROW_HEIGHT = LANES * LANE_PITCH + 2 * LANE_PAD;

const KEY_TO_MIDI: Record<string, number> = {
  KeyZ: 48, KeyS: 49, KeyX: 50, KeyD: 51, KeyC: 52, KeyV: 53,
  KeyG: 54, KeyB: 55, KeyH: 56, KeyN: 57, KeyJ: 58, KeyM: 59,
  Comma: 60, KeyL: 61, Period: 62, Semicolon: 63, Slash: 64,
};

function laneY(midi: number): number {
  const lane = ((Math.round(midi) % 12) + 12) % 12;
  return Math.round(ROW_HEIGHT - LANE_PAD - lane * LANE_PITCH - LANE_PITCH / 2);
}

export class EddieSettingsState implements GameState {
  readonly name = "eddieSettings";
  private game!: Game;
  private hudParent: HTMLElement;

  private bpm = DEFAULT_BPM;
  private keyRoot: PitchClass;
  private keyMode: KeyMode;
  private bassline: EddieConfig["bassline"] = [];

  // DOM
  private overlay: HTMLDivElement | null = null;
  private bpmValueEl: HTMLElement | null = null;
  private bassValueEl: HTMLElement | null = null;
  private bassNoteEls: HTMLElement[] = [];
  private playMount: HTMLDivElement | null = null;

  // Audio + signal chain (one Conductor parked in preroll).
  private conductor: Conductor | null = null;
  private tracker: PitchTracker | null = null;
  private audio: EddieAudioRig | null = null;
  private playButton: EddiePlayButton | null = null;
  private offBeat?: () => void;
  private keyHandler?: (e: KeyboardEvent) => void;

  // Timeline canvas state.
  private timelineWrap: HTMLDivElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx2d: CanvasRenderingContext2D | null = null;
  private overlayCanvas: HTMLCanvasElement | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;
  private measureStart = -1;
  private bars = new BarAccumulator(PX_PER_BEAT / 10);


  /** Realtime diagnostics overlay (?perf=1) — fps, frame gaps, beat-drop. */
  private perf: PerfHud | null = null;

  // --- Record/debug: capture the live mic input + detection stream on THIS
  // screen (where players audition the timeline) so detection misses can be
  // downloaded and diagnosed. ---
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private recording = false;
  private recStartAudioTime = 0;
  private capOnsets: { time: number; energy: number; synthetic: boolean }[] = [];
  private capPitches: {
    onsetId: number; time: number; freq: number; midi: number; confidence: number; status: string;
  }[] = [];
  private capNoteEnds: { onsetId: number; time: number; reason: string }[] = [];
  private recBtn: HTMLButtonElement | null = null;
  private recHint: HTMLElement | null = null;

  constructor(hudParent: HTMLElement) {
    this.hudParent = hudParent;
    // Random initial key from {E,A,G,C} × {major,minor} (GDD §9).
    this.keyRoot = RANDOM_KEY_ROOTS[Math.floor(Math.random() * RANDOM_KEY_ROOTS.length)];
    this.keyMode = RANDOM_KEY_MODES[Math.floor(Math.random() * RANDOM_KEY_MODES.length)];
    this.regenerateBassline();
  }

  enter(game: Game) {
    this.game = game;

    // No 3D background on this screen. The decorative WebGL canvas was being
    // RE-COMPOSITED every frame, which is the framerate bottleneck on
    // integrated GPUs — so hide the canvas entirely (it isn't even a composited
    // layer then). The settings UI is pure DOM and needs no 3D. Graphics pass
    // comes later; restored on exit.
    game.renderer.canvas.style.display = "none";

    this.buildDom();

    // Realtime diagnostics overlay (?perf=1) — measures true fps/frame gaps and
    // flags dropped beats on the player's real machine.
    if (new URLSearchParams(location.search).has("perf")) {
      this.perf = new PerfHud();
      this.perf.mount(this.hudParent);
      this.perf.setPlaying(true); // settings audition loops the beat continuously
    }

    // One Eddie-sized Conductor for the audition + signal chain. Parked in
    // preroll (no triggerPlay) it emits beats forever, so the EddieAudioRig
    // loops the beat + 4-measure bass like a metronome.
    this.conductor = new Conductor({ maxBpm: MAX_BPM });
    this.conductor.setBpm(this.bpm);
    this.tracker = new PitchTracker();
    this.audio = createEddieAudio(AUDIO_VARIANT, this.conductor, this.currentConfig());
    this.audio.start();

    void this.startSignalChain();

    this.keyHandler = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const midi = KEY_TO_MIDI[e.code];
      if (midi === undefined || !this.conductor || !this.tracker) return;
      const t = this.conductor.audioTime;
      this.playTone(midi, t);
      this.tracker.emitSyntheticNote(midi, t);
    };
    window.addEventListener("keydown", this.keyHandler);
  }

  exit() {
    if (this.keyHandler) window.removeEventListener("keydown", this.keyHandler);
    this.keyHandler = undefined;
    if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
      try { this.mediaRecorder.stop(); } catch { /* already stopped */ }
    }
    this.mediaRecorder = null;
    this.perf?.dispose();
    this.perf = null;
    this.offBeat?.();
    this.playButton?.dispose();
    this.playButton = null;
    this.tracker?.stop();
    this.audio?.stop();
    this.audio = null;
    this.conductor?.stop();
    this.conductor = null;

    // Restore the WebGL canvas we hid on entry for the next state to use.
    this.game.renderer.canvas.style.display = "block";

    this.overlayCanvas?.remove();
    this.overlayCanvas = null;
    this.overlay?.remove();
    this.overlay = null;
  }

  update(dt: number) {
    this.playButton?.update(dt);
    this.drawPulse();
  }

  // ------------------------------------------------------------------------
  // Config
  // ------------------------------------------------------------------------

  private regenerateBassline() {
    this.bassline = generateBassline(this.keyRoot, this.keyMode);
  }

  private currentConfig(): EddieConfig {
    // 8th tag in scored measure 4..11; 16th tag in 8..15, always different.
    const eighthTagMeasure = 4 + Math.floor(Math.random() * 8); // 4..11
    let sixteenthTagMeasure = 8 + Math.floor(Math.random() * 8); // 8..15
    if (sixteenthTagMeasure === eighthTagMeasure) {
      sixteenthTagMeasure = eighthTagMeasure === 15 ? 8 : eighthTagMeasure + 1;
    }
    return {
      bpm: this.bpm,
      keyRoot: this.keyRoot,
      keyMode: this.keyMode,
      bassline: this.bassline,
      eighthTagMeasure,
      sixteenthTagMeasure,
    };
  }

  // ------------------------------------------------------------------------
  // DOM
  // ------------------------------------------------------------------------

  private buildDom() {
    const overlay = document.createElement("div");
    overlay.className = "outrun-levelselect eddie-settings";
    // 80s theme selection for review: ?eddie=1&theme=N (N=1..4) applies one of
    // the settings-themes.css designs. No param = current baseline styling.
    // theme-6 "Dithered Pastel" is the production default; ?eddie=1&theme=N (1..6)
    // overrides it for review.
    const themeParam = new URLSearchParams(location.search).get("theme");
    const themeN = themeParam ? parseInt(themeParam, 10) : 6;
    if (themeN >= 1 && themeN <= 6) overlay.classList.add(`eddie-theme-${themeN}`);

    overlay.innerHTML = `
      <div class="levelselect-inner">
        <div class="levelselect-title">INFINITE EDDIE</div>
        <div class="eddie-settings-row">
          <span class="eddie-settings-label">TEMPO</span>
          <button class="eddie-settings-btn" data-act="bpm-down">&minus;</button>
          <span class="eddie-settings-value" data-field="bpm">${this.bpm} BPM</span>
          <button class="eddie-settings-btn" data-act="bpm-up">+</button>
        </div>
        <div class="eddie-settings-row">
          <span class="eddie-settings-label">KEY</span>
          <select class="eddie-settings-select" data-field="key-root">${this.keyOptions()}</select>
          <label class="eddie-settings-radio"><input type="radio" name="eddie-mode" value="major"${this.keyMode === "major" ? " checked" : ""}><span>Major</span></label>
          <label class="eddie-settings-radio"><input type="radio" name="eddie-mode" value="minor"${this.keyMode === "minor" ? " checked" : ""}><span>Minor</span></label>
        </div>
        <div class="eddie-settings-row">
          <span class="eddie-settings-label">BASS</span>
          <span class="eddie-settings-value eddie-bass-window" data-field="bass">${this.bassWindowHtml()}</span>
        </div>
        <div class="eddie-settings-timeline"></div>
        <div class="eddie-settings-row eddie-rec-row">
          <button class="eddie-rec-btn" type="button">&#9679; RECORD</button>
          <span class="eddie-rec-hint">play a few bars, then it downloads your audio + detected notes</span>
        </div>
        <div class="eddie-settings-play"></div>
      </div>
    `;
    this.hudParent.appendChild(overlay);
    this.overlay = overlay;

    this.bpmValueEl = overlay.querySelector('[data-field="bpm"]');
    this.bassValueEl = overlay.querySelector('[data-field="bass"]');
    this.bassNoteEls = [...overlay.querySelectorAll<HTMLElement>(".eddie-bass-note")];

    overlay.querySelectorAll<HTMLButtonElement>(".eddie-settings-btn").forEach((btn) => {
      btn.addEventListener("click", () => this.onAction(btn.getAttribute("data-act")));
    });

    // Key root dropdown + Major/Minor radios.
    const rootSel = overlay.querySelector<HTMLSelectElement>('[data-field="key-root"]');
    rootSel?.addEventListener("change", () => {
      this.keyRoot = rootSel.value as PitchClass;
      this.regenerateBassline();
      this.refreshLabels();
    });
    overlay.querySelectorAll<HTMLInputElement>('input[name="eddie-mode"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        if (!radio.checked) return;
        this.keyMode = radio.value as KeyMode;
        this.regenerateBassline();
        this.refreshLabels();
      });
    });

    // Record button (debug): one-tap capture of mic input + detection stream.
    this.recBtn = overlay.querySelector<HTMLButtonElement>(".eddie-rec-btn");
    this.recHint = overlay.querySelector<HTMLElement>(".eddie-rec-hint");
    this.recBtn?.addEventListener("click", () => this.toggleRec());

    // Live input timeline.
    this.timelineWrap = overlay.querySelector(".eddie-settings-timeline");
    if (this.timelineWrap) this.buildTimeline(this.timelineWrap);

    // Art's juicy PLAY button.
    this.playMount = overlay.querySelector(".eddie-settings-play");
    if (this.playMount) {
      this.playButton = createEddiePlayButton(PLAY_BUTTON_VARIANT);
      this.playButton.mount(this.playMount, () => this.startPlay());
    }
  }

  /** <option> list for the key-root dropdown, current root selected. */
  private keyOptions(): string {
    return NOTE_NAMES.map(
      (n) => `<option value="${n}"${n === this.keyRoot ? " selected" : ""}>${n}</option>`,
    ).join("");
  }

  /** Bass window: one chip per measure downbeat root, highlightable in time. */
  private bassWindowHtml(): string {
    const roots: string[] = [];
    for (let m = 0; m < 4; m++) {
      const dn = this.bassline.find((n) => n.measure === m && n.beat === 0);
      roots.push(dn ? dn.pitchClass : "—");
    }
    return roots
      .map((r, i) => `<span class="eddie-bass-note" data-bass="${i}">${r}</span>`)
      .join('<span class="eddie-bass-sep">·</span>');
  }

  /** Light up the bass chip for the measure whose downbeat is now sounding. */
  private highlightBass(measure: number) {
    this.bassNoteEls.forEach((el, i) => {
      el.classList.toggle("eddie-bass-note-on", i === measure);
    });
  }

  private onAction(act: string | null) {
    switch (act) {
      case "bpm-down":
        this.bpm = Math.max(MIN_BPM, this.bpm - BPM_STEP);
        break;
      case "bpm-up":
        this.bpm = Math.min(MAX_BPM, this.bpm + BPM_STEP);
        break;
      default:
        return;
    }
    this.applyBpm();
    this.refreshLabels();
  }

  /** Push tempo changes to the live audition Conductor (only legal in preroll,
   *  which is where it's parked). */
  private applyBpm() {
    this.conductor?.setBpm(this.bpm);
  }

  private refreshLabels() {
    if (this.bpmValueEl) this.bpmValueEl.textContent = `${this.bpm} BPM`;
    // Sync the key-root dropdown + mode radios (e.g. after programmatic change).
    const rootSel = this.overlay?.querySelector<HTMLSelectElement>('[data-field="key-root"]');
    if (rootSel && rootSel.value !== this.keyRoot) rootSel.value = this.keyRoot;
    this.overlay?.querySelectorAll<HTMLInputElement>('input[name="eddie-mode"]').forEach((r) => {
      r.checked = r.value === this.keyMode;
    });
    // Rebuild the bass window (the bassline regenerated on any key change).
    if (this.bassValueEl) {
      this.bassValueEl.innerHTML = this.bassWindowHtml();
      this.bassNoteEls = [...this.bassValueEl.querySelectorAll<HTMLElement>(".eddie-bass-note")];
    }
  }

  // ------------------------------------------------------------------------
  // Live input timeline (single 4-measure looping row; MenuPulse pattern).
  // ------------------------------------------------------------------------

  private buildTimeline(parent: HTMLElement) {
    const wrap = document.createElement("div");
    wrap.className = "outrun-timeline outrun-menupulse";
    wrap.style.position = "relative";
    const label = document.createElement("div");
    label.className = "menupulse-label";
    label.textContent = "GUITAR";
    wrap.appendChild(label);

    const canvas = document.createElement("canvas");
    canvas.width = BEATS * PX_PER_BEAT;
    canvas.height = ROW_HEIGHT;
    canvas.style.width = `${BEATS * PX_PER_BEAT}px`;
    canvas.style.height = `${ROW_HEIGHT}px`;
    canvas.className = "timeline-row";
    wrap.appendChild(canvas);
    this.canvas = canvas;
    this.ctx2d = canvas.getContext("2d");
    if (this.ctx2d) this.ctx2d.imageSmoothingEnabled = false;

    const ov = document.createElement("canvas");
    ov.width = BEATS * PX_PER_BEAT;
    ov.height = ROW_HEIGHT;
    ov.style.width = `${BEATS * PX_PER_BEAT}px`;
    ov.style.height = `${ROW_HEIGHT}px`;
    ov.style.position = "absolute";
    ov.style.left = "0";
    ov.style.bottom = "0";
    ov.style.pointerEvents = "none";
    wrap.appendChild(ov);
    this.overlayCanvas = ov;
    this.overlayCtx = ov.getContext("2d");
    if (this.overlayCtx) this.overlayCtx.imageSmoothingEnabled = false;

    parent.appendChild(wrap);
    this.drawGrid();
  }

  private async startSignalChain() {
    if (!this.conductor || !this.tracker) return;
    const ctx = getAudioContext();
    if (ctx.state === "suspended") await ctx.resume();

    // Register the beat listener BEFORE startPreroll so beat 0 (which fires
    // synchronously inside startPreroll) is caught and opens the first window.
    this.offBeat = this.conductor.onBeat((info) => {
      this.perf?.noteBeat();
      // Beat-synced glitch hook: theme CSS reacts to .eddie-beat (every beat) and
      // .eddie-beat-down (downbeat) to flicker/RGB-split the settings UI in time.
      const root = this.overlay;
      if (root) {
        const down = info.beat % BEATS === 0;
        root.classList.add("eddie-beat");
        if (down) root.classList.add("eddie-beat-down");
        window.setTimeout(() => root.classList.remove("eddie-beat", "eddie-beat-down"), 110);
      }
      if (info.beat % BEATS === 0) {
        this.measureStart = info.time;
        this.bars.reset();
        this.drawGrid();
        // Highlight the bass chip whose downbeat root is now sounding. EddieBass
        // loops the 4-measure pattern off floor(beat/4)%4 in preroll; mirror it,
        // and fire the visual when the note is AUDIBLE (scheduled time + output
        // latency), not when it was scheduled — so it matches what you hear.
        const loopMeasure = Math.floor(info.beat / 4) % 4;
        const outLatency = getAudioContext().outputLatency || 0;
        const delayMs = Math.max(0, (info.time + outLatency - this.conductor!.audioTime) * 1000);
        window.setTimeout(() => this.highlightBass(loopMeasure), delayMs);
      }
    });
    this.tracker.onPitchUpdate((u) => {
      this.plotPitch(u.time, u.midi, u.onsetId);
      if (this.recording) {
        this.capPitches.push({
          onsetId: u.onsetId, time: u.time, freq: u.freq, midi: u.midi,
          confidence: u.confidence, status: u.status,
        });
      }
    });
    this.tracker.onOnset((e) => {
      this.perf?.noteOnset();
      if (this.recording) {
        this.capOnsets.push({ time: e.time, energy: e.energy, synthetic: e.synthetic });
        this.updateRecHint();
      }
    });
    this.tracker.onNoteEnd((e) => {
      if (this.recording) this.capNoteEnds.push({ onsetId: e.onsetId, time: e.time, reason: e.reason });
    });

    this.conductor.startPreroll();

    try {
      await this.tracker.start();
    } catch (err) {
      console.warn("[eddie-settings] mic denied or unavailable", err);
    }
  }

  private drawGrid() {
    const ctx = this.ctx2d;
    const canvas = this.canvas;
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(26, 15, 46, 0.55)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let b = 0; b <= BEATS; b++) {
      const isMeasure = b % BEATS === 0;
      // Nudge the leftmost line in by 1px so the downbeat (beat 1) isn't clipped
      // against the canvas edge — it was effectively invisible before.
      const x = (b === 0 ? 1 : Math.round(b * PX_PER_BEAT)) + 0.5;
      ctx.strokeStyle = isMeasure ? "rgba(255,43,214,0.95)" : "rgba(0,240,255,0.4)";
      ctx.lineWidth = isMeasure ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    // Beat numbers (1..4) so the downbeat is unmistakable.
    ctx.fillStyle = "rgba(180,230,255,0.55)";
    ctx.font = "9px monospace";
    for (let b = 0; b < BEATS; b++) {
      ctx.fillText(String(b + 1), (b === 0 ? 3 : b * PX_PER_BEAT + 3), 10);
    }
  }

  private drawPulse() {
    const ctx = this.overlayCtx;
    const ov = this.overlayCanvas;
    if (!ctx || !ov || !this.conductor || this.measureStart < 0) {
      if (ctx && ov) ctx.clearRect(0, 0, ov.width, ov.height);
      return;
    }
    ctx.clearRect(0, 0, ov.width, ov.height);
    const beatDur = 60 / this.conductor.currentBpm;
    // Beats are scheduled on the audio clock, but the user HEARS them ~output
    // latency later. Reference the playhead to audible-time so the pulse lands
    // on the beat the player actually hears (and plays to), not when it was
    // scheduled — otherwise the indicator leads the music.
    const outLatency = getAudioContext().outputLatency || 0;
    const into = this.conductor.audioTime - outLatency - this.measureStart;
    if (into < 0 || into > BEATS * beatDur) return;
    // CONTINUOUS playhead: position is read straight from the audio clock every
    // frame, so it sweeps smoothly at the display's full rate and its position
    // is exact to the sample (no per-beat snapping / no drift). The beats are
    // where it crosses the gridlines; it flares brighter right on each beat.
    const x = (into / beatDur) * PX_PER_BEAT;
    const beatPhaseMs = (into % beatDur) * 1000;
    const onBeat = Math.max(0, 1 - beatPhaseMs / 90); // 1 on the beat → 0 by 90ms
    ctx.strokeStyle = `rgba(0, 240, 255, ${0.85 + 0.15 * onBeat})`;
    ctx.lineWidth = 2 + 2 * onBeat;
    ctx.shadowColor = "rgba(0, 240, 255, 0.9)";
    ctx.shadowBlur = 6 + 10 * onBeat;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, ov.height);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  private plotPitch(audioTime: number, midi: number, onsetId: number) {
    const ctx = this.ctx2d;
    if (!ctx || !this.conductor || this.measureStart < 0) return;
    const beatDur = 60 / this.conductor.currentBpm;
    const span = BEATS * beatDur;
    const into = audioTime - this.measureStart;
    if (into < -0.05 || into > span) return;
    const clamped = Math.max(0, Math.min(span, into));
    const x = (clamped / beatDur) * PX_PER_BEAT;
    const y = laneY(midi);
    const bar = this.bars.feed(onsetId, x, y);
    if (!bar) return;
    // Pitched note bar. Enforce a minimum visible length (~a sixteenth) so a
    // short note reads as a clear time-block, not a 1px glitch, and give it a
    // bright core + glow so it pops at a glance.
    const minW = PX_PER_BEAT * 0.18;
    const w = Math.max(minW, bar.x1 - bar.x0);
    ctx.shadowColor = "rgba(0,240,255,0.8)";
    ctx.shadowBlur = 6;
    ctx.fillStyle = "#00f0ff";
    ctx.fillRect(Math.round(bar.x0), Math.round(bar.y - (BAND_HEIGHT + 2) / 2), Math.round(w), BAND_HEIGHT + 2);
    ctx.shadowBlur = 0;
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

  // ------------------------------------------------------------------------
  // Record/debug — capture mic + detection, download for diagnosis
  // ------------------------------------------------------------------------

  private toggleRec() {
    if (!this.recording) this.startRec();
    else this.stopRecAndDownload();
  }

  private startRec() {
    this.capOnsets = [];
    this.capPitches = [];
    this.capNoteEnds = [];
    this.recordedChunks = [];
    this.recStartAudioTime = this.conductor?.audioTime ?? 0;

    const stream = this.tracker?.mediaStream;
    if (stream && typeof MediaRecorder !== "undefined") {
      try {
        this.mediaRecorder = new MediaRecorder(stream);
        this.mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) this.recordedChunks.push(e.data);
        };
        this.mediaRecorder.start();
      } catch (err) {
        console.warn("[eddie-settings] mic recording unavailable", err);
      }
    }

    this.recording = true;
    if (this.recBtn) {
      this.recBtn.innerHTML = "&#9632; STOP &amp; DOWNLOAD";
      this.recBtn.classList.add("eddie-rec-on");
    }
    this.updateRecHint();
  }

  private updateRecHint() {
    if (!this.recHint) return;
    if (this.recording) {
      this.recHint.textContent =
        `recording… ${this.capOnsets.length} onsets, ${this.capPitches.length} notes detected — stop to download`;
    } else {
      this.recHint.textContent = "play a few bars, then it downloads your audio + detected notes";
    }
  }

  private stopRecAndDownload() {
    this.recording = false;
    if (this.recBtn) {
      this.recBtn.innerHTML = "&#9679; RECORD";
      this.recBtn.classList.remove("eddie-rec-on");
    }
    this.updateRecHint();

    const log = {
      meta: {
        screen: "settings",
        bpm: this.bpm,
        keyRoot: this.keyRoot,
        keyMode: this.keyMode,
        sampleRate: getAudioContext().sampleRate,
        recStartAudioTime: this.recStartAudioTime,
        startedAt: new Date().toISOString(),
      },
      onsets: this.capOnsets,
      pitches: this.capPitches,
      noteEnds: this.capNoteEnds,
    };
    this.downloadBlob(
      new Blob([JSON.stringify(log, null, 2)], { type: "application/json" }),
      "eddie-settings-notes.json",
    );

    const rec = this.mediaRecorder;
    if (rec) {
      const finish = () => {
        const type = rec.mimeType || "audio/webm";
        const ext = type.includes("ogg") ? "ogg" : "webm";
        this.downloadBlob(new Blob(this.recordedChunks, { type }), `eddie-settings-input.${ext}`);
      };
      if (rec.state === "recording") {
        rec.onstop = finish;
        rec.stop();
      } else {
        finish();
      }
      this.mediaRecorder = null;
    }
  }

  private downloadBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ------------------------------------------------------------------------
  // Transition to play
  // ------------------------------------------------------------------------

  private startPlay() {
    const config = this.currentConfig();
    this.game.setState(
      new InfiniteEddieState(this.hudParent, config, () => this.goLevelSelect()),
    );
  }

  private goLevelSelect() {
    // Dynamic import of LevelSelectState breaks the settings<->levelselect
    // static import cycle (LevelSelect imports this state for its menu entry).
    void import("./LevelSelectState").then(({ LevelSelectState }) => {
      this.game.setState(
        new LevelSelectState(this.hudParent, (lvl) =>
          this.game.setState(new LevelState(this.hudParent, lvl)),
        ),
      );
    });
  }
}
