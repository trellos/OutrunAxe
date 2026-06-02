import type { Conductor, BeatInfo, Phase } from "../audio/Conductor";
import type { KeyResolver } from "./KeyResolver";
import type { PitchFiredEvent, KeysNarrowedEvent } from "./KeyResolver";
import { EventBus } from "../engine/EventBus";
import type { PitchClass } from "./keys";

export type ComboTag =
  | "rootStart"
  | "rootEnd"
  | "twoOctaveRun"
  | "tripletRepeat"
  | "sixteenthRepeat";

export interface MeasureComboResult {
  measureIdx: number;
  tags: ComboTag[];
  totalMultiplier: number;
  inferredRoot: PitchClass | null;
}

type ComboEvents = { measureCombo: MeasureComboResult };

interface BufferedNote {
  midi: number;
  pitchClass: PitchClass;
  audioTime: number;
  beat: number; // offset within measure, in beats (0..4)
}

const MAX_MULTIPLIER = 4.0;
const PER_TAG_BONUS = 0.5;
const BASE_MULTIPLIER = 1.0;

const TRIPLET_SUBS = [0, 1 / 3, 2 / 3] as const;
const SIXTEENTH_SUBS = [0, 0.25, 0.5, 0.75] as const;
const SUB_TOLERANCE = 0.25; // +/- 25% of beat duration

export class ComboScorer {
  readonly bus = new EventBus<ComboEvents>();

  private notes: BufferedNote[] = [];
  private activeMeasure = -1;
  private lastNarrowed: PitchClass[] = [];

  private offBeat?: () => boolean | void;
  private offPitch?: () => void;
  private offNarrow?: () => void;
  private offPhase?: () => boolean | void;

  constructor(private conductor: Conductor, private resolver: KeyResolver) {}

  attach(): void {
    this.offPitch = this.resolver.bus.on("pitchFired", (e: PitchFiredEvent) => {
      this.handlePitch(e);
    });

    this.offNarrow = this.resolver.bus.on("keysNarrowed", (e: KeysNarrowedEvent) => {
      this.lastNarrowed = e.remaining.slice();
    });

    this.offBeat = this.conductor.onBeat((info: BeatInfo) => {
      this.handleBeat(info);
    });

    this.offPhase = this.conductor.onPhaseChange((p: Phase) => {
      if (p === "done") {
        this.flushMeasure(this.activeMeasure);
        this.activeMeasure = -1;
        this.notes = [];
      }
    });
  }

  detach(): void {
    this.offPitch?.();
    this.offNarrow?.();
    this.offBeat?.();
    this.offPhase?.();
    this.offPitch = undefined;
    this.offNarrow = undefined;
    this.offBeat = undefined;
    this.offPhase = undefined;
    this.bus.clear();
  }

  private handlePitch(e: PitchFiredEvent): void {
    if (e.measureIdx < 0) return;
    if (this.activeMeasure === -1) {
      this.activeMeasure = e.measureIdx;
    }
    if (e.measureIdx !== this.activeMeasure) {
      // Stray note for a different measure; ignore.
      return;
    }
    const measureStart = this.conductor.measureStartTime(e.measureIdx);
    const bpm = this.conductor.currentBpm;
    const beatDur = 60 / bpm;
    const beat = (e.audioTime - measureStart) / beatDur;
    this.notes.push({
      midi: e.midi,
      pitchClass: e.pitchClass,
      audioTime: e.audioTime,
      beat,
    });
  }

  private handleBeat(info: BeatInfo): void {
    if (info.phase !== "playing") return;
    if (info.beatInPhase !== 0) return;
    const newMeasure = info.measureInPlay;
    if (newMeasure === this.activeMeasure) return;
    if (this.activeMeasure >= 0) {
      this.flushMeasure(this.activeMeasure);
    }
    this.activeMeasure = newMeasure;
    this.notes = [];
  }

  private flushMeasure(measureIdx: number): void {
    if (measureIdx < 0) return;
    const notes = this.notes.slice();
    const root = this.inferRoot(notes);
    const tags = this.detectTags(notes, root);
    const totalMultiplier = Math.min(
      MAX_MULTIPLIER,
      BASE_MULTIPLIER + PER_TAG_BONUS * tags.length,
    );
    this.bus.emit("measureCombo", {
      measureIdx,
      tags,
      totalMultiplier,
      inferredRoot: root,
    });
  }

