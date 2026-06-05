// EddiePitchTimeline — shared pitch-note timeline rendering for all Eddie surfaces.
//
// Consolidates lane mapping, note coloring, chord-tone tinting, and scoring
// overlays. Used by both the main gameplay grid (per cell) and the settings
// preview timeline (rolling 1-measure window). Handles canvas rendering only;
// DOM variants can wrap this with their own element creation.

import { NOTE_NAMES } from "../../audio/midi";
import type { PitchClass, EddieConfig } from "../../music/eddie/eddieTypes";
import {
  COLOR_CHORD_TINT_DARK,
  COLOR_CHORD_TINT_MEDIUM,
  diamondColor,
  diamondTile,
  noteColor,
  subdivisionCount,
  timingQuality,
} from "./eddieFeedback";

/** Configuration for a pitch timeline instance. */
export interface EddiePitchTimelineConfig {
  keyRoot: PitchClass;
  bassline: EddieConfig["bassline"];
  bpm: number;
  // Canvas geometry
  beatDuration?: number; // time in seconds per beat (computed from bpm if omitted)
  pixelsPerBeat?: number;
  laneHeight?: number;
  lanePadding?: number;
  pitchLanes?: number; // 12 or 13
}

/** Shared timeline renderer for both in-game and settings contexts. */
export class EddiePitchTimeline {
  private keyRoot: string;
  private bassline: EddieConfig["bassline"];

  // Lane mapping: pitch class → lane index (key-relative)
  private pitchClassToLane = new Map<string, number>();
  // Chord tones per measure: pitch classes and lanes
  private chordTonePcsByMeasure = new Map<number, PitchClass[]>();
  private chordToneLanesByMeasure = new Map<number, number[]>();

  // Canvas geometry
  readonly beatDuration: number;
  readonly pixelsPerBeat: number;
  readonly laneHeight: number;
  readonly lanePadding: number;
  readonly pitchLanes: number;
  readonly totalHeight: number;

  // Tint opacity: visible but not overwhelming
  readonly tintOpacityRoot = 0.4;
  readonly tintOpacityChord = 0.25;

  constructor(config: EddiePitchTimelineConfig) {
    this.keyRoot = config.keyRoot;
    this.bassline = config.bassline;

    // Geometry
    this.beatDuration = config.beatDuration ?? 60 / config.bpm;
    this.pixelsPerBeat = config.pixelsPerBeat ?? 120;
    this.laneHeight = config.laneHeight ?? 7;
    this.lanePadding = config.lanePadding ?? 4;
    this.pitchLanes = config.pitchLanes ?? 12;
    this.totalHeight = this.pitchLanes * this.laneHeight + 2 * this.lanePadding;

    // Initialize key-relative lane mapping and chord tones
    this.initializePitchClassLanes();
    this.computeChordTones();
  }

  /** Map pitch class → lane (0 = key root, 1..11 = semitones, 12 = octave+1). */
  private initializePitchClassLanes(): void {
    const keyRootIndex = NOTE_NAMES.indexOf(this.keyRoot as any);
    this.pitchClassToLane.clear();
    for (let i = 0; i < 12; i++) {
      const pitchClass = NOTE_NAMES[(keyRootIndex + i) % 12];
      this.pitchClassToLane.set(pitchClass, i);
    }
    // Octave+1 mapping (if we have lane 12)
    if (this.pitchLanes > 12) {
      this.pitchClassToLane.set(this.keyRoot, 12);
    }
  }

  /** Pre-compute chord tones for each measure. */
  private computeChordTones(): void {
    this.chordTonePcsByMeasure.clear();
    this.chordToneLanesByMeasure.clear();

    const chordRootByPatternMeasure = new Map<number, string>();
    for (const n of this.bassline) {
      if (n.beat === 0 && !chordRootByPatternMeasure.has(n.measure)) {
        chordRootByPatternMeasure.set(n.measure, n.pitchClass);
        const rootLane = this.pitchClassToLane.get(n.pitchClass) ?? 0;
        const chordToneLanes = [rootLane];
        const chordTonePcs: PitchClass[] = [n.pitchClass];
        for (const pc of n.chordTones) {
          const lane = this.pitchClassToLane.get(pc) ?? 0;
          if (!chordToneLanes.includes(lane)) chordToneLanes.push(lane);
          if (!chordTonePcs.includes(pc)) chordTonePcs.push(pc);
        }
        // Store for the pattern measure and all its repetitions
        for (let m = n.measure; m < 20; m += 4) {
          this.chordToneLanesByMeasure.set(m, chordToneLanes);
          this.chordTonePcsByMeasure.set(m, chordTonePcs);
        }
      }
    }
  }

