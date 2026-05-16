// Backing-track synth: bass + pad (+ optional arp) per level. Subscribes to
// the conductor's beat events and schedules a chord change on beat 0 of each
// measure during the "playing" phase. All oscillator timings are anchored to
// the audio clock via BeatInfo.time so they stay sample-accurate even if JS
// jitter delays the callback itself.

import { getAudioContext } from "./AudioContextSingleton";
import type { Conductor, BeatInfo } from "./Conductor";

export interface BackingTrackOptions {
  levelName: string;
  conductor: Conductor;
}

// Each chord is the root midi note + an array of midi offsets (semitones)
// describing the upper voicing for the pad. Bass plays only the root.
interface Chord {
  rootMidi: number;
  padOffsets: number[]; // semitone offsets relative to rootMidi, in pad octave
}

interface Progression {
  chords: Chord[];      // four chords, one per measure
  bassWave: OscillatorType;
  padWave: OscillatorType;
  padDetuneCents: number;
  bassLowpass: number;
  padLowpass: number;
  arp: boolean;
}

// midi: C4 = 60. We pick bass roots in octave 2-3 and pad voicings in 4-5.
function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Returns triad offsets (root, third, fifth) plus an octave for a 4-note pad.
function major(): number[] { return [0, 4, 7, 12]; }
function minor(): number[] { return [0, 3, 7, 12]; }

function buildProgression(levelName: string): Progression {
  if (levelName === "Strip Mall Sunset") {
    // Cmaj | Am | Fmaj | G   (mellow)
    return {
      chords: [
        { rootMidi: 36, padOffsets: major() },         // C2 / Cmaj pad
        { rootMidi: 33, padOffsets: minor() },         // A2 / Am pad
        { rootMidi: 29, padOffsets: major() },         // F2 / Fmaj pad
        { rootMidi: 31, padOffsets: major() },         // G2 / G pad
      ],
      bassWave: "sawtooth",
      padWave: "triangle",
      padDetuneCents: 6,
      bassLowpass: 800,
      padLowpass: 2200,
      arp: false,
    };
  }
  if (levelName === "Subway Mezzanine") {
    // Gm | Dm | Eb | F   (tense)
    return {
      chords: [
        { rootMidi: 31, padOffsets: minor() },         // G2 / Gm
        { rootMidi: 26, padOffsets: minor() },         // D2 / Dm
        { rootMidi: 27, padOffsets: major() },         // Eb2 / Eb
        { rootMidi: 29, padOffsets: major() },         // F2 / F
      ],
      bassWave: "square",
      padWave: "triangle",
      padDetuneCents: 8,
      bassLowpass: 700,
      padLowpass: 1800,
      arp: false,
    };
  }
  // Default: Rooftop Skyline   Em | Cmaj | G | Bm   (anthemic)
  return {
    chords: [
      { rootMidi: 28, padOffsets: minor() },           // E2 / Em
      { rootMidi: 36, padOffsets: major() },           // C2 / Cmaj
      { rootMidi: 31, padOffsets: major() },           // G2 / G
      { rootMidi: 35, padOffsets: minor() },           // B2 / Bm
    ],
    bassWave: "sawtooth",
    padWave: "sine",
    padDetuneCents: 10,
    bassLowpass: 900,
    padLowpass: 2600,
    arp: true,
  };
}

export class BackingTrack {
  private ctx: AudioContext;
  private conductor: Conductor;
  private prog: Progression;

  // Master gain feeds destination directly (the Conductor's master is private
  // to that instance; we have our own bus so setMuted is independent).
  private master: GainNode;
  private bassBus: GainNode;          // duckable bus for bass (sidechain dip)
  private bassFilter: BiquadFilterNode;
  private padFilter: BiquadFilterNode;
  private padLfo: OscillatorNode | null = null;
  private padLfoGain: GainNode | null = null;

  private offBeat: (() => unknown) | null = null;
  // Tracked oscillators so we can stop them on tear-down.
  private liveOscs: OscillatorNode[] = [];
  // Track which measure-start times have already been scheduled, to avoid
  // double-scheduling when multiple beat callbacks land for the same bar.
  private scheduledMeasures = new Set<number>();
  private started = false;

