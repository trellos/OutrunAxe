import Phaser from "phaser";
import type { Conductor, Phase } from "../audio/Conductor";
import { PitchTracker, type PitchReading } from "../audio/PitchTracker";
import { AudioRecorder } from "../audio/AudioRecorder";
import { colors, STYLE } from "../ui/style";

interface InitData {
  conductor: Conductor;
  bpm: number;
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
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function freqToMidi(freq: number): number {
  return Math.round(69 + 12 * Math.log2(freq / 440));
}
function midiToName(midi: number): string {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}
function midiToNorm(midi: number): number {
  return Phaser.Math.Clamp((midi - MIN_MIDI) / (MAX_MIDI - MIN_MIDI), 0, 1);
}

// Active-note timeout. Set long because the engine's sustain emissions are
// not strictly periodic — confidence-gating can skip emissions for a sizeable
// fraction of a note's duration. Anything shorter than ~half a second
// causes "false finalize" where a same-pitch sustain emission later creates
// a NEW dot instead of extending the existing line. Real notes are bounded
// by the next isNewNote=true onset, not by this timeout — this only serves
// to drop a lingering active-note reference after extended silence.
const NOTE_HOLD_TIMEOUT = 1.0;

interface ActiveNote {
  midi: number;
  measure: number;
  startX: number;
  y: number;
  line: Phaser.GameObjects.Rectangle;
  lineGlow: Phaser.GameObjects.Rectangle | null;
  dot: Phaser.GameObjects.Container;
  lastSeenAudioTime: number;
}

interface RuntimeSnapshot {
  /** Every dot PlayScene drew, in order. This is the visual ground truth. */
  dots: Array<{ time: number; midi: number; name: string; measure: number }>;
  /** Every emission received from the engine. */
  emissions: Array<{ time: number; midi: number; name: string; isNewNote: boolean }>;
  phase: string;
  done: boolean;
}

export class PlayScene extends Phaser.Scene {
  private conductor!: Conductor;
  private tracker!: PitchTracker;
  private bars: Phaser.GameObjects.Rectangle[] = [];
  private barLayouts: BarLayout[] = [];
  private statusText!: Phaser.GameObjects.Text;
  private notesLayer!: Phaser.GameObjects.Container;
  private activeNote: ActiveNote | null = null;
  private offBeat?: () => boolean;
  private offPhase?: () => boolean;
  private offPitch?: () => boolean;
  private recorder: AudioRecorder | null = null;
  private recIndicator: Phaser.GameObjects.Container | null = null;
  private emissionLog: Array<{
    t: number;
    freq: number;
    midi: number;
    name: string;
    isNewNote: boolean;
  }> = [];
  private recStartAudioTime = 0;

  constructor() {
    super("PlayScene");
  }

  init(data: InitData) {
    this.conductor = data.conductor;
    if (data.tracker) this.tracker = data.tracker;
    // Reset runtime-test snapshot so each game starts fresh.
    (window as unknown as { __outrunRuntime: RuntimeSnapshot }).__outrunRuntime = {
      dots: [],
      emissions: [],
      phase: "playing",
      done: false,
    };
  }

