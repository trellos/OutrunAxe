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
import { audioBufferToWav } from "../audio/wavEncode";
import { PerfHud } from "../hud/PerfHud";
import type { OnsetEvent, PitchUpdate, NoteEnd } from "../audio/PitchEngine";
import {
  createEddieAudio,
  type EddieAudioRig,
} from "../audio/eddie/eddieAudioFactory";

const ART_VARIANT = "option-1" as const;
const AUDIO_VARIANT = "option-1" as const;

// Production picks a RANDOM background per run from the registry (the picker menu
// can still force a specific one via opts.bgIndex). Particles default to fx-5
// "Phosphor Comets" = index 4; fire default is option-3 (set in EddieFire).
const FX_INDEX = 4;

// Conductor sizing for Eddie (GDD §3): 1-measure count-in + 16 scored measures.
const COUNT_IN_BEATS = 4;
const INTRO_MEASURES = COUNT_IN_BEATS / 4; // count-in measures (intro rows)
const PLAY_MEASURES = 16;
const MAX_BPM = 200;

// How long after the round before the final score screen + buttons appear.
const DONE_LINGER_SEC = 2.5;

// Lane a freshly-plucked note sits at before its pitch resolves (mid-range, so
// the bar is visible immediately; it jumps to the real lane when pitch lands).
const PROVISIONAL_MIDI = 67;

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

/** Everything the record/debug mode collects for offline diagnosis. Downloaded
 *  as JSON alongside the input audio (.wav). */
interface CaptureLog {
  meta: {
    fileName: string;
    bpm: number;
    keyRoot: string;
    keyMode: string;
    sampleRate: number;
    startedAt: string;
    source: "file" | "mic";
  };
  /** measureStartTime(0) — the audio time scored measure 0 opens, so every
   *  other audioTime below can be related to the musical grid. */
  playStartTime: number;
  /** Conductor beat times (count-in + playing), so bar timing can be checked. */
  beats: number[];
  onsets: { time: number; energy: number; synthetic: boolean }[];
  pitches: {
    onsetId: number;
    time: number;
    freq: number;
    midi: number;
    confidence: number;
    status: string;
  }[];
  noteEnds: { onsetId: number; time: number; reason: string }[];
  /** Notes as PLOTTED on the grid (post key-resolution). */
  notes: {
    measure: number;
    beatFraction: number;
    pitchClass: string;
    midi: number;
    inKey: boolean;
    audioTime: number;
  }[];
  scores: {
    measure: number;
    beat: number;
    kinds: string[];
    points: number;
    multiplier: number;
    audioTime: number;
  }[];
  /** Performance/intensity sampled at each playing quarter boundary. */
  intensity: { measure: number; beat: number; perf: number; audioTime: number }[];
}

export class InfiniteEddieState implements GameState {
  readonly name = "infiniteEddie";

  /** Public juice bus the Art rig subscribes to (GDD §6.4). */
  readonly juice = new EventBus<EddieJuiceEvents>();

  private hudParent: HTMLElement;
  private config: EddieConfig;
  private onExit: () => void;
  private onReplay?: () => void;

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
  private endBtn?: HTMLElement;
  /** onset id → where that note opened, so its NoteEnd can size the grid bar. */
  private noteStarts = new Map<number, { measure: number; startTime: number }>();
  /** onset id → the ONSET (attack) audio time. The grid bar's left edge must be
   *  the onset, NOT the settled-pitch time (which lags it): for fast notes the
   *  lag collapses the bar to a dot. Populated from the raw onset stream. */
  private onsetTimes = new Map<number, number>();
  /** onset id → note-end time that arrived BEFORE the bar was plotted (fast
   *  notes whose pitch hadn't settled yet). Applied the moment the bar lands so
   *  it still grows instead of staying a dot. */
  private pendingNoteEnds = new Map<number, number>();
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

