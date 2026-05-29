// bg04 — "Pixel Skyline / Wireframe Boot" — a pixely retro-computer evolution of
// the old "Neon Skyline" motif. The whole scene is ONE low-res CanvasTexture
// (160x100) rendered with NearestFilter so it shows as chunky, dithered pixels
// on a fullscreen quad — think an Apple IIgs city demo booting up.
//
// Glitch flavor: WIREFRAME-TO-SOLID pixel flicker. Between beats the skyline
// settles into a clean filled-pixel image; on each eddieBeatPulse a short glitch
// burst (~120-220ms, downbeat stronger) tears the image — buildings snap to bare
// wireframe outlines, channels split sideways, scanlines jump, and pixel rows
// drop out — then it re-solidifies as the burst decays.
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

// Limited dithered Apple-IIgs-ish palette + neon accents.
const SKY_TOP = "#0a0612";
const SKY_MID = "#241047";
const SKY_LOW = "#5a1170";
const NEON = ["#ff2bd6", "#00f0ff", "#ffd02b", "#ff5a8a"];

interface PxBuilding {
  x: number; // left edge in texture px
  w: number;
  topY: number; // y of the roofline (smaller = taller)
  neon: number; // index into NEON
  windowSeed: number;
}

class Bg04 implements EddieBackgroundVariant {
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

  private glitch = 0; // 0..1 glitch-burst intensity, decays fast
  private glitchDecay = 6; // per-second decay (set per pulse for 120-220ms)
  private shake = 0;
  private t = 0;
  private starField: { x: number; y: number; c: string }[] = [];

