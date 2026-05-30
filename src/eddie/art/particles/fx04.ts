// fx04 — "Glitch Confetti": glitch-corrupted chunky pixel blocks that burst,
// tumble, and march to the score with RGB-split ghosts, position tearing, and
// dropout flicker. Apple IIgs direction — limited retro palette, crisp pixels,
// motion quantized to a pixel grid. Pure DOM, no Three.js.
//
// Each block carries two cyan/magenta "ghost" copies offset along a per-frame
// jitter axis (chromatic aberration). En route the block randomly "tears"
// (horizontal position glitch) and "drops out" (brief invisibility). Blocks
// home cleanly to resolveScore() and self-remove; dispose() removes every
// element + the injected <style> and unsubscribes.

import type { EddieParticlesDef, EddieParticlesVariant } from "./types";
import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";

const STYLE_ID = "eddie-fx04-style";
const STEP = 4; // px snap grid — chunky pixel cadence
// Limited Apple IIgs-ish retro palette used regardless of the event color so the
// glitch reads as a coherent corrupted set.
const PALETTE = ["#ffffff", "#ff5fa2", "#5fd0ff", "#ffe65f", "#9b5fff", "#5fff8f"];

interface Block {
  el: HTMLDivElement;
  rGhost: HTMLDivElement; // cyan-ish chroma ghost
  bGhost: HTMLDivElement; // magenta-ish chroma ghost
  x0: number;
  y0: number;
  cx: number;
  cy: number;
  t: number;
  dur: number;
  size: number;
  rot: number;
  spin: number;
  tearUntil: number; // t at which an active tear ends
  tearDx: number;
}

class Fx04 implements EddieParticlesVariant {
  private parent: HTMLElement | null = null;
  private resolveScore: (() => { x: number; y: number }) | null = null;
  private blocks: Block[] = [];
  private off?: () => void;
  private styleEl?: HTMLStyleElement;

  mount(ctx: {
    hudParent: HTMLElement;
    juice: EventBus<EddieJuiceEvents>;
    resolveScore: () => { x: number; y: number };
  }): void {
    this.parent = ctx.hudParent;
    this.resolveScore = ctx.resolveScore;
    this.injectStyle();
    this.off = ctx.juice.on("eddieParticles", (e) => {
      this.spawn(e.from.x, e.from.y, Math.max(1, Math.min(40, e.count)));
    });
  }

  private injectStyle(): void {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = `
.eddie-fx04-blk{position:absolute;left:0;top:0;image-rendering:pixelated;
  pointer-events:none;will-change:transform,opacity;
  box-shadow:0 0 0 1px rgba(0,0,0,.5);}
.eddie-fx04-ghost{position:absolute;left:0;top:0;image-rendering:pixelated;
  pointer-events:none;mix-blend-mode:screen;will-change:transform,opacity;opacity:.6;}`;
    document.head.appendChild(s);
    this.styleEl = s;
  }

  private spawn(x: number, y: number, count: number): void {
    if (!this.parent) return;
    const rect = this.parent.getBoundingClientRect();
    const lx = x - rect.left;
    const ly = y - rect.top;
    for (let i = 0; i < count; i++) {
      const size = 6 + Math.floor(Math.random() * 4) * 2; // 6,8,10,12 — chunky
      const color = PALETTE[(Math.random() * PALETTE.length) | 0];

      const el = document.createElement("div");
      el.className = "eddie-fx04-blk";
      el.style.background = color;
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;

      const rGhost = document.createElement("div");
      rGhost.className = "eddie-fx04-ghost";
      rGhost.style.background = "#00ffe0";
      rGhost.style.width = `${size}px`;
      rGhost.style.height = `${size}px`;

      const bGhost = document.createElement("div");
      bGhost.className = "eddie-fx04-ghost";
      bGhost.style.background = "#ff00c8";
      bGhost.style.width = `${size}px`;
      bGhost.style.height = `${size}px`;

      this.parent.appendChild(rGhost);
      this.parent.appendChild(bGhost);
      this.parent.appendChild(el);

      // Flung control point — outward + upward for a confetti burst arc.
      const cx = lx + (Math.random() - 0.5) * 200;
      const cy = ly - 50 - Math.random() * 150;
      this.blocks.push({
        el,
        rGhost,
        bGhost,
        x0: snap(lx + (Math.random() - 0.5) * 30),
        y0: snap(ly + (Math.random() - 0.5) * 30),
        cx,
        cy,
        t: 0,
        dur: 0.6 + Math.random() * 0.45,
        size,
        rot: Math.random() * 360,
        spin: (Math.random() < 0.5 ? -1 : 1) * (240 + Math.random() * 480),
        tearUntil: 0,
        tearDx: 0,
      });
    }
  }

