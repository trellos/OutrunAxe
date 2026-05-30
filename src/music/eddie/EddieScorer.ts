// Per-quarter-note scorer for Infinite Eddie (GDD §6.3).
//
// Pure, testable: fed three things — the played-note stream (KeyResolver's
// `pitchFired`, the SAME event combat uses), the bassline/config, and the
// Conductor's `onBeat` events for measure/quarter boundaries. It evaluates
// EACH quarter note at the START of the next quarter (so the just-completed
// quarter is fully observed) and emits an `eddieScore` event plus a running
// `eddieTotal`.
//
// Timing discipline (AGENTS.md / GDD §2): all "when" decisions come from
// Conductor beat events and audioTime. The scorer never reads rAF.

import type { Conductor, BeatInfo } from "../../audio/Conductor";
import type { KeyResolver, PitchFiredEvent } from "../KeyResolver";
import { keyPitchClasses, type PitchClass } from "../keys";
import { EventBus } from "../../engine/EventBus";
import type {
  EddieConfig,
  EddieScoreEvent,
  EddieScoreKind,
  EddieScorerEvents,
} from "./eddieTypes";

// ---------------------------------------------------------------------------
// Scoring constants (GDD §6.3 / §9). Tuned so the §9 invariants hold:
//   - all-roots (E E E E ×16) totals LOW (baseline only, no variation/subdiv);
//   - 8ths beat the same notes as quarters; 16ths beat 8ths;
//   - chord-tone ending adds a bonus; out-of-key scores 0;
//   - tagged-measure clears emit their bonus events.
// ---------------------------------------------------------------------------

/** Base points for a single in-key quarter note. */
const BASE_POINTS = 10;
/** Bonus when the quarter's pitch differs from the previous quarter's pitch. */
const VARIATION_BONUS = 6;
/** Bonus when the quarter contained an 8th-note subdivision (2 notes). */
const EIGHTH_BONUS = 12;
/** Bonus when the quarter contained a 16th-note subdivision (>=3 notes). */
const SIXTEENTH_BONUS = 24;
/** Bonus when the quarter ENDS on a chord tone of the active bass chord. */
const CHORD_TONE_BONUS = 14;
/** Measure-level bonus for clearing the 8th-tagged measure (all 4 quarters 8ths). */
const EIGHTH_TAG_CLEAR_BONUS = 80;
/** Measure-level bonus for clearing the 16th-tagged measure (all 4 quarters 16ths). */
const SIXTEENTH_TAG_CLEAR_BONUS = 160;

/** Minimum notes in a quarter to count it as an 8th-note subdivision. */
const EIGHTH_MIN_NOTES = 2;
/** Minimum notes in a quarter to count it as a 16th-note subdivision. */
const SIXTEENTH_MIN_NOTES = 3;

const SCORED_MEASURES = 16;
const QUARTERS_PER_MEASURE = 4;

/** One quarter-note window's accumulated state. */
interface QuarterState {
  measure: number; // scored measure 0..15
  beat: number; // quarter index within measure 0..3
  startTime: number; // audio time the quarter opened (beat event time)
  /** Pitch classes played in this quarter, in arrival order. */
  notes: PitchClass[];
}

export class EddieScorer {
  readonly bus = new EventBus<EddieScorerEvents>();

  private readonly inKey: Set<PitchClass>;
  private offBeat?: () => void;
  private offPitch?: () => void;
  private offPhase?: () => void;

  private runningTotal = 0;
  /** The quarter currently accumulating notes (scored at the next quarter). */
  private current: QuarterState | null = null;
  /** Pitch class that ended the previous scored quarter (for variation bonus). */
  private prevQuarterEndPitch: PitchClass | null = null;
  /** Per-quarter subdivision kind for the measure in progress, indexed by beat.
   *  Used at the measure boundary to detect tagged-measure clears. */
  private measureSubdivisions: (EddieScoreKind | null)[] = new Array(QUARTERS_PER_MEASURE).fill(null);
  private measureOfSubdivisions = -1;

  constructor(
    private conductor: Conductor,
    private resolver: KeyResolver,
    private config: EddieConfig,
  ) {
    this.inKey = keyPitchClasses(config.keyRoot, config.keyMode);
  }

