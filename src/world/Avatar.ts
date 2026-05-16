import * as THREE from "three";
import { characterById, MAIN_CHARACTERS } from "./characters/registry";
import type { BuiltCharacter } from "./characters/types";
import type { Loadout } from "../state/Loadout";

// The player avatar is now a procedural Killer7 main character (see
// src/world/characters/). This replaces the old RobotExpressive GLB path —
// no skinned-GLB rig gotchas, fully cel-shaded with the rest of the world.
//
// Public surface kept stable for callers (LevelState / LoadoutState):
//   new Avatar(loadout) — a THREE.Object3D
//   .update(audioTime)
//   .triggerStrum(audioTime)
//   .dispose()

export class Avatar extends THREE.Object3D {
  private built: BuiltCharacter;
  private lastUpdateTime = -1;
  private strumAt = -999;
  private disposed = false;

  constructor(loadout: Loadout) {
    super();
    const def = characterById(loadout.character) ?? MAIN_CHARACTERS[0];
    const variantId =
      def.variants.find((v) => v.id === loadout.variant)?.id ??
      def.variants[0]?.id ??
      "v1";
    this.built = def.build(variantId, { guitar: loadout.guitar });
    this.add(this.built.group);
  }

  triggerStrum(audioTime: number) {
    this.strumAt = audioTime;
  }

  update(audioTime: number) {
    if (this.disposed) return;
    if (this.lastUpdateTime < 0) this.lastUpdateTime = audioTime;
    let dt = audioTime - this.lastUpdateTime;
    this.lastUpdateTime = audioTime;
    if (!(dt > 0) || dt > 0.5) dt = 1 / 60;

    // It's a guitar-solo game — the player is always shredding. Keep the
    // rig's energetic "play" stance so the character never goes limp on
    // the rail; strum timing is tracked for future accenting.
    void this.strumAt;
    this.built.update(audioTime, dt, "play");
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.remove(this.built.group);
    this.built.dispose();
  }
}
