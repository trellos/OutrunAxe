// Metal main — heavy-metal beast in the Killer7 cel idiom.
//
// Think Zakk Wylde: a big "buff" build with huge arms breaking out of black
// clothes, long hair, all-black wardrobe and ONE savage accent per variant.
// Three silhouettes share the rig but read instantly apart at a glance:
//   v1 Berserker  — waist-length hair + heavy beard, lime bullseye decal.
//   v2 Battle Vest — collared studded vest, bandana, blood-red accent.
//   v3 Corpse      — corpse-paint face, spiked shoulder pads, ice-blue accent.
//
// All decoration is parented to rig anchors; "play" adds a sin-driven hair
// whip on a hair group sitting on the headAnchor.

import * as THREE from "three";
import type { BuiltCharacter, CharacterDef } from "./types";
import {
  HumanoidRig,
  buildK7Guitar,
  part,
  k7Box,
  k7Mat,
  k7Flat,
  type RigPalette,
} from "./Killer7Style";
import type { GuitarId } from "../../state/Loadout";

// ---------------------------------------------------------------------------
// Per-variant palette + silhouette
// ---------------------------------------------------------------------------

interface MetalVariant {
  id: string;
  label: string;
  palette: RigPalette;
  /**
   * Decorate the rig; return an optional hair group for the play whip.
   * `ownedGeo` collects any geometry this file allocates so the per-build
   * `dispose` can free it.
   */
  dress(rig: HumanoidRig, ownedGeo: THREE.BufferGeometry[]): THREE.Group | null;
}

/**
 * Big-bicep silhouette: a rounded skin-tone bulge on the upper-arm anchor
 * plus a leaner forearm "vein" ridge on the forearm anchor. Parented to the
 * limb-segment mids so the muscle reads in the flat Killer7 style and tracks
 * the arm through the pose. Anchors face down the limb (-Y toward the hand).
 * Geometry it allocates is pushed into `ownedGeo` so the per-build `dispose`
 * can free it (the rig disposes its own geo + the shared mats).
 */
function metalArms(
  rig: HumanoidRig,
  skin: number,
  ownedGeo: THREE.BufferGeometry[],
) {
  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    ownedGeo.push(g);
    return g;
  };
  for (const ua of [rig.upperArmAnchorR, rig.upperArmAnchorL]) {
    // Outer bicep peak — a squashed sphere bulging forward off the arm.
    const peak = new THREE.Mesh(
      trackGeo(new THREE.SphereGeometry(0.082, 10, 8)),
      k7Mat(skin),
    );
    peak.scale.set(1.0, 1.35, 1.05);
    peak.position.set(0, 0.01, 0.035);
    part(ua, peak, rig.mats, { outlineScale: 1.06 });
    // Tricep counter-mass so the arm reads thick from every angle, not just
    // a front lump.
    const tri = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.1, 0.18, 0.09)),
      k7Mat(skin),
    );
    tri.position.set(0, -0.02, -0.03);
    part(ua, tri, rig.mats, { outlineScale: 1.05 });
  }
  for (const fa of [rig.foreArmAnchorR, rig.foreArmAnchorL]) {
    // Forearm flexor swell + a thin raised vein ridge.
    const flex = new THREE.Mesh(
      trackGeo(new THREE.SphereGeometry(0.055, 8, 7)),
      k7Mat(skin),
    );
    flex.scale.set(1.0, 1.5, 1.0);
    flex.position.set(0, 0.03, 0.02);
    part(fa, flex, rig.mats, { outlineScale: 1.05 });
    const vein = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.012, 0.14, 0.012)),
      k7Mat(skin),
    );
    vein.position.set(0.02, 0.0, 0.05);
    vein.rotation.z = 0.18;
    part(fa, vein, rig.mats, { outlineScale: 1.06 });
  }
}

const BLACK = 0x0a0a0a;
const NEAR_BLACK = 0x111114;
const COAL = 0x161618;

/** Long straight hair slab hung off the head anchor (whips on "play"). */
function longHair(
  rig: HumanoidRig,
  color: number,
  length: number,
): THREE.Group {
  const hair = new THREE.Group();
  // Skull cap.
  const cap = new THREE.Mesh(
    new THREE.BoxGeometry(0.21, 0.16, 0.21),
    k7Mat(color),
  );
  cap.position.set(0, 0.03, -0.01);
  part(hair, cap, rig.mats, { outlineScale: 1.06 });
  // Curtain down the back/sides.
  for (const sx of [-0.07, 0, 0.07]) {
    const strand = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, length, 0.07),
      k7Mat(color),
    );
    strand.position.set(sx, -length * 0.5 + 0.02, -0.08);
    part(hair, strand, rig.mats, { outlineScale: 1.05 });
  }
  // Front fringe.
  const fringe = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.12, 0.06),
    k7Mat(color),
  );
  fringe.position.set(0, 0.04, 0.085);
  part(hair, fringe, rig.mats, { outlineScale: 1.05 });
  rig.headAnchor.add(hair);
  return hair;
}

