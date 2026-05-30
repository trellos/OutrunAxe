// fx06 — "ASCII Dither": retro character-glyph particles (▓▒░ block-dither plus
// arcade symbols and digits) that scatter then march to the score, mutating their
// glyph as they go and flickering with RGB-split + dropout glitch. Apple IIgs /
// text-mode direction — limited retro palette, monospace, motion quantized to a
// pixel grid. Pure DOM, no Three.js.
//
// Each particle is a single monospace glyph that "dithers": it steps through the
// shade ramp (░▒▓█) and occasionally swaps to a symbol/digit, giving a text-mode
// corruption feel. A cyan/magenta ghost copy provides chromatic split. Particles
// home cleanly to resolveScore() and self-remove; dispose() removes every element
// + the injected <style> and unsubscribes.

import type { EddieParticlesDef, EddieParticlesVariant } from "./types";
import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";

const STYLE_ID = "eddie-fx06-style";
const STEP = 4; // px snap grid
const RAMP = ["░", "▒", "▓", "█"]; // dither shade ramp
const SYMBOLS = ["@", "#", "*", "+", "%", "$", "8", "0", "5", "?"];
const PALETTE = ["#5fff8f", "#5fd0ff", "#ffe65f", "#ff7adf", "#ffffff"];

interface Glyph {
  el: HTMLDivElement;
  ghost: HTMLDivElement; // chromatic-split ghost copy
  x0: number;
  y0: number;
  sx: number; // scatter peak
  sy: number;
  t: number;
  dur: number;
  size: number;
  charTimer: number; // seconds until next glyph mutation
  color: string;
}

class Fx06 implements EddieParticlesVariant {
  private parent: HTMLElement | null = null;
  private resolveScore: (() => { x: number; y: number }) | null = null;
  private glyphs: Glyph[] = [];
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
.eddie-fx06-glyph{position:absolute;left:0;top:0;pointer-events:none;
  font-family:"Courier New",monospace;font-weight:900;line-height:1;
  -webkit-font-smoothing:none;image-rendering:pixelated;
  text-shadow:0 0 5px currentColor,1px 1px 0 rgba(0,0,0,.6);
  will-change:transform,opacity,color;}
.eddie-fx06-gghost{position:absolute;left:0;top:0;pointer-events:none;
  font-family:"Courier New",monospace;font-weight:900;line-height:1;
  -webkit-font-smoothing:none;mix-blend-mode:screen;color:#00ffe0;
  will-change:transform,opacity;}`;
    document.head.appendChild(s);
    this.styleEl = s;
  }

  private spawn(x: number, y: number, count: number): void {
    if (!this.parent) return;
    const rect = this.parent.getBoundingClientRect();
    const lx = x - rect.left;
    const ly = y - rect.top;
    for (let i = 0; i < count; i++) {
      const size = 12 + Math.floor(Math.random() * 4) * 2; // 12,14,16,18
      const color = PALETTE[(Math.random() * PALETTE.length) | 0];
      const ch = RAMP[(Math.random() * RAMP.length) | 0];

      const el = document.createElement("div");
      el.className = "eddie-fx06-glyph";
      el.textContent = ch;
      el.style.color = color;
      el.style.fontSize = `${size}px`;

      const ghost = document.createElement("div");
      ghost.className = "eddie-fx06-gghost";
      ghost.textContent = ch;
      ghost.style.fontSize = `${size}px`;

      this.parent.appendChild(ghost);
      this.parent.appendChild(el);

      const ang = Math.random() * Math.PI * 2;
      const dist = 30 + Math.random() * 75;
      this.glyphs.push({
        el,
        ghost,
        x0: snap(lx),
        y0: snap(ly),
        sx: snap(lx + Math.cos(ang) * dist),
        sy: snap(ly + Math.sin(ang) * dist - 24),
        t: 0,
        dur: 0.65 + Math.random() * 0.4,
        size,
        charTimer: 0.04 + Math.random() * 0.06,
        color,
      });
    }
  }

  update(dt: number): void {
    if (!this.parent || !this.resolveScore || this.glyphs.length === 0) return;
    const rect = this.parent.getBoundingClientRect();
    const score = this.resolveScore();
    const tx = score.x - rect.left;
    const ty = score.y - rect.top;
    const SCATTER = 0.28; // fraction of life popping outward before the march

    for (let i = this.glyphs.length - 1; i >= 0; i--) {
      const p = this.glyphs[i];
      p.t += dt / p.dur;
      if (p.t >= 1) {
        p.el.remove();
        p.ghost.remove();
        this.glyphs.splice(i, 1);
        continue;
      }

      // Glyph mutation: dither through the shade ramp, sometimes a symbol/digit.
      p.charTimer -= dt;
      if (p.charTimer <= 0) {
        p.charTimer = 0.04 + Math.random() * 0.07;
        const ch =
          Math.random() < 0.7
            ? RAMP[(Math.random() * RAMP.length) | 0]
            : SYMBOLS[(Math.random() * SYMBOLS.length) | 0];
        p.el.textContent = ch;
        p.ghost.textContent = ch;
      }

      let x: number;
      let y: number;
      let arrive = 1;
      if (p.t < SCATTER) {
        const k = p.t / SCATTER;
        const o = backOut(k);
        x = p.x0 + (p.sx - p.x0) * o;
        y = p.y0 + (p.sy - p.y0) * o;
      } else {
        const k = (p.t - SCATTER) / (1 - SCATTER);
        const e = k * k * (3 - 2 * k); // smoothstep march to the score
        x = p.sx + (tx - p.sx) * e;
        y = p.sy + (ty - p.sy) * e;
        if (k > 0.82) arrive = (1 - k) / 0.18;
      }

      const qx = snap(x);
      const qy = snap(y);
      const dropout = Math.random() < 0.07;
      const split = 1 + (p.t < SCATTER ? 0 : 4);

      p.el.style.transform = `translate(${qx}px,${qy}px) translate(-50%,-50%)`;
      p.el.style.opacity = dropout ? "0" : `${arrive}`;

      p.ghost.style.transform = `translate(${qx - split}px,${qy}px) translate(-50%,-50%)`;
      p.ghost.style.opacity = dropout ? "0" : `${arrive * 0.55}`;
    }
  }

  dispose(): void {
    this.off?.();
    this.off = undefined;
    for (const p of this.glyphs) {
      p.el.remove();
      p.ghost.remove();
    }
    this.glyphs = [];
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
  id: "fx06",
  label: "ASCII Dither",
  blurb: "Block-dither and symbol glyphs scatter then march to the score, mutating their character with chromatic-split and dropout glitch.",
  create: () => new Fx06(),
};

export default def;
