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
// the measure, y = pitch) via the eddieNote juice event. The cell body never
// shows text/number labels — only the bass label (above) and tag badges.
//
// VARIANT option-1: "chunky neon-bordered cells" — solid DOM cells with thick
// neon borders, the active cell lifting + glowing magenta. Pure DOM/CSS so
// dispose() simply removes the root (zero Three.js resources).

import type { EventBus } from "../../engine/EventBus";
import type { EddieConfig, EddieJuiceEvents } from "../../music/eddie/eddieTypes";

const ROWS = 5;
const COLS = 4;

// Pitch range mapped to the vertical extent of a cell when plotting notes.
const MIDI_LO = 45; // ~A2
const MIDI_HI = 72; // C5

export class EddieGrid {
  private root: HTMLDivElement | null = null;
  private cells: HTMLDivElement[] = []; // 20 cells, row-major (row*COLS + col)
  private noteLayers: HTMLDivElement[] = []; // per-cell note-plot layer
  private activeScored = -1;
  private offBeat?: () => void;
  private offNote?: () => void;
  // Pulse phase for a subtle per-beat breathing of the active cell border.
  private pulse = 0;

  mount(ctx: {
    hudParent: HTMLElement;
    config: EddieConfig;
    juice: EventBus<EddieJuiceEvents>;
  }): void {
    const root = document.createElement("div");
    root.className = "eddie-grid";

    // Bass labels keyed by the SCORED measure that starts a chord. The bassline
    // is a 4-measure pattern (BasslineNote.measure 0..3) looping across the 16
    // scored measures; the chord for scored measure m comes from bassline
    // measure (m % 4)'s beat-0 note.
    const chordRootByPatternMeasure = new Map<number, string>();
    for (const n of ctx.config.bassline) {
      if (n.beat === 0 && !chordRootByPatternMeasure.has(n.measure)) {
        chordRootByPatternMeasure.set(n.measure, n.pitchClass);
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
            const tag = document.createElement("div");
            tag.className = "eddie-tag eddie-tag-eighth";
            tag.textContent = "8TH";
            cell.appendChild(tag);
          }
          if (scored === ctx.config.sixteenthTagMeasure) {
            const tag = document.createElement("div");
            tag.className = "eddie-tag eddie-tag-sixteenth";
            tag.textContent = "16TH!";
            cell.appendChild(tag);
          }
        }

        // The note-plot layer: where played notes are drawn (see plotNote).
        // Four faint beat gridlines hint at the quarter divisions.
        const notes = document.createElement("div");
        notes.className = "eddie-cell-notes";
        notes.style.cssText =
          "position:absolute;inset:0;overflow:hidden;pointer-events:none;";
        for (let b = 1; b < 4; b++) {
          const line = document.createElement("div");
          line.style.cssText =
            `position:absolute;top:8%;bottom:8%;left:${b * 25}%;width:1px;` +
            "background:rgba(255,255,255,0.08);";
          notes.appendChild(line);
        }
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
  }

  private plotNote(n: EddieJuiceEvents["eddieNote"]): void {
    const idx = this.indexFor(n.measure);
    const layer = idx >= 0 ? this.noteLayers[idx] : null;
    if (!layer) return;

    const x = Math.max(0, Math.min(1, n.beatFraction));
    const midi = Math.max(MIDI_LO, Math.min(MIDI_HI, n.midi));
    const y = 1 - (midi - MIDI_LO) / (MIDI_HI - MIDI_LO); // 0 = top

    const dot = document.createElement("div");
    dot.className = "eddie-note" + (n.inKey ? "" : " eddie-note-off");
    const color = n.inKey ? "#00f0ff" : "#ff5a6e";
    dot.style.cssText =
      `position:absolute;left:${(x * 100).toFixed(1)}%;top:${(y * 84 + 8).toFixed(1)}%;` +
      "width:7px;height:7px;margin:-4px 0 0 -3px;border-radius:2px;" +
      `background:${color};box-shadow:0 0 7px ${color},0 0 2px #fff;` +
      "opacity:0;transition:opacity .12s ease;";
    layer.appendChild(dot);
    // Fade in on next frame for a soft pop as each note lands.
    requestAnimationFrame(() => {
      dot.style.opacity = "1";
    });
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
    this.offBeat = undefined;
    this.offNote = undefined;
    this.root?.remove();
    this.root = null;
    this.cells = [];
    this.noteLayers = [];
  }
}
