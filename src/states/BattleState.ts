// BattleState — the "Battle" PLAY screen.
//
// Battle is Score Run's endless sibling: a 4-measure timeline pinned up top that
// is ALWAYS RECORDING. On entry there is one measure of count-in, then the four
// measures loop forever — each time a measure comes back around the cell wipes
// and re-records what you play. The crowd (dudes / guns / rockets) spawns exactly
// like Score Run, and the ocean/dolphin background is always used.
//
// Architecturally it is a trimmed InfiniteEddieState: same Conductor →
// PitchTracker → KeyResolver → EddieScorer chain and the same juice → Art rig,
// but the Conductor runs in `loop` mode (never finishes), the Art rig is mounted
// with gridMeasures: 4, and there is no end screen — Esc/Backspace exits.
//
// Timing discipline (AGENTS.md / GDD §2): measure/beat decisions read the
// Conductor clock; only visual interpolation reads rAF dt (inside the Art rig).

import { Conductor } from "../audio/Conductor";
import { PitchTracker } from "../audio/PitchTracker";
import { getAudioContext } from "../audio/AudioContextSingleton";
import type { Game, GameState } from "../engine/Game";
import { EventBus } from "../engine/EventBus";
import { KeyResolver } from "../music/KeyResolver";
import { keyPitchClasses } from "../music/keys";
import { midiToPitchClass } from "../audio/midi";
import { EddieScorer } from "../music/eddie/EddieScorer";
import type {
  EddieConfig,
  EddieJuiceEvents,
  EddieScoreEvent,
  PitchClass,
} from "../music/eddie/eddieTypes";
import { createEddieArt, type EddieArtRig } from "../eddie/art/eddieArtFactory";
import { BACKGROUNDS } from "../eddie/art/backgrounds/registry";
import { generateBassline } from "../music/eddie/basslineGen";
import { readBpm } from "../audio/eddie/bpmStore";
import type { KeyMode } from "../music/eddie/eddieTypes";
import {
  createEddieAudio,
  type EddieAudioRig,
} from "../audio/eddie/eddieAudioFactory";

/** A ready-to-play Battle config: a random key in {E,A,G,C} × {major,minor} with
 *  a generated bassline, the player's saved tempo (default 120), and the tag
 *  mechanics disabled (-1) since Battle is a shark fight, not a scored run.
 *  Mirrors how EddieSettingsState builds an EddieConfig, minus the UI. */
export function createBattleConfig(): EddieConfig {
  const roots: PitchClass[] = ["E", "A", "G", "C"];
  const modes: KeyMode[] = ["major", "minor"];
  const keyRoot = roots[Math.floor(Math.random() * roots.length)];
  const keyMode = modes[Math.floor(Math.random() * modes.length)];
  const saved = readBpm();
  const bpm = saved !== null ? Math.max(60, Math.min(200, saved)) : 120;
  return {
    bpm,
    keyRoot,
    keyMode,
    bassline: generateBassline(keyRoot, keyMode),
    eighthTagMeasure: -1,
    sixteenthTagMeasure: -1,
  };
}

const ART_VARIANT = "option-1" as const;
const AUDIO_VARIANT = "option-1" as const;

// Particles default fx-5 "Phosphor Comets" = index 4 (matches Score Run).
const FX_INDEX = 4;

// Battle sizing: 1-measure count-in, then a 16-measure fight, then results.
const COUNT_IN_BEATS = 4;
const INTRO_MEASURES = COUNT_IN_BEATS / 4;
const PLAY_MEASURES = 16;
const MAX_BPM = 200;
/** Grid + crowd window: 4 measures up top, rolling/always-recording. The battle
 *  runs PLAY_MEASURES (16) = four loops of this window, then ends. */
const GRID_MEASURES = 4;
/** People line: ~80% down the water. */
const GROUND_FRACTION = 0.8;
/** Linger after the music ends before the results screen, so the final splashes
 *  and swept sharks resolve on screen. */
const DONE_LINGER_SEC = 2.5;

const PROVISIONAL_MIDI = 67;

const PARTICLES_PER_MULTIPLIER = 6;
const SHAKE_PER_MULTIPLIER = 0.6;
const PARTICLE_COLOR = "#ff2bd6";

// Keyboard piano (same mapping as Score Run / LevelState).
const KEY_TO_MIDI: Record<string, number> = {
  KeyZ: 48, KeyS: 49, KeyX: 50, KeyD: 51, KeyC: 52, KeyV: 53,
  KeyG: 54, KeyB: 55, KeyH: 56, KeyN: 57, KeyJ: 58, KeyM: 59,
  Comma: 60, KeyL: 61, Period: 62, Semicolon: 63, Slash: 64,
};

