// fx05 — "Phosphor Comets": chunky pixel heads dragging CRT phosphor trails that
// streak to the score, with scanline banding, RGB-split fringing, and dropout
// flicker. Apple IIgs direction — limited retro palette, image-rendering:pixelated,
// motion quantized to a pixel grid. Pure DOM, no Three.js.
//
// Each comet records its recent grid-snapped positions; trailing "phosphor"
// blocks are drawn at those samples with decaying brightness (the slow CRT
// phosphor fade). The head occasionally drops out and shows chromatic fringe.
// Comets home cleanly to resolveScore() and self-remove; dispose() removes every
// element + the injected <style> and unsubscribes.

import type { EddieParticlesDef, EddieParticlesVariant } from "./types";
import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";

const STYLE_ID = "eddie-fx05-style";
const STEP = 4; // px snap grid
const TRAIL = 8; // phosphor samples per comet
const PALETTE = ["#62ff8a", "#5fd0ff", "#ffe65f", "#ff7adf", "#ffffff"];

interface Comet {
  head: HTMLDivElement;
  fringe: HTMLDivElement; // chromatic-fringe ghost behind the head
  trail: HTMLDivElement[];
  hist: { x: number; y: number }[]; // newest first
  x0: number;
  y0: number;
  cx: number;
  cy: number;
  t: number;
  dur: number;
  size: number;
}

class Fx05 implements EddieParticlesVariant {
  private parent: HTMLElement | null = null;
  private resolveScore: (() => { x: number; y: number }) | null = null;
  private comets: Comet[] = [];
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
    // Scanline banding via repeating-linear-gradient overlay on the head; the
    // trail blocks reuse the head color at lower alpha for the phosphor decay.
    s.textContent = `
.eddie-fx05-head{position:absolute;left:0;top:0;image-rendering:pixelated;
  pointer-events:none;will-change:transform,opacity;
  background-image:repeating-linear-gradient(0deg,rgba(0,0,0,.45) 0,rgba(0,0,0,.45) 1px,transparent 1px,transparent 3px);
  box-shadow:0 0 6px currentColor;}
.eddie-fx05-fringe{position:absolute;left:0;top:0;image-rendering:pixelated;
  pointer-events:none;mix-blend-mode:screen;will-change:transform,opacity;}
.eddie-fx05-trail{position:absolute;left:0;top:0;image-rendering:pixelated;
  pointer-events:none;will-change:transform,opacity;}`;
    document.head.appendChild(s);
    this.styleEl = s;
  }

  private spawn(x: number, y: number, count: number): void {
    if (!this.parent) return;
    const rect = this.parent.getBoundingClientRect();
    const lx = x - rect.left;
    const ly = y - rect.top;
    for (let i = 0; i < count; i++) {
      const size = 8 + Math.floor(Math.random() * 3) * 2; // 8,10,12
      const color = PALETTE[(Math.random() * PALETTE.length) | 0];

      const head = document.createElement("div");
      head.className = "eddie-fx05-head";
      head.style.color = color;
      head.style.background = color;
      head.style.width = `${size}px`;
      head.style.height = `${size}px`;

      const fringe = document.createElement("div");
      fringe.className = "eddie-fx05-fringe";
      fringe.style.background =
        "linear-gradient(90deg,#ff00c8 0%,transparent 40%,transparent 60%,#00ffe0 100%)";
      fringe.style.width = `${size + 6}px`;
      fringe.style.height = `${size}px`;

      const trail: HTMLDivElement[] = [];
      for (let g = 0; g < TRAIL; g++) {
        const td = document.createElement("div");
        td.className = "eddie-fx05-trail";
        td.style.background = color;
        const ts = Math.max(2, size - g);
        td.style.width = `${ts}px`;
        td.style.height = `${ts}px`;
        this.parent.appendChild(td);
        trail.push(td);
      }
      this.parent.appendChild(fringe);
      this.parent.appendChild(head);

      const cx = lx + (Math.random() - 0.5) * 180;
      const cy = ly - 40 - Math.random() * 150;
      this.comets.push({
        head,
        fringe,
        trail,
        hist: [],
        x0: snap(lx + (Math.random() - 0.5) * 28),
        y0: snap(ly + (Math.random() - 0.5) * 28),
        cx,
        cy,
        t: 0,
        dur: 0.6 + Math.random() * 0.4,
        size,
      });
    }
  }

  update(dt: number): void {
    if (!this.parent || !this.resolveScore || this.comets.length === 0) return;
    const rect = this.parent.getBoundingClientRect();
    const score = this.resolveScore();
    const tx = score.x - rect.left;
    const ty = score.y - rect.top;

    for (let i = this.comets.length - 1; i >= 0; i--) {
      const p = this.comets[i];
      p.t += dt / p.dur;
      if (p.t >= 1) {
        p.head.remove();
        p.fringe.remove();
        for (const td of p.trail) td.remove();
        this.comets.splice(i, 1);
        continue;
      }
      const e = p.t * p.t * (3 - 2 * p.t); // smoothstep ease
      const u = 1 - e;
      const x = snap(u * u * p.x0 + 2 * u * e * p.cx + e * e * tx);
      const y = snap(u * u * p.y0 + 2 * u * e * p.cy + e * e * ty);

      p.hist.unshift({ x, y });
      if (p.hist.length > TRAIL + 1) p.hist.pop();

      const arrive = e < 0.85 ? 1 : (1 - e) / 0.15;
      const dropout = Math.random() < 0.05;
      const half = p.size / 2;

      p.head.style.transform = `translate(${x - half}px,${y - half}px)`;
      p.head.style.opacity = dropout ? "0" : `${arrive}`;

      // Chromatic fringe trails just behind the head, widening as it accelerates.
      const fringeSrc = p.hist[1] ?? p.hist[0];
      p.fringe.style.transform = `translate(${fringeSrc.x - half - 3}px,${fringeSrc.y - half}px)`;
      p.fringe.style.opacity = dropout ? "0" : `${arrive * 0.5}`;

      // Phosphor trail: older samples dimmer + smaller (slow CRT decay).
      for (let g = 0; g < p.trail.length; g++) {
        const td = p.trail[g];
        const h = p.hist[g + 1];
        if (!h) {
          td.style.opacity = "0";
          continue;
        }
        const ths = Math.max(2, p.size - g);
        td.style.transform = `translate(${h.x - ths / 2}px,${h.y - ths / 2}px)`;
        const decay = (1 - g / TRAIL) * 0.6;
        td.style.opacity = `${arrive * decay}`;
      }
    }
  }

  dispose(): void {
    this.off?.();
    this.off = undefined;
    for (const p of this.comets) {
      p.head.remove();
      p.fringe.remove();
      for (const td of p.trail) td.remove();
    }
    this.comets = [];
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
  id: "fx05",
  label: "Phosphor Comets",
  blurb: "Pixel comet heads drag decaying CRT phosphor trails to the score with scanline banding, chromatic fringe, and dropout flicker.",
  create: () => new Fx05(),
};

export default def;
