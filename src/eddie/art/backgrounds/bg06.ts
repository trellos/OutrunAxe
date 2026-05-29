// bg06 — "Desert Drive -> Rainstorm" — flying forward through a pixel desert at
// dusk that builds into an intense desert RAINSTORM as performance intensity
// climbs. Three.js scene decoration (visuals only, GDD §8).
//
// The camera flies forward down the desert floor; saguaro cactuses and chunky
// pixel ROCK MONUMENTS (mesas / buttes / arches) stream past on both sides and
// recycle front->back so the drive is endless. A gradient desert sky sits behind
// a distant horizon. An eased `morph` (0..1) drives the whole transformation:
//   morph 0  -> calm dusk desert: warm amber/violet sky, dry ground, scenery
//               streaming past, no rain.
//   morph ~  -> storm clouds roll in and darken the sky, rain begins (sparse
//               pixel streaks), the ground turns wet and reflective, wind tilts
//               the rain, occasional lightning on the beat.
//   morph 1  -> torrential chaotic downpour: dense slanted rain, dark roiling
//               sky, frequent lightning bolts on the beat, camera buffeting.
//
// Juice (all three required):
//   eddieBeatPulse  -> rain surge + lightning. Lightning fires on the beat, more
//                      reliably at higher morph (downbeat stronger).
//   eddieShake      -> camera jolt that decays.
//   eddieIntensity  -> stored as target; `morph` eases toward it every frame.
//
// dispose() restores scene.background/fog, disposes every geometry/material/
// texture and unsubscribes all listeners. Bloom-safe (no post-process touched);
// near meshes are frustumCulled=false.

import * as THREE from "three";
import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";
import type { EddieBackgroundDef, EddieBackgroundVariant } from "./types";

const SKY_H = 96; // sky gradient canvas resolution (vertical)
const RAIN_COUNT = 700; // max rain streaks (scaled visible by morph)
const SCENERY_COUNT = 22; // cactus + rock props streaming past
const FAR_Z = -260; // recycle horizon (props spawn here)
const NEAR_Z = 30; // props recycle once they pass this (behind camera)

type PropKind = "cactus" | "mesa" | "butte" | "arch";

interface Prop {
  mesh: THREE.Mesh;
  side: number; // -1 left, +1 right
  baseScale: number;
}

class Bg06 implements EddieBackgroundVariant {
  private scene: THREE.Scene | null = null;
  private group = new THREE.Group();
  private prevBackground: THREE.Scene["background"] = null;
  private prevFog: THREE.Scene["fog"] = null;

  // Sky gradient.
  private skyCanvas!: HTMLCanvasElement;
  private skyCtx!: CanvasRenderingContext2D;
  private skyTex!: THREE.CanvasTexture;
  private skyMat!: THREE.MeshBasicMaterial;
  private skyMesh!: THREE.Mesh;

  // Ground plane (dry -> wet/reflective).
  private groundMat!: THREE.MeshBasicMaterial;
  private groundMesh!: THREE.Mesh;
  private groundCanvas!: HTMLCanvasElement;
  private groundCtx!: CanvasRenderingContext2D;
  private groundTex!: THREE.CanvasTexture;
  private groundScroll = 0;

  // Scenery props (cactus + rock monuments). Shared geometries, disposed once.
  private props: Prop[] = [];
  private cactusTex!: THREE.CanvasTexture;
  private rockTex!: THREE.CanvasTexture;
  private cactusMat!: THREE.MeshBasicMaterial;
  private rockMat!: THREE.MeshBasicMaterial;
  private propGeos: THREE.PlaneGeometry[] = [];

  // Rain (additive line segments via a single LineSegments mesh).
  private rain!: THREE.LineSegments;
  private rainGeo!: THREE.BufferGeometry;
  private rainMat!: THREE.LineBasicMaterial;
  private rainPos!: Float32Array; // 2 verts per streak (head+tail)
  private rainVel!: Float32Array; // per-streak fall velocity (x,y,z)

  // Lightning: a full-screen flash quad + a few jagged bolt line meshes.
  private flashMat!: THREE.MeshBasicMaterial;
  private flashMesh!: THREE.Mesh;
  private flash = 0;
  private boltGeo!: THREE.BufferGeometry;
  private boltMat!: THREE.LineBasicMaterial;
  private bolt!: THREE.LineSegments;
  private boltLife = 0;

