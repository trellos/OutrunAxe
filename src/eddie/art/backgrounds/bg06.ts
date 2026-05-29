// bg06 — "Palette Skyline / Index Corruption" — the pixel neon-skyline motif
// drawn through a true indexed-color pipeline. The image is composed as a buffer
// of palette INDICES (0..N-1), and a small palette maps each index to an RGB
// color. ONE low-res CanvasTexture (160x100) with NearestFilter renders the
// chunky pixels — classic palette-animation, the way 80s home computers faked
// motion by cycling the color table instead of redrawing pixels.
//
// Glitch flavor: PALETTE-CYCLE / COLOR-INDEX CORRUPTION STROBE. Between beats the
// palette cycles smoothly (neon ramp rotates), animating the skyline with zero
// geometry change. On each eddieBeatPulse a short burst (~120-220ms, downbeat
// stronger) CORRUPTS the color table — entries get scrambled/inverted and whole
// index bands are remapped — strobing the picture into wrong-color chaos, then
// the table heals as the burst decays.
//
// Visuals only (GDD §8): subscribes to eddieBeatPulse (palette corruption) and
// eddieShake (camera jolt), sets+restores scene.background/fog, disposes every
// geometry/material/texture and unsubscribes.

import * as THREE from "three";
import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";
import type { EddieBackgroundDef, EddieBackgroundVariant } from "./types";

const TEX_W = 160;
const TEX_H = 100;

// Base palette (RGB triples). Indices:
// 0-1 sky, 2 ground, 3 building body, 4-7 neon ramp (cycled), 8 window, 9 star.
const BASE_PALETTE: [number, number, number][] = [
  [10, 6, 18], // 0 sky top
  [58, 17, 112], // 1 sky low
  [12, 8, 32], // 2 building body
  [0, 240, 255], // 3 ground neon
  [255, 43, 214], // 4 neon ramp a
  [0, 240, 255], // 5 neon ramp b
  [255, 208, 43], // 6 neon ramp c
  [255, 90, 138], // 7 neon ramp d
  [199, 255, 43], // 8 window
  [223, 230, 255], // 9 star
];
const NEON_RAMP = [4, 5, 6, 7]; // palette entries that rotate during cycle

interface PxBuilding {
  x: number;
  w: number;
  topY: number;
  rampOffset: number; // which neon-ramp slot this building uses
  winSeed: number;
}

class Bg06 implements EddieBackgroundVariant {
  private scene: THREE.Scene | null = null;
  private group = new THREE.Group();
  private prevBackground: THREE.Scene["background"] = null;
  private prevFog: THREE.Scene["fog"] = null;

  private canvas!: HTMLCanvasElement;
  private c2d!: CanvasRenderingContext2D;
  private image!: ImageData;
  private tex!: THREE.CanvasTexture;
  private quad!: THREE.Mesh;
  private quadMat!: THREE.MeshBasicMaterial;

  private indices!: Uint8Array; // TEX_W*TEX_H palette indices (the static art)
  private palette: [number, number, number][] = BASE_PALETTE.map((c) => [...c] as [number, number, number]);

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
  private cyclePhase = 0; // smooth neon-ramp rotation between beats

