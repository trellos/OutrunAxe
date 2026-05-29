// Particle registry (Eddie art revision round). Collects the 6 particle variants
// so the art rig + debug gallery can select one by index (?eddieart=1&fx=N,
// N = 1..6). Index 0 (fx01) is the production default until a winner is chosen.

import type { EddieParticlesDef } from "./types";
import fx01 from "./fx01";
import fx02 from "./fx02";
import fx03 from "./fx03";
import fx04 from "./fx04";
import fx05 from "./fx05";
import fx06 from "./fx06";

export const PARTICLES: EddieParticlesDef[] = [fx01, fx02, fx03, fx04, fx05, fx06];

/** Clamp/wrap a 0-based index into the registry. */
export function particlesByIndex(i: number): EddieParticlesDef {
  const n = PARTICLES.length;
  const idx = ((Math.trunc(i) % n) + n) % n;
  return PARTICLES[idx];
}
