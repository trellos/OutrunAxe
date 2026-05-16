import type * as THREE from "three";
import type { GuitarId } from "../../state/Loadout";

/** Procedural animation states every character must support. */
export type AnimName = "idle" | "play" | "walk" | "taunt" | "hit" | "die";

export interface BuiltCharacter {
  /**
   * Root object. Feet rest at y=0, model faces +Z, mains are ~1.85u tall.
   * Add this straight into a scene/group; never scale the root externally —
   * pass sizing through the builder instead.
   */
  readonly group: THREE.Object3D;
  /** Per-frame tick. `t` = absolute seconds, `dt` = seconds since last tick. */
  update(t: number, dt: number, anim: AnimName): void;
  /** Mains only: hot-swap the held guitar. No-op / absent for enemies. */
  setGuitar?(guitar: GuitarId): void;
  /** Free per-instance materials/geometry created by this character. */
  dispose(): void;
}

export interface CharacterVariant {
  id: string;
  label: string;
}

export interface CharacterDef {
  /** Stable id, e.g. "main-gunslinger" / "enemy-mba". */
  id: string;
  kind: "main" | "enemy";
  /** Human-facing name shown in the debug viewer. */
  label: string;
  /** Exactly three pickable variants. */
  variants: CharacterVariant[];
  build(variantId: string, opts?: { guitar?: GuitarId }): BuiltCharacter;
}
