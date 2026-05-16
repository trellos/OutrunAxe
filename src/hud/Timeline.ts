import type { Conductor } from "../audio/Conductor";
import type { PitchTracker } from "../audio/PitchTracker";
import { BarAccumulator } from "./noteBars";

const ROWS = 3;
const BEATS_PER_ROW = 16;
const PX_PER_BEAT = 36;
const ROW_HEIGHT = 56;
const MIDI_MIN = 40;
const MIDI_MAX = 76;
const BAND_HEIGHT = 6;
const COUNT_IN_BEATS = 4;
// Brief bright pulse fades over this window after its beat fires.
const PULSE_FADE_MS = 150;

interface RowState {
  measureStart: number;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

export class Timeline {
  private container: HTMLDivElement;
  private rows: RowState[] = [];
  private offTracker?: () => boolean;
  private offConductor?: () => boolean;
  private activeRow = ROWS - 1;
  private bpm = 90;
  // count-in plotting needs its own time origin since measureStartTime() only
  // covers the play measures; this is the audio time of count-in beat 0.
  private countInStart = -1;
  // Single shared bar grouper: notes are grouped strictly by onsetId so a
  // sustained note (many wobbling reads, one onsetId) is one solid bar.
  private bars = new BarAccumulator(PX_PER_BEAT / 10);
  // Beat-pulse overlay: a transparent canvas layered over the bottom row.
  // We draw a brief bright vertical pulse at the currently-recorded beat's
  // x WITHOUT ever clearing/redrawing the note canvas.
  private overlay: HTMLCanvasElement;
  private overlayCtx: CanvasRenderingContext2D;
  private rafId = 0;

  constructor(parent: HTMLElement, private conductor: Conductor) {
    this.container = document.createElement("div");
    this.container.className = "outrun-timeline";
    this.container.style.position = "relative";
    parent.appendChild(this.container);

    for (let i = 0; i < ROWS; i++) {
      const canvas = document.createElement("canvas");
      canvas.width = BEATS_PER_ROW * PX_PER_BEAT;
      canvas.height = ROW_HEIGHT;
      canvas.className = "timeline-row";
      this.container.appendChild(canvas);
      const ctx = canvas.getContext("2d")!;
      this.rows.push({ measureStart: -1, canvas, ctx });
    }

    // Overlay sits on top of the bottom (active) row only. Transparent and
    // non-interactive so it never occludes input or the note canvas.
    this.overlay = document.createElement("canvas");
    this.overlay.width = BEATS_PER_ROW * PX_PER_BEAT;
    this.overlay.height = ROW_HEIGHT;
    this.overlay.style.position = "absolute";
    this.overlay.style.left = "0";
    this.overlay.style.bottom = "0";
    this.overlay.style.pointerEvents = "none";
    this.container.appendChild(this.overlay);
    this.overlayCtx = this.overlay.getContext("2d")!;

    this.bpm = conductor.currentBpm;
  }

