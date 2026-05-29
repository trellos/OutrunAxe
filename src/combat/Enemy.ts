import * as THREE from "three";
import { keyPitchClasses, type KeyMode, type PitchClass } from "../music/keys";
import { sharedToonRamp } from "../render/ToonRamp";
import { addOutline } from "../render/Outline";

const ENEMY_COLORS: Record<string, number> = {
  C: 0xff2bd6, "C#": 0xff5a6b, D: 0xff7a2b,
  "D#": 0xffd02b, E: 0xc7ff2b, F: 0x4cff7a,
  "F#": 0x2bffd0, G: 0x2bcfff, "G#": 0x2b8aff,
  A: 0x6c5cff, "A#": 0xb14cff, B: 0xff3aa9,
};

// Map each pitch class to a unique design id. Naturals get creatures, sharps
// get robots.
const DESIGN_FOR_PC: Record<string, string> = {
  C: "boombox",
  D: "cassette",
  E: "discoball",
  F: "vinyldemon",
  G: "speaker",
  A: "mic",
  B: "drumstick",
  "C#": "robot1",
  "D#": "robot2",
  "F#": "robot3",
  "G#": "robot4",
  "A#": "robot5",
};

type ToonMat = THREE.MeshToonMaterial;

interface DesignParts {
  group: THREE.Group;
  toonMats: ToonMat[];
  // Optional per-frame animation hook
  animate?: (t: number, dt: number) => void;
}

// ===== Shared resource caches (module scope, never per-instance) ===========
// Geometry is reused by addOutline (it shares mesh.geometry) so hoisting is
// safe. Shared geo/tex are NEVER disposed per enemy — only per-instance
// materials are. A trivial unit-cost compared to redrawing canvases.

const SEG = 8; // hard cap on radial/cylinder/sphere segments

// Exponent for the spawn→player approach curve. >1 means the enemy covers
// little distance early (stays distant during count-in / early measures) and
// accelerates toward the player near its scheduled arrival. Kept close to 1
// (near-linear) so the player can read which lane/key is incoming a measure
// or two before arrival — anything much higher hides the threat until the
// final beat and the wave feels unsurvivable.
const APPROACH_EASE_POWER = 1.3;

// Damage flash and scale-punch durations (seconds). Both run on the audio
// clock so they stay in sync with note onsets.
const HIT_FLASH_DURATION = 0.2;
const HIT_PUNCH_DURATION = 0.18;

// On death: slowly expand + fade to transparency over this window. Longer than
// the old 0.3s death-pop so the player sees a clear "this enemy is gone"
// feedback, while the floating pitch label that detaches at the same instant
// has time to drift up to the timeline note bar.
export const DEATH_DURATION = 1.0;

const geoCache = new Map<string, THREE.BufferGeometry>();
function geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g as T;
}

const texCache = new Map<string, THREE.CanvasTexture>();
function tex(key: string, make: () => THREE.CanvasTexture): THREE.CanvasTexture {
  let t = texCache.get(key);
  if (!t) {
    t = make();
    texCache.set(key, t);
  }
  return t;
}

// Frequently reused primitives.
const EYE_WHITE_GEO = geo("eyeWhite", () => new THREE.SphereGeometry(0.11, SEG, SEG));
const PUPIL_GEO = geo("pupil", () => new THREE.SphereGeometry(0.055, SEG, SEG));
const BROW_GEO = geo("brow", () => new THREE.BoxGeometry(0.16, 0.045, 0.05));

const WHITE_EYE_MAT = new THREE.MeshToonMaterial({
  color: 0xffffff,
  emissive: 0xffffff,
  emissiveIntensity: 0.45,
  gradientMap: sharedToonRamp(),
});
const PUPIL_MAT = new THREE.MeshToonMaterial({
  color: 0x101014,
  emissive: 0x000000,
  emissiveIntensity: 0,
  gradientMap: sharedToonRamp(),
});
const BROW_MAT = new THREE.MeshToonMaterial({
  color: 0x141414,
  emissive: 0x000000,
  emissiveIntensity: 0,
  gradientMap: sharedToonRamp(),
});

export class Enemy {
  readonly object: THREE.Object3D;
  readonly mesh: THREE.Mesh;
  /** The pitch class this enemy's visual design/color/label derive from.
   *  Also the trigger for ROOT damage (a played note equal to this pitch
   *  class lands the root multiplier, see BulletSystem). */
  readonly pitchClass: PitchClass;
  /** Tonic of the key the enemy "lives in" (root of the scale, NOT necessarily
   *  the same as `pitchClass`). Combined with `mode` to build the vulnerable
   *  pitch set. */
  readonly key: PitchClass;
  /** Major vs natural-minor scale around `key`. */
  readonly mode: KeyMode;
  hp: number;
  readonly maxHp: number;
  readonly spawnPosition: THREE.Vector3;
  readonly targetPosition: THREE.Vector3;
  readonly arriveAt: number;
  readonly spawnedAt: number;
  alive = true;
  /** Time at which the death animation completes. -1 while alive. Used by
   *  EnemyDirector to defer disposal so the expand+fade actually plays out. */
  deathDoneAt = -1;

