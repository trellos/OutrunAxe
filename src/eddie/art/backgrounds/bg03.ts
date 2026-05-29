// bg03 — "Starfield → Hyperspace → Singularity" — a morphing space dive.
//
// At morph 0: a slow, calm drifting starfield (tiny additive point-streaks) in
// deep space. As the performance-driven `morph` (0..1) rises the camera
// accelerates forward and the stars STRETCH into long warp streaks rushing past
// (hyperspace). Past mid-morph a swirling vortex / black hole forms at the
// vanishing point: stars are dragged into a tightening spiral, a dark event
// horizon grows, and a lensing ring + chromatic chaos intensifies. At morph 1
// it's a full singularity — everything spirals inward into the black core, the
// ring blazes, the field tints chromatic-aberrant red/blue.
//
// Juice contract (all three events handled):
//  - eddieBeatPulse  -> warp-speed surge (downbeat stronger) + a vortex pulse.
//  - eddieShake      -> camera jolt that decays.
//  - eddieIntensity  -> target morph; eased each frame (never snapped).
//
// Visuals only (GDD §8). dispose() restores scene.background/fog, disposes every
// geometry/material/texture, and unsubscribes all listeners.

import * as THREE from "three";
import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";
import type { EddieBackgroundDef, EddieBackgroundVariant } from "./types";

const STAR_COUNT = 1100;
const FAR_Z = -900; // spawn plane
const NEAR_Z = 60; // recycle once a star passes here (behind camera)
const SPREAD = 260; // initial x/y spawn radius
const BASE_SPEED = 18; // drift speed at morph 0
const TOP_SPEED = 520; // warp speed at morph 1
const STAR_TINT = [0x9fd8ff, 0xffffff, 0xffd0f5, 0xc9b8ff];

class Bg03 implements EddieBackgroundVariant {
  private scene: THREE.Scene | null = null;
  private group = new THREE.Group();
  private prevBackground: THREE.Scene["background"] = null;
  private prevFog: THREE.Scene["fog"] = null;

  // Stars as a LineSegments streak field: 2 verts/star, length grows w/ speed.
  private stars!: THREE.LineSegments;
  private starGeo!: THREE.BufferGeometry;
  private starMat!: THREE.LineBasicMaterial;
  private pos!: Float32Array; // 6 floats/star
  private col!: Float32Array;
  private z!: Float32Array; // head z
  private ang!: Float32Array; // current swirl angle
  private rad!: Float32Array; // current radius from axis
  private rad0!: Float32Array; // spawn radius (for respawn)
  private tint!: Uint8Array;

  // Vortex: a dark core disc + a glowing lensing ring at the vanishing point.
  private core!: THREE.Mesh;
  private coreMat!: THREE.MeshBasicMaterial;
  private ring!: THREE.Mesh;
  private ringMat!: THREE.MeshBasicMaterial;
  private ringTex!: THREE.CanvasTexture;
  private ringGeo!: THREE.RingGeometry;

  private camera: THREE.PerspectiveCamera | null = null;
  private camBaseZ = 0;

  private offBeat?: () => void;
  private offShake?: () => void;
  private offIntensity?: () => void;

  private morph = 0;
  private morphTarget = 0;
  private pulse = 0; // warp surge, decays
  private shake = 0;
  private t = 0;

  private tmpColor = new THREE.Color();

