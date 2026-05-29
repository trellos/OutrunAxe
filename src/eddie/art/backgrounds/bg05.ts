// bg05 — "Laserwave Warp" — hyperspace starfield through a neon ring tunnel.
//
// A field of star points + radial streaks warps toward the camera down a series
// of concentric neon rings (Tron-meets-hyperspace). Stars recycle to the far
// plane when they pass the camera; their trails stretch with warp speed. The
// rings pulse-brighten and the warp speed surges on the beat, so the whole
// field lunges forward to the kick.
//
// Visuals only: subscribes to eddieBeatPulse (speed + brightness surge) and
// eddieShake (camera jolt), sets+restores scene.background/fog, disposes every
// geometry/material/texture on teardown.

import * as THREE from "three";
import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";
import type { EddieBackgroundDef, EddieBackgroundVariant } from "./types";

const STAR_COUNT = 900;
const FAR_Z = -700; // spawn plane
const NEAR_Z = 50; // recycle once a star passes this (behind camera)
const SPREAD = 220; // x/y spawn radius
const RING_COUNT = 14;
const BASE_SPEED = 120; // world units/sec at rest
const NEON = [0x00f0ff, 0xff2bd6, 0xffd02b];

class Bg05 implements EddieBackgroundVariant {
  private scene: THREE.Scene | null = null;
  private group = new THREE.Group();
  private prevBackground: THREE.Scene["background"] = null;
  private prevFog: THREE.Scene["fog"] = null;

  // Stars rendered as a LineSegments field: each star is a short streak whose
  // length grows with warp speed. Two vertices per star.
  private stars!: THREE.LineSegments;
  private starGeo!: THREE.BufferGeometry;
  private starMat!: THREE.LineBasicMaterial;
  private starPos!: Float32Array; // 2 verts * 3 = 6 floats per star
  private starCol!: Float32Array;
  private z!: Float32Array; // head z per star
  private vx!: Float32Array; // tiny lateral drift
  private vy!: Float32Array;
  private hue!: Float32Array; // 0..2 index into NEON for color

  private rings: THREE.LineLoop[] = [];
  private ringMats: THREE.LineBasicMaterial[] = [];
  private ringGeo!: THREE.BufferGeometry;

  private core!: THREE.Mesh;
  private coreMat!: THREE.MeshBasicMaterial;
  private coreTex!: THREE.CanvasTexture;

  private camera: THREE.PerspectiveCamera | null = null;
  private camBaseZ = 0;

  private offBeat?: () => void;
  private offShake?: () => void;

  private pulse = 0; // 0..1 decaying speed/brightness surge
  private shake = 0;
  private t = 0;

  private tmpColor = new THREE.Color();