  /** Visible in-world pitch-letter sprite. Exposed (not private) so the HUD
   *  kill-letter spawn can project its world position — the floating glyph
   *  must peel off the exact pixel the player just saw. */
  label!: THREE.Sprite;
  private flashUntil = 0;
  private punchUntil = 0;
  private fadeStart = -1;
  private toonMats: ToonMat[];
  private baseColors: THREE.Color[];
  private baseEmissive: number[];
  private design: DesignParts;
  private lastT = -1;
  private localTime = 0;

  constructor(opts: {
    pitchClass: PitchClass;
    keyRoot?: PitchClass;
    keyMode?: KeyMode;
    hp: number;
    spawnPosition: THREE.Vector3;
    targetPosition: THREE.Vector3;
    spawnedAt: number;
    arriveAt: number;
  }) {
    this.pitchClass = opts.pitchClass;
    // `keyRoot` defaults to `pitchClass` so legacy callers (one enemy = one
    // major key keyed on its own label) keep working. Waves that want to put
    // several different-labelled enemies inside the same key (e.g. all of
    // wave 1 in C major) pass `keyRoot: "C"` explicitly.
    this.key = opts.keyRoot ?? opts.pitchClass;
    this.mode = opts.keyMode ?? "major";
    this.hp = opts.hp;
    this.maxHp = opts.hp;
    this.spawnPosition = opts.spawnPosition.clone();
    this.targetPosition = opts.targetPosition.clone();
    this.spawnedAt = opts.spawnedAt;
    this.arriveAt = opts.arriveAt;

    this.object = new THREE.Object3D();
    this.object.position.copy(this.spawnPosition);

    const colorHex = ENEMY_COLORS[opts.pitchClass] ?? 0xffffff;
    const designId = DESIGN_FOR_PC[opts.pitchClass] ?? "boombox";
    this.design = buildDesign(designId, opts.pitchClass, colorHex);
    this.object.add(this.design.group);

    // Pick a sensible "primary mesh" — first child mesh in the group.
    this.mesh = firstMesh(this.design.group);

    this.toonMats = this.design.toonMats;
    this.baseColors = this.toonMats.map((m) => m.color.clone());
    this.baseEmissive = this.toonMats.map((m) => m.emissiveIntensity);

    this.label = makeLabelSprite(opts.pitchClass, colorHex);
    // Nudged up from 1.35 → 1.75 so the now-larger square label still floats
    // clearly above the enemy body instead of overlapping it.
    this.label.position.set(0, 1.75, 0);
    // Parent the label to the design group (not `object`) so it inherits the
    // hit-flash scale-punch, the slow death expand-fade, and the idle bob —
    // i.e. the same "juice" the body gets. The body's Y-rotation does affect
    // the label's parent, but Sprites always face the camera so the letter
    // stays readable.
    this.design.group.add(this.label);
  }

  update(audioTime: number) {
    const span = Math.max(0.001, this.arriveAt - this.spawnedAt);
    const u = Math.min(1, Math.max(0, (audioTime - this.spawnedAt) / span));
    // Ease-in approach: an enemy hangs back near its spawn distance for most
    // of its travel and only rushes the player in the final stretch. This
    // keeps the first wave visible-but-distant during the count-in and stops
    // enemies from crowding the player before the last measure (their
    // arrival beats are scheduled there). approach(1) === 1 so contact still
    // lands exactly on `arriveAt`.
    const approach = Math.pow(u, APPROACH_EASE_POWER);
    this.object.position.lerpVectors(this.spawnPosition, this.targetPosition, approach);

    const dt = this.lastT < 0 ? 0.016 : Math.max(0, Math.min(0.1, audioTime - this.lastT));
    this.lastT = audioTime;
    this.localTime += dt;
    const t = this.localTime;

    // Idle bob and slow Y rotation applied to the whole design group.
    this.design.group.position.y = Math.sin(t * 2.4) * 0.08;
    this.design.group.rotation.y += dt * 0.9;

    // Hit scale-punch: parabolic bump peaking at ~1.35 mid-window, returning
    // to 1.0 by the end. Re-applied each frame so the death-pop branch (below)
    // can overwrite it cleanly. Skipped when the death-pop is running.
    if (audioTime < this.punchUntil && this.fadeStart < 0) {
      const remaining = this.punchUntil - audioTime;
      const k = 1 - remaining / HIT_PUNCH_DURATION; // 0 -> 1 over window
      const bump = 4 * k * (1 - k); // parabola peaking at 1.0 at k=0.5
      this.design.group.scale.setScalar(1 + 0.35 * bump);
    } else if (this.fadeStart < 0) {
      this.design.group.scale.setScalar(1);
    }

    if (this.design.animate) this.design.animate(t, dt);

    // Menace lean: over the last 15% of the (now near-linear) approach, tilt
    // the rig forward toward the player so it still reads as a final lunge
    // even though overall travel is more uniform.
    const leanU = Math.max(0, (approach - 0.85) / 0.15);
    this.object.rotation.x = -0.55 * leanU * leanU;

    // Damage flash: all toon mats go bright white briefly.
    const flashing = audioTime < this.flashUntil;
    const hpFrac = this.maxHp > 0 ? this.hp / this.maxHp : 1;
    const emissiveBoost = 0.5 * (1 - hpFrac);

    if (this.fadeStart >= 0) {
      // Death animation: slowly expand and fade out. Visible enough that the
      // player can READ that an enemy died (the old 0.3s death-pop was so fast
      // enemies just blinked out). The label sprite is hidden from the start
      // — a separate HUD letter floats to the timeline note bar (see
      // LevelState.spawnKillLetter / Overlay.spawnKillLetter).
      const k = Math.min(1, (audioTime - this.fadeStart) / DEATH_DURATION);
      const scale = 1.0 + k * 1.2;          // 1.0 -> 2.2
      this.design.group.scale.setScalar(scale);
      this.design.group.rotation.y += dt * 1.6;
      const fade = 1 - k;                    // linear 1 -> 0
      for (let i = 0; i < this.toonMats.length; i++) {
        const m = this.toonMats[i];
        m.transparent = true;
        m.opacity = fade;
        // Brief white-burst on the way out for impact, mostly in the first
        // third of the window.
        const w = Math.min(1, k * 2.0);
        m.color.copy(this.baseColors[i]).lerp(WHITE, w * 0.6);
        m.emissiveIntensity = this.baseEmissive[i] + 1.2 * (1 - k);
      }
      // Detach the label visually — it's been hoisted into a HUD overlay
      // letter that flies to the timeline.
      this.label.material.opacity = 0;
      return;
    }

    for (let i = 0; i < this.toonMats.length; i++) {
      const m = this.toonMats[i];
      if (flashing) {
        m.color.setRGB(1, 1, 1);
        m.emissiveIntensity = this.baseEmissive[i] + 1.8;
      } else {
        m.color.copy(this.baseColors[i]);
        m.emissiveIntensity = this.baseEmissive[i] + emissiveBoost;
      }
    }
    // Brighten the pitch-letter sprite during a hit too — Sprite materials
    // multiply their map by `color`, so >1 components overdrive the texture
    // for a clear "snap" pulse synchronised with the body flash.
    const labelMat = this.label.material as THREE.SpriteMaterial;
    if (flashing) labelMat.color.setRGB(1.5, 1.5, 1.5);
    else labelMat.color.setRGB(1, 1, 1);
  }

