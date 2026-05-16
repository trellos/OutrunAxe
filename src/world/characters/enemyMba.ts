// The MBA — Killer7-styled enemy. Selfish, egotistical business-exec villain.
//
// Sharp suit, slicked hair, smug power-stance. Three variants share a
// suited silhouette (broad shoulders, narrow waist) but differ in palette
// and signature props. Default expressive anim is "taunt" — a gloating,
// dismissive lean-back wave that fits a smug exec.

import * as THREE from "three";
import type { AnimName, BuiltCharacter, CharacterDef } from "./types";
import { HumanoidRig, k7Box, k7Flat, part } from "./Killer7Style";
import type { RigPalette, RigShape } from "./Killer7Style";

// Suited silhouette: tall, average build, broad shoulders, ~1.82u.
const SHAPE: RigShape = { height: 1.82, build: "average", shoulders: 1.1 };

interface Variant {
  palette: RigPalette;
  /**
   * Decorate the rig with this variant's silhouette pieces. Any geometry
   * created outside the rig (raw flat meshes) is pushed to `extraGeos` so
   * `dispose()` can free it — rig.dispose() only frees rig-owned geometry.
   */
  decorate(rig: HumanoidRig, extraGeos: THREE.BufferGeometry[]): void;
}

// v1 "Power Suit" — navy pinstripe-feel suit, slicked-back hair, gold accent.
const POWER_SUIT: RigPalette = {
  skin: 0xcaa385,
  hair: 0x16110a,
  top: 0x1b2440, // bold navy block
  bottom: 0x161d33,
  shoes: 0x0b0a08,
  accent: 0xd6a019, // gold tie + watch
};

// v2 "Bro Vest" — vest + rolled-sleeve shirt, gelled spiky hair, turquoise.
const BRO_VEST: RigPalette = {
  skin: 0xc99873,
  hair: 0x1a1209,
  top: 0xe6e2d4, // shirt
  bottom: 0x2b2f38,
  shoes: 0x141008,
  accent: 0x18c8c0, // douchey turquoise
};

// v3 "Shark" — charcoal suit, slick widow's-peak hair, blood-red tie.
const SHARK: RigPalette = {
  skin: 0xc09a7c,
  hair: 0x0d0c0b,
  top: 0x26282d, // charcoal
  bottom: 0x202226,
  shoes: 0x09080a,
  accent: 0xb01018, // blood red
};

/** Slicked-back hair cap on the headAnchor. */
function slickedHair(rig: HumanoidRig, hair: number): void {
  const cap = k7Box(rig.headAnchor, 0.2, 0.12, 0.21, hair, rig.mats, { outlineScale: 1.05 });
  cap.position.set(0, 0.05, -0.01);
  // Swept-back tail at the nape.
  const tail = k7Box(rig.headAnchor, 0.16, 0.07, 0.07, hair, rig.mats, { outlineScale: 1.06 });
  tail.position.set(0, 0.0, -0.12);
}

/** Lapelled jacket front on the torsoAnchor (suit collar V). */
function lapels(rig: HumanoidRig, top: number): void {
  for (const side of [-1, 1] as const) {
    const lapel = k7Box(rig.torsoAnchor, 0.07, 0.26, 0.05, top, rig.mats, { outlineScale: 1.05 });
    lapel.position.set(side * 0.075, -0.02, 0.075);
    lapel.rotation.z = side * 0.22;
  }
}

/** Vertical tie on the torsoAnchor in the given accent colour. */
function tie(rig: HumanoidRig, accent: number): void {
  const knot = k7Box(rig.torsoAnchor, 0.05, 0.05, 0.04, accent, rig.mats, { outlineScale: 1.05 });
  knot.position.set(0, 0.085, 0.082);
  const blade = k7Box(rig.torsoAnchor, 0.055, 0.24, 0.03, accent, rig.mats, { outlineScale: 1.04 });
  blade.position.set(0, -0.06, 0.082);
}

