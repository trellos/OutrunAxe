// Pure layout constants and functions shared between Timeline.ts, MenuPulse.ts,
// and the test suite. No DOM/canvas deps so tests run in node mode.

export const ROWS = 3;
export const BEATS_PER_ROW = 4;
export const PX_PER_BEAT = 144;
export const LANES = 12;
// Centre-to-centre spacing between adjacent pitch-class lanes. Must satisfy
// BAND_HEIGHT + 1 ≤ LANE_PITCH so no two different pitch-class bars overlap.
export const LANE_PITCH = 7;
export const BAND_HEIGHT = 5;
export const LANE_PAD = 4;
// 4 + 12*7 + 4 = 92 px
export const ROW_HEIGHT = LANES * LANE_PITCH + 2 * LANE_PAD;

/**
 * Map a MIDI note to the INTEGER y-centre of its pitch-class lane.
 * Lane 0 (C) sits at the bottom; lane 11 (B) at the top.
 * Two adjacent pitch classes are always LANE_PITCH px apart at their centres,
 * so BAND_HEIGHT-tall bars never overlap between different pitch classes.
 */
export function laneY(midi: number): number {
  const lane = ((Math.round(midi) % 12) + 12) % 12;
  return Math.round(ROW_HEIGHT - LANE_PAD - lane * LANE_PITCH - LANE_PITCH / 2);
}

/**
 * Convert a time offset within a row to a pixel x position.
 * `timeIntoRow` is in seconds from the row's start time.
 */
export function xForTimeInRow(timeIntoRow: number, bpm: number): number {
  return (timeIntoRow / (60 / bpm)) * PX_PER_BEAT;
}
