import type { Conductor } from "../audio/Conductor";
import type { PitchTracker } from "../audio/PitchTracker";

const ROWS = 3;
const BEATS_PER_ROW = 16;
const PX_PER_BEAT = 36;
const ROW_HEIGHT = 56;
const MIDI_MIN = 40;
const MIDI_MAX = 76;

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

  constructor(parent: HTMLElement, private conductor: Conductor) {
    this.container = document.createElement("div");
    this.container.className = "outrun-timeline";
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

    this.bpm = conductor.currentBpm;
  }

  attach(tracker: PitchTracker) {
    // Draw the empty grid up-front so the timeline reads as a structure during
    // the count-in (before any measure has started).
    for (const row of this.rows) this.drawGrid(row);

    this.offConductor = this.conductor.onBeat((info) => {
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
      if (this.conductor.currentPhase !== "playing") return;
      this.plotPitch(u.time, u.midi);
    });
  }

  detach() {
    this.offConductor?.();
    this.offTracker?.();
    this.container.remove();
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

  private plotPitch(audioTime: number, midi: number) {
    const row = this.rows[this.activeRow];
    if (row.measureStart < 0) return;
    const beatDur = 60 / this.bpm;
    const rowStartTime = this.conductor.measureStartTime(row.measureStart);
    const into = audioTime - rowStartTime;
    if (into < 0 || into > BEATS_PER_ROW * beatDur) return;
    const x = (into / beatDur) * PX_PER_BEAT;
    const norm = Math.max(0, Math.min(1, (midi - MIDI_MIN) / (MIDI_MAX - MIDI_MIN)));
    const y = ROW_HEIGHT - norm * (ROW_HEIGHT - 8) - 4;
    const ctx = row.ctx;
    ctx.fillStyle = "#00f0ff";
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}
