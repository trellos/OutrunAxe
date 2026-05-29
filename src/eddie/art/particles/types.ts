// Particle variant contract (Eddie art revision round). Each particle system is
// pure DOM (no Three.js), subscribes to the juice bus eddieParticles
// { from, count, color }, spawns particles at `from` (viewport coords) and
// animates them toward the score readout resolved via resolveScore(). dispose()
// must remove every live particle (zero leaked DOM).
//
// Variants live in fx01.ts .. fx06.ts, each default-exporting an
// EddieParticlesDef. The registry (registry.ts) collects them; the art rig and
// debug gallery select one by index (?eddieart=1&fx=N).

import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";

export interface EddieParticlesVariant {
  mount(ctx: {
    hudParent: HTMLElement;
    juice: EventBus<EddieJuiceEvents>;
    resolveScore: () => { x: number; y: number };
  }): void;
  /** Per-frame animation (rAF dt). */
  update(dt: number): void;
  /** Remove every live particle element + unsubscribe. */
  dispose(): void;
}

export interface EddieParticlesDef {
  id: string;
  label: string;
  blurb: string;
  create(): EddieParticlesVariant;
}
