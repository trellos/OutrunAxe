// Background registry (Eddie). Collects the morphing background variants so the
// art rig + debug gallery + picker menu select one by index (?eddieart=1&bg=N or
// the ?eddiebg=1 menu). Index 0 is the production default until a winner is set.
//
// Each background: beat-reactive (eddieBeatPulse), camera-shake (eddieShake), and
// MORPHS calm->chaos with eddieIntensity (0..1). Variant files keep their bgNN id
// even though the registry order/count changes (Starfield + Geometric Bloom were
// cut; the kept files keep their original names).

import type { EddieBackgroundDef } from "./types";
import bg01 from "./bg01"; // Neon City -> Inferno
import bg02 from "./bg02"; // Neon Sea -> Storm
import bg04 from "./bg04"; // Vaporwave Plaza -> Meltdown
import bg06 from "./bg06"; // Desert -> Rainstorm
import bg07 from "./bg07"; // Circuit Board -> Pixel City

export const BACKGROUNDS: EddieBackgroundDef[] = [bg01, bg02, bg04, bg06, bg07];

/** Clamp/wrap a 0-based index into the registry. */
export function backgroundByIndex(i: number): EddieBackgroundDef {
  const n = BACKGROUNDS.length;
  const idx = ((Math.trunc(i) % n) + n) % n;
  return BACKGROUNDS[idx];
}