  takeDamage(dmg: number, audioTime: number): number {
    if (!this.alive) return 0;
    const applied = Math.min(this.hp, dmg);
    this.hp -= applied;
    this.flashUntil = audioTime + HIT_FLASH_DURATION;
    this.punchUntil = audioTime + HIT_PUNCH_DURATION;
    if (this.hp <= 0) {
      this.alive = false;
      this.fadeStart = audioTime;
      this.deathDoneAt = audioTime + DEATH_DURATION;
    }
    return applied;
  }

  /** True if a note of pitch class `pc` is in this enemy's key — i.e. playing
   *  it scores a hit. Every in-key note counts, so a C-major run and a
   *  repeated-C run both register every note against a key-of-C enemy. */
  isVulnerableTo(pc: PitchClass): boolean {
    return keyPitchClasses(this.key, this.mode).has(pc);
  }

  hasReachedPlayer(audioTime: number): boolean {
    return audioTime >= this.arriveAt;
  }

  dispose() {
    (this.label.material as THREE.SpriteMaterial).map?.dispose();
    (this.label.material as THREE.SpriteMaterial).dispose();
    disposeGroup(this.design.group);
  }
}

const WHITE = new THREE.Color(1, 1, 1);

// ===== Design dispatcher ===================================================

function buildDesign(id: string, pc: PitchClass, color: number): DesignParts {
  switch (id) {
    case "boombox": return buildBoombox(pc, color);
    case "cassette": return buildCassette(pc, color);
    case "discoball": return buildDiscoBall(pc, color);
    case "vinyldemon": return buildVinylDemon(pc, color);
    case "speaker": return buildSpeaker(pc, color);
    case "mic": return buildMic(pc, color);
    case "drumstick": return buildDrumstick(pc, color);
    case "robot1": return buildRobot(pc, color, 0);
    case "robot2": return buildRobot(pc, color, 1);
    case "robot3": return buildRobot(pc, color, 2);
    case "robot4": return buildRobot(pc, color, 3);
    case "robot5": return buildRobot(pc, color, 4);
    default: return buildBoombox(pc, color);
  }
}

// ===== Material helpers ====================================================

function toonMat(color: number, opts: { emissive?: number; map?: THREE.Texture; emissiveIntensity?: number } = {}): ToonMat {
  const m = new THREE.MeshToonMaterial({
    color,
    emissive: opts.emissive ?? color,
    emissiveIntensity: opts.emissiveIntensity ?? 0.55,
    gradientMap: sharedToonRamp(),
    map: opts.map,
  });
  return m;
}

function addToon(group: THREE.Group, mesh: THREE.Mesh, mats: ToonMat[], outline = true, scale = 1.08) {
  group.add(mesh);
  mats.push(mesh.material as ToonMat);
  if (outline) addOutline(mesh, scale);
}

