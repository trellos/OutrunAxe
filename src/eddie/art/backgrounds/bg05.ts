// bg05 — "VHS Skyline / Tracking Tear" — the pixel neon-skyline motif rendered
// like a worn VHS dub. ONE low-res CanvasTexture (160x100) with NearestFilter so
// it reads as chunky pixels; the skyline sits behind a constant warm grain and a
// rolling tracking band, in a limited washed-out palette.
//
// Glitch flavor: VHS TRACKING-TEAR + CHROMA BLEED. Between beats the picture is
// stable apart from a slow rolling tracking bar. On each eddieBeatPulse a short
// burst (~120-220ms, downbeat stronger) snaps the tape out of sync: the tracking
// bar jumps and widens, horizontal scanlines tear and smear sideways, and the
// chroma (cyan/magenta) bleeds heavily off the building edges, then re-locks as
// the burst decays.
//
// Visuals only (GDD §8): subscribes to eddieBeatPulse (glitch burst) and
// eddieShake (camera jolt), sets+restores scene.background/fog, disposes every
// geometry/material/texture and unsubscribes.

import * as THREE from "three";
import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";
import type { EddieBackgroundDef, EddieBackgroundVariant } from "./types";

const TEX_W = 160;
const TEX_H = 100;

// Washed VHS palette + neon accents that survive the wash.
const SKY_TOP = "#120a24";
const SKY_LOW = "#3a1a52";
const NEON = ["#ff5ad6", "#3ef0ff", "#ffe05a"];

interface PxBuilding {
  x: number;
  w: number;
  topY: number;
  neon: number;
  winSeed: number;
}

class Bg05 implements EddieBackgroundVariant {
  private scene: THREE.Scene | null = null;
  private group = new THREE.Group();
  private prevBackground: THREE.Scene["background"] = null;
  private prevFog: THREE.Scene["fog"] = null;

  private canvas!: HTMLCanvasElement;
  private c2d!: CanvasRenderingContext2D;
  private tex!: THREE.CanvasTexture;
  private quad!: THREE.Mesh;
  private quadMat!: THREE.MeshBasicMaterial;

  private buildings: PxBuilding[] = [];

  private camera: THREE.PerspectiveCamera | null = null;
  private camBaseY = 0;
  private camBaseZ = 0;

  private offBeat?: () => void;
  private offShake?: () => void;

  private glitch = 0;
  private glitchDecay = 6;
  private shake = 0;
  private t = 0;
  private trackY = 0.4; // 0..1 rolling tracking-bar position
  private trackRollSpeed = 0.06;

  mount(ctx: { scene: THREE.Scene; camera?: THREE.PerspectiveCamera; juice: EventBus<EddieJuiceEvents> }): void {
    this.scene = ctx.scene;
    this.prevBackground = ctx.scene.background;
    this.prevFog = ctx.scene.fog;
    ctx.scene.background = new THREE.Color(0x07040f);
    ctx.scene.fog = null;

    this.canvas = document.createElement("canvas");
    this.canvas.width = TEX_W;
    this.canvas.height = TEX_H;
    this.c2d = this.canvas.getContext("2d")!;
    this.c2d.imageSmoothingEnabled = false;

    let cx = -4;
    let idx = 0;
    while (cx < TEX_W) {
      const w = 10 + Math.floor(Math.random() * 18);
      const height = 18 + Math.floor(Math.random() * 46);
      this.buildings.push({
        x: cx,
        w,
        topY: TEX_H - 16 - height,
        neon: idx % NEON.length,
        winSeed: Math.floor(Math.random() * 0xffff) || 1,
      });
      cx += w + 1 + Math.floor(Math.random() * 3);
      idx++;
    }

    this.paint(0);
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;

    this.quadMat = new THREE.MeshBasicMaterial({ map: this.tex, depthWrite: false, depthTest: false, fog: false });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(320, 200), this.quadMat);
    this.quad.position.set(0, 30, -160);
    this.quad.renderOrder = -20;
    this.group.add(this.quad);

    ctx.scene.add(this.group);

    if (ctx.camera) {
      this.camera = ctx.camera;
      this.camBaseY = 30;
      this.camBaseZ = 70;
      this.camera.position.set(0, this.camBaseY, this.camBaseZ);
      this.camera.lookAt(0, 30, -160);
    }