  mount(ctx: { scene: THREE.Scene; camera?: THREE.PerspectiveCamera; juice: EventBus<EddieJuiceEvents> }): void {
    this.scene = ctx.scene;
    this.prevBackground = ctx.scene.background;
    this.prevFog = ctx.scene.fog;
    ctx.scene.background = new THREE.Color(0x0a0612);
    ctx.scene.fog = null;

    // --- Pixel canvas.
    this.canvas = document.createElement("canvas");
    this.canvas.width = TEX_W;
    this.canvas.height = TEX_H;
    this.c2d = this.canvas.getContext("2d")!;
    this.c2d.imageSmoothingEnabled = false;

    // Skyline laid out across the texture width.
    let cx = -6;
    let idx = 0;
    while (cx < TEX_W) {
      const w = 8 + Math.floor(Math.random() * 16);
      const height = 22 + Math.floor(Math.random() * 50);
      this.buildings.push({
        x: cx,
        w,
        topY: TEX_H - 18 - height,
        neon: idx % NEON.length,
        windowSeed: Math.floor(Math.random() * 0xffff) || 1,
      });
      cx += w + 1 + Math.floor(Math.random() * 4);
      idx++;
    }

    // Scattered pixel stars.
    for (let i = 0; i < 60; i++) {
      this.starField.push({
        x: Math.floor(Math.random() * TEX_W),
        y: Math.floor(Math.random() * (TEX_H - 30)),
        c: Math.random() < 0.2 ? "#00f0ff" : "#dfe6ff",
      });
    }

    this.paint(0);
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;

    this.quadMat = new THREE.MeshBasicMaterial({ map: this.tex, depthWrite: false, depthTest: false, fog: false });
    // A plane sized to roughly fill the parked camera's view at z=-160.
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
      // 120ms (downbeat) to ~220ms (offbeat) bursts: decay = 1/seconds.
      this.glitchDecay = e.downbeat ? 1 / 0.12 : 1 / 0.22;
    });
    this.offShake = ctx.juice.on("eddieShake", (e) => {
      this.shake = Math.max(this.shake, e.magnitude);
    });
  }

  /** Tiny xorshift so window patterns are stable per building. */
  private rng(seed: number): () => number {
    let s = seed | 0 || 1;
    return () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return ((s >>> 0) % 1000) / 1000;
    };
  }

  /** Redraw the whole pixel image for this frame at glitch intensity g (0..1). */
  private paint(g: number): void {
    const ctx = this.c2d;

    // --- Sky: 3-band vertical gradient, dithered at the seams for the retro look.
    ctx.fillStyle = SKY_TOP;
    ctx.fillRect(0, 0, TEX_W, Math.floor(TEX_H * 0.45));
    ctx.fillStyle = SKY_MID;
    ctx.fillRect(0, Math.floor(TEX_H * 0.45), TEX_W, Math.floor(TEX_H * 0.3));
    ctx.fillStyle = SKY_LOW;
    ctx.fillRect(0, Math.floor(TEX_H * 0.75), TEX_W, TEX_H);
    // Ordered-dither the band boundaries (checker every other column).
    ctx.fillStyle = SKY_TOP;
    for (let x = 0; x < TEX_W; x += 2) ctx.fillRect(x, Math.floor(TEX_H * 0.45), 1, 2);
    ctx.fillStyle = SKY_MID;
    for (let x = 1; x < TEX_W; x += 2) ctx.fillRect(x, Math.floor(TEX_H * 0.75), 1, 2);

    // --- Stars (twinkle subtly via time).
    for (const s of this.starField) {
      if ((Math.sin(this.t * 3 + s.x) + 1) * 0.5 > 0.35) {
        ctx.fillStyle = s.c;
        ctx.fillRect(s.x, s.y, 1, 1);
      }
    }

    // --- Buildings. Wireframe-to-solid: at high glitch we draw bare outlines;
    // as it settles we fill them solid and add lit windows.
    const solidness = 1 - g; // 1 = fully solid, 0 = pure wireframe
    const horizon = TEX_H - 18;
    for (const b of this.buildings) {
      const neon = NEON[b.neon];
      const bodyY = b.topY;
      const bodyH = horizon - b.topY;

      if (solidness > 0.05) {
        // Solid body: dark fill with a faint neon-tinted face.
        ctx.fillStyle = "#0c0820";
        ctx.fillRect(b.x, bodyY, b.w, bodyH);
        // Neon-tinted vertical light streak down the face, alpha by solidness.
        ctx.globalAlpha = 0.18 * solidness;
        ctx.fillStyle = neon;
        ctx.fillRect(b.x + 1, bodyY, Math.max(1, Math.floor(b.w * 0.5)), bodyH);
        ctx.globalAlpha = 1;
      }

      // Wireframe outline always present; brighter during glitch.
      ctx.fillStyle = neon;
      ctx.globalAlpha = 0.7 + g * 0.3;
      ctx.fillRect(b.x, bodyY, b.w, 1); // top edge
      ctx.fillRect(b.x, bodyY, 1, bodyH); // left edge
      ctx.fillRect(b.x + b.w - 1, bodyY, 1, bodyH); // right edge
      ctx.globalAlpha = 1;

      // Windows only when mostly solid.
      if (solidness > 0.45) {
        const r = this.rng(b.windowSeed);
        ctx.fillStyle = NEON[(b.neon + 1) % NEON.length];
        for (let wy = bodyY + 3; wy < horizon - 2; wy += 3) {
          for (let wx = b.x + 2; wx < b.x + b.w - 1; wx += 3) {
            if (r() < 0.55) continue;
            // Flicker a few windows with time.
            if ((Math.sin(this.t * 8 + wx * 1.3 + wy) + 1) * 0.5 < 0.25) continue;
            ctx.fillRect(wx, wy, 1, 1);
          }
        }
      }
    }

    // --- Ground neon strip at the horizon.
    ctx.fillStyle = "#00f0ff";
    ctx.globalAlpha = 0.5 + g * 0.5;
    ctx.fillRect(0, horizon, TEX_W, 1);
    ctx.globalAlpha = 1;

    // --- Scanlines (jump phase on glitch).
    const scanOff = Math.floor(this.t * 8 + g * 20) % 3;
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    for (let y = scanOff; y < TEX_H; y += 3) ctx.fillRect(0, y, TEX_W, 1);

    // --- Glitch overlays only fire while g > threshold.
    if (g > 0.04) this.applyGlitch(g);
  }

  /** Chroma split, block tear and row dropout drawn over the finished image. */
  private applyGlitch(g: number): void {
    const ctx = this.c2d;
    // Chroma split: additively re-stamp the canvas shifted sideways so edges
    // fringe cyan/magenta (cheap fake of an RGB channel separation).
    const shift = Math.max(1, Math.round(g * 5));
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.3 * g;
    ctx.drawImage(this.canvas, shift, 0);
    ctx.drawImage(this.canvas, -shift, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;

    // Block tear: a few horizontal bands get yanked sideways.
    const bands = 1 + Math.floor(g * 3);
    for (let i = 0; i < bands; i++) {
      const by = Math.floor(Math.random() * TEX_H);
      const bh = Math.min(2 + Math.floor(Math.random() * 6), TEX_H - by);
      if (bh <= 0) continue;
      const dx = Math.round((Math.random() - 0.5) * g * 24);
      const slice = ctx.getImageData(0, by, TEX_W, bh);
      ctx.putImageData(slice, dx, by);
    }

    // Row dropout: a couple of solid dark/neon scan rows.
    const drops = Math.floor(g * 4);
    for (let i = 0; i < drops; i++) {
      const dy = Math.floor(Math.random() * TEX_H);
      ctx.fillStyle = Math.random() < 0.5 ? "#000000" : NEON[Math.floor(Math.random() * NEON.length)];
      ctx.globalAlpha = 0.6 * g;
      ctx.fillRect(0, dy, TEX_W, 1);
      ctx.globalAlpha = 1;
    }
  }

  update(dt: number, _audioTime: number): void {
    this.t += dt;

    if (this.glitch > 0) this.glitch = Math.max(0, this.glitch - dt * this.glitchDecay);

    this.paint(this.glitch);
    this.tex.needsUpdate = true;

    // Material brightens slightly on the burst so the neon blooms.
    this.quadMat.color.setScalar(1 + this.glitch * 0.25);

    // Shake decay + camera jolt; otherwise hold the parked shot.
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
    this.starField = [];
    this.camera = null;
  }
}

const def: EddieBackgroundDef = {
  id: "bg04",
  label: "Pixel Skyline / Boot",
  blurb: "Chunky low-res pixel neon skyline that snaps from solid to bare wireframe with chroma split, block tear and row dropout on every beat.",
  create: () => new Bg04(),
};

export default def;