  mount(ctx: { scene: THREE.Scene; camera?: THREE.PerspectiveCamera; juice: EventBus<EddieJuiceEvents> }): void {
    this.scene = ctx.scene;
    this.prevBackground = ctx.scene.background;
    this.prevFog = ctx.scene.fog;
    ctx.scene.background = new THREE.Color(0x03020a);
    ctx.scene.fog = new THREE.Fog(0x03020a, 200, 720);

    // --- Stars.
    this.starPos = new Float32Array(STAR_COUNT * 6);
    this.starCol = new Float32Array(STAR_COUNT * 6);
    this.z = new Float32Array(STAR_COUNT);
    this.vx = new Float32Array(STAR_COUNT);
    this.vy = new Float32Array(STAR_COUNT);
    this.hue = new Float32Array(STAR_COUNT);
    for (let i = 0; i < STAR_COUNT; i++) {
      this.respawnStar(i, true);
    }
    this.starGeo = new THREE.BufferGeometry();
    this.starGeo.setAttribute("position", new THREE.BufferAttribute(this.starPos, 3));
    this.starGeo.setAttribute("color", new THREE.BufferAttribute(this.starCol, 3));
    this.starMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
    });
    this.stars = new THREE.LineSegments(this.starGeo, this.starMat);
    this.stars.renderOrder = -8;
    this.group.add(this.stars);

    // --- Neon rings receding down the tunnel (shared circle geometry, scaled).
    const segs = 64;
    const ringPts: number[] = [];
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      ringPts.push(Math.cos(a), Math.sin(a), 0);
    }
    this.ringGeo = new THREE.BufferGeometry();
    this.ringGeo.setAttribute("position", new THREE.Float32BufferAttribute(ringPts, 3));
    for (let r = 0; r < RING_COUNT; r++) {
      const mat = new THREE.LineBasicMaterial({
        color: NEON[r % NEON.length],
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: true,
      });
      const loop = new THREE.LineLoop(this.ringGeo, mat);
      const radius = 70 + Math.sin(r * 1.3) * 10;
      loop.scale.set(radius, radius, 1);
      loop.position.z = -(r / RING_COUNT) * 700;
      loop.renderOrder = -9;
      this.ringMats.push(mat);
      this.rings.push(loop);
      this.group.add(loop);
    }

    // --- Glowing core at the vanishing point.
    this.coreTex = new THREE.CanvasTexture(this.buildGlow());
    this.coreTex.colorSpace = THREE.SRGBColorSpace;
    this.coreMat = new THREE.MeshBasicMaterial({
      map: this.coreTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.core = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), this.coreMat);
    this.core.position.set(0, 0, FAR_Z + 20);
    this.core.renderOrder = -10;
    this.group.add(this.core);

    ctx.scene.add(this.group);

    if (ctx.camera) {
      this.camera = ctx.camera;
      this.camBaseZ = 60;
      this.camera.position.set(0, 0, this.camBaseZ);
      this.camera.lookAt(0, 0, FAR_Z);
    }

    this.offBeat = ctx.juice.on("eddieBeatPulse", (e) => {
      this.pulse = e.downbeat ? 1 : 0.6;
    });
    this.offShake = ctx.juice.on("eddieShake", (e) => {
      this.shake = Math.max(this.shake, e.magnitude);
    });
  }

  /** Place star `i` at the far plane (or anywhere along z on initial seed). */
  private respawnStar(i: number, seed: boolean): void {
    const ang = Math.random() * Math.PI * 2;
    const rad = 8 + Math.random() * SPREAD;
    const x = Math.cos(ang) * rad;
    const y = Math.sin(ang) * rad;
    this.z[i] = seed ? FAR_Z + Math.random() * (NEAR_Z - FAR_Z) : FAR_Z - Math.random() * 60;
    this.vx[i] = (Math.random() - 0.5) * 2;
    this.vy[i] = (Math.random() - 0.5) * 2;
    this.hue[i] = Math.floor(Math.random() * NEON.length);
    // Head + tail share x/y; tail z is filled in update relative to speed.
    const o = i * 6;
    this.starPos[o] = x;
    this.starPos[o + 1] = y;
    this.starPos[o + 2] = this.z[i];
    this.starPos[o + 3] = x;
    this.starPos[o + 4] = y;
    this.starPos[o + 5] = this.z[i] - 1;
    this.tmpColor.set(NEON[this.hue[i]]);
    for (let k = 0; k < 2; k++) {
      const c = o + k * 3;
      this.starCol[c] = this.tmpColor.r;
      this.starCol[c + 1] = this.tmpColor.g;
      this.starCol[c + 2] = this.tmpColor.b;
    }
  }

  /** Soft additive glow sprite for the core. */
  private buildGlow(): HTMLCanvasElement {
    const cv = document.createElement("canvas");
    cv.width = 128;
    cv.height = 128;
    const g2d = cv.getContext("2d")!;
    const rg = g2d.createRadialGradient(64, 64, 0, 64, 64, 64);
    rg.addColorStop(0, "rgba(255,255,255,0.95)");
    rg.addColorStop(0.25, "rgba(0,240,255,0.8)");
    rg.addColorStop(0.6, "rgba(255,43,214,0.35)");
    rg.addColorStop(1, "rgba(255,43,214,0)");
    g2d.fillStyle = rg;
    g2d.fillRect(0, 0, 128, 128);
    return cv;
  }

  update(dt: number, _audioTime: number): void {
    this.t += dt;

    const speed = BASE_SPEED * (1 + this.pulse * 2.4);
    const trail = 0.4 + this.pulse * 6.0; // seconds-worth of streak length

    const pos = this.starPos;
    for (let i = 0; i < STAR_COUNT; i++) {
      this.z[i] += speed * dt;
      if (this.z[i] > NEAR_Z) {
        this.respawnStar(i, false);
        continue;
      }
      const o = i * 6;
      // Lateral drift accelerates the closer the star gets (parallax feel).
      const depth = (this.z[i] - FAR_Z) / (NEAR_Z - FAR_Z); // 0 far .. 1 near
      pos[o] += this.vx[i] * dt * (1 + depth * 3);
      pos[o + 1] += this.vy[i] * dt * (1 + depth * 3);
      pos[o + 3] = pos[o];
      pos[o + 4] = pos[o + 1];
      // Head is the leading (nearer) point; tail trails behind in +z->-z.
      pos[o + 2] = this.z[i];
      pos[o + 5] = this.z[i] - speed * trail * (0.05 + depth * 0.5) - 1;
    }
    this.starGeo.attributes.position.needsUpdate = true;

    // Beat surge decays.
    if (this.pulse > 0) this.pulse = Math.max(0, this.pulse - dt * 2.4);
    this.starMat.opacity = 0.8 + this.pulse * 0.2;

    // Rings: drift toward camera, recycle to the back, brighten on the beat.
    const ringSpeed = speed * 0.6;
    for (let r = 0; r < this.rings.length; r++) {
      const loop = this.rings[r];
      loop.position.z += ringSpeed * dt;
      if (loop.position.z > NEAR_Z) loop.position.z -= 700;
      loop.rotation.z += dt * (0.2 + (r % 3) * 0.05);
      const base = 0.55 + 0.25 * Math.sin(this.t * 2 + r);
      this.ringMats[r].opacity = base + this.pulse * 0.45;
    }

    // Core flicker + beat bloom.
    this.coreMat.color.setScalar(1 + this.pulse * 0.8);
    this.core.scale.setScalar(1 + this.pulse * 0.5 + Math.sin(this.t * 3) * 0.04);

    // Shake decay + camera jolt; otherwise a gentle roll for motion.
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 6);
      if (this.camera) {
        const m = this.shake;
        this.camera.position.set(
          (Math.random() - 0.5) * m * 2.4,
          (Math.random() - 0.5) * m * 2.0,
          this.camBaseZ + (Math.random() - 0.5) * m,
        );
        this.camera.up.set(0, 1, 0);
        this.camera.lookAt(0, 0, FAR_Z);
      }
    } else if (this.camera) {
      const roll = Math.sin(this.t * 0.4) * 0.06;
      this.camera.position.set(0, 0, this.camBaseZ);
      this.camera.up.set(Math.sin(roll), Math.cos(roll), 0);
      this.camera.lookAt(0, 0, FAR_Z);
    }
  }

  dispose(): void {
    this.offBeat?.();
    this.offShake?.();
    this.offBeat = undefined;
    this.offShake = undefined;

    if (this.scene) {
      this.scene.remove(this.group);
      this.scene.background = this.prevBackground;
      this.scene.fog = this.prevFog;
    }
    this.scene = null;

    if (this.camera) this.camera.up.set(0, 1, 0);

    this.starGeo.dispose();
    this.starMat.dispose();
    this.ringGeo.dispose();
    for (const m of this.ringMats) m.dispose();
    this.ringMats = [];
    this.rings = [];
    this.core.geometry.dispose();
    this.coreMat.dispose();
    this.coreTex.dispose();
    this.camera = null;
  }
}

const def: EddieBackgroundDef = {
  id: "bg05",
  label: "Laserwave Warp",
  blurb: "Hyperspace neon starfield warping through Tron-style rings toward a glowing core — speed and brightness surge forward on every beat.",
  create: () => new Bg05(),
};

export default def;
