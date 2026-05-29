// bg01 — "Chroma Crash". A pixely Apple-IIgs / retro-computer neon city skyline
// rendered to a LOW-RES CanvasTexture (chunky NearestFilter pixels, limited
// dithered palette) that GLITCHES ON THE BEAT with RGB channel split / chromatic
// aberration: on each eddieBeatPulse the red & cyan channels shear apart and a
// few index-corruption sparks fire, decaying back to a clean pixel image in
// ~150-200ms. Downbeats hit harder.
//
// Visuals only (GDD §8): subscribes eddieBeatPulse (glitch burst) + eddieShake
// (camera jolt). Sets+restores scene.background/fog, disposes every
// geometry/material/texture, unsubscribes.

import * as THREE from "three";
import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";
import type { EddieBackgroundDef, EddieBackgroundVariant } from "./types";

// Low-res framebuffer (chunky pixels once scaled onto the big quad).
const TEX_W = 192;
const TEX_H = 120;
const PLANE_W = 640;
const PLANE_H = 400;

// Limited palette: IIgs-ish darks + neon accents.
const NEON = ["#ff2bd6", "#00f0ff", "#ffd02b", "#ff5a8a", "#7a3cff"];

class Bg01 implements EddieBackgroundVariant {
  private scene: THREE.Scene | null = null;
  private group = new THREE.Group();
  private prevBackground: THREE.Scene["background"] = null;
  private prevFog: THREE.Scene["fog"] = null;

  // base = clean rendered skyline; channel = single-channel tint scratch;
  // display = per-frame glitched composite backing the texture.
  private baseCv!: HTMLCanvasElement;
  private base2d!: CanvasRenderingContext2D;
  private chanCv!: HTMLCanvasElement;
  private chan2d!: CanvasRenderingContext2D;
  private dispCv!: HTMLCanvasElement;
  private disp2d!: CanvasRenderingContext2D;
  private tex!: THREE.CanvasTexture;
  private mat!: THREE.MeshBasicMaterial;
  private mesh!: THREE.Mesh;

  private camera: THREE.PerspectiveCamera | null = null;
  private camBaseY = 0;
  private camBaseZ = 60;

  private offBeat?: () => void;
  private offShake?: () => void;

  private glitch = 0; // 0..1 decaying glitch burst
  private shake = 0;
  private t = 0;
  private starSeeds: { x: number; y: number; tw: number }[] = [];

  mount(ctx: { scene: THREE.Scene; camera?: THREE.PerspectiveCamera; juice: EventBus<EddieJuiceEvents> }): void {
    this.scene = ctx.scene;
    this.prevBackground = ctx.scene.background;
    this.prevFog = ctx.scene.fog;
    ctx.scene.background = new THREE.Color(0x0a0612);
    ctx.scene.fog = null;

    this.baseCv = this.makeCanvas();
    this.base2d = this.baseCv.getContext("2d")!;
    this.chanCv = this.makeCanvas();
    this.chan2d = this.chanCv.getContext("2d")!;
    this.dispCv = this.makeCanvas();
    this.disp2d = this.dispCv.getContext("2d")!;

    // Twinkle stars (low-res field redrawn each frame).
    for (let i = 0; i < 70; i++) {
      this.starSeeds.push({
        x: Math.floor(Math.random() * TEX_W),
        y: Math.floor(Math.random() * (TEX_H * 0.55)),
        tw: Math.random() * Math.PI * 2,
      });
    }

    this.drawBaseSkyline();
    this.disp2d.drawImage(this.baseCv, 0, 0);

    this.tex = new THREE.CanvasTexture(this.dispCv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, depthWrite: false, depthTest: false, fog: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(PLANE_W, PLANE_H), this.mat);
    this.mesh.position.set(0, 30, -180);
    this.mesh.renderOrder = -20;
    this.group.add(this.mesh);

    ctx.scene.add(this.group);

    if (ctx.camera) {
      this.camera = ctx.camera;
      this.camera.position.set(0, this.camBaseY, this.camBaseZ);
      this.camera.lookAt(0, 30, -180);
    }

    this.offBeat = ctx.juice.on("eddieBeatPulse", (e) => {
      this.glitch = Math.max(this.glitch, e.downbeat ? 1 : 0.6);
    });
    this.offShake = ctx.juice.on("eddieShake", (e) => {
      this.shake = Math.max(this.shake, e.magnitude);
    });
  }

  private makeCanvas(): HTMLCanvasElement {
    const cv = document.createElement("canvas");
    cv.width = TEX_W;
    cv.height = TEX_H;
    return cv;
  }

  // ---- Clean low-res skyline (sky gradient, stars, layered neon buildings).
  private drawBaseSkyline(): void {
    const g = this.base2d;
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    const grad = g.createLinearGradient(0, 0, 0, TEX_H);
    grad.addColorStop(0.0, "#05030f");
    grad.addColorStop(0.5, "#170a35");
    grad.addColorStop(0.82, "#3a0f5e");
    grad.addColorStop(1.0, "#5a1170");
    g.fillStyle = grad;
    g.fillRect(0, 0, TEX_W, TEX_H);

    for (const s of this.starSeeds) {
      const a = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(this.t * 3 + s.tw));
      g.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      g.fillRect(s.x, s.y, 1, 1);
    }

