// The Prude — a proper, buttoned-up, disapproving woman. Long below-the-knee
// skirt, sensible low heels, neck-to-wrist sweater. Killer7 flat 2-tone cel:
// bold limited palette, thick black ink outlines, hard terminator, one vivid
// severe accent per variant. Rigid noir caricature of decorum.
//
// Silhouette signature = FULL COVERAGE: a tall tapered skirt block dropping
// well below the knee (wider at the hem), a high-neck long-sleeve sweater
// (covered arms + a collar ring on the neck). Three variants:
//   v1 "Schoolmarm"  — gray bun, ankle-length charcoal skirt, pearls, scowl.
//   v2 "Sunday Best"  — modest hat, pleated skirt, gloved hands.
//   v3 "Librarian"    — side-part hair, chained reading glasses, A-line skirt.

import * as THREE from "three";
import type { BuiltCharacter, CharacterDef } from "./types";
import { HumanoidRig, k7Box, part, k7Mat, k7Flat, type RigPalette } from "./Killer7Style";

type Variant = "v1" | "v2" | "v3";

interface PrudeSpec {
  palette: RigPalette;
  /** Long skirt hem colour (defaults to palette.bottom). */
  skirt: number;
  /** Skirt length as fraction of height — must drop below the knee. */
  skirtLen: number;
  /** Hem half-width (wider = more flare). */
  skirtHem: number;
  hat: "bun" | "hat" | "sidepart";
  pearls: boolean;
  glasses: boolean;
  scowl: boolean;
  /** Tint the hands as gloves instead of skin. */
  gloves: boolean;
}

const SHAPE = { height: 1.74, build: "average" as const, hips: 1.05, bust: 0.25 };

const SPECS: Record<Variant, PrudeSpec> = {
  // Schoolmarm — charcoal, austere maroon accent, tight gray bun, pearls.
  v1: {
    palette: {
      skin: 0xe3c4a6,
      hair: 0x9a9690,
      top: 0x33363b,
      bottom: 0x2b2d31,
      shoes: 0x141414,
      accent: 0x7a2230,
    },
    skirt: 0x2b2d31,
    skirtLen: 0.56,
    skirtHem: 0.27,
    hat: "bun",
    pearls: true,
    glasses: false,
    scowl: true,
    gloves: false,
  },
  // Sunday Best — somber navy accent, modest hat, gloves, pleated skirt.
  v2: {
    palette: {
      skin: 0xe6c8aa,
      hair: 0x3b2c1e,
      top: 0xcfcbc0,
      bottom: 0x232a3c,
      shoes: 0x16181f,
      accent: 0x1f2d52,
    },
    skirt: 0x232a3c,
    skirtLen: 0.58,
    skirtHem: 0.31,
    hat: "hat",
    pearls: false,
    glasses: false,
    scowl: false,
    gloves: true,
  },
  // Librarian — dust green accent, severe side-part, chained glasses, A-line.
  v3: {
    palette: {
      skin: 0xdfbf9f,
      hair: 0x5a4632,
      top: 0x4a4f43,
      bottom: 0x3c4234,
      shoes: 0x201d16,
      accent: 0x7e8a55,
    },
    skirt: 0x3c4234,
    skirtLen: 0.6,
    skirtHem: 0.33,
    hat: "sidepart",
    pearls: false,
    glasses: true,
    scowl: false,
    gloves: false,
  },
};