// Big cartoon eyes: white sphere + dark pupil, optional angry brow. Shared
// geometry + shared eye/pupil/brow materials (no per-instance allocation).
// We do NOT push these into the toon-mat list so the damage/death tinting
// leaves the eyes readable.
function addFace(
  group: THREE.Group,
  opts: {
    y: number;
    z: number;
    spread: number;
    eyeScale?: number;
    angry?: boolean;
    pupilDown?: number;
  },
) {
  const es = opts.eyeScale ?? 1;
  for (const sx of [-opts.spread, opts.spread]) {
    const white = new THREE.Mesh(EYE_WHITE_GEO, WHITE_EYE_MAT);
    white.scale.setScalar(es);
    white.position.set(sx, opts.y, opts.z);
    group.add(white);

    const pupil = new THREE.Mesh(PUPIL_GEO, PUPIL_MAT);
    pupil.scale.setScalar(es);
    pupil.position.set(
      sx * 0.92,
      opts.y - (opts.pupilDown ?? 0.015),
      opts.z + 0.07 * es,
    );
    group.add(pupil);

    if (opts.angry) {
      const brow = new THREE.Mesh(BROW_GEO, BROW_MAT);
      brow.scale.setScalar(es);
      brow.position.set(sx, opts.y + 0.13 * es, opts.z + 0.04 * es);
      // Inner edge dips down toward the nose -> scowl.
      brow.rotation.z = sx < 0 ? -0.55 : 0.55;
      group.add(brow);
    }
  }
}

// ===== Boombox (C) =========================================================

function buildBoombox(_pc: PitchClass, color: number): DesignParts {
  const group = new THREE.Group();
  const mats: ToonMat[] = [];

  const bodyMap = tex("boombox", () => generateSpeakerGrilleTexture(0xff2bd6));
  const body = new THREE.Mesh(
    geo("bb-body", () => new THREE.BoxGeometry(1.15, 0.62, 0.4)),
    toonMat(color, { emissive: color, emissiveIntensity: 0.35, map: bodyMap }),
  );
  addToon(group, body, mats);

  // Two big woofers (cylinders) on the front face — read as cheeks.
  const woofGeo = geo("bb-woof", () => new THREE.CylinderGeometry(0.16, 0.16, 0.09, SEG));
  for (const sx of [-0.32, 0.32]) {
    const cone = new THREE.Mesh(woofGeo, toonMat(0x141418, { emissive: color, emissiveIntensity: 0.7 }));
    cone.rotation.x = Math.PI / 2;
    cone.position.set(sx, -0.08, 0.2);
    addToon(group, cone, mats);
  }

  // Eyes sit between the woofers, up top, for a stacked face.
  addFace(group, { y: 0.16, z: 0.21, spread: 0.16, eyeScale: 0.95 });

  // Two antennae
  const ants: THREE.Mesh[] = [];
  const antGeo = geo("bb-ant", () => new THREE.CylinderGeometry(0.018, 0.018, 0.5, 6));
  for (const sx of [-0.4, 0.4]) {
    const ant = new THREE.Mesh(antGeo, toonMat(0x999999, { emissive: 0x222222, emissiveIntensity: 0.1 }));
    ant.position.set(sx, 0.55, 0);
    ant.rotation.z = sx > 0 ? -0.2 : 0.2;
    addToon(group, ant, mats, true, 1.4);
    ants.push(ant);
  }

  // Knobs
  const knobGeo = geo("bb-knob", () => new THREE.CylinderGeometry(0.045, 0.045, 0.04, SEG));
  for (const sx of [-0.06, 0.06]) {
    const knob = new THREE.Mesh(knobGeo, toonMat(0xfff8c4, { emissive: 0xffcc00, emissiveIntensity: 0.6 }));
    knob.rotation.x = Math.PI / 2;
    knob.position.set(sx, -0.22, 0.21);
    addToon(group, knob, mats, false);
  }

  const animate = (t: number) => {
    ants[0].rotation.z = 0.2 + Math.sin(t * 6) * 0.1;
    ants[1].rotation.z = -0.2 + Math.cos(t * 6) * 0.1;
  };

  return { group, toonMats: mats, animate };
}

// ===== Cassette (D) ========================================================

function buildCassette(_pc: PitchClass, color: number): DesignParts {
  const group = new THREE.Group();
  const mats: ToonMat[] = [];

  const labelMap = tex("cassette", () => generateCassetteLabelTexture("MIX"));
  const body = new THREE.Mesh(
    geo("cs-body", () => new THREE.BoxGeometry(1.1, 0.7, 0.2)),
    toonMat(color, { emissive: color, emissiveIntensity: 0.4, map: labelMap }),
  );
  addToon(group, body, mats);

  // Two reels = googly-spinning eyes vibe; add real eyes above them.
  const reels: THREE.Mesh[] = [];
  const reelGeo = geo("cs-reel", () => new THREE.CylinderGeometry(0.13, 0.13, 0.06, SEG));
  const hubGeo = geo("cs-hub", () => new THREE.CylinderGeometry(0.045, 0.045, 0.07, 6));
  for (const sx of [-0.24, 0.24]) {
    const reel = new THREE.Mesh(reelGeo, toonMat(0x18181c, { emissive: 0x000000, emissiveIntensity: 0.0 }));
    reel.rotation.x = Math.PI / 2;
    reel.position.set(sx, -0.12, 0.11);
    addToon(group, reel, mats);
    reels.push(reel);

    const hub = new THREE.Mesh(hubGeo, toonMat(0xffffff, { emissive: color, emissiveIntensity: 0.6 }));
    hub.rotation.x = Math.PI / 2;
    hub.position.set(sx, -0.12, 0.14);
    addToon(group, hub, mats, false);
  }
  addFace(group, { y: 0.18, z: 0.12, spread: 0.2, eyeScale: 1.05 });

  const animate = (_t: number, dt: number) => {
    reels[0].rotation.y += dt * 4;
    reels[1].rotation.y += dt * 4;
  };

  return { group, toonMats: mats, animate };
}

