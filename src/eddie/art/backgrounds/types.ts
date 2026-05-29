// Background variant contract (Eddie art revision round). Each background is a
// self-contained Three.js scene decoration that lives in the worldScene,
// subscribes to the juice bus (eddieBeatPulse to pump on the beat, eddieShake to
// jolt the camera), and animates off rAF dt in update(). Visuals only — never
// decides scoring or reads note timing.
//
// Variants live in bg01.ts .. bg06.ts, each default-exporting an
// EddieBackgroundDef. The registry (registry.ts) collects them; the art rig and
// the debug gallery select one by index (?eddieart=1&bg=N).

import type * as THREE from "three";
import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";

export interface EddieBackgroundVariant {
  /** Build scene objects. Park/shake the camera if provided. */
  mount(ctx: {
    scene: THREE.Scene;
    camera?: THREE.PerspectiveCamera;
    juice: EventBus<EddieJuiceEvents>;
  }): void;
  /** Per-frame animation (rAF dt + audio-clock time for interpolation). */
  update(dt: number, audioTime: number): void;
  /** Remove all scene objects, dispose geometry/material/texture, unsubscribe.
   *  Must restore scene.background/fog and leave ZERO leaked Three resources. */
  dispose(): void;
}

export interface EddieBackgroundDef {
  /** Stable id, e.g. "bg01". */
  id: string;
  /** Short human label for the gallery HUD, e.g. "Chrome sunset". */
  label: string;
  /** One-line style rationale (shown in the gallery + commit message). */
  blurb: string;
  create(): EddieBackgroundVariant;
}
