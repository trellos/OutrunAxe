// EddieBeat — 80s drum-machine beat scheduler for Infinite Eddie.
//
// This is Sound's OWN synthesis, independent of combat's DrumSynth (which the
// SACRED RULE forbids repurposing). It subscribes to the Conductor's onBeat and
// schedules kick/snare/hat/clap/tom voices at exact AudioContext-clock times
// (BeatInfo.time), so timing stays sample-accurate regardless of JS jitter —
// mirroring BackingTrack's scheduling discipline.
//
// Unlike combat (which beeps the count-in via BeepSynth), Eddie's beat plays
// drums in BOTH the countIn (the 4-measure intro IS the generated beat) and
// playing phases, and also while parked in preroll (so the settings-screen
// audition and the debug bench loop forever). See GDD §3 / §7.
//
// Three variants pick a different DrumKit + Pattern (mood/timbre/mix distinct,
// not recolors). The active variant on each `sound/beat/option-N` branch wires
// itself as DEFAULT_BEAT_VARIANT here; the factory passes the requested variant
// through so the integration type surface never changes (GDD §12.3).

import { getAudioContext } from "../AudioContextSingleton";
import type { Conductor, BeatInfo } from "../Conductor";

export type EddieBeatVariant =
  | "option-1"
  | "option-2"
  | "option-3"
  | "option-4"
  | "option-5"
  | "option-6";

// ---------------------------------------------------------------------------
// Drum kit: per-voice synthesis params so each variant reads as a different
// 80s machine. All trigger methods take an absolute audio-clock time.
// ---------------------------------------------------------------------------

interface KickParams {
  startFreq: number;   // pitch at attack
  endFreq: number;     // pitch after the drop
  pitchDecay: number;  // s — how fast the pitch sweeps down
  ampDecay: number;    // s — amplitude tail
  gain: number;
  click: number;       // 0..1 amount of beater click (hp noise transient)
}

interface SnareParams {
  noiseGain: number;
  noiseHpHz: number;
  noiseDecay: number;
  toneFreq: number;
  toneGain: number;
  toneDecay: number;
}

interface HatParams {
  hpHz: number;
  gain: number;
  decay: number;        // closed-hat decay
  openDecay: number;    // open-hat decay (longer)
}

interface ClapParams {
  hpHz: number;
  gain: number;
  decay: number;
}

interface KitParams {
  kick: KickParams;
  snare: SnareParams;
  hat: HatParams;
  clap: ClapParams;
  /** Overall kit voicing colour applied at the bus filter. */
  busLowpassHz: number;
  masterGain: number;
}

class DrumKit {
  constructor(
    private ctx: AudioContext,
    private out: AudioNode,
    private p: KitParams,
    private track: (n: AudioScheduledSourceNode) => void,
  ) {}

  kick(time: number, accent = 1) {
    const k = this.p.kick;
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(k.startFreq, time);
    osc.frequency.exponentialRampToValueAtTime(k.endFreq, time + k.pitchDecay);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(k.gain * accent, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + k.ampDecay);
    osc.connect(gain).connect(this.out);
    osc.start(time);
    osc.stop(time + k.ampDecay + 0.02);
    this.track(osc);

    if (k.click > 0) {
      const noise = this.noise(0.02);
      const hp = this.ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 3000;
      const ng = this.ctx.createGain();
      ng.gain.setValueAtTime(k.click * accent, time);
      ng.gain.exponentialRampToValueAtTime(0.0001, time + 0.02);
      noise.connect(hp).connect(ng).connect(this.out);
      noise.start(time);
      noise.stop(time + 0.03);
      this.track(noise);
    }
  }

  snare(time: number, accent = 1) {
    const s = this.p.snare;
    const noise = this.noise(s.noiseDecay + 0.05);
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = s.noiseHpHz;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(s.noiseGain * accent, time);
    ng.gain.exponentialRampToValueAtTime(0.0001, time + s.noiseDecay);
    noise.connect(hp).connect(ng).connect(this.out);
    noise.start(time);
    noise.stop(time + s.noiseDecay + 0.05);
    this.track(noise);

    const osc = this.ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(s.toneFreq, time);
    osc.frequency.exponentialRampToValueAtTime(s.toneFreq * 0.5, time + s.toneDecay);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(s.toneGain * accent, time);
    og.gain.exponentialRampToValueAtTime(0.0001, time + s.toneDecay);
    osc.connect(og).connect(this.out);
    osc.start(time);
    osc.stop(time + s.toneDecay + 0.02);
    this.track(osc);
  }