    // Back (dim) then front (bright neon) skyline bands for depth.
    this.drawSkylineLayer(g, "#241046", 7, 11, 0.55, 1337);
    this.drawSkylineLayer(g, null, 13, 19, 1.0, 90210);

    // Waterline glow strip.
    const refl = g.createLinearGradient(0, TEX_H - 14, 0, TEX_H);
    refl.addColorStop(0, "rgba(0,240,255,0.0)");
    refl.addColorStop(1, "rgba(0,240,255,0.22)");
    g.fillStyle = refl;
    g.fillRect(0, TEX_H - 14, TEX_W, 14);
  }

  // backFill non-null = dim silhouette band; null = lit neon front band.
  private drawSkylineLayer(
    g: CanvasRenderingContext2D,
    backFill: string | null,
    minH: number,
    maxH: number,
    bright: number,
    seed0: number,
  ): void {
    const baseY = Math.floor(TEX_H * (backFill ? 0.62 : 0.78));
    let x = -2;
    let i = 0;
    let seed = seed0;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    while (x < TEX_W) {
      const w = 8 + Math.floor(rnd() * 12);
      const h = minH + Math.floor(rnd() * (maxH - minH));
      const topY = baseY - h;
      const color = NEON[i % NEON.length];
      if (backFill) {
        g.fillStyle = backFill;
        g.fillRect(x, topY, w, TEX_H - topY);
      } else {
        g.fillStyle = "#0c0820";
        g.fillRect(x, topY, w, TEX_H - topY);
        g.fillStyle = color;
        g.globalAlpha = bright;
        g.fillRect(x, topY, w, 1); // neon roofline
        for (let wy = topY + 3; wy < TEX_H - 3; wy += 3) {
          for (let wx = x + 1; wx < x + w - 1; wx += 2) {
            if ((wx + wy + i) % 3 === 0 && rnd() < 0.6) g.fillRect(wx, wy, 1, 1);
          }
        }
        g.globalAlpha = 1;
      }
      x += w + 1 + Math.floor(rnd() * 3);
      i++;
    }
  }

  // Draw the base into the channel scratch, tint it to one RGB channel via a
  // "multiply" mask, and return it ready to be screened onto the display.
  private tintChannel(mask: string): HTMLCanvasElement {
    const c = this.chan2d;
    c.globalCompositeOperation = "source-over";
    c.globalAlpha = 1;
    c.clearRect(0, 0, TEX_W, TEX_H);
    c.drawImage(this.baseCv, 0, 0);
    c.globalCompositeOperation = "multiply";
    c.fillStyle = mask;
    c.fillRect(0, 0, TEX_W, TEX_H);
    c.globalCompositeOperation = "source-over";
    return this.chanCv;
  }

  update(dt: number, _audioTime: number): void {
    this.t += dt;
    if (this.glitch > 0) this.glitch = Math.max(0, this.glitch - dt * 5.5);

    this.drawBaseSkyline();

    const d = this.disp2d;
    d.globalCompositeOperation = "source-over";
    d.globalAlpha = 1;
    const gl = this.glitch;

    if (gl <= 0.001) {
      d.clearRect(0, 0, TEX_W, TEX_H);
      d.drawImage(this.baseCv, 0, 0);
    } else {
      // Chromatic aberration: split into R / G / B channel copies, offset each
      // horizontally, and screen them back together with "lighter".
      const off = Math.round(gl * 6);
      const jy = Math.round((Math.random() - 0.5) * gl * 3);
      d.fillStyle = "#000000";
      d.fillRect(0, 0, TEX_W, TEX_H);
      d.globalCompositeOperation = "lighter";
      d.globalAlpha = 1;
      const red = this.tintChannel("#ff0000");
      d.drawImage(red, -off, jy);
      const grn = this.tintChannel("#00ff00");
      d.drawImage(grn, 0, 0);
      const blu = this.tintChannel("#0000ff");
      d.drawImage(blu, off, -jy);

      // Index-corruption sparks: random bright neon pixels.
      const sparks = Math.floor(gl * 18);
      for (let s = 0; s < sparks; s++) {
        d.fillStyle = NEON[(s + ((Math.random() * NEON.length) | 0)) % NEON.length];
        d.fillRect((Math.random() * TEX_W) | 0, (Math.random() * TEX_H) | 0, 1 + ((Math.random() * 2) | 0), 1);
      }
      d.globalCompositeOperation = "source-over";
      d.globalAlpha = 1;
    }
    this.tex.needsUpdate = true;
    this.mat.color.setScalar(1 + gl * 0.2);

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 6);
      if (this.camera) {
        const m = this.shake;
        this.camera.position.set(
          (Math.random() - 0.5) * m * 2.2,
          this.camBaseY + (Math.random() - 0.5) * m * 1.8,
          this.camBaseZ + (Math.random() - 0.5) * m,
        );
        this.camera.lookAt(0, 30, -180);
      }
    } else if (this.camera) {
      this.camera.position.set(0, this.camBaseY, this.camBaseZ);
      this.camera.lookAt(0, 30, -180);
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

    this.mesh.geometry.dispose();
    this.tex.dispose();
    this.mat.dispose();
    this.starSeeds = [];
    this.camera = null;
  }
}

const def: EddieBackgroundDef = {
  id: "bg01",
  label: "Chroma Crash",
  blurb: "Pixely IIgs neon skyline that splits into RGB chromatic aberration + index-corruption sparks on every beat.",
  create: () => new Bg01(),
};

export default def;
