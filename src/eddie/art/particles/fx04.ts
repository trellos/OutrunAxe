// fx04 — "Star Trails": bright 4-point sparkle stars with long fading tails that
// whip to the score on a graceful curve while twinkling. Pure DOM, no Three.js.
//
// Each star is a CSS-clip 4-point sparkle that rotates and pulses; behind it we
// render a short ribbon of fading "ghost" dots sampled from the star's recent
// positions, giving a comet streak. Stars self-remove on arrival; dispose()
// tears down every element + the injected <style> and unsubscribes.

import type { EddieParticlesDef, EddieParticlesVariant } from "./types";
import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";

const STYLE_ID = "eddie-fx04-style";
const TRAIL = 6; // ghost dots per star

interface Star {
  el: HTMLDivElement;
  ghosts: HTMLDivElement[];
  hist: { x: number; y: number }[]; // recent positions, newest first
  x0: number;
  y0: number;
  cx: number;
  cy: number;
  t: number;
  dur: number;
  size: number;
  spin: number; // deg/sec
  rot: number;
  twinkle: number; // phase
}

class Fx04 implements EddieParticlesVariant {
  private parent: HTMLElement | null = null;
  private resolveScore: (() => { x: number; y: number }) | null = null;
  private stars: Star[] = [];
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
.eddie-fx04-star{position:absolute;left:0;top:0;will-change:transform,opacity;
  pointer-events:none;clip-path:polygon(50% 0%,61% 39%,100% 50%,61% 61%,50% 100%,39% 61%,0% 50%,39% 39%);
  filter:drop-shadow(0 0 6px currentColor) drop-shadow(0 0 12px currentColor);}
.eddie-fx04-ghost{position:absolute;left:0;top:0;border-radius:50%;
  pointer-events:none;filter:blur(1px);will-change:transform,opacity;}`;
    document.head.appendChild(s);
    this.styleEl = s;
  }

  private spawn(x: number, y: number, count: number, color: string): void {
    if (!this.parent) return;
    const rect = this.parent.getBoundingClientRect();
    const lx = x - rect.left;
    const ly = y - rect.top;
    for (let i = 0; i < count; i++) {
      const jx = (Math.random() - 0.5) * 46;
      const jy = (Math.random() - 0.5) * 46;
      const size = 9 + Math.random() * 9;
      const el = document.createElement("div");
      el.className = "eddie-fx04-star";
      el.style.color = color;
      el.style.background = color;
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      this.parent.appendChild(el);

      const ghosts: HTMLDivElement[] = [];
      for (let g = 0; g < TRAIL; g++) {
        const gd = document.createElement("div");
        gd.className = "eddie-fx04-ghost";
        gd.style.background = color;
        const gs = size * (0.7 - g * 0.07);
        gd.style.width = `${Math.max(2, gs)}px`;
        gd.style.height = `${Math.max(2, gs)}px`;
        this.parent.appendChild(gd);
        ghosts.push(gd);
      }

      // Control point: flung outward + upward, biased away from origin for a whip.
      const cx = lx + jx + (Math.random() - 0.5) * 160;
      const cy = ly + jy - 60 - Math.random() * 140;
      this.stars.push({
        el,
        ghosts,
        hist: [],
        x0: lx + jx,
        y0: ly + jy,
        cx,
        cy,
        t: 0,
        dur: 0.55 + Math.random() * 0.4,
        size,
        spin: (Math.random() < 0.5 ? -1 : 1) * (180 + Math.random() * 360),
        rot: Math.random() * 360,
        twinkle: Math.random() * Math.PI * 2,
      });
    }
  }

  update(dt: number): void {
    if (!this.parent || !this.resolveScore || this.stars.length === 0) return;
    const rect = this.parent.getBoundingClientRect();
    const score = this.resolveScore();
    const tx = score.x - rect.left;
    const ty = score.y - rect.top;

    for (let i = this.stars.length - 1; i >= 0; i--) {
      const p = this.stars[i];
      p.t += dt / p.dur;
      p.rot += p.spin * dt;
      p.twinkle += dt * 14;
      if (p.t >= 1) {
        p.el.remove();
        for (const g of p.ghosts) g.remove();
        this.stars.splice(i, 1);
        continue;
      }
      const e = p.t * p.t * (3 - 2 * p.t); // smoothstep ease
      const u = 1 - e;
      const x = u * u * p.x0 + 2 * u * e * p.cx + e * e * tx;
      const y = u * u * p.y0 + 2 * u * e * p.cy + e * e * ty;

      // Record history (newest first) for the trailing ghosts.
      p.hist.unshift({ x, y });
      if (p.hist.length > TRAIL) p.hist.pop();

      const shrink = 1 - e * 0.55;
      const tw = 0.78 + 0.22 * Math.sin(p.twinkle); // twinkle pulse
      const scale = shrink * tw;
      const half = p.size / 2;
      p.el.style.transform =
        `translate(${x - half}px,${y - half}px) rotate(${p.rot}deg) scale(${scale})`;
      p.el.style.opacity = `${e < 0.85 ? 1 : (1 - e) / 0.15}`;

      for (let g = 0; g < p.ghosts.length; g++) {
        const gd = p.ghosts[g];
        const h = p.hist[g + 1] ?? p.hist[p.hist.length - 1];
        if (!h) {
          gd.style.opacity = "0";
          continue;
        }
        const gscale = (1 - g / (TRAIL + 1)) * shrink;
        gd.style.transform = `translate(${h.x}px,${h.y}px) scale(${gscale}) translate(-50%,-50%)`;
        const base = (1 - g / TRAIL) * 0.55;
        gd.style.opacity = `${e < 0.85 ? base : base * (1 - e) / 0.15}`;
      }
    }
  }

  dispose(): void {
    this.off?.();
    this.off = undefined;
    for (const p of this.stars) {
      p.el.remove();
      for (const g of p.ghosts) g.remove();
    }
    this.stars = [];
    this.styleEl?.remove();
    this.styleEl = undefined;
    this.parent = null;
    this.resolveScore = null;
  }
}

const def: EddieParticlesDef = {
  id: "fx04",
  label: "Star Trails",
  blurb: "Four-point sparkle stars whip to the score on graceful arcs, twinkling behind long fading comet tails.",
  create: () => new Fx04(),
};

export default def;