  hat(time: number, open = false, accent = 1) {
    const h = this.p.hat;
    const decay = open ? h.openDecay : h.decay;
    const noise = this.noise(decay + 0.02);
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = h.hpHz;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(h.gain * accent, time);
    ng.gain.exponentialRampToValueAtTime(0.0001, time + decay);
    noise.connect(hp).connect(ng).connect(this.out);
    noise.start(time);
    noise.stop(time + decay + 0.02);
    this.track(noise);
  }

  clap(time: number, accent = 1) {
    const c = this.p.clap;
    // Classic 80s clap = several quick noise bursts + a tail. BAND-passed around
    // a low-mid centre (not high-passed) so it reads as a hand "pap" with body,
    // rather than the bright top-end hiss that made it sound like a hi-hat.
    const offsets = [0, 0.01, 0.02, 0.035];
    for (let i = 0; i < offsets.length; i++) {
      const last = i === offsets.length - 1;
      const t = time + offsets[i];
      const dur = last ? c.decay : 0.02;
      const noise = this.noise(dur + 0.02);
      const bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = c.hpHz; // band centre (low-mid → clappy body)
      bp.Q.value = 1.0;
      // Tame any residual fizz above the band so it never reads as a hat.
      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = Math.max(2200, c.hpHz * 2.2);
      const ng = this.ctx.createGain();
      ng.gain.setValueAtTime(c.gain * accent * (last ? 1 : 0.7), t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      noise.connect(bp).connect(lp).connect(ng).connect(this.out);
      noise.start(t);
      noise.stop(t + dur + 0.02);
      this.track(noise);
    }
  }

  private noise(durationSec: number): AudioBufferSourceNode {
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * durationSec));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }
}

// ---------------------------------------------------------------------------
// Patterns — one step grid per 16th note of a bar (16 steps). A step entry
// names which voices fire and at what accent. Each variant pairs a kit with a
// pattern to define its feel.
// ---------------------------------------------------------------------------

type Voice = "kick" | "snare" | "hat" | "openhat" | "clap";

interface Step {
  voices: Partial<Record<Voice, number>>; // voice -> accent (0..1.x)
}

interface BeatStyle {
  kit: KitParams;
  /** 16 entries, one per 16th. Empty object = rest. */
  steps: Step[];
  /** Optional swing: shifts odd 16th-note positions later by this fraction of
   *  a 16th (0 = straight, 0.6 = heavy shuffle). */
  swing: number;
  rationale: string;
}

const HAT = (a = 0.6): Step => ({ voices: { hat: a } });
const REST: Step = { voices: {} };

// Option 1 — straight, gated 8th-note LinnDrum: punchy kick, crisp gated snare
// on 2 & 4, steady 8th hats. Bright, mixed-forward, no swing. The "anthemic
// arena" 80s feel.
const STYLE_1: BeatStyle = {
  swing: 0,
  rationale:
    "Straight gated 8ths, LinnDrum-style: punchy sine kick on 1 & 3, crisp " +
    "gated snare on 2 & 4, steady bright 8th hats. Forward, dry, arena mix.",
  kit: {
    busLowpassHz: 14000,
    masterGain: 0.6,
    kick: { startFreq: 150, endFreq: 48, pitchDecay: 0.08, ampDecay: 0.28, gain: 0.95, click: 0.25 },
    snare: { noiseGain: 0.6, noiseHpHz: 1800, noiseDecay: 0.16, toneFreq: 240, toneGain: 0.3, toneDecay: 0.09 },
    hat: { hpHz: 8000, gain: 0.28, decay: 0.035, openDecay: 0.12 },
    clap: { hpHz: 1500, gain: 0.4, decay: 0.12 },
  },
  steps: [
    { voices: { kick: 1, hat: 0.6 } }, REST, HAT(0.4), REST,
    { voices: { snare: 1, hat: 0.6 } }, REST, HAT(0.4), REST,
    { voices: { kick: 1, hat: 0.6 } }, REST, HAT(0.4), REST,
    { voices: { snare: 1, hat: 0.6 } }, REST, HAT(0.4), REST,
  ],
};