  mount(ctx: { scene: THREE.Scene; camera?: THREE.PerspectiveCamera; juice: EventBus<EddieJuiceEvents> }): void {
    this.scene = ctx.scene;
    this.prevBackground = ctx.scene.background;
    this.prevFog = ctx.scene.fog;
    ctx.scene.background = new THREE.Color(0x0a0612);
    ctx.scene.fog = null;

    this.canvas = document.createElement("canvas");
    this.canvas.width = TEX_W;
    this.canvas.height = TEX_H;
    this.c2d = this.canvas.getContext("2d")!;
    this.c2d.imageSmoothingEnabled = false;
    this.image = this.c2d.createImageData(TEX_W, TEX_H);

    // Build the static index buffer once.
    this.indices = new Uint8Array(TEX_W * TEX_H);
    this.buildIndexArt();

    this.resolvePalette(0); // initial paint into ImageData
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

  /** Stamp a palette index into the static buffer. */
  private put(x: number, y: number, idx: number): void {
    if (x < 0 || x >= TEX_W || y < 0 || y >= TEX_H) return;
    this.indices[y * TEX_W + x] = idx;
  }

  /** Paint the skyline ONCE as palette indices (never redrawn after this). */
  private buildIndexArt(): void {
    // Sky bands.
    for (let y = 0; y < TEX_H; y++) {
      const idx = y < Math.floor(TEX_H * 0.6) ? 0 : 1;
      for (let x = 0; x < TEX_W; x++) this.indices[y * TEX_W + x] = idx;
    }
    // Stars.
    for (let i = 0; i < 50; i++) {
      this.put(Math.floor(Math.random() * TEX_W), Math.floor(Math.random() * (TEX_H - 30)), 9);
    }
    // Buildings.
    const horizon = TEX_H - 16;
    let cx = -4;
    let idx = 0;
    while (cx < TEX_W) {
      const w = 9 + Math.floor(Math.random() * 17);
      const height = 20 + Math.floor(Math.random() * 48);
      const b: PxBuilding = {
        x: cx,
        w,
        topY: horizon - height,
        rampOffset: idx % NEON_RAMP.length,
        winSeed: Math.floor(Math.random() * 0xffff) || 1,
      };
      this.buildings.push(b);

      const rampIdx = NEON_RAMP[b.rampOffset];
      // Body.
      for (let y = b.topY; y < horizon; y++) {
        for (let x = b.x; x < b.x + w; x++) this.put(x, y, 2);
      }
      // Roofline + side edges in this building's neon-ramp color.
      for (let x = b.x; x < b.x + w; x++) this.put(x, b.topY, rampIdx);
      for (let y = b.topY; y < horizon; y++) {
        this.put(b.x, y, rampIdx);
        this.put(b.x + w - 1, y, rampIdx);
      }
      // Windows (color index 8).
      const r = this.rng(b.winSeed);
      for (let wy = b.topY + 3; wy < horizon - 2; wy += 3) {
        for (let wx = b.x + 2; wx < b.x + w - 1; wx += 3) {
          if (r() < 0.5) this.put(wx, wy, 8);
        }
      }
      cx += w + 1 + Math.floor(Math.random() * 3);
      idx++;
    }
    // Ground neon line (index 3).
    for (let x = 0; x < TEX_W; x++) this.put(x, horizon, 3);
  }

  /** Compute the live palette (cycle + corruption), then blit indices->RGBA. */
  private resolvePalette(g: number): void {
    // Start from base.
    const pal = this.palette;
    for (let i = 0; i < BASE_PALETTE.length; i++) {
      pal[i][0] = BASE_PALETTE[i][0];
      pal[i][1] = BASE_PALETTE[i][1];
      pal[i][2] = BASE_PALETTE[i][2];
    }

    // Smooth cycle: rotate the neon ramp entries by the cycle phase.
    const rot = Math.floor(this.cyclePhase) % NEON_RAMP.length;
    const rotated = NEON_RAMP.map((_, k) => BASE_PALETTE[NEON_RAMP[(k + rot) % NEON_RAMP.length]]);
    for (let k = 0; k < NEON_RAMP.length; k++) {
      const slot = NEON_RAMP[k];
      pal[slot][0] = rotated[k][0];
      pal[slot][1] = rotated[k][1];
      pal[slot][2] = rotated[k][2];
    }

    // Corruption strobe: scramble + invert palette entries proportional to g.
    if (g > 0.04) {
      for (let i = 0; i < pal.length; i++) {
        if (Math.random() < g * 0.7) {
          // Invert this entry, or remap it to a random other entry's color.
          if (Math.random() < 0.5) {
            pal[i][0] = 255 - pal[i][0];
            pal[i][1] = 255 - pal[i][1];
            pal[i][2] = 255 - pal[i][2];
          } else {
            const src = BASE_PALETTE[Math.floor(Math.random() * BASE_PALETTE.length)];
            pal[i][0] = src[0];
            pal[i][1] = src[1];
            pal[i][2] = src[2];
          }
        }
      }
    }

    // Blit index buffer through the palette into the ImageData.
    const data = this.image.data;
    const idxBuf = this.indices;
    for (let p = 0; p < idxBuf.length; p++) {
      const c = pal[idxBuf[p]];
      const o = p * 4;
      data[o] = c[0];
      data[o + 1] = c[1];
      data[o + 2] = c[2];
      data[o + 3] = 255;
    }

    // Index-band remap on a hard strobe: shove a horizontal band's indices to a
    // wrong color by overwriting RGBA rows directly (cheap "color-index tear").
    if (g > 0.3) {
      const bands = 1 + Math.floor(g * 3);
      for (let i = 0; i < bands; i++) {
        const by = Math.floor(Math.random() * TEX_H);
        const bh = Math.min(2 + Math.floor(Math.random() * 6), TEX_H - by);
        const wrong = pal[NEON_RAMP[Math.floor(Math.random() * NEON_RAMP.length)]];
        for (let y = by; y < by + bh; y++) {
          for (let x = 0; x < TEX_W; x++) {
            const o = (y * TEX_W + x) * 4;
            // Only recolor non-sky pixels so the skyline silhouette strobes.
            if (idxBuf[y * TEX_W + x] >= 2) {
              data[o] = wrong[0];
              data[o + 1] = wrong[1];
              data[o + 2] = wrong[2];
            }
          }
        }
      }
    }

    this.c2d.putImageData(this.image, 0, 0);
  }

  update(dt: number, _audioTime: number): void {
    this.t += dt;

    if (this.glitch > 0) this.glitch = Math.max(0, this.glitch - dt * this.glitchDecay);

    // Smooth palette cycle drives the between-beat animation.
    this.cyclePhase += dt * 2.2;

    this.resolvePalette(this.glitch);
    this.tex.needsUpdate = true;

    this.quadMat.color.setScalar(1 + this.glitch * 0.3);

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
  id: "bg06",
  label: "Palette Skyline / Corrupt",
  blurb: "Indexed-color pixel skyline animated by palette cycling — the color table strobes into scrambled, inverted wrong-color chaos on every beat.",
  create: () => new Bg06(),
};

export default def;
