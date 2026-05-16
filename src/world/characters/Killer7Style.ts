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
  // `inner` holds the actual built geometry at its native (oversized) scale;
  // `group` is the returned wrapper we shrink so the body reads like a real
  // electric guitar held by a ~1.85u figure. The Shape+ExtrudeGeometry bodies
  // span ~0.68–0.78u wide natively (plus bevel + ink outline), which towered
  // over the rig torso (~0.3u wide). GUITAR_SCALE brings the body major
  // dimension back to roughly the OLD box footprint (~0.62w × ~0.34h × ~0.1d),
  // i.e. ≈0.5–0.65u, not ≈1.5u. Neck/head/strings are children of `inner`,
  // so they shrink proportionally and the mount orientation is preserved.
  const GUITAR_SCALE = 0.82;
  const group = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.setScalar(GUITAR_SCALE);
  group.add(inner);
  const mats: THREE.Material[] = [];

  // Per-guitar body silhouette as a flat extruded profile in the X/Y plane.
  // +X = toward the neck join, so each outline keeps the same mount/scale.
  const bodyShape = new THREE.Shape();
  if (guitar === "blackstrat") {
    // Stratocaster: double-cutaway, two horns by the neck (upper horn
    // longer), slight offset waist.
    bodyShape.moveTo(0.30, 0.00); // neck join
    bodyShape.lineTo(0.30, 0.20); // base of upper horn
    bodyShape.quadraticCurveTo(0.34, 0.30, 0.22, 0.30); // long upper horn tip
    bodyShape.quadraticCurveTo(0.02, 0.27, -0.10, 0.20); // upper bout
    bodyShape.quadraticCurveTo(-0.34, 0.12, -0.34, -0.04); // round lower bout
    bodyShape.quadraticCurveTo(-0.32, -0.22, -0.10, -0.24); // bottom
    bodyShape.quadraticCurveTo(0.06, -0.24, 0.16, -0.18); // offset waist
    bodyShape.lineTo(0.26, -0.16); // base of lower horn
    bodyShape.quadraticCurveTo(0.34, -0.22, 0.30, -0.06); // shorter lower horn
    bodyShape.lineTo(0.30, 0.00);
  } else if (guitar === "goldtop") {
    // Les Paul: single-cutaway, one treble-side horn near the neck,
    // fuller rounded lower bout.
    bodyShape.moveTo(0.30, 0.02); // neck join
    bodyShape.quadraticCurveTo(0.36, 0.22, 0.20, 0.24); // single cutaway horn
    bodyShape.quadraticCurveTo(0.00, 0.26, -0.14, 0.22); // upper bout
    bodyShape.quadraticCurveTo(-0.36, 0.14, -0.38, -0.06); // full lower bout
    bodyShape.quadraticCurveTo(-0.36, -0.26, -0.10, -0.28); // rounded bottom
    bodyShape.quadraticCurveTo(0.14, -0.27, 0.26, -0.18); // bout up to neck
    bodyShape.quadraticCurveTo(0.31, -0.10, 0.30, 0.02);
  } else {
    // Jazzmaster: large asymmetric offset-waist body.
    bodyShape.moveTo(0.30, 0.04); // neck join
    bodyShape.quadraticCurveTo(0.36, 0.26, 0.16, 0.30); // upper horn
    bodyShape.quadraticCurveTo(-0.06, 0.34, -0.22, 0.24); // wide upper bout
    bodyShape.quadraticCurveTo(-0.42, 0.10, -0.40, -0.08); // long lower bout
    bodyShape.quadraticCurveTo(-0.36, -0.30, -0.06, -0.30); // dropped bottom
    bodyShape.quadraticCurveTo(0.18, -0.28, 0.24, -0.14); // strong offset waist
    bodyShape.quadraticCurveTo(0.33, -0.06, 0.30, 0.04);
  }
  const bodyDepth = guitar === "goldtop" ? 0.13 : 0.1; // Les Paul is thicker
  const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, {
    depth: bodyDepth,
    bevelEnabled: true,
    bevelThickness: 0.018,
    bevelSize: 0.02,
    bevelSegments: 1,
    curveSegments: 8,
  });
  bodyGeo.center();
  const body = new THREE.Mesh(bodyGeo, k7Mat(c.body));
  part(inner, body, mats, { outlineScale: 1.05 });

  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.12), k7Mat(c.guard));
  guard.position.set(-0.08, -0.02, 0.01);
  part(inner, guard, mats, { outline: false });

  for (const px of [-0.02, 0.12]) {
    const pickup = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.13), k7Mat(0x141418));
    pickup.position.set(px, 0, 0.01);
    inner.add(pickup);
    mats.push(pickup.material as THREE.Material);
  }

  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.78, 0.05), k7Mat(c.neck));
  neck.position.set(0.42, 0, 0);
  neck.rotation.z = -Math.PI / 2;
  part(inner, neck, mats, { outlineScale: 1.05 });

  const board = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.1, 0.012), k7Mat(0x1c1208));
  board.position.set(0.42, 0, 0.03);
  inner.add(board);
  mats.push(board.material as THREE.Material);
  for (let i = 1; i <= 7; i++) {
    const fret = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.1, 0.014), k7Flat(0xd8d2bc));
    fret.position.set(0.1 + i * 0.085, 0, 0.034);
    inner.add(fret);
  }

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.04), k7Mat(c.head));
  head.position.set(0.86, 0.03, 0);
  head.rotation.z = -Math.PI / 2 + 0.16;
  part(inner, head, mats, { outlineScale: 1.06 });

  const strMat = k7Flat(0xe9e4c6);
  for (let s = 0; s < 6; s++) {
    const str = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.86, 0.003), strMat);
    str.position.set(0.42, -0.03 + s * 0.012, 0.05);
    str.rotation.z = -Math.PI / 2;
    inner.add(str);
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
  /** Pelvis-width + lower-torso taper multiplier (default 1); <1 with shoulders>1 gives a V-taper. */
  waist?: number;
  /** Upper-arm + forearm radius scale, independent of build (default = build bulk). */
  armThickness?: number;
  /** Thigh + shin radius scale, independent of build (default = build bulk). */
  legThickness?: number;
  /** Render the upper arm in `skin` instead of `top` for bare arms (default false). */
  sleeveless?: boolean;
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
  /** Right upper-arm mid pivot for bicep bulges/sleeves; posed with the limb. */
  readonly upperArmAnchorR = new THREE.Group();
  /** Left upper-arm mid pivot for bicep bulges/sleeves; posed with the limb. */
  readonly upperArmAnchorL = new THREE.Group();
  /** Right forearm mid pivot for bracers/cuffs; posed with the limb. */
  readonly foreArmAnchorR = new THREE.Group();
  /** Left forearm mid pivot for bracers/cuffs; posed with the limb. */
  readonly foreArmAnchorL = new THREE.Group();
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
    const waist = shape.waist ?? 1;
    const hp = (shape.hips ?? 1) * this.bulk * waist;
    const armBulk = shape.armThickness ?? this.bulk;
    // Original forearm bottom radius was a fixed 0.038 (un-bulked); only scale
    // it when armThickness is explicitly set so defaults stay pixel-identical.
    const faRb = shape.armThickness != null ? 0.038 * armBulk : 0.038;
    const legBulk = shape.legThickness ?? this.bulk;
    // Original shin bottom radius was a fixed 0.045 (un-bulked); same rule.
    const shinRb = shape.legThickness != null ? 0.045 * legBulk : 0.045;
    const sleeveless = shape.sleeveless ?? false;

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
    // Lower-torso taper: a slimmer block at the waistline so shoulders>1 +
    // waist<1 reads as a V. Defaults (waist=1) match the old single block.
    if (waist !== 1) {
      const lower = this.box(0.3 * sh * waist, torsoLen * 0.42, (0.2 + bust * 0.06) * 0.96, top());
      lower.position.y = torsoLen * 0.21;
      part(torso.group, lower, this.mats, { outlineScale: 1.05 });
    }
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
    const mkArm = (
      side: -1 | 1,
      hand: THREE.Group,
      key: string,
      uaAnchor: THREE.Group,
      faAnchor: THREE.Group,
    ) => {
      const shoulder = this.joint(`${key}Shoulder`, torso.group, new THREE.Euler(0, 0, side * 0.12));
      shoulder.group.position.set(side * 0.2 * sh, torsoLen * 0.92, 0);
      const ua = this.cyl(0.05 * armBulk, 0.045 * armBulk, upperArm, sleeveless ? skin() : top());
      ua.position.y = -upperArm * 0.5;
      part(shoulder.group, ua, this.mats, { outlineScale: 1.05 });
      uaAnchor.position.y = -upperArm * 0.5;
      shoulder.group.add(uaAnchor);
      const elbow = this.joint(`${key}Elbow`, shoulder.group, new THREE.Euler(0, 0, 0));
      elbow.group.position.y = -upperArm;
      const fa = this.cyl(0.042 * armBulk, faRb, foreArm, skin());
      fa.position.y = -foreArm * 0.5;
      part(elbow.group, fa, this.mats, { outlineScale: 1.05 });
      faAnchor.position.y = -foreArm * 0.5;
      elbow.group.add(faAnchor);
      hand.position.y = -foreArm;
      elbow.group.add(hand);
      const palm = this.box(0.06, 0.09, 0.04, skin());
      palm.position.y = -0.04;
      part(hand, palm, this.mats, { outline: false });
    };
    // character's right = scene -X when facing +Z
    mkArm(-1, this.handR, "armR", this.upperArmAnchorR, this.foreArmAnchorR);
    mkArm(1, this.handL, "armL", this.upperArmAnchorL, this.foreArmAnchorL);

    // ---- legs ----
    const mkLeg = (side: -1 | 1, key: string) => {
      const hipJ = this.joint(`${key}Hip`, hips.group, new THREE.Euler(0, 0, 0));
      hipJ.group.position.set(side * 0.1 * hp, -0.06, 0);
      const thigh = this.cyl(0.07 * legBulk, 0.06 * legBulk, thighLen, bottom());
      thigh.position.y = -thighLen * 0.5;
      part(hipJ.group, thigh, this.mats, { outlineScale: 1.05 });
      const knee = this.joint(`${key}Knee`, hipJ.group, new THREE.Euler(0, 0, 0));
      knee.group.position.y = -thighLen;
      const shin = this.cyl(0.055 * legBulk, shinRb, shinLen, bottom());
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
    // The "play" strum flicks the wrist directly; clear it for other anims.
    this.handR.rotation.set(0, 0, 0);

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
        // Planted rock stance + subtle groove. The motion of interest is a
        // small, tight down–up strum arc in the RIGHT forearm/wrist across
        // the guitar body near the strings — not a big shoulder/hip pump.
        const strum = Math.sin(t * 8.0); // strum tempo
        const strumArc = strum * 0.16; // ~0.16 rad tight down–up arc
        set("hips", 0, 0, 0);
        // Toned-down body groove so the eye reads the hand, not the torso.
        set("torso", 0.05 + groove * 0.02, Math.sin(t * 2.5) * 0.03, groove * 0.015);
        set("head", groove * 0.06 - 0.04, Math.sin(t * 2.5) * 0.05, 0);
        // Left arm planted up the neck (fretting) — held steady.
        set("armLShoulder", -0.5, 0.2, -0.55);
        set("armLElbow", 0.9, 0, 0);
        // Right arm: shoulder/upper-arm parked over the guitar body so the
        // hand sits on the strings; the strum lives in elbow + wrist only.
        set("armRShoulder", -0.34, 0, 0.2);
        set("armRElbow", 0.62 + strumArc, 0, 0);
        // Wrist flick adds the across-the-strings feel at low amplitude.
        this.handR.rotation.set(strumArc * 0.7, 0, strum * 0.08);
        set("legRHip", 0, 0, -0.16);
        set("legLHip", 0, 0, 0.16);
        set("legRKnee", 0.12, 0, 0);
        this.group.position.y = Math.abs(groove) * 0.012;
        // Guitar stays slung across the chest, only a faint string vibration.
        this.heldPivot.rotation.x = -0.16 + Math.sin(t * 16) * 0.012;
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
