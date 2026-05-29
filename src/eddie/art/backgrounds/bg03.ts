// bg03 — "CRT Rolldown". A pixely Apple-IIgs / retro-computer neon city skyline
// rendered to a LOW-RES CanvasTexture (chunky NearestFilter pixels, limited
// palette) under a constant scanline grille. It GLITCHES ON THE BEAT with a CRT
// vertical-hold ROLL + signal dropout: on each eddieBeatPulse the picture jumps
// vertically and rolls, a bright sync-bar sweeps down, and dropout rows go black
// — decaying back to a clean (still scanlined) image in ~150-220ms. Downbeats
// roll harder.
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

const NEON = ["#ffd02b", "#00f0ff", "#ff2bd6", "#ff5a3c", "#7a3cff"];

class Bg03 implements EddieBackgroundVariant {
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
  private rollPhase = 0; // accumulated vertical roll offset during a burst
  private starSeeds: { x: number; y: number; tw: number }[] = [];

  mount(ctx: { scene: THREE.Scene; camera?: THREE.PerspectiveCamera; juice: EventBus<EddieJuiceEvents> }): void {
    this.scene = ctx.scene;
    this.prevBackground = ctx.scene.background;
    this.prevFog = ctx.scene.fog;
    ctx.scene.background = new THREE.Color(0x080414);
    ctx.scene.fog = null;

    this.baseCv = this.makeCanvas();
    this.base2d = this.baseCv.getContext("2d")!;
    this.dispCv = this.makeCanvas();
    this.disp2d = this.dispCv.getContext("2d")!;

    for (let i = 0; i < 64; i++) {
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
    grad.addColorStop(0.0, "#04020e");
    grad.addColorStop(0.5, "#160a30");
    grad.addColorStop(0.82, "#341058");
    grad.addColorStop(1.0, "#54116c");
    g.fillStyle = grad;
    g.fillRect(0, 0, TEX_W, TEX_H);

    for (const s of this.starSeeds) {
      const a = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(this.t * 2.8 + s.tw));
      g.fillStyle = `rgba(255,250,220,${a.toFixed(3)})`;
      g.fillRect(s.x, s.y, 1, 1);
    }

    this.drawSkylineLayer(g, "#22103e", 7, 11, 0.5, 5151);
    this.drawSkylineLayer(g, null, 13, 20, 1.0, 66393);

    const refl = g.createLinearGradient(0, TEX_H - 14, 0, TEX_H);
    refl.addColorStop(0, "rgba(255,208,43,0.0)");
    refl.addColorStop(1, "rgba(255,208,43,0.2)");
    g.fillStyle = refl;
    g.fillRect(0, TEX_H - 14, TEX_W, 14);
  }

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
        g.fillStyle = "#0b0720";
        g.fillRect(x, topY, w, TEX_H - topY);
        g.fillStyle = color;
        g.globalAlpha = bright;
        g.fillRect(x, topY, w, 1);
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

  // Constant CRT grille: dim every other scanline a touch.
  private drawScanlines(d: CanvasRenderingContext2D): void {
    d.globalCompositeOperation = "source-over";
    d.fillStyle = "rgba(0,0,0,0.28)";
    for (let y = 0; y < TEX_H; y += 2) d.fillRect(0, y, TEX_W, 1);
  }

  update(dt: number, _audioTime: number): void {
    this.t += dt;
    if (this.glitch > 0) this.glitch = Math.max(0, this.glitch - dt * 5.0);

    this.drawBaseSkyline();

    const d = this.disp2d;
    d.globalCompositeOperation = "source-over";
    d.globalAlpha = 1;
    d.clearRect(0, 0, TEX_W, TEX_H);
    const gl = this.glitch;

    if (gl <= 0.001) {
      this.rollPhase = 0;
      d.drawImage(this.baseCv, 0, 0);
    } else {
      // Vertical-hold roll: the picture scrolls downward and wraps. Roll speed
      // scales with the burst so it lurches on the hit then settles.
      this.rollPhase = (this.rollPhase + gl * gl * 220 * dt) % TEX_H;
      const roll = Math.round(this.rollPhase);
      d.drawImage(this.baseCv, 0, roll);
      if (roll > 0) d.drawImage(this.baseCv, 0, roll - TEX_H); // wrap top

      // Bright horizontal sync-bar sweeping with the roll.
      const barY = roll % TEX_H;
      d.globalCompositeOperation = "lighter";
      d.fillStyle = `rgba(255,255,255,${(gl * 0.35).toFixed(3)})`;
      d.fillRect(0, barY, TEX_W, 2 + Math.floor(gl * 3));
      d.globalCompositeOperation = "source-over";

      // Signal dropout: a few full-width black rows.
      const drops = Math.floor(gl * 6);
      d.fillStyle = "#000000";
      for (let k = 0; k < drops; k++) {
        if (Math.random() < gl) d.fillRect(0, (Math.random() * TEX_H) | 0, TEX_W, 1 + ((Math.random() * 2) | 0));
      }
      // Horizontal jitter of the whole frame on strong hits.
      if (gl > 0.5 && Math.random() < gl) {
        const jx = Math.round((Math.random() - 0.5) * gl * 6);
        if (jx !== 0) {
          const snap = d.getImageData(0, 0, TEX_W, TEX_H);
          d.clearRect(0, 0, TEX_W, TEX_H);
          d.putImageData(snap, jx, 0);
        }
      }
    }

    // Constant scanline grille over everything.
    this.drawScanlines(d);
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
  id: "bg03",
  label: "CRT Rolldown",
  blurb: "Pixely IIgs neon skyline under a scanline grille that vertical-hold rolls + drops signal on every beat.",
  create: () => new Bg03(),
};

export default def;
