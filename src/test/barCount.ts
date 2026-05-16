// Sample-audio regression helper: feeds DetectedNote[] through the SAME
// BarAccumulator the HUD uses (hud/noteBars.ts) and counts the resulting
// bars. Before the onsetId-grouping fix a held quarter note fragmented into
// many tiny dots, so the bar count was inflated ~3-5x vs the true note count.
// This asserts the count is back near the true note count.
//
// How to run: open `/pitch-test.html?source=notes-90bpm` (or pick that
// source in the dropdown). The PASS/FAIL line shows in the bench verdict and
// the bar count is exposed on `window.__pitchTest.barCount`.

import type { DetectedNote } from "./analyze";
import { BarAccumulator } from "../hud/noteBars";

export interface BarCountResult {
  passed: boolean;
  barCount: number;
  /** Number of `source==="onset"` detections — the true note count. */
  onsetCount: number;
  expectedNotes: number;
  /** Inflation ratio barCount / expectedNotes (1.0 == perfect). */
  ratio: number;
  details: string[];
}

/**
 * Map detections to BarAccumulator inputs exactly the way the HUD does:
 * each "onset" detection is the start of a new note (a fresh synthetic
 * onsetId), every following "fallback" (sustain) detection belongs to that
 * same note (same onsetId). Pitch is irrelevant to bar grouping — only the
 * onsetId boundary matters — so we only need x to advance the bar and a
 * constant y.
 *
 * A new bar is produced every time the accumulator sees a NEW onsetId, so
 * counting bars == counting how many distinct notes the renderer would draw.
 */
export function countBars(
  detections: DetectedNote[],
  expectedNotes: number,
  scale = 100,
): BarCountResult {
  // PX_PER_BEAT/10 mirrors the seed width the HUD uses; irrelevant to count.
  const acc = new BarAccumulator(3.6);
  let onsetId = 0;
  let seenOnsetId = -1;
  let barCount = 0;
  let onsetCount = 0;

  for (const d of detections) {
    if (d.source === "onset" || onsetId === 0) {
      onsetId += 1;
      onsetCount += 1;
    }
    const x = d.time * scale;
    acc.feed(onsetId, x, 0);
    // The accumulator starts exactly one new bar per distinct onsetId.
    if (onsetId !== seenOnsetId) {
      barCount += 1;
      seenOnsetId = onsetId;
    }
  }

  const ratio = expectedNotes > 0 ? barCount / expectedNotes : barCount;
  // Two deterministic invariants:
  //  1. The accumulator must NOT inflate beyond the onset detections it was
  //     fed — i.e. sustain reads (the wobbling dots) must collapse into the
  //     bar of their onset, not spawn new bars. barCount === onsetCount is
  //     the exact statement of "no dot fragmentation".
  //  2. The bar count must be close to the clip's true note count (not the
  //     ~3-5x inflation the old proximity logic produced).
  const noFragmentation = barCount === onsetCount;
  const closeToTruth =
    expectedNotes > 0 && ratio <= 1.6 && barCount >= expectedNotes * 0.5;
  const passed = noFragmentation && closeToTruth;

  const details = [
    `bars=${barCount}  onsets=${onsetCount}  expectedNotes=${expectedNotes}  ratio=${ratio.toFixed(2)} (must be ≤ 1.60)`,
  ];
  if (!noFragmentation) {
    details.push(
      "FAIL: bars != onsets — sustain reads are fragmenting into extra bars.",
    );
  }
  if (!closeToTruth) {
    details.push(
      ratio > 1.6
        ? "FAIL: bar count inflated vs the clip's true note count."
        : "FAIL: too few bars — detection or grouping dropped notes.",
    );
  }

  return { passed, barCount, onsetCount, expectedNotes, ratio, details };
}
