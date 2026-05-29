// InfiniteEddieState — the Infinite Eddie PLAY screen (GDD §1, §3, §6.4).
//
// A score-only jam: NO combat, enemies, avatar, rail, or HP. It drives a
// reconfigured Conductor (16-beat count-in = 4 intro measures, 16 scored
// measures), wires PitchTracker -> KeyResolver -> EddieScorer, owns the public
// `juice` EventBus, translates scoring events into juice events, and mounts the
// Art rig (createEddieArt) + Sound rig (createEddieAudio).
//
// Timing discipline (AGENTS.md / GDD §2): measure/beat/scoring decisions read
// the Conductor clock; only visual interpolation reads rAF dt (inside the Art
// rig). This state never re-derives beat timing off rAF.
//
// Clean teardown (GDD §3): exit() unsubscribes every listener, stops the
// Conductor + tracker + audio rig, disposes the Art rig, and removes all DOM.
// Entering/exiting repeatedly must never stack audio clocks or leak canvases.

import { Conductor } from "../audio/Conductor";
import { PitchTracker } from "../audio/PitchTracker";
import { getAudioContext } from "../audio/AudioContextSingleton";
import type { Game, GameState } from "../engine/Game";
import { EventBus } from "../engine/EventBus";
import { KeyResolver } from "../music/KeyResolver";
import { keyPitchClasses } from "../music/keys";
import { EddieScorer } from "../music/eddie/EddieScorer";
import type {
  EddieConfig,
  EddieJuiceEvents,
  EddieScoreEvent,
} from "../music/eddie/eddieTypes";
import { createEddieArt, type EddieArtRig } from "../eddie/art/eddieArtFactory";
import {
  createEddieAudio,
  type EddieAudioRig,
} from "../audio/eddie/eddieAudioFactory";

const ART_VARIANT = "option-1" as const;
const AUDIO_VARIANT = "option-1" as const;

// Production-default art variants chosen from the registries (review via the
// ?eddieart=1 gallery): bg-1 "Chroma Crash" = index 0; fx-5 "Phosphor Comets" =
// index 4. Fire default is option-3 (set in the EddieFire source).
const BG_INDEX = 0;
const FX_INDEX = 4;

// Conductor sizing for Eddie (GDD §3): 4-measure intro + 16 scored measures.
const COUNT_IN_BEATS = 16;
const PLAY_MEASURES = 16;
const MAX_BPM = 200;

// How long to linger on the final score before returning to the menu.
const DONE_LINGER_SEC = 2.5;

// Juice scaling. Particles/shake grow with the score multiplier so a fat,
// many-bonus quarter reads louder than a bare baseline quarter.
const PARTICLES_PER_MULTIPLIER = 6;
const SHAKE_PER_MULTIPLIER = 0.6;
const PARTICLE_COLOR = "#ff2bd6";

// Keyboard piano (same mapping as LevelState/MenuPulse) so the player can jam
// without a mic. Routed through PitchTracker.emitSyntheticNote so KeyResolver
// and the scorer see the identical event stream the mic would produce.
const KEY_TO_MIDI: Record<string, number> = {
  KeyZ: 48, KeyS: 49, KeyX: 50, KeyD: 51, KeyC: 52, KeyV: 53,
  KeyG: 54, KeyB: 55, KeyH: 56, KeyN: 57, KeyJ: 58, KeyM: 59,
  Comma: 60, KeyL: 61, Period: 62, Semicolon: 63, Slash: 64,
};

export class InfiniteEddieState implements GameState {
  readonly name = "infiniteEddie";

  /** Public juice bus the Art rig subscribes to (GDD §6.4). */
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
  private offNote?: () => void;
  private keyHandler?: (e: KeyboardEvent) => void;

  /** Pitch classes of the selected key, for the in-key note coloring. */
  private keySet = new Set<string>();

  /** Audio time of the very first count-in beat (intro origin). */
  private introStart = -1;
  /** Last measure index pushed to the Art rig (avoids redundant updates).
   *  Negative = intro row (-1..-INTRO_MEASURES); 0..15 = scored. */
  private lastActiveMeasure = NaN;
  /** Set once the Conductor reaches `done`; counts down the linger. */
  private finishedAt = 0;
  private exited = false;

  constructor(hudParent: HTMLElement, config: EddieConfig, onExit: () => void) {
    this.hudParent = hudParent;
    this.config = config;
    this.onExit = onExit;
  }