/** Blocky beard hung on the lower face. */
function beard(rig: THREE.Object3D, mats: THREE.Material[], color: number) {
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.12), k7Mat(color));
  jaw.position.set(0, -0.085, 0.045);
  part(rig, jaw, mats, { outlineScale: 1.05 });
  const point = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.09), k7Mat(color));
  point.position.set(0, -0.18, 0.03);
  part(rig, point, mats, { outlineScale: 1.05 });
}

/** Concentric flat rings (bullseye decal) on the torso anchor. */
function bullseye(rig: HumanoidRig, accent: number) {
  const radii: [number, number][] = [
    [0.13, accent],
    [0.1, 0x0a0a0a],
    [0.07, accent],
    [0.035, 0x0a0a0a],
  ];
  let z = 0.02;
  for (const [r, c] of radii) {
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, 0.012, 20),
      k7Flat(c),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, 0.02, z);
    rig.torsoAnchor.add(ring);
    z += 0.004;
  }
}

/** Small studded wristband ring on a hand group. */
function wristband(hand: THREE.Group, mats: THREE.Material[], stud: number) {
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, 0.07, 10),
    k7Mat(0x070707),
  );
  band.position.y = 0.02;
  part(hand, band, mats, { outlineScale: 1.06 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const studM = new THREE.Mesh(
      new THREE.ConeGeometry(0.018, 0.04, 4),
      k7Flat(stud),
    );
    studM.position.set(Math.cos(a) * 0.075, 0.02, Math.sin(a) * 0.075);
    studM.rotation.z = -Math.PI / 2;
    studM.rotation.y = -a;
    hand.add(studM);
  }
}

/** Spiked pyramid pad sitting on a shoulder (offset on the torso anchor). */
function spikePad(rig: HumanoidRig, side: -1 | 1, accent: number) {
  const pad = new THREE.Group();
  pad.position.set(side * 0.34, 0.16, -0.02);
  const base = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    k7Mat(0x080808),
  );
  part(pad, base, rig.mats, { outlineScale: 1.05 });
  for (const [ox, oz, h] of [
    [0, 0, 0.22],
    [-0.09, 0.02, 0.16],
    [0.09, 0.02, 0.16],
    [0, 0.09, 0.15],
  ] as [number, number, number][]) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.04, h, 4), k7Flat(accent));
    spike.position.set(ox, h * 0.5, oz);
    part(pad, spike, rig.mats, { outlineScale: 1.04 });
  }
  rig.torsoAnchor.add(pad);
}

/** White corpse-paint blocks on the (kept-dark) skull. */
function corpsePaint(rig: HumanoidRig) {
  const head = rig.headAnchor;
  for (const ex of [-0.05, 0.05]) {
    const patch = new THREE.Mesh(
      new THREE.BoxGeometry(0.075, 0.085, 0.02),
      k7Flat(0xf2f2f2),
    );
    patch.position.set(ex, 0.0, 0.094);
    head.add(patch);
  }
  // Painted brow band + nasal smear.
  const brow = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.02), k7Flat(0xf2f2f2));
  brow.position.set(0, 0.06, 0.093);
  head.add(brow);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.02), k7Flat(0x070707));
  nose.position.set(0, -0.02, 0.096);
  head.add(nose);
}

/** Raised collar / battle-vest yoke on the torso anchor. */
function battleVest(rig: HumanoidRig, accent: number) {
  // Vest front panel.
  k7Box(rig.torsoAnchor, 0.4, 0.34, 0.12, COAL, rig.mats, { outlineScale: 1.04 });
  // Raised collar wings.
  for (const sx of [-1, 1] as const) {
    const wing = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.18, 0.08),
      k7Mat(NEAR_BLACK),
    );
    wing.position.set(sx * 0.16, 0.22, 0.02);
    wing.rotation.z = sx * -0.35;
    part(rig.torsoAnchor, wing, rig.mats, { outlineScale: 1.05 });
  }
  // Accent back-patch stripe + studs.
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.02), k7Flat(accent));
  stripe.position.set(0, -0.04, 0.07);
  rig.torsoAnchor.add(stripe);
  for (let i = -2; i <= 2; i++) {
    const stud = new THREE.Mesh(new THREE.ConeGeometry(0.015, 0.03, 4), k7Flat(0xcfcfcf));
    stud.position.set(i * 0.07, 0.08, 0.07);
    rig.torsoAnchor.add(stud);
  }
}

