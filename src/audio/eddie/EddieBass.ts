// EddieBass — the bass voice for Infinite Eddie. NOT a full synth pad: it sits
// between a sub and a pluck, with a SLIGHT BITE (a touch of square/saw on top of
// a sine sub, plus a fast filter envelope on the attack). GDD §7.
//
// It follows config.bassline (4 measures of BasslineNote, see eddieTypes §6.2),
// looping every 4 measures across the whole run, in the selected key. The notes'
// pitch classes already encode the key (basslineGen guarantees in-key), so the
// bass just maps each pitchClass to a bass-octave frequency.
//
// Like EddieBeat it plays in preroll / countIn / playing (the intro IS the beat
// + bass), and schedules off the AudioContext clock via BeatInfo.time. stop()
// fully tears down (no orphan oscillators, no clicks) mirroring BackingTrack.

import { getAudioContext } from "../AudioContextSingleton";
import type { Conductor, BeatInfo } from "../Conductor";
import type { BasslineNote, PitchClass } from "../../music/eddie/eddieTypes";
import { NOTE_NAMES } from "../../audio/midi";

export type EddieBassVariant = "option-1" | "option-2" | "option-3";

// Bass register: root pitch classes are voiced around MIDI 36 (C2). We choose
// the octave per pitch class so the whole line stays in a tight bass register
// (E1..D#2-ish) rather than leaping octaves between adjacent roots.
const BASS_BASE_MIDI = 36; // C2

