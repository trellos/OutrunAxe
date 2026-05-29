// bg02 — "Datamosh City". A pixely Apple-IIgs / retro-computer neon city skyline
// rendered to a LOW-RES CanvasTexture (chunky NearestFilter pixels, limited
// palette) that DATAMOSHES ON THE BEAT: on each eddieBeatPulse the image tears
// into horizontal blocks that shear sideways, smear pixel rows, and drop
// corrupted color blocks — decaying back to a clean pixel image in ~150-220ms.
// Downbeats tear harder.
//
// Visuals only (GDD §8): subscribes eddieBeatPulse (glitch burst) + eddieShake
// (camera jolt). Sets+restores scene.background/fog, disposes every
// geometry/material/texture, unsubscribes.

import * as THREE from "three";
import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";
import type { EddieBackgroundDef, EddieBackgroundVariant } from "./types";

const TEX_W = 192;
const TEX_H = 120;
const PLANE_W = 640;
const PLANE_H = 400;

const NEON = ["#00f0ff", "#ff2bd6", "#ffd02b", "#36e07a", "#ff5a8a"];

class Bg02 implements EddieBackgroundVariant {
  private scene: THREE.Scene | null = null;
  private group = new THREE.Group();
  private prevBackground: THREE.Scene["background"] = null;
  private prevFog: THREE.Scene["fog"] = null;

  private baseCv!: HTMLCanvasElement;
  private base2d!: CanvasRenderingContext2D;
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

  private glitch = 0;
  private shake = 0;
  private t = 0;
  private starSeeds: { x: number; y: number; tw: number }[] = [];

