// EddieSoundDebugState — Sound's audio bench. Reach it with ?eddiesound=1
// (route wired in main.ts by Gameplay).
//
// Parks a Conductor in 'preroll' exactly like MenuPulse so the beat + bass loop
// forever with no play anchor, and lets you cycle the 3 beat variants (keys
// 1-3) and 3 bass variants (keys 4-6) independently, audibly. M toggles mute.
//
// Self-contained per GDD §12.5: imports ONLY eddieTypes, engine modules, and
// Sound's own factory — NOT Gameplay's unfinished states. The EddieConfig it
// feeds the rig (and the in-key bassline) is built locally so the bench
// compiles and runs standalone before basslineGen lands.

import type { Game, GameState } from "../engine/Game";
import * as THREE from "three";
import { Conductor } from "../audio/Conductor";
import { getAudioContext } from "../audio/AudioContextSingleton";
import {
  createEddieAudioPair,
  type EddieAudioRig,
} from "../audio/eddie/eddieAudioFactory";
import type { EddieBeat, EddieBeatVariant } from "../audio/eddie/EddieBeat";
import type { EddieBass, EddieBassVariant } from "../audio/eddie/EddieBass";
import type { BasslineNote, EddieConfig, PitchClass } from "../music/eddie/eddieTypes";
import type { KeyMode } from "../music/keys";
import { NOTE_NAMES } from "../audio/midi";
import { generateBassline } from "../music/eddie/basslineGen";

const BEAT_VARIANTS: EddieBeatVariant[] = [
  "option-1", "option-2", "option-3", "option-4", "option-5", "option-6",
];
const BASS_VARIANTS: EddieBassVariant[] = [
  "option-1", "option-2", "option-3", "option-4", "option-5", "option-6",
];
// QWERTY row maps 1:1 to the six beat variants (the number row drives bass).
const BEAT_KEYS = ["q", "w", "e", "r", "t", "y"];
const ALL_KEY_ROOTS: PitchClass[] = [...NOTE_NAMES];
const BENCH_BPM = 120;

function benchConfig(root: PitchClass, mode: KeyMode, bassline: BasslineNote[]): EddieConfig {
  return {
    bpm: BENCH_BPM,
    keyRoot: root,
    keyMode: mode,
    bassline,
    eighthTagMeasure: 5,
    sixteenthTagMeasure: 10,
  };
}

export class EddieSoundDebugState implements GameState {
  readonly name = "eddieSoundDebug";
  private hudParent: HTMLElement;
  private overlay: HTMLDivElement | null = null;

  private conductor: Conductor | null = null;
  private rig: EddieAudioRig | null = null;
  private beat: EddieBeat | null = null;
  private bass: EddieBass | null = null;

  private beatIdx = 0;
  private bassIdx = 0;
  private muted = false;
  private keyRoot: PitchClass = "E";
  private keyMode: KeyMode = "minor";
  // Random diatonic bassline (basslineGen). Rerolled with SPACE / on key change.
  private bassline: BasslineNote[] = generateBassline(this.keyRoot, this.keyMode);

  constructor(hudParent: HTMLElement) {
    this.hudParent = hudParent;
  }

  enter(game: Game) {
    // Plain neon backdrop — this bench is about audio, not visuals.
    const { worldScene, worldCamera } = game.renderer;
    worldScene.background = new THREE.Color(0x0a0612);
    worldScene.fog = null;
    worldCamera.position.set(0, 0, 6);
    worldCamera.lookAt(0, 0, 0);

    this.overlay = document.createElement("div");
    this.overlay.style.cssText =
      "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);" +
      "color:#e8e8f0;font:14px/1.7 monospace;text-align:center;" +
      "background:rgba(8,8,14,0.82);padding:22px 30px;border:2px solid #ff2bd6;" +
      "border-radius:6px;box-shadow:0 0 24px rgba(255,43,214,0.45);pointer-events:none;";
    this.hudParent.appendChild(this.overlay);

    void this.startAudio();
    window.addEventListener("keydown", this.onKey);
  }

  exit() {
    window.removeEventListener("keydown", this.onKey);
    this.teardownAudio();
    this.overlay?.remove();
    this.overlay = null;
  }

  update() {
    // Audio is event-driven off the Conductor; nothing per-frame.
  }

