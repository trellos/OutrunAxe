// CliffDiveState — the "Cliff Dive" PLAY screen, the third Eddie-family mode.
//
// A fixed 16-measure run over the ocean: one measure of count-in, then 16
// measures of play, then a results screen (NOT endless). Architecturally it is a
// near-clone of BattleState: the same Conductor → PitchTracker → KeyResolver →
// EddieScorer → createEddieAudio chain and the same juice → Art rig, mounted with
// the ocean background, a 4-measure rolling grid, and crowdMode:"cliffdive".
//
// The ONLY gameplay difference from Battle lives at the onQuarterDiamonds seam
// (the Cliff Dive spawn map) inside CliffDiveCrowd. This state additionally:
//   - schedules a dolphin wave each playing-measure boundary
//     (art.cliffDiveMeasureWave) and ticks the crowd each beat
//     (art.cliffDiveBeat) so the finale swan-dives fire on the beat;
//   - keeps the eddieIntensity perf meter (storm morph + dolphin→mermaid swap);
//   - tallies Dolphins:X (men knocked into the water) and Dudes:Y (men who
//     cliff-dived, incremented LIVE).
//
// Timing discipline (AGENTS.md): measure/beat decisions read the Conductor clock;
// only visual interpolation reads rAF dt (inside the Art rig).

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

/** A ready-to-play Cliff Dive config: a random key in {E,A,G,C} × {major,minor}
 *  with a generated bassline and the player's saved tempo (default 120). Mirrors
 *  createBattleConfig(); the tag mechanics are disabled (-1). */
