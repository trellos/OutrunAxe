// Background registry (Eddie art revision round). Collects the 6 background
// variants so the art rig + debug gallery can select one by index
// (?eddieart=1&bg=N, N = 1..6). Index 0 (bg01) is the production default until a
// winner is chosen.

import type { EddieBackgroundDef } from "./types";
import bg01 from "./bg01";
import bg02 from "./bg02";
import bg03 from "./bg03";
import bg04 from "./bg04";
import bg05 from "./bg05";
import bg06 from "./bg06";

export const BACKGROUNDS: EddieBackgroundDef[] = [bg01, bg02, bg03, bg04, bg05, bg06];

/** Clamp/wrap a 0-based index into the registry. */
export function backgroundByIndex(i: number): EddieBackgroundDef {
  const n = BACKGROUNDS.length;
  const idx = ((Math.trunc(i) % n) + n) % n;
  return BACKGROUNDS[idx];
}