// Option 2 — shuffled swing, Oberheim DMX-ish: warmer/darker kit, a clap
// layered on the backbeat, 16th hats with heavy swing for a head-nod groove.
const STYLE_2: BeatStyle = {
  swing: 0.55,
  rationale:
    "Shuffled swing (DMX-ish): warmer rounder kick, clap layered on the " +
    "backbeat, swung 16th hats for a head-nod groove. Darker, softer top end.",
  kit: {
    busLowpassHz: 9000,
    masterGain: 0.58,
    kick: { startFreq: 130, endFreq: 42, pitchDecay: 0.1, ampDecay: 0.34, gain: 0.9, click: 0.12 },
    snare: { noiseGain: 0.42, noiseHpHz: 1400, noiseDecay: 0.14, toneFreq: 200, toneGain: 0.34, toneDecay: 0.1 },
    hat: { hpHz: 6500, gain: 0.22, decay: 0.04, openDecay: 0.16 },
    clap: { hpHz: 1200, gain: 0.5, decay: 0.16 },
  },
  steps: [
    { voices: { kick: 1, hat: 0.5 } }, HAT(0.3), HAT(0.45), HAT(0.3),
    { voices: { snare: 0.9, clap: 0.8, hat: 0.5 } }, HAT(0.3), HAT(0.45), HAT(0.3),
    { voices: { kick: 0.8, hat: 0.5 } }, HAT(0.3), { voices: { kick: 0.6, hat: 0.45 } }, HAT(0.3),
    { voices: { snare: 0.9, clap: 0.8, hat: 0.5 } }, HAT(0.3), { voices: { openhat: 0.5 } }, HAT(0.3),
  ],
};

// Option 3 — sparse, boom-bap-ish 808: long pitched 808 kick, big rimmy snare,
// minimal hats, lots of space. Sub-heavy, lazy, the "late-night VHS" feel.
const STYLE_3: BeatStyle = {
  swing: 0.25,
  rationale:
    "Sparse 808 boom-bap: long pitched sub kick, big rimmy snare, minimal " +
    "hats and lots of space. Sub-heavy, lazy, late-night VHS mood.",
  kit: {
    busLowpassHz: 7000,
    masterGain: 0.62,
    kick: { startFreq: 110, endFreq: 36, pitchDecay: 0.16, ampDecay: 0.5, gain: 1.0, click: 0.06 },
    snare: { noiseGain: 0.5, noiseHpHz: 1100, noiseDecay: 0.2, toneFreq: 180, toneGain: 0.42, toneDecay: 0.14 },
    hat: { hpHz: 9000, gain: 0.18, decay: 0.03, openDecay: 0.1 },
    clap: { hpHz: 1300, gain: 0.36, decay: 0.14 },
  },
  steps: [
    { voices: { kick: 1, hat: 0.4 } }, REST, REST, HAT(0.3),
    { voices: { snare: 1 } }, REST, HAT(0.3), REST,
    REST, REST, { voices: { kick: 0.85, hat: 0.4 } }, REST,
    { voices: { snare: 1 } }, REST, { voices: { openhat: 0.4 } }, REST,
  ],
};

// Option 4 — shuffle. A heavy triplet swing: kick on 1 & 3, snare backbeat on
// 2 & 4, and a hat on the swung "a" of every beat so the gallop reads as a
// classic 12/8-ish shuffle. Warm, bouncy, blues-rock pocket.
const OPEN = (a = 0.5): Step => ({ voices: { openhat: a } });
const STYLE_4: BeatStyle = {
  swing: 0.62,
  rationale:
    "Shuffle: heavy triplet swing — kick on 1 & 3, snare on 2 & 4, hats on the " +
    "swung 'a' of each beat for a bouncy 12/8 blues-rock gallop.",
  kit: {
    busLowpassHz: 10000,
    masterGain: 0.58,
    kick: { startFreq: 135, endFreq: 44, pitchDecay: 0.09, ampDecay: 0.3, gain: 0.92, click: 0.16 },
    snare: { noiseGain: 0.5, noiseHpHz: 1600, noiseDecay: 0.15, toneFreq: 220, toneGain: 0.32, toneDecay: 0.1 },
    hat: { hpHz: 7500, gain: 0.24, decay: 0.038, openDecay: 0.14 },
    clap: { hpHz: 1400, gain: 0.44, decay: 0.14 },
  },
  steps: [
    { voices: { kick: 1, hat: 0.6 } }, REST, REST, HAT(0.45),
    { voices: { snare: 1, hat: 0.6 } }, REST, REST, HAT(0.45),
    { voices: { kick: 1, hat: 0.6 } }, REST, REST, HAT(0.45),
    { voices: { snare: 1, hat: 0.6 } }, REST, REST, HAT(0.45),
  ],
};