  attach(): void {
    this.offBeat = this.conductor.onBeat((info) => this.onBeat(info));
    this.offPitch = this.resolver.bus.on("pitchFired", (ev) => this.onPitch(ev));
    this.offPhase = this.conductor.onPhaseChange((p) => {
      if (p === "done") this.flushFinal();
    });
  }

  detach(): void {
    this.offBeat?.();
    this.offPitch?.();
    this.offPhase?.();
    // Finalize nothing on detach — a torn-down state should leave no trailing
    // events. Clear the bus so subscribers are released.
    this.current = null;
    this.bus.clear();
  }

  get total(): number {
    return this.runningTotal;
  }

  /**
   * A beat fired. During `playing`, every beat marks the ONSET of a new quarter
   * note: first finalize+score the quarter that just ended, then open the new
   * one. Measure boundaries also evaluate tagged-measure clears.
   */
  private onBeat(info: BeatInfo): void {
    if (info.phase !== "playing") return;
    if (info.measureInPlay < 0 || info.measureInPlay >= SCORED_MEASURES) return;

    // The just-ended quarter (if any) is now fully observed — score it.
    if (this.current) {
      this.scoreQuarter(this.current, info.time);
    }

    // If we just crossed a measure boundary, evaluate the completed measure's
    // tagged-clear bonus before resetting subdivision tracking for the new bar.
    if (this.measureOfSubdivisions >= 0 && this.measureOfSubdivisions !== info.measureInPlay) {
      this.evaluateTagClear(this.measureOfSubdivisions, info.time);
    }
    if (this.measureOfSubdivisions !== info.measureInPlay) {
      this.measureSubdivisions = new Array(QUARTERS_PER_MEASURE).fill(null);
      this.measureOfSubdivisions = info.measureInPlay;
    }

    // Open the new quarter window.
    this.current = {
      measure: info.measureInPlay,
      beat: info.beatInPhase,
      startTime: info.time,
      notes: [],
    };
  }

  /**
   * The play window ended. The last quarter (and last measure's tag-clear)
   * never get a following beat to finalize them, so flush them at `done`.
   */
  private flushFinal(): void {
    const atTime = this.conductor.audioTime;
    if (this.current) {
      this.scoreQuarter(this.current, atTime);
      this.current = null;
    }
    if (this.measureOfSubdivisions >= 0) {
      this.evaluateTagClear(this.measureOfSubdivisions, atTime);
      this.measureOfSubdivisions = -1;
    }
  }

  /** A note fired — bucket it into the currently-open quarter. */
  private onPitch(ev: PitchFiredEvent): void {
    if (!this.current) return;
    this.current.notes.push(ev.pitchClass);
  }

