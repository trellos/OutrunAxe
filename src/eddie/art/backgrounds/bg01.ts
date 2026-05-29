// bg01 — "Neon City -> Inferno" (the showcase background, GDD §8). A seeded,
// pixelated neon CITY the camera flies forward through, down the street between
// two rows of chunky box towers. Buildings recycle back->front so the run is
// endless. Performance INTENSITY morphs the world calm->chaos: clean neon city
// at morph 0, sidewalk fires creeping in as it rises, fires pulsing/spitting to
// the beat at mid, more fire than buildings higher up, and a screen-filling
// all-fire inferno with color chaos + camera shudder at morph 1.
//
// Juice contract (all three events handled):
//  - eddieBeatPulse (downbeat stronger) -> window gleam, building shake, edge
//    jitter, fire spit. Beat reactions scale with `morph`.
//  - eddieShake {magnitude} -> camera jolt that decays.
//  - eddieIntensity {value 0..1} -> stored as target; `morph` EASES toward it
//    each frame (never snaps) and drives the whole transformation.
// dispose() restores scene.background/fog, disposes ALL geometry/material/
// texture, and unsubscribes ALL listeners.

import * as THREE from "three";
import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";
import type { EddieBackgroundDef, EddieBackgroundVariant } from "./types";

// Street + tower layout (world units). Camera flies along -Z forever.
const STREET_HALF = 9; // half-width of the street (towers sit just outside)
const ROW_OFFSET = 14; // tower row center X (left -X, right +X)
const SLOT_DEPTH = 18; // Z spacing between tower slots along a row
const SLOTS_PER_ROW = 9; // towers per side before recycling
const FAR_Z = -SLOT_DEPTH * SLOTS_PER_ROW; // furthest tower depth
const FLY_SPEED = 26; // base forward speed (units/s), eases up with morph

const NEON_TINTS = [0xff2bd6, 0x00f0ff, 0xffd02b, 0xff5a8a, 0x7a3cff, 0x36e07a];

interface Tower {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  baseColor: THREE.Color;
  side: number; // -1 left, +1 right
  shakeSeed: number;
}

interface Fire {
  sprite: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  baseX: number;
  baseScale: number;
  hueSeed: number;
  spit: number; // current upward spit (decays)
}

class Bg01 implements EddieBackgroundVariant {
  private scene: THREE.Scene | null = null;
  private group = new THREE.Group();
  private prevBackground: THREE.Scene["background"] = null;
  private prevFog: THREE.Scene["fog"] = null;

  // Shared chunky textures + geometry.
  private facadeTex!: THREE.CanvasTexture;
  private fireTex!: THREE.CanvasTexture;
  private boxGeo!: THREE.BoxGeometry;
  private fireGeo!: THREE.PlaneGeometry;

  private towers: Tower[] = [];
  private fires: Fire[] = [];

  private ground!: THREE.Mesh;
  private groundMat!: THREE.MeshBasicMaterial;
  private skyMat!: THREE.MeshBasicMaterial;
  private skyTex!: THREE.CanvasTexture;
  private sky!: THREE.Mesh;

  private camera: THREE.PerspectiveCamera | null = null;
  private camBaseY = 4.5;

  private offBeat?: () => void;
  private offShake?: () => void;
  private offIntensity?: () => void;

  private morph = 0; // eased 0..1 — drives the whole transformation
  private intensityTarget = 0; // last eddieIntensity value
  private pulse = 0; // decaying beat pump
  private downbeatPulse = 0; // decaying downbeat pump (stronger)
  private shake = 0; // external eddieShake jolt (decays)
  private t = 0;
  private rng = this.makeRng(0xc0ffee);

