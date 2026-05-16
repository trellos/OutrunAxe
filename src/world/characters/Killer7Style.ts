// Shared Killer7-flavoured rendering kit for OutrunAxe characters.
//
// Killer7 look = hard 2-tone cel shading (no soft gradient), bold flat
// colour blocks, thick black ink outlines, near-black shadows, lanky
// stylised proportions, one vivid accent per character. We get there with
// a 2-step toon ramp + a fatter inverse-hull outline than the world uses.
//
// Every character file builds on `HumanoidRig` so silhouettes stay
// consistent and the procedural animation set is shared. Character files
// only add palette, proportions and silhouette flourishes.

import * as THREE from "three";
import type { GuitarId } from "../../state/Loadout";
import type { AnimName } from "./types";

// ---------------------------------------------------------------------------
// Materials / ramp / outline
// ---------------------------------------------------------------------------

let k7RampTex: THREE.DataTexture | null = null;
/** Hard 2-step ramp: a single sharp light/shadow terminator (Killer7). */
export function k7Ramp(): THREE.DataTexture {
  if (!k7RampTex) {
    const arr = new Uint8Array([60, 255]);
    const t = new THREE.DataTexture(arr, 2, 1, THREE.RedFormat);
    t.needsUpdate = true;
    t.minFilter = THREE.NearestFilter;
    t.magFilter = THREE.NearestFilter;
    k7RampTex = t;
  }
  return k7RampTex;
}

export function k7Mat(
  color: THREE.ColorRepresentation,
  opts: { emissive?: THREE.ColorRepresentation; emissiveIntensity?: number; map?: THREE.Texture | null } = {},
): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({
    color,
    gradientMap: k7Ramp(),
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 0,
    map: opts.map ?? null,
  });
}

/** Pure flat block (eyes, decals, glints) — unaffected by light. */
export function k7Flat(color: THREE.ColorRepresentation): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color });
}

const INK = new THREE.MeshBasicMaterial({ color: 0x050505, side: THREE.BackSide });
/** Thick black ink outline (inverse hull). Fatter than the world outline. */
export function inkOutline(mesh: THREE.Mesh, scale = 1.07): THREE.Mesh {
  const o = new THREE.Mesh(mesh.geometry, INK);
  o.scale.setScalar(scale);
  o.renderOrder = -1;
  mesh.add(o);
  return o;
}

/** Add a mesh to a parent, register its material for tinting, ink it. */
export function part(
  parent: THREE.Object3D,
  mesh: THREE.Mesh,
  mats: THREE.Material[],
  opts: { outline?: boolean; outlineScale?: number } = {},
): THREE.Mesh {
  parent.add(mesh);
  const m = mesh.material;
  if (Array.isArray(m)) mats.push(...m);
  else mats.push(m);
  if (opts.outline !== false) inkOutline(mesh, opts.outlineScale ?? 1.07);
  return mesh;
}

// ---------------------------------------------------------------------------
// Killer7-styled procedural guitar (flat-shaded variant of the world axe)
// ---------------------------------------------------------------------------

const GUITAR_COLORS: Record<GuitarId, { body: number; neck: number; head: number; guard: number }> = {
  goldtop: { body: 0xc99a3a, neck: 0x3a2410, head: 0x241407, guard: 0x0a0806 },
  blackstrat: { body: 0x111114, neck: 0xb98a4c, head: 0x7a5a30, guard: 0xece7d4 },
  jazzmaster: { body: 0xb9d4e8, neck: 0xb98a4c, head: 0x7a5a30, guard: 0xf6eccf },
};

/**
 * Builds a Killer7-styled electric guitar as a self-contained group, posed
 * to read as slung across the chest when added to a chest-level pivot whose
 * +X points to the character's left. Returns { group, dispose }.
 */
