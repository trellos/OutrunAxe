// 80s Gunslinger guitar hero — Killer7-styled main character.
//
// Slash / Phil-Collen energy: open vest or shirtless, slim hips, big hair,
// rockstar swagger. Three pickable variants, each with its own RigPalette,
// silhouette flourishes and one vivid accent. Built on the shared
// HumanoidRig so all six procedural anims come for free; extra decoration
// is parented to rig anchors so it tracks the body.

import * as THREE from "three";
import type { BuiltCharacter, CharacterDef, AnimName, CharacterVariant } from "./types";
import {
  HumanoidRig,
  buildK7Guitar,
  k7Box,
  part,
  k7Flat,
  type RigPalette,
  type RigShape,
} from "./Killer7Style";
import type { GuitarId } from "../../state/Loadout";

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

interface GunslingerVariant {
  readonly variant: CharacterVariant;
  readonly palette: RigPalette;
  /** Per-variant V-physique rig shape (broad shoulders → cinched waist). */
  readonly shape: RigShape;
  /** Decorate the rig with variant-specific silhouette pieces. */
  decorate(rig: HumanoidRig): void;
}

// Classic 80s rockstar V: broad chest/shoulders tapering to a narrow waist.
// Lean build (it's the taper that reads, not mass), flat male chest, slim
// hips. Each variant tweaks the V slightly to match its identity.
const V_PHYSIQUE: RigShape = {
  height: 1.85,
  build: "average",
  bust: 0,
  shoulders: 1.42,
  waist: 0.64,
  hips: 0.9,
};

/** v1 "Top Hat" — Slash: huge dark curls + black top hat, open black vest. */
const TOP_HAT: GunslingerVariant = {
  variant: { id: "v1", label: "Top Hat" },
  palette: {
    skin: 0xc89a78,
    hair: 0x141014,
    top: 0x101014, // open black vest
    bottom: 0x1a161e, // leather-look dark
    shoes: 0x0a0a0a,
    accent: 0xc41020, // blood-red
  },
  // Lean Slash silhouette: broad shoulders, very cinched waist.
  shape: { ...V_PHYSIQUE, build: "slim", shoulders: 1.4, waist: 0.62 },
  decorate(rig) {
    const m = rig.mats;
    // Huge curly mane — stacked dark blocks ringing the skull.
    const hair = TOP_HAT.palette.hair;
    k7Box(rig.headAnchor, 0.26, 0.2, 0.26, hair, m, { outlineScale: 1.08 });
    for (const a of [-1, 1] as const) {
      const lock = k7Box(rig.headAnchor, 0.12, 0.34, 0.16, hair, m, { outlineScale: 1.07 });
      lock.position.set(a * 0.14, -0.14, -0.02);
      lock.rotation.z = a * 0.18;
    }
    const back = k7Box(rig.headAnchor, 0.24, 0.32, 0.14, hair, m, { outlineScale: 1.07 });
    back.position.set(0, -0.1, -0.13);
    // Black top hat: flat-box brim + crown sitting on the curls.
    const hatBrim = k7Box(rig.headAnchor, 0.34, 0.03, 0.34, 0x080808, m, { outlineScale: 1.05 });
    hatBrim.position.set(0, 0.16, 0);
    const crown = k7Box(rig.headAnchor, 0.22, 0.22, 0.22, 0x080808, m, { outlineScale: 1.05 });
    crown.position.set(0, 0.29, 0);
    // Blood-red hat band — the one vivid accent.
    const band = k7Box(rig.headAnchor, 0.235, 0.045, 0.235, TOP_HAT.palette.accent, m, {
      outlineScale: 1.04,
    });
    band.position.set(0, 0.19, 0);
    // Open vest: two flat panels flanking a bare chest gap.
    addOpenTorso(rig, TOP_HAT.palette.top, TOP_HAT.palette.skin, TOP_HAT.palette.accent);
    addBracelet(rig, TOP_HAT.palette.accent);
  },
};

