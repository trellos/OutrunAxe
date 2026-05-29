// EddieGrid — the 5-row x 4-measure timeline grid (GDD §8).
//
// 20 cells: row 0 = 4 intro/warm-up measures (visually DEPRIORITIZED), rows 1-4
// = the 16 scored measures (scored measure index = (row-1)*4 + col). The active
// (currently-recording) cell is highlighted unmistakably. The 8th- and 16th-note
// tag badges are rendered from config.eighthTagMeasure / sixteenthTagMeasure; the
// 16th tag is an obvious visual UPGRADE over the 8th tag. Bass-note labels sit
// above the measure where each chord starts (config.bassline).
//
// VARIANT option-1: "chunky neon-bordered cells" — solid DOM cells with thick
// neon borders, the active cell lifting + glowing magenta. Pure DOM/CSS so
// dispose() simply removes the root (zero Three.js resources).

import type { EventBus } from "../../engine/EventBus";
import type { EddieConfig, EddieJuiceEvents } from "../../music/eddie/eddieTypes";

const ROWS = 5;
const COLS = 4;

export class EddieGrid {
  private root: HTMLDivElement | null = null;
  private cells: HTMLDivElement[] = []; // 20 cells, row-major (row*COLS + col)
  private activeScored = -1;
  private offBeat?: () => void;
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
    // measure (m % 4)'s beat-0 note. We label the cell of every scored measure
    // that begins a chord span (beat 0 note present for m % 4).
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
        const isIntro = row === 0;
        if (isIntro) cell.classList.add("eddie-cell-intro");

        const num = document.createElement("div");
        num.className = "eddie-cell-num";
        if (isIntro) {
          num.textContent = `INTRO ${col + 1}`;
        } else {
          const scored = (row - 1) * COLS + col;
          num.textContent = `${scored + 1}`;

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
        cell.appendChild(num);
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
    this.offBeat = undefined;
    this.root?.remove();
    this.root = null;
    this.cells = [];
  }
}