function pitchClassToBassMidi(pc: PitchClass): number {
  const idx = NOTE_NAMES.indexOf(pc);
  // Map into the octave below C2 so most roots sit E1..B1, keeping it subby.
  const midi = BASS_BASE_MIDI + idx;
  return midi - 12; // drop an octave -> C1..B1 range
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ---------------------------------------------------------------------------
// Bass voice character per variant — all share the sub+bite architecture but
// differ in wave blend, filter envelope shape, and decay so the bite reads
// differently (rounder vs. sharper vs. growlier).
// ---------------------------------------------------------------------------

interface BassStyle {
  /** The "bite" layer waveform sitting on top of the sine sub. */
  biteWave: OscillatorType;
  /** Sub layer level (the body). */
  subGain: number;
  /** Bite layer level (the edge). */
  biteGain: number;
  /** Filter cutoff floor (Hz) the envelope decays back to. */
  filterFloor: number;
  /** Filter cutoff peak (Hz) hit at the attack for the bite snap. */
  filterPeak: number;
  /** Filter envelope decay time (s) — how fast the bite closes. */
  filterDecay: number;
  /** Resonance — more Q = more vocal/acidic bite. */
  filterQ: number;
  /** Amp decay as a fraction of the note's nominal duration. */
  ampSustainFrac: number;
  /** Slight detune (cents) on the bite layer for thickness. */
  biteDetune: number;
  masterGain: number;
  rationale: string;
}

// Option 1 — rounded sub with a clean square-edge bite and a snappy but short
// filter pop. Tight, polished, "Jan Hammer pluck-bass" feel; sits cleanly under
// the straight LinnDrum beat.
const BASS_1: BassStyle = {
  biteWave: "square",
  subGain: 0.5,
  biteGain: 0.18,
  filterFloor: 320,
  filterPeak: 2200,
  filterDecay: 0.09,
  filterQ: 4,
  ampSustainFrac: 0.85,
  biteDetune: 6,
  masterGain: 0.5,
  rationale:
    "Rounded sine sub + clean square-edge bite with a short, snappy filter " +
    "pop. Tight polished pluck-bass; sits cleanly under the straight beat.",
};

// Option 2 — saw bite, deeper sub, slower filter sweep so the bite blooms
// (more vowel-y / acidic). Growlier and more synthwave-lead-adjacent.
const BASS_2: BassStyle = {
  biteWave: "sawtooth",
  subGain: 0.46,
  biteGain: 0.26,
  filterFloor: 240,
  filterPeak: 2800,
  filterDecay: 0.18,
  filterQ: 7,
  ampSustainFrac: 0.92,
  biteDetune: 10,
  masterGain: 0.48,
  rationale:
    "Saw bite over a deep sub with a slower, resonant filter bloom — growlier " +
    "and acidic, leaning synthwave-lead. More vowel in the attack.",
};

// Option 3 — square bite an octave up doubling, very short amp (plucky/staccato),
// minimal sustain. Percussive and dry — leaves space for the sparse 808 beat.
const BASS_3: BassStyle = {
  biteWave: "square",
  subGain: 0.55,
  biteGain: 0.14,
  filterFloor: 420,
  filterPeak: 1800,
  filterDecay: 0.05,
  filterQ: 3,
  ampSustainFrac: 0.45,
  biteDetune: 4,
  masterGain: 0.52,
  rationale:
    "Plucky staccato: short amp envelope, fast tight filter, minimal sustain. " +
    "Percussive and dry, leaving space for sparse/heavy beats.",
};

const STYLES: Record<EddieBassVariant, BassStyle> = {
  "option-1": BASS_1,
  "option-2": BASS_2,
  "option-3": BASS_3,
};

export class EddieBass {
  private ctx: AudioContext;
  private conductor: Conductor;
  private style: BassStyle;
  private bassline: BasslineNote[];

  private master: GainNode;
  private offBeat: (() => void) | null = null;
  private liveOscs: OscillatorNode[] = [];
  // Avoid double-scheduling a measure when overlapping lookahead windows deliver
  // the same downbeat twice. Keyed by absolute beat index.
  private scheduledDownbeats = new Set<number>();
  private started = false;

  constructor(conductor: Conductor, variant: EddieBassVariant, bassline: BasslineNote[]) {
    this.ctx = getAudioContext();
    this.conductor = conductor;
    this.style = STYLES[variant];
    this.bassline = bassline;

    this.master = this.ctx.createGain();
    this.master.gain.value = this.style.masterGain;
    this.master.connect(this.ctx.destination);
  }

  get rationale(): string {
    return this.style.rationale;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.offBeat = this.conductor.onBeat((info) => this.handleBeat(info));
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    if (this.offBeat) {
      this.offBeat();
      this.offBeat = null;
    }
    const now = this.ctx.currentTime;
    try {
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(this.master.gain.value, now);
      this.master.gain.linearRampToValueAtTime(0.0001, now + 0.05);
    } catch {
      // ignore
    }
    for (const osc of this.liveOscs) {
      try { osc.stop(now + 0.06); } catch { /* already stopped */ }
      try { osc.disconnect(); } catch { /* ignore */ }
    }
    this.liveOscs = [];
    window.setTimeout(() => {
      try { this.master.disconnect(); } catch { /* ignore */ }
    }, 120);
    this.scheduledDownbeats.clear();
  }

  setMuted(muted: boolean): void {
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.linearRampToValueAtTime(
      muted ? 0.0001 : this.style.masterGain,
      now + 0.05,
    );
  }

  // On each measure downbeat (in preroll/countIn/playing), schedule all bass
  // notes whose bassline measure matches this measure's loop position.
  private handleBeat(info: BeatInfo): void {
    if (info.phase === "idle" || info.phase === "done") return;
    if (info.beatInPhase % 4 !== 0) return; // only act on the bar's downbeat
    if (this.scheduledDownbeats.has(info.beat)) return;
    this.scheduledDownbeats.add(info.beat);
    if (this.scheduledDownbeats.size > 128) {
      const first = this.scheduledDownbeats.values().next().value;
      if (first !== undefined) this.scheduledDownbeats.delete(first);
    }

    const loopMeasure = this.measureForBeat(info);
    if (loopMeasure < 0) return;

    const beatDur = 60 / this.conductor.currentBpm;
    const notes = this.bassline.filter((n) => n.measure === loopMeasure);
    // Determine each note's duration: until the next note in the bar, else end
    // of the bar.
    const sorted = [...notes].sort((a, b) => a.beat - b.beat);
    for (let i = 0; i < sorted.length; i++) {
      const note = sorted[i];
      const nextBeat = i + 1 < sorted.length ? sorted[i + 1].beat : 4;
      const startTime = info.time + note.beat * beatDur;
      const durSec = (nextBeat - note.beat) * beatDur;
      this.scheduleNote(note.pitchClass, startTime, durSec);
    }
  }

  // Map a beat to the 0..3 bassline loop measure. The bassline pattern loops
  // every 4 measures across intro + scored measures regardless of phase, so we
  // use the absolute measure index since the play start (count-in measure 0
  // through the final scored measure) modulo 4.
  private measureForBeat(info: BeatInfo): number {
    // beatInPhase is the beat within the current phase; combined with the phase
    // we can derive an absolute measure. For preroll (debug bench / settings
    // audition) there is no play anchor, so loop off the raw beat counter.
    if (info.phase === "preroll") {
      return Math.floor(info.beat / 4) % 4;
    }
    if (info.phase === "countIn") {
      // beatInPhase counts 0..(countInBeats-1) across the 4 intro measures.
      return Math.floor(info.beatInPhase / 4) % 4;
    }
    if (info.phase === "playing") {
      // measureInPlay is the scored measure index; loop every 4.
      return ((info.measureInPlay % 4) + 4) % 4;
    }
    return -1;
  }

  private scheduleNote(pc: PitchClass, startTime: number, durSec: number): void {
    const midi = pitchClassToBassMidi(pc);
    const freq = midiToFreq(midi);
    const s = this.style;
    const ampDur = Math.max(0.08, durSec * s.ampSustainFrac);

    // Shared per-note lowpass with a fast envelope = the BITE.
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = s.filterQ;
    filter.frequency.setValueAtTime(s.filterPeak, startTime);
    filter.frequency.exponentialRampToValueAtTime(s.filterFloor, startTime + s.filterDecay);

    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(0.0001, startTime);
    amp.gain.linearRampToValueAtTime(1.0, startTime + 0.008); // fast attack snap
    amp.gain.setValueAtTime(1.0, startTime + Math.min(0.05, ampDur * 0.3));
    amp.gain.exponentialRampToValueAtTime(0.0001, startTime + ampDur);
    filter.connect(amp).connect(this.master);

    // Sub layer (the body).
    const sub = this.ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(freq, startTime);
    const subGain = this.ctx.createGain();
    subGain.gain.value = s.subGain;
    sub.connect(subGain).connect(filter);
    sub.start(startTime);
    sub.stop(startTime + ampDur + 0.05);
    this.track(sub);

    // Bite layer (the edge), slightly detuned.
    const bite = this.ctx.createOscillator();
    bite.type = s.biteWave;
    bite.frequency.setValueAtTime(freq, startTime);
    bite.detune.setValueAtTime(s.biteDetune, startTime);
    const biteGain = this.ctx.createGain();
    biteGain.gain.value = s.biteGain;
    bite.connect(biteGain).connect(filter);
    bite.start(startTime);
    bite.stop(startTime + ampDur + 0.05);
    this.track(bite);
  }

  private track(osc: OscillatorNode): void {
    this.liveOscs.push(osc);
    osc.onended = () => {
      const i = this.liveOscs.indexOf(osc);
      if (i >= 0) this.liveOscs.splice(i, 1);
      try { osc.disconnect(); } catch { /* ignore */ }
    };
    if (this.liveOscs.length > 128) {
      const old = this.liveOscs.shift();
      if (old) {
        try { old.stop(); } catch { /* ignore */ }
        try { old.disconnect(); } catch { /* ignore */ }
      }
    }
  }
}