// ===== Disco ball (E) =====================================================

function buildDiscoBall(_pc: PitchClass, color: number): DesignParts {
  const group = new THREE.Group();
  const mats: ToonMat[] = [];

  const mirrorMap = tex("disco", () => generateMirrorTexture(0xffffff));
  const ballGeo = geo("db-ball", () => new THREE.IcosahedronGeometry(0.5, 1));
  const ball = new THREE.Mesh(
    ballGeo,
    toonMat(0xdddddd, { emissive: color, emissiveIntensity: 0.7, map: mirrorMap }),
  );
  addToon(group, ball, mats);

  // Hanging chain
  const linkGeo = geo("db-link", () => new THREE.TorusGeometry(0.045, 0.014, 4, SEG));
  for (let i = 0; i < 4; i++) {
    const link = new THREE.Mesh(linkGeo, toonMat(0xdddddd, { emissive: 0x333333, emissiveIntensity: 0.1 }));
    link.position.set(0, 0.55 + i * 0.09, 0);
    link.rotation.x = i % 2 === 0 ? 0 : Math.PI / 2;
    addToon(group, link, mats, false);
  }

  // Inner glow core
  const core = new THREE.Mesh(
    geo("db-core", () => new THREE.SphereGeometry(0.2, SEG, SEG)),
    toonMat(color, { emissive: color, emissiveIntensity: 1.4 }),
  );
  addToon(group, core, mats, false);

  // Face floats on the surface (parented to ball so it spins with it).
  const faceRig = new THREE.Group();
  ball.add(faceRig);
  addFace(faceRig, { y: 0.08, z: 0.46, spread: 0.18, eyeScale: 0.9 });

  const animate = (_t: number, dt: number) => {
    ball.rotation.y += dt * 2.5;
  };

  return { group, toonMats: mats, animate };
}

// ===== Vinyl Demon (F) ====================================================

function buildVinylDemon(_pc: PitchClass, color: number): DesignParts {
  const group = new THREE.Group();
  const mats: ToonMat[] = [];

  const faceMap = tex("vinyl", () => generateVinylGroovesTexture());
  const disc = new THREE.Mesh(
    geo("vd-disc", () => new THREE.CylinderGeometry(0.58, 0.58, 0.07, SEG * 2)),
    toonMat(0x161616, { emissive: 0x000000, emissiveIntensity: 0.0, map: faceMap }),
  );
  disc.rotation.x = Math.PI / 2;
  addToon(group, disc, mats);

  // Center label
  const labelDisc = new THREE.Mesh(
    geo("vd-label", () => new THREE.CylinderGeometry(0.2, 0.2, 0.08, SEG * 2)),
    toonMat(color, { emissive: color, emissiveIntensity: 0.7 }),
  );
  labelDisc.rotation.x = Math.PI / 2;
  addToon(group, labelDisc, mats, false);

  // Big angry face front-and-center — this is THE demon.
  addFace(group, { y: 0.06, z: 0.06, spread: 0.21, eyeScale: 1.15, angry: true, pupilDown: 0.03 });

  // Horns
  const hornGeo = geo("vd-horn", () => new THREE.ConeGeometry(0.09, 0.32, 6));
  for (const sx of [-0.28, 0.28]) {
    const horn = new THREE.Mesh(hornGeo, toonMat(0xffe0e0, { emissive: 0xff2222, emissiveIntensity: 0.6 }));
    horn.position.set(sx, 0.46, 0);
    horn.rotation.z = sx > 0 ? -0.35 : 0.35;
    addToon(group, horn, mats);
  }

  const animate = (_t: number, dt: number) => {
    disc.rotation.y += dt * 3.2;
  };

  return { group, toonMats: mats, animate };
}

// ===== Speaker (G) =========================================================

function buildSpeaker(_pc: PitchClass, color: number): DesignParts {
  const group = new THREE.Group();
  const mats: ToonMat[] = [];

  const grilleMap = tex("speaker", () => generateSpeakerGrilleTexture(0x2bcfff));
  const cab = new THREE.Mesh(
    geo("sp-cab", () => new THREE.BoxGeometry(0.66, 1.05, 0.42)),
    toonMat(color, { emissive: color, emissiveIntensity: 0.3, map: grilleMap }),
  );
  addToon(group, cab, mats);

  // Tweeter = forehead dot, woofer = big mouth.
  const tweet = new THREE.Mesh(
    geo("sp-tweet", () => new THREE.CylinderGeometry(0.09, 0.09, 0.06, SEG)),
    toonMat(0x141418, { emissive: color, emissiveIntensity: 0.6 }),
  );
  tweet.rotation.x = Math.PI / 2;
  tweet.position.set(0, 0.36, 0.21);
  addToon(group, tweet, mats);

  const woof = new THREE.Mesh(
    geo("sp-woof", () => new THREE.CylinderGeometry(0.24, 0.26, 0.09, SEG)),
    toonMat(0x141418, { emissive: color, emissiveIntensity: 0.9 }),
  );
  woof.rotation.x = Math.PI / 2;
  woof.position.set(0, -0.22, 0.22);
  addToon(group, woof, mats);

  // Inner bass dome glow
  const dome = new THREE.Mesh(
    geo("sp-dome", () => new THREE.SphereGeometry(0.08, SEG, SEG)),
    toonMat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 1.8 }),
  );
  dome.position.set(0, -0.22, 0.28);
  addToon(group, dome, mats, false);

  // Eyes on the upper cabinet.
  addFace(group, { y: 0.12, z: 0.22, spread: 0.16, eyeScale: 0.9 });

  const animate = (t: number) => {
    const pulse = 1 + Math.sin(t * 8) * 0.08;
    woof.scale.set(pulse, 1, pulse);
  };

  return { group, toonMats: mats, animate };
}