  private camera: THREE.PerspectiveCamera | null = null;
  private camBaseY = 14;
  private camBaseZ = 36;

  private offBeat?: () => void;
  private offShake?: () => void;
  private offIntensity?: () => void;

  private morph = 0;
  private morphTarget = 0;
  private beat = 0; // beat pump, decays
  private beatDecay = 4;
  private shake = 0;
  private t = 0;
  private flySpeed = 60; // world units/sec the scenery streams toward camera
  private rngState = 0x1234abcd >>> 0;

  mount(ctx: {
    scene: THREE.Scene;
    camera?: THREE.PerspectiveCamera;
    juice: EventBus<EddieJuiceEvents>;
  }): void {
    this.scene = ctx.scene;
    this.prevBackground = ctx.scene.background;
    this.prevFog = ctx.scene.fog;
    ctx.scene.background = new THREE.Color(0x3a2436);
    ctx.scene.fog = new THREE.Fog(0x3a2436, 60, 240);

    // --- Sky --------------------------------------------------------------
    this.skyCanvas = document.createElement("canvas");
    this.skyCanvas.width = 8;
    this.skyCanvas.height = SKY_H;
    this.skyCtx = this.skyCanvas.getContext("2d")!;
    this.skyTex = new THREE.CanvasTexture(this.skyCanvas);
    this.skyTex.colorSpace = THREE.SRGBColorSpace;
    this.skyTex.magFilter = THREE.LinearFilter;
    this.skyTex.minFilter = THREE.LinearFilter;
    this.skyTex.generateMipmaps = false;
    this.skyMat = new THREE.MeshBasicMaterial({
      map: this.skyTex,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.skyMesh = new THREE.Mesh(new THREE.PlaneGeometry(680, 300), this.skyMat);
    this.skyMesh.position.set(0, 80, -280);
    this.skyMesh.renderOrder = -30;
    this.skyMesh.frustumCulled = false;
    this.group.add(this.skyMesh);

    // --- Ground -----------------------------------------------------------
    this.groundCanvas = document.createElement("canvas");
    this.groundCanvas.width = 64;
    this.groundCanvas.height = 64;
    this.groundCtx = this.groundCanvas.getContext("2d")!;
    this.groundCtx.imageSmoothingEnabled = false;
    this.groundTex = new THREE.CanvasTexture(this.groundCanvas);
    this.groundTex.colorSpace = THREE.SRGBColorSpace;
    this.groundTex.magFilter = THREE.NearestFilter;
    this.groundTex.minFilter = THREE.NearestFilter;
    this.groundTex.generateMipmaps = false;
    this.groundTex.wrapS = THREE.RepeatWrapping;
    this.groundTex.wrapT = THREE.RepeatWrapping;
    this.groundTex.repeat.set(8, 12);
    this.groundMat = new THREE.MeshBasicMaterial({
      map: this.groundTex,
      depthWrite: true,
      fog: true,
    });
    this.groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(400, 420), this.groundMat);
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.position.set(0, 0, -120);
    this.groundMesh.renderOrder = -25;
    this.groundMesh.frustumCulled = false;
    this.group.add(this.groundMesh);

    // --- Scenery textures + materials ------------------------------------
    this.cactusTex = this.buildCactusTexture();
    this.rockTex = this.buildRockTexture();
    this.cactusMat = new THREE.MeshBasicMaterial({
      map: this.cactusTex,
      transparent: true,
      alphaTest: 0.5,
      depthWrite: true,
      fog: true,
    });
    this.rockMat = new THREE.MeshBasicMaterial({
      map: this.rockTex,
      transparent: true,
      alphaTest: 0.5,
      depthWrite: true,
      fog: true,
    });

    // A few shared plane geometries (different aspect ratios for the prop kinds).
    const cactusGeo = new THREE.PlaneGeometry(14, 28);
    const mesaGeo = new THREE.PlaneGeometry(46, 30);
    const butteGeo = new THREE.PlaneGeometry(26, 40);
    const archGeo = new THREE.PlaneGeometry(40, 28);
    this.propGeos = [cactusGeo, mesaGeo, butteGeo, archGeo];

    for (let i = 0; i < SCENERY_COUNT; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const kind = this.pickKind();
      const geo = this.geoFor(kind);
      const mat = kind === "cactus" ? this.cactusMat : this.rockMat;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      const p: Prop = { mesh, side, baseScale: 0.8 + this.rng() * 1.6 };
      this.placeProp(p, FAR_Z + this.rng() * (NEAR_Z - FAR_Z));
      this.group.add(mesh);
      this.props.push(p);
    }

    // --- Rain -------------------------------------------------------------
    this.rainGeo = new THREE.BufferGeometry();
    this.rainPos = new Float32Array(RAIN_COUNT * 2 * 3);
    this.rainVel = new Float32Array(RAIN_COUNT * 3);
    for (let i = 0; i < RAIN_COUNT; i++) {
      this.respawnRain(i, true);
    }
    this.rainGeo.setAttribute("position", new THREE.BufferAttribute(this.rainPos, 3));
    this.rainGeo.setDrawRange(0, 0); // nothing visible until morph rises
    this.rainMat = new THREE.LineBasicMaterial({
      color: 0xaecbe6,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
      fog: true,
      blending: THREE.AdditiveBlending,
    });
    this.rain = new THREE.LineSegments(this.rainGeo, this.rainMat);
    this.rain.frustumCulled = false;
    this.group.add(this.rain);

    // --- Lightning --------------------------------------------------------
    this.flashMat = new THREE.MeshBasicMaterial({
      color: 0xdfe8ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      fog: false,
      blending: THREE.AdditiveBlending,
    });
    this.flashMesh = new THREE.Mesh(new THREE.PlaneGeometry(800, 400), this.flashMat);
    this.flashMesh.position.set(0, 60, -120);
    this.flashMesh.renderOrder = -5;
    this.flashMesh.frustumCulled = false;
    this.group.add(this.flashMesh);

    this.boltGeo = new THREE.BufferGeometry();
    // Up to 16 jagged segments (2 verts each).
    this.boltGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(16 * 2 * 3), 3));
    this.boltGeo.setDrawRange(0, 0);
    this.boltMat = new THREE.LineBasicMaterial({
      color: 0xf2f6ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending,
    });
    this.bolt = new THREE.LineSegments(this.boltGeo, this.boltMat);
    this.bolt.frustumCulled = false;
    this.group.add(this.bolt);

