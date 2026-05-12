import Phaser from "phaser";
import type { Conductor, Phase } from "../audio/Conductor";
import {
  PitchTracker,
  type OnsetEvent,
  type PitchUpdate,
  type NoteEnd,
} from "../audio/PitchTracker";
import { AudioRecorder } from "../audio/AudioRecorder";
import { colors } from "../ui/style";
import { midiToName } from "../audio/midi";

interface InitData {
  conductor: Conductor;
  tracker?: PitchTracker;
}

interface BarLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Pitch → vertical position. Map MIDI 40 (low E2) ... MIDI 76 (E5) to 0..1.
const MIN_MIDI = 40;
const MAX_MIDI = 76;

function midiToNorm(midi: number): number {
  return Phaser.Math.Clamp((midi - MIN_MIDI) / (MAX_MIDI - MIN_MIDI), 0, 1);
}

interface BendPoint {
  /** x in screen space — derived from audio time at the moment we appended. */
  x: number;
  /** y in screen space — derived from the midi value at the moment. */
  y: number;
  /** midi at this vertex, used to detect changes worth appending a new vertex. */
  midi: number;
}

interface ActiveNote {
  onsetId: number;
  measure: number;
  startX: number;
  /** Polyline vertices. Drawn point→point with a horizontal extension from
   *  the last vertex to the current audio time at the last vertex's y.
   *  A simple plucked note has just the start vertex; bends accumulate
   *  vertices as pitch changes. */
  points: BendPoint[];
  line: Phaser.GameObjects.Graphics;
  lineGlow: Phaser.GameObjects.Graphics;
  dot: Phaser.GameObjects.Container;
}

interface RuntimeSnapshot {
  /** Every dot PlayScene drew. Visual ground truth. */
  dots: Array<{ time: number; midi: number; name: string; measure: number }>;
  /** Every onset received from the engine. */
  onsets: Array<{ id: number; time: number; energy: number; synthetic: boolean }>;
  /** Every pitch update received from the engine. */
  pitchUpdates: Array<{
    onsetId: number;
    time: number;
    midi: number;
    name: string;
    status: "preliminary" | "settled";
  }>;
  /** Every note-end received from the engine. */
  noteEnds: Array<{ onsetId: number; time: number; reason: string }>;
  phase: string;
  done: boolean;
}

declare global {
  interface Window {
    __outrunRuntime?: RuntimeSnapshot;
  }
}

export class PlayScene extends Phaser.Scene {
  private conductor!: Conductor;
  private tracker!: PitchTracker;
  private bars: Phaser.GameObjects.Rectangle[] = [];
  private barLayouts: BarLayout[] = [];
  private statusText!: Phaser.GameObjects.Text;
  private notesLayer!: Phaser.GameObjects.Container;
  private activeNote: ActiveNote | null = null;
  /** Onsets received but waiting for their first PitchUpdate to materialise. */
  private pendingOnsets = new Map<number, { time: number; x: number; measure: number }>();
  private offBeat?: () => boolean;
  private offPhase?: () => boolean;
  private offOnset?: () => boolean;
  private offPitchUpdate?: () => boolean;
  private offNoteEnd?: () => boolean;
  private recorder: AudioRecorder | null = null;
  private recIndicator: Phaser.GameObjects.Container | null = null;
  private emissionLog: Array<{
    t: number;
    kind: "onset" | "pitch" | "noteEnd";
    payload: unknown;
  }> = [];
  private recStartAudioTime = 0;

  constructor() {
    super("PlayScene");
  }

  init(data: InitData) {
    this.conductor = data.conductor;
    if (data.tracker) this.tracker = data.tracker;
    window.__outrunRuntime = {
      dots: [],
      onsets: [],
      pitchUpdates: [],
      noteEnds: [],
      phase: "playing",
      done: false,
    };
  }