// Option 5 — disco. Four-on-the-floor kick on every quarter, the signature open
// "tss" hat on every off-beat 8th, and a clap+snare backbeat on 2 & 4. Bright,
// straight, dancefloor-forward.
const STYLE_5: BeatStyle = {
  swing: 0,
  rationale:
    "Disco: four-on-the-floor kick on every quarter, open-hat 'tss' on every " +
    "off-beat, clap + snare backbeat on 2 & 4. Bright, straight, dancefloor.",
  kit: {
    busLowpassHz: 13000,
    masterGain: 0.58,
    kick: { startFreq: 140, endFreq: 46, pitchDecay: 0.08, ampDecay: 0.26, gain: 0.95, click: 0.2 },
    snare: { noiseGain: 0.5, noiseHpHz: 1700, noiseDecay: 0.15, toneFreq: 230, toneGain: 0.3, toneDecay: 0.09 },
    hat: { hpHz: 8500, gain: 0.26, decay: 0.035, openDecay: 0.18 },
    // Disco clap: lower band centre + a touch more body/tail so it reads as a
    // clap, clearly distinct from the open-hat "tss".
    clap: { hpHz: 1000, gain: 0.6, decay: 0.18 },
  },
  steps: [
    { voices: { kick: 1, hat: 0.4 } }, REST, OPEN(0.5), REST,
    { voices: { kick: 1, snare: 0.8, clap: 0.8 } }, REST, OPEN(0.5), REST,
    { voices: { kick: 1, hat: 0.4 } }, REST, OPEN(0.5), REST,
    { voices: { kick: 1, snare: 0.8, clap: 0.8 } }, REST, OPEN(0.5), REST,
  ],
};

// Option 6 — danceable house. Four-on-the-floor kick, a clap on 2 & 4, busy 16th
// closed hats with offbeat open hats and a touch of swing. Modern, groovy, the
// "hands-up" house pocket.
const STYLE_6: BeatStyle = {
  swing: 0.15,
  rationale:
    "Danceable house: four-on-the-floor kick, clap on 2 & 4, busy swung 16th " +
    "hats with offbeat open hats. Modern, groovy, hands-up dancefloor.",
  kit: {
    busLowpassHz: 12000,
    masterGain: 0.56,
    kick: { startFreq: 145, endFreq: 44, pitchDecay: 0.09, ampDecay: 0.3, gain: 0.96, click: 0.14 },
    snare: { noiseGain: 0.44, noiseHpHz: 1600, noiseDecay: 0.14, toneFreq: 210, toneGain: 0.3, toneDecay: 0.09 },
    hat: { hpHz: 8000, gain: 0.2, decay: 0.03, openDecay: 0.15 },
    clap: { hpHz: 1400, gain: 0.5, decay: 0.15 },
  },
  steps: [
    { voices: { kick: 1, hat: 0.5 } }, HAT(0.3), OPEN(0.45), HAT(0.3),
    { voices: { kick: 1, clap: 0.8, hat: 0.5 } }, HAT(0.3), OPEN(0.45), HAT(0.3),
    { voices: { kick: 1, hat: 0.5 } }, HAT(0.3), OPEN(0.45), HAT(0.3),
    { voices: { kick: 1, clap: 0.8, hat: 0.5 } }, HAT(0.3), OPEN(0.45), HAT(0.3),
  ],
};

const STYLES: Record<EddieBeatVariant, BeatStyle> = {
  "option-1": STYLE_1,
  "option-2": STYLE_2,
  "option-3": STYLE_3,
  "option-4": STYLE_4,
  "option-5": STYLE_5,
  "option-6": STYLE_6,
};