// ===== Mic (A) =============================================================

function buildMic(_pc: PitchClass, color: number): DesignParts {
  const group = new THREE.Group();
  const mats: ToonMat[] = [];

  const grilleMap = tex("mic", () => generateMicGrilleTexture(0x6c5cff));
  const head = new THREE.Mesh(
    geo("mic-head", () => new THREE.SphereGeometry(0.3, SEG, SEG)),
    toonMat(color, { emissive: color, emissiveIntensity: 0.5, map: grilleMap }),
  );
  head.position.set(0, 0.28, 0);
  addToon(group, head, mats);

  // Body
  const body = new THREE.Mesh(
    geo("mic-body", () => new THREE.CylinderGeometry(0.1, 0.13, 0.42, SEG)),
    toonMat(0x222230, { emissive: color, emissiveIntensity: 0.4 }),
  );
  body.position.set(0, -0.12, 0);
  addToon(group, body, mats);

  // Cable loop
  const cable = new THREE.Mesh(
    geo("mic-cable", () => new THREE.TorusGeometry(0.09, 0.022, 4, SEG)),
    toonMat(0x222222, { emissive: 0x000000, emissiveIntensity: 0.0 }),
  );
  cable.position.set(0, -0.38, 0);
  cable.rotation.x = Math.PI / 2;
  addToon(group, cable, mats, false);

  // Eyes on the mic head -> singing creature.
  addFace(group, { y: 0.32, z: 0.27, spread: 0.13, eyeScale: 0.85 });

  const animate = (t: number) => {
    head.rotation.z = Math.sin(t * 3) * 0.16;
  };

  return { group, toonMats: mats, animate };
}

// ===== Drumstick X (B) =====================================================

function buildDrumstick(_pc: PitchClass, color: number): DesignParts {
  const group = new THREE.Group();
  const mats: ToonMat[] = [];

  const stickGeom = geo("ds-stick", () => new THREE.CylinderGeometry(0.05, 0.08, 0.95, SEG));
  const stickA = new THREE.Mesh(stickGeom, toonMat(0xd9b27a, { emissive: color, emissiveIntensity: 0.4 }));
  stickA.rotation.z = Math.PI / 4;
  addToon(group, stickA, mats);

  const stickB = new THREE.Mesh(stickGeom, toonMat(0xd9b27a, { emissive: color, emissiveIntensity: 0.4 }));
  stickB.rotation.z = -Math.PI / 4;
  addToon(group, stickB, mats);

  // Tip beads (colored)
  const tipGeo = geo("ds-tip", () => new THREE.SphereGeometry(0.085, SEG, SEG));
  for (const a of [Math.PI / 4, -Math.PI / 4]) {
    for (const r of [-0.47, 0.47]) {
      const tip = new THREE.Mesh(tipGeo, toonMat(color, { emissive: color, emissiveIntensity: 1.0 }));
      tip.position.set(Math.sin(a) * r, Math.cos(a) * r, 0);
      addToon(group, tip, mats, false);
    }
  }

  // Center bind doubles as a face hub.
  const bind = new THREE.Mesh(
    geo("ds-bind", () => new THREE.SphereGeometry(0.16, SEG, SEG)),
    toonMat(color, { emissive: color, emissiveIntensity: 0.7 }),
  );
  addToon(group, bind, mats);

  // Eyes on the hub. Parented to group but group spins — keep them tight.
  addFace(group, { y: 0.02, z: 0.16, spread: 0.07, eyeScale: 0.6 });

  const animate = (_t: number, dt: number) => {
    group.rotation.z += dt * 2.4;
  };

  return { group, toonMats: mats, animate };
}

// ===== Robots (sharps) =====================================================

