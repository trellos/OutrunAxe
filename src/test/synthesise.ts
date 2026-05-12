// Synthesised audio test signals for the verifier.
//
// These aren't trying to sound like a guitar — they're trying to *test the
// algorithm*. Each signal has a known expected event stream. Running the
// engine on the signal and comparing tells us whether bend / hammer-on /
// fast-tempo handling actually works.
//
// All produce a `{ audio: Float32Array, sampleRate, expected }` triple.

const DEFAULT_SAMPLE_RATE = 48000;
const COUNT_IN_BEATS = 4;

const F_SHARP_4 = 369.99;
const G_SHARP_4 = 415.30;
const A_4 = 440.00;
const C_SHARP_4 = 277.18;

export interface SynthSignal {
  audio: Float32Array;
  sampleRate: number;
  expected: ExpectedNote[];
  /** Audio time at which the player's first note begins. */
  playStartSec: number;
}

export interface ExpectedNote {
  /** Onset time (s, audio-clock relative to start of audio buffer). */
  time: number;
  /** Pitch class — verifier checks octave-agnostically. */
  pitchClass: string;
  /** True for hammer-ons / pull-offs (no audio attack click). */
  synthetic?: boolean;
}

/**
 * Sample-by-sample additive synthesis of a "plucked" tone. Fundamental + a
 * few harmonics, exponential amplitude decay, optional brief attack noise.
 */
function pluckedNote(
  freqFn: (t: number) => number,
  durationSec: number,
  options: {
    sampleRate: number;
    /** Fast initial decay tau (~30-50ms is realistic for plucked guitar). */
    fastTau?: number;
    /** Slow ring-out tau (~0.4-1.5s). */
    slowTau?: number;
    /** Mix of fast vs slow components (0..1). */
    fastMix?: number;
    /** Attack-burst amplitude — tiny burst of broadband noise at t=0. */
    attackNoise?: number;
    /** Whether to include the attack burst (false for hammer-on, pull-off). */
    hasAttack?: boolean;
  },
): Float32Array {
  const sr = options.sampleRate;
  // Double-exponential decay: a fast component captures the immediate decay
  // after the pluck, the slow component is the sustained ring-out. Real
  // guitar signals sit between these two.
  const fastTau = options.fastTau ?? 0.04;
  const slowTau = options.slowTau ?? 0.6;
  const fastMix = options.fastMix ?? 0.7;
  const attackNoise = options.attackNoise ?? 0.15;
  const hasAttack = options.hasAttack ?? true;
  const samples = Math.floor(durationSec * sr);
  const out = new Float32Array(samples);

  // Harmonic stack (relative amplitudes typical of plucked string).
  const harmonics: Array<{ ratio: number; amp: number }> = [
    { ratio: 1, amp: 1.0 },
    { ratio: 2, amp: 0.5 },
    { ratio: 3, amp: 0.3 },
    { ratio: 4, amp: 0.18 },
    { ratio: 5, amp: 0.1 },
  ];
  // Phase accumulators for each harmonic (independent so they don't beat).
  const phases = harmonics.map(() => 0);

  // Brief attack noise envelope (5ms exponential).
  const attackEnvDur = 0.005;
  const attackEnvSamples = Math.floor(attackEnvDur * sr);

  for (let i = 0; i < samples; i++) {
    const t = i / sr;
    const f = freqFn(t);
    const env = fastMix * Math.exp(-t / fastTau) + (1 - fastMix) * Math.exp(-t / slowTau);

    let s = 0;
    for (let h = 0; h < harmonics.length; h++) {
      phases[h] += (2 * Math.PI * f * harmonics[h].ratio) / sr;
      s += harmonics[h].amp * Math.sin(phases[h]);
    }
    s *= env * 0.25; // headroom

    if (hasAttack && i < attackEnvSamples) {
      // Tiny noise burst on the very first chunks — gives onset detection
      // an honest amplitude spike.
      const attackEnv = (1 - i / attackEnvSamples) * attackNoise;
      s += (Math.random() * 2 - 1) * attackEnv;
    }

    out[i] = s;
  }

  return out;
}

/** Mix a clip of audio into a buffer at a sample offset. */
function mixInto(buffer: Float32Array, clip: Float32Array, offsetSamples: number) {
  for (let i = 0; i < clip.length; i++) {
    const idx = offsetSamples + i;
    if (idx < 0 || idx >= buffer.length) continue;
    buffer[idx] += clip[i];
  }
}

/** Pure sine of a given frequency (no harmonics, no envelope) — for tone calibration. */
export function pureSine(freq: number, durationSec: number, sampleRate = DEFAULT_SAMPLE_RATE): Float32Array {
  const samples = Math.floor(durationSec * sampleRate);
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    out[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.3;
  }
  return out;
}

/**
 * 32 alternating F#4/C#4 sixteenth notes at 140 BPM, after a 4-beat count-in
 * of silence. This is the *target* test for fast-tempo handling.
 */