    this.offBeat = ctx.juice.on("eddieBeatPulse", (e) => {
      this.glitch = e.downbeat ? 1 : 0.6;
      this.glitchDecay = e.downbeat ? 1 / 0.12 : 1 / 0.22;
      // A beat knocks the tracking bar to a fresh position — tape jumps.
      this.trackY = Math.random();
    });
    this.offShake = ctx.juice.on("eddieShake", (e) => {
      this.shake = Math.max(this.shake, e.magnitude);
    });
  }

  private rng(seed: number): () => number {
    let s = seed | 0 || 1;
    return () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return ((s >>> 0) % 1000) / 1000;
    };
  }

  private paint(g: number): void {
    const ctx = this.c2d;
    const horizon = TEX_H - 16;

    // --- Sky: 2-band wash with horizontal grain lines.
    ctx.fillStyle = SKY_TOP;
    ctx.fillRect(0, 0, TEX_W, Math.floor(TEX_H * 0.6));
    ctx.fillStyle = SKY_LOW;
    ctx.fillRect(0, Math.floor(TEX_H * 0.6), TEX_W, TEX_H);

    // --- Buildings, solid with bled neon edges (chroma bleed grows with g).
    const bleed = 1 + Math.round(g * 3);
    for (const b of this.buildings) {
      const neon = NEON[b.neon];
      const bodyY = b.topY;
      const bodyH = horizon - b.topY;

      ctx.fillStyle = "#0e0a1e";
      ctx.fillRect(b.x, bodyY, b.w, bodyH);

      // Chroma bleed: cyan edge shifted left, magenta edge shifted right.
      ctx.globalAlpha = 0.5 + g * 0.4;
      ctx.fillStyle = "#3ef0ff";
      ctx.fillRect(b.x - bleed, bodyY, 1, bodyH);
      ctx.fillStyle = "#ff5ad6";
      ctx.fillRect(b.x + b.w - 1 + bleed, bodyY, 1, bodyH);
      ctx.globalAlpha = 1;

      // Crisp roofline neon.
      ctx.fillStyle = neon;
      ctx.fillRect(b.x, bodyY, b.w, 1);

      // Windows.
      const r = this.rng(b.winSeed);
      ctx.fillStyle = NEON[(b.neon + 1) % NEON.length];
      for (let wy = bodyY + 3; wy < horizon - 2; wy += 3) {
        for (let wx = b.x + 2; wx < b.x + b.w - 1; wx += 3) {
          if (r() < 0.5) continue;
          if ((Math.sin(this.t * 6 + wx + wy * 0.7) + 1) * 0.5 < 0.3) continue;
          ctx.fillRect(wx, wy, 1, 1);
        }
      }
    }

    // --- Ground line.
    ctx.fillStyle = "#3ef0ff";
    ctx.fillRect(0, horizon, TEX_W, 1);

    // --- Constant warm tape grain.
    const grainCount = 220 + Math.floor(g * 400);
    for (let i = 0; i < grainCount; i++) {
      const gx = Math.floor(Math.random() * TEX_W);
      const gy = Math.floor(Math.random() * TEX_H);
      const v = 160 + Math.floor(Math.random() * 95);
      ctx.fillStyle = `rgba(${v},${v},${Math.floor(v * 0.85)},0.18)`;
      ctx.fillRect(gx, gy, 1, 1);
    }

    // --- Scanlines.
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    for (let y = 0; y < TEX_H; y += 2) ctx.fillRect(0, y, TEX_W, 1);

    // --- Rolling tracking bar: a washed, noisy strip; widens on glitch.
    const barH = 3 + Math.floor(g * 9);
    const barTop = Math.floor(this.trackY * TEX_H);
    for (let y = barTop; y < Math.min(barTop + barH, TEX_H); y++) {
      // Brighten + desaturate the band.
      ctx.fillStyle = "rgba(220,220,210,0.35)";
      ctx.fillRect(0, y, TEX_W, 1);
      // Sideways smear of the row content.
      const dx = Math.round((Math.random() - 0.5) * (4 + g * 20));
      const slice = ctx.getImageData(0, y, TEX_W, 1);
      ctx.putImageData(slice, dx, y);
    }

    // --- Beat tear: extra torn scanlines smeared hard sideways while g high.
    if (g > 0.04) this.applyTear(g);
  }

  /** Hard horizontal tearing + chroma re-stamp during the beat burst. */
  private applyTear(g: number): void {
    const ctx = this.c2d;
    const tears = 2 + Math.floor(g * 5);
    for (let i = 0; i < tears; i++) {
      const ty = Math.floor(Math.random() * TEX_H);
      const th = Math.min(1 + Math.floor(Math.random() * 4), TEX_H - ty);
      if (th <= 0) continue;
      const dx = Math.round((Math.random() - 0.5) * g * 30);
      const slice = ctx.getImageData(0, ty, TEX_W, th);
      ctx.putImageData(slice, dx, ty);
    }
    // Whole-frame chroma bleed: additive shifted copies.
    const shift = Math.max(1, Math.round(g * 4));
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.22 * g;
    ctx.drawImage(this.canvas, shift, 0);
    ctx.drawImage(this.canvas, -shift, 1);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }

  update(dt: number, _audioTime: number): void {
    this.t += dt;

    if (this.glitch > 0) this.glitch = Math.max(0, this.glitch - dt * this.glitchDecay);

    // Tracking bar rolls slowly upward between jumps.
    this.trackY = (this.trackY - this.trackRollSpeed * dt + 1) % 1;

    this.paint(this.glitch);
    this.tex.needsUpdate = true;

    this.quadMat.color.setScalar(1 + this.glitch * 0.2);

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 6);
      if (this.camera) {
        const m = this.shake;
        this.camera.position.set(
          (Math.random() - 0.5) * m * 2.2,
          this.camBaseY + (Math.random() - 0.5) * m * 1.8,
          this.camBaseZ + (Math.random() - 0.5) * m,
        );
        this.camera.lookAt(0, 30, -160);
      }
    } else if (this.camera) {
      this.camera.position.set(0, this.camBaseY, this.camBaseZ);
      this.camera.lookAt(0, 30, -160);
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

    this.quad.geometry.dispose();
    this.quadMat.dispose();
    this.tex.dispose();
    this.buildings = [];
    this.camera = null;
  }
}

const def: EddieBackgroundDef = {
  id: "bg05",
  label: "VHS Skyline / Tracking",
  blurb: "Washed-out pixel neon skyline on worn tape — rolling tracking bar plus hard scanline tear and chroma bleed snap out of sync on every beat.",
  create: () => new Bg05(),
};

export default def;