// ---------------------------------------------------------------------------
// EddieBeat
// ---------------------------------------------------------------------------

export class EddieBeat {
  private ctx: AudioContext;
  private conductor: Conductor;
  private style: BeatStyle;

  private master: GainNode;
  private busFilter: BiquadFilterNode;
  private offBeat: (() => void) | null = null;
  private liveSources: AudioScheduledSourceNode[] = [];
  private kit: DrumKit;
  // Track absolute beat times already scheduled to avoid double-firing when
  // overlapping lookahead windows deliver the same beat twice.
  private scheduledBeats = new Set<number>();
  private started = false;

  constructor(conductor: Conductor, variant: EddieBeatVariant) {
    this.ctx = getAudioContext();
    this.conductor = conductor;
    this.style = STYLES[variant];

    this.master = this.ctx.createGain();
    this.master.gain.value = this.style.kit.masterGain;
    this.master.connect(this.ctx.destination);

    this.busFilter = this.ctx.createBiquadFilter();
    this.busFilter.type = "lowpass";
    this.busFilter.frequency.value = this.style.kit.busLowpassHz;
    this.busFilter.Q.value = 0.4;
    this.busFilter.connect(this.master);

    this.kit = new DrumKit(this.ctx, this.busFilter, this.style.kit, (n) => this.track(n));
  }

  /** The picked variant's mood/timbre/mix rationale (for the debug HUD). */
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
    for (const src of this.liveSources) {
      try { src.stop(now + 0.06); } catch { /* already stopped */ }
      try { src.disconnect(); } catch { /* ignore */ }
    }
    this.liveSources = [];
    try { this.busFilter.disconnect(); } catch { /* ignore */ }
    window.setTimeout(() => {
      try { this.master.disconnect(); } catch { /* ignore */ }
    }, 120);
    this.scheduledBeats.clear();
  }

  setMuted(muted: boolean): void {
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.linearRampToValueAtTime(
      muted ? 0.0001 : this.style.kit.masterGain,
      now + 0.05,
    );
  }

  // Schedule one bar's worth of 16th-note steps anchored to this beat's time.
  // Drums play in preroll, countIn, AND playing (the intro IS the beat).
  private handleBeat(info: BeatInfo): void {
    if (info.phase === "idle" || info.phase === "done") return;
    if (this.scheduledBeats.has(info.beat)) return;
    this.scheduledBeats.add(info.beat);
    if (this.scheduledBeats.size > 256) {
      // Bound the set so a long park-in-preroll session doesn't grow forever.
      const first = this.scheduledBeats.values().next().value;
      if (first !== undefined) this.scheduledBeats.delete(first);
    }

    const beatDur = 60 / this.conductor.currentBpm;
    const sixteenth = beatDur / 4;
    const beatInBar = info.beatInPhase % 4;

    // Fire the 4 sixteenth steps that fall inside this beat.
    for (let s = 0; s < 4; s++) {
      const stepIdx = beatInBar * 4 + s;
      const step = this.style.steps[stepIdx];
      if (!step) continue;
      // Swing pushes the off-16ths (odd positions) later.
      const swung = s % 2 === 1 ? this.style.swing * sixteenth : 0;
      const t = info.time + s * sixteenth + swung;
      this.fireStep(step, t);
    }
  }

  private fireStep(step: Step, time: number): void {
    const v = step.voices;
    if (v.kick !== undefined) this.kit.kick(time, v.kick);
    if (v.snare !== undefined) this.kit.snare(time, v.snare);
    if (v.clap !== undefined) this.kit.clap(time, v.clap);
    if (v.hat !== undefined) this.kit.hat(time, false, v.hat);
    if (v.openhat !== undefined) this.kit.hat(time, true, v.openhat);
  }

  private track(src: AudioScheduledSourceNode): void {
    this.liveSources.push(src);
    src.onended = () => {
      const i = this.liveSources.indexOf(src);
      if (i >= 0) this.liveSources.splice(i, 1);
      try { src.disconnect(); } catch { /* ignore */ }
    };
    if (this.liveSources.length > 512) {
      const old = this.liveSources.shift();
      if (old) {
        try { old.stop(); } catch { /* ignore */ }
        try { old.disconnect(); } catch { /* ignore */ }
      }
    }
  }
}
