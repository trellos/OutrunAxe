// Automated tests: run the engine against a recording or synth signal and
// compare its output against an expected note sequence.
//
// Source of truth for "does the algorithm work?". If FAIL → iterate. If PASS
// → the live game will produce the same events on the same input.

import type { DetectedNote } from "./analyze";
import type { SynthSignal } from "./synthesise";
import { midiToPitchClass } from "../audio/midi";

export interface ExpectedNote {
  /** Absolute time in the recording, seconds. */
  time: number;
  /** "C", "C#", "D", ..., "B". Octave-agnostic — we only check pitch class. */
  pitchClass: string;
}

export interface VerifyResult {
  passed: boolean;
  expectedCount: number;
  detectedNoteCount: number;
  matches: number;
  pitchMismatches: number;
  missing: number;
  extras: number;
  sustainGaps: number;
  details: string[];
}


/**
 * Group consecutive same-pitch detections (one onset + its sustain
 * fallbacks) into a single logical "note". This mirrors what PlayScene
 * shows as one dot + line. PlayScene's cross-measure handling keeps a
 * sustain that crosses a bar line as part of the same note, so we just
 * group by consecutive matching pitch class — no time-window splitting.
 */
interface DetectedSlot {
  start: number;
  end: number;
  pitchClass: string;
  midi: number;
  source: "onset" | "fallback";
}

export function groupIntoNotes(detections: DetectedNote[]): DetectedSlot[] {
  const slots: DetectedSlot[] = [];
  let current: DetectedSlot | null = null;
  for (const d of detections) {
    const pc = midiToPitchClass(d.midi);
    // Split only on a real onset marker. A pitch-class change inside a single
    // note is a bend — keep it inside the current slot. Onsets are the only
    // source-of-truth for note boundaries (the engine emits a synthetic
    // onset for hammer-ons / pull-offs precisely so this rule works).
    if (d.source === "onset" || !current) {
      if (current) slots.push(current);
      current = {
        start: d.time,
        end: d.time,
        pitchClass: pc,
        midi: d.midi,
        source: d.source,
      };
    } else {
      current.end = d.time;
    }
  }
  if (current) slots.push(current);
  return slots;
}

export interface VerifyOptions {
  /** ± seconds a detected onset can deviate from the expected time. */
  timeTolerance?: number;
  /** Acceptable gap inside a note between sustain emissions before flagging it. */
  maxSustainGap?: number;
  /** Total recording duration; used to evaluate the last note's expected end. */
  recordingDurationSec?: number;
}

export function verify(
  detections: DetectedNote[],
  expected: ExpectedNote[],
  opts: VerifyOptions = {},
): VerifyResult {
  const timeTolerance = opts.timeTolerance ?? 0.25;
  const maxSustainGap = opts.maxSustainGap ?? 0.15;
  const recordingDuration = opts.recordingDurationSec ?? Infinity;

  const slots = groupIntoNotes(detections);
  const details: string[] = [];

  const usedSlots = new Set<number>();
  let matches = 0;
  let pitchMismatches = 0;
  let missing = 0;
  let sustainGaps = 0;

  for (let i = 0; i < expected.length; i++) {
    const exp = expected[i];
    // Find the closest unused slot within tolerance.
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let s = 0; s < slots.length; s++) {
      if (usedSlots.has(s)) continue;
      const d = Math.abs(slots[s].start - exp.time);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = s;
      }
    }

    if (bestIdx === -1 || bestDist > timeTolerance) {
      missing++;
      details.push(
        `MISSING  exp#${i} @ ${exp.time.toFixed(3)}s (${exp.pitchClass}) — no slot within ±${timeTolerance}s`,
      );
      continue;
    }
    usedSlots.add(bestIdx);
    const slot = slots[bestIdx];

    if (slot.pitchClass !== exp.pitchClass) {
      pitchMismatches++;
      details.push(
        `PITCH    exp#${i} @ ${exp.time.toFixed(3)}s expected ${exp.pitchClass}, got ${slot.pitchClass}`,
      );
      continue;
    }

    // Sustain extends to the next expected onset (or recording end).
    const nextExpTime = i + 1 < expected.length ? expected[i + 1].time : recordingDuration;
    const sustainShortBy = nextExpTime - slot.end;
    if (sustainShortBy > maxSustainGap) {
      sustainGaps++;
      details.push(
        `SUSTAIN  exp#${i} @ ${exp.time.toFixed(3)}s (${exp.pitchClass}) ends ${(sustainShortBy * 1000).toFixed(0)}ms before next note`,
      );
    }

    matches++;
  }

  const extras = slots.length - usedSlots.size;
  if (extras > 0) {
    let extraDescribed = 0;
    for (let s = 0; s < slots.length && extraDescribed < 5; s++) {
      if (usedSlots.has(s)) continue;
      const slot = slots[s];
      details.push(
        `EXTRA    slot @ ${slot.start.toFixed(3)}s (${slot.pitchClass}) — no expected note matched`,
      );
      extraDescribed++;
    }
    if (extras > extraDescribed) {
      details.push(`         (${extras - extraDescribed} more extras)`);
    }
  }

  const passed =
    matches === expected.length &&
    pitchMismatches === 0 &&
    missing === 0 &&
    extras === 0 &&
    sustainGaps === 0;

  return {
    passed,
    expectedCount: expected.length,
    detectedNoteCount: slots.length,
    matches,
    pitchMismatches,
    missing,
    extras,
    sustainGaps,
    details,
  };
}

/**
 * Build the expected sequence for the reference recording:
 * 32 alternating F#/C# eighth notes at 90 BPM, after a 4-beat count-in.
 */
export function referenceExpected(): ExpectedNote[] {
  const bpm = 90;
  const eighthDur = 60 / bpm / 2;
  const playStart = (60 / bpm) * 4; // 4-beat count-in
  const out: ExpectedNote[] = [];
  for (let i = 0; i < 32; i++) {
    out.push({
      time: playStart + i * eighthDur,
      pitchClass: i % 2 === 0 ? "F#" : "C#",
    });
  }
  return out;
}

/** Verify the engine's output against a synth signal's expected events. */
export function verifySynth(
  detections: DetectedNote[],
  signal: SynthSignal,
  opts: VerifyOptions = {},
): VerifyResult {
  // Synth signals don't define sustain expectations — disable that check.
  return verify(detections, signal.expected, {
    ...opts,
    maxSustainGap: opts.maxSustainGap ?? Infinity,
    recordingDurationSec:
      opts.recordingDurationSec ?? signal.audio.length / signal.sampleRate,
  });
}
