// fx05 — "Pixel Burst": chunky 8-bit pixel blocks rendered crisp/pixelated that
// scatter out then march to the score in a stepped, retro-arcade "POINTS!" feel.
// A fraction of the blocks are tiny pixel digits (0-9) for extra arcade flavor.
// Pure DOM, no Three.js.
//
// Two-phase motion per block: an outward "scatter" pop (overshoot ease) for the
// first ~30% of life, then a quantized, stair-stepped glide to the score so the
// blocks read as marching pixels rather than smooth tweens. Blocks self-remove
// on arrival; dispose() removes every element + injected <style> and unsubscribes.

import type { EddieParticlesDef, EddieParticlesVariant } from "./types";
import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";

const STYLE_ID = "eddie-fx05-style";
const STEP = 5; // px snap grid — the "marching pixel" cadence
const DIGITS = "0123456789";

interface Block {
  el: HTMLDivElement;
  x0: number;
  y0: number;
  sx: number; // scatter peak position
  sy: number;
  t: number;
  dur: number;
  size: number;
  rot: number; // fixed slight tilt for chunky feel
}

class Fx05 implements EddieParticlesVariant {
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
      this.spawn(e.from.x, e.from.y, Math.max(1, Math.min(40, e.count)), e.color);
    });
  }

  private injectStyle(): void {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = `
.eddie-fx05-block{position:absolute;left:0;top:0;image-rendering:pixelated;
  pointer-events:none;will-change:transform,opacity;
  box-shadow:0 0 0 1px rgba(0,0,0,.45),0 0 8px currentColor;}
.eddie-fx05-digit{position:absolute;left:0;top:0;pointer-events:none;
  font-family:"Courier New",monospace;font-weight:900;line-height:1;
  -webkit-font-smoothing:none;image-rendering:pixelated;
  text-shadow:0 0 6px currentColor,1px 1px 0 rgba(0,0,0,.6);will-change:transform,opacity;}`;
    document.head.appendChild(s);
    this.styleEl = s;
  }

  private spawn(x: number, y: number, count: number, color: string): void {
    if (!this.parent) return;
    const rect = this.parent.getBoundingClientRect();
    const lx = x - rect.left;
    const ly = y - rect.top;
    for (let i = 0; i < count; i++) {
      const isDigit = Math.random() < 0.35;
      const size = isDigit ? 11 + Math.random() * 8 : 6 + Math.floor(Math.random() * 4) * 2;
      const el = document.createElement("div");
      if (isDigit) {
        el.className = "eddie-fx05-digit";
        el.textContent = DIGITS[(Math.random() * 10) | 0];
        el.style.color = color;
        el.style.fontSize = `${size}px`;
      } else {
        el.className = "eddie-fx05-block";
        el.style.background = color;
        el.style.color = color;
        el.style.width = `${size}px`;
        el.style.height = `${size}px`;
      }
      this.parent.appendChild(el);

      // Scatter target: a quantized outward pop, biased upward like an arcade burst.
      const ang = Math.random() * Math.PI * 2;
      const dist = 28 + Math.random() * 70;
      const sx = snap(lx + Math.cos(ang) * dist);
      const sy = snap(ly + Math.sin(ang) * dist - 24);
      this.blocks.push({
        el,
        x0: snap(lx),
        y0: snap(ly),
        sx,
        sy,
        t: 0,
        dur: 0.6 + Math.random() * 0.4,
        size,
        rot: (Math.random() < 0.5 ? -1 : 1) * (Math.random() * 12),
      });
    }
  }

  update(dt: number): void {
    if (!this.parent || !this.resolveScore || this.blocks.length === 0) return;
    const rect = this.parent.getBoundingClientRect();
    const score = this.resolveScore();
    const tx = score.x - rect.left;
    const ty = score.y - rect.top;
    const SCATTER = 0.3; // fraction of life spent popping outward

    for (let i = this.blocks.length - 1; i >= 0; i--) {
      const p = this.blocks[i];
      p.t += dt / p.dur;
      if (p.t >= 1) {
        p.el.remove();
        this.blocks.splice(i, 1);
        continue;
      }

      let x: number;
      let y: number;
      let opacity = 1;
      if (p.t < SCATTER) {
        // Phase 1: pop outward with a slight overshoot (back-ease out).
        const k = p.t / SCATTER;
        const o = backOut(k);
        x = p.x0 + (p.sx - p.x0) * o;
        y = p.y0 + (p.sy - p.y0) * o;
      } else {
        // Phase 2: stair-step march from scatter peak to the score.
        const k = (p.t - SCATTER) / (1 - SCATTER);
        const e = k * k * (3 - 2 * k); // smoothstep
        x = p.sx + (tx - p.sx) * e;
        y = p.sy + (ty - p.sy) * e;
        if (k > 0.8) opacity = (1 - k) / 0.2;
      }

      // Quantize to the pixel grid so motion reads as discrete arcade steps.
      const qx = snap(x);
      const qy = snap(y);
      const scale = p.t < SCATTER ? 1 : 1 - (p.t - SCATTER) * 0.4;
      p.el.style.transform =
        `translate(${qx}px,${qy}px) translate(-50%,-50%) rotate(${p.rot}deg) scale(${scale})`;
      p.el.style.opacity = `${opacity}`;
    }
  }

  dispose(): void {
    this.off?.();
    this.off = undefined;
    for (const p of this.blocks) p.el.remove();
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

function backOut(k: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const m = k - 1;
  return 1 + c3 * m * m * m + c1 * m * m;
}

const def: EddieParticlesDef = {
  id: "fx05",
  label: "Pixel Burst",
  blurb: "Chunky 8-bit blocks and tiny pixel digits scatter then stair-step march to the score in a crisp retro-arcade pop.",
  create: () => new Fx05(),
};

export default def;