  constructor(opts: BackingTrackOptions) {
    this.ctx = getAudioContext();
    this.conductor = opts.conductor;
    this.prog = buildProgression(opts.levelName);

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);

    this.bassFilter = this.ctx.createBiquadFilter();
    this.bassFilter.type = "lowpass";
    this.bassFilter.frequency.value = this.prog.bassLowpass;
    this.bassFilter.Q.value = 0.7;

    this.bassBus = this.ctx.createGain();
    this.bassBus.gain.value = 1.0;
    this.bassBus.connect(this.bassFilter).connect(this.master);

    this.padFilter = this.ctx.createBiquadFilter();
    this.padFilter.type = "lowpass";
    this.padFilter.frequency.value = this.prog.padLowpass;
    this.padFilter.Q.value = 0.6;
    this.padFilter.connect(this.master);

    // Slow LFO sweeping the pad lowpass cutoff for movement.
    this.padLfo = this.ctx.createOscillator();
    this.padLfo.type = "sine";
    this.padLfo.frequency.value = 0.12;
    this.padLfoGain = this.ctx.createGain();
    this.padLfoGain.gain.value = this.prog.padLowpass * 0.25;
    this.padLfo.connect(this.padLfoGain).connect(this.padFilter.frequency);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    try {
      this.padLfo?.start();
    } catch {
      // Already started in a prior life; ignore.
    }
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
    // Fade master quickly to avoid clicks, then stop all oscillators.
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
    if (this.padLfo) {
      try { this.padLfo.stop(now + 0.06); } catch { /* ignore */ }
      try { this.padLfo.disconnect(); } catch { /* ignore */ }
      this.padLfo = null;
    }
    if (this.padLfoGain) {
      try { this.padLfoGain.disconnect(); } catch { /* ignore */ }
      this.padLfoGain = null;
    }
    try { this.bassBus.disconnect(); } catch { /* ignore */ }
    try { this.bassFilter.disconnect(); } catch { /* ignore */ }
    try { this.padFilter.disconnect(); } catch { /* ignore */ }
    // Schedule master disconnect after the fade so the ramp can complete.
    window.setTimeout(() => {
      try { this.master.disconnect(); } catch { /* ignore */ }
    }, 120);
    this.scheduledMeasures.clear();
  }

  setMuted(muted: boolean): void {
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.linearRampToValueAtTime(muted ? 0.0001 : 0.5, now + 0.05);
  }

  private handleBeat(info: BeatInfo): void {
    if (info.phase !== "playing") return;
    if (info.beatInPhase !== 0) {
      // On every kick (beats 0 and 2), apply a sidechain-style duck. The
      // beat-0 duck is folded into the chord scheduling below (so it lines up
      // with the new bass note). Here we only need to handle beat 2.
      if (info.beatInPhase === 2) this.duckBass(info.time);
      // Optional arp on every eighth: schedule the next 8th here on each beat.
      if (this.prog.arp) this.scheduleArpForBeat(info);
      return;
    }
    // Beat 0 of a new measure. measureInPlay is 0..3.
    const measureIdx = info.measureInPlay;
    if (measureIdx < 0) return;
    if (this.scheduledMeasures.has(measureIdx)) return;
    this.scheduledMeasures.add(measureIdx);

    const chord = this.prog.chords[measureIdx % this.prog.chords.length];
    const measureDur = this.conductor.measureDuration();
    this.scheduleBass(chord, info.time, measureDur);
    this.schedulePad(chord, info.time, measureDur);
    this.duckBass(info.time);

    if (this.prog.arp) {
      this.scheduleArpForBeat(info);
    }
  }

  private scheduleBass(chord: Chord, startTime: number, measureDur: number): void {
    const osc = this.ctx.createOscillator();
    osc.type = this.prog.bassWave;
    osc.frequency.setValueAtTime(midiToFreq(chord.rootMidi), startTime);

    const gain = this.ctx.createGain();
    // ADSR — quick attack, sustain across the bar, gentle release.
    const peak = 0.42;
    const sustain = 0.28;
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(peak, startTime + 0.02);
    gain.gain.linearRampToValueAtTime(sustain, startTime + 0.18);
    gain.gain.setValueAtTime(sustain, startTime + measureDur - 0.12);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + measureDur - 0.005);

    osc.connect(gain).connect(this.bassBus);
    osc.start(startTime);
    osc.stop(startTime + measureDur + 0.05);
    this.trackOsc(osc);
  }

  private schedulePad(chord: Chord, startTime: number, measureDur: number): void {
    // One voice per chord tone, slightly detuned for chorus.
    for (let i = 0; i < chord.padOffsets.length; i++) {
      const offset = chord.padOffsets[i];
      // Pad lives roughly an octave above the bass root, in octave 4-5 range.
      const padMidi = chord.rootMidi + 24 + offset;
      const detune = (i - (chord.padOffsets.length - 1) / 2) * this.prog.padDetuneCents;

      const osc = this.ctx.createOscillator();
      osc.type = this.prog.padWave;
      osc.frequency.setValueAtTime(midiToFreq(padMidi), startTime);
      osc.detune.setValueAtTime(detune, startTime);

      const gain = this.ctx.createGain();
      const peak = 0.12;
      const sustain = 0.08;
      // Slow attack ~200ms, slow release ~400ms.
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.linearRampToValueAtTime(peak, startTime + 0.2);
      gain.gain.linearRampToValueAtTime(sustain, startTime + 0.45);
      gain.gain.setValueAtTime(sustain, startTime + measureDur - 0.4);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + measureDur + 0.05);

      osc.connect(gain).connect(this.padFilter);
      osc.start(startTime);
      osc.stop(startTime + measureDur + 0.1);
      this.trackOsc(osc);
    }
  }

  private scheduleArpForBeat(info: BeatInfo): void {
    if (info.measureInPlay < 0) return;
    const chord = this.prog.chords[info.measureInPlay % this.prog.chords.length];
    const beatDur = 60 / this.conductor.currentBpm;
    const half = beatDur / 2;
    // Two eighth notes per beat. Step through chord tones based on
    // (beatInPhase * 2 + subdivision).
    for (let sub = 0; sub < 2; sub++) {
      const stepIndex = info.beatInPhase * 2 + sub;
      const tone = chord.padOffsets[stepIndex % chord.padOffsets.length];
      const midi = chord.rootMidi + 24 + tone + 12; // octave above pad
      const t = info.time + sub * half;
      this.scheduleArpNote(midi, t, half * 0.7);
    }
  }

  private scheduleArpNote(midi: number, startTime: number, durSec: number): void {
    const osc = this.ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(midiToFreq(midi), startTime);

    const gain = this.ctx.createGain();
    const peak = 0.09;
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(peak, startTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durSec);

    osc.connect(gain).connect(this.master);
    osc.start(startTime);
    osc.stop(startTime + durSec + 0.02);
    this.trackOsc(osc);
  }

  private duckBass(atTime: number): void {
    // Sidechain-style dip on the bass bus: drop to ~0.45 then recover over
    // ~150ms. Anchored to the kick's audio-clock time.
    const g = this.bassBus.gain;
    try {
      g.cancelScheduledValues(atTime);
      g.setValueAtTime(1.0, Math.max(0, atTime - 0.001));
      g.linearRampToValueAtTime(0.45, atTime + 0.02);
      g.linearRampToValueAtTime(1.0, atTime + 0.15);
    } catch {
      // ignore — context may be in an unusual state
    }
  }

  private trackOsc(osc: OscillatorNode): void {
    this.liveOscs.push(osc);
    osc.onended = () => {
      const i = this.liveOscs.indexOf(osc);
      if (i >= 0) this.liveOscs.splice(i, 1);
      try { osc.disconnect(); } catch { /* ignore */ }
    };
    // Cap tracked list so a long session doesn't grow unbounded.
    if (this.liveOscs.length > 256) {
      const old = this.liveOscs.shift();
      if (old) {
        try { old.stop(); } catch { /* ignore */ }
        try { old.disconnect(); } catch { /* ignore */ }
      }
    }
  }
}
