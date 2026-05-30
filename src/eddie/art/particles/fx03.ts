// fx03 — "Dither Sparkle": 8-bit starburst sparkles built from a dithered pixel
// cross (a plus-shaped cluster of chunky pixels with a checkerboard dither in the
// glow). Each sparkle pops out in a quantized starburst, twinkles by toggling its
// dither pattern on/off (a 2-frame on/off flicker like a IIgs sprite), and homes
// to the score on a pixel-snapped path. A fraction are tiny pixel digits.
// Pure DOM, no Three.js.
//
// Evolved from the old fx05 "Pixel Burst": keeps crisp pixel-grid snapping and
// digit sprites, but the plain blocks become dithered twinkling starbursts drawn
// with CSS conic/repeating gradients on a pixel grid. Sparkles self-remove on
// arrival; dispose() removes every element + injected <style> and unsubscribes.

import type { EddieParticlesDef, EddieParticlesVariant } from "./types";
import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";

const STYLE_ID = "eddie-fx03-dither-style";
const STEP = 4; // px snap grid
const DIGITS = "0123456789";
const PALETTE = ["#00f0ff", "#ff2bd6", "#ffd02b", "#c7ff2b", "#ffffff"];

interface Spark {
  el: HTMLDivElement;
  isDigit: boolean;
  x0: number;
  y0: number;
  sx: number; // starburst peak
  sy: number;
  t: number;
  dur: number;
  size: number;
  twPhase: number;
  twRate: number;
  spin: number; // sparkle rotation deg/sec
  rot: number;
}

class Fx03 implements EddieParticlesVariant {
  private parent: HTMLElement | null = null;
  private resolveScore: (() => { x: number; y: number }) | null = null;
  private sparks: Spark[] = [];
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
    // The sparkle is a plus-shaped cross via CSS mask, filled with a checkerboard
    // dither (repeating conic gradient on a small pixel grid). image-rendering
    // pixelated keeps the dither crisp/chunky.
    s.textContent = `
.eddie-fx03-spark{position:absolute;left:0;top:0;pointer-events:none;
  image-rendering:pixelated;will-change:transform,opacity;
  background:
    repeating-conic-gradient(currentColor 0 25%, transparent 0 50%) 0 0 / 4px 4px,
    radial-gradient(closest-side, currentColor, transparent);
  -webkit-mask:
    linear-gradient(#000 0 0) center/100% 34% no-repeat,
    linear-gradient(#000 0 0) center/34% 100% no-repeat;
  mask:
    linear-gradient(#000 0 0) center/100% 34% no-repeat,
    linear-gradient(#000 0 0) center/34% 100% no-repeat;
  filter:drop-shadow(0 0 5px currentColor);}
.eddie-fx03-digit{position:absolute;left:0;top:0;pointer-events:none;
  font-family:"Courier New",monospace;font-weight:900;line-height:1;
  -webkit-font-smoothing:none;image-rendering:pixelated;will-change:transform,opacity;
  text-shadow:0 0 6px currentColor,1px 1px 0 rgba(0,0,0,.6);}`;
    document.head.appendChild(s);
    this.styleEl = s;
  }

  private spawn(x: number, y: number, count: number, color: string): void {
    if (!this.parent) return;
    const rect = this.parent.getBoundingClientRect();
    const lx = x - rect.left;
    const ly = y - rect.top;

    for (let i = 0; i < count; i++) {
      const isDigit = Math.random() < 0.28;
      const x0 = snap(lx + (Math.random() - 0.5) * 44);
      const y0 = snap(ly + (Math.random() - 0.5) * 44);
      const pal = PALETTE[(Math.random() * PALETTE.length) | 0] || color;

      const el = document.createElement("div");
      let size: number;
      if (isDigit) {
        size = 12 + Math.random() * 8;
        el.className = "eddie-fx03-digit";
        el.textContent = DIGITS[(Math.random() * 10) | 0];
        el.style.color = pal;
        el.style.fontSize = `${size}px`;
      } else {
        size = STEP * (3 + ((Math.random() * 3) | 0)); // 12..20 px sparkles
        el.className = "eddie-fx03-spark";
        el.style.color = pal;
        sizePx(el, size);
      }
      this.parent.appendChild(el);

      // Quantized starburst peak: pop outward, biased upward like an arcade twinkle.
      const ang = Math.random() * Math.PI * 2;
      const dist = 26 + Math.random() * 64;
      const sx = snap(x0 + Math.cos(ang) * dist);
      const sy = snap(y0 + Math.sin(ang) * dist - 22);

      this.sparks.push({
        el,
        isDigit,
        x0,
        y0,
        sx,
        sy,
        t: 0,
        dur: 0.6 + Math.random() * 0.4,
        size,
        twPhase: Math.random() * Math.PI * 2,
        twRate: 30 + Math.random() * 34,
        spin: (Math.random() < 0.5 ? -1 : 1) * (60 + Math.random() * 180),
        rot: Math.random() * 90,
      });
    }
  }

  update(dt: number): void {
    if (!this.parent || !this.resolveScore || this.sparks.length === 0) return;
    const rect = this.parent.getBoundingClientRect();
    const score = this.resolveScore();
    const tx = score.x - rect.left;
    const ty = score.y - rect.top;
    const BURST = 0.3; // fraction of life spent in the starburst pop

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const p = this.sparks[i];
      p.t += dt / p.dur;
      if (p.t >= 1) {
        p.el.remove();
        this.sparks.splice(i, 1);
        continue;
      }

      let x: number;
      let y: number;
      let baseOpacity = 1;
      if (p.t < BURST) {
        const k = p.t / BURST;
        const o = backOut(k);
        x = p.x0 + (p.sx - p.x0) * o;
        y = p.y0 + (p.sy - p.y0) * o;
      } else {
        const k = (p.t - BURST) / (1 - BURST);
        const e = k * k * (3 - 2 * k);
        x = p.sx + (tx - p.sx) * e;
        y = p.sy + (ty - p.sy) * e;
        if (k > 0.8) baseOpacity = (1 - k) / 0.2;
      }
      x = snap(x);
      y = snap(y);

      // Twinkle: a 2-state on/off flicker (square wave) so the sparkle reads as a
      // toggling 8-bit sprite rather than a smooth fade.
      p.twPhase += p.twRate * dt;
      const on = Math.sin(p.twPhase) > -0.25 ? 1 : 0.25;
      p.rot += p.spin * dt;

      const scale = p.t < BURST ? backOut(p.t / BURST) : 1 - (p.t - BURST) * 0.35;
      const rot = p.isDigit ? 0 : p.rot;
      p.el.style.transform =
        `translate(${x}px,${y}px) translate(-50%,-50%) rotate(${rot}deg) scale(${Math.max(0.1, scale)})`;
      p.el.style.opacity = `${baseOpacity * on}`;
    }
  }

  dispose(): void {
    this.off?.();
    this.off = undefined;
    for (const p of this.sparks) p.el.remove();
    this.sparks = [];
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

function sizePx(el: HTMLDivElement, size: number): void {
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
}

const def: EddieParticlesDef = {
  id: "fx03",
  label: "Dither Sparkle",
  blurb: "Dithered 8-bit star-crosses pop in a pixel starburst, twinkling on/off as they home to the score.",
  create: () => new Fx03(),
};

export default def;