function buildRobot(_pc: PitchClass, color: number, variant: number): DesignParts {
  const group = new THREE.Group();
  const mats: ToonMat[] = [];

  // Body color now derives from the bright enemy color so the robot reads
  // saturated; head stays a darker metal so the face pops.
  const headColor = 0x2c2c36;

  const headGeoms = [
    geo("rb-head0", () => new THREE.BoxGeometry(0.6, 0.55, 0.55)),
    geo("rb-head1", () => new THREE.BoxGeometry(0.66, 0.5, 0.55)),
    geo("rb-head2", () => new THREE.BoxGeometry(0.55, 0.6, 0.5)),
    geo("rb-head3", () => new THREE.BoxGeometry(0.6, 0.55, 0.6)),
    geo("rb-head4", () => new THREE.BoxGeometry(0.68, 0.46, 0.55)),
  ];
  const head = new THREE.Mesh(
    headGeoms[variant % headGeoms.length],
    toonMat(headColor, { emissive: color, emissiveIntensity: 0.35 }),
  );
  head.position.set(0, 0.32, 0);
  addToon(group, head, mats);

  // Big 3D cartoon eyes on every robot. Robots 0,2,3 scowl (angry brows);
  // 1 and 4 are neutral/curious.
  const angry = variant === 0 || variant === 2 || variant === 3;
  addFace(group, {
    y: 0.36,
    z: 0.3,
    spread: 0.16,
    eyeScale: variant === 4 ? 1.2 : 1.0,
    angry,
    pupilDown: angry ? 0.03 : 0.01,
  });

  // Body — bright saturated color.
  const body = new THREE.Mesh(
    geo("rb-body", () => new THREE.BoxGeometry(0.48, 0.38, 0.38)),
    toonMat(color, { emissive: color, emissiveIntensity: 0.45 }),
  );
  body.position.set(0, -0.16, 0);
  addToon(group, body, mats);

  // Arms
  const armGeom = geo("rb-arm", () => new THREE.BoxGeometry(0.13, 0.32, 0.13));
  const armL = new THREE.Mesh(armGeom, toonMat(headColor, { emissive: 0x111111, emissiveIntensity: 0.1 }));
  armL.position.set(-0.34, -0.1, 0);
  addToon(group, armL, mats);

  const armR = new THREE.Mesh(armGeom, toonMat(headColor, { emissive: 0x111111, emissiveIntensity: 0.1 }));
  armR.position.set(0.34, -0.1, 0);
  addToon(group, armR, mats);

  // Antenna
  const antenna = new THREE.Mesh(
    geo("rb-ant", () => new THREE.CylinderGeometry(0.022, 0.022, 0.32, 6)),
    toonMat(0x888888, { emissive: 0x222222, emissiveIntensity: 0.1 }),
  );
  antenna.position.set(0, 0.7, 0);
  addToon(group, antenna, mats, true, 1.3);

  // Antenna bulb
  const bulb = new THREE.Mesh(
    geo("rb-bulb", () => new THREE.SphereGeometry(0.07, SEG, SEG)),
    toonMat(color, { emissive: color, emissiveIntensity: 1.6 }),
  );
  bulb.position.set(0, 0.88, 0);
  addToon(group, bulb, mats, false);

  // Variant-specific bonus piece
  if (variant === 1) {
    const pack = new THREE.Mesh(
      geo("rb-pack", () => new THREE.BoxGeometry(0.32, 0.27, 0.16)),
      toonMat(color, { emissive: color, emissiveIntensity: 0.6 }),
    );
    pack.position.set(0, -0.1, -0.27);
    addToon(group, pack, mats);
  } else if (variant === 2) {
    const visor = new THREE.Mesh(
      geo("rb-visor", () => new THREE.BoxGeometry(0.56, 0.09, 0.05)),
      toonMat(0x111111, { emissive: color, emissiveIntensity: 1.3 }),
    );
    visor.position.set(0, 0.5, 0.29);
    addToon(group, visor, mats, false);
  } else if (variant === 3) {
    const spGeo = geo("rb-spike", () => new THREE.ConeGeometry(0.07, 0.2, 5));
    for (const sx of [-0.32, 0.32]) {
      const sp = new THREE.Mesh(spGeo, toonMat(color, { emissive: color, emissiveIntensity: 0.9 }));
      sp.position.set(sx, 0.1, 0);
      sp.rotation.z = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
      addToon(group, sp, mats);
    }
  } else if (variant === 4) {
    const wheel = new THREE.Mesh(
      geo("rb-wheel", () => new THREE.CylinderGeometry(0.2, 0.2, 0.1, SEG)),
      toonMat(0x222222, { emissive: color, emissiveIntensity: 0.4 }),
    );
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(0, -0.42, 0);
    addToon(group, wheel, mats);
  }

  const animate = (t: number) => {
    antenna.rotation.z = Math.sin(t * 5 + variant) * 0.2;
    bulb.position.x = Math.sin(t * 5 + variant) * 0.05;
    armL.rotation.x = Math.sin(t * 3) * 0.35;
    armR.rotation.x = -Math.sin(t * 3) * 0.35;
  };

  return { group, toonMats: mats, animate };
}

// ===== Texture generators ==================================================
// Each generator is called ONCE per design id (cached in texCache). Body
// color is applied via material.color, so the canvas uses a fixed accent.

function hexToCSS(color: number): string {
  return "#" + color.toString(16).padStart(6, "0");
}

function canvasTex(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, size = 256): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  draw(ctx, size, size);
  const t = new THREE.CanvasTexture(canvas);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

