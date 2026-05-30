// fx02 — "Datamosh Smear": chunky pixel blocks that home to the score leaving a
// datamosh trail — a chain of fading, pixel-snapped ghost copies of the block
// that linger along its recent path like a corrupted video keyframe smearing
// forward. Periodic glitch "dropout" frames briefly desaturate/clip the block and
// nudge its smear sideways. A fraction are tiny pixel digits. Pure DOM, no Three.js.
//
// Evolved from the old fx05 "Pixel Burst": keeps the crisp pixel-grid snapping and
// digit sprites, but trades the stair-step march for a smeared datamosh homing
// run. Blocks + their pooled trail nodes self-remove on arrival; dispose() removes
// every element + injected <style> and unsubscribes (no leaks).

import type { EddieParticlesDef, EddieParticlesVariant } from "./types";
import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";

const STYLE_ID = "eddie-fx02-mosh-style";
const STEP = 4; // px snap grid
const DIGITS = "0123456789";
const TRAIL = 6; // ghost copies forming the smear
const PALETTE = ["#00f0ff", "#ff2bd6", "#ffd02b", "#c7ff2b"];

interface Mosh {
  el: HTMLDivElement; // head block
  trail: HTMLDivElement[]; // smear ghosts (oldest..newest unused; we index by lag)
  history: { x: number; y: number }[]; // recent snapped positions
  x0: number;
  y0: number;
  cx: number;
  cy: number;
  t: number;
  dur: number;
  size: number;
  dropPhase: number;
  dropRate: number;
}

class Fx02 implements EddieParticlesVariant {
  private parent: HTMLElement | null = null;
  private resolveScore: (() => { x: number; y: number }) | null = null;
  private moshes: Mosh[] = [];
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
.eddie-fx02-head{position:absolute;left:0;top:0;pointer-events:none;
  image-rendering:pixelated;will-change:transform,opacity;
  box-shadow:0 0 0 1px rgba(0,0,0,.5),0 0 8px currentColor;}
.eddie-fx02-ghost{position:absolute;left:0;top:0;pointer-events:none;
  image-rendering:pixelated;mix-blend-mode:screen;will-change:transform,opacity;}
.eddie-fx02-digit{position:absolute;left:0;top:0;pointer-events:none;
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
      const jx = (Math.random() - 0.5) * 44;
      const jy = (Math.random() - 0.5) * 44;
      const x0 = snap(lx + jx);
      const y0 = snap(ly + jy);
      const pal = PALETTE[(Math.random() * PALETTE.length) | 0] || color;

      const el = document.createElement("div");
      let size: number;
      if (isDigit) {
        size = 12 + Math.random() * 8;
        el.className = "eddie-fx02-digit";
        el.textContent = DIGITS[(Math.random() * 10) | 0];
        el.style.color = pal;
        el.style.fontSize = `${size}px`;
      } else {
        size = STEP * (2 + ((Math.random() * 3) | 0)); // 8..16 px
        el.className = "eddie-fx02-head";
        el.style.background = pal;
        el.style.color = pal;
        sizePx(el, size);
      }
      this.parent.appendChild(el);

      // Pooled smear ghosts behind the head.
      const trail: HTMLDivElement[] = [];
      for (let g = 0; g < TRAIL; g++) {
        const gh = document.createElement("div");
        gh.className = isDigit ? "eddie-fx02-digit eddie-fx02-ghost" : "eddie-fx02-ghost";
        if (isDigit) {
          gh.textContent = el.textContent;
          gh.style.color = pal;
          gh.style.fontSize = `${size}px`;
          gh.style.textShadow = "none";
        } else {
          gh.style.background = pal;
          sizePx(gh, size);
        }
        gh.style.opacity = "0";
        this.parent.appendChild(gh);
        trail.push(gh);
      }

      const cx = x0 + (Math.random() - 0.5) * 140;
      const cy = y0 - 50 - Math.random() * 120;

      this.moshes.push({
        el,
        trail,
        history: [{ x: x0, y: y0 }],
        x0,
        y0,
        cx,
        cy,
        t: 0,
        dur: 0.55 + Math.random() * 0.4,
        size,
        dropPhase: Math.random() * Math.PI * 2,
        dropRate: 18 + Math.random() * 18,
      });
    }
  }

  update(dt: number): void {
    if (!this.parent || !this.resolveScore || this.moshes.length === 0) return;
    const rect = this.parent.getBoundingClientRect();
    const score = this.resolveScore();
    const tx = score.x - rect.left;
    const ty = score.y - rect.top;

    for (let i = this.moshes.length - 1; i >= 0; i--) {
      const p = this.moshes[i];
      p.t += dt / p.dur;
      if (p.t >= 1) {
        p.el.remove();
        for (const g of p.trail) g.remove();
        this.moshes.splice(i, 1);
        continue;
      }
      const e = p.t * p.t * (3 - 2 * p.t); // smoothstep
      const u = 1 - e;
      let x = u * u * p.x0 + 2 * u * e * p.cx + e * e * tx;
      let y = u * u * p.y0 + 2 * u * e * p.cy + e * e * ty;

      // Glitch dropout: short windows where the smear lurches sideways (a torn
      // datamosh keyframe) and the head clips its brightness.
      p.dropPhase += p.dropRate * dt;
      const drop = Math.sin(p.dropPhase) > 0.9;
      const lurch = drop ? (Math.random() - 0.5) * 18 : 0;
      x = snap(x + lurch);
      y = snap(y);

      // Record snapped head position; cap history to the trail length.
      p.history.push({ x, y });
      if (p.history.length > TRAIL + 1) p.history.shift();

      const fade = p.t < 0.85 ? 1 : Math.max(0, (1 - p.t) / 0.15);
      p.el.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%)`;
      p.el.style.opacity = `${drop ? fade * 0.45 : fade}`;

      // Lay the smear ghosts along the recorded path, oldest = faintest.
      for (let g = 0; g < TRAIL; g++) {
        const gh = p.trail[g];
        // history newest is last; ghost g looks back g+1 frames.
        const idx = p.history.length - 2 - g;
        if (idx < 0) {
          gh.style.opacity = "0";
          continue;
        }
        const h = p.history[idx];
        const lag = (g + 1) / TRAIL; // 0..1 back along the trail
        gh.style.transform = `translate(${h.x}px,${h.y}px) translate(-50%,-50%)`;
        gh.style.opacity = `${(1 - lag) * 0.5 * fade}`;
      }
    }
  }

  dispose(): void {
    this.off?.();
    this.off = undefined;
    for (const p of this.moshes) {
      p.el.remove();
      for (const g of p.trail) g.remove();
    }
    this.moshes = [];
    this.styleEl?.remove();
    this.styleEl = undefined;
    this.parent = null;
    this.resolveScore = null;
  }
}

function snap(v: number): number {
  return Math.round(v / STEP) * STEP;
}

function sizePx(el: HTMLDivElement, size: number): void {
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
}

const def: EddieParticlesDef = {
  id: "fx02",
  label: "Datamosh Smear",
  blurb: "Pixel blocks home to the score dragging a fading datamosh smear, lurching sideways on glitch-dropout frames.",
  create: () => new Fx02(),
};

export default def;