  create() {
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor(colors.bg);

    if (STYLE === "B") this.drawHorizonGrid();

    // 4 horizontal bars, stacked vertically.
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

      // Beat divider lines
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
    this.offPitch = this.tracker.onPitch((r) => this.onPitch(r));
    // Feed beat proximity to the engine so it can emit sooner near expected
    // attack positions (priority: rhythmic prior).
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

    // ?record=1 in the URL → capture the mic stream for the whole session and
    // download it on completion. Drop the file into public/samples/ and point
    // the test bench at it to iterate offline against your real input.
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
        // Times in this log are RELATIVE to the start of the recording, so
        // they align directly with the WebM timeline.
        emissions: this.emissionLog,
      },
      null,
      2,
    );
    const blob = new Blob([json], { type: "application/json" });
    const ts = new Date()
      .toISOString()
      .replace(/[T:.]/g, "-")
      .replace(/-\d{3}Z$/, "");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `outrun-axe-emissions-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
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
    this.maybeFinalizeStaleNote();
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
      // Runtime test mode: start the fake-mic playback now so its audio is
      // aligned with the conductor's count-in (the recording was captured
      // starting at count-in).
      this.tracker?.startFakeMicPlayback();

      // Start recording from the count-in so the captured file includes any
      // beep bleed and the lead-up to the first pluck — useful for debugging
      // start-of-game issues.
      const stream = this.tracker?.mediaStream;
      if (this.recorder && stream) {
        this.recorder.start(stream);
        this.recIndicator?.setVisible(true);
        this.recStartAudioTime = this.conductor.audioTime;
        this.emissionLog = [];
      }
    }
    else if (p === "playing") {
      // Wipe any state PitchTracker accumulated from the count-in beeps —
      // their pitches would otherwise pollute the octave-correction history
      // and snap the player's first real note up an octave.
      this.tracker?.reset();
      this.statusText.setText("Play!");
    }
    else if (p === "done") {
      this.finalizeActiveNote();
      this.statusText.setText("Done — press any key to restart");
      // Runtime test marker.
      const runtime = (window as unknown as { __outrunRuntime?: RuntimeSnapshot }).__outrunRuntime;
      if (runtime) runtime.done = true;
      if (this.recorder) {
        void this.recorder.stopAndDownload();
        this.downloadEmissionLog();
        this.recIndicator?.setVisible(false);
      }
      const goBack = () => {
        this.conductor.stop();
        this.scene.start("StartScene");
      };
      // Auto-return after 10s, but let the player skip ahead with any input.
      this.time.delayedCall(10000, goBack);
      this.input.keyboard?.once("keydown", goBack);
      this.input.once("pointerdown", goBack);
    }
  }

  private onPitch(r: PitchReading) {
    if (this.conductor.currentPhase !== "playing") return;
    // Use the onset-corrected timestamp (r.time) to pick the bar, so a note
    // attacked just before a bar line still lands in the bar where it was
    // played, not the next one. Sustain readings carry now() and naturally
    // map to the current bar.
    const measure = this.conductor.measureForTime(r.time);
    if (measure < 0) return;

    const layout = this.barLayouts[measure];
    const measureStart = this.conductor.measureStartTime(measure);
    const measureDur = this.conductor.measureDuration();
    const t = Phaser.Math.Clamp((r.time - measureStart) / measureDur, 0, 1);
    const x = layout.x + t * layout.w;
    const midi = freqToMidi(r.freq);

    // Runtime test: capture every emission, so a test can compare what the
    // engine sent vs what PlayScene rendered.
    const runtime = (window as unknown as { __outrunRuntime?: RuntimeSnapshot }).__outrunRuntime;
    runtime?.emissions.push({
      time: r.time,
      midi,
      name: midiToName(midi),
      isNewNote: r.isNewNote,
    });

    // When recording, log every emission so we can compare what the live
    // algorithm actually emitted against what offline analysis sees in the
    // captured WebM. The two should agree; if they don't, the divergence
    // points at the recording fidelity (Opus compression) vs an algorithm
    // bug.
    if (this.recorder) {
      this.emissionLog.push({
        t: r.time - this.recStartAudioTime,
        freq: r.freq,
        midi,
        name: midiToName(midi),
        isNewNote: r.isNewNote,
      });
    }

    // A reading marked isNewNote represents a fresh attack — even if the
    // pitch matches the current note (re-pluck of the same string), we want
    // a new dot, not a continuation.
    //
    // For sustain (isNewNote=false): if the active note's pitch matches,
    // this is the SAME note as before — even if its sustain has crossed a
    // measure boundary. Only the visible line lives in the active note's
    // own measure; cross-measure sustain emissions just keep the note alive
    // (no new dot) until the next real attack or stale-timeout.
    const isContinuation =
      !r.isNewNote &&
      this.activeNote !== null &&
      this.activeNote.midi === midi;
    const inActiveMeasure =
      this.activeNote !== null && this.activeNote.measure === measure;

    if (isContinuation && this.activeNote) {
      if (inActiveMeasure) {
        this.extendActiveLine(x, r.time);
      } else {
        // Cross-measure sustain. Don't render — just keep the note alive so
        // a later same-pitch sustain back in its own measure (or a real
        // onset) is processed correctly.
        this.activeNote.lastSeenAudioTime = r.time;
      }
    } else {
      this.finalizeActiveNote();
      this.startNewNote(midi, measure, x, layout, r.time);
    }
  }

  private startNewNote(
    midi: number,
    measure: number,
    x: number,
    layout: BarLayout,
    time: number,
  ) {
    // Snap y to the semitone position so the line is perfectly horizontal even
    // if pitch wobbles slightly during the note.
    const y = layout.y + layout.h - midiToNorm(midi) * layout.h;

    let lineGlow: Phaser.GameObjects.Rectangle | null = null;
    if (STYLE === "B") {
      lineGlow = this.add
        .rectangle(x, y, 0, 14, colors.note, 0.18)
        .setOrigin(0, 0.5);
      this.notesLayer.add(lineGlow);
    }

    const line = this.add
      .rectangle(x, y, 0, 4, colors.note, 1)
      .setOrigin(0, 0.5);
    this.notesLayer.add(line);

    const dot = this.makeNoteDot(x, y, midiToName(midi));
    this.notesLayer.add(dot);

    // Runtime test: every dot drawn is recorded here. This is the visual
    // ground truth — if a test queries dot count it gets EXACTLY what
    // PlayScene rendered.
    const runtime = (window as unknown as { __outrunRuntime?: RuntimeSnapshot }).__outrunRuntime;
    runtime?.dots.push({ time, midi, name: midiToName(midi), measure });

    this.activeNote = {
      midi,
      measure,
      startX: x,
      y,
      line,
      lineGlow,
      dot,
      lastSeenAudioTime: time,
    };
  }

  private extendActiveLine(x: number, time: number) {
    if (!this.activeNote) return;
    const w = Math.max(0, x - this.activeNote.startX);
    this.activeNote.line.setSize(w, this.activeNote.line.height);
    if (this.activeNote.lineGlow) {
      this.activeNote.lineGlow.setSize(w, this.activeNote.lineGlow.height);
    }
    this.activeNote.lastSeenAudioTime = time;
  }

  private finalizeActiveNote() {
    // The line stays where it is — it represents how long the note was held.
    // Just drop the reference so the next reading starts fresh.
    this.activeNote = null;
  }

  private maybeFinalizeStaleNote() {
    if (!this.activeNote) return;
    const audioTime = this.conductor.audioTime;
    const aged = audioTime - this.activeNote.lastSeenAudioTime > NOTE_HOLD_TIMEOUT;
    // Don't finalize on measure change — a note that sustains across a bar
    // line is still the same note; we just don't extend its line into the
    // new bar (handled in onPitch). Finalizing here would force the next
    // sustain emission to start a fresh dot, defeating the cross-measure
    // handling.
    if (aged) {
      this.finalizeActiveNote();
    }
  }

  private makeNoteDot(x: number, y: number, label: string): Phaser.GameObjects.Container {
    const c = this.add.container(x, y);
    if (STYLE === "B") {
      const glow = this.add.circle(0, 0, 22, colors.note, 0.22);
      c.add(glow);
    }
    const fill = this.add.circle(0, 0, 14, colors.note, 1).setStrokeStyle(1, 0xffffff, 0.6);
    // Dark text on bright cyan reads better than light text. Drop the octave
    // suffix when 4+ chars (e.g. "G#3") would crowd the dot.
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
    // Horizontal lines fanning toward a vanishing point at the top.
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
    this.offPitch?.();
    this.tracker.stop();
    this.activeNote = null;
  }
}
