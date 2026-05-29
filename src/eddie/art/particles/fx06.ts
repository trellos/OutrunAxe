// fx06 — "Liquid Neon": glowing gooey blobs (blurred radial gradients) that
// stretch/squash along their velocity and flow to the score like liquid light.
// A shared SVG goo filter on the container fuses overlapping blobs into a
// metaball-ish mass that splits apart as they travel. Pure DOM/SVG, no Three.js.
//
// Each blob rides an eased Bezier toward the score; its scaleX/scaleY are driven
// by instantaneous speed (fast = stretched along motion, slow = squashed) for a
// living, fluid feel. Blobs self-remove on arrival; dispose() removes every
// element, the goo wrapper, and the injected <style>, and unsubscribes.

import type { EddieParticlesDef, EddieParticlesVariant } from "./types";
import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";

const STYLE_ID = "eddie-fx06-style";
const SVG_NS = "http://www.w3.org/2000/svg";

interface Blob {
  el: HTMLDivElement;
  x0: number;
  y0: number;
  cx: number;
  cy: number;
  t: number;
  dur: number;
  size: number;
  px: number; // previous position for velocity
  py: number;
  hasPrev: boolean;
}

class Fx06 implements EddieParticlesVariant {
  private parent: HTMLElement | null = null;
  private resolveScore: (() => { x: number; y: number }) | null = null;
  private blobs: Blob[] = [];
  private off?: () => void;
  private styleEl?: HTMLStyleElement;
  private goo?: HTMLDivElement;
  private filterId = `eddie-fx06-goo-${Math.random().toString(36).slice(2, 8)}`;

  mount(ctx: {
    hudParent: HTMLElement;
    juice: EventBus<EddieJuiceEvents>;
    resolveScore: () => { x: number; y: number };
  }): void {
    this.parent = ctx.hudParent;
    this.resolveScore = ctx.resolveScore;
    this.injectStyle();
    this.createGooLayer();
    this.off = ctx.juice.on("eddieParticles", (e) => {
      this.spawn(e.from.x, e.from.y, Math.max(1, Math.min(40, e.count)), e.color);
    });
  }

  private injectStyle(): void {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = `
.eddie-fx06-goo{position:absolute;left:0;top:0;width:100%;height:100%;
  pointer-events:none;overflow:visible;}
.eddie-fx06-blob{position:absolute;left:0;top:0;border-radius:50%;
  pointer-events:none;will-change:transform,opacity;
  background:radial-gradient(circle at 38% 35%,#fff 0%,currentColor 38%,transparent 72%);
  filter:drop-shadow(0 0 10px currentColor);}`;
    document.head.appendChild(s);
    this.styleEl = s;
  }

  private createGooLayer(): void {
    if (!this.parent) return;
    const goo = document.createElement("div");
    goo.className = "eddie-fx06-goo";
    goo.style.filter = `url(#${this.filterId})`;

    // Inline SVG goo filter: blur + contrast-style alpha matrix fuses neighbors.
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.style.position = "absolute";
    const defs = document.createElementNS(SVG_NS, "defs");
    const filter = document.createElementNS(SVG_NS, "filter");
    filter.setAttribute("id", this.filterId);
    const blur = document.createElementNS(SVG_NS, "feGaussianBlur");
    blur.setAttribute("in", "SourceGraphic");
    blur.setAttribute("stdDeviation", "6");
    blur.setAttribute("result", "blur");
    const matrix = document.createElementNS(SVG_NS, "feColorMatrix");
    matrix.setAttribute("in", "blur");
    matrix.setAttribute("mode", "matrix");
    matrix.setAttribute("values", "1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9");
    matrix.setAttribute("result", "goo");
    const blend = document.createElementNS(SVG_NS, "feBlend");
    blend.setAttribute("in", "SourceGraphic");
    blend.setAttribute("in2", "goo");
    filter.appendChild(blur);
    filter.appendChild(matrix);
    filter.appendChild(blend);
    defs.appendChild(filter);
    svg.appendChild(defs);

    goo.appendChild(svg);
    this.parent.appendChild(goo);
    this.goo = goo;
  }

  private spawn(x: number, y: number, count: number, color: string): void {
    if (!this.parent || !this.goo) return;
    const rect = this.parent.getBoundingClientRect();
    const lx = x - rect.left;
    const ly = y - rect.top;
    for (let i = 0; i < count; i++) {
      const jx = (Math.random() - 0.5) * 36;
      const jy = (Math.random() - 0.5) * 36;
      const size = 16 + Math.random() * 18;
      const el = document.createElement("div");
      el.className = "eddie-fx06-blob";
      el.style.color = color;
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      this.goo.appendChild(el);

      const cx = lx + jx + (Math.random() - 0.5) * 130;
      const cy = ly + jy - 50 - Math.random() * 120;
      this.blobs.push({
        el,
        x0: lx + jx,
        y0: ly + jy,
        cx,
        cy,
        t: 0,
        dur: 0.6 + Math.random() * 0.45,
        size,
        px: lx + jx,
        py: ly + jy,
        hasPrev: false,
      });
    }
  }

  update(dt: number): void {
    if (!this.parent || !this.resolveScore || this.blobs.length === 0) return;
    const rect = this.parent.getBoundingClientRect();
    const score = this.resolveScore();
    const tx = score.x - rect.left;
    const ty = score.y - rect.top;

    for (let i = this.blobs.length - 1; i >= 0; i--) {
      const p = this.blobs[i];
      p.t += dt / p.dur;
      if (p.t >= 1) {
        p.el.remove();
        this.blobs.splice(i, 1);
        continue;
      }
      const e = p.t * p.t * (3 - 2 * p.t); // smoothstep ease
      const u = 1 - e;
      const x = u * u * p.x0 + 2 * u * e * p.cx + e * e * tx;
      const y = u * u * p.y0 + 2 * u * e * p.cy + e * e * ty;

      // Velocity → stretch/squash along the direction of travel.
      const dx = x - p.px;
      const dy = y - p.py;
      const speed = Math.hypot(dx, dy);
      const angle = p.hasPrev && speed > 0.01 ? Math.atan2(dy, dx) : 0;
      const stretch = Math.min(0.9, speed / (dt * 900 + 1e-3));
      const sx = 1 + stretch;
      const sy = 1 - stretch * 0.45;
      const grow = 1 - e * 0.5; // shrink as it merges into the score
      const half = p.size / 2;

      p.el.style.transform =
        `translate(${x - half}px,${y - half}px) rotate(${angle}rad) scale(${sx * grow},${sy * grow})`;
      p.el.style.opacity = `${e < 0.82 ? 1 : (1 - e) / 0.18}`;

      p.px = x;
      p.py = y;
      p.hasPrev = true;
    }
  }

  dispose(): void {
    this.off?.();
    this.off = undefined;
    for (const p of this.blobs) p.el.remove();
    this.blobs = [];
    this.goo?.remove();
    this.goo = undefined;
    this.styleEl?.remove();
    this.styleEl = undefined;
    this.parent = null;
    this.resolveScore = null;
  }
}

const def: EddieParticlesDef = {
  id: "fx06",
  label: "Liquid Neon",
  blurb: "Gooey radial-gradient blobs stretch and squash with their speed, fusing metaball-style as they flow to the score like liquid light.",
  create: () => new Fx06(),
};

export default def;