  /** Which background variant to mount (registry index). Random in production;
   *  the picker menu can override via opts.bgIndex. */
  private bgIndex = 0;
  /** Demo mode (launched from the background menu): auto-ramps intensity so the
   *  full morph is visible, shows a HUD, and Esc returns to the menu. */
  private demo = false;
  /** Performance meter 0..1 → eddieIntensity in normal play. Each scored quarter
   *  adds 0.0315; each unscored quarter (out-of-key or silent) subtracts 0.0315;
   *  clamped to [0,1]. Stepped at quarter boundaries in onBeat. */
  private perf = 0;
  /** Whether the currently-closing quarter earned points (set by onScore). */
  private quarterScored = false;
  /** True once the first playing quarter has opened (skips the phantom first beat). */
  private sawPlayingQuarter = false;
  /** Demo auto-ramp phase. */
  private demoT = 0;
  /** Manual intensity override (>=0 active; -1 = off). Set by [ ] keys. */
  private manualIntensity = -1;
  private demoHud: HTMLDivElement | null = null;
  /** Realtime diagnostics overlay (?perf=1) — fps/beats/onsets during play. */
  private perfHud: PerfHud | null = null;
  private offPerfOnset?: () => void;

  /** Record/debug mode: capture the full detection stream + input audio for
   *  offline diagnosis (set by the Eddie debug menu). */
  private capture = false;
  private fileName = "live-mic";
  /** Decoded calibration file routed through the REAL onset+pitch chain instead
   *  of the mic (via PitchTracker.prepareFakeMic). null = use the live mic. */
  private fakeMicBuffer: AudioBuffer | null = null;
  private captureLog: CaptureLog | null = null;
  private captureHud: HTMLDivElement | null = null;
  private offCapOnset?: () => void;
  private offCapPitch?: () => void;
  private offCapEnd?: () => void;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];

  constructor(
    hudParent: HTMLElement,
    config: EddieConfig,
    onExit: () => void,
    opts?: {
      bgIndex?: number;
      demo?: boolean;
      fakeMicBuffer?: AudioBuffer;
      capture?: boolean;
      fileName?: string;
      /** If provided, the end screen shows an INFINITE EDDIE button that calls
       *  this to start a fresh round. */
      onReplay?: () => void;
    },
  ) {
    this.hudParent = hudParent;
    this.config = config;
    this.onExit = onExit;
    this.onReplay = opts?.onReplay;
    this.bgIndex =
      opts?.bgIndex !== undefined
        ? opts.bgIndex
        : Math.floor(Math.random() * BACKGROUNDS.length);
    this.demo = opts?.demo ?? false;
    this.fakeMicBuffer = opts?.fakeMicBuffer ?? null;
    this.capture = opts?.capture ?? false;
    if (opts?.fileName) this.fileName = opts.fileName;
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
      bgIndex: this.bgIndex,
      fxIndex: FX_INDEX,
    });

    // Sound rig: drums in BOTH count-in and playing phases (the intro IS the
    // generated beat), bass following config.bassline.
    this.audio = createEddieAudio(AUDIO_VARIANT, this.conductor, this.config);
    this.audio.start();

    // Beat -> beat-pulse juice + active-measure tracking. Read directly off the
    // Conductor clock (never rAF).
    this.offBeat = this.conductor.onBeat((info) => {
      this.perfHud?.noteBeat();
      this.captureLog?.beats.push(info.time);
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
        // Per-quarter intensity step. The scorer subscribed to onBeat before this
        // state, so by now it has scored the just-ended quarter and set
        // quarterScored via onScore: +0.0315 if it scored, -0.0315 otherwise
        // (out-of-key OR silent). Skip the first playing beat (no prior quarter).
        // Demo mode drives intensity itself.
        if (!this.demo && this.sawPlayingQuarter) {
          this.perf = Math.max(
            0,
            Math.min(1, this.perf + (this.quarterScored ? 0.0315 : -0.0315)),
          );
        }
        this.quarterScored = false;
        this.sawPlayingQuarter = true;
        this.captureLog?.intensity.push({
          measure: info.measureInPlay,
          beat: info.beatInPhase,
          perf: this.perf,
          audioTime: info.time,
        });
      }
    });

    this.offPhase = this.conductor.onPhaseChange((p) => {
      if (p === "done") this.perfHud?.setPlaying(false); // beats stop normally now
      if (p === "done" && this.finishedAt === 0) {
        this.finishedAt = this.conductor.audioTime + DONE_LINGER_SEC;
        // Release the final row's characters and let art settle into the finale.
        this.juice.emit("eddieFinale", { audioTime: this.conductor.audioTime });
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

    // Grid plotting is driven by the ONSET stream (every played note), NOT by
    // settled pitch. At fast subdivisions most onsets never settle a pitch
    // (measured: ~46% settle at 95 BPM triplets), so a settled-only grid dropped
    // half the notes. Instead we plot a bar the instant a note is plucked
    // (provisional lane) and refine its lane/colour when the pitch resolves — so
    // the grid shows exactly what was played, like the settings timeline. The
    // scorer consumes pitchFired on its own bus and is untouched.
    this.offGridOnset = this.tracker.onOnset((e) => {
      if (e.synthetic) return; // keyboard tones plot via the pitch path below
      this.onsetTimes.set(e.id, e.time);
      if (this.onsetTimes.size > 96) {
        const oldest = this.onsetTimes.keys().next().value;
        if (oldest !== undefined) this.onsetTimes.delete(oldest);
      }
      this.plotGridNote(e.id, e.time, null);
    });

    // Pitch resolved (preliminary OR settled) — refine the bar's lane + colour.
    // For keyboard/synthetic notes (no onset event) this also creates the bar.
    this.offGridPitch = this.tracker.onPitchUpdate((u) => {
      const onsetTime = this.onsetTimes.get(u.onsetId) ?? u.time;
      this.plotGridNote(u.onsetId, onsetTime, u.midi);
    });

    // A note ended — grow its grid bar from onset to here. If the bar isn't
    // plotted yet (pitch still settling on a fast note), stash the end time and
    // apply it when the bar lands (see applyPendingEnd in the plot handlers).
    this.offNoteEnd = this.tracker.onNoteEnd((e) => {
      if (!this.growGridBar(e.onsetId, e.time)) {
        this.pendingNoteEnds.set(e.onsetId, e.time);
      }
    });

    this.keyHandler = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (this.capture && (e.key === "Escape" || e.key === "Backspace")) {
        e.preventDefault();
        this.onExit();
        return;
      }
      if (this.demo && this.handleDemoKey(e)) return;
      const midi = KEY_TO_MIDI[e.code];
      if (midi === undefined) return;
      const t = this.conductor.audioTime;
      this.playKeyboardTone(midi, t);
      // Gameplay (key narrowing + scoring) only runs during the playing phase;
      // KeyResolver gates on phase internally, so always feed the tracker.
      this.tracker.emitSyntheticNote(midi, t);
    };
    window.addEventListener("keydown", this.keyHandler);

    if (this.demo) this.buildDemoHud();
    if (this.capture) this.setupCapture();

    // Realtime diagnostics overlay during play (?perf=1): fps, worst-frame split,
    // onsets/s, beats/s (+ BEAT DROPPED), GPU string.
    if (new URLSearchParams(location.search).has("perf")) {
      this.perfHud = new PerfHud();
      this.perfHud.mount(this.hudParent);
      this.perfHud.setPlaying(true);
      this.offPerfOnset = this.tracker.onOnset(() => this.perfHud?.noteOnset());
    }

    void this.startEngine();
  }

  /** Plot (or, on later pitch updates, refine) a grid bar for a played note.
   *  `midi` is null at the onset (no pitch yet → provisional lane) and set once
   *  the pitch resolves. Anchors the bar at the onset time so its width is the
   *  true note duration; the grid keeps one bar per onsetId (idempotent). */
  private plotGridNote(onsetId: number, time: number, midi: number | null): void {
    const dur = this.conductor.measureDuration();
    if (dur <= 0) return;
    let begun = this.noteStarts.get(onsetId);
    if (!begun) {
      const placed = this.placeOnGrid(time);
      if (!placed) return; // outside the play/intro window
      begun = { measure: placed.measure, startTime: placed.start };
      this.noteStarts.set(onsetId, begun);
      this.applyPendingEnd(onsetId); // a note-end may have raced ahead of us
    }
    const m = midi ?? PROVISIONAL_MIDI;
    const pitchClass = midiToPitchClass(m) as PitchClass;
    const note = {
      measure: begun.measure,
      beatFraction: Math.max(0, Math.min(1, (time - begun.startTime) / dur)),
      pitchClass,
      midi: m,
      inKey: midi === null ? true : this.keySet.has(pitchClass),
      audioTime: time,
      onsetId,
    };
    this.juice.emit("eddieNote", note);
    if (midi === null) this.captureLog?.notes.push(note);
  }

  /** Which grid cell + measure-start a time falls in: scored 0..15 during play,
   *  intro rows -1..-4 during count-in, or null if outside either window. */
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

  /** Grow a plotted note's grid bar from its onset to `endTime`. Returns false
   *  if the note hasn't been plotted yet (so the caller can stash the end). */
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

  /** If a note-end arrived before this note's bar was plotted, apply it now so
   *  the bar grows to its true width instead of staying a dot. */
  private applyPendingEnd(onsetId: number): void {
    const end = this.pendingNoteEnds.get(onsetId);
    if (end === undefined) return;
    this.pendingNoteEnds.delete(onsetId);
    this.growGridBar(onsetId, end);
  }

  /** Record/debug mode: collect the raw detection stream + build the download
   *  HUD. Notes/scores/intensity are pushed from the existing handlers. */
  private setupCapture() {
    const ctx = getAudioContext();
    this.captureLog = {
      meta: {
        fileName: this.fileName,
        bpm: this.config.bpm,
        keyRoot: this.config.keyRoot,
        keyMode: this.config.keyMode,
        sampleRate: ctx.sampleRate,
        startedAt: new Date().toISOString(),
        source: this.fakeMicBuffer ? "file" : "mic",
      },
      playStartTime: 0,
      beats: [],
      onsets: [],
      pitches: [],
      noteEnds: [],
      notes: [],
      scores: [],
      intensity: [],
    };
    this.offCapOnset = this.tracker.onOnset((e: OnsetEvent) => {
      this.captureLog?.onsets.push({
        time: e.time,
        energy: e.energy,
        synthetic: e.synthetic,
      });
      this.updateCaptureHud();
    });
    this.offCapPitch = this.tracker.onPitchUpdate((u: PitchUpdate) => {
      this.captureLog?.pitches.push({
        onsetId: u.onsetId,
        time: u.time,
        freq: u.freq,
        midi: u.midi,
        confidence: u.confidence,
        status: u.status,
      });
    });
    this.offCapEnd = this.tracker.onNoteEnd((e: NoteEnd) => {
      this.captureLog?.noteEnds.push({
        onsetId: e.onsetId,
        time: e.time,
        reason: e.reason,
      });
    });
    this.buildCaptureHud();
  }

  private handleDemoKey(e: KeyboardEvent): boolean {
    if (e.key === "Escape" || e.key === "Backspace") {
      e.preventDefault();
      this.onExit();
      return true;
    }
    const cur = this.manualIntensity >= 0 ? this.manualIntensity : this.perf;
    if (e.key === "[") { this.manualIntensity = Math.max(0, cur - 0.1); return true; }
    if (e.key === "]") { this.manualIntensity = Math.min(1, cur + 0.1); return true; }
    if (e.key === "\\") { this.manualIntensity = -1; return true; }
    return false;
  }

  private buildDemoHud() {
    const el = document.createElement("div");
    el.className = "eddie-debug-hud";
    el.style.cssText = "position:absolute;left:14px;top:14px;z-index:50;";
    this.hudParent.appendChild(el);
    this.demoHud = el;
    this.updateDemoHud(this.perf);
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
    this.endBtn?.remove();
    this.endBtn = undefined;
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

    this.demoHud?.remove();
    this.demoHud = null;

    this.offPerfOnset?.();
    this.perfHud?.dispose();
    this.perfHud = null;

    this.offCapOnset?.();
    this.offCapPitch?.();
    this.offCapEnd?.();
    if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
      try { this.mediaRecorder.stop(); } catch { /* already stopped */ }
    }
    this.mediaRecorder = null;
    this.captureHud?.remove();
    this.captureHud = null;

    // Release every juice subscriber so the Art rig (already disposed) and any
    // late listeners can't fire after teardown.
    this.juice.clear();
  }

  update(dt: number, audioTime: number) {
    if (this.exited) return;

    // Drive eddieIntensity every frame. Demo mode auto-ramps so the full morph is
    // visible; a manual override ([ ]) wins in either mode; otherwise it tracks
    // the performance meter (which decays toward a calm baseline).
    if (this.demo) {
      this.demoT += dt;
      this.perf = 0.5 - 0.5 * Math.cos(this.demoT * 0.4); // 0 -> 1 -> 0 over ~16s
    }
    // In normal play, perf changes only at quarter boundaries (onBeat) per the
    // +/-0.0315 rule — no per-frame decay.
    const intensity = this.manualIntensity >= 0 ? this.manualIntensity : this.perf;
    this.juice.emit("eddieIntensity", { value: intensity, audioTime });
    if (this.demoHud) this.updateDemoHud(intensity);
    if (this.captureHud) this.updateCaptureHud();

    this.art?.update(dt, audioTime);

    if (this.finishedAt > 0 && audioTime >= this.finishedAt) {
      this.finishedAt = 0;
      if (this.capture) this.markCaptureDone();
      // The final score screen stays up until the player chooses to leave —
      // show a TITLE button instead of auto-returning to the menu.
      this.showEndScreen();
    }
  }

  /** End of round: leave the populated grid + score on screen and add a TITLE
   *  button. The screen persists until the player presses it. */
  private showEndScreen(): void {
    if (this.demo || this.endBtn) return;
    const row = document.createElement("div");
    row.className = "eddie-endrow";

    // SCORE RUN — play another round (if the launcher supports it).
    if (this.onReplay) {
      const again = document.createElement("button");
      again.className = "eddie-title-btn eddie-again-btn";
      again.type = "button";
      again.textContent = "SCORE RUN";
      again.addEventListener("click", () => this.onReplay?.());
      row.appendChild(again);
    }

    const title = document.createElement("button");
    title.className = "eddie-title-btn";
    title.type = "button";
    title.textContent = "TITLE";
    title.addEventListener("click", () => this.onExit());
    row.appendChild(title);

    this.hudParent.appendChild(row);
    this.endBtn = row;
  }

  private markCaptureDone() {
    const c = this.captureHud?.querySelector<HTMLDivElement>('[data-cap="counts"]');
    if (c && this.captureLog) {
      c.textContent =
        `DONE · onsets ${this.captureLog.onsets.length} · ` +
        `notes ${this.captureLog.notes.length} · scores ${this.captureLog.scores.length}`;
    }
  }

  private updateDemoHud(intensity: number) {
    if (!this.demoHud) return;
    const name = BACKGROUNDS[this.bgIndex % BACKGROUNDS.length]?.label ?? `bg${this.bgIndex + 1}`;
    const pct = Math.round(intensity * 100);
    const mode = this.manualIntensity >= 0 ? "MANUAL" : "AUTO";
    const bars = "█".repeat(Math.round(intensity * 20)).padEnd(20, "·");
    this.demoHud.innerHTML =
      `BG ${this.bgIndex + 1}/${BACKGROUNDS.length}: <b>${name}</b><br>` +
      `INTENSITY ${mode} ${pct}%<br><span style="letter-spacing:1px">${bars}</span><br>` +
      `<b>[</b>/<b>]</b> intensity &middot; <b>\\</b> auto &middot; <b>Esc</b> back to menu`;
  }

  // --- Record/debug mode HUD + downloads ----------------------------------

  private buildCaptureHud() {
    const el = document.createElement("div");
    el.className = "eddie-capture-hud";
    el.style.cssText =
      "position:absolute;right:14px;top:14px;z-index:60;min-width:210px;" +
      "font:11px/1.5 ui-monospace,Menlo,Consolas,monospace;color:#cfe;" +
      "background:rgba(10,8,24,0.82);border:1px solid #ff2bd6;border-radius:8px;" +
      "padding:10px 12px;box-shadow:0 0 18px rgba(255,43,214,0.4);";
    // fileName comes from an uploaded File.name — escape before innerHTML.
    const safeName = this.fileName.replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
    );
    const src = this.fakeMicBuffer ? `FILE: ${safeName}` : "LIVE MIC";
    el.innerHTML =
      `<div style="font-weight:700;color:#ff7be9;margin-bottom:6px">● REC &middot; ${src}</div>` +
      `<div data-cap="counts">onsets 0 · notes 0 · score 0</div>` +
      `<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">` +
      `<button data-cap="json" style="cursor:pointer">⤓ notes.json</button>` +
      `<button data-cap="audio" style="cursor:pointer">⤓ audio</button>` +
      `</div>` +
      `<div style="margin-top:6px;opacity:0.7">Esc: back to menu</div>`;
    el.querySelectorAll("button").forEach((b) => {
      (b as HTMLButtonElement).style.cssText =
        "background:#1a1430;color:#cfe;border:1px solid #5a4a8a;border-radius:5px;" +
        "padding:4px 7px;font:inherit;cursor:pointer;";
    });
    el.querySelector<HTMLButtonElement>('[data-cap="json"]')!.onclick = () =>
      this.downloadCaptureJson();
    el.querySelector<HTMLButtonElement>('[data-cap="audio"]')!.onclick = () =>
      this.downloadAudio();
    this.hudParent.appendChild(el);
    this.captureHud = el;
  }

  private updateCaptureHud() {
    if (!this.captureHud || !this.captureLog) return;
    const c = this.captureHud.querySelector<HTMLDivElement>('[data-cap="counts"]');
    if (c) {
      const pct = Math.round(this.perf * 100);
      c.textContent =
        `onsets ${this.captureLog.onsets.length} · ` +
        `notes ${this.captureLog.notes.length} · ` +
        `score ${this.captureLog.scores.length} · int ${pct}%`;
    }
  }

  private triggerDownload(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private downloadCaptureJson() {
    if (!this.captureLog) return;
    const base = this.fileName.replace(/\.[^.]+$/, "");
    this.triggerDownload(
      new Blob([JSON.stringify(this.captureLog, null, 2)], { type: "application/json" }),
      `eddie-capture-${base}.json`,
    );
  }

  private downloadAudio() {
    const base = this.fileName.replace(/\.[^.]+$/, "");
    if (this.fakeMicBuffer) {
      this.triggerDownload(audioBufferToWav(this.fakeMicBuffer), `eddie-input-${base}.wav`);
      return;
    }
    if (this.mediaRecorder) {
      const rec = this.mediaRecorder;
      const finish = () => {
        const type = rec.mimeType || "audio/webm";
        const ext = type.includes("ogg") ? "ogg" : "webm";
        this.triggerDownload(new Blob(this.recordedChunks, { type }), `eddie-input-${base}.${ext}`);
      };
      if (rec.state === "recording") {
        rec.onstop = finish;
        rec.stop();
      } else {
        finish();
      }
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

    this.captureLog?.scores.push({
      measure: ev.measure,
      beat: ev.beat,
      kinds: ev.kinds,
      points: ev.points,
      multiplier: ev.multiplier,
      audioTime: ev.audioTime,
    });

    // Record that this quarter scored (per-quarter events carry the "quarter"
    // kind; measure-level tag-clears don't). onBeat applies the +/-0.0315
    // intensity step at the quarter boundary using this flag.
    if (ev.points > 0 && ev.kinds.includes("quarter")) this.quarterScored = true;

    // Turn the scoring quarter's note bars green on the grid (per-note feedback).
    if (ev.points > 0 && ev.measure >= 0) {
      this.juice.emit("eddieNoteScored", { measure: ev.measure, beat: ev.beat });
    }

    // No points (out-of-key / silent) earns no shake or particles.
    if (ev.points <= 0) return;

    this.juice.emit("eddieShake", {
      magnitude: ev.multiplier * SHAKE_PER_MULTIPLIER,
      audioTime: ev.audioTime,
    });
    // Particles fly OUT of the note bars that earned the points: resolve their
    // on-screen centre from the grid for this scored quarter. Fall back to the
    // scorer's hint, then screen-centre, if the grid can't resolve it.
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
    // Route a calibration file through the real chain instead of the mic.
    if (this.fakeMicBuffer) this.tracker.prepareFakeMic(this.fakeMicBuffer);
    try {
      await this.tracker.start();
    } catch (err) {
      console.warn("[eddie] mic denied or unavailable — keyboard fallback only", err);
    }
    // Capture the live mic input so the exact audio that drove detection can be
    // downloaded for diagnosis (file source is downloaded from the buffer).
    if (this.capture && !this.fakeMicBuffer) this.startMicRecording();
    // Begin the count-in shortly after preroll so the player hears a couple of
    // metronome/drum beats first (mirrors LevelState's 600ms lead-in).
    setTimeout(() => {
      if (this.exited) return; // player navigated away during the lead-in
      this.conductor.triggerPlay();
      // Align the calibration file so its first note lands at scored measure 0.
      if (this.fakeMicBuffer) {
        const startAt = this.conductor.measureStartTime(0);
        if (this.captureLog) this.captureLog.playStartTime = startAt;
        this.tracker.startFakeMicPlayback(startAt);
      } else if (this.captureLog) {
        this.captureLog.playStartTime = this.conductor.measureStartTime(0);
      }
    }, 600);
  }

  private startMicRecording() {
    const stream = this.tracker.mediaStream;
    if (!stream || typeof MediaRecorder === "undefined") return;
    try {
      this.mediaRecorder = new MediaRecorder(stream);
      this.recordedChunks = [];
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.recordedChunks.push(e.data);
      };
      this.mediaRecorder.start();
    } catch (err) {
      console.warn("[eddie] mic recording unavailable", err);
    }
  }
}