    this.scene.add(this.group);

    if (ctx.camera) {
      this.camera = ctx.camera;
      this.camera.position.set(0, this.camBaseY, this.camBaseZ);
      this.camera.lookAt(0, 8, -120);
    }

    this.paintSky();
    this.paintGround();

    this.offBeat = ctx.juice.on("eddieBeatPulse", (e) => {
      this.beat = Math.max(this.beat, e.downbeat ? 1 : 0.55);
      this.beatDecay = e.downbeat ? 1 / 0.3 : 1 / 0.18;
      // Lightning on the beat: probability climbs with morph; downbeats reliable.
      const chance = this.morph * (e.downbeat ? 1.1 : 0.6);
      if (this.morph > 0.25 && this.rng() < chance) this.strikeLightning(e.downbeat);
    });
    this.offShake = ctx.juice.on("eddieShake", (e) => {
      this.shake = Math.max(this.shake, e.magnitude);
    });
    this.offIntensity = ctx.juice.on("eddieIntensity", (e) => {
      this.morphTarget = Math.max(0, Math.min(1, e.value));
    });
  }

  /** Deterministic xorshift so the scenery layout is stable per mount. */
  private rng(): number {
    let s = this.rngState;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.rngState = s >>> 0;
    return (this.rngState % 100000) / 100000;
  }

  private pickKind(): PropKind {
    const r = this.rng();
    if (r < 0.45) return "cactus";
    if (r < 0.7) return "mesa";
    if (r < 0.88) return "butte";
    return "arch";
  }

  private geoFor(kind: PropKind): THREE.PlaneGeometry {
    switch (kind) {
      case "cactus":
        return this.propGeos[0];
      case "mesa":
        return this.propGeos[1];
      case "butte":
        return this.propGeos[2];
      case "arch":
        return this.propGeos[3];
    }
  }

  /** Position a prop at depth z along its side of the road, sitting on ground. */
  private placeProp(p: Prop, z: number): void {
    const lateral = 26 + this.rng() * 60;
    const geo = p.mesh.geometry as THREE.PlaneGeometry;
    const h = (geo.parameters.height ?? 28) * p.baseScale;
    p.mesh.scale.setScalar(p.baseScale);
    p.mesh.position.set(p.side * lateral, h / 2, z);
    // Billboards face the camera (down +Z), so leave rotation at identity.
    p.mesh.rotation.set(0, 0, 0);
  }

  private respawnRain(i: number, scatter: boolean): void {
    const o = i * 2 * 3;
    const x = (this.rng() - 0.5) * 220;
    const y = scatter ? this.rng() * 140 : 90 + this.rng() * 50;
    const z = -10 - this.rng() * 220;
    // Streak length grows with intent; tail is above the head.
    const len = 6 + this.rng() * 6;
    this.rainPos[o] = x;
    this.rainPos[o + 1] = y;
    this.rainPos[o + 2] = z;
    this.rainPos[o + 3] = x;
    this.rainPos[o + 4] = y + len;
    this.rainPos[o + 5] = z;
    this.rainVel[i * 3] = 0;
    this.rainVel[i * 3 + 1] = -(160 + this.rng() * 120);
    this.rainVel[i * 3 + 2] = 0;
  }

  private strikeLightning(strong: boolean): void {
    this.flash = strong ? 1 : 0.6;
    this.boltLife = 0.14;
    // Build a jagged vertical bolt from a random sky x down to the horizon.
    const pos = this.boltGeo.getAttribute("position") as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const segs = 10 + Math.floor(this.rng() * 6);
    let x = (this.rng() - 0.5) * 160;
    let y = 130;
    const z = -150 - this.rng() * 60;
    const stepY = 130 / segs;
    let v = 0;
    for (let s = 0; s < segs; s++) {
      const nx = x + (this.rng() - 0.5) * 22;
      const ny = y - stepY;
      arr[v++] = x;
      arr[v++] = y;
      arr[v++] = z;
      arr[v++] = nx;
      arr[v++] = ny;
      arr[v++] = z;
      x = nx;
      y = ny;
    }
    pos.needsUpdate = true;
    this.boltGeo.setDrawRange(0, segs * 2);
    this.boltMat.opacity = 1;
  }

  /** Vertical gradient sky: warm dusk -> dark storm as morph rises. */
  private paintSky(): void {
    const ctx = this.skyCtx;
    const m = this.morph;
    const grad = ctx.createLinearGradient(0, 0, 0, SKY_H);
    // Top: deep violet (calm) -> near-black storm.
    const topR = Math.floor(58 - m * 40);
    const topG = Math.floor(30 - m * 22);
    const topB = Math.floor(78 - m * 58);
    // Mid: dusk magenta -> slate storm grey.
    const midR = Math.floor(150 - m * 100);
    const midG = Math.floor(60 - m * 20);
    const midB = Math.floor(110 - m * 60);
    // Horizon: warm amber (calm) -> dim grey-blue (storm).
    const horR = Math.floor(255 - m * 180);
    const horG = Math.floor(150 - m * 90);
    const horB = Math.floor(70 + m * 30);
    grad.addColorStop(0, `rgb(${Math.max(0, topR)},${Math.max(0, topG)},${Math.max(0, topB)})`);
    grad.addColorStop(0.55, `rgb(${Math.max(0, midR)},${Math.max(0, midG)},${Math.max(0, midB)})`);
    grad.addColorStop(1, `rgb(${Math.max(0, horR)},${Math.max(0, horG)},${Math.max(0, horB)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 8, SKY_H);

    // Storm clouds: chunky dark bands rolling across the upper sky with morph.
    if (m > 0.12) {
      const bands = Math.floor(m * 6);
      for (let b = 0; b < bands; b++) {
        const cy = (b * 11 + (this.t * 6) % 11) % (SKY_H * 0.5);
        const shade = Math.floor(30 + b * 6);
        ctx.fillStyle = `rgba(${shade},${shade + 4},${shade + 10},${0.25 + m * 0.5})`;
        ctx.fillRect(0, cy, 8, 3 + Math.floor(m * 3));
      }
    }
    this.skyTex.needsUpdate = true;
  }

  /** Desert floor: dry sandy pixels (calm) -> dark wet/reflective sheen (storm). */
  private paintGround(): void {
    const ctx = this.groundCtx;
    const m = this.morph;
    // Base sand -> wet mud.
    const baseR = Math.floor(150 - m * 110);
    const baseG = Math.floor(110 - m * 80);
    const baseB = Math.floor(70 - m * 30);
    ctx.fillStyle = `rgb(${Math.max(0, baseR)},${Math.max(0, baseG)},${Math.max(0, baseB)})`;
    ctx.fillRect(0, 0, 64, 64);
    // Speckle the sand with pixel grit (fades as it wets down).
    const grit = Math.max(0, 1 - m);
    for (let i = 0; i < 120; i++) {
      const gx = Math.floor(this.rng() * 64);
      const gy = Math.floor(this.rng() * 64);
      const d = this.rng() < 0.5 ? 30 : -25;
      ctx.fillStyle = `rgba(${Math.max(0, baseR + d)},${Math.max(0, baseG + d)},${Math.max(0, baseB + d)},${grit})`;
      ctx.fillRect(gx, gy, 1, 1);
    }
    // Wet reflective highlights: bright cool specks once it's raining.
    if (m > 0.3) {
      const wet = (m - 0.3) / 0.7;
      for (let i = 0; i < 70; i++) {
        const gx = Math.floor(this.rng() * 64);
        const gy = Math.floor(this.rng() * 64);
        ctx.fillStyle = `rgba(140,170,200,${0.15 + wet * 0.5})`;
        ctx.fillRect(gx, gy, 1, 1);
      }
    }
    this.groundTex.needsUpdate = true;
  }

  private buildCactusTexture(): THREE.CanvasTexture {
    const c = document.createElement("canvas");
    c.width = 16;
    c.height = 32;
    const g = c.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, 16, 32);
    g.fillStyle = "#2f7a3a";
    // Trunk.
    g.fillRect(6, 4, 4, 28);
    // Left arm.
    g.fillRect(2, 14, 2, 8);
    g.fillRect(2, 12, 4, 2);
    // Right arm.
    g.fillRect(12, 18, 2, 8);
    g.fillRect(10, 16, 4, 2);
    // Shading column.
    g.fillStyle = "#236030";
    g.fillRect(8, 4, 2, 28);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    return tex;
  }

  private buildRockTexture(): THREE.CanvasTexture {
    // A blocky mesa/butte/arch-ish silhouette with banded strata. Used for all
    // rock kinds — the plane aspect ratio differentiates the shapes.
    const c = document.createElement("canvas");
    c.width = 32;
    c.height = 32;
    const g = c.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, 32, 32);
    // Body.
    g.fillStyle = "#a8543a";
    g.fillRect(3, 6, 26, 26);
    // Flat top notch (mesa cap).
    g.fillStyle = "#bd6748";
    g.fillRect(3, 6, 26, 4);
    // Strata bands.
    g.fillStyle = "#8c4330";
    for (let y = 12; y < 32; y += 5) g.fillRect(3, y, 26, 2);
    // Arch hole (only reads when the plane is wide — harmless otherwise).
    g.clearRect(13, 16, 6, 16);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    return tex;
  }

  update(dt: number, _audioTime: number): void {
    this.t += dt;

    // Ease morph toward target (never snap).
    this.morph += (this.morphTarget - this.morph) * dt * 1.5;
    const m = this.morph;

    if (this.beat > 0) this.beat = Math.max(0, this.beat - dt * this.beatDecay);

    // Fly forward: scenery streams toward camera; speed picks up with storm wind.
    const speed = this.flySpeed * (1 + m * 0.6) + this.beat * 30;
    for (const p of this.props) {
      p.mesh.position.z += speed * dt;
      if (p.mesh.position.z > NEAR_Z) {
        // Recycle to the far horizon as a fresh prop.
        p.baseScale = 0.8 + this.rng() * 1.6;
        this.placeProp(p, FAR_Z - this.rng() * 40);
      }
      // Wind sway grows with morph (rock monuments barely move; cactuses lean).
      const sway = Math.sin(this.t * 3 + p.mesh.position.z * 0.05) * m * 0.12;
      p.mesh.rotation.z = sway * (p.mesh.material === this.cactusMat ? 1 : 0.25);
    }

    // Ground scrolls toward the camera to sell forward motion.
    this.groundScroll = (this.groundScroll + dt * speed * 0.02) % 1;
    this.groundTex.offset.y = -this.groundScroll;

    // Repaint pixel canvases (cheap at this resolution); morph drives their look.
    this.paintSky();
    this.paintGround();
    this.groundMat.color.setRGB(1 - m * 0.2, 1 - m * 0.2, 1 - m * 0.1);

    // --- Rain ----------------------------------------------------------------
    const rainAmt = Math.max(0, (m - 0.18) / 0.82); // starts ~morph 0.18
    const visible = Math.floor(rainAmt * RAIN_COUNT);
    this.rainGeo.setDrawRange(0, visible * 2);
    this.rainMat.opacity = 0.15 + rainAmt * 0.6;
    if (visible > 0) {
      const windX = m * 90 + this.beat * 40; // slant grows with storm + beat
      for (let i = 0; i < visible; i++) {
        const o = i * 2 * 3;
        const vy = this.rainVel[i * 3 + 1] * (1 + this.beat * 0.5);
        // Head.
        this.rainPos[o] += windX * dt;
        this.rainPos[o + 1] += vy * dt;
        // Tail (trails behind by the slant + length).
        this.rainPos[o + 3] += windX * dt;
        this.rainPos[o + 4] += vy * dt;
        if (this.rainPos[o + 1] < 0) this.respawnRain(i, false);
      }
      (this.rainGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    }

    // --- Lightning -----------------------------------------------------------
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 5);
    this.flashMat.opacity = this.flash * 0.55;
    if (this.boltLife > 0) {
      this.boltLife = Math.max(0, this.boltLife - dt);
      this.boltMat.opacity = this.boltLife > 0 ? Math.min(1, this.boltLife / 0.14) : 0;
      if (this.boltLife === 0) this.boltGeo.setDrawRange(0, 0);
    }

    // Scene background + fog track the sky mood (dusk warm -> storm dark).
    const bg = this.scene && this.scene.background instanceof THREE.Color ? this.scene.background : null;
    if (bg) {
      bg.setRGB(
        0.23 - m * 0.17 + this.flash * 0.4,
        0.14 - m * 0.09 + this.flash * 0.42,
        0.21 - m * 0.12 + this.flash * 0.45,
      );
      if (bg.r < 0) bg.r = 0;
      if (bg.g < 0) bg.g = 0;
      if (bg.b < 0) bg.b = 0;
    }
    if (this.scene && this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.setRGB(0.23 - m * 0.17, 0.14 - m * 0.09, 0.21 - m * 0.1);
      if (this.scene.fog.color.r < 0) this.scene.fog.color.r = 0;
      if (this.scene.fog.color.g < 0) this.scene.fog.color.g = 0;
      if (this.scene.fog.color.b < 0) this.scene.fog.color.b = 0;
      this.scene.fog.near = 60 - m * 30;
      this.scene.fog.far = 240 - m * 90;
    }

    // Camera: parked, with forward bob, storm buffeting, and decaying shake.
    if (this.camera) {
      const bob = Math.sin(this.t * 5) * (0.3 + m * 0.5) + this.beat * 1.0;
      const buffet = m * (Math.sin(this.t * 13.0) + Math.sin(this.t * 7.3)) * 1.4;
      let px = buffet;
      let py = this.camBaseY + bob;
      let pz = this.camBaseZ;
      if (this.shake > 0) {
        this.shake = Math.max(0, this.shake - dt * 6);
        const a = this.shake;
        px += (Math.random() - 0.5) * a * 2.2;
        py += (Math.random() - 0.5) * a * 1.8;
        pz += (Math.random() - 0.5) * a;
      }
      this.camera.position.set(px, py, pz);
      this.camera.lookAt(0, 8, -120);
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

    this.skyMesh.geometry.dispose();
    this.skyMat.dispose();
    this.skyTex.dispose();

    this.groundMesh.geometry.dispose();
    this.groundMat.dispose();
    this.groundTex.dispose();

    for (const geo of this.propGeos) geo.dispose();
    this.propGeos = [];
    this.cactusMat.dispose();
    this.rockMat.dispose();
    this.cactusTex.dispose();
    this.rockTex.dispose();
    this.props = [];

    this.rainGeo.dispose();
    this.rainMat.dispose();

    this.flashMesh.geometry.dispose();
    this.flashMat.dispose();
    this.boltGeo.dispose();
    this.boltMat.dispose();

    this.camera = null;
  }
}

const def: EddieBackgroundDef = {
  id: "bg06",
  label: "Desert Drive -> Rainstorm",
  blurb: "Flying through a pixel desert at dusk past saguaros and rock monuments; rising intensity rolls in storm clouds, pours slanting rain on the wet reflective ground, and cracks lightning on the beat into a torrential downpour.",
  create: () => new Bg06(),
};

export default def;