/** v2 "Snakeskin" — Phil Collen: shirtless, bleached spikes, zebra pants. */
const SNAKESKIN: GunslingerVariant = {
  variant: { id: "v2", label: "Snakeskin" },
  palette: {
    skin: 0xd4a585,
    hair: 0xf2ead0, // bleached
    top: 0xd4a585, // shirtless: torso reads as skin
    bottom: 0x1c1c20, // base of the bold two-tone trousers
    shoes: 0xf4f4f0, // white hi-tops
    accent: 0xff1f8f, // hot magenta/pink
  },
  // Shirtless gym-rat V: widest shoulders, hardest waist taper.
  shape: { ...V_PHYSIQUE, build: "average", shoulders: 1.48, waist: 0.62 },
  decorate(rig) {
    const m = rig.mats;
    const hair = SNAKESKIN.palette.hair;
    // Bright bleached spikes radiating off the crown.
    k7Box(rig.headAnchor, 0.2, 0.12, 0.2, hair, m, { outlineScale: 1.07 });
    const spikes: Array<[number, number, number, number]> = [
      [0, 0.17, -0.02, 0],
      [-0.1, 0.15, 0.0, -0.4],
      [0.1, 0.15, 0.0, 0.4],
      [0, 0.14, -0.12, 0],
      [0, 0.14, 0.1, 0],
    ];
    for (const [x, y, z, rz] of spikes) {
      const sp = k7Box(rig.headAnchor, 0.06, 0.22, 0.06, hair, m, { outlineScale: 1.08 });
      sp.position.set(x, y, z);
      sp.rotation.z = rz;
      sp.rotation.x = z * 1.6;
    }
    // Shirtless: just a thin pec/abs delineation block over the skin torso.
    const pec = k7Box(rig.torsoAnchor, 0.26, 0.16, 0.04, 0xb88a6c, m, { outlineScale: 1.04 });
    pec.position.set(0, 0.02, 0.02);
    // Flashy two-tone trousers: bright magenta side stripes on each thigh.
    addLegStripes(rig, SNAKESKIN.palette.accent);
    // Magenta wristbands.
    addBracelet(rig, SNAKESKIN.palette.accent);
  },
};

/** v3 "Bandana" — sleeveless open denim shirt, bandana, shades, long hair. */
const BANDANA: GunslingerVariant = {
  variant: { id: "v3", label: "Bandana" },
  palette: {
    skin: 0xcc9e7e,
    hair: 0x2a1d12,
    top: 0x2f5d8c, // denim blue
    bottom: 0x14233a,
    shoes: 0x101014,
    accent: 0x18e0ff, // electric cyan
  },
  // Sleeveless denim: broad shoulders, bare arms, narrow waist.
  shape: {
    ...V_PHYSIQUE,
    build: "average",
    shoulders: 1.38,
    waist: 0.66,
    sleeveless: true,
  },
  decorate(rig) {
    const m = rig.mats;
    const hair = BANDANA.palette.hair;
    // Long straight hair: cap + a long flat sheet down the back.
    k7Box(rig.headAnchor, 0.22, 0.14, 0.22, hair, m, { outlineScale: 1.07 });
    const mane = k7Box(rig.headAnchor, 0.24, 0.5, 0.1, hair, m, { outlineScale: 1.06 });
    mane.position.set(0, -0.24, -0.12);
    for (const a of [-1, 1] as const) {
      const side = k7Box(rig.headAnchor, 0.08, 0.4, 0.12, hair, m, { outlineScale: 1.06 });
      side.position.set(a * 0.13, -0.16, -0.02);
    }
    // Bandana/headband across the brow — cyan accent.
    const band = k7Box(rig.headAnchor, 0.25, 0.07, 0.25, BANDANA.palette.accent, m, {
      outlineScale: 1.05,
    });
    band.position.set(0, 0.06, 0);
    // Sunglasses: thin flat black box across the eyes (parented to head via anchor).
    const shades = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.045, 0.03), k7Flat(0x070707));
    shades.position.set(0, -0.02, 0.11);
    part(rig.headAnchor, shades, m, { outlineScale: 1.06 });
    // Sleeveless open denim shirt panels with cyan trim.
    addOpenTorso(rig, BANDANA.palette.top, BANDANA.palette.skin, BANDANA.palette.accent);
  },
};

const VARIANTS: Record<string, GunslingerVariant> = {
  v1: TOP_HAT,
  v2: SNAKESKIN,
  v3: BANDANA,
};

// ---------------------------------------------------------------------------
// Shared silhouette helpers
// ---------------------------------------------------------------------------

