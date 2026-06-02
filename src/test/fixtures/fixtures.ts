// Audio-fixture verifier. Each fixture is an audio file under
// `public/samples/<id>.webm` plus a JSON spec describing what the player
// performed. We run the engine on the audio and compare detected onsets
// against the spec, octave-agnostically.

import { analyze, type DetectedNote } from "../analyze";
import type { Algorithm } from "../../audio/PitchEngine";
import { midiToPitchClass } from "../../audio/midi";

export interface ExpectedEvent {
  kind: "pluck" | "tap" | "bend";
  tSec: number;
  pitchClass: string;
  pitchPeak?: string;
  pitchEnd?: string;
}

export interface FixtureSpec {
  description?: string;
  expected: ExpectedEvent[];
  tolerance: {
    timeSec: number;
    extras: number;
    /** If set, a detected pitch class anywhere in this list counts as a
     * match for any expected event whose pitchClass is also in the list.
     * Used for fast bends where catching B or C is acceptable. */
    allowPitchClasses?: string[];
  };
}

export interface FixtureResult {
  passed: boolean;
  matches: number;
  expectedCount: number;
  detectedOnsetCount: number;
  pitchMismatches: number;
  missing: number;
  extras: number;
  details: string[];
}


/**
 * Decode an audio URL into a mono Float32Array. Mirrors the test bench's
 * loadRecording so the engine sees the same samples.
 */
export async function loadAudio(
  url: string,
): Promise<{ samples: Float32Array; sampleRate: number; duration: number }> {
  const ctx = new AudioContext();
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`fetch ${url}: ${resp.status}`);
    const arr = await resp.arrayBuffer();
    const decoded = await ctx.decodeAudioData(arr);
    const n = decoded.length;
    const ch = decoded.numberOfChannels;
    let samples: Float32Array;
    if (ch === 1) {
      samples = decoded.getChannelData(0);
    } else {
      // Loudest-channel selection: a silent channel must not dilute a loud
      // one, so pick the channel with the highest RMS rather than averaging.
      let loudest = 0;
      let bestSumSq = -1;
      for (let c = 0; c < ch; c++) {
        const data = decoded.getChannelData(c);
        let sumSq = 0;
        for (let i = 0; i < n; i++) sumSq += data[i] * data[i];
        if (sumSq > bestSumSq) {
          bestSumSq = sumSq;
          loudest = c;
        }
      }
      // Copy: getChannelData's view is invalid after ctx.close().
      samples = Float32Array.from(decoded.getChannelData(loudest));
    }
    return { samples, sampleRate: decoded.sampleRate, duration: decoded.duration };
  } finally {
    await ctx.close();
  }
}

export async function loadFixture(id: string): Promise<{
  audio: { samples: Float32Array; sampleRate: number; duration: number };
  spec: FixtureSpec;
}> {
  const [audio, spec] = await Promise.all([
    loadAudio(`/samples/${id}.webm`),
    fetch(`/src/test/fixtures/${id}.json`).then((r) => {
      if (!r.ok) throw new Error(`fixture ${id}.json missing`);
      return r.json() as Promise<FixtureSpec>;
    }),
  ]);
  return { audio, spec };
}

/**
 * Greedy nearest-neighbour matcher over expected → detected onsets, mirroring
 * the verify.ts approach. Octave-agnostic on pitch class. `allowPitchClasses`
 * lets a single expected event accept any pitch in a small set (used for
 * fast-bend boundary cases where the engine may lock B or C).
 */
export function verifyFixture(
  detected: DetectedNote[],
  spec: FixtureSpec,
): FixtureResult {
  const onsets = detected.filter((d) => d.source === "onset");
  const tol = spec.tolerance.timeSec;
  const used = new Set<number>();
  const details: string[] = [];

  let matches = 0;
  let pitchMismatches = 0;
  let missing = 0;

  for (let i = 0; i < spec.expected.length; i++) {
    const exp = spec.expected[i];
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let s = 0; s < onsets.length; s++) {
      if (used.has(s)) continue;
      const d = Math.abs(onsets[s].time - exp.tSec);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = s;
      }
    }
    if (bestIdx === -1 || bestDist > tol) {
      missing++;
      details.push(
        `MISSING  exp#${i} @ ${exp.tSec.toFixed(3)}s (${exp.pitchClass}) — no onset within ±${tol}s`,
      );
      continue;
    }
    used.add(bestIdx);
    const slot = onsets[bestIdx];
    const slotPc = midiToPitchClass(slot.midi);

    const allowed = spec.tolerance.allowPitchClasses;
    const okByAllowList =
      allowed && allowed.includes(exp.pitchClass) && allowed.includes(slotPc);
    if (slotPc === exp.pitchClass || okByAllowList) {
      matches++;
    } else {
      pitchMismatches++;
      details.push(
        `PITCH    exp#${i} @ ${exp.tSec.toFixed(3)}s expected ${exp.pitchClass}, got ${slotPc} @ ${slot.time.toFixed(3)}s`,
      );
    }
  }

  const extras = onsets.length - used.size;
  if (extras > spec.tolerance.extras) {
    let described = 0;
    for (let s = 0; s < onsets.length && described < 5; s++) {
      if (used.has(s)) continue;
      const slot = onsets[s];
      details.push(
        `EXTRA    onset @ ${slot.time.toFixed(3)}s (${midiToPitchClass(slot.midi)})`,
      );
      described++;
    }
    if (extras - described > 0) {
      details.push(`         (${extras - described} more extras)`);
    }
  }

  const passed =
    matches === spec.expected.length &&
    pitchMismatches === 0 &&
    missing === 0 &&
    extras <= spec.tolerance.extras;

  return {
    passed,
    matches,
    expectedCount: spec.expected.length,
    detectedOnsetCount: onsets.length,
    pitchMismatches,
    missing,
    extras,
    details,
  };
}

/** Convenience: load + analyze + verify in one shot. */
export async function runFixture(
  id: string,
  algorithm: Algorithm = "Macleod",
): Promise<{ spec: FixtureSpec; detected: DetectedNote[]; result: FixtureResult }> {
  const { audio, spec } = await loadFixture(id);
  const detected = analyze(audio.samples, audio.sampleRate, {
    fftSize: 2048,
    tickStep: 512,
    algorithm,
  });
  const result = verifyFixture(detected, spec);
  return { spec, detected, result };
}

/** IDs of every fixture currently checked in. The test bench dropdown uses this. */
export const FIXTURE_IDS = [
  "test-scale-120bpm",
  "test-repeats-120bpm",
  "test-bend-hold",
  "test-bend-fast",
] as const;