export function createCliffDiveConfig(): EddieConfig {
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
const FX_INDEX = 4;

const COUNT_IN_BEATS = 4;
const INTRO_MEASURES = COUNT_IN_BEATS / 4;
const PLAY_MEASURES = 16;
const MAX_BPM = 200;
const GRID_MEASURES = 4;
const DONE_LINGER_SEC = 3.5; // give the swan-dive finale room to resolve

const PROVISIONAL_MIDI = 67;

const PARTICLES_PER_MULTIPLIER = 6;
const SHAKE_PER_MULTIPLIER = 0.6;
const PARTICLE_COLOR = "#19e0ff";

// Keyboard piano (same mapping as Score Run / Battle).
const KEY_TO_MIDI: Record<string, number> = {
  KeyZ: 48, KeyS: 49, KeyX: 50, KeyD: 51, KeyC: 52, KeyV: 53,
  KeyG: 54, KeyB: 55, KeyH: 56, KeyN: 57, KeyJ: 58, KeyM: 59,
  Comma: 60, KeyL: 61, Period: 62, Semicolon: 63, Slash: 64,
};

/** Registry index of the ocean background ("Neon Sea → Storm" = bg02). */
function oceanBgIndex(): number {
  const i = BACKGROUNDS.findIndex((b) => /sea|ocean/i.test(b.label));
  return i >= 0 ? i : 1;
}

export class CliffDiveState implements GameState {
  readonly name = "cliffdive";

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
  private noteStarts = new Map<number, { measure: number; startTime: number }>();
  private onsetTimes = new Map<number, number>();
  private pendingNoteEnds = new Map<number, number>();
  private keyHandler?: (e: KeyboardEvent) => void;

  private keySet = new Set<string>();

  private introStart = -1;
  private lastActiveMeasure = NaN;
  private perf = 0;
  private quarterScored = false;
  private sawPlayingQuarter = false;
  private exited = false;

  private countInFlash: HTMLDivElement | null = null;

  // Cliff Dive score.
  private dolphinKnockdowns = 0;
  private dudeDives = 0;
  private scoreHud: HTMLDivElement | null = null;
  private endBtn: HTMLElement | null = null;
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
      playMeasures: PLAY_MEASURES, // fixed 16-measure run, then results
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
      gridIntroRow: false,
      crowdMode: "cliffdive",
      onDolphinKnockdown: () => { this.dolphinKnockdowns++; this.updateScoreHud(); },
      onDudeDive: () => { this.dudeDives++; this.updateScoreHud(); },
    });

    this.audio = createEddieAudio(AUDIO_VARIANT, this.conductor, this.config);
    this.audio.start();

    this.offBeat = this.conductor.onBeat((info) => {
      if (info.phase === "countIn") {
        if (info.beatInPhase === 0 && this.introStart < 0) {
          this.introStart = info.time;
        }
        this.flashCountIn(info.beatInPhase % 4 === 0);
        this.juice.emit("eddieBeatPulse", {
          beatInMeasure: info.beatInPhase % 4,
          downbeat: info.beatInPhase % 4 === 0,
          audioTime: info.time,
        });
      } else if (info.phase === "playing") {
        this.setActiveMeasure(info.measureInPlay);
        // One dolphin wave per measure boundary.
        if (info.beatInPhase === 0) this.art?.cliffDiveMeasureWave(info.measureInPlay);
        // Beat tick (no-op until the finale, when it drives the swan-dives).
        this.art?.cliffDiveBeat();
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

    // The 16-measure run ended — flush + finale, linger, then results.
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
    this.juice.emit("eddieIntensity", { value: this.perf, audioTime });
    this.art?.update(dt, audioTime);

    if (this.finishedAt > 0 && audioTime >= this.finishedAt) {
      this.finishedAt = 0;
      this.showResults();
    }
  }

  private onScore(ev: EddieScoreEvent) {
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

  private flashCountIn(downbeat: boolean): void {
    if (!this.countInFlash) {
      const el = document.createElement("div");
      el.style.cssText =
        "position:absolute;inset:0;z-index:30;pointer-events:none;opacity:0;" +
        "transition:opacity 0.42s ease-out;" +
        "box-shadow:inset 0 0 140px 40px rgba(25,224,255,0.55);" +
        "background:radial-gradient(circle at 50% 45%,rgba(25,224,255,0.10),transparent 60%);";
      this.hudParent.appendChild(el);
      this.countInFlash = el;
    }
    const el = this.countInFlash;
    el.style.transition = "none";
    el.style.opacity = downbeat ? "1" : "0.55";
    requestAnimationFrame(() => {
      if (!this.countInFlash) return;
      this.countInFlash.style.transition = "opacity 0.42s ease-out";
      this.countInFlash.style.opacity = "0";
    });
  }

  /** Live score readout: Dolphins (men knocked into the water) and Dudes (men who
   *  cliff-dived; increments in real time during the finale). */
  private buildScoreHud(): void {
    const el = document.createElement("div");
    el.className = "eddie-cliff-score";
    el.style.cssText =
      "position:absolute;right:24px;top:78px;z-index:55;" +
      "display:flex;flex-direction:column;align-items:flex-end;gap:6px;" +
      "font:700 16px/1 ui-monospace,Menlo,Consolas,monospace;color:#eaf6ff;" +
      "text-shadow:0 0 6px rgba(0,0,0,0.85);pointer-events:none;";
    el.innerHTML =
      `<div style="display:flex;align-items:center;gap:7px">` +
        `<span data-k="dolphins" style="color:#7afcff">0</span>` +
        `<span style="color:#7afcff;font-size:14px">DOLPHINS</span>` +
      `</div>` +
      `<div style="display:flex;align-items:center;gap:7px">` +
        `<span data-k="dudes" style="color:#ffd84d">0</span>` +
        `<span style="color:#ffd84d;font-size:14px">DUDES</span>` +
      `</div>`;
    this.hudParent.appendChild(el);
    this.scoreHud = el;
    this.updateScoreHud();
  }

  private updateScoreHud(): void {
    if (!this.scoreHud) return;
    const d = this.scoreHud.querySelector<HTMLElement>('[data-k="dolphins"]');
    const y = this.scoreHud.querySelector<HTMLElement>('[data-k="dudes"]');
    if (d) d.textContent = String(this.dolphinKnockdowns);
    if (y) y.textContent = String(this.dudeDives);
  }

  private showResults(): void {
    if (this.endBtn) return;
    const wrap = document.createElement("div");
    wrap.className = "eddie-cliff-results";
    wrap.style.cssText =
      "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:60;" +
      "text-align:center;background:rgba(8,10,26,0.86);border:2px solid #19e0ff;" +
      "border-radius:12px;padding:26px 34px;box-shadow:0 0 30px rgba(25,224,255,0.5);" +
      "font:700 18px/1.5 ui-monospace,Menlo,Consolas,monospace;color:#eaf6ff;";
    wrap.innerHTML =
      `<div style="font-size:26px;color:#7afcff;margin-bottom:10px">CLIFF DIVE COMPLETE</div>` +
      `<div style="color:#7afcff">Dolphins: ${this.dolphinKnockdowns}</div>` +
      `<div style="color:#ffd84d;margin-bottom:14px">Dudes: ${this.dudeDives}</div>`;
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
      console.warn("[cliffdive] mic denied or unavailable — keyboard fallback only", err);
    }
    setTimeout(() => {
      if (this.exited) return;
      this.conductor.triggerPlay();
    }, 600);
  }
}
