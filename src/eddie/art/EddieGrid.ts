// EddieGrid — the 5-row x 4-measure timeline grid (GDD §8, §13).
//
// 20 cells: row 0 = 4 intro/warm-up measures (visually DEPRIORITIZED), rows 1-4
// = the 16 scored measures (scored measure index = (row-1)*4 + col). The active
// (currently-recording) cell is highlighted unmistakably. The 8th- and 16th-note
// tag badges are rendered from config.eighthTagMeasure / sixteenthTagMeasure; the
// 16th tag is an obvious visual UPGRADE over the 8th tag. Bass-note labels sit
// above the measure where each chord starts (config.bassline).
//
// HARD RULE (AGENTS.md Infinite Eddie #1): each cell is a NOTE TIMELINE, not a
// label. The notes the player plays are plotted INSIDE the cell (x = position in
// the measure, y = pitch) via the eddieNote juice event. Each cell now contains
// 13 horizontal pitch-class lanes (the key's octave, folded by semitone class).
// Chord tones (root, 3rd, 5th) get subtle background darkening.
//
// VARIANT option-1: "chunky neon-bordered cells" — solid DOM cells with thick
// neon borders, the active cell lifting + glowing magenta. Pure DOM/CSS so
// dispose() simply removes the root (zero Three.js resources).

import type { EventBus } from "../../engine/EventBus";
import type { EddieConfig, EddieJuiceEvents } from "../../music/eddie/eddieTypes";
import { NOTE_NAMES } from "../../audio/midi";

const ROWS = 5;
const COLS = 4;
const PITCH_LANES = 13; // 0..12: key root to octave+1

// Color palette
const COLOR_ROOT = "#FFC837"; // Bright gold
const COLOR_STRONG = "#FF6B9D"; // Hot pink (3rd/5th)
const COLOR_WEAK = "#FFB84D"; // Warm orange
const COLOR_BOGUS = "#ff5a6e"; // Red/pink (out-of-key)

export class EddieGrid {
  private root: HTMLDivElement | null = null;
  private cells: HTMLDivElement[] = []; // 20 cells, row-major (row*COLS + col)
  private noteLayers: HTMLDivElement[] = []; // per-cell note-plot layer
  private activeScored = -1;
  private offBeat?: () => void;
  private offNote?: () => void;
  private offNoteEnd?: () => void;
  private offScored?: () => void;
  /** onset id → its plotted note bar, so a later eddieNoteEnd can grow it. */
  private noteBars = new Map<number, { el: HTMLDivElement; startFrac: number }>();
  // Pulse phase for a subtle per-beat breathing of the active cell border.
  private pulse = 0;

  // Configuration
  private keyRoot: string = "C";
  private pitchClassToLane = new Map<string, number>();
  // Per-measure chord tones: measure index → [root lane, 3rd lane, 5th lane]
  private chordTonesByMeasure = new Map<number, number[]>();

