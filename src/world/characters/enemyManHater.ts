// The Man Hater — heavyset scowling caricature antagonist (Killer7 noir).
//
// Stylised cartoon villain, not realism: buff bulk + wide hips give a
// heavyset block silhouette, severe arms-crossed disapproval, permanent
// scowl via dark angled brow blocks on the head. Three variants:
//   v1 "Disapproval" — gray bun, drab olive cardigan, long shapeless dress.
//   v2 "Picket"      — frizzy gray hair, blank protest sign, bulky sweater.
//   v3 "Cat Lady"    — messy hair, lumpy knit sweater, thick glasses.

import * as THREE from "three";
import type { BuiltCharacter, CharacterDef } from "./types";
import { HumanoidRig, type RigPalette, type RigShape, k7Box, part, k7Mat } from "./Killer7Style";

const SHAPE: RigShape = { height: 1.7, build: "buff", hips: 1.35, shoulders: 1.05, bust: 0.5 };

const PALETTES: Record<string, RigPalette> = {
  // v1 Disapproval — drab olive cardigan, dark dress, sour mustard accent.
  v1: { skin: 0xd8b49a, hair: 0x8e8e84, top: 0x5e6038, bottom: 0x2a2620, shoes: 0x1a1614, accent: 0xc9a227 },
  // v2 Picket — bulky gray sweater, acid green accent.
  v2: { skin: 0xd2ad94, hair: 0x9a9a92, top: 0x6b6b63, bottom: 0x33302a, shoes: 0x1c1816, accent: 0x9acd32 },
  // v3 Cat Lady — lumpy mauve knit, dull purple accent.
  v3: { skin: 0xd6b29c, hair: 0x7a7068, top: 0x6a5868, bottom: 0x322a30, shoes: 0x1e1818, accent: 0x7a5a9a },
};