  private makeRng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }

  mount(ctx: { scene: THREE.Scene; camera?: THREE.PerspectiveCamera; juice: EventBus<EddieJuiceEvents> }): void {
    this.scene = ctx.scene;
    this.prevBackground = ctx.scene.background;
    this.prevFog = ctx.scene.fog;
    ctx.scene.background = new THREE.Color(0x0a0612);
    // Fog hides the recycle seam at the far end of the street.
    ctx.scene.fog = new THREE.Fog(0x0a0612, 60, Math.abs(FAR_Z) + 30);

    this.facadeTex = this.buildFacadeTexture();
    this.fireTex = this.buildFireTexture();
    this.boxGeo = new THREE.BoxGeometry(1, 1, 1);
    this.fireGeo = new THREE.PlaneGeometry(1, 1);

    // --- Sky backdrop: night-purple gradient (red-shifts as morph rises).
    const skyCv = document.createElement("canvas");
    skyCv.width = 8;
    skyCv.height = 128;
    const sc = skyCv.getContext("2d")!;
    const sg = sc.createLinearGradient(0, 0, 0, 128);
    sg.addColorStop(0.0, "#06030f");
    sg.addColorStop(0.55, "#1a0a36");
    sg.addColorStop(1.0, "#3a0f5e");
    sc.fillStyle = sg;
    sc.fillRect(0, 0, 8, 128);
    this.skyTex = new THREE.CanvasTexture(skyCv);
    this.skyTex.colorSpace = THREE.SRGBColorSpace;
    this.skyMat = new THREE.MeshBasicMaterial({ map: this.skyTex, depthWrite: false, depthTest: false, fog: false });
    this.sky = new THREE.Mesh(new THREE.PlaneGeometry(600, 300), this.skyMat);
    this.sky.position.set(0, 40, FAR_Z - 40);
    this.sky.renderOrder = -30;
    this.group.add(this.sky);

    // --- Ground: dark asphalt street with neon centerline + sidewalk stripes.
    const grCv = document.createElement("canvas");
    grCv.width = 32;
    grCv.height = 256;
    const gc = grCv.getContext("2d")!;
    gc.fillStyle = "#070410";
    gc.fillRect(0, 0, 32, 256);
    gc.fillStyle = "#00f0ff";
    for (let y = 0; y < 256; y += 22) gc.fillRect(15, y, 2, 12);
    gc.fillStyle = "#ff2bd6";
    gc.fillRect(2, 0, 2, 256);
    gc.fillRect(28, 0, 2, 256);
    const grTex = new THREE.CanvasTexture(grCv);
    grTex.colorSpace = THREE.SRGBColorSpace;
    grTex.magFilter = THREE.NearestFilter;
    grTex.minFilter = THREE.NearestFilter;
    grTex.generateMipmaps = false;
    grTex.wrapS = THREE.RepeatWrapping;
    grTex.wrapT = THREE.RepeatWrapping;
    grTex.repeat.set(1, 24);
    this.groundMat = new THREE.MeshBasicMaterial({ map: grTex });
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(STREET_HALF * 2 + 6, Math.abs(FAR_Z) + 80),
      this.groundMat,
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.set(0, 0, FAR_Z / 2 + 20);
    this.group.add(this.ground);

    // --- Towers: two rows lining the street, marching toward the camera.
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < SLOTS_PER_ROW; i++) {
        const t = this.makeTower(side, FAR_Z + i * SLOT_DEPTH + this.rng() * 4);
        this.towers.push(t);
        this.group.add(t.mesh);
      }
    }

    // --- Fires: a pool of pixely flame sprites; hidden until morph reveals them.
    const FIRE_COUNT = 40;
    for (let i = 0; i < FIRE_COUNT; i++) {
      const f = this.makeFire(FAR_Z + this.rng() * Math.abs(FAR_Z));
      this.fires.push(f);
      this.group.add(f.sprite);
    }

    ctx.scene.add(this.group);

    if (ctx.camera) {
      this.camera = ctx.camera;
      this.camera.position.set(0, this.camBaseY, 30);
      this.camera.lookAt(0, 6, FAR_Z);
    }

    this.offBeat = ctx.juice.on("eddieBeatPulse", (e) => {
      if (e.downbeat) this.downbeatPulse = 1;
      this.pulse = Math.max(this.pulse, e.downbeat ? 1 : 0.6);
      for (const f of this.fires) f.spit = Math.max(f.spit, e.downbeat ? 1 : 0.6);
    });
    this.offShake = ctx.juice.on("eddieShake", (e) => {
      this.shake = Math.max(this.shake, e.magnitude);
    });
    this.offIntensity = ctx.juice.on("eddieIntensity", (e) => {
      this.intensityTarget = Math.min(1, Math.max(0, e.value));
    });
  }

  // ---- Asset builders -----------------------------------------------------

  // Chunky lit-window facade: dark wall + a grid of bright neon window pixels
  // with unlit gaps. NearestFilter keeps it crisp + pixely; per-mesh tint colors.
  private buildFacadeTexture(): THREE.CanvasTexture {
    const cv = document.createElement("canvas");
    cv.width = 32;
    cv.height = 64;
    const g = cv.getContext("2d")!;
    g.fillStyle = "#0c0820";
    g.fillRect(0, 0, 32, 64);
    const rng = this.makeRng(0x5151);
    for (let y = 3; y < 62; y += 5) {
      for (let x = 3; x < 30; x += 5) {
        if (rng() < 0.25) continue; // unlit window
        const lit = 0.6 + rng() * 0.4;
        const v = Math.floor(180 + lit * 60);
        g.fillStyle = `rgb(${v},${v},${Math.floor(v * 0.95)})`;
        g.fillRect(x, y, 3, 3);
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  // Chunky flame sprite: a low-res additive teardrop, hot core -> orange -> red,
  // drawn pixel-cell by pixel-cell so it reads as retro fire. Tinted per-sprite.
  private buildFireTexture(): THREE.CanvasTexture {
    const N = 24;
    const cv = document.createElement("canvas");
    cv.width = N;
    cv.height = N;
    const g = cv.getContext("2d")!;
    g.clearRect(0, 0, N, N);
    const cx = N / 2;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const ny = y / N; // 0 top .. 1 bottom
        const halfW = (0.12 + ny * 0.42) * N;
        const dx = Math.abs(x - cx);
        if (dx > halfW) continue;
        const edge = 1 - dx / halfW;
        const vert = Math.pow(1 - ny, 0.7);
        const heat = Math.min(1, edge * 0.6 + vert * 0.8);
        if (heat < 0.12) continue;
        let r: number, gg: number, b: number;
        if (heat > 0.8) {
          r = 255; gg = 240; b = 180; // white-hot core
        } else if (heat > 0.5) {
          r = 255; gg = 170; b = 40; // orange
        } else {
          r = 220; gg = 70; b = 20; // deep red
        }
        const a = Math.min(1, heat * 1.2);
        g.fillStyle = `rgba(${r},${gg},${b},${a.toFixed(3)})`;
        g.fillRect(x, y, 1, 1);
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    return tex;
  }

  private makeTower(side: number, z: number): Tower {
    const height = 14 + this.rng() * 30;
    const width = 5 + this.rng() * 4;
    const depth = 5 + this.rng() * 4;
    const baseColor = new THREE.Color(NEON_TINTS[(this.rng() * NEON_TINTS.length) | 0]);
    const mat = new THREE.MeshBasicMaterial({ map: this.facadeTex.clone(), color: baseColor.clone(), fog: true });
    const map = mat.map!;
    map.needsUpdate = true;
    map.repeat.set(Math.max(1, Math.round(width / 3)), Math.max(2, Math.round(height / 4)));
    const mesh = new THREE.Mesh(this.boxGeo, mat);
    mesh.scale.set(width, height, depth);
    mesh.position.set(side * (ROW_OFFSET + width * 0.1), height / 2, z);
    mesh.frustumCulled = false;
    return { mesh, mat, baseColor, side, shakeSeed: this.rng() * 100 };
  }

  private makeFire(z: number): Fire {
    const mat = new THREE.MeshBasicMaterial({
      map: this.fireTex,
      color: new THREE.Color(0xffffff),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
    });
    const baseScale = 2.5 + this.rng() * 3.5;
    const baseX = (this.rng() < 0.5 ? -1 : 1) * (STREET_HALF - 1 + this.rng() * (ROW_OFFSET - STREET_HALF));
    const sprite = new THREE.Mesh(this.fireGeo, mat);
    sprite.scale.set(0.001, 0.001, 1);
    sprite.position.set(baseX, baseScale * 0.5, z);
    sprite.frustumCulled = false;
    sprite.renderOrder = 5;
    return { sprite, mat, baseX, baseScale, hueSeed: this.rng() * 6.283, spit: 0 };
  }

  // ---- Per-frame ----------------------------------------------------------

  update(dt: number, _audioTime: number): void {
    this.t += dt;

    // Ease morph toward the intensity target (never snap).
    this.morph += (this.intensityTarget - this.morph) * dt * 1.5;
    this.morph = Math.min(1, Math.max(0, this.morph));
    const m = this.morph;

    if (this.pulse > 0) this.pulse = Math.max(0, this.pulse - dt * 3.2);
    if (this.downbeatPulse > 0) this.downbeatPulse = Math.max(0, this.downbeatPulse - dt * 2.6);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 6);

    const speed = FLY_SPEED * (1 + m * 0.9);
    const totalDepth = SLOT_DEPTH * SLOTS_PER_ROW;
    const beatShake = (this.pulse + this.downbeatPulse) * (0.15 + m * 0.6);

    // --- Towers: advance toward camera; recycle past it to the back.
    for (const tw of this.towers) {
      let z = tw.mesh.position.z + speed * dt;
      if (z > 40) {
        z -= totalDepth;
        const height = 14 + this.rng() * 30;
        const width = 5 + this.rng() * 4;
        const depth = 5 + this.rng() * 4;
        tw.baseColor.set(NEON_TINTS[(this.rng() * NEON_TINTS.length) | 0]);
        tw.mesh.scale.set(width, height, depth);
        const map = tw.mat.map!;
        map.repeat.set(Math.max(1, Math.round(width / 3)), Math.max(2, Math.round(height / 4)));
      }

      // Beat shake: small lateral/vertical jitter, stronger with morph.
      const ph = this.t * 30 + tw.shakeSeed;
      const jx = Math.sin(ph) * beatShake;
      const jy = Math.cos(ph * 1.3) * beatShake * 0.5;
      tw.mesh.position.set(
        tw.side * (ROW_OFFSET + tw.mesh.scale.x * 0.1) + jx,
        tw.mesh.scale.y / 2 + jy,
        z,
      );

      // Window gleam pumps on the beat; the city dims + red-shifts as fire wins.
      const gleam = 1 + (this.pulse * 0.35 + this.downbeatPulse * 0.35) * (1 - m * 0.4);
      const dim = 1 - m * 0.55;
      tw.mat.color.setRGB(
        Math.min(1, tw.baseColor.r * gleam * dim + m * 0.25),
        Math.min(1, tw.baseColor.g * gleam * dim),
        Math.min(1, tw.baseColor.b * gleam * dim),
      );
    }

    // --- Sky/ground/fog red-shift as the inferno grows.
    this.skyMat.color.setRGB(1 + m * 0.5, 1 - m * 0.45, 1 - m * 0.7);
    this.groundMat.color.setRGB(1 + m * 0.4, 1 - m * 0.2, 1 - m * 0.3);
    if (this.scene && this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.setRGB(0.04 + m * 0.5, 0.024 + m * 0.04, 0.07);
      this.scene.fog.far = Math.abs(FAR_Z) + 30 - m * 60;
    }
    if (this.scene && this.scene.background instanceof THREE.Color) {
      this.scene.background.setRGB(0.04 + m * 0.45, 0.024 + m * 0.03, Math.max(0, 0.07 - m * 0.04));
    }

    // --- Fires: count/size/spit/color all driven by morph. A few creep in low,
    //     all blaze near morph 1 (more fire than buildings -> all fire).
    const totalFires = this.fires.length;
    const activeCount = Math.round(THREE.MathUtils.lerp(2, totalFires, Math.min(1, m * 1.15)));
    for (let i = 0; i < totalFires; i++) {
      const f = this.fires[i];
      let z = f.sprite.position.z + speed * dt;
      if (z > 35) {
        z -= totalDepth;
        f.baseX = (this.rng() < 0.5 ? -1 : 1) * (STREET_HALF - 1 + this.rng() * (ROW_OFFSET - STREET_HALF));
        f.baseScale = 2.5 + this.rng() * 3.5;
        f.hueSeed = this.rng() * 6.283;
      }
      f.sprite.position.z = z;

      if (f.spit > 0) f.spit = Math.max(0, f.spit - dt * 4.5);

      if (i >= activeCount) {
        f.sprite.scale.set(0.001, 0.001, 1);
        f.mat.opacity = 0;
        continue;
      }

      const grow = THREE.MathUtils.lerp(0.5, 2.2, m);
      const flicker = 0.85 + 0.15 * Math.sin(this.t * 18 + f.hueSeed * 3);
      const spit = f.spit * (0.4 + m * 1.6); // beat spit, stronger with morph
      const w = f.baseScale * grow * flicker * (0.8 + 0.2 * Math.sin(this.t * 9 + f.hueSeed));
      const h = f.baseScale * grow * (1.2 + spit) * flicker;
      f.sprite.scale.set(w, h, 1);

      // Spread inward toward street center as the inferno maxes.
      const inward = THREE.MathUtils.lerp(0, f.baseX * -0.85, m);
      const wanderX = Math.sin(this.t * 1.5 + f.hueSeed) * m * 1.5;
      f.sprite.position.x = f.baseX + inward + wanderX;
      f.sprite.position.y = h * 0.5;

      // Color chaos: orange baseline; beat + morph push cyan/magenta/green
      // tongues through. Lum clamped so emissive bloom doesn't wash to white.
      const chaos = m * (0.4 + this.downbeatPulse * 0.6);
      const hue =
        (0.06 + Math.sin(this.t * 2 + f.hueSeed) * 0.04 + chaos * (0.5 + Math.sin(f.hueSeed * 7) * 0.5) + 1) % 1;
      const lum = 0.5 + this.pulse * 0.12 * m;
      f.mat.color.setHSL(hue, 0.85, Math.min(0.62, lum));
      f.mat.opacity = Math.min(1, 0.65 + m * 0.35 + this.pulse * 0.1);
    }

    // --- Camera fly-through + shudder. eddieShake = hard jolt; high morph adds
    //     a continuous low rumble.
    if (this.camera) {
      const infernoShudder = m * (0.15 + this.downbeatPulse * 0.35);
      const sx = (Math.random() - 0.5) * (this.shake * 2.0 + infernoShudder);
      const sy = (Math.random() - 0.5) * (this.shake * 1.6 + infernoShudder * 0.8);
      const weave = Math.sin(this.t * 0.4) * 1.2 * (1 - m * 0.5);
      this.camera.position.set(weave + sx, this.camBaseY + sy, 30 + (Math.random() - 0.5) * this.shake);
      this.camera.lookAt(weave * 0.3, 6, FAR_Z);
    }
  }

  dispose(): void {
    this.offBeat?.();
    this.offShake?.();
    this.offIntensity?.();
    this.offBeat = undefined;
    this.offShake = undefined;
    this.offIntensity = undefined;

    if (this.scene) {
      this.scene.remove(this.group);
      this.scene.background = this.prevBackground;
      this.scene.fog = this.prevFog;
    }
    this.scene = null;

    // Towers each own a cloned facade texture + material.
    for (const tw of this.towers) {
      (tw.mat.map as THREE.Texture | null)?.dispose();
      tw.mat.dispose();
    }
    this.towers = [];
    // Fires share the one fireTex (disposed below); dispose their materials.
    for (const f of this.fires) f.mat.dispose();
    this.fires = [];

    this.boxGeo.dispose();
    this.fireGeo.dispose();
    this.facadeTex.dispose();
    this.fireTex.dispose();

    this.ground.geometry.dispose();
    (this.groundMat.map as THREE.Texture | null)?.dispose();
    this.groundMat.dispose();
    this.sky.geometry.dispose();
    this.skyTex.dispose();
    this.skyMat.dispose();

    this.camera = null;
  }
}

const def: EddieBackgroundDef = {
  id: "bg01",
  label: "Neon City → Inferno",
  blurb:
    "Endless fly-through of a pixelated neon city that morphs with intensity from calm streets to a screen-filling, beat-spitting inferno.",
  create: () => new Bg01(),
};

export default def;