  enter(game: Game) {
    const { worldScene, worldCamera } = game.renderer;

    this.conductor = new Conductor({
      countInBeats: COUNT_IN_BEATS,
      playMeasures: PLAY_MEASURES,
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

    // Art rig: mounts the grid/background/fire/particles + score readout and
    // subscribes to the juice bus. Background may park/shake the world camera.
    this.art = createEddieArt(ART_VARIANT);
    this.art.mount({
      hudParent: this.hudParent,
      scene: worldScene,
      config: this.config,
      juice: this.juice,
      camera: worldCamera,
      bgIndex: BG_INDEX,
      fxIndex: FX_INDEX,
    });

    // Sound rig: drums in BOTH count-in and playing phases (the intro IS the
    // generated beat), bass following config.bassline.
    this.audio = createEddieAudio(AUDIO_VARIANT, this.conductor, this.config);
    this.audio.start();

    // Beat -> beat-pulse juice + active-measure tracking. Read directly off the
    // Conductor clock (never rAF).
    this.offBeat = this.conductor.onBeat((info) => {
      if (info.phase === "countIn") {
        if (info.beatInPhase === 0 && this.introStart < 0) {
          this.introStart = info.time;
        }
        const introMeasure = Math.floor(info.beatInPhase / 4); // 0..3
        this.setActiveMeasure(-(introMeasure + 1)); // -1..-4 intro rows
        this.juice.emit("eddieBeatPulse", {
          beatInMeasure: info.beatInPhase % 4,
          downbeat: info.beatInPhase % 4 === 0,
          audioTime: info.time,
        });
      } else if (info.phase === "playing") {
        this.setActiveMeasure(info.measureInPlay);
        this.juice.emit("eddieBeatPulse", {
          beatInMeasure: info.beatInPhase,
          downbeat: info.beatInPhase === 0,
          audioTime: info.time,
        });
      }
    });

    this.offPhase = this.conductor.onPhaseChange((p) => {
      if (p === "done" && this.finishedAt === 0) {
        this.finishedAt = this.conductor.audioTime + DONE_LINGER_SEC;
      }
    });

    // Scoring -> juice translation. The scorer owns points; this state owns the
    // juice bus, decoupling Art from scoring logic (GDD §6.4).
    this.offScore = this.scorer.bus.on("eddieScore", (ev) => this.onScore(ev));
    this.offTotal = this.scorer.bus.on("eddieTotal", (t) => {
      this.juice.emit("eddieScorePop", {
        total: t.total,
        delta: t.lastDelta,
        audioTime: t.audioTime,
      });
    });

    // Plot every played note into its measure cell on the grid (GDD §13: the
    // grid cells are note timelines). pitchFired fires only during the playing
    // phase (KeyResolver gates on phase), so measureIdx is a scored measure.
    this.offNote = this.resolver.bus.on("pitchFired", (p) => {
      const dur = this.conductor.measureDuration();
      const start = this.conductor.measureStartTime(p.measureIdx);
      const frac = dur > 0 ? (p.audioTime - start) / dur : 0;
      this.juice.emit("eddieNote", {
        measure: p.measureIdx,
        beatFraction: Math.max(0, Math.min(1, frac)),
        pitchClass: p.pitchClass,
        midi: p.midi,
        inKey: this.keySet.has(p.pitchClass),
        audioTime: p.audioTime,
      });
    });

    this.keyHandler = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const midi = KEY_TO_MIDI[e.code];
      if (midi === undefined) return;
      const t = this.conductor.audioTime;
      this.playKeyboardTone(midi, t);
      // Gameplay (key narrowing + scoring) only runs during the playing phase;
      // KeyResolver gates on phase internally, so always feed the tracker.
      this.tracker.emitSyntheticNote(midi, t);
    };
    window.addEventListener("keydown", this.keyHandler);

    void this.startEngine();
  }

  exit() {
    this.exited = true;
    if (this.keyHandler) window.removeEventListener("keydown", this.keyHandler);
    this.keyHandler = undefined;

    this.offBeat?.();
    this.offPhase?.();
    this.offScore?.();
    this.offTotal?.();
    this.offNote?.();

    this.scorer?.detach();
    this.resolver?.detach();
    this.tracker?.stop();
    this.audio?.stop();
    this.audio = null;
    this.conductor?.stop();

    this.art?.dispose();
    this.art = null;

    // Release every juice subscriber so the Art rig (already disposed) and any
    // late listeners can't fire after teardown.
    this.juice.clear();
  }

  update(dt: number, audioTime: number) {
    if (this.exited) return;
    this.art?.update(dt, audioTime);

    if (this.finishedAt > 0 && audioTime >= this.finishedAt) {
      this.finishedAt = 0;
      this.onExit();
    }
  }

  /** Translate a scored quarter (or tagged-clear) into juice events. */
  private onScore(ev: EddieScoreEvent) {
    // Tagged-measure clears light a grid measure on fire (tier 1 = 8th clear,
    // tier 2 = 16th clear).
    if (ev.kinds.includes("sixteenthTagClear")) {
      this.juice.emit("eddieFire", { measure: ev.measure, tier: 2, audioTime: ev.audioTime });
    } else if (ev.kinds.includes("eighthTagClear")) {
      this.juice.emit("eddieFire", { measure: ev.measure, tier: 1, audioTime: ev.audioTime });
    }

    // No points (out-of-key / silent) earns no shake or particles.
    if (ev.points <= 0) return;

    this.juice.emit("eddieShake", {
      magnitude: ev.multiplier * SHAKE_PER_MULTIPLIER,
      audioTime: ev.audioTime,
    });
    this.juice.emit("eddieParticles", {
      // Art may recompute from (measure,beat); originHint is a convenience and
      // is null here, so let Art resolve the grid cell itself.
      from: ev.originHint ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 },
      count: Math.max(1, Math.round(ev.multiplier * PARTICLES_PER_MULTIPLIER)),
      color: PARTICLE_COLOR,
      audioTime: ev.audioTime,
    });
  }

  /** Push the live measure to the Art rig only when it actually changes. */
  private setActiveMeasure(measure: number) {
    if (measure === this.lastActiveMeasure) return;
    this.lastActiveMeasure = measure;
    this.art?.setActiveMeasure(measure);
  }

  /** Audible pluck for keyboard input — mirrors LevelState's keyboard tone. */
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

  private async startEngine() {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") await ctx.resume();
    this.conductor.startPreroll();
    try {
      await this.tracker.start();
    } catch (err) {
      console.warn("[eddie] mic denied or unavailable — keyboard fallback only", err);
    }
    // Begin the count-in shortly after preroll so the player hears a couple of
    // metronome/drum beats first (mirrors LevelState's 600ms lead-in).
    setTimeout(() => this.conductor.triggerPlay(), 600);
  }
}