  create() {
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor(colors.bg);

    this.drawHorizonGrid();

    const margin = 60;
    const top = 80;
    const usable = height - top - 80;
    const barH = (usable - 3 * 24) / 4;
    const barW = width - margin * 2;

    for (let i = 0; i < 4; i++) {
      const y = top + i * (barH + 24);
      const layout: BarLayout = { x: margin, y, w: barW, h: barH };
      this.barLayouts.push(layout);

      const rect = this.add
        .rectangle(layout.x, layout.y, layout.w, layout.h, colors.barFill, 1)
        .setOrigin(0, 0)
        .setStrokeStyle(2, colors.barStroke);
      this.bars.push(rect);

      for (let b = 1; b < 4; b++) {
        const lineX = layout.x + (layout.w * b) / 4;
        this.add
          .line(0, 0, lineX, layout.y + 4, lineX, layout.y + layout.h - 4, colors.beatLine, 0.6)
          .setOrigin(0, 0)
          .setLineWidth(1);
      }

      this.add
        .text(layout.x - 30, layout.y + layout.h / 2, String(i + 1), {
          fontFamily: "monospace",
          fontSize: "20px",
          color: colors.text,
        })
        .setOrigin(0.5)
        .setAlpha(0.6);
    }

    this.notesLayer = this.add.container(0, 0);

    this.statusText = this.add
      .text(width / 2, 30, "Count-in...", {
        fontFamily: "monospace",
        fontSize: "20px",
        color: colors.accent,
      })
      .setOrigin(0.5);

    this.offPhase = this.conductor.onPhaseChange((p) => this.onPhase(p));
    this.offBeat = this.conductor.onBeat(() => this.refreshHighlight());

    const trackerPreStarted = !!this.tracker;
    if (!trackerPreStarted) this.tracker = new PitchTracker();
    this.offOnset = this.tracker.onOnset((e) => this.onOnset(e));
    this.offPitchUpdate = this.tracker.onPitchUpdate((u) => this.onPitchUpdate(u));
    this.offNoteEnd = this.tracker.onNoteEnd((e) => this.onNoteEnd(e));
    this.tracker.setBeatProximityProvider((t) =>
      this.conductor.proximityToExpectedAttack(t),
    );
    if (!trackerPreStarted) {
      this.tracker.start().catch((err) => {
        console.error("Mic init failed:", err);
        this.statusText.setText("Mic blocked — pitches won't show");
        this.statusText.setColor("#ff6666");
      });
    }

    if (new URLSearchParams(location.search).has("record")) {
      this.recorder = new AudioRecorder();
      this.recIndicator = this.makeRecIndicator(width / 2, 56);
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
  }

  private downloadEmissionLog() {
    if (this.emissionLog.length === 0) return;
    const json = JSON.stringify(
      {
        bpm: this.conductor.currentBpm,
        capturedAt: new Date().toISOString(),
        recStartAudioTime: this.recStartAudioTime,
        events: this.emissionLog,
      },
      null,
      2,
    );
    const blob = new Blob([json], { type: "application/json" });
    triggerDownload(URL.createObjectURL(blob), `outrun-axe-emissions-${recordingTimestamp()}.json`);
  }

  /**
   * Snapshot the Phaser canvas (bars + dots + lines as currently rendered) and
   * download it as a PNG. Paired with the audio + emissions JSON so a debug
   * artifact has audio + ground-truth detection events + visual side-by-side.
   */
  private downloadScreenshot() {
    this.game.renderer.snapshot((image) => {
      // Phaser passes an HTMLImageElement whose src is a data URL. Download
      // directly via that — no canvas → blob round-trip needed.
      if (!(image instanceof HTMLImageElement)) return;
      triggerDownload(image.src, `outrun-axe-screen-${recordingTimestamp()}.png`);
    });
  }

  private makeRecIndicator(x: number, y: number): Phaser.GameObjects.Container {
    const dot = this.add.circle(0, 0, 6, 0xff3344, 1);
    const label = this.add
      .text(14, 0, "REC", {
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#ff3344",
        fontStyle: "bold",
      })
      .setOrigin(0, 0.5);
    const c = this.add.container(x, y, [dot, label]);
    c.setVisible(false);
    this.tweens.add({ targets: dot, alpha: 0.3, yoyo: true, repeat: -1, duration: 600 });
    return c;
  }

  update() {
    this.refreshHighlight();
    // Extend the active note's line up to the current audio-clock time. No
    // explicit timeout — notes end on explicit NoteEnd events from the
    // engine (silence, phase change, or a new onset).
    if (this.activeNote && this.conductor.currentPhase === "playing") {
      this.extendActiveLineToNow();
    }
  }

  private refreshHighlight() {
    const active = this.conductor.currentPlayMeasure();
    for (let i = 0; i < 4; i++) {
      if (i === active) {
        this.bars[i].setStrokeStyle(3, colors.activeStroke);
        this.bars[i].setFillStyle(colors.activeFill, 1);
      } else {
        this.bars[i].setStrokeStyle(2, colors.barStroke);
        this.bars[i].setFillStyle(colors.barFill, 1);
      }
    }
  }

  private onPhase(p: Phase) {
    if (p === "countIn") {
      this.statusText.setText("Count-in...");
      this.tracker?.startFakeMicPlayback();
      const stream = this.tracker?.mediaStream;
      if (this.recorder && stream) {
        this.recorder.start(stream);
        this.recIndicator?.setVisible(true);
        this.recStartAudioTime = this.conductor.audioTime;
        this.emissionLog = [];
      }
    }
    else if (p === "playing") {
      this.tracker?.reset();
      this.statusText.setText("Play!");
    }
    else if (p === "done") {
      this.tracker?.endActive("phase", this.conductor.audioTime);
      this.statusText.setText("Done — press any key to restart");
      const runtime = window.__outrunRuntime;
      if (runtime) runtime.done = true;
      if (this.recorder) {
        void this.recorder.stopAndDownload();
        this.downloadEmissionLog();
        this.downloadScreenshot();
        this.recIndicator?.setVisible(false);
      }
      const goBack = () => {
        this.conductor.stop();
        this.scene.start("StartScene");
      };
      this.time.delayedCall(10000, goBack);
      this.input.keyboard?.once("keydown", goBack);
      this.input.once("pointerdown", goBack);
    }
  }

  private onOnset(e: OnsetEvent) {
    if (this.conductor.currentPhase !== "playing") return;
    const measure = this.conductor.measureForTime(e.time);
    if (measure < 0) return;
    const layout = this.barLayouts[measure];
    const measureStart = this.conductor.measureStartTime(measure);
    const measureDur = this.conductor.measureDuration();
    const t = Phaser.Math.Clamp((e.time - measureStart) / measureDur, 0, 1);
    const x = layout.x + t * layout.w;

    this.pendingOnsets.set(e.id, { time: e.time, x, measure });

    window.__outrunRuntime?.onsets.push({
      id: e.id,
      time: e.time,
      energy: e.energy,
      synthetic: e.synthetic,
    });
    if (this.recorder) {
      this.emissionLog.push({
        t: e.time - this.recStartAudioTime,
        kind: "onset",
        payload: { id: e.id, energy: e.energy, synthetic: e.synthetic },
      });
    }
  }

  private onPitchUpdate(u: PitchUpdate) {
    if (this.conductor.currentPhase !== "playing") return;

    window.__outrunRuntime?.pitchUpdates.push({
      onsetId: u.onsetId,
      time: u.time,
      midi: u.midi,
      name: u.name,
      status: u.status,
    });
    if (this.recorder) {
      this.emissionLog.push({
        t: u.time - this.recStartAudioTime,
        kind: "pitch",
        payload: { onsetId: u.onsetId, midi: u.midi, name: u.name, status: u.status },
      });
    }

    // First pitch for a pending onset → materialise the dot.
    const pending = this.pendingOnsets.get(u.onsetId);
    if (pending && u.status === "preliminary") {
      this.pendingOnsets.delete(u.onsetId);
      // Engine should have already emitted noteEnd for any previous note, but
      // defensively finalise just in case.
      this.activeNote = null;
      this.startNewNote(u.onsetId, u.midi, pending.measure, pending.x, u.time);
      return;
    }

    // Refinement / sustain update on the currently active note. If the
    // engine reports a different midi (a bend), append a polyline vertex
    // at this time/pitch — the next redraw will draw a diagonal segment
    // from the previous vertex up/down to the new pitch.
    if (this.activeNote && this.activeNote.onsetId === u.onsetId) {
      this.appendBendPoint(u.midi, u.time);
    }
  }

  private onNoteEnd(e: NoteEnd) {
    window.__outrunRuntime?.noteEnds.push({
      onsetId: e.onsetId,
      time: e.time,
      reason: e.reason,
    });
    if (this.recorder) {
      this.emissionLog.push({
        t: e.time - this.recStartAudioTime,
        kind: "noteEnd",
        payload: { onsetId: e.onsetId, reason: e.reason },
      });
    }
    if (this.activeNote && this.activeNote.onsetId === e.onsetId) {
      // Snap the line to the engine's noteEnd time before freezing. The
      // worklet path delivers noteEnd events whose `time` may be in the
      // past relative to conductor.audioTime (worklet-to-main-thread
      // roundtrip latency), so the most-recent extendActiveLineToNow
      // overshoots. Without this snap the line visibly extends past the
      // start of the next note.
      this.snapActiveLineToTime(e.time);
      this.activeNote = null;
    }
    this.pendingOnsets.delete(e.onsetId);
  }

  private snapActiveLineToTime(time: number) {
    this.redrawActiveLine(time);
  }

  private startNewNote(
    onsetId: number,
    midi: number,
    measure: number,
    x: number,
    time: number,
  ) {
    const layout = this.barLayouts[measure];
    const y = layout.y + layout.h - midiToNorm(midi) * layout.h;

    const lineGlow = this.add.graphics();
    this.notesLayer.add(lineGlow);

    const line = this.add.graphics();
    this.notesLayer.add(line);

    const name = midiToName(midi);
    const dot = this.makeNoteDot(x, y, name);
    this.notesLayer.add(dot);

    window.__outrunRuntime?.dots.push({ time, midi, name, measure });

    this.activeNote = {
      onsetId,
      measure,
      startX: x,
      points: [{ x, y, midi }],
      line,
      lineGlow,
      dot,
    };
    this.redrawActiveLine(this.conductor.audioTime);
  }

  /** A sustain pitch reading came in for the active note. If the midi
   *  changed since the last vertex, append a new vertex at the current x
   *  and the new y. The result: a polyline that goes diagonally up to the
   *  bent pitch and then horizontally at the new pitch. */
  private appendBendPoint(midi: number, time: number) {
    if (!this.activeNote) return;
    const last = this.activeNote.points[this.activeNote.points.length - 1];
    if (last && last.midi === midi) return; // no change worth recording
    const layout = this.barLayouts[this.activeNote.measure];
    const measureStart = this.conductor.measureStartTime(this.activeNote.measure);
    const measureDur = this.conductor.measureDuration();
    const t = Phaser.Math.Clamp((time - measureStart) / measureDur, 0, 1);
    const x = layout.x + t * layout.w;
    const y = layout.y + layout.h - midiToNorm(midi) * layout.h;
    this.activeNote.points.push({ x, y, midi });
  }

  private extendActiveLineToNow() {
    this.redrawActiveLine(this.conductor.audioTime);
  }

  /** Redraw the polyline from points[] plus a horizontal extension to
   *  `endTime` at the last vertex's y. Called every frame and at noteEnd. */
  private redrawActiveLine(endTime: number) {
    if (!this.activeNote) return;
    const layout = this.barLayouts[this.activeNote.measure];
    const measureStart = this.conductor.measureStartTime(this.activeNote.measure);
    const measureDur = this.conductor.measureDuration();
    const t = Phaser.Math.Clamp((endTime - measureStart) / measureDur, 0, 1);
    const xEnd = layout.x + t * layout.w;
    const points = this.activeNote.points;
    const last = points[points.length - 1];
    const xClamped = Math.max(xEnd, last.x);

    const drawPath = (g: Phaser.GameObjects.Graphics, width: number, alpha: number) => {
      g.clear();
      g.lineStyle(width, colors.note, alpha);
      g.beginPath();
      g.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
      g.lineTo(xClamped, last.y);
      g.strokePath();
    };
    drawPath(this.activeNote.lineGlow, 14, 0.18);
    drawPath(this.activeNote.line, 4, 1);
  }

  private makeNoteDot(x: number, y: number, label: string): Phaser.GameObjects.Container {
    const c = this.add.container(x, y);
    const glow = this.add.circle(0, 0, 22, colors.note, 0.22);
    c.add(glow);
    const fill = this.add.circle(0, 0, 14, colors.note, 1).setStrokeStyle(1, 0xffffff, 0.6);
    const text = this.add
      .text(0, 0, label, {
        fontFamily: "monospace",
        fontSize: label.length >= 3 ? "10px" : "11px",
        color: "#0a0612",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    c.add([fill, text]);
    return c;
  }

  private drawHorizonGrid() {
    const { width, height } = this.scale;
    const g = this.add.graphics();
    g.lineStyle(1, colors.beatLine, 0.25);
    const vanishY = -height * 0.3;
    const baseY = height + 20;
    for (let i = 0; i <= 12; i++) {
      const y = baseY - (i * (baseY - vanishY)) / 12;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(width, y);
      g.strokePath();
    }
  }

  private cleanup() {
    this.offBeat?.();
    this.offPhase?.();
    this.offOnset?.();
    this.offPitchUpdate?.();
    this.offNoteEnd?.();
    this.tracker.stop();
    this.activeNote = null;
    this.pendingOnsets.clear();
  }
}

function recordingTimestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[T:.]/g, "-")
    .replace(/-\d{3}Z$/, "");
}

function triggerDownload(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    if (href.startsWith("blob:")) URL.revokeObjectURL(href);
    a.remove();
  }, 0);
}