  private async startAudio() {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") await ctx.resume();

    // Eddie BPM range allows up to 200; bench runs at 120.
    this.conductor = new Conductor({ countInBeats: 16, playMeasures: 16, maxBpm: 200 });
    this.conductor.setBpm(BENCH_BPM);
    // The Conductor plays its OWN combat drum pattern in preroll (the menu-pulse
    // metronome). Eddie supplies its own beat via EddieBeat, so silence the
    // Conductor's voices — otherwise the two patterns double up.
    this.conductor.setMuted(true);

    const config = benchConfig(this.keyRoot, this.keyMode, this.bassline);
    const pair = createEddieAudioPair(
      BEAT_VARIANTS[this.beatIdx],
      BASS_VARIANTS[this.bassIdx],
      this.conductor,
      config,
    );
    this.rig = pair.rig;
    this.beat = pair.beat;
    this.bass = pair.bass;
    this.rig.setMuted(this.muted);
    this.rig.start();

    // Parked in 'preroll' (never triggerPlay) the Conductor emits a beat every
    // beat forever — a free looping bench, exactly like MenuPulse.
    this.conductor.startPreroll();

    this.renderHud();
  }

  private teardownAudio() {
    this.rig?.stop();
    this.conductor?.stop();
    this.rig = null;
    this.beat = null;
    this.bass = null;
    this.conductor = null;
  }

  // Rebuild the rig with the current variant selection. Tears the old rig down
  // first (no orphan oscillators) and re-parks the conductor.
  private async reload() {
    this.teardownAudio();
    await this.startAudio();
  }

  private onKey = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    const n = Number(e.key);
    if (n >= 1 && n <= BASS_VARIANTS.length) {
      // Number row 1..6 → bass variant.
      this.bassIdx = n - 1;
      void this.reload();
    } else if (BEAT_KEYS.includes(key)) {
      // QWERTY row → beat variant.
      this.beatIdx = BEAT_KEYS.indexOf(key);
      void this.reload();
    } else if (key === " " || e.code === "Space") {
      // Reroll the random diatonic bassline (same key).
      e.preventDefault();
      this.bassline = generateBassline(this.keyRoot, this.keyMode);
      void this.reload();
    } else if (key === "n") {
      // New random key root (keeps the current major/minor mode).
      this.keyRoot = ALL_KEY_ROOTS[Math.floor(Math.random() * ALL_KEY_ROOTS.length)];
      this.bassline = generateBassline(this.keyRoot, this.keyMode);
      void this.reload();
    } else if (key === "k") {
      // Toggle major/minor (regenerates the bassline so the colour actually changes).
      this.keyMode = this.keyMode === "minor" ? "major" : "minor";
      this.bassline = generateBassline(this.keyRoot, this.keyMode);
      void this.reload();
    } else if (key === "m") {
      this.muted = !this.muted;
      this.rig?.setMuted(this.muted);
      this.renderHud();
    }
  };

  private renderHud() {
    if (!this.overlay) return;
    const beatV = BEAT_VARIANTS[this.beatIdx];
    const bassV = BASS_VARIANTS[this.bassIdx];
    // Downbeat root of each of the 4 bassline measures, so a reroll is visible.
    const roots = [0, 1, 2, 3]
      .map((m) => this.bassline.find((b) => b.measure === m && b.beat === 0)?.pitchClass ?? "—")
      .join(" · ");
    this.overlay.innerHTML =
      `<div style="color:#ff2bd6;font-size:18px;letter-spacing:2px;margin-bottom:10px;">` +
      `INFINITE EDDIE — SOUND BENCH</div>` +
      `<div style="margin-bottom:8px;">` +
      `BEAT <b style="color:#00f0ff;">${beatV}</b><br>` +
      `<span style="color:#9aa;">${this.beat?.rationale ?? ""}</span></div>` +
      `<div style="margin-bottom:8px;">` +
      `BASS <b style="color:#ffd02b;">${bassV}</b><br>` +
      `<span style="color:#9aa;">${this.bass?.rationale ?? ""}</span></div>` +
      `<div style="margin-bottom:6px;color:#9aa;">` +
      `key <b style="color:#e8e8f0;">${this.keyRoot} ${this.keyMode}</b> &middot; ` +
      `bassline <b style="color:#e8e8f0;">${roots}</b></div>` +
      `<div style="margin-bottom:10px;color:#9aa;">` +
      `${BENCH_BPM} BPM &middot; ${this.muted ? "<b style='color:#f55;'>MUTED</b>" : "playing"}</div>` +
      `<div style="color:#7a7a9a;font-size:12px;">` +
      `1–6 bass &middot; Q W E R T Y beat &middot; SPACE reroll bassline<br>` +
      `N new key &middot; K maj/min &middot; M mute</div>`;
  }
}