  mount(ctx: { scene: THREE.Scene; camera?: THREE.PerspectiveCamera; juice: EventBus<EddieJuiceEvents> }): void {
    this.scene = ctx.scene;
    this.prevBackground = ctx.scene.background;
    this.prevFog = ctx.scene.fog;
    ctx.scene.background = new THREE.Color(0x070310);
    ctx.scene.fog = null;

    this.baseCv = this.makeCanvas();
    this.base2d = this.baseCv.getContext("2d")!;
    this.dispCv = this.makeCanvas();
    this.disp2d = this.dispCv.getContext("2d")!;

    for (let i = 0; i < 60; i++) {
      this.starSeeds.push({
        x: Math.floor(Math.random() * TEX_W),
        y: Math.floor(Math.random() * (TEX_H * 0.5)),
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

  private drawBaseSkyline(): void {
    const g = this.base2d;
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    const grad = g.createLinearGradient(0, 0, 0, TEX_H);
    grad.addColorStop(0.0, "#03020c");
    grad.addColorStop(0.5, "#12082c");
    grad.addColorStop(0.82, "#2c0b4e");
    grad.addColorStop(1.0, "#4a0d62");
    g.fillStyle = grad;
    g.fillRect(0, 0, TEX_W, TEX_H);

    for (const s of this.starSeeds) {
      const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.t * 2.6 + s.tw));
      g.fillStyle = `rgba(200,255,255,${a.toFixed(3)})`;
      g.fillRect(s.x, s.y, 1, 1);
    }

    this.drawSkylineLayer(g, "#1c0a3a", 8, 12, 0.5, 4242);
    this.drawSkylineLayer(g, null, 14, 22, 1.0, 71755);

    const refl = g.createLinearGradient(0, TEX_H - 16, 0, TEX_H);
    refl.addColorStop(0, "rgba(255,43,214,0.0)");
    refl.addColorStop(1, "rgba(255,43,214,0.22)");
    g.fillStyle = refl;
    g.fillRect(0, TEX_H - 16, TEX_W, 16);
  }

  private drawSkylineLayer(
    g: CanvasRenderingContext2D,
    backFill: string | null,
    minH: number,
    maxH: number,
    bright: number,
    seed0: number,
  ): void {
    const baseY = Math.floor(TEX_H * (backFill ? 0.6 : 0.78));
    let x = -2;
    let i = 0;
    let seed = seed0;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    while (x < TEX_W) {
      const w = 9 + Math.floor(rnd() * 13);
      const h = minH + Math.floor(rnd() * (maxH - minH));
      const topY = baseY - h;
      const color = NEON[i % NEON.length];
      if (backFill) {
        g.fillStyle = backFill;
        g.fillRect(x, topY, w, TEX_H - topY);
      } else {
        g.fillStyle = "#0a0618";
        g.fillRect(x, topY, w, TEX_H - topY);
        g.fillStyle = color;
        g.globalAlpha = bright;
        g.fillRect(x, topY, w, 1);
        // A neon vertical edge stripe (antenna) on some buildings.
        if (rnd() < 0.4) g.fillRect(x + (w >> 1), topY - 3, 1, 4);
        for (let wy = topY + 3; wy < TEX_H - 3; wy += 3) {
          for (let wx = x + 2; wx < x + w - 1; wx += 2) {
            if ((wx + wy * 2 + i) % 4 < 2 && rnd() < 0.55) g.fillRect(wx, wy, 1, 1);
          }
        }
        g.globalAlpha = 1;
      }
      x += w + 1 + Math.floor(rnd() * 3);
      i++;
    }
  }

  update(dt: number, _audioTime: number): void {
    this.t += dt;
    if (this.glitch > 0) this.glitch = Math.max(0, this.glitch - dt * 5.0);

    this.drawBaseSkyline();

    const d = this.disp2d;
    d.globalCompositeOperation = "source-over";
    d.globalAlpha = 1;
    const gl = this.glitch;

    if (gl <= 0.001) {
      d.clearRect(0, 0, TEX_W, TEX_H);
      d.drawImage(this.baseCv, 0, 0);
    } else {
      // Datamosh: slice into horizontal bands and shear each sideways. Some
      // bands get vertically smeared (stretched) for the "frozen p-frame" look.
      d.clearRect(0, 0, TEX_W, TEX_H);
      const bands = 6 + Math.floor(gl * 8);
      const bandH = Math.ceil(TEX_H / bands);
      let seed = (this.t * 1000) | 0;
      const rnd = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
      };
      for (let b = 0; b < bands; b++) {
        const sy = b * bandH;
        const h = Math.min(bandH, TEX_H - sy);
        if (h <= 0) break;
        const shift = Math.round((rnd() - 0.5) * gl * 28);
        const smear = rnd() < gl * 0.4 ? 1 + Math.floor(rnd() * 3) : 1; // vertical stretch
        d.drawImage(this.baseCv, 0, sy, TEX_W, h, shift, sy, TEX_W, h * smear);
        // Wrap the sheared band so the tear edge fills (no black gap).
        if (shift > 0) d.drawImage(this.baseCv, TEX_W - shift, sy, shift, h, 0, sy, shift, h);
        else if (shift < 0) d.drawImage(this.baseCv, 0, sy, -shift, h, TEX_W + shift, sy, -shift, h);
      }
      // Corrupted color blocks dropped over the tear.
      const blocks = Math.floor(gl * 6);
      d.globalCompositeOperation = "lighter";
      for (let k = 0; k < blocks; k++) {
        d.globalAlpha = 0.3 + rnd() * 0.4;
        d.fillStyle = NEON[(rnd() * NEON.length) | 0];
        const bw = 8 + ((rnd() * 30) | 0);
        const bh = 2 + ((rnd() * 5) | 0);
        d.fillRect((rnd() * TEX_W) | 0, (rnd() * TEX_H) | 0, bw, bh);
      }
      d.globalCompositeOperation = "source-over";
      d.globalAlpha = 1;
    }
    this.tex.needsUpdate = true;
    this.mat.color.setScalar(1 + gl * 0.18);

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
  id: "bg02",
  label: "Datamosh City",
  blurb: "Pixely IIgs neon skyline that tears into datamosh block-shear + corrupted color blocks on every beat.",
  create: () => new Bg02(),
};

export default def;