/** Two garment panels flanking an exposed chest, with an accent edge trim. */
function addOpenTorso(rig: HumanoidRig, garment: number, _skin: number, accent: number): void {
  const m = rig.mats;
  for (const a of [-1, 1] as const) {
    const panel = k7Box(rig.torsoAnchor, 0.13, 0.42, 0.08, garment, m, { outlineScale: 1.05 });
    panel.position.set(a * 0.13, 0.0, 0.02);
    panel.rotation.z = a * -0.06;
    const trim = k7Box(rig.torsoAnchor, 0.025, 0.42, 0.085, accent, m, { outlineScale: 1.04 });
    trim.position.set(a * 0.075, 0.0, 0.03);
  }
}

/** Vivid side stripes down each thigh — attached to the torso-relative legs. */
function addLegStripes(rig: HumanoidRig, accent: number): void {
  const m = rig.mats;
  for (const a of [-1, 1] as const) {
    // Parent to the rig group: a static decorative stripe near each hip.
    const stripe = k7Box(rig.group, 0.03, 0.5, 0.13, accent, m, { outlineScale: 1.04 });
    stripe.position.set(a * 0.13, rig.group.position.y + 0.62, 0.0);
  }
}

/** A pair of accent wristbands on both hands. */
function addBracelet(rig: HumanoidRig, accent: number): void {
  const m = rig.mats;
  for (const hand of [rig.handR, rig.handL]) {
    const band = k7Box(hand, 0.075, 0.05, 0.075, accent, m, { outlineScale: 1.05 });
    band.position.set(0, 0.02, 0);
  }
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * A broad pec/lat shoulder plate on the torso anchor. In the flat Killer7
 * style a single chest block can read narrow head-on; this wide, shallow
 * wedge widens the upper silhouette so the V (vs. the cinched waist below)
 * is unmistakable from the front in the play pose.
 */
function addVShoulderPlate(rig: HumanoidRig, garment: number): void {
  const m = rig.mats;
  // Wide shallow slab across the upper chest = broad pec line.
  const pecs = k7Box(rig.torsoAnchor, 0.5, 0.2, 0.05, garment, m, { outlineScale: 1.04 });
  pecs.position.set(0, 0.1, 0.02);
  // Angled lat wedges flaring out under each shoulder, tapering inward.
  for (const a of [-1, 1] as const) {
    const lat = k7Box(rig.torsoAnchor, 0.16, 0.26, 0.06, garment, m, { outlineScale: 1.04 });
    lat.position.set(a * 0.21, 0.04, 0.0);
    lat.rotation.z = a * 0.34; // splay outward at the top, narrow at the waist
  }
}

function build(variantId: string, opts?: { guitar?: GuitarId }): BuiltCharacter {
  const v = VARIANTS[variantId] ?? TOP_HAT;
  const rig = new HumanoidRig(v.palette, v.shape);
  // Broaden the upper body before variant flourishes so the V reads in the
  // flat Killer7 style; tinted to the variant's torso colour (skin when
  // shirtless/sleeveless so it reads as a built chest, not a garment).
  addVShoulderPlate(rig, v.palette.top);
  v.decorate(rig);

  let guitar = buildK7Guitar(opts?.guitar ?? "goldtop");
  rig.heldPivot.add(guitar.group);

  return {
    group: rig.group,
    update(t: number, dt: number, anim: AnimName) {
      rig.pose(anim, t, dt);
      // Extra rockstar hair sway on top of the rig pose.
      const sway = Math.sin(t * 3.1) * 0.06 + Math.sin(t * 1.3) * 0.03;
      rig.headAnchor.rotation.z = sway * 0.4;
      rig.headAnchor.rotation.x = Math.sin(t * 2.2) * 0.03;
    },
    setGuitar(g: GuitarId) {
      rig.heldPivot.remove(guitar.group);
      guitar.dispose();
      guitar = buildK7Guitar(g);
      rig.heldPivot.add(guitar.group);
    },
    dispose() {
      rig.dispose();
      guitar.dispose();
    },
  };
}

export const def: CharacterDef = {
  id: "main-gunslinger",
  kind: "main",
  label: "Dirty Velvet",
  variants: [TOP_HAT.variant, SNAKESKIN.variant, BANDANA.variant],
  build,
};
