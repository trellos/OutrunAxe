import type { Conductor } from "../audio/Conductor";
import type { PitchTracker } from "../audio/PitchTracker";
import { BarAccumulator } from "./noteBars";

const ROWS = 3;
// One row == exactly one 4-beat measure. Widened PX_PER_BEAT keeps the row a
// similar on-screen width (~576px) to the old 16-beat row.
const BEATS_PER_ROW = 4;
const PX_PER_BEAT = 144;
// 12 discrete pitch-class lanes (one per semitone of the octave). Adjacent
// scale notes (semitones apart) used to map to y positions <1px apart in a
// 26px row and smear together; quantising to fixed lanes makes each pitch
// class occupy its own non-overlapping slot.
//   lane 0  = C  (bottom)
//   lane 11 = B  (top)
// LANE_PITCH is the centre-to-centre spacing; BAR_HEIGHT < LANE_PITCH and the
// centres are LANE_PITCH apart, so BAR_HEIGHT + 1 ≤ LANE_PITCH guarantees a
// ≥1px gap between two different pitch classes — they can NEVER overlap.
const LANES = 12;
const LANE_PITCH = 7;
const BAND_HEIGHT = 5;
// Vertical padding above/below the lane stack inside a row.
const LANE_PAD = 4;
// Row is tall enough for 12 lanes plus padding: 4 + 12*7 + 4 = 92. The 3-row
// stack (3*92 + 2*3px gap + 6px top inset + borders ≈ 290px) stays inside the
// top 25vh band (≈270–300px on common 1080–1200px viewports).
const ROW_HEIGHT = LANES * LANE_PITCH + 2 * LANE_PAD;

/**
 * Quantise a MIDI note to its pitch-class lane and return the INTEGER y of
 * that lane's centre. lane 0 (C) sits at the bottom, lane 11 (B) at the top.
 * Two different pitch classes are always ≥ LANE_PITCH (= BAND_HEIGHT + 2) px
 * apart at their centres, so their BAND_HEIGHT-tall bars never overlap.
 */
