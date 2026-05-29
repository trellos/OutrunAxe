// bg04 — "Vaporwave Plaza → Glitch Meltdown" — a serene low-res vaporwave plaza
// that corrupts into a full datamosh meltdown as performance intensity rises.
//
// The whole scene is ONE low-res CanvasTexture (192x120) drawn with NearestFilter
// onto a fullscreen quad, so it reads as chunky Apple-IIgs pixels. The painted
// scene: a soft pink→cyan gradient sky with a pixel sun, a perspective
// checkerboard floor receding to the horizon, a marble bust/statue on a plinth,
// two palm silhouettes, and a neon grid. That is morph 0 — calm and pretty.
//
// MORPH (eddieIntensity, eased): `morph` rises 0→1 and drives the corruption.
//  - Low: subtle texture tears, a faint sideways jitter, rare chroma fringing.
//  - Mid: the floor checkers warp/swim, the statue starts to shatter into
//    displaced pixel blocks, RGB-split grows, scanlines roll.
//  - High (≈1): full DATAMOSH MELTDOWN — the floor heaves, the statue is
//    shredded into corrupted blocks, heavy RGB-split, block-tear bands yanked
//    sideways, row dropout, the palette inverts/strobes.
// Beat (eddieBeatPulse, downbeat stronger, scaled by morph): a one-shot glitch
// burst layered on top of the steady-state morph corruption.
// Shake (eddieShake): camera jolt that decays.
//
// Visuals only (GDD §8). dispose() restores scene.background/fog, disposes the
// geometry/material/texture, and unsubscribes every listener.

import * as THREE from "three";
import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";
import type { EddieBackgroundDef, EddieBackgroundVariant } from "./types";

const TEX_W = 192;
const TEX_H = 120;

// Vaporwave palette.
const SKY_TOP = "#2a1150";
const SKY_MID = "#7a2a8f";
const SKY_LOW = "#ff7ab0";
const SUN_HI = "#fff2a8";
const SUN_LO = "#ff5a8a";
const GRID_NEON = "#00f0ff";
const FLOOR_A = "#1a0a33";
const FLOOR_B = "#3a1466";
const STATUE_LIGHT = "#e8e2ff";
const STATUE_MID = "#9f97c8";
const STATUE_DARK = "#5a5285";
const PALM = "#160a2a";
const CORRUPT = ["#ff2bd6", "#00f0ff", "#ffd02b", "#c7ff2b"];

