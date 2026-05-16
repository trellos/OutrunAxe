// Latte Sipper — Killer7-styled enemy. Tech bro with an oatmilk half-caf:
// turtleneck, expensive sneakers, smug and performative, always nursing a
// takeaway coffee cup. Flat 2-tone cel, thick ink outlines, one smug accent.
import * as THREE from "three";
import type { AnimName, BuiltCharacter, CharacterDef } from "./types";
import { HumanoidRig, type RigPalette, k7Box, part, k7Mat } from "./Killer7Style";

interface VariantSpec {
  label: string;
  pal: RigPalette;
}

// Three distinct palettes/silhouettes. Slim ~1.81u tech-bro build.
const VARIANTS: Record<string, VariantSpec> = {
  // v1 "Turtleneck" — Jobs black turtleneck, round glasses, light jeans,
  // blinding white premium sneakers, Apple-silver accent.
  v1: {
    label: "Turtleneck",
    pal: { skin: 0xd9b59a, hair: 0x2a2622, top: 0x121214, bottom: 0xb9c6d8, shoes: 0xffffff, accent: 0xc8ccd0 },
  },
  // v2 "Patagonia Vest" — branded fleece vest over a tee, AirPods, beanie,
  // startup-orange accent.
  v2: {
    label: "Patagonia Vest",
    pal: { skin: 0xddb89c, hair: 0x3a2c1c, top: 0xe8e2d4, bottom: 0x2b3340, shoes: 0x55626e, accent: 0xff7a1a },
  },
  // v3 "Hoodie Founder" — designer hoodie hood up, man-bun, chunky
  // dad-sneakers, crypto-gold accent.
  v3: {
    label: "Hoodie Founder",
    pal: { skin: 0xc99878, hair: 0x161310, top: 0x33363c, bottom: 0x1c1f24, shoes: 0xe7e2d6, accent: 0xf2c14a },
  },
};

/** Build the signature takeaway coffee cup, parented to a hand group. */
function buildCup(hand: THREE.Group, accent: number, mats: THREE.Material[]): void {
  const cup = new THREE.Group();
  cup.position.set(0, -0.06, 0.05);
  cup.rotation.x = -0.15;
  hand.add(cup);

  // Tapered paper body (narrower at the base).
  const bodyGeo = new THREE.CylinderGeometry(0.045, 0.035, 0.13, 8);
  const body = new THREE.Mesh(bodyGeo, k7Mat(0xf0ede4));
  body.position.y = 0.0;
  part(cup, body, mats, { outlineScale: 1.06 });

  // Kraft sleeve.
  const sleeveGeo = new THREE.CylinderGeometry(0.05, 0.045, 0.05, 8);
  const sleeve = new THREE.Mesh(sleeveGeo, k7Mat(0xb98a52));
  sleeve.position.y = -0.005;
  part(cup, sleeve, mats, { outlineScale: 1.05 });

  // Domed lid in the smug accent colour.
  const lidGeo = new THREE.CylinderGeometry(0.05, 0.048, 0.022, 8);
  const lid = new THREE.Mesh(lidGeo, k7Mat(accent));
  lid.position.y = 0.075;
  part(cup, lid, mats, { outlineScale: 1.06 });

  // Sip nub on the lid.
  const nub = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.018, 0.03), k7Mat(accent));
  nub.position.set(0, 0.09, 0.03);
  part(cup, nub, mats, { outline: false });
}