/** Registry index of the ocean/dolphin background ("Neon Sea → Storm" = bg02).
 *  Resolved by label so a registry reorder can't silently pick the wrong one. */
function oceanBgIndex(): number {
  const i = BACKGROUNDS.findIndex((b) => /sea|ocean/i.test(b.label));
  return i >= 0 ? i : 1;
}

export class BattleState implements GameState {
  readonly name = "battle";

  /** Public juice bus the Art rig subscribes to. */
  readonly juice = new EventBus<EddieJuiceEvents>();

  private hudParent: HTMLElement;
  private config: EddieConfig;
  private onExit: () => void;

  private conductor!: Conductor;
  private tracker!: PitchTracker;
  private resolver!: KeyResolver;
  private scorer!: EddieScorer;
  private art: EddieArtRig | null = null;
  private audio: EddieAudioRig | null = null;

  private offBeat?: () => void;
  private offPhase?: () => void;
  private offScore?: () => void;
  private offTotal?: () => void;
  private offNoteEnd?: () => void;
  private offGridOnset?: () => void;
  private offGridPitch?: () => void;
  /** onset id → where that note opened, so its NoteEnd can size the grid bar. */
  private noteStarts = new Map<number, { measure: number; startTime: number }>();
  private onsetTimes = new Map<number, number>();
  private pendingNoteEnds = new Map<number, number>();
  private keyHandler?: (e: KeyboardEvent) => void;

  private keySet = new Set<string>();

  /** Audio time of the very first count-in beat (intro origin). */
  private introStart = -1;
  private lastActiveMeasure = NaN;
  private perf = 0;
  private quarterScored = false;
  private sawPlayingQuarter = false;
  private exited = false;

  /** Full-screen flash overlay pulsed during the count-in (replaces the count-in
   *  timeline row). */
  private countInFlash: HTMLDivElement | null = null;

  // Battle score.
  private sharksKilled = 0;
  private dudesEaten = 0;
  private scoreHud: HTMLDivElement | null = null;
  private endBtn: HTMLElement | null = null;
  /** Audio time at which to show the results screen (>0 once the music ends). */
  private finishedAt = 0;

  constructor(hudParent: HTMLElement, config: EddieConfig, onExit: () => void) {
    this.hudParent = hudParent;
    this.config = config;
    this.onExit = onExit;
  }

