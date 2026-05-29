import { NOTE_NAMES } from "../audio/midi";

export type PitchClass = (typeof NOTE_NAMES)[number];

const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10];

export type KeyMode = "major" | "minor";

function pc(idx: number): PitchClass {
  return NOTE_NAMES[((idx % 12) + 12) % 12];
}

export function majorKeyPitchClasses(root: PitchClass): Set<PitchClass> {
  const rootIdx = NOTE_NAMES.indexOf(root);
  const out = new Set<PitchClass>();
  for (const iv of MAJOR_INTERVALS) out.add(pc(rootIdx + iv));
  return out;
}

export function minorKeyPitchClasses(root: PitchClass): Set<PitchClass> {
  const rootIdx = NOTE_NAMES.indexOf(root);
  const out = new Set<PitchClass>();
  for (const iv of MINOR_INTERVALS) out.add(pc(rootIdx + iv));
  return out;
}

export const ALL_MAJOR_KEYS: Map<PitchClass, Set<PitchClass>> = (() => {
  const m = new Map<PitchClass, Set<PitchClass>>();
  for (const root of NOTE_NAMES) m.set(root, majorKeyPitchClasses(root));
  return m;
})();

export const ALL_MINOR_KEYS: Map<PitchClass, Set<PitchClass>> = (() => {
  const m = new Map<PitchClass, Set<PitchClass>>();
  for (const root of NOTE_NAMES) m.set(root, minorKeyPitchClasses(root));
  return m;
})();

export function keyPitchClasses(root: PitchClass, mode: KeyMode): Set<PitchClass> {
  return (mode === "minor" ? ALL_MINOR_KEYS : ALL_MAJOR_KEYS).get(root)!;
}

export function narrowKeys(
  candidates: Set<PitchClass>,
  pitchClass: PitchClass,
): Set<PitchClass> {
  const out = new Set<PitchClass>();
  for (const root of candidates) {
    if (ALL_MAJOR_KEYS.get(root)!.has(pitchClass)) out.add(root);
  }
  return out;
}

export function keyConfidence(candidates: Set<PitchClass>): number {
  const n = Math.max(1, candidates.size);
  return 1 - (n - 1) / 11;
}

export function initialKeySet(): Set<PitchClass> {
  return new Set(NOTE_NAMES);
}