const VARIANTS: Record<string, Variant> = {
  // -------------------------------------------------------------------
  v1: {
    palette: POWER_SUIT,
    decorate(rig) {
      slickedHair(rig, POWER_SUIT.hair);
      lapels(rig, POWER_SUIT.top);
      tie(rig, POWER_SUIT.accent); // gold tie
      // Gold watch on the left wrist.
      const watch = k7Box(rig.handL, 0.07, 0.04, 0.07, POWER_SUIT.accent, rig.mats, {
        outlineScale: 1.06,
      });
      watch.position.set(0, 0.02, 0);
    },
  },
  // -------------------------------------------------------------------
  v2: {
    palette: BRO_VEST,
    decorate(rig, extraGeos) {
      // Gelled spiky hair — a few stub spikes.
      const baseCap = k7Box(rig.headAnchor, 0.19, 0.08, 0.2, BRO_VEST.hair, rig.mats, {
        outlineScale: 1.05,
      });
      baseCap.position.set(0, 0.05, -0.01);
      for (const sx of [-0.06, 0, 0.06]) {
        const spike = k7Box(rig.headAnchor, 0.04, 0.09, 0.04, BRO_VEST.hair, rig.mats, {
          outlineScale: 1.07,
        });
        spike.position.set(sx, 0.12, 0.01);
        spike.rotation.x = -0.2;
      }
      // Dark vest over the shirt (accent piping).
      const vest = k7Box(rig.torsoAnchor, 0.26, 0.3, 0.06, BRO_VEST.bottom, rig.mats, {
        outlineScale: 1.04,
      });
      vest.position.set(0, -0.02, 0.06);
      for (const side of [-1, 1] as const) {
        const piping = k7Box(rig.torsoAnchor, 0.02, 0.3, 0.02, BRO_VEST.accent, rig.mats, {
          outlineScale: 1.05,
        });
        piping.position.set(side * 0.1, -0.02, 0.095);
      }
      // Sunglasses: thin flat black bar across the eyes.
      const shadesGeo = new THREE.BoxGeometry(0.18, 0.045, 0.03);
      extraGeos.push(shadesGeo);
      const shades = new THREE.Mesh(shadesGeo, k7Flat(0x070708));
      shades.position.set(0, 0.0, 0.1);
      part(rig.headAnchor, shades, rig.mats, { outlineScale: 1.08 });
    },
  },
  // -------------------------------------------------------------------
  v3: {
    palette: SHARK,
    decorate(rig, extraGeos) {
      // Slick widow's-peak hair: cap + a forward centre point.
      const cap = k7Box(rig.headAnchor, 0.2, 0.11, 0.21, SHARK.hair, rig.mats, {
        outlineScale: 1.05,
      });
      cap.position.set(0, 0.05, -0.01);
      const peak = k7Box(rig.headAnchor, 0.05, 0.05, 0.05, SHARK.hair, rig.mats, {
        outlineScale: 1.07,
      });
      peak.position.set(0, -0.035, 0.095);
      peak.rotation.z = Math.PI / 4;
      lapels(rig, SHARK.top);
      tie(rig, SHARK.accent); // red power tie
      // Briefcase: flat box held in the right hand.
      const caseBody = k7Box(rig.handR, 0.28, 0.2, 0.07, SHARK.bottom, rig.mats, {
        outlineScale: 1.05,
      });
      caseBody.position.set(0, -0.14, 0);
      const handle = k7Box(rig.handR, 0.1, 0.05, 0.025, 0x0a0a0c, rig.mats, {
        outlineScale: 1.06,
      });
      handle.position.set(0, -0.025, 0);
      const latchGeo = new THREE.BoxGeometry(0.05, 0.03, 0.02);
      extraGeos.push(latchGeo);
      const latch = new THREE.Mesh(latchGeo, k7Flat(SHARK.accent));
      latch.position.set(0, -0.14, 0.04);
      part(rig.handR, latch, rig.mats, { outlineScale: 1.06 });
    },
  },
};

function build(variantId: string, _opts?: { guitar?: never }): BuiltCharacter {
  const variant = VARIANTS[variantId] ?? VARIANTS.v1;
  const rig = new HumanoidRig(variant.palette, SHAPE);
  const extraGeos: THREE.BufferGeometry[] = [];
  variant.decorate(rig, extraGeos);

  return {
    group: rig.group,
    update(t: number, dt: number, anim: AnimName) {
      rig.pose(anim, t, dt);
    },
    dispose() {
      rig.dispose();
      for (const g of extraGeos) g.dispose();
    },
  };
}

export const def: CharacterDef = {
  id: "enemy-mba",
  kind: "enemy",
  label: "The MBA",
  variants: [
    { id: "v1", label: "Power Suit" },
    { id: "v2", label: "Bro Vest" },
    { id: "v3", label: "Shark" },
  ],
  build,
};