  /** Get Y coordinate for a MIDI pitch. */
  laneY(midi: number): number {
    const pc = NOTE_NAMES[((midi % 12) + 12) % 12];
    const lane = this.pitchClassToLane.get(pc) ?? 0;
    return Math.round(
      this.totalHeight - this.lanePadding - lane * this.laneHeight - this.laneHeight / 2
    );
  }

  /** Get chord tones for a measure. */
  getChordTones(
    measureInLoop: number
  ): { pitchClasses: PitchClass[]; lanes: number[] } {
    const pcs = this.chordTonePcsByMeasure.get(measureInLoop) ?? [];
    const lanes = this.chordToneLanesByMeasure.get(measureInLoop) ?? [];
    return { pitchClasses: pcs, lanes };
  }

  /** Get note color for a MIDI pitch given measure and in-key status. */
  getNoteColor(midi: number, measureInLoop: number, inKey: boolean): string {
    const chord = this.chordTonePcsByMeasure.get(measureInLoop) ?? null;
    return noteColor(midi, this.keyRoot, chord, inKey);
  }

  /** Draw chord-tone lane tints for a measure. */
  drawChordTints(
    ctx: CanvasRenderingContext2D,
    measureInLoop: number,
    canvasWidth: number
  ): void {
    const { pitchClasses } = this.getChordTones(measureInLoop);
    for (const chordTone of pitchClasses) {
      const lane = this.pitchClassToLane.get(chordTone) ?? 0;
      const isRoot = chordTone === this.keyRoot;
      const alpha = isRoot ? this.tintOpacityRoot : this.tintOpacityChord;
      const color = isRoot ? COLOR_CHORD_TINT_DARK : COLOR_CHORD_TINT_MEDIUM;

      const y = this.totalHeight - this.lanePadding - lane * this.laneHeight - this.laneHeight / 2;
      const rgb = this.hexToRgb(color);
      ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
      ctx.fillRect(0, y - this.laneHeight / 2, canvasWidth, this.laneHeight);
    }
  }

  /** Draw diamond scoring overlay for a quarter region. */
  drawQuarterDiamonds(
    ctx: CanvasRenderingContext2D,
    x0: number,
    y0: number,
    height: number,
    subdiv: number,
    quality: number
  ): void {
    const quarterW = this.pixelsPerBeat;
    const { tileW, tileH } = diamondTile(quarterW, subdiv);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, quarterW, height);
    ctx.clip();
    ctx.fillStyle = diamondColor(quality);
    const rows = Math.ceil(height / tileH) + 1;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < subdiv; i++) {
        const cx = x0 + i * tileW + tileW / 2;
        const cy = y0 + j * tileH + tileH / 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy - tileH / 2);
        ctx.lineTo(cx + tileW / 2, cy);
        ctx.lineTo(cx, cy + tileH / 2);
        ctx.lineTo(cx - tileW / 2, cy);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /** Convert hex color to RGB object. */
  private hexToRgb(hex: string): { r: number; g: number; b: number } {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return { r: 0, g: 0, b: 0 };
    return {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16),
    };
  }

  /** Convert hex to rgba string. */
  hexToRgba(hex: string, alpha: number): string {
    const rgb = this.hexToRgb(hex);
    return `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
  }

  /** Lighten a hex color by factor. */
  lightenColor(hex: string, factor: number): string {
    const rgb = this.hexToRgb(hex);
    const r = Math.min(255, Math.round(rgb.r * factor));
    const g = Math.min(255, Math.round(rgb.g * factor));
    const b = Math.min(255, Math.round(rgb.b * factor));
    return `rgb(${r},${g},${b})`;
  }

  /** Grade timing quality for a beat position. */
  getTimingQuality(beatPos: number): number {
    return timingQuality(beatPos - Math.floor(beatPos));
  }

  /** Subdivision count from note count. */
  getSubdivisionCount(noteCount: number): number {
    return subdivisionCount(noteCount);
  }
}