  enter(game: Game) {
    const { worldScene, worldCamera } = game.renderer;

    this.conductor = new Conductor({
      countInBeats: COUNT_IN_BEATS,
      playMeasures: PLAY_MEASURES, // 16-measure battle, then results
      maxBpm: MAX_BPM,
    });
    this.conductor.setBpm(this.config.bpm);

    this.tracker = new PitchTracker();
    this.tracker.setBeatProximityProvider((t) =>
      this.conductor.proximityToExpectedAttack(t),
    );

    this.resolver = new KeyResolver(this.conductor, this.tracker);
    this.resolver.attach();

    this.scorer = new EddieScorer(this.conductor, this.resolver, this.config);
    this.scorer.attach();

    this.keySet = new Set<string>(
      keyPitchClasses(this.config.keyRoot, this.config.keyMode),
    );

    // Art rig: always the ocean/dolphin background, a 4-measure rolling grid.
    this.art = createEddieArt(ART_VARIANT);
    this.art.mount({
      hudParent: this.hudParent,
      scene: worldScene,
      config: this.config,
      juice: this.juice,
      camera: worldCamera,
      bgIndex: oceanBgIndex(),
      fxIndex: FX_INDEX,
      gridMeasures: GRID_MEASURES,
      gridIntroRow: false, // no count-in timeline above the bars — pulse instead
      crowdBattle: true,
      crowdGroundFraction: GROUND_FRACTION,
      onSharkKilled: () => { this.sharksKilled++; this.updateScoreHud(); },
      onDudeEaten: () => { this.dudesEaten++; this.updateScoreHud(); },
    });

    this.audio = createEddieAudio(AUDIO_VARIANT, this.conductor, this.config);
    this.audio.start();

    this.offBeat = this.conductor.onBeat((info) => {
      if (info.phase === "countIn") {
        if (info.beatInPhase === 0 && this.introStart < 0) {
          this.introStart = info.time;
        }
        // No count-in timeline row — flash the whole screen on each count-in beat
        // (brighter on the downbeat) so the player feels the lead-in.
        this.flashCountIn(info.beatInPhase % 4 === 0);
        this.juice.emit("eddieBeatPulse", {
          beatInMeasure: info.beatInPhase % 4,
          downbeat: info.beatInPhase % 4 === 0,
          audioTime: info.time,
        });
      } else if (info.phase === "playing") {
        // measureInPlay is 0..15; the Art rig folds it into the rolling 4-cell
        // window. Sharks pour in one per BEAT.
        this.setActiveMeasure(info.measureInPlay);
        this.art?.battleBeat();
        this.juice.emit("eddieBeatPulse", {
          beatInMeasure: info.beatInPhase,
          downbeat: info.beatInPhase === 0,
          audioTime: info.time,
        });
        if (this.sawPlayingQuarter) {
          this.perf = Math.max(
            0,
            Math.min(1, this.perf + (this.quarterScored ? 0.0315 : -0.0315)),
          );
        }
        this.quarterScored = false;
        this.sawPlayingQuarter = true;
      }
    });

    // The 16-measure fight ended — linger briefly, then show results.
    this.offPhase = this.conductor.onPhaseChange((p) => {
      if (p === "done" && this.finishedAt === 0) {
        this.finishedAt = this.conductor.audioTime + DONE_LINGER_SEC;
        this.juice.emit("eddieFinale", { audioTime: this.conductor.audioTime });
      }
    });

    this.offScore = this.scorer.bus.on("eddieScore", (ev) => this.onScore(ev));
    this.offTotal = this.scorer.bus.on("eddieTotal", (t) => {
      this.juice.emit("eddieScorePop", {
        total: t.total,
        delta: t.lastDelta,
        audioTime: t.audioTime,
      });
    });

    // Grid plotting driven by the ONSET stream (every played note).
    this.offGridOnset = this.tracker.onOnset((e) => {
      if (e.synthetic) return;
      this.onsetTimes.set(e.id, e.time);
      if (this.onsetTimes.size > 96) {
        const oldest = this.onsetTimes.keys().next().value;
        if (oldest !== undefined) this.onsetTimes.delete(oldest);
      }
      this.plotGridNote(e.id, e.time, null);
    });

    this.offGridPitch = this.tracker.onPitchUpdate((u) => {
      const onsetTime = this.onsetTimes.get(u.onsetId) ?? u.time;
      this.plotGridNote(u.onsetId, onsetTime, u.midi);
    });

    this.offNoteEnd = this.tracker.onNoteEnd((e) => {
      if (!this.growGridBar(e.onsetId, e.time)) {
        this.pendingNoteEnds.set(e.onsetId, e.time);
      }
    });

    this.keyHandler = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === "Escape" || e.key === "Backspace") {
        e.preventDefault();
        this.onExit();
        return;
      }
      const midi = KEY_TO_MIDI[e.code];
      if (midi === undefined) return;
      const t = this.conductor.audioTime;
      this.playKeyboardTone(midi, t);
      this.tracker.emitSyntheticNote(midi, t);
    };
    window.addEventListener("keydown", this.keyHandler);

    this.buildScoreHud();
    void this.startEngine();
  }

  /** Plot (or refine) a grid bar for a played note. Absolute measure; the Art rig
   *  folds it into the rolling window. */
  private plotGridNote(onsetId: number, time: number, midi: number | null): void {
    const dur = this.conductor.measureDuration();
    if (dur <= 0) return;
    let begun = this.noteStarts.get(onsetId);
    if (!begun) {
      const placed = this.placeOnGrid(time);
      if (!placed) return;
      begun = { measure: placed.measure, startTime: placed.start };
      this.noteStarts.set(onsetId, begun);
      this.applyPendingEnd(onsetId);
    }
    const m = midi ?? PROVISIONAL_MIDI;
    const pitchClass = midiToPitchClass(m) as PitchClass;
    this.juice.emit("eddieNote", {
      measure: begun.measure,
      beatFraction: Math.max(0, Math.min(1, (time - begun.startTime) / dur)),
      pitchClass,
      midi: m,
      inKey: midi === null ? true : this.keySet.has(pitchClass),
      audioTime: time,
      onsetId,
    });
  }

  /** Which measure + measure-start a time falls in: an absolute play measure
   *  (0,1,2,…) during play, intro rows -1..-INTRO during count-in, else null. */
  private placeOnGrid(time: number): { measure: number; start: number } | null {
    const dur = this.conductor.measureDuration();
    if (dur <= 0) return null;
    if (this.conductor.currentPhase === "playing") {
      const m = this.conductor.measureForTime(time);
      if (m < 0) return null;
      return { measure: m, start: this.conductor.measureStartTime(m) };
    }
    if (this.conductor.currentPhase === "countIn" && this.introStart >= 0) {
      const introMeasure = Math.floor((time - this.introStart) / dur);
      if (introMeasure < 0 || introMeasure >= INTRO_MEASURES) return null;
      return { measure: -(introMeasure + 1), start: this.introStart + introMeasure * dur };
    }
    return null;
  }

  private growGridBar(onsetId: number, endTime: number): boolean {
    const begun = this.noteStarts.get(onsetId);
    if (!begun) return false;
    const dur = this.conductor.measureDuration();
    const endFrac = dur > 0 ? (endTime - begun.startTime) / dur : 0;
    this.juice.emit("eddieNoteEnd", {
      onsetId,
      measure: begun.measure,
      endBeatFraction: Math.max(0, Math.min(1, endFrac)),
      audioTime: endTime,
    });
    this.noteStarts.delete(onsetId);
    this.onsetTimes.delete(onsetId);
    return true;
  }

  private applyPendingEnd(onsetId: number): void {
    const end = this.pendingNoteEnds.get(onsetId);
    if (end === undefined) return;
    this.pendingNoteEnds.delete(onsetId);
    this.growGridBar(onsetId, end);
  }

  exit() {
    this.exited = true;
    if (this.keyHandler) window.removeEventListener("keydown", this.keyHandler);
    this.keyHandler = undefined;

    this.offBeat?.();
    this.offPhase?.();
    this.offScore?.();
    this.offTotal?.();
    this.offNoteEnd?.();
    this.offGridOnset?.();
    this.offGridPitch?.();
    this.noteStarts.clear();
    this.onsetTimes.clear();
    this.pendingNoteEnds.clear();

    this.scorer?.detach();
    this.resolver?.detach();
    this.tracker?.stop();
    this.audio?.stop();
    this.audio = null;
    this.conductor?.stop();

    this.art?.dispose();
    this.art = null;

    this.countInFlash?.remove();
    this.countInFlash = null;
    this.scoreHud?.remove();
    this.scoreHud = null;
    this.endBtn?.remove();
    this.endBtn = null;

    this.juice.clear();
  }

  update(dt: number, audioTime: number) {
    if (this.exited) return;
    // Intensity tracks the performance meter (stepped at quarter boundaries).
    this.juice.emit("eddieIntensity", { value: this.perf, audioTime });
    this.art?.update(dt, audioTime);

    if (this.finishedAt > 0 && audioTime >= this.finishedAt) {
      this.finishedAt = 0;
      this.showResults();
    }
  }

  /** Translate a scored quarter into juice events (mirrors Score Run). */
  private onScore(ev: EddieScoreEvent) {
    if (ev.kinds.includes("sixteenthTagClear")) {
      this.juice.emit("eddieFire", { measure: ev.measure, tier: 2, audioTime: ev.audioTime });
    } else if (ev.kinds.includes("eighthTagClear")) {
      this.juice.emit("eddieFire", { measure: ev.measure, tier: 1, audioTime: ev.audioTime });
    }

    if (ev.points > 0 && ev.kinds.includes("quarter")) this.quarterScored = true;

    if (ev.points > 0 && ev.measure >= 0) {
      this.juice.emit("eddieNoteScored", { measure: ev.measure, beat: ev.beat });
    }

    if (ev.points <= 0) return;

    this.juice.emit("eddieShake", {
      magnitude: ev.multiplier * SHAKE_PER_MULTIPLIER,
      audioTime: ev.audioTime,
    });
    const origin =
      (ev.measure >= 0 ? this.art?.resolveNoteOrigin(ev.measure, ev.beat) : null) ??
      ev.originHint ??
      { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    this.juice.emit("eddieParticles", {
      from: origin,
      count: Math.max(1, Math.round(ev.multiplier * PARTICLES_PER_MULTIPLIER)),
      color: PARTICLE_COLOR,
      audioTime: ev.audioTime,
    });
  }

  private setActiveMeasure(measure: number) {
    if (measure === this.lastActiveMeasure) return;
    this.lastActiveMeasure = measure;
    this.art?.setActiveMeasure(measure);
  }

  private playKeyboardTone(midi: number, audioTime: number) {
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

  /** Flash a full-screen tint on a count-in beat (brighter on the downbeat). A
   *  CSS opacity transition fades it out; it lives above the grid but below the
   *  hint, ignores pointer events, and is created lazily. */
  private flashCountIn(downbeat: boolean): void {
    if (!this.countInFlash) {
      const el = document.createElement("div");
      el.style.cssText =
        "position:absolute;inset:0;z-index:30;pointer-events:none;opacity:0;" +
        "transition:opacity 0.42s ease-out;" +
        "box-shadow:inset 0 0 140px 40px rgba(255,43,214,0.55);" +
        "background:radial-gradient(circle at 50% 45%,rgba(255,43,214,0.10),transparent 60%);";
      this.hudParent.appendChild(el);
      this.countInFlash = el;
    }
    const el = this.countInFlash;
    el.style.transition = "none";
    el.style.opacity = downbeat ? "1" : "0.55";
    // next frame: fade out
    requestAnimationFrame(() => {
      if (!this.countInFlash) return;
      this.countInFlash.style.transition = "opacity 0.42s ease-out";
      this.countInFlash.style.opacity = "0";
    });
  }

  /** Live score readout under the main SCORE (top-right): sharks killed (a shark
   *  sprite) and dudes eaten (a dude sprite — not a blood drop). */
  private buildScoreHud(): void {
    const el = document.createElement("div");
    el.className = "eddie-battle-score";
    // Sits just below the rig's .eddie-score block (top:18px, right:24px).
    el.style.cssText =
      "position:absolute;right:24px;top:78px;z-index:55;" +
      "display:flex;flex-direction:column;align-items:flex-end;gap:6px;" +
      "font:700 16px/1 ui-monospace,Menlo,Consolas,monospace;color:#eaf6ff;" +
      "text-shadow:0 0 6px rgba(0,0,0,0.85);pointer-events:none;";
    // Each row: count + a sprite icon (one cell of the real sheet, pixelated).
    const iconCss = "display:inline-block;image-rendering:pixelated;background-repeat:no-repeat;vertical-align:middle;";
    el.innerHTML =
      `<div style="display:flex;align-items:center;gap:7px">` +
        `<span data-k="killed" style="color:#7afcff">0</span>` +
        `<span style="${iconCss}width:30px;height:15px;` +
          `background-image:url(/assets/shark-side.png);background-size:120px 15px;background-position:0 0"></span>` +
      `</div>` +
      `<div style="display:flex;align-items:center;gap:7px">` +
        `<span data-k="eaten" style="color:#ff6e8a">0</span>` +
        `<span style="${iconCss}width:18px;height:18px;` +
          `background-image:url(/assets/swim-small.png);background-size:72px 72px;background-position:0 0"></span>` +
      `</div>`;
    this.hudParent.appendChild(el);
    this.scoreHud = el;
    this.updateScoreHud();
  }

  private updateScoreHud(): void {
    if (!this.scoreHud) return;
    const k = this.scoreHud.querySelector<HTMLElement>('[data-k="killed"]');
    const e = this.scoreHud.querySelector<HTMLElement>('[data-k="eaten"]');
    if (k) k.textContent = String(this.sharksKilled);
    if (e) e.textContent = String(this.dudesEaten);
  }

  /** End of the 16-measure fight: leave the scene up and show the tally + buttons. */
  private showResults(): void {
    if (this.endBtn) return;
    const wrap = document.createElement("div");
    wrap.className = "eddie-battle-results";
    wrap.style.cssText =
      "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:60;" +
      "text-align:center;background:rgba(8,10,26,0.86);border:2px solid #19e0ff;" +
      "border-radius:12px;padding:26px 34px;box-shadow:0 0 30px rgba(25,224,255,0.5);" +
      "font:700 18px/1.5 ui-monospace,Menlo,Consolas,monospace;color:#eaf6ff;";
    wrap.innerHTML =
      `<div style="font-size:26px;color:#7afcff;margin-bottom:10px">BATTLE OVER</div>` +
      `<div style="color:#7afcff">🦈 Sharks killed: ${this.sharksKilled}</div>` +
      `<div style="color:#ff6e8a;margin-bottom:14px">🩸 Dudes eaten: ${this.dudesEaten}</div>`;
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:12px;justify-content:center;";
    const again = document.createElement("button");
    again.className = "eddie-title-btn";
    again.type = "button";
    again.textContent = "AGAIN";
    again.addEventListener("click", () => this.onExit());
    const title = document.createElement("button");
    title.className = "eddie-title-btn";
    title.type = "button";
    title.textContent = "TITLE";
    title.addEventListener("click", () => this.onExit());
    row.append(again, title);
    wrap.appendChild(row);
    this.hudParent.appendChild(wrap);
    this.endBtn = wrap;
  }

  private async startEngine() {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") await ctx.resume();
    this.conductor.startPreroll();
    try {
      await this.tracker.start();
    } catch (err) {
      console.warn("[battle] mic denied or unavailable — keyboard fallback only", err);
    }
    setTimeout(() => {
      if (this.exited) return;
      this.conductor.triggerPlay();
    }, 600);
  }
}
