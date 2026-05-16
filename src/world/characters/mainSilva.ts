// Skinny Singer — tall, very skinny J-pop girl (think the singer Silva):
// long legs, tiny crop tee + short shorts, cool/aloof attitude.
//
// Killer7 look: flat 2-tone cel, bold limited palette, thick black ink
// outline, hard terminator, elongated stylised noir, one vivid accent.
// Each of the three variants gets its own RigPalette + silhouette set.
//
// The shared HumanoidRig only exposes headAnchor / torsoAnchor / handR /
// handL / heldPivot, so all decoration parents to those anchors (hair on
// headAnchor, tee + midriff + leg-wear hung from torsoAnchor so they still
// move with the torso pose).

import type { BuiltCharacter, CharacterDef } from "./types";
import { HumanoidRig, buildK7Guitar, k7Box } from "./Killer7Style";
import type { RigPalette, RigShape } from "./Killer7Style";
import type { GuitarId } from "../../state/Loadout";
import * as THREE from "three";

interface SilvaVariant {
  palette: RigPalette;
  shape: RigShape;
  /** Add hair/clothing silhouette flourishes onto the rig's anchors. */
  decorate(rig: HumanoidRig, pal: RigPalette, extra: THREE.Material[]): void;
}

// ---------------------------------------------------------------------------
// v1 "Neon Crop" — long straight black hair, white crop tee, denim-blue
// tiny shorts, chunky white sneakers, accent = electric cyan.
// ---------------------------------------------------------------------------

const V1: SilvaVariant = {
  palette: {
    skin: 0xe7c1a4,
    hair: 0x0e0b10,
    top: 0xf4f4f0, // white crop tee
    bottom: 0x35527e, // denim blue shorts
    shoes: 0xf2f2f2, // chunky white sneakers
    accent: 0x18e7ff, // electric cyan
  },
  shape: { height: 1.88, build: "slim", hips: 0.9, shoulders: 0.88, bust: 0.34 },
  decorate(rig, pal, extra) {
    const a = pal.accent;

    // Long straight black hair: flat back curtain + side strands + cap.
    const back = k7Box(rig.headAnchor, 0.2, 0.66, 0.08, pal.hair, extra, { outlineScale: 1.05 });
    back.position.set(0, -0.18, -0.085);
    const cap = k7Box(rig.headAnchor, 0.205, 0.16, 0.21, pal.hair, extra, { outlineScale: 1.05 });
    cap.position.set(0, 0.045, -0.01);
    for (const sx of [-0.105, 0.105]) {
      const strand = k7Box(rig.headAnchor, 0.045, 0.5, 0.06, pal.hair, extra, {
        outlineScale: 1.05,
      });
      strand.position.set(sx, -0.12, 0.05);
    }
    // Cyan accent: a swept fringe streak.
    const streak = k7Box(rig.headAnchor, 0.07, 0.1, 0.02, a, extra, { outlineScale: 1.04 });
    streak.position.set(-0.05, 0.06, 0.1);

    // Crop tee: short top stops high so a skin midriff band shows.
    const tee = k7Box(rig.torsoAnchor, 0.34, 0.18, 0.26, pal.top, extra, { outlineScale: 1.04 });
    tee.position.set(0, 0.05, 0);
    const midriff = k7Box(rig.torsoAnchor, 0.3, 0.16, 0.22, pal.skin, extra, {
      outlineScale: 1.04,
    });
    midriff.position.set(0, -0.16, 0);
    // Cyan trim line along the tee hem.
    const hem = k7Box(rig.torsoAnchor, 0.345, 0.022, 0.265, a, extra, { outline: false });
    hem.position.set(0, -0.045, 0);
  },
};

// ---------------------------------------------------------------------------
// v2 "Bob" — sharp asymmetric bob, pastel-pink crop top, black micro
// shorts, knee-high boots, accent = hot pink.
// ---------------------------------------------------------------------------

const V2: SilvaVariant = {
  palette: {
    skin: 0xeac3a6,
    hair: 0x141016,
    top: 0xf6b8cf, // pastel pink crop top
    bottom: 0x121016, // black micro shorts
    shoes: 0x16131a, // knee-high boots
    accent: 0xff2f86, // hot pink
  },
  shape: { height: 1.86, build: "slim", hips: 0.92, shoulders: 0.86, bust: 0.36 },
  decorate(rig, pal, extra) {
    const a = pal.accent;

    // Asymmetric bob: rounded cap + one long side, one short side.
    const cap = k7Box(rig.headAnchor, 0.21, 0.2, 0.215, pal.hair, extra, { outlineScale: 1.05 });
    cap.position.set(0, 0.04, -0.005);
    const longSide = k7Box(rig.headAnchor, 0.07, 0.34, 0.21, pal.hair, extra, {
      outlineScale: 1.05,
    });
    longSide.position.set(-0.11, -0.1, 0.0);
    const shortSide = k7Box(rig.headAnchor, 0.065, 0.2, 0.21, pal.hair, extra, {
      outlineScale: 1.05,
    });
    shortSide.position.set(0.11, -0.02, 0.0);
    // Hot-pink tip on the long side.
    const tip = k7Box(rig.headAnchor, 0.072, 0.08, 0.213, a, extra, { outlineScale: 1.04 });
    tip.position.set(-0.11, -0.25, 0.0);

    // Pastel-pink crop top — short, midriff visible below.
    const top = k7Box(rig.torsoAnchor, 0.34, 0.17, 0.26, pal.top, extra, { outlineScale: 1.04 });
    top.position.set(0, 0.06, 0);
    const midriff = k7Box(rig.torsoAnchor, 0.3, 0.17, 0.22, pal.skin, extra, {
      outlineScale: 1.04,
    });
    midriff.position.set(0, -0.16, 0);

    // Knee-high boots: long shoe blocks hung from the torso anchor so they
    // ride with the torso (rig exposes no leg anchor). Reach down each shin.
    for (const bx of [-0.085, 0.085]) {
      const boot = k7Box(rig.torsoAnchor, 0.13, 0.46, 0.16, pal.shoes, extra, {
        outlineScale: 1.05,
      });
      boot.position.set(bx, -0.74, -0.02);
      const cuff = k7Box(rig.torsoAnchor, 0.14, 0.04, 0.17, a, extra, { outline: false });
      cuff.position.set(bx, -0.53, -0.02);
    }
  },
};