  /**
   * Score a fully-observed quarter and emit `eddieScore` + `eddieTotal`.
   * @param q       the quarter to score
   * @param atTime  audio time of the scoring (onset of the next quarter)
   */
  private scoreQuarter(q: QuarterState, atTime: number): void {
    const kinds: EddieScoreKind[] = [];
    let points = 0;

    const lastPitch = q.notes.length > 0 ? q.notes[q.notes.length - 1] : null;
    const anyOutOfKey = q.notes.some((p) => !this.inKey.has(p));

    if (q.notes.length === 0) {
      // Silent quarter: nothing to score, nothing to emit. It still breaks the
      // subdivision streak so a tagged measure with a gap can't clear.
      this.measureSubdivisions[q.beat] = null;
      this.prevQuarterEndPitch = null;
      return;
    }

    if (anyOutOfKey) {
      // In-key gate: an out-of-key quarter scores 0 but is still emitted for
      // feedback. It also breaks the variation/subdivision context.
      this.measureSubdivisions[q.beat] = null;
      this.prevQuarterEndPitch = lastPitch;
      this.emitScore({
        points: 0,
        multiplier: 1,
        measure: q.measure,
        beat: q.beat,
        kinds: ["outOfKey"],
        audioTime: atTime,
      });
      return;
    }

    // Baseline: a single in-key quarter note.
    kinds.push("quarter");
    points += BASE_POINTS;

    // Variation: reward melodic movement vs. the previous quarter's last pitch.
    if (this.prevQuarterEndPitch !== null && lastPitch !== this.prevQuarterEndPitch) {
      points += VARIATION_BONUS;
    }

    // Subdivision bonus (and record the kind for tag-clear detection).
    let subdivision: EddieScoreKind | null = null;
    if (q.notes.length >= SIXTEENTH_MIN_NOTES) {
      kinds.push("sixteenth");
      points += SIXTEENTH_BONUS;
      subdivision = "sixteenth";
    } else if (q.notes.length >= EIGHTH_MIN_NOTES) {
      kinds.push("eighth");
      points += EIGHTH_BONUS;
      subdivision = "eighth";
    }
    this.measureSubdivisions[q.beat] = subdivision;

    // Chord-tone bonus: did the quarter END on a chord tone of the active bass
    // chord for this measure?
    const chordTones = this.activeChordTones(q.measure);
    if (lastPitch !== null && chordTones.includes(lastPitch)) {
      kinds.push("chordTone");
      points += CHORD_TONE_BONUS;
    }

    // Multiplier scales with how many bonus kinds stacked beyond the baseline
    // "quarter" tag. Art reads this to size shake/bg effects.
    const multiplier = kinds.length;

    this.prevQuarterEndPitch = lastPitch;
    this.emitScore({
      points,
      multiplier,
      measure: q.measure,
      beat: q.beat,
      kinds,
      audioTime: atTime,
    });
  }

  /**
   * At a measure boundary, check whether the just-completed measure was a
   * tagged 8th/16th challenge cleared by playing EVERY quarter at that
   * subdivision. Emits the measure-level clear bonus if so.
   */
  private evaluateTagClear(measure: number, atTime: number): void {
    const subs = this.measureSubdivisions;
    const allAre = (kind: EddieScoreKind) =>
      subs.length === QUARTERS_PER_MEASURE && subs.every((s) => s === kind);

    if (measure === this.config.eighthTagMeasure && allAre("eighth")) {
      this.runningTotal += EIGHTH_TAG_CLEAR_BONUS;
      this.bus.emit("eddieScore", {
        points: EIGHTH_TAG_CLEAR_BONUS,
        multiplier: QUARTERS_PER_MEASURE,
        measure,
        beat: QUARTERS_PER_MEASURE - 1,
        kinds: ["eighthTagClear"],
        originHint: null,
        audioTime: atTime,
      });
      this.bus.emit("eddieTotal", {
        total: this.runningTotal,
        lastDelta: EIGHTH_TAG_CLEAR_BONUS,
        audioTime: atTime,
      });
    }

    if (measure === this.config.sixteenthTagMeasure && allAre("sixteenth")) {
      this.runningTotal += SIXTEENTH_TAG_CLEAR_BONUS;
      this.bus.emit("eddieScore", {
        points: SIXTEENTH_TAG_CLEAR_BONUS,
        multiplier: QUARTERS_PER_MEASURE,
        measure,
        beat: QUARTERS_PER_MEASURE - 1,
        kinds: ["sixteenthTagClear"],
        originHint: null,
        audioTime: atTime,
      });
      this.bus.emit("eddieTotal", {
        total: this.runningTotal,
        lastDelta: SIXTEENTH_TAG_CLEAR_BONUS,
        audioTime: atTime,
      });
    }
  }

  /** Chord tones active for `measure` — the bassline loops every 4 measures,
   *  and the FIRST note (beat 0) of each bassline measure defines the chord. */
  private activeChordTones(measure: number): PitchClass[] {
    const bassMeasure = ((measure % 4) + 4) % 4;
    const downbeat = this.config.bassline.find(
      (n) => n.measure === bassMeasure && n.beat === 0,
    );
    return downbeat ? downbeat.chordTones : [];
  }

  private emitScore(ev: Omit<EddieScoreEvent, "originHint">): void {
    this.runningTotal += ev.points;
    this.bus.emit("eddieScore", { ...ev, originHint: null });
    this.bus.emit("eddieTotal", {
      total: this.runningTotal,
      lastDelta: ev.points,
      audioTime: ev.audioTime,
    });
  }
}