  private inferRoot(notes: BufferedNote[]): PitchClass | null {
    const candidates = this.lastNarrowed;
    if (candidates.length === 1) return candidates[0];
    if (candidates.length === 0) return null;
    if (notes.length === 0) return null;

    const candidateSet = new Set(candidates);
    const last = notes[notes.length - 1].pitchClass;
    if (candidateSet.has(last)) return last;
    const first = notes[0].pitchClass;
    if (candidateSet.has(first)) return first;

    const counts = new Map<PitchClass, number>();
    for (const n of notes) {
      counts.set(n.pitchClass, (counts.get(n.pitchClass) ?? 0) + 1);
    }
    let best: PitchClass | null = null;
    let bestCount = -1;
    for (const c of candidates) {
      const k = counts.get(c) ?? 0;
      if (k > bestCount) {
        bestCount = k;
        best = c;
      }
    }
    if (best !== null && bestCount > 0) return best;
    return null;
  }

  private detectTags(notes: BufferedNote[], root: PitchClass | null): ComboTag[] {
    const tags: ComboTag[] = [];
    if (notes.length === 0) return tags;

    if (root !== null) {
      if (notes[0].pitchClass === root) tags.push("rootStart");
      if (notes[notes.length - 1].pitchClass === root) tags.push("rootEnd");
      if (this.hasTwoOctaveRun(notes, root)) tags.push("twoOctaveRun");
    }

    if (this.hasRepeatedSubdivision(notes, TRIPLET_SUBS)) {
      tags.push("tripletRepeat");
    }
    if (this.hasRepeatedSubdivision(notes, SIXTEENTH_SUBS)) {
      tags.push("sixteenthRepeat");
    }

    return tags;
  }

  private hasTwoOctaveRun(notes: BufferedNote[], root: PitchClass): boolean {
    if (notes.length < 8) return false;
    const ordered = notes.slice().sort((a, b) => a.audioTime - b.audioTime);
    return (
      this.directedRun(ordered, root, 1) || this.directedRun(ordered, root, -1)
    );
  }

  private directedRun(
    notes: BufferedNote[],
    root: PitchClass,
    direction: 1 | -1,
  ): boolean {
    const n = notes.length;
    // LIS variant: longest monotonic-by-midi subsequence in time order whose
    // endpoints are root-pitch-class and which spans >= 24 semitones with
    // length >= 8.
    // dp[i] = best chain ending at i that STARTS with a root note: { len, startMidi }
    const dp: Array<{ len: number; startMidi: number } | null> = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      const ni = notes[i];
      if (ni.pitchClass === root) {
        dp[i] = { len: 1, startMidi: ni.midi };
      }
      for (let j = 0; j < i; j++) {
        const nj = notes[j];
        if (!dp[j]) continue;
        const diff = (ni.midi - nj.midi) * direction;
        if (diff <= 0) continue;
        const candLen = dp[j]!.len + 1;
        if (!dp[i] || candLen > dp[i]!.len) {
          dp[i] = { len: candLen, startMidi: dp[j]!.startMidi };
        }
      }
      if (dp[i] && ni.pitchClass === root) {
        const span = Math.abs(ni.midi - dp[i]!.startMidi);
        if (dp[i]!.len >= 8 && span >= 24) return true;
      }
    }
    return false;
  }

  private hasRepeatedSubdivision(
    notes: BufferedNote[],
    subs: readonly number[],
  ): boolean {
    const perBeat: BufferedNote[][] = [[], [], [], []];
    for (const note of notes) {
      if (note.beat < 0 || note.beat >= 4) continue;
      const idx = Math.floor(note.beat);
      perBeat[idx].push(note);
    }

    const patterns: PitchClass[][] = [];
    for (let b = 0; b < 4; b++) {
      const beatNotes = perBeat[b].slice().sort((a, b) => a.audioTime - b.audioTime);
      const pattern = this.matchSubdivision(beatNotes, b, subs);
      if (!pattern) return false;
      patterns.push(pattern);
    }

    const ref = patterns[0];
    for (let i = 1; i < patterns.length; i++) {
      const p = patterns[i];
      if (p.length !== ref.length) return false;
      for (let k = 0; k < ref.length; k++) {
        if (p[k] !== ref[k]) return false;
      }
    }
    return true;
  }

  private matchSubdivision(
    beatNotes: BufferedNote[],
    beatIdx: number,
    subs: readonly number[],
  ): PitchClass[] | null {
    if (beatNotes.length < subs.length) return null;
    const out: PitchClass[] = [];
    for (const sub of subs) {
      const target = beatIdx + sub;
      let bestNote: BufferedNote | null = null;
      let bestDist = Infinity;
      for (const n of beatNotes) {
        const dist = Math.abs(n.beat - target);
        if (dist < bestDist) {
          bestDist = dist;
          bestNote = n;
        }
      }
      if (!bestNote || bestDist > SUB_TOLERANCE) return null;
      out.push(bestNote.pitchClass);
    }
    return out;
  }
}