function build(variantId: string, _opts?: { guitar?: never }): BuiltCharacter {
  const spec = VARIANTS[variantId] ?? VARIANTS.v1;
  const rig = new HumanoidRig(spec.pal, { height: 1.81, build: "slim" });
  const extraMats: THREE.Material[] = [];
  const extraGeos: THREE.BufferGeometry[] = [];

  // Signature prop on every variant: cup carried by the rig right hand.
  buildCup(rig.handR, spec.pal.accent, extraMats);

  if (variantId === "v2") {
    // Patagonia fleece vest: a contrasting block over the tee.
    const vest = k7Box(rig.torsoAnchor, 0.34, 0.34, 0.26, 0x3a6b5a, extraMats, { outlineScale: 1.05 });
    vest.position.set(0, -0.02, 0.0);
    // Tiny branded chest patch in the accent.
    const patch = k7Box(rig.torsoAnchor, 0.06, 0.04, 0.02, spec.pal.accent, extraMats, { outline: false });
    patch.position.set(0.1, 0.05, 0.14);
    // Beanie cap.
    const beanie = k7Box(rig.headAnchor, 0.2, 0.1, 0.21, 0x2b3340, extraMats, { outlineScale: 1.06 });
    beanie.position.set(0, 0.085, 0);
    // AirPods stems by the ears.
    for (const ex of [-0.105, 0.105]) {
      const pod = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.05, 0.022), k7Mat(0xffffff));
      pod.position.set(ex, -0.01, 0.01);
      part(rig.headAnchor, pod, extraMats, { outlineScale: 1.06 });
    }
  } else if (variantId === "v3") {
    // Designer hoodie with the hood up — a block behind/over the head.
    const hood = k7Box(rig.headAnchor, 0.24, 0.26, 0.24, spec.pal.top, extraMats, { outlineScale: 1.05 });
    hood.position.set(0, 0.04, -0.06);
    // Hoodie collar bunched at the neck/torso.
    const collar = k7Box(rig.torsoAnchor, 0.3, 0.12, 0.24, spec.pal.top, extraMats, { outlineScale: 1.05 });
    collar.position.set(0, 0.12, 0.02);
    // Man-bun on top.
    const bunGeo = new THREE.SphereGeometry(0.05, 8, 6);
    extraGeos.push(bunGeo);
    const bun = new THREE.Mesh(bunGeo, k7Mat(spec.pal.hair));
    bun.position.set(0, 0.13, -0.02);
    part(rig.headAnchor, bun, extraMats, { outlineScale: 1.07 });
    // Crypto-gold drawstring tips.
    for (const dx of [-0.04, 0.04]) {
      const str = k7Box(rig.torsoAnchor, 0.02, 0.1, 0.02, spec.pal.accent, extraMats, { outline: false });
      str.position.set(dx, 0.04, 0.14);
    }
  } else {
    // v1 "Turtleneck": high collar block on the neck/torso.
    const collar = k7Box(rig.torsoAnchor, 0.2, 0.16, 0.19, spec.pal.top, extraMats, { outlineScale: 1.05 });
    collar.position.set(0, 0.14, 0.0);
    // Round glasses: thin flat ring boxes on the head.
    for (const ex of [-0.045, 0.045]) {
      const ring = k7Box(rig.headAnchor, 0.05, 0.05, 0.01, 0x101012, extraMats, { outline: false });
      ring.position.set(ex, 0.0, 0.1);
      const lens = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.006), k7Mat(0x9fb6c4));
      lens.position.set(ex, 0.0, 0.101);
      part(rig.headAnchor, lens, extraMats, { outline: false });
    }
    // Apple-silver glasses bridge.
    const bridge = k7Box(rig.headAnchor, 0.03, 0.008, 0.008, spec.pal.accent, extraMats, { outline: false });
    bridge.position.set(0, 0.0, 0.101);
  }

  let sip = 0;

  return {
    group: rig.group,
    update(t: number, dt: number, anim: AnimName) {
      rig.pose(anim, t, dt);
      // Slow performative sip on the expressive/idle states: layer a small
      // extra rotation on the right arm so the cup rises toward the mouth.
      const wantSip = anim === "taunt" || anim === "idle";
      const target = wantSip ? 1 : 0;
      sip += (target - sip) * Math.min(1, dt * 4);
      if (sip > 0.001) {
        const lift = sip * (0.55 + 0.2 * Math.sin(t * 1.5));
        rig.handR.rotation.x -= lift;
        rig.handR.rotation.z += sip * 0.25;
      }
    },
    dispose() {
      rig.dispose();
      for (const m of extraMats) m.dispose();
      for (const g of extraGeos) g.dispose();
    },
  };
}

export const def: CharacterDef = {
  id: "enemy-latte",
  kind: "enemy",
  label: "Latte Sipper",
  variants: [
    { id: "v1", label: VARIANTS.v1.label },
    { id: "v2", label: VARIANTS.v2.label },
    { id: "v3", label: VARIANTS.v3.label },
  ],
  build,
};