export function monophonic16thsAt140(sampleRate = DEFAULT_SAMPLE_RATE): SynthSignal {
  const bpm = 140;
  const beatDur = 60 / bpm;
  const sixteenthDur = beatDur / 4;
  const playStartSec = COUNT_IN_BEATS * beatDur;
  const noteCount = 32;
  const tailSec = 0.6;
  const totalDur = playStartSec + noteCount * sixteenthDur + tailSec;
  const totalSamples = Math.floor(totalDur * sampleRate);
  const audio = new Float32Array(totalSamples);
  const expected: ExpectedNote[] = [];

  for (let i = 0; i < noteCount; i++) {
    const t = playStartSec + i * sixteenthDur;
    const isF = i % 2 === 0;
    const freq = isF ? F_SHARP_4 : C_SHARP_4;
    const note = pluckedNote(() => freq, sixteenthDur + 0.05, {
      sampleRate,
      // Fast initial decay so the previous note's tail drops below the new
      // note's body by the time pitch detection runs.
      fastTau: 0.04,
      slowTau: 0.4,
      fastMix: 0.75,
      attackNoise: 0.12,
    });
    mixInto(audio, note, Math.floor(t * sampleRate));
    expected.push({ time: t, pitchClass: isF ? "F#" : "C#" });
  }

  return { audio, sampleRate, expected, playStartSec };
}

/**
 * F#4 plucked, bent up to G#4 (200¢) over 200ms, held briefly, released
 * back to F#4 over 200ms.
 */
export function bend200(sampleRate = DEFAULT_SAMPLE_RATE): SynthSignal {
  const playStartSec = COUNT_IN_BEATS * (60 / 90); // 90 BPM count-in for verifier alignment
  const noteDur = 1.2;
  const totalDur = playStartSec + noteDur + 0.3;
  const totalSamples = Math.floor(totalDur * sampleRate);
  const audio = new Float32Array(totalSamples);

  // Bend curve: F# (0–0.2s) → ramp up to G# (0.2–0.4s) → hold G# (0.4–0.7s) →
  // ramp down to F# (0.7–0.9s) → hold F# (0.9–end).
  const bend: (t: number) => number = (t) => {
    if (t < 0.2) return F_SHARP_4;
    if (t < 0.4) return F_SHARP_4 + ((G_SHARP_4 - F_SHARP_4) * (t - 0.2)) / 0.2;
    if (t < 0.7) return G_SHARP_4;
    if (t < 0.9) return G_SHARP_4 - ((G_SHARP_4 - F_SHARP_4) * (t - 0.7)) / 0.2;
    return F_SHARP_4;
  };

  const note = pluckedNote(bend, noteDur, {
    sampleRate,
    slowTau: 1.5, fastMix: 0.5,
    attackNoise: 0.15,
  });
  mixInto(audio, note, Math.floor(playStartSec * sampleRate));

  // Verifier expectation: just one onset (no synthetic), F# pitch class
  // (we only check the starting pitch — bend tracking is checked separately).
  return {
    audio,
    sampleRate,
    expected: [{ time: playStartSec, pitchClass: "F#" }],
    playStartSec,
  };
}

/** F#4 plucked, abrupt switch to A4 at 250ms (no second attack). */
export function hammerOn(sampleRate = DEFAULT_SAMPLE_RATE): SynthSignal {
  const playStartSec = COUNT_IN_BEATS * (60 / 90);
  const noteDur = 1.2;
  const switchAt = 0.25;
  const totalDur = playStartSec + noteDur + 0.3;
  const totalSamples = Math.floor(totalDur * sampleRate);
  const audio = new Float32Array(totalSamples);

  // Pluck F# with attack click; play through with a sudden pitch switch
  // partway through. The hammer-on does NOT introduce an attack burst.
  const freq = (t: number) => (t < switchAt ? F_SHARP_4 : A_4);
  const note = pluckedNote(freq, noteDur, {
    sampleRate,
    slowTau: 1.5, fastMix: 0.5,
    attackNoise: 0.15,
  });
  mixInto(audio, note, Math.floor(playStartSec * sampleRate));

  return {
    audio,
    sampleRate,
    expected: [
      { time: playStartSec, pitchClass: "F#" },
      { time: playStartSec + switchAt, pitchClass: "A", synthetic: true },
    ],
    playStartSec,
  };
}

/** A4 plucked, abrupt switch to F#4 at 250ms (no second attack). */
export function pullOff(sampleRate = DEFAULT_SAMPLE_RATE): SynthSignal {
  const playStartSec = COUNT_IN_BEATS * (60 / 90);
  const noteDur = 1.2;
  const switchAt = 0.25;
  const totalDur = playStartSec + noteDur + 0.3;
  const totalSamples = Math.floor(totalDur * sampleRate);
  const audio = new Float32Array(totalSamples);

  const freq = (t: number) => (t < switchAt ? A_4 : F_SHARP_4);
  const note = pluckedNote(freq, noteDur, {
    sampleRate,
    slowTau: 1.5, fastMix: 0.5,
    attackNoise: 0.15,
  });
  mixInto(audio, note, Math.floor(playStartSec * sampleRate));

  return {
    audio,
    sampleRate,
    expected: [
      { time: playStartSec, pitchClass: "A" },
      { time: playStartSec + switchAt, pitchClass: "F#", synthetic: true },
    ],
    playStartSec,
  };
}

/** All synth signals available to the test bench, keyed by id. */
export const SYNTH_SIGNALS: Record<string, () => SynthSignal> = {
  "monophonic-16ths-140bpm": () => monophonic16thsAt140(),
  "bend-200": () => bend200(),
  "hammer-on": () => hammerOn(),
  "pull-off": () => pullOff(),
};