  update(dt: number): void {
    if (!this.parent || !this.resolveScore || this.blocks.length === 0) return;
    const rect = this.parent.getBoundingClientRect();
    const score = this.resolveScore();
    const tx = score.x - rect.left;
    const ty = score.y - rect.top;

    for (let i = this.blocks.length - 1; i >= 0; i--) {
      const p = this.blocks[i];
      p.t += dt / p.dur;
      p.rot += p.spin * dt;
      if (p.t >= 1) {
        p.el.remove();
        p.rGhost.remove();
        p.bGhost.remove();
        this.blocks.splice(i, 1);
        continue;
      }
      const e = p.t * p.t * (3 - 2 * p.t); // smoothstep ease toward score
      const u = 1 - e;
      let x = u * u * p.x0 + 2 * u * e * p.cx + e * e * tx;
      const y = u * u * p.y0 + 2 * u * e * p.cy + e * e * ty;

      // Horizontal "tearing": occasionally jolt sideways for a few frames.
      if (p.t >= p.tearUntil && Math.random() < 0.05) {
        p.tearUntil = p.t + 0.05;
        p.tearDx = (Math.random() - 0.5) * 24;
      }
      if (p.t < p.tearUntil) x += p.tearDx;

      // Quantize to pixel grid — discrete, marching motion.
      const qx = snap(x);
      const qy = snap(y);

      // Dropout flicker: brief full invisibility, stronger as it nears the score.
      const dropout = Math.random() < 0.06 + e * 0.06;
      const arrive = e < 0.85 ? 1 : (1 - e) / 0.15;
      const scale = 1 - e * 0.4;
      const half = p.size / 2;

      const baseTransform = `translate(${qx - half}px,${qy - half}px) rotate(${p.rot}deg) scale(${scale})`;
      p.el.style.transform = baseTransform;
      p.el.style.opacity = dropout ? "0" : `${arrive}`;

      // Chromatic aberration: split ghosts along a jittered axis, widening with e.
      const split = 2 + e * 5;
      p.rGhost.style.transform =
        `translate(${qx - half - split}px,${qy - half}px) rotate(${p.rot}deg) scale(${scale})`;
      p.bGhost.style.transform =
        `translate(${qx - half + split}px,${qy - half}px) rotate(${p.rot}deg) scale(${scale})`;
      const ghostOp = dropout ? 0 : arrive * 0.6;
      p.rGhost.style.opacity = `${ghostOp}`;
      p.bGhost.style.opacity = `${ghostOp}`;
    }
  }

  dispose(): void {
    this.off?.();
    this.off = undefined;
    for (const p of this.blocks) {
      p.el.remove();
      p.rGhost.remove();
      p.bGhost.remove();
    }
    this.blocks = [];
    this.styleEl?.remove();
    this.styleEl = undefined;
    this.parent = null;
    this.resolveScore = null;
  }
}

function snap(v: number): number {
  return Math.round(v / STEP) * STEP;
}

const def: EddieParticlesDef = {
  id: "fx04",
  label: "Glitch Confetti",
  blurb: "Corrupted IIgs pixel blocks tumble to the score with RGB-split ghosts, sideways tearing, and dropout flicker.",
  create: () => new Fx04(),
};

export default def;