  attach(tracker: PitchTracker) {
    // Draw the empty grid up-front so the timeline reads as a structure during
    // the count-in (before any measure has started).
    for (const row of this.rows) this.drawGrid(row);

    this.offConductor = this.conductor.onBeat((info) => {
      // Count-in records into a virtual measure of index -1 so plotting has a
      // home before play measure 0 exists. Allocate that row on count-in
      // downbeat and capture its audio-time origin.
      if (info.phase === "countIn") {
        if (info.beatInPhase === 0 && this.rows[ROWS - 1].measureStart !== -1) {
          this.countInStart = info.time;
          this.shiftRowsUp(-1);
        }
        return;
      }
      if (info.phase !== "playing") return;
      if (info.beatInPhase !== 0) return;
      const phraseIdx = Math.floor(info.measureInPlay / 4);
      const targetRow = ROWS - 1;
      const measureStartOfRow = phraseIdx * 4;
      // Only (re)allocate + redraw a row when the phrase actually changes.
      // shiftRowsUp() redraws the fresh bottom row's grid. Calling drawGrid()
      // every downbeat would clearRect() the canvas and wipe the notes the
      // player already played this phrase.
      if (this.rows[targetRow].measureStart !== measureStartOfRow) {
        this.shiftRowsUp(measureStartOfRow);
      }
    });

    this.offTracker = tracker.onPitchUpdate((u) => {
      const phase = this.conductor.currentPhase;
      if (phase !== "playing" && phase !== "countIn") return;
      this.plotPitch(u.time, u.midi, u.onsetId);
    });

    // Private rAF loop owned by Timeline: draws the beat pulse on the overlay
    // only. Cancelled in detach() so it never leaks across retries.
    const tick = () => {
      this.drawPulse();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  detach() {
    this.offConductor?.();
    this.offTracker?.();
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.overlay.remove();
    this.container.remove();
  }

  /**
   * Pulse the vertical beat line for the beat currently being recorded. The
   * measure's 1st line pulses on beat 1, etc. Drawn ONLY on the transparent
   * overlay — the note canvas is never cleared/redrawn here.
   */
  private drawPulse() {
    const ctx = this.overlayCtx;
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);

    const phase = this.conductor.currentPhase;
    if (phase !== "countIn" && phase !== "playing") return;

    const row = this.rows[this.activeRow];
    if (row.measureStart < -1) return;
    if (row.measureStart === -1 && this.countInStart < 0) return;

    const beatDur = 60 / this.bpm;
    const rowStartTime = this.rowStartTime(row.measureStart);
    const totalBeats = row.measureStart === -1 ? COUNT_IN_BEATS : BEATS_PER_ROW;
    const into = this.conductor.audioTime - rowStartTime;
    if (into < 0 || into > totalBeats * beatDur) return;

    const beatIdx = Math.floor(into / beatDur);
    if (beatIdx < 0 || beatIdx >= totalBeats) return;

    // Brightness fades over PULSE_FADE_MS after the beat's downbeat.
    const sinceBeatMs = (into - beatIdx * beatDur) * 1000;
    const alpha = Math.max(0, 1 - sinceBeatMs / PULSE_FADE_MS);
    if (alpha <= 0) return;

    const x = beatIdx * PX_PER_BEAT;
    ctx.strokeStyle = `rgba(0, 240, 255, ${alpha})`;
    ctx.lineWidth = 3;
    ctx.shadowColor = "rgba(0, 240, 255, 0.9)";
    ctx.shadowBlur = 8 * alpha;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, this.overlay.height);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  private shiftRowsUp(newBottomMeasureStart: number) {
    for (let i = 0; i < ROWS - 1; i++) {
      this.rows[i].measureStart = this.rows[i + 1].measureStart;
      this.rows[i].ctx.clearRect(0, 0, this.rows[i].canvas.width, ROW_HEIGHT);
      this.rows[i].ctx.drawImage(this.rows[i + 1].canvas, 0, 0);
    }
    const bottom = this.rows[ROWS - 1];
    bottom.measureStart = newBottomMeasureStart;
    bottom.ctx.clearRect(0, 0, bottom.canvas.width, ROW_HEIGHT);
    this.drawGrid(bottom);
    this.activeRow = ROWS - 1;
    // A row boundary breaks bar continuity — the next pitch starts a new bar.
    // This fires both when a play phrase advances and when the count-in row
    // is allocated (shiftRowsUp(-1)).
    this.bars.reset();
  }

  private drawGrid(row: RowState) {
    const { ctx, canvas } = row;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(26, 15, 46, 0.55)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let b = 0; b <= BEATS_PER_ROW; b++) {
      const x = b * PX_PER_BEAT;
      const isMeasure = b % 4 === 0;
      ctx.strokeStyle = isMeasure ? "rgba(255,43,214,0.7)" : "rgba(74,42,122,0.5)";
      ctx.lineWidth = isMeasure ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(74,42,122,0.25)";
    ctx.lineWidth = 0.5;
    for (let b = 0; b < BEATS_PER_ROW; b++) {
      for (let sub = 1; sub < 4; sub++) {
        const x = b * PX_PER_BEAT + (sub * PX_PER_BEAT) / 4;
        ctx.beginPath();
        ctx.moveTo(x, ROW_HEIGHT * 0.25);
        ctx.lineTo(x, ROW_HEIGHT * 0.75);
        ctx.stroke();
      }
    }
  }

  /** Audio time at which the active row begins. measureStart === -1 is the
   *  count-in row (origin captured on the count-in downbeat); otherwise it's
   *  a play measure resolved via the conductor. */
  private rowStartTime(measureStart: number): number {
    if (measureStart === -1) return this.countInStart;
    return this.conductor.measureStartTime(measureStart);
  }

  private plotPitch(audioTime: number, midi: number, onsetId: number) {
    const row = this.rows[this.activeRow];
    if (row.measureStart < -1) return;
    if (row.measureStart === -1 && this.countInStart < 0) return;
    const beatDur = 60 / this.bpm;
    const rowStartTime = this.rowStartTime(row.measureStart);
    const rowSpan =
      (row.measureStart === -1 ? COUNT_IN_BEATS : BEATS_PER_ROW) * beatDur;
    const into = audioTime - rowStartTime;
    if (into < 0 || into > rowSpan) return;
    const x = (into / beatDur) * PX_PER_BEAT;
    const norm = Math.max(0, Math.min(1, (midi - MIDI_MIN) / (MIDI_MAX - MIDI_MIN)));
    const y = ROW_HEIGHT - norm * (ROW_HEIGHT - 8) - 4;
    const ctx = row.ctx;
    ctx.fillStyle = "#00f0ff";

    // Group strictly by onsetId. Same onsetId (a sustained note, even with
    // ≥2 semitone pitch wobble between reads) extends ONE bar; a new onsetId
    // (a fresh pluck / hammer-on / keyboard note) starts a new bar.
    const bar = this.bars.feed(onsetId, x, y);
    if (!bar) return;
    ctx.fillRect(
      bar.x0,
      bar.y - BAND_HEIGHT / 2,
      Math.max(1, bar.x1 - bar.x0),
      BAND_HEIGHT,
    );
  }
}