  mount(ctx: {
    hudParent: HTMLElement;
    config: EddieConfig;
    juice: EventBus<EddieJuiceEvents>;
  }): void {
    const root = document.createElement("div");
    root.className = "eddie-grid";

    // Initialize key and pitch-class → lane mapping
    this.keyRoot = ctx.config.keyRoot;
    this.initializePitchClassLanes();

    // Pre-compute chord tone lanes for each measure (used for darkening)
    // The bassline loops every 4 measures, so pattern measure m % 4 applies to measure m
    const chordRootByPatternMeasure = new Map<number, string>();
    for (const n of ctx.config.bassline) {
      if (n.beat === 0 && !chordRootByPatternMeasure.has(n.measure)) {
        chordRootByPatternMeasure.set(n.measure, n.pitchClass);
        // Store the chord tones (root, 3rd, 5th) as lane numbers
        const rootLane = this.pitchClassToLane.get(n.pitchClass) ?? 0;
        const chordToneLanes = [rootLane];
        for (const pc of n.chordTones) {
          const lane = this.pitchClassToLane.get(pc) ?? 0;
          if (!chordToneLanes.includes(lane)) {
            chordToneLanes.push(lane);
          }
        }
        // Store for measures 0..15 and also loop back to 16..19 (intro would not use this)
        for (let m = n.measure; m < 20; m += 4) {
          this.chordTonesByMeasure.set(m, chordToneLanes);
        }
      }
    }

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const cell = document.createElement("div");
        cell.className = "eddie-cell";
        // The cell body hosts the note plot, so it must be a positioning context.
        cell.style.position = "relative";
        const isIntro = row === 0;
        if (isIntro) cell.classList.add("eddie-cell-intro");

        // Subdivision level for this cell's gridlines: quarters everywhere, plus
        // eighths in the 8th-tagged measure and sixteenths in the 16th-tagged one.
        let subdivision: 4 | 8 | 16 = 4;
        if (!isIntro) {
          const scored = (row - 1) * COLS + col;

          // Bass label above measures that start a chord span.
          const rootPc = chordRootByPatternMeasure.get(scored % 4);
          if (rootPc) {
            const bass = document.createElement("div");
            bass.className = "eddie-cell-bass";
            bass.textContent = rootPc;
            cell.appendChild(bass);
          }

          // Tag badges.
          if (scored === ctx.config.eighthTagMeasure) {
            subdivision = 8;
            const tag = document.createElement("div");
            tag.className = "eddie-tag eddie-tag-eighth";
            tag.textContent = "8TH";
            cell.appendChild(tag);
          }
          if (scored === ctx.config.sixteenthTagMeasure) {
            subdivision = 16;
            const tag = document.createElement("div");
            tag.className = "eddie-tag eddie-tag-sixteenth";
            tag.textContent = "16TH!";
            cell.appendChild(tag);
          }
        }

        // The note-plot layer: where played notes are drawn (see plotNote).
        const notes = document.createElement("div");
        notes.className = "eddie-cell-notes";
        notes.style.cssText =
          "position:absolute;inset:0;overflow:hidden;pointer-events:none;";
        this.buildGridlines(notes, subdivision);
        cell.appendChild(notes);
        this.noteLayers.push(notes);

        root.appendChild(cell);
        this.cells.push(cell);
      }
    }

    ctx.hudParent.appendChild(root);
    this.root = root;

    // Beat pulse drives the active-cell breathing.
    this.offBeat = ctx.juice.on("eddieBeatPulse", () => {
      this.pulse = 1;
    });

    // Played notes are plotted into their measure cell — the whole point of the
    // grid is to visualize what the player played across the timeline.
    this.offNote = ctx.juice.on("eddieNote", (n) => this.plotNote(n));
    this.offNoteEnd = ctx.juice.on("eddieNoteEnd", (e) => this.endNote(e));
    this.offScored = ctx.juice.on("eddieNoteScored", (s) => this.greenQuarter(s.measure, s.beat));
  }

  /** Draw the beat/subdivision gridlines for a cell. Quarter lines are bold;
   *  eighth/sixteenth lines (in the tagged measures) are progressively fainter
   *  so the quarter grid still reads clearly underneath the finer divisions. */
  private buildGridlines(layer: HTMLDivElement, subdivision: 4 | 8 | 16): void {
    for (let i = 1; i < subdivision; i++) {
      const isQuarter = (i * 4) % subdivision === 0;
      const isEighth = !isQuarter && (i * 8) % subdivision === 0;
      const line = document.createElement("div");
      const color = isQuarter
        ? "rgba(120,230,255,0.55)" // bold quarter divisions
        : isEighth
          ? "rgba(255,255,255,0.26)" // eighth subdivisions
          : "rgba(255,255,255,0.14)"; // sixteenth subdivisions
      const width = isQuarter ? 2 : 1;
      line.style.cssText =
        `position:absolute;top:6%;bottom:6%;left:${((i / subdivision) * 100).toFixed(2)}%;` +
        `width:${width}px;margin-left:${-width / 2}px;background:${color};`;
      layer.appendChild(line);
    }
  }

  /** Initialize pitch-class → lane mapping for the current key. */
  private initializePitchClassLanes(): void {
    const keyRootIndex = NOTE_NAMES.indexOf(this.keyRoot as any);
    this.pitchClassToLane.clear();
    for (let i = 0; i < 12; i++) {
      const pitchClass = NOTE_NAMES[(keyRootIndex + i) % 12];
      // Lane 0 = root, lanes 1..11 = next 11 semitones, lane 12 = octave+1
      // But display as 0..12 where 12 is the top (key root again)
      this.pitchClassToLane.set(pitchClass, i);
    }
    // Add octave+1 mapping (same pitch class as root)
    this.pitchClassToLane.set(this.keyRoot, PITCH_LANES - 1);
  }

  /** Plot OR update a note bar. Called first at the onset (provisional pitch, so
   *  every played note shows immediately — fast notes that never settle a pitch
   *  still appear), then again as the pitch resolves to set the lane + color.
   *  Idempotent per onsetId so the second call updates rather than duplicates. */
  private plotNote(n: EddieJuiceEvents["eddieNote"]): void {
    const idx = this.indexFor(n.measure);
    const layer = idx >= 0 ? this.noteLayers[idx] : null;
    if (!layer) return;

    const x = Math.max(0, Math.min(1, n.beatFraction));
    // Map MIDI to pitch-class lane (fold into 0..12)
    const pitchClass = NOTE_NAMES[((n.midi % 12) + 12) % 12];
    const lane = this.pitchClassToLane.get(pitchClass) ?? 0;
    const y = 1 - (lane / (PITCH_LANES - 1)); // 0 = top (lane 0), 1 = bottom (lane 12)
    const color = this.getNoteColor(n);

    const existing = n.onsetId >= 0 ? this.noteBars.get(n.onsetId) : undefined;
    if (existing) {
      // Pitch resolved/changed — move to the right lane + recolor. Don't touch a
      // bar that already scored green.
      const bar = existing.el;
      if (!bar.classList.contains("eddie-note-scored")) {
        bar.style.top = `${(y * 84 + 8).toFixed(1)}%`;
        bar.style.background = color;
        bar.style.boxShadow = `0 0 7px ${color},0 0 2px #fff`;
        bar.classList.toggle("eddie-note-off", !n.inKey);
      }
      return;
    }

    // A note is a horizontal duration BAR (onset → detected end via endNote).
    const bar = document.createElement("div");
    bar.className = "eddie-note" + (n.inKey ? "" : " eddie-note-off");
    bar.style.cssText =
      `position:absolute;left:${(x * 100).toFixed(2)}%;top:${(y * 84 + 8).toFixed(1)}%;` +
      "height:5px;margin-top:-2.5px;min-width:4px;width:4px;border-radius:3px;" +
      `background:${color};box-shadow:0 0 7px ${color},0 0 2px #fff;` +
      "opacity:0;transition:opacity .12s ease,width .08s linear;";
    // Tag the quarter (0..3) this note lands in, so a later score event can turn
    // the scoring quarter's bars green.
    bar.dataset.beat = String(Math.min(3, Math.floor(x * 4)));
    layer.appendChild(bar);
    if (n.onsetId >= 0) this.noteBars.set(n.onsetId, { el: bar, startFrac: x });
    // Fade in on next frame for a soft pop as each note lands.
    requestAnimationFrame(() => {
      bar.style.opacity = "1";
    });
  }

  /** Grow a plotted note's bar to its detected end (within the start cell). The
   *  bar entry is KEPT (not deleted) so a late pitch update can still find it
   *  instead of spawning a duplicate. */
  private endNote(e: EddieJuiceEvents["eddieNoteEnd"]): void {
    const entry = this.noteBars.get(e.onsetId);
    if (!entry) return;
    const endFrac = Math.max(0, Math.min(1, e.endBeatFraction));
    const widthPct = Math.max(0, (endFrac - entry.startFrac) * 100);
    // Keep the 4px min-width stub for very short notes; otherwise size to span.
    if (widthPct > 0) entry.el.style.width = `${widthPct.toFixed(2)}%`;
  }

  /** Determine note bar color based on pitch class chord role. */
  private getNoteColor(n: EddieJuiceEvents["eddieNote"]): string {
    if (!n.inKey) return COLOR_BOGUS;

    const pitchClass = NOTE_NAMES[((n.midi % 12) + 12) % 12];

    // Check if it's a root note
    if (pitchClass === this.keyRoot) return COLOR_ROOT;

    // Check if it's a chord tone (3rd or 5th) from the current measure's bassline
    const measureChordTones = this.chordTonesByMeasure.get(n.measure);
    if (measureChordTones) {
      const lane = this.pitchClassToLane.get(pitchClass) ?? 0;
      // First element is root (handled above), check if lane matches 3rd or 5th
      if (measureChordTones.length > 1 && measureChordTones.slice(1).includes(lane)) {
        return COLOR_STRONG;
      }
    }

    return COLOR_WEAK;
  }

  /** A quarter scored — turn its IN-KEY note bars green (out-of-key bars, which
   *  earned nothing, stay red). Works off the DOM so it catches bars whose
   *  eddieNoteEnd already fired (and were removed from noteBars). */
  private greenQuarter(measure: number, beat: number): void {
    const idx = this.indexFor(measure);
    const layer = idx >= 0 ? this.noteLayers[idx] : null;
    if (!layer) return;
    const want = String(beat);
    for (const child of Array.from(layer.children)) {
      const el = child as HTMLElement;
      if (el.dataset.beat !== want) continue;
      if (el.classList.contains("eddie-note-off")) continue; // out-of-key: no score
      el.classList.add("eddie-note-scored");
      el.style.background = "#39ff7a";
      el.style.boxShadow = "0 0 8px #39ff7a,0 0 2px #fff";
    }
  }

  /** scoredMeasure: 0..15 = a scored cell (rows 1-4); negative = intro row 0,
   *  where -1..-4 picks intro column 0..3. */
  setActiveMeasure(scoredMeasure: number): void {
    this.activeScored = scoredMeasure;
    const activeIdx = this.indexFor(scoredMeasure);
    for (let i = 0; i < this.cells.length; i++) {
      this.cells[i].classList.toggle("eddie-cell-active", i === activeIdx);
    }
  }

  private indexFor(scoredMeasure: number): number {
    if (scoredMeasure < 0) {
      const col = (-scoredMeasure - 1) % COLS; // -1 -> col 0
      return col; // row 0
    }
    if (scoredMeasure > 15) return -1;
    const row = Math.floor(scoredMeasure / COLS) + 1;
    const col = scoredMeasure % COLS;
    return row * COLS + col;
  }

  update(dt: number): void {
    if (this.pulse > 0) {
      this.pulse = Math.max(0, this.pulse - dt * 4);
      const idx = this.indexFor(this.activeScored);
      const cell = idx >= 0 ? this.cells[idx] : null;
      if (cell) {
        const glow = 28 + this.pulse * 22;
        cell.style.boxShadow =
          `0 0 ${glow}px rgba(255,43,214,${0.7 + this.pulse * 0.3}),` +
          `inset 0 0 26px rgba(255,43,214,0.28)`;
      }
    }
  }

  dispose(): void {
    this.offBeat?.();
    this.offNote?.();
    this.offNoteEnd?.();
    this.offScored?.();
    this.offBeat = undefined;
    this.offNote = undefined;
    this.offNoteEnd = undefined;
    this.root?.remove();
    this.root = null;
    this.cells = [];
    this.noteLayers = [];
    this.noteBars.clear();
  }
}