function generateSpeakerGrilleTexture(accent: number): THREE.CanvasTexture {
  return canvasTex((ctx, w, h) => {
    ctx.fillStyle = "#1a1a1f";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = hexToCSS(accent);
    ctx.globalAlpha = 0.18;
    ctx.fillRect(8, 8, w - 16, h - 16);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#0a0a0d";
    const step = 18;
    for (let y = 12; y < h; y += step) {
      for (let x = 12; x < w; x += step) {
        ctx.beginPath();
        ctx.arc(x + ((y / step) % 2) * 9, y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = hexToCSS(accent);
    ctx.fillRect(0, h - 32, w, 6);
  });
}

function generateCassetteLabelTexture(title: string): THREE.CanvasTexture {
  return canvasTex((ctx, w, h) => {
    ctx.fillStyle = "#fffbe8";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(20, 24, w - 40, h - 120);
    ctx.strokeStyle = "#2a2a2a";
    ctx.lineWidth = 3;
    ctx.strokeRect(20, 24, w - 40, h - 120);
    ctx.fillStyle = "#2a2a2a";
    ctx.font = "italic bold 34px serif";
    ctx.textAlign = "center";
    ctx.fillText(title + "TAPE", w / 2, 70);
    ctx.font = "bold 26px monospace";
    ctx.fillText("- side A -", w / 2, 110);
    // Reel windows along the bottom.
    ctx.fillStyle = "#1a1a1a";
    ctx.beginPath();
    ctx.arc(w * 0.3, h - 56, 30, 0, Math.PI * 2);
    ctx.arc(w * 0.7, h - 56, 30, 0, Math.PI * 2);
    ctx.fill();
  });
}

function generateMirrorTexture(accent: number): THREE.CanvasTexture {
  return canvasTex((ctx, w, h) => {
    ctx.fillStyle = "#0a0a0f";
    ctx.fillRect(0, 0, w, h);
    const tile = 24;
    for (let y = 0; y < h; y += tile) {
      for (let x = 0; x < w; x += tile) {
        const k = (Math.sin(x * 0.3) + Math.cos(y * 0.3) + 2) / 4;
        const r = Math.floor(160 + k * 95);
        const g = Math.floor(160 + k * 95);
        const b = Math.floor(180 + k * 75);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x + 2, y + 2, tile - 4, tile - 4);
      }
    }
    ctx.strokeStyle = hexToCSS(accent);
    ctx.lineWidth = 2;
    for (let y = 0; y < h; y += tile) ctx.strokeRect(0, y, w, tile);
    for (let x = 0; x < w; x += tile) ctx.strokeRect(x, 0, tile, h);
  });
}

function generateVinylGroovesTexture(): THREE.CanvasTexture {
  return canvasTex((ctx, w, h) => {
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#1c1c1c";
    ctx.lineWidth = 2;
    for (let r = 24; r < w / 2; r += 7) {
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Sheen streak for the polished-vinyl look.
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 26;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.32, -0.5, 0.5);
    ctx.stroke();
  });
}

function generateMicGrilleTexture(accent: number): THREE.CanvasTexture {
  return canvasTex((ctx, w, h) => {
    ctx.fillStyle = "#2a2a32";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = hexToCSS(accent);
    ctx.globalAlpha = 0.22;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#0a0a0a";
    ctx.lineWidth = 2;
    const cell = 16;
    for (let y = 0; y < h; y += cell) {
      for (let x = 0; x < w; x += cell) {
        ctx.beginPath();
        ctx.arc(x + cell / 2, y + cell / 2, cell * 0.36, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  });
}

// ===== Label sprite ========================================================

function makeLabelSprite(text: string, color: number): THREE.Sprite {
  // High-res square canvas keeps the big glyph crisp at gameplay distance.
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  // No background panel — fully transparent canvas, only the glyph is drawn.
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  ctx.font = "900 320px 'Arial Black', 'Helvetica Neue', Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;

  // Soft colored glow so the block letter separates from bright neon.
  ctx.shadowColor = hexToCSS(color);
  ctx.shadowBlur = 36;

  // Thick black outline pass (drawn under the fill) for contrast against
  // both bright buildings and the dark sky.
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 26;
  ctx.strokeText(text, cx, cy);

  // Second, slightly tighter dark outline kills any glow bleed at the edge.
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(0,0,0,0.9)";
  ctx.lineWidth = 12;
  ctx.strokeText(text, cx, cy);

  // Bright fill: white core with a thin note-color rim keeps per-note color
  // coding readable while staying high-contrast.
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, cx, cy);
  ctx.strokeStyle = hexToCSS(color);
  ctx.lineWidth = 5;
  ctx.strokeText(text, cx, cy);

  const t = new THREE.CanvasTexture(canvas);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  // Bigger in-world and square aspect to match the 512×512 canvas (was
  // 1.8×0.9 on a 2:1 canvas → roughly 1.7× the footprint now).
  sprite.scale.set(3.0, 3.0, 1);
  sprite.renderOrder = 999;
  return sprite;
}

// ===== Utilities ===========================================================

function firstMesh(group: THREE.Object3D): THREE.Mesh {
  for (const child of group.children) {
    if ((child as THREE.Mesh).isMesh) return child as THREE.Mesh;
  }
  // Fallback — should not happen, but keep API contract
  const fallback = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.1, 0.1),
    new THREE.MeshToonMaterial({ color: 0xffffff }),
  );
  group.add(fallback);
  return fallback;
}

// Shared (cached) geometries, textures, and the eye/brow materials are module
// singletons reused across every enemy, so they must NOT be disposed here.
// Only per-instance toon materials and the outline-free clones are released.
function disposeGroup(group: THREE.Object3D) {
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.Material | THREE.Material[];
    const release = (sub: THREE.Material) => {
      // Never dispose the shared eye/pupil/brow singletons.
      if (sub === WHITE_EYE_MAT || sub === PUPIL_MAT || sub === BROW_MAT) return;
      sub.dispose();
    };
    if (Array.isArray(mat)) mat.forEach(release);
    else release(mat);
  });
}
