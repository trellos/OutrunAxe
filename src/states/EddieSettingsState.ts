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

import * as THREE from "three";
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
const PULSE_FADE_MS = 150;

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
  private keyValueEl: HTMLElement | null = null;
  private bassValueEl: HTMLElement | null = null;
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

  private rotor: THREE.Object3D | null = null;
  private lights: THREE.Light[] = [];

  constructor(hudParent: HTMLElement) {
    this.hudParent = hudParent;
    // Random initial key from {E,A,G,C} × {major,minor} (GDD §9).
    this.keyRoot = RANDOM_KEY_ROOTS[Math.floor(Math.random() * RANDOM_KEY_ROOTS.length)];
    this.keyMode = RANDOM_KEY_MODES[Math.floor(Math.random() * RANDOM_KEY_MODES.length)];
    this.regenerateBassline();
  }

  enter(game: Game) {
    this.game = game;
    const { worldScene, worldCamera } = game.renderer;
    worldScene.background = new THREE.Color(0x0a0612);
    worldCamera.position.set(0, 0, 8);
    worldCamera.lookAt(0, 0, 0);

    // A small spinning motif as incidental background (AGENTS.md #5 allows
    // wireframe icosahedra as incidental motifs, not the headline visual).
    this.rotor = new THREE.Group();
    const geom = new THREE.IcosahedronGeometry(1.6, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xff2bd6,
      emissive: 0xff2bd6,
      emissiveIntensity: 0.8,
      roughness: 0.3,
      metalness: 0.6,
      wireframe: true,
    });
    this.rotor.add(new THREE.Mesh(geom, mat));
    worldScene.add(this.rotor);
    const dir = new THREE.DirectionalLight(0x00f0ff, 0.8);
    dir.position.set(5, 10, 5);
    const amb = new THREE.AmbientLight(0x6622aa, 0.6);
    worldScene.add(dir, amb);
    this.lights.push(dir, amb);

    this.buildDom();

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
    this.offBeat?.();
    this.playButton?.dispose();
    this.playButton = null;
    this.tracker?.stop();
    this.audio?.stop();
    this.audio = null;
    this.conductor?.stop();
    this.conductor = null;

    const { worldScene } = this.game.renderer;
    if (this.rotor) {
      worldScene.remove(this.rotor);
      this.rotor.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        if (m.material) (m.material as THREE.Material).dispose();
      });
      this.rotor = null;
    }
    for (const l of this.lights) worldScene.remove(l);
    this.lights = [];

    this.overlayCanvas?.remove();
    this.overlayCanvas = null;
    this.overlay?.remove();
    this.overlay = null;
  }

  update(dt: number) {
    if (this.rotor) this.rotor.rotation.y += dt * 0.5;
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

  private basslineText(): string {
    // e.g. "E · A · B · A" — the downbeat root of each of the 4 measures.
    const roots: string[] = [];
    for (let m = 0; m < 4; m++) {
      const dn = this.bassline.find((n) => n.measure === m && n.beat === 0);
      roots.push(dn ? dn.pitchClass : "—");
    }
    return roots.join("  ·  ");
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
          <button class="eddie-settings-btn" data-act="key-down">&#9664;</button>
          <span class="eddie-settings-value" data-field="key">${this.keyLabel()}</span>
          <button class="eddie-settings-btn" data-act="key-up">&#9654;</button>
          <button class="eddie-settings-btn" data-act="mode">${this.keyMode.toUpperCase()}</button>
        </div>
        <div class="eddie-settings-row">
          <span class="eddie-settings-label">BASS</span>
          <span class="eddie-settings-value" data-field="bass">${this.basslineText()}</span>
        </div>
        <div class="eddie-settings-timeline"></div>
        <div class="eddie-settings-play"></div>
      </div>
    `;
    this.hudParent.appendChild(overlay);
    this.overlay = overlay;

    this.bpmValueEl = overlay.querySelector('[data-field="bpm"]');
    this.keyValueEl = overlay.querySelector('[data-field="key"]');
    this.bassValueEl = overlay.querySelector('[data-field="bass"]');

    overlay.querySelectorAll<HTMLButtonElement>(".eddie-settings-btn").forEach((btn) => {
      btn.addEventListener("click", () => this.onAction(btn.getAttribute("data-act")));
    });

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

  private keyLabel(): string {
    return this.keyRoot;
  }

  private onAction(act: string | null) {
    switch (act) {
      case "bpm-down":
        this.bpm = Math.max(MIN_BPM, this.bpm - BPM_STEP);
        break;
      case "bpm-up":
        this.bpm = Math.min(MAX_BPM, this.bpm + BPM_STEP);
        break;
      case "key-down":
        this.cycleRoot(-1);
        break;
      case "key-up":
        this.cycleRoot(1);
        break;
      case "mode":
        this.keyMode = this.keyMode === "major" ? "minor" : "major";
        this.regenerateBassline();
        break;
      default:
        return;
    }
    this.applyBpm();
    this.refreshLabels();
  }

  private cycleRoot(dir: number) {
    const idx = NOTE_NAMES.indexOf(this.keyRoot);
    this.keyRoot = NOTE_NAMES[((idx + dir) % 12 + 12) % 12];
    this.regenerateBassline();
  }

  /** Push tempo changes to the live audition Conductor (only legal in preroll,
   *  which is where it's parked). */
  private applyBpm() {
    this.conductor?.setBpm(this.bpm);
  }

  private refreshLabels() {
    if (this.bpmValueEl) this.bpmValueEl.textContent = `${this.bpm} BPM`;
    if (this.keyValueEl) this.keyValueEl.textContent = this.keyLabel();
    if (this.bassValueEl) this.bassValueEl.textContent = this.basslineText();
    const modeBtn = this.overlay?.querySelector<HTMLButtonElement>('[data-act="mode"]');
    if (modeBtn) modeBtn.textContent = this.keyMode.toUpperCase();
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
      }
    });
    this.tracker.onPitchUpdate((u) => this.plotPitch(u.time, u.midi, u.onsetId));

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
      const x = Math.round(b * PX_PER_BEAT) + 0.5;
      const isMeasure = b % BEATS === 0;
      ctx.strokeStyle = isMeasure ? "rgba(255,43,214,0.7)" : "rgba(74,42,122,0.5)";
      ctx.lineWidth = isMeasure ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
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
    const into = this.conductor.audioTime - this.measureStart;
    if (into < 0 || into > BEATS * beatDur) return;
    const beatIdx = Math.floor(into / beatDur);
    if (beatIdx < 0 || beatIdx >= BEATS) return;
    const sinceBeatMs = (into - beatIdx * beatDur) * 1000;
    const alpha = Math.max(0, 1 - sinceBeatMs / PULSE_FADE_MS);
    if (alpha <= 0) return;
    const x = Math.round(beatIdx * PX_PER_BEAT) + 0.5;
    ctx.strokeStyle = `rgba(0, 240, 255, ${alpha})`;
    ctx.lineWidth = 3;
    ctx.shadowColor = "rgba(0, 240, 255, 0.9)";
    ctx.shadowBlur = 8 * alpha;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, ov.height);
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
    ctx.fillStyle = "#00f0ff";
    const bar = this.bars.feed(onsetId, x, y);
    if (!bar) return;
    ctx.fillRect(
      Math.round(bar.x0),
      Math.round(bar.y - BAND_HEIGHT / 2),
      Math.max(1, Math.round(bar.x1 - bar.x0)),
      BAND_HEIGHT,
    );
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
