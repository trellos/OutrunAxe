import type { Conductor } from "../audio/Conductor";
import type { PitchTracker } from "../audio/PitchTracker";
import { midiToPitchClass } from "../audio/midi";
import { initialKeySet, keyConfidence, narrowKeys, type PitchClass } from "./keys";
import { EventBus } from "../engine/EventBus";

export interface PitchFiredEvent {
  pitchClass: PitchClass;
  midi: number;
  confidence: number;
  audioTime: number;
  measureIdx: number;
  /** Engine onset id this note belongs to — lets consumers correlate the note
   *  with its later NoteEnd (e.g. to draw a duration bar on the grid). */
  onsetId: number;
}

export interface KeysNarrowedEvent {
  remaining: PitchClass[];
  confidence: number;
  measureIdx: number;
}

type KeyResolverEvents = {
  pitchFired: PitchFiredEvent;
  keysNarrowed: KeysNarrowedEvent;
};

export class KeyResolver {
  readonly bus = new EventBus<KeyResolverEvents>();
  private candidates = initialKeySet();
  private currentMeasure = -1;
  private firedOnsetIds = new Set<number>();
  private offBeat?: () => boolean;
  private offPitch?: () => boolean;

  constructor(private conductor: Conductor, private tracker: PitchTracker) {}

  attach() {
    this.offBeat = this.conductor.onBeat((info) => {
      if (info.phase === "playing" && info.beatInPhase === 0) {
        if (info.measureInPlay !== this.currentMeasure) {
          this.currentMeasure = info.measureInPlay;
          this.candidates = initialKeySet();
          this.firedOnsetIds.clear();
          this.bus.emit("keysNarrowed", {
            remaining: Array.from(this.candidates),
            confidence: keyConfidence(this.candidates),
            measureIdx: this.currentMeasure,
          });
        }
      }
    });

    this.offPitch = this.tracker.onPitchUpdate((u) => {
      if (this.conductor.currentPhase !== "playing") return;
      if (u.status !== "settled") return;
      if (this.firedOnsetIds.has(u.onsetId)) return;
      this.firedOnsetIds.add(u.onsetId);

      const pitchClass = midiToPitchClass(u.midi) as PitchClass;
      this.candidates = narrowKeys(this.candidates, pitchClass);
      if (this.candidates.size === 0) {
        this.candidates = initialKeySet();
      }
      const confidence = keyConfidence(this.candidates);

      this.bus.emit("pitchFired", {
        pitchClass,
        midi: u.midi,
        confidence,
        audioTime: u.time,
        measureIdx: this.currentMeasure,
        onsetId: u.onsetId,
      });
      this.bus.emit("keysNarrowed", {
        remaining: Array.from(this.candidates),
        confidence,
        measureIdx: this.currentMeasure,
      });
    });
  }

  detach() {
    this.offBeat?.();
    this.offPitch?.();
    this.bus.clear();
  }

  get keySetSize(): number {
    return this.candidates.size;
  }
}