function build(variantId: string, _opts?: { guitar?: never }): BuiltCharacter {
  const v: Variant = variantId === "v2" ? "v2" : variantId === "v3" ? "v3" : "v1";
  const spec = SPECS[v];
  const rig = new HumanoidRig(spec.palette, SHAPE);

  // Extra geometry / materials this character owns beyond the rig.
  const geos: THREE.BufferGeometry[] = [];
  const extraMats: THREE.Material[] = [];

  const H = SHAPE.height;
  const hipY = H * 0.5; // rig.group origin -> hip joint height

  // -------------------------------------------------------------------------
  // Long skirt — a tall tapered block parented to rig.group at hip height,
  // narrow at the waist and flared at the hem, dropping well below the knee
  // so it visually covers the leg gap. Built as a tapered cylinder (8-gon)
  // for a clean Killer7 block read, with a thick ink hull.
  // -------------------------------------------------------------------------
  const skirtLen = H * spec.skirtLen;
  const waistR = 0.2;
  const hemR = spec.skirtHem;
  const skirtGeo = new THREE.CylinderGeometry(waistR, hemR, skirtLen, 8);
  geos.push(skirtGeo);
  const skirtMat = k7Mat(spec.skirt);
  extraMats.push(skirtMat);
  const skirt = new THREE.Mesh(skirtGeo, skirtMat);
  // Top of skirt sits a touch above the hip joint; hangs straight down.
  skirt.position.y = hipY - 0.04 - skirtLen * 0.5;
  part(rig.group, skirt, extraMats, { outlineScale: 1.05 });

  // Accent waistband band just above the skirt.
  const band = k7Box(rig.group, hemR * 0.55, 0.06, hemR * 0.55, spec.palette.accent, extraMats, {
    outlineScale: 1.06,
  });
  band.position.y = hipY - 0.02;

  // -------------------------------------------------------------------------
  // High-neck sweater collar — a ring block on the neck (covers neck-to-jaw).
  // -------------------------------------------------------------------------
  const collar = k7Box(rig.torsoAnchor, 0.22, 0.12, 0.22, spec.palette.top, extraMats, {
    outlineScale: 1.05,
  });
  collar.position.set(0, 0.16, 0.0);
  const collarTrim = k7Box(rig.torsoAnchor, 0.18, 0.04, 0.18, spec.palette.accent, extraMats, {
    outline: false,
  });
  collarTrim.position.set(0, 0.22, 0.0);

  // Long covered forearms — sleeve cuffs over the rig's bare skin forearms,
  // so the sweater reads neck-to-wrist. Tinted as top (or accent cuff).
  for (const hand of [rig.handR, rig.handL]) {
    const cuff = k7Box(hand, 0.11, 0.16, 0.11, spec.palette.top, extraMats, { outlineScale: 1.05 });
    cuff.position.y = 0.16;
    const cuffTrim = k7Box(hand, 0.12, 0.03, 0.12, spec.palette.accent, extraMats, {
      outline: false,
    });
    cuffTrim.position.y = 0.08;
  }

  // Optional gloves: recolour the visible hands as glove colour, not skin.
  if (spec.gloves) {
    for (const hand of [rig.handR, rig.handL]) {
      const glove = k7Box(hand, 0.08, 0.11, 0.06, spec.palette.accent, extraMats, {
        outlineScale: 1.05,
      });
      glove.position.y = -0.04;
    }
  }

  // -------------------------------------------------------------------------
  // Pearl necklace (v1) — a thin flat ring resting on the torso anchor.
  // -------------------------------------------------------------------------
  if (spec.pearls) {
    const pearlGeo = new THREE.TorusGeometry(0.13, 0.018, 6, 16);
    geos.push(pearlGeo);
    const pearlMat = k7Flat(0xf2efe4);
    extraMats.push(pearlMat);
    const pearls = new THREE.Mesh(pearlGeo, pearlMat);
    pearls.rotation.x = Math.PI / 2;
    pearls.position.set(0, 0.06, 0.08);
    rig.torsoAnchor.add(pearls);
  }

  // -------------------------------------------------------------------------
  // Headwear / hair per variant — parented to rig.headAnchor.
  // -------------------------------------------------------------------------
  if (spec.hat === "bun") {
    // Tight gray bun: small box at the back-top of the head.
    const bun = k7Box(rig.headAnchor, 0.12, 0.12, 0.12, spec.palette.hair, extraMats, {
      outlineScale: 1.06,
    });
    bun.position.set(0, 0.1, -0.09);
    // Hair cap covering the crown.
    const cap = k7Box(rig.headAnchor, 0.19, 0.1, 0.2, spec.palette.hair, extraMats, {
      outlineScale: 1.05,
    });
    cap.position.set(0, 0.08, -0.01);
  } else if (spec.hat === "hat") {
    // Modest church hat: flat disc brim + small dome crown.
    const brimGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.03, 14);
    geos.push(brimGeo);
    const brimMat = k7Mat(spec.palette.accent);
    extraMats.push(brimMat);
    const brim = new THREE.Mesh(brimGeo, brimMat);
    brim.position.set(0, 0.1, 0);
    part(rig.headAnchor, brim, extraMats, { outlineScale: 1.05 });
    const domeGeo = new THREE.SphereGeometry(0.11, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5);
    geos.push(domeGeo);
    const domeMat = k7Mat(spec.palette.accent);
    extraMats.push(domeMat);
    const dome = new THREE.Mesh(domeGeo, domeMat);
    dome.position.set(0, 0.11, 0);
    part(rig.headAnchor, dome, extraMats, { outlineScale: 1.05 });
  } else {
    // Severe side-part: an offset hair cap with a hard parting block.
    const cap = k7Box(rig.headAnchor, 0.2, 0.12, 0.21, spec.palette.hair, extraMats, {
      outlineScale: 1.05,
    });
    cap.position.set(0.015, 0.08, -0.01);
    const part2 = k7Box(rig.headAnchor, 0.02, 0.13, 0.21, 0x161310, extraMats, { outline: false });
    part2.position.set(-0.05, 0.1, -0.01);
  }

  // -------------------------------------------------------------------------
  // Pinched scowl brow (v1) — small dark angled boxes on the head anchor.
  // -------------------------------------------------------------------------
  if (spec.scowl) {
    for (const side of [-1, 1] as const) {
      const brow = k7Box(rig.headAnchor, 0.05, 0.014, 0.02, 0x100d0b, extraMats, {
        outline: false,
      });
      // headAnchor sits mid-head; place brows just above eye line, angled in.
      brow.position.set(side * 0.045, 0.0, 0.095);
      brow.rotation.z = side * 0.4;
    }
  }

  // -------------------------------------------------------------------------
  // Chained reading glasses (v3) — two ring boxes + a thin chain hint.
  // -------------------------------------------------------------------------
  if (spec.glasses) {
    const frameMat = k7Flat(0x141414);
    for (const side of [-1, 1] as const) {
      const lensGeo = new THREE.TorusGeometry(0.034, 0.008, 6, 14);
      geos.push(lensGeo);
      extraMats.push(frameMat);
      const lens = new THREE.Mesh(lensGeo, frameMat);
      lens.position.set(side * 0.045, 0.0, 0.1);
      rig.headAnchor.add(lens);
    }
    // Bridge.
    const bridge = k7Box(rig.headAnchor, 0.03, 0.008, 0.01, 0x141414, extraMats, {
      outline: false,
    });
    bridge.position.set(0, 0.0, 0.1);
    // Thin chain hint draping to the sides.
    for (const side of [-1, 1] as const) {
      const chain = k7Box(rig.headAnchor, 0.008, 0.14, 0.008, spec.palette.accent, extraMats, {
        outline: false,
      });
      chain.position.set(side * 0.09, -0.07, 0.04);
      chain.rotation.z = side * 0.3;
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle.
  // -------------------------------------------------------------------------
  return {
    group: rig.group,
    update(t: number, dt: number, anim) {
      // Enemy default expressive anim is "taunt" (read here as a rigid,
      // finger-wagging disapproval — the rig's lean-back wave). All 6 work.
      rig.pose(anim, t, dt);
    },
    dispose() {
      rig.dispose();
      for (const m of extraMats) m.dispose();
      for (const g of geos) g.dispose();
    },
  };
}

export const def: CharacterDef = {
  id: "enemy-prude",
  kind: "enemy",
  label: "The Prude",
  variants: [
    { id: "v1", label: "Schoolmarm" },
    { id: "v2", label: "Sunday Best" },
    { id: "v3", label: "Librarian" },
  ],
  build,
};