const VARIANTS: MetalVariant[] = [
  {
    id: "v1",
    label: "Berserker",
    palette: {
      skin: 0xc9a081,
      hair: BLACK,
      top: NEAR_BLACK,
      bottom: 0x14141a,
      shoes: BLACK,
      accent: 0xc7ff2b, // toxic lime
    },
    dress(rig, ownedGeo) {
      const hair = longHair(rig, BLACK, 0.95); // waist-length
      beard(rig.headAnchor, rig.mats, BLACK);
      bullseye(rig, 0xc7ff2b);
      // Sleeveless cutoff: bare-arm skin already shows from the rig; add a
      // ragged hem block on the torso.
      const hem = new THREE.Mesh(
        new THREE.BoxGeometry(0.42, 0.08, 0.26),
        k7Mat(NEAR_BLACK),
      );
      ownedGeo.push(hem.geometry);
      hem.position.set(0, -0.16, 0);
      part(rig.torsoAnchor, hem, rig.mats, { outlineScale: 1.04 });
      metalArms(rig, this.palette.skin, ownedGeo);
      return hair;
    },
  },
  {
    id: "v2",
    label: "Battle Vest",
    palette: {
      skin: 0xc7a07e,
      hair: 0x1a1410,
      top: BLACK,
      bottom: 0x121212,
      shoes: BLACK,
      accent: 0xc81f1f, // blood red
    },
    dress(rig, ownedGeo) {
      // Bandana cap (no long hair group → bald-with-bandana silhouette).
      const bandana = new THREE.Mesh(
        new THREE.BoxGeometry(0.21, 0.1, 0.21),
        k7Mat(0x080808),
      );
      bandana.position.set(0, 0.06, 0);
      part(rig.headAnchor, bandana, rig.mats, { outlineScale: 1.06 });
      const knot = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.05, 0.12),
        k7Flat(0xc81f1f),
      );
      knot.position.set(-0.1, 0.04, -0.06);
      rig.headAnchor.add(knot);
      beard(rig.headAnchor, rig.mats, 0x141008);
      battleVest(rig, 0xc81f1f);
      wristband(rig.handR, rig.mats, 0xd0d0d0);
      wristband(rig.handL, rig.mats, 0xd0d0d0);
      metalArms(rig, this.palette.skin, ownedGeo);
      return null; // no whip-hair on this one
    },
  },
  {
    id: "v3",
    label: "Corpse",
    palette: {
      skin: 0x6f6f74, // ashen
      hair: BLACK,
      top: BLACK,
      bottom: 0x101014,
      shoes: BLACK,
      accent: 0x7fc8ff, // ice blue
    },
    dress(rig, ownedGeo) {
      const hair = longHair(rig, BLACK, 0.78);
      corpsePaint(rig);
      spikePad(rig, -1, 0x7fc8ff);
      spikePad(rig, 1, 0x7fc8ff);
      // Ice-blue cross sigil on the chest.
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.02), k7Flat(0x7fc8ff));
      v.position.set(0, 0.02, 0.03);
      rig.torsoAnchor.add(v);
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.02), k7Flat(0x7fc8ff));
      h.position.set(0, 0.06, 0.03);
      rig.torsoAnchor.add(h);
      metalArms(rig, this.palette.skin, ownedGeo);
      return hair;
    },
  },
];

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

function build(variantId: string, opts?: { guitar?: GuitarId }): BuiltCharacter {
  const v = VARIANTS.find((x) => x.id === variantId) ?? VARIANTS[0];
  const rig = new HumanoidRig(v.palette, {
    height: 1.88,
    build: "buff",
    // Wide-shoulder / cinched-waist V so the bare arms read as the focal
    // mass: thick biceps via armThickness (kept above the buff bulk so the
    // arms dominate without ballooning the whole torso) and a tighter waist.
    shoulders: 1.22,
    waist: 0.7,
    armThickness: 1.7,
    sleeveless: true,
  });
  // Geometry this file allocates for the bicep/forearm silhouettes (and the
  // v1 hem) — scoped per build so disposing one instance never frees
  // another's geo. The rig owns its own geo + the shared materials.
  const ownedGeo: THREE.BufferGeometry[] = [];
  const hairGroup = v.dress(rig, ownedGeo);

  let guitar = buildK7Guitar(opts?.guitar ?? "goldtop");
  rig.heldPivot.add(guitar.group);

  return {
    group: rig.group,
    update(t: number, dt: number, anim) {
      rig.pose(anim, t, dt);
      if (hairGroup) {
        // Headbang whip while shredding; gentle sway otherwise.
        const whip = anim === "play" ? Math.sin(t * 10) * 0.32 : Math.sin(t * 1.6) * 0.05;
        hairGroup.rotation.x = whip;
        hairGroup.rotation.z = anim === "play" ? Math.sin(t * 5) * 0.12 : 0;
      }
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
      // Free the bicep/forearm silhouette geometry this file allocated
      // (materials are registered in rig.mats and freed by rig.dispose).
      for (const g of ownedGeo) g.dispose();
    },
  };
}

export const def: CharacterDef = {
  id: "main-metal",
  kind: "main",
  label: "Winter",
  variants: VARIANTS.map((v) => ({ id: v.id, label: v.label })),
  build,
};