  mount(ctx: { scene: THREE.Scene; camera?: THREE.PerspectiveCamera; juice: EventBus<EddieJuiceEvents> }): void {
    this.scene = ctx.scene;
    this.prevBackground = ctx.scene.background;
    this.prevFog = ctx.scene.fog;
    ctx.scene.background = new THREE.Color(0x02010a);
    ctx.scene.fog = new THREE.Fog(0x02010a, 300, 980);

    this.pos = new Float32Array(STAR_COUNT * 6);
    this.col = new Float32Array(STAR_COUNT * 6);
    this.z = new Float32Array(STAR_COUNT);
    this.ang = new Float32Array(STAR_COUNT);
    this.rad = new Float32Array(STAR_COUNT);
    this.rad0 = new Float32Array(STAR_COUNT);
    this.tint = new Uint8Array(STAR_COUNT);
    for (let i = 0; i < STAR_COUNT; i++) this.spawn(i, true);

    this.starGeo = new THREE.BufferGeometry();
    this.starGeo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    this.starGeo.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    this.starMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
    });
    this.stars = new THREE.LineSegments(this.starGeo, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -8;
    this.group.add(this.stars);

    // --- Vortex core: a dark disc that grows as the singularity forms.
    this.coreMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    });
    this.core = new THREE.Mesh(new THREE.CircleGeometry(40, 48), this.coreMat);
    this.core.position.set(0, 0, FAR_Z + 120);
    this.core.frustumCulled = false;
    this.core.renderOrder = -9;
    this.group.add(this.core);

    // --- Lensing ring: an additive glowing accretion ring around the core.
    this.ringTex = new THREE.CanvasTexture(this.buildRingGlow());
    this.ringTex.colorSpace = THREE.SRGBColorSpace;
    this.ringGeo = new THREE.RingGeometry(40, 78, 64);
    this.ringMat = new THREE.MeshBasicMaterial({
      map: this.ringTex,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
    });
    this.ring = new THREE.Mesh(this.ringGeo, this.ringMat);
    this.ring.position.copy(this.core.position);
    this.ring.frustumCulled = false;
    this.ring.renderOrder = -7;
    this.group.add(this.ring);

    ctx.scene.add(this.group);

    if (ctx.camera) {
      this.camera = ctx.camera;
      this.camBaseZ = 80;
      this.camera.position.set(0, 0, this.camBaseZ);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(0, 0, FAR_Z);
    }

    this.offBeat = ctx.juice.on("eddieBeatPulse", (e) => {
      this.pulse = e.downbeat ? 1 : 0.55;
    });
    this.offShake = ctx.juice.on("eddieShake", (e) => {
      this.shake = Math.max(this.shake, e.magnitude);
    });
    this.offIntensity = ctx.juice.on("eddieIntensity", (e) => {
      this.morphTarget = Math.min(1, Math.max(0, e.value));
    });
  }

  /** Place star `i` (seed=true scatters along z on first build). */
  private spawn(i: number, seed: boolean): void {
    const a = Math.random() * Math.PI * 2;
    const r = 6 + Math.random() * SPREAD;
    this.ang[i] = a;
    this.rad[i] = r;
    this.rad0[i] = r;
    this.z[i] = seed ? FAR_Z + Math.random() * (NEAR_Z - FAR_Z) : FAR_Z - Math.random() * 80;
    this.tint[i] = Math.floor(Math.random() * STAR_TINT.length);
    const o = i * 6;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    this.pos[o] = x;
    this.pos[o + 1] = y;
    this.pos[o + 2] = this.z[i];
    this.pos[o + 3] = x;
    this.pos[o + 4] = y;
    this.pos[o + 5] = this.z[i] - 1;
    this.tmpColor.set(STAR_TINT[this.tint[i]]);
    for (let k = 0; k < 2; k++) {
      const c = o + k * 3;
      this.col[c] = this.tmpColor.r;
      this.col[c + 1] = this.tmpColor.g;
      this.col[c + 2] = this.tmpColor.b;
    }
  }

  /** Soft additive accretion-ring sprite (white-hot inner, cyan/magenta outer). */
  private buildRingGlow(): HTMLCanvasElement {
    const cv = document.createElement("canvas");
    cv.width = 128;
    cv.height = 128;
    const g = cv.getContext("2d")!;
    const rg = g.createRadialGradient(64, 64, 30, 64, 64, 64);
    rg.addColorStop(0, "rgba(255,255,255,0)");
    rg.addColorStop(0.45, "rgba(255,255,255,0.95)");
    rg.addColorStop(0.6, "rgba(0,240,255,0.7)");
    rg.addColorStop(0.8, "rgba(255,43,214,0.5)");
    rg.addColorStop(1, "rgba(255,43,214,0)");
    g.fillStyle = rg;
    g.fillRect(0, 0, 128, 128);
    return cv;
  }

  update(dt: number, _audioTime: number): void {
    this.t += dt;

    // EASE morph toward target (never snap).
    this.morph += (this.morphTarget - this.morph) * dt * 1.5;
    const m = this.morph;

    // Forward speed ramps calm->warp; beat adds a surge.
    const speed = this.lerp(BASE_SPEED, TOP_SPEED, m) * (1 + this.pulse * (1.5 + m * 2.5));
    // Streak length grows with speed (calm = near-points; warp = long lines).
    const streak = this.lerp(0.6, 5.5, m) + this.pulse * (1 + m * 5);
    // Swirl: how hard stars are dragged tangentially + pulled inward (vortex).
    const swirl = Math.max(0, (m - 0.45) / 0.55); // 0 until mid-morph, ->1 at end
    const tangential = swirl * (1.2 + this.pulse);
    const pullIn = swirl * (0.5 + this.pulse * 0.6);

    const pos = this.pos;
    for (let i = 0; i < STAR_COUNT; i++) {
      this.z[i] += speed * dt;

      // Vortex drag: rotate around the axis + spiral inward as morph rises.
      this.ang[i] += tangential * dt * (0.5 + (1 - this.rad[i] / (SPREAD + 6)));
      this.rad[i] = Math.max(2, this.rad[i] - pullIn * dt * 60 * (1 - this.rad[i] / (SPREAD + 6) + 0.2));

      // Recycle when the star passes the camera OR gets swallowed by the core.
      if (this.z[i] > NEAR_Z || (swirl > 0.6 && this.rad[i] <= 3 && this.z[i] > FAR_Z + 60)) {
        this.spawn(i, false);
        continue;
      }

      const x = Math.cos(this.ang[i]) * this.rad[i];
      const y = Math.sin(this.ang[i]) * this.rad[i];
      const o = i * 6;
      // Head (nearer) point.
      pos[o] = x;
      pos[o + 1] = y;
      pos[o + 2] = this.z[i];
      // Tail trails behind toward -z; in the vortex it also trails along the
      // spiral so streaks curve into the swirl.
      const tailAng = this.ang[i] - tangential * dt * 4;
      const tailRad = this.rad[i] + pullIn * dt * 30;
      pos[o + 3] = Math.cos(tailAng) * tailRad;
      pos[o + 4] = Math.sin(tailAng) * tailRad;
      pos[o + 5] = this.z[i] - speed * streak * 0.02 - 1;

      // Chromatic chaos at high morph: push tint toward red or blue per-star.
      if (m > 0.5) {
        const base = STAR_TINT[this.tint[i]];
        this.tmpColor.set(base);
        const ab = (m - 0.5) * 2; // 0..1
        if (this.tint[i] % 2 === 0) this.tmpColor.r = Math.min(1, this.tmpColor.r + ab * 0.6);
        else this.tmpColor.b = Math.min(1, this.tmpColor.b + ab * 0.6);
        for (let k = 0; k < 2; k++) {
          const c = o + k * 3;
          this.col[c] = this.tmpColor.r;
          this.col[c + 1] = this.tmpColor.g;
          this.col[c + 2] = this.tmpColor.b;
        }
      }
    }
    this.starGeo.attributes.position.needsUpdate = true;
    if (m > 0.5) this.starGeo.attributes.color.needsUpdate = true;

    // Beat surge decays.
    if (this.pulse > 0) this.pulse = Math.max(0, this.pulse - dt * 2.6);
    this.starMat.opacity = 0.8 + this.pulse * 0.2;

    // Vortex core + ring fade in past mid-morph; ring pulses on the beat.
    const vortex = Math.max(0, (m - 0.45) / 0.55);
    this.coreMat.opacity = vortex * 0.95;
    this.core.scale.setScalar(0.4 + vortex * (1.1 + this.pulse * 0.3));
    this.ringMat.opacity = vortex * (0.85 + this.pulse * 0.15);
    this.ringMat.color.setScalar(1 + this.pulse * 0.6);
    this.ring.scale.setScalar(0.5 + vortex * (1.0 + this.pulse * 0.25) + Math.sin(this.t * 2) * 0.03 * vortex);
    this.ring.rotation.z += dt * (0.4 + vortex * 1.6 + this.pulse);

    // Camera: drifts forward; in the vortex it pulls toward the core and rolls.
    if (this.camera) {
      const roll = vortex * Math.sin(this.t * 0.6) * 0.5 + this.t * vortex * 0.4;
      let px = 0;
      let py = 0;
      let pz = this.camBaseZ - m * 30; // edges slightly closer to the action
      if (this.shake > 0) {
        this.shake = Math.max(0, this.shake - dt * 6);
        const sMag = this.shake;
        px += (Math.random() - 0.5) * sMag * 2.2;
        py += (Math.random() - 0.5) * sMag * 1.8;
        pz += (Math.random() - 0.5) * sMag;
      }
      this.camera.position.set(px, py, pz);
      this.camera.up.set(Math.sin(roll), Math.cos(roll), 0);
      this.camera.lookAt(0, 0, FAR_Z);
    }
  }

  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
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

    if (this.camera) this.camera.up.set(0, 1, 0);

    this.starGeo.dispose();
    this.starMat.dispose();
    this.core.geometry.dispose();
    this.coreMat.dispose();
    this.ringGeo.dispose();
    this.ringMat.dispose();
    this.ringTex.dispose();
    this.camera = null;
  }
}

const def: EddieBackgroundDef = {
  id: "bg03",
  label: "Starfield → Singularity",
  blurb: "A calm drifting starfield that accelerates into screaming hyperspace warp streaks, then collapses into a swirling black-hole singularity with a blazing lensing ring and chromatic chaos as you peak.",
  create: () => new Bg03(),
};

export default def;