function laneY(midi: number): number {
  const lane = ((Math.round(midi) % 12) + 12) % 12;
  // lane 0 -> bottom, lane 11 -> top.
  return Math.round(
    ROW_HEIGHT - LANE_PAD - lane * LANE_PITCH - LANE_PITCH / 2,
  );
}
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
      // Backing store == displayed CSS box (1:1). The canvas is shown at its
      // attribute pixel size; CSS must not stretch it (see .timeline-row).
      canvas.width = BEATS_PER_ROW * PX_PER_BEAT;
      canvas.height = ROW_HEIGHT;
      canvas.style.width = `${BEATS_PER_ROW * PX_PER_BEAT}px`;
      canvas.style.height = `${ROW_HEIGHT}px`;
      canvas.className = "timeline-row";
      this.container.appendChild(canvas);
      const ctx = canvas.getContext("2d")!;
      // No resampling: every blit/draw lands on integer pixels with hard
      // edges so bars are crisp blocks, not antialiased fuzz.
      ctx.imageSmoothingEnabled = false;
      this.rows.push({ measureStart: -1, canvas, ctx });
    }

    // Overlay sits on top of the bottom (active) row only. Transparent and
    // non-interactive so it never occludes input or the note canvas.
    this.overlay = document.createElement("canvas");
    this.overlay.width = BEATS_PER_ROW * PX_PER_BEAT;
    this.overlay.height = ROW_HEIGHT;
    this.overlay.style.width = `${BEATS_PER_ROW * PX_PER_BEAT}px`;
    this.overlay.style.height = `${ROW_HEIGHT}px`;
    this.overlay.style.position = "absolute";
    this.overlay.style.left = "0";
    this.overlay.style.bottom = "0";
    this.overlay.style.pointerEvents = "none";
    this.container.appendChild(this.overlay);
    this.overlayCtx = this.overlay.getContext("2d")!;
    this.overlayCtx.imageSmoothingEnabled = false;

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
      // One row == one play measure. measureStart tracks the play measure
      // index 0..3 directly.
      const measureIdx = info.measureInPlay;
      const targetRow = ROWS - 1;
      // Only (re)allocate + redraw a row when the measure actually changes.
      // shiftRowsUp() redraws the fresh bottom row's grid. Calling drawGrid()
      // every downbeat would clearRect() the canvas and wipe the notes the
      // player already played this measure.
      if (this.rows[targetRow].measureStart !== measureIdx) {
        this.shiftRowsUp(measureIdx);
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

    // A row is always exactly 4 beats (count-in measure or play measure), so
    // beat N of the recorded measure maps to the Nth vertical grid line at
    // x = N*PX_PER_BEAT. Track the ACTUAL conductor clock vs the active row
    // origin so the pulse moves left→right in lockstep with the metronome.
    const beatDur = 60 / this.bpm;
    const rowStartTime = this.rowStartTime(row.measureStart);
    const totalBeats = BEATS_PER_ROW;
    const into = this.conductor.audioTime - rowStartTime;
    if (into < 0 || into > totalBeats * beatDur) return;

    const beatIdx = Math.floor(into / beatDur);
    if (beatIdx < 0 || beatIdx >= totalBeats) return;

    // Brightness fades over PULSE_FADE_MS after the beat's downbeat.
    const sinceBeatMs = (into - beatIdx * beatDur) * 1000;
    const alpha = Math.max(0, 1 - sinceBeatMs / PULSE_FADE_MS);
    if (alpha <= 0) return;

    const x = Math.round(beatIdx * PX_PER_BEAT) + 0.5;
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
      // +0.5 puts a 1px/2px stroke on an exact pixel boundary so vertical
      // grid lines stay hard-edged instead of blurring across two columns.
      const x = Math.round(b * PX_PER_BEAT) + 0.5;
      const isMeasure = b % 4 === 0;
      ctx.strokeStyle = isMeasure ? "rgba(255,43,214,0.7)" : "rgba(74,42,122,0.5)";
      ctx.lineWidth = isMeasure ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(74,42,122,0.25)";
    ctx.lineWidth = 1;
    const tickTop = Math.round(ROW_HEIGHT * 0.25);
    const tickBot = Math.round(ROW_HEIGHT * 0.75);
    for (let b = 0; b < BEATS_PER_ROW; b++) {
      for (let sub = 1; sub < 4; sub++) {
        const x = Math.round(b * PX_PER_BEAT + (sub * PX_PER_BEAT) / 4) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, tickTop);
        ctx.lineTo(x, tickBot);
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
    // Row is always exactly 4 beats (count-in measure or play measure).
    const beatDur = 60 / this.bpm;
    const rowStartTime = this.rowStartTime(row.measureStart);
    const rowSpan = BEATS_PER_ROW * beatDur;
    const into = audioTime - rowStartTime;
    if (into < 0 || into > rowSpan) return;
    // Clamp the placed time into [0, 4*beatDur] so a note on beat 1/2/3/4
    // lands centred on column 0/1/2/3 and never spills past the row edge.
    const clamped = Math.max(0, Math.min(BEATS_PER_ROW * beatDur, into));
    const x = (clamped / beatDur) * PX_PER_BEAT;
    // Quantise pitch to one of 12 fixed, non-overlapping pitch-class lanes.
    const y = laneY(midi);
    const ctx = row.ctx;
    ctx.fillStyle = "#00f0ff";

    // Group strictly by onsetId. Same onsetId (a sustained note, even with
    // ≥2 semitone pitch wobble between reads) extends ONE bar; a new onsetId
    // (a fresh pluck / hammer-on / keyboard note) starts a new bar.
    const bar = this.bars.feed(onsetId, x, y);
    if (!bar) return;
    // Integer pixel rect: hard-edged crisp block, no antialiased halo.
    ctx.fillRect(
      Math.round(bar.x0),
      Math.round(bar.y - BAND_HEIGHT / 2),
      Math.max(1, Math.round(bar.x1 - bar.x0)),
      BAND_HEIGHT,
    );
  }
}