function build(variantId: string, _opts?: { guitar?: never }): BuiltCharacter {
  const variant = PALETTES[variantId] ? variantId : "v1";
  const pal = PALETTES[variant];
  const rig = new HumanoidRig(pal, SHAPE);
  const extraMats: THREE.Material[] = [];
  const extraGeos: THREE.BufferGeometry[] = [];

  const trackBox = (m: THREE.Mesh) => {
    extraGeos.push(m.geometry as THREE.BufferGeometry);
    return m;
  };

  // ---- permanent scowl: dark angled V-brow blocks on the head ----
  for (const side of [-1, 1] as const) {
    const brow = k7Box(rig.headAnchor, 0.05, 0.016, 0.02, 0x140f0f, rig.mats, { outlineScale: 1.06 });
    brow.position.set(side * 0.045, 0.072, 0.094);
    brow.rotation.z = side * 0.55; // angled down toward the nose -> scowl
    trackBox(brow);
  }

  if (variant === "v1") {
    // Severe gray bun — small flattened sphere on the head.
    const bunGeo = new THREE.SphereGeometry(0.072, 8, 6);
    extraGeos.push(bunGeo);
    const bun = new THREE.Mesh(bunGeo, k7Mat(pal.hair));
    bun.scale.set(1, 0.62, 1);
    bun.position.set(0, 0.092, -0.05);
    part(rig.headAnchor, bun, rig.mats, { outlineScale: 1.07 });
    extraMats.push(bun.material as THREE.Material);
    // Hair cap hugging the skull.
    trackBox(k7Box(rig.headAnchor, 0.19, 0.1, 0.2, pal.hair, rig.mats, { outlineScale: 1.06 }))
      .position.set(0, 0.07, -0.005);
    // Shapeless olive cardigan slab over the chest.
    trackBox(k7Box(rig.torsoAnchor, 0.5, 0.42, 0.34, pal.top, rig.mats, { outlineScale: 1.05 }))
      .position.set(0, -0.02, 0.01);
    // Sour-mustard buttons placket down the front.
    for (let i = 0; i < 3; i++) {
      const btn = k7Box(rig.torsoAnchor, 0.03, 0.03, 0.02, pal.accent, rig.mats, { outline: false });
      btn.position.set(0, 0.1 - i * 0.1, 0.18);
      trackBox(btn);
    }
    // Long shapeless dress block reaching low.
    trackBox(k7Box(rig.group, 0.56, 0.78, 0.42, pal.bottom, rig.mats, { outlineScale: 1.04 }))
      .position.set(0, 0.46, 0);
  } else if (variant === "v2") {
    // Frizzy short gray hair — a chunky lumpy cap.
    trackBox(k7Box(rig.headAnchor, 0.22, 0.14, 0.22, pal.hair, rig.mats, { outlineScale: 1.08 }))
      .position.set(0, 0.06, -0.01);
    for (const sx of [-1, 1] as const) {
      const tuft = k7Box(rig.headAnchor, 0.06, 0.08, 0.07, pal.hair, rig.mats, { outlineScale: 1.07 });
      tuft.position.set(sx * 0.1, 0.05, -0.02);
      trackBox(tuft);
    }
    // Bulky sweater slab.
    trackBox(k7Box(rig.torsoAnchor, 0.52, 0.44, 0.36, pal.top, rig.mats, { outlineScale: 1.05 }))
      .position.set(0, -0.02, 0.01);
    // Acid-green collar accent.
    trackBox(k7Box(rig.torsoAnchor, 0.3, 0.07, 0.3, pal.accent, rig.mats, { outline: false }))
      .position.set(0, 0.18, 0.02);
    // Skirt-ish lower block.
    trackBox(k7Box(rig.group, 0.5, 0.7, 0.4, pal.bottom, rig.mats, { outlineScale: 1.04 }))
      .position.set(0, 0.42, 0);
    // Protest sign held in handR: blank flat box on a stick.
    const stick = k7Box(rig.handR, 0.026, 0.7, 0.026, 0x5a4632, rig.mats, { outlineScale: 1.06 });
    stick.position.set(0, 0.3, 0);
    trackBox(stick);
    const sign = k7Box(rig.handR, 0.34, 0.26, 0.03, 0xe8e4d6, rig.mats, { outlineScale: 1.05 });
    sign.position.set(0, 0.62, 0.01);
    trackBox(sign);
  } else {
    // Cat Lady — messy hair clumps.
    trackBox(k7Box(rig.headAnchor, 0.2, 0.13, 0.21, pal.hair, rig.mats, { outlineScale: 1.07 }))
      .position.set(0, 0.06, -0.005);
    for (const sx of [-1, 1] as const) {
      const clump = k7Box(rig.headAnchor, 0.07, 0.13, 0.08, pal.hair, rig.mats, { outlineScale: 1.07 });
      clump.position.set(sx * 0.11, 0.0, -0.02);
      clump.rotation.z = sx * 0.2;
      trackBox(clump);
    }
    // Oversized lumpy knit sweater — extra bulk block on the torso.
    trackBox(k7Box(rig.torsoAnchor, 0.58, 0.5, 0.42, pal.top, rig.mats, { outlineScale: 1.06 }))
      .position.set(0, -0.04, 0.02);
    // Dull-purple knit trim.
    trackBox(k7Box(rig.torsoAnchor, 0.6, 0.06, 0.44, pal.accent, rig.mats, { outline: false }))
      .position.set(0, -0.26, 0.02);
    // Long lower block.
    trackBox(k7Box(rig.group, 0.52, 0.72, 0.42, pal.bottom, rig.mats, { outlineScale: 1.04 }))
      .position.set(0, 0.42, 0);
    // Thick glasses: two flat box rims on the head.
    for (const ex of [-0.05, 0.05]) {
      const rim = k7Box(rig.headAnchor, 0.052, 0.052, 0.018, 0x141414, rig.mats, { outlineScale: 1.05 });
      rim.position.set(ex, 0.034, 0.098);
      trackBox(rim);
    }
    const bridge = k7Box(rig.headAnchor, 0.04, 0.012, 0.016, 0x141414, rig.mats, { outline: false });
    bridge.position.set(0, 0.034, 0.099);
    trackBox(bridge);
  }

  return {
    group: rig.group,
    update(t: number, dt: number, anim) {
      rig.pose(anim, t, dt);
    },
    dispose() {
      rig.dispose();
      for (const m of extraMats) m.dispose();
      for (const g of extraGeos) g.dispose();
    },
  };
}

export const def: CharacterDef = {
  id: "enemy-manhater",
  kind: "enemy",
  label: "The Man Hater",
  variants: [
    { id: "v1", label: "Disapproval" },
    { id: "v2", label: "Picket" },
    { id: "v3", label: "Cat Lady" },
  ],
  build,
};