const HORIZON_Y = Math.floor(TEX_H * 0.46);

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

  private camera: THREE.PerspectiveCamera | null = null;
  private camBaseY = 30;
  private camBaseZ = 70;

  private offBeat?: () => void;
  private offShake?: () => void;
  private offIntensity?: () => void;

  // Eased morph 0..1 toward target (calm → meltdown).
  private morph = 0;
  private morphTarget = 0;

  private beatGlitch = 0; // one-shot beat burst 0..1, decays fast
  private beatDecay = 6;
  private shake = 0;
  private t = 0;

  // Stable per-statue shatter offsets so corruption looks deliberate, not noisy.
  private statueSeed = (Math.random() * 0xffff) | 1;

  mount(ctx: { scene: THREE.Scene; camera?: THREE.PerspectiveCamera; juice: EventBus<EddieJuiceEvents> }): void {
    this.scene = ctx.scene;
    this.prevBackground = ctx.scene.background;
    this.prevFog = ctx.scene.fog;
    ctx.scene.background = new THREE.Color(0x2a1150);
    ctx.scene.fog = null;

    this.canvas = document.createElement("canvas");
    this.canvas.width = TEX_W;
    this.canvas.height = TEX_H;
    const c2d = this.canvas.getContext("2d");
    if (!c2d) throw new Error("bg04: 2D context unavailable");
    this.c2d = c2d;
    this.c2d.imageSmoothingEnabled = false;

    this.paint();
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;

    this.quadMat = new THREE.MeshBasicMaterial({ map: this.tex, depthWrite: false, depthTest: false, fog: false });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(320, 200), this.quadMat);
    this.quad.position.set(0, 30, -160);
    this.quad.renderOrder = -20;
    this.quad.frustumCulled = false;
    this.group.add(this.quad);
    this.scene.add(this.group);

    if (ctx.camera) {
      this.camera = ctx.camera;
      this.camera.position.set(0, this.camBaseY, this.camBaseZ);
      this.camera.lookAt(0, 30, -160);
    }

    this.offBeat = ctx.juice.on("eddieBeatPulse", (e) => {
      const base = e.downbeat ? 1 : 0.55;
      this.beatGlitch = Math.max(this.beatGlitch, base);
      this.beatDecay = e.downbeat ? 1 / 0.13 : 1 / 0.2;
    });
    this.offShake = ctx.juice.on("eddieShake", (e) => {
      this.shake = Math.max(this.shake, e.magnitude);
    });
    this.offIntensity = ctx.juice.on("eddieIntensity", (e) => {
      this.morphTarget = Math.min(1, Math.max(0, e.value));
    });
  }

  /** Combined corruption level for this frame: steady-state morph + beat burst
   *  (the beat only bites when there is morph to amplify). */
  private corruption(): number {
    return Math.min(1, this.morph + this.beatGlitch * (0.2 + this.morph * 0.8));
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

  /** Repaint the full pixel scene at the current corruption level. */
  private paint(): void {
    const ctx = this.c2d;
    const g = this.corruption();

    this.paintSky();
    this.paintFloor(g);
    this.paintPalms(g);
    this.paintStatue(g);

    // Rolling scanlines; phase jumps with corruption.
    const scanOff = Math.floor(this.t * 6 + g * 30) % 3;
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    for (let y = scanOff; y < TEX_H; y += 3) ctx.fillRect(0, y, TEX_W, 1);

    if (g > 0.03) this.applyGlitch(g);
  }

  private paintSky(): void {
    const ctx = this.c2d;
    // Three-band vaporwave gradient.
    ctx.fillStyle = SKY_TOP;
    ctx.fillRect(0, 0, TEX_W, Math.floor(HORIZON_Y * 0.5));
    ctx.fillStyle = SKY_MID;
    ctx.fillRect(0, Math.floor(HORIZON_Y * 0.5), TEX_W, Math.ceil(HORIZON_Y * 0.5));
    ctx.fillStyle = SKY_LOW;
    ctx.fillRect(0, HORIZON_Y - 4, TEX_W, 4);
    // Dither the band seam.
    ctx.fillStyle = SKY_TOP;
    for (let x = 0; x < TEX_W; x += 2) ctx.fillRect(x, Math.floor(HORIZON_Y * 0.5), 1, 2);

    // Pixel sun with horizontal banding (classic vaporwave sun).
    const sunCx = TEX_W / 2;
    const sunR = 22;
    const sunCy = HORIZON_Y - 2;
    for (let dy = -sunR; dy <= sunR; dy++) {
      const y = sunCy + dy;
      if (y < 0 || y >= HORIZON_Y) continue;
      const halfW = Math.floor(Math.sqrt(Math.max(0, sunR * sunR - dy * dy)));
      if (halfW <= 0) continue;
      // Banded gaps in the lower half.
      if (dy > 0 && (dy % 4 === 0 || dy % 4 === 1)) continue;
      const f = (dy + sunR) / (2 * sunR); // 0 top → 1 bottom
      ctx.fillStyle = f < 0.5 ? SUN_HI : SUN_LO;
      ctx.fillRect(Math.floor(sunCx - halfW), y, halfW * 2, 1);
    }
  }

  /** Perspective checkerboard floor + neon grid; warps/heaves with corruption. */
  private paintFloor(g: number): void {
    const ctx = this.c2d;
    const rows = 26;
    for (let r = 0; r < rows; r++) {
      const f = r / rows; // 0 at horizon, 1 at bottom
      const y0 = HORIZON_Y + Math.floor(f * f * (TEX_H - HORIZON_Y));
      const y1 = HORIZON_Y + Math.floor(((r + 1) / rows) * ((r + 1) / rows) * (TEX_H - HORIZON_Y));
      const rowH = Math.max(1, y1 - y0);
      // Heave: a vertical sinusoidal warp that grows with corruption.
      const heave = Math.round(Math.sin(this.t * 2 + r * 0.6) * g * 6 * f);
      const cellW = 6 + Math.floor(f * 22); // wider cells nearer the camera
      const phase = Math.floor(this.t * 4) % 2; // animate checker scroll
      for (let x = 0; x < TEX_W; x += cellW) {
        const col = Math.floor(x / cellW);
        const lit = (col + r + phase) % 2 === 0;
        // Horizontal swim grows with corruption.
        const swim = Math.round(Math.sin(this.t * 3 + r + col) * g * 5 * f);
        ctx.fillStyle = lit ? FLOOR_B : FLOOR_A;
        ctx.fillRect(x + swim, y0 + heave, cellW, rowH);
      }
      // Neon grid line every row, brightening as corruption pushes it.
      ctx.fillStyle = GRID_NEON;
      ctx.globalAlpha = 0.35 + 0.4 * f + g * 0.2;
      ctx.fillRect(0, y0 + heave, TEX_W, 1);
      ctx.globalAlpha = 1;
    }
    // Vertical vanishing-point grid lines.
    ctx.fillStyle = GRID_NEON;
    ctx.globalAlpha = 0.4;
    const vp = TEX_W / 2;
    for (let i = -6; i <= 6; i++) {
      const bx = vp + i * (TEX_W / 12);
      // Each vertical converges to the vanishing point at the horizon.
      for (let y = HORIZON_Y; y < TEX_H; y += 2) {
        const f = (y - HORIZON_Y) / (TEX_H - HORIZON_Y);
        const x = Math.round(vp + (bx - vp) * (0.15 + f));
        ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  private paintPalms(g: number): void {
    const ctx = this.c2d;
    ctx.fillStyle = PALM;
    // Two simple palm silhouettes flanking the statue.
    for (const px of [Math.floor(TEX_W * 0.16), Math.floor(TEX_W * 0.84)]) {
      const trunkTop = HORIZON_Y - 34;
      // Trunk leans slightly under corruption (wind of the meltdown).
      const lean = Math.round(g * 4 * (px < TEX_W / 2 ? -1 : 1));
      for (let y = trunkTop; y < HORIZON_Y; y++) {
        const f = (y - trunkTop) / (HORIZON_Y - trunkTop);
        ctx.fillRect(px + Math.round(lean * (1 - f)), y, 2, 1);
      }
      // Fronds: a few radiating pixel arcs.
      for (let a = 0; a < 6; a++) {
        const ang = -Math.PI / 2 + (a - 2.5) * 0.5;
        for (let s = 0; s < 12; s++) {
          const fx = px + lean + Math.round(Math.cos(ang) * s);
          const fy = trunkTop + Math.round(Math.sin(ang) * s) + Math.round(s * s * 0.05);
          if (fy >= 0 && fy < HORIZON_Y) ctx.fillRect(fx, fy, 1, 1);
        }
      }
    }
  }

  /** Marble bust on a plinth, centered. Shatters into displaced corrupted blocks
   *  as corruption rises. */
  private paintStatue(g: number): void {
    const ctx = this.c2d;
    const cx = Math.floor(TEX_W / 2);
    const baseY = HORIZON_Y + 18;
    const r = this.rng(this.statueSeed);

    // Plinth.
    ctx.fillStyle = STATUE_DARK;
    ctx.fillRect(cx - 12, baseY, 24, 10);
    ctx.fillStyle = STATUE_MID;
    ctx.fillRect(cx - 12, baseY, 24, 2);

    // Bust column of blocks (head + shoulders) painted as small cells so we can
    // displace individual cells for the shatter.
    const cells: { x: number; y: number; w: number; h: number; shade: string }[] = [];
    // Shoulders.
    cells.push({ x: cx - 10, y: baseY - 10, w: 20, h: 10, shade: STATUE_MID });
    // Neck.
    cells.push({ x: cx - 3, y: baseY - 16, w: 6, h: 6, shade: STATUE_LIGHT });
    // Head.
    cells.push({ x: cx - 7, y: baseY - 32, w: 14, h: 16, shade: STATUE_LIGHT });
    // Brow shadow.
    cells.push({ x: cx - 7, y: baseY - 24, w: 14, h: 2, shade: STATUE_DARK });
    // Hair top.
    cells.push({ x: cx - 8, y: baseY - 34, w: 16, h: 3, shade: STATUE_MID });

    // Subdivide each block into ~3px shatter tiles so corruption can scatter them.
    const tile = 3;
    for (const c of cells) {
      for (let y = c.y; y < c.y + c.h; y += tile) {
        for (let x = c.x; x < c.x + c.w; x += tile) {
          const tw = Math.min(tile, c.x + c.w - x);
          const th = Math.min(tile, c.y + c.h - y);
          let dx = 0;
          let dy = 0;
          let shade = c.shade;
          if (g > 0.04) {
            // Per-frame seeded jitter (the bust crackles/shudders as it shatters);
            // magnitude scales with g so it shreds harder as corruption peaks.
            const j = r();
            const mag = g * 14;
            dx = Math.round((r() - 0.5) * mag);
            dy = Math.round((r() - 0.5) * mag * 0.6);
            // High corruption recolors shattered tiles into glitch hues.
            if (j < g * 0.7) shade = CORRUPT[(r() * CORRUPT.length) | 0];
          }
          ctx.fillStyle = shade;
          ctx.fillRect(x + dx, y + dy, tw, th);
        }
      }
    }
  }

  /** Datamosh corruption overlays: chroma split, block-tear bands, row dropout,
   *  and at high corruption a strobing palette inversion. */
  private applyGlitch(g: number): void {
    const ctx = this.c2d;

    // RGB / chroma split: re-stamp the canvas shifted sideways, additively, so
    // edges fringe cyan/magenta. Magnitude grows with corruption.
    const shift = Math.max(1, Math.round(g * 6));
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.28 * g;
    ctx.drawImage(this.canvas, shift, 0);
    ctx.drawImage(this.canvas, -shift, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;

    // Block-tear bands yanked sideways (the signature datamosh smear).
    const bands = Math.floor(g * 6);
    for (let i = 0; i < bands; i++) {
      const by = Math.floor(Math.random() * TEX_H);
      const bh = Math.min(2 + Math.floor(Math.random() * 8), TEX_H - by);
      if (bh <= 0) continue;
      const dx = Math.round((Math.random() - 0.5) * g * 40);
      try {
        const slice = ctx.getImageData(0, by, TEX_W, bh);
        ctx.putImageData(slice, dx, by);
      } catch {
        // getImageData can throw on tainted canvas; our canvas is clean, but stay
        // defensive so a single bad frame never breaks the run.
      }
    }

    // Row dropout.
    const drops = Math.floor(g * 5);
    for (let i = 0; i < drops; i++) {
      const dy = Math.floor(Math.random() * TEX_H);
      ctx.fillStyle = Math.random() < 0.5 ? "#000000" : CORRUPT[(Math.random() * CORRUPT.length) | 0];
      ctx.globalAlpha = 0.55 * g;
      ctx.fillRect(0, dy, TEX_W, 1);
      ctx.globalAlpha = 1;
    }

    // Full-meltdown strobe: brief inverted-color flashes near g≈1.
    if (g > 0.8 && Math.random() < (g - 0.8) * 3) {
      ctx.globalCompositeOperation = "difference";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, TEX_W, TEX_H);
      ctx.globalCompositeOperation = "source-over";
    }
  }

  update(dt: number, _audioTime: number): void {
    this.t += dt;

    // Ease morph toward target (never snap).
    this.morph += (this.morphTarget - this.morph) * dt * 1.5;
    if (this.beatGlitch > 0) this.beatGlitch = Math.max(0, this.beatGlitch - dt * this.beatDecay);

    this.paint();
    this.tex.needsUpdate = true;

    // Neon blooms a touch brighter as corruption peaks (bloom-safe: emissive map).
    this.quadMat.color.setScalar(1 + this.corruption() * 0.3);

    // Shake decay + camera jolt; otherwise hold the parked shot. Idle drift grows
    // with morph so the meltdown feels unstable even between shakes.
    const drift = this.morph * 1.4;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 6);
    }
    if (this.camera) {
      const m = this.shake + drift;
      if (m > 0.001) {
        this.camera.position.set(
          (Math.random() - 0.5) * m * 2.2,
          this.camBaseY + (Math.random() - 0.5) * m * 1.8,
          this.camBaseZ + (Math.random() - 0.5) * m,
        );
      } else {
        this.camera.position.set(0, this.camBaseY, this.camBaseZ);
      }
      this.camera.lookAt(0, 30, -160);
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

    this.quad.geometry.dispose();
    this.quadMat.dispose();
    this.tex.dispose();
    this.camera = null;
  }
}

const def: EddieBackgroundDef = {
  id: "bg04",
  label: "Vaporwave Plaza → Meltdown",
  blurb: "A serene pixel vaporwave plaza — checkerboard floor, marble bust, palms, neon sun — that datamoshes into a corrupted meltdown as intensity climbs.",
  create: () => new Bg04(),
};

export default def;