export function buildK7Guitar(guitar: GuitarId): {
  group: THREE.Group;
  dispose: () => void;
} {
  const c = GUITAR_COLORS[guitar];
  const group = new THREE.Group();
  const mats: THREE.Material[] = [];

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.34, 0.1), k7Mat(c.body));
  part(group, body, mats, { outlineScale: 1.06 });

  const bevel = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.3, 0.06), k7Mat(c.body));
  group.add(bevel);
  mats.push(bevel.material as THREE.Material);

  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.12), k7Mat(c.guard));
  guard.position.set(-0.08, -0.02, 0.01);
  part(group, guard, mats, { outline: false });

  for (const px of [-0.02, 0.12]) {
    const pickup = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.13), k7Mat(0x141418));
    pickup.position.set(px, 0, 0.01);
    group.add(pickup);
    mats.push(pickup.material as THREE.Material);
  }

  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.78, 0.05), k7Mat(c.neck));
  neck.position.set(0.42, 0, 0);
  neck.rotation.z = -Math.PI / 2;
  part(group, neck, mats, { outlineScale: 1.05 });

  const board = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.1, 0.012), k7Mat(0x1c1208));
  board.position.set(0.42, 0, 0.03);
  group.add(board);
  mats.push(board.material as THREE.Material);
  for (let i = 1; i <= 7; i++) {
    const fret = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.1, 0.014), k7Flat(0xd8d2bc));
    fret.position.set(0.1 + i * 0.085, 0, 0.034);
    group.add(fret);
  }

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.04), k7Mat(c.head));
  head.position.set(0.86, 0.03, 0);
  head.rotation.z = -Math.PI / 2 + 0.16;
  part(group, head, mats, { outlineScale: 1.06 });

  const strMat = k7Flat(0xe9e4c6);
  for (let s = 0; s < 6; s++) {
    const str = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.86, 0.003), strMat);
    str.position.set(0.42, -0.03 + s * 0.012, 0.05);
    str.rotation.z = -Math.PI / 2;
    group.add(str);
  }

  return {
    group,
    dispose() {
      for (const m of mats) m.dispose();
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.geometry.dispose();
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Humanoid rig
// ---------------------------------------------------------------------------

export interface RigPalette {
  skin: number;
  hair: number;
  /** Torso garment (jacket / shirt / sweater). */
  top: number;
  /** Legs garment. */
  bottom: number;
  /** Shoes. */
  shoes: number;
  /** One vivid signature accent. */
  accent: number;
}

export interface RigShape {
  /** Total standing height in world units (mains ~1.85). */
  height?: number;
  /** Relative bulk of the torso/limbs. */
  build?: "slim" | "average" | "buff";
  /** 0 = flat chest, 1 = full — softens torso silhouette. */
  bust?: number;
  /** Shoulder span multiplier (1 = default). */
  shoulders?: number;
  /** Hip span multiplier (1 = default). */
  hips?: number;
}

const BUILD_BULK: Record<NonNullable<RigShape["build"]>, number> = {
  slim: 0.82,
  average: 1,
  buff: 1.28,
};

interface Joint {
  group: THREE.Group;
  rest: THREE.Euler;
}

/**
 * Procedural box-and-cylinder humanoid with a shared animation set. Faces
 * +Z, feet at y=0. Character files configure palette/shape, then decorate
 * `headAnchor`, `torsoAnchor`, `handR`/`handL` and `heldPivot` with
 * silhouette pieces (hair, jackets, props). All added meshes should use
 * `k7Mat`/`k7Flat` + `inkOutline` (use `part`).
 */
export class HumanoidRig {
  readonly group = new THREE.Group();
  /** Parent for hair/hats/glasses — at the top of the neck. */
  readonly headAnchor = new THREE.Group();
  /** Parent for jackets/vests/decals — chest centre. */
  readonly torsoAnchor = new THREE.Group();
  /** Right hand group (strum hand for mains). */
  readonly handR = new THREE.Group();
  /** Left hand group (fretting hand for mains). */
  readonly handL = new THREE.Group();
  /** Chest-level pivot a guitar (or prop) attaches to. */
  readonly heldPivot = new THREE.Group();
  /** Collected materials so callers can tint on damage/flash. */
  readonly mats: THREE.Material[] = [];

  private joints: Record<string, Joint> = {};
  private geos: THREE.BufferGeometry[] = [];
  private height: number;
  private bulk: number;

  constructor(palette: RigPalette, shape: RigShape = {}) {
    this.height = shape.height ?? 1.85;
    this.bulk = BUILD_BULK[shape.build ?? "average"];
    const H = this.height;
    const bust = shape.bust ?? 0;
    const sh = (shape.shoulders ?? 1) * this.bulk;
    const hp = (shape.hips ?? 1) * this.bulk;

    const skin = () => this.reg(k7Mat(palette.skin));
    const top = () => this.reg(k7Mat(palette.top));
    const bottom = () => this.reg(k7Mat(palette.bottom));
    const shoes = () => this.reg(k7Mat(palette.shoes));

    // Proportions (fraction of H).
    const hipY = H * 0.5;
    const legLen = hipY;
    const thighLen = legLen * 0.5;
    const shinLen = legLen * 0.46;
    const torsoLen = H * 0.3;
    const neckLen = H * 0.05;
    const headLen = H * 0.15;
    const armLen = H * 0.42;
    const upperArm = armLen * 0.5;
    const foreArm = armLen * 0.45;

    // ---- hips ----
    const hips = this.joint("hips", this.group, new THREE.Euler(0, 0, 0));
    hips.group.position.y = hipY;
    const pelvis = this.box(0.26 * hp, 0.16, 0.18, bottom());
    pelvis.position.y = -0.02;
    part(hips.group, pelvis, this.mats);

    // ---- torso ----
    const torso = this.joint("torso", hips.group, new THREE.Euler(0, 0, 0));
    const chest = this.box(0.3 * sh, torsoLen, 0.2 + bust * 0.06, top());
    chest.position.y = torsoLen * 0.5;
    part(torso.group, chest, this.mats);
    if (bust > 0.05) {
      const b = this.box(0.26 * sh, 0.14 * (0.6 + bust), 0.12 + bust * 0.12, top());
      b.position.set(0, torsoLen * 0.62, 0.12 + bust * 0.05);
      part(torso.group, b, this.mats, { outlineScale: 1.05 });
    }
    this.torsoAnchor.position.set(0, torsoLen * 0.55, 0.11);
    torso.group.add(this.torsoAnchor);
    this.heldPivot.position.set(-0.04, torsoLen * 0.5, 0.34);
    this.heldPivot.rotation.z = 0.26;
    this.heldPivot.rotation.x = -0.16;
    torso.group.add(this.heldPivot);

    // ---- neck + head ----
    const neck = this.joint("neck", torso.group, new THREE.Euler(0, 0, 0));
    neck.group.position.y = torsoLen;
    const neckMesh = this.cyl(0.05, 0.06, neckLen, skin());
    neckMesh.position.y = neckLen * 0.5;
    part(neck.group, neckMesh, this.mats, { outline: false });
    const head = this.joint("head", neck.group, new THREE.Euler(0, 0, 0));
    head.group.position.y = neckLen;
    const skull = this.box(0.17, headLen, 0.18, skin());
    skull.position.y = headLen * 0.5;
    part(head.group, skull, this.mats, { outlineScale: 1.06 });
    // Flat Killer7 eyes — bright sclera blocks, no pupils-as-geometry.
    for (const ex of [-0.045, 0.045]) {
      const eye = this.box(0.03, 0.018, 0.02, this.reg(k7Flat(0xf4f4f4)));
      eye.position.set(ex, headLen * 0.56, 0.092);
      head.group.add(eye);
      const pup = this.box(0.012, 0.016, 0.02, this.reg(k7Flat(0x0a0a0a)));
      pup.position.set(ex, headLen * 0.56, 0.094);
      head.group.add(pup);
    }
    this.headAnchor.position.y = headLen * 0.5;
    head.group.add(this.headAnchor);

    // ---- arms ----
    const mkArm = (side: -1 | 1, hand: THREE.Group, key: string) => {
      const shoulder = this.joint(`${key}Shoulder`, torso.group, new THREE.Euler(0, 0, side * 0.12));
      shoulder.group.position.set(side * 0.2 * sh, torsoLen * 0.92, 0);
      const ua = this.cyl(0.05 * this.bulk, 0.045 * this.bulk, upperArm, top());
      ua.position.y = -upperArm * 0.5;
      part(shoulder.group, ua, this.mats, { outlineScale: 1.05 });
      const elbow = this.joint(`${key}Elbow`, shoulder.group, new THREE.Euler(0, 0, 0));
      elbow.group.position.y = -upperArm;
      const fa = this.cyl(0.042 * this.bulk, 0.038, foreArm, skin());
      fa.position.y = -foreArm * 0.5;
      part(elbow.group, fa, this.mats, { outlineScale: 1.05 });
      hand.position.y = -foreArm;
      elbow.group.add(hand);
      const palm = this.box(0.06, 0.09, 0.04, skin());
      palm.position.y = -0.04;
      part(hand, palm, this.mats, { outline: false });
    };
    mkArm(-1, this.handR, "armR"); // character's right = scene -X when facing +Z
    mkArm(1, this.handL, "armL");

    // ---- legs ----
    const mkLeg = (side: -1 | 1, key: string) => {
      const hipJ = this.joint(`${key}Hip`, hips.group, new THREE.Euler(0, 0, 0));
      hipJ.group.position.set(side * 0.1 * hp, -0.06, 0);
      const thigh = this.cyl(0.07 * this.bulk, 0.06 * this.bulk, thighLen, bottom());
      thigh.position.y = -thighLen * 0.5;
      part(hipJ.group, thigh, this.mats, { outlineScale: 1.05 });
      const knee = this.joint(`${key}Knee`, hipJ.group, new THREE.Euler(0, 0, 0));
      knee.group.position.y = -thighLen;
      const shin = this.cyl(0.055 * this.bulk, 0.045, shinLen, bottom());
      shin.position.y = -shinLen * 0.5;
      part(knee.group, shin, this.mats, { outlineScale: 1.05 });
      const foot = this.box(0.09, 0.06, 0.2, shoes());
      foot.position.set(0, -shinLen - 0.02, 0.05);
      part(knee.group, foot, this.mats, { outlineScale: 1.05 });
    };
    mkLeg(-1, "legR");
    mkLeg(1, "legL");
  }

  /** Apply procedural pose for the given animation. */
  pose(anim: AnimName, t: number, dtSec: number) {
    const J = this.joints;
    const set = (k: string, x: number, y: number, z: number) => {
      const j = J[k];
      if (!j) return;
      j.group.rotation.set(j.rest.x + x, j.rest.y + y, j.rest.z + z);
    };
    const groove = Math.sin(t * 5.0);
    const breath = Math.sin(t * 1.7);

    // Reset positional offsets that some anims push.
    this.group.position.y = 0;
    this.group.rotation.set(0, this.group.rotation.y, 0);
    this.group.scale.setScalar(1);

    switch (anim) {
      case "idle": {
        set("torso", breath * 0.02, Math.sin(t * 0.6) * 0.05, Math.sin(t * 0.9) * 0.015);
        set("head", Math.sin(t * 0.8) * 0.04, Math.sin(t * 0.5) * 0.12, 0);
        set("armRShoulder", Math.sin(t * 0.9) * 0.05, 0, 0.04);
        set("armLShoulder", -Math.sin(t * 0.9) * 0.05, 0, -0.04);
        set("armRElbow", 0.18 + breath * 0.03, 0, 0);
        set("armLElbow", 0.18 - breath * 0.03, 0, 0);
        this.group.position.y = Math.abs(breath) * 0.01;
        break;
      }
      case "play": {
        // Planted rock stance + groove bob + strum hand pump.
        set("hips", 0, 0, 0);
        set("torso", 0.06 + groove * 0.04, Math.sin(t * 2.5) * 0.06, groove * 0.03);
        set("head", groove * 0.12 - 0.05, Math.sin(t * 2.5) * 0.1, 0);
        set("armLShoulder", -0.5, 0.2, -0.55); // fretting arm up the neck
        set("armLElbow", 0.9, 0, 0);
        set("armRShoulder", -0.35, 0, 0.2);
        set("armRElbow", 0.6 + Math.sin(t * 10) * 0.45, 0, 0); // strum pump
        set("legRHip", 0, 0, -0.16);
        set("legLHip", 0, 0, 0.16);
        set("legRKnee", 0.12, 0, 0);
        this.group.position.y = Math.abs(groove) * 0.02;
        this.heldPivot.rotation.x = -0.16 + Math.sin(t * 10) * 0.06;
        break;
      }
      case "walk": {
        const s = Math.sin(t * 6);
        const c = Math.cos(t * 6);
        set("legRHip", s * 0.5, 0, 0);
        set("legLHip", -s * 0.5, 0, 0);
        set("legRKnee", Math.max(0, -s) * 0.7, 0, 0);
        set("legLKnee", Math.max(0, s) * 0.7, 0, 0);
        set("armRShoulder", -s * 0.4, 0, 0.04);
        set("armLShoulder", s * 0.4, 0, -0.04);
        set("armRElbow", 0.3, 0, 0);
        set("armLElbow", 0.3, 0, 0);
        set("torso", 0.04, c * 0.06, 0);
        this.group.position.y = Math.abs(s) * 0.03;
        break;
      }
      case "taunt": {
        // Mocking: lean back, dismissive right-hand wave, head tilt.
        const w = Math.sin(t * 4);
        set("torso", -0.12, w * 0.08, 0.04);
        set("head", -0.08, w * 0.15, 0.12);
        set("armRShoulder", -1.2 - w * 0.2, 0, 0.5);
        set("armRElbow", 0.5 + w * 0.5, 0, 0);
        set("armLShoulder", 0.1, 0, -0.3);
        set("armLElbow", 0.2, 0, 0);
        this.group.position.y = Math.abs(Math.sin(t * 2)) * 0.01;
        break;
      }
      case "hit": {
        set("torso", -0.4, 0, 0.12);
        set("head", -0.3, 0, 0.2);
        set("armRShoulder", 0.4, 0, 0.6);
        set("armLShoulder", 0.4, 0, -0.6);
        this.group.position.y = 0;
        break;
      }
      case "die": {
        // Fold forward + sink + topple (driven by caller advancing t 0..1).
        const k = Math.min(1, Math.max(0, t));
        set("torso", -1.1 * k, 0, 0.2 * k);
        set("head", -0.5 * k, 0, 0.3 * k);
        set("legRHip", 0.6 * k, 0, 0);
        set("legLHip", 0.5 * k, 0, 0);
        set("armRShoulder", 1.0 * k, 0, 0.4 * k);
        set("armLShoulder", 1.0 * k, 0, -0.4 * k);
        this.group.position.y = -0.9 * k;
        this.group.rotation.x = -0.5 * k;
        this.group.scale.setScalar(1 - 0.15 * k);
        break;
      }
    }
    void dtSec;
  }

  dispose() {
    for (const m of this.mats) m.dispose();
    for (const g of this.geos) g.dispose();
  }

  // ---- internals -------------------------------------------------------

  private reg<T extends THREE.Material>(m: T): T {
    this.mats.push(m);
    return m;
  }

  private joint(key: string, parent: THREE.Object3D, rest: THREE.Euler): Joint {
    const g = new THREE.Group();
    g.rotation.copy(rest);
    parent.add(g);
    const j: Joint = { group: g, rest: rest.clone() };
    this.joints[key] = j;
    return j;
  }

  private box(w: number, h: number, d: number, mat: THREE.Material): THREE.Mesh {
    const g = new THREE.BoxGeometry(w, h, d);
    this.geos.push(g);
    return new THREE.Mesh(g, mat);
  }

  private cyl(rt: number, rb: number, h: number, mat: THREE.Material): THREE.Mesh {
    const g = new THREE.CylinderGeometry(rt, rb, h, 7);
    this.geos.push(g);
    return new THREE.Mesh(g, mat);
  }
}

/** Convenience: a free box mesh registered into a mats array, with ink. */
export function k7Box(
  parent: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  color: THREE.ColorRepresentation,
  mats: THREE.Material[],
  opts: { outline?: boolean; outlineScale?: number } = {},
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), k7Mat(color));
  return part(parent, mesh, mats, opts);
}