// ---------------------------------------------------------------------------
// v3 "Ponytail" — high ponytail, bold single-color graphic tee, athletic
// shorts, ankle socks + trainers, accent = lime green.
// ---------------------------------------------------------------------------

const V3: SilvaVariant = {
  palette: {
    skin: 0xe6bf9f,
    hair: 0x100c0e,
    top: 0x9b1f3a, // bold single-color graphic tee
    bottom: 0x1c1c22, // athletic shorts
    shoes: 0xf0f0ee, // trainers
    accent: 0xb6ff2e, // lime green
  },
  shape: { height: 1.87, build: "slim", hips: 0.9, shoulders: 0.9, bust: 0.32 },
  decorate(rig, pal, extra) {
    const a = pal.accent;

    // High back-swept ponytail: tight cap + swept tail + tie.
    const cap = k7Box(rig.headAnchor, 0.2, 0.18, 0.205, pal.hair, extra, { outlineScale: 1.05 });
    cap.position.set(0, 0.045, -0.005);
    const tail = k7Box(rig.headAnchor, 0.08, 0.5, 0.08, pal.hair, extra, { outlineScale: 1.05 });
    tail.position.set(0, 0.0, -0.16);
    tail.rotation.x = -0.55;
    const tie = k7Box(rig.headAnchor, 0.07, 0.045, 0.07, a, extra, { outline: false });
    tie.position.set(0, 0.13, -0.1);

    // Bold graphic tee — short crop, midriff visible, lime chest decal.
    const tee = k7Box(rig.torsoAnchor, 0.35, 0.19, 0.27, pal.top, extra, { outlineScale: 1.04 });
    tee.position.set(0, 0.05, 0);
    const decal = k7Box(rig.torsoAnchor, 0.12, 0.12, 0.02, a, extra, { outline: false });
    decal.position.set(0, 0.07, 0.135);
    const midriff = k7Box(rig.torsoAnchor, 0.31, 0.16, 0.23, pal.skin, extra, {
      outlineScale: 1.04,
    });
    midriff.position.set(0, -0.17, 0);

    // Ankle socks + trainers hung from torso anchor (no leg anchor exposed).
    for (const lx of [-0.085, 0.085]) {
      const sock = k7Box(rig.torsoAnchor, 0.108, 0.12, 0.13, 0xf4f4f0, extra, {
        outlineScale: 1.05,
      });
      sock.position.set(lx, -0.92, 0.0);
      const stripe = k7Box(rig.torsoAnchor, 0.112, 0.02, 0.133, a, extra, { outline: false });
      stripe.position.set(lx, -0.88, 0.0);
    }
  },
};

const VARIANTS: Record<string, SilvaVariant> = { v1: V1, v2: V2, v3: V3 };

function build(variantId: string, opts?: { guitar?: GuitarId }): BuiltCharacter {
  const v = VARIANTS[variantId] ?? V1;
  const rig = new HumanoidRig(v.palette, v.shape);
  const extraMats: THREE.Material[] = [];
  v.decorate(rig, v.palette, extraMats);

  let guitar = buildK7Guitar(opts?.guitar ?? "goldtop");
  rig.heldPivot.add(guitar.group);

  // Subtle aloof J-pop sway on top of the shared pose set.
  function extraMotion(t: number, anim: string): void {
    if (anim === "idle" || anim === "taunt") {
      rig.headAnchor.rotation.z = Math.sin(t * 0.7) * 0.05;
      rig.group.position.y += Math.sin(t * 1.3) * 0.004;
    } else {
      rig.headAnchor.rotation.z = 0;
    }
  }

  return {
    group: rig.group,
    update(t: number, dt: number, anim) {
      rig.pose(anim, t, dt);
      extraMotion(t, anim);
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
      for (const m of extraMats) m.dispose();
    },
  };
}

export const def: CharacterDef = {
  id: "main-silva",
  kind: "main",
  label: "Prayer",
  variants: [
    { id: "v1", label: "Neon Crop" },
    { id: "v2", label: "Bob" },
    { id: "v3", label: "Ponytail" },
  ],
  build,
};
