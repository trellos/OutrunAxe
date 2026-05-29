// fx02 — "Electric Zaps": jagged lightning-bolt glyphs / crackling segments that
// snap toward the score readout with a flickering glow and tiny sparks. Pure DOM,
// no Three.js. Default-exports an EddieParticlesDef.
//
// Motion: each bolt is a small SVG-free zigzag built from a CSS clip-path polygon,
// flung along a near-linear path (lightning snaps, doesn't lazily float) with a
// touch of arc. Bolts flicker their opacity/glow and rotate to face their travel
// direction. A few of the spawned elements are tiny round sparks that scatter and
// fade. dispose() removes every live element + the injected <style> and
// unsubscribes.

import type { EddieParticlesDef, EddieParticlesVariant } from "./types";
import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";

interface Zap {
  el: HTMLDivElement;
  isSpark: boolean;
  x0: number;
  y0: number;
  cx: number;
  cy: number;
  t: number;
  dur: number;
  flick: number; // flicker phase
  flickRate: number;
  baseRot: number; // extra rotation jitter
  w: number;
  h: number;
}

const STYLE_ID = "eddie-fx02-style";

class Fx02 implements EddieParticlesVariant {
  private parent: HTMLElement | null = null;
  private resolveScore: (() => { x: number; y: number }) | null = null;
  private zaps: Zap[] = [];
  private off?: () => void;
  private style?: HTMLStyleElement;

  mount(ctx: {
    hudParent: HTMLElement;
    juice: EventBus<EddieJuiceEvents>;
    resolveScore: () => { x: number; y: number };
  }): void {
    this.parent = ctx.hudParent;
    this.resolveScore = ctx.resolveScore;

    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
.eddie-fx02-bolt {
  position: absolute;
  pointer-events: none;
  will-change: transform, opacity, filter;
  transform-origin: 50% 50%;
  background: linear-gradient(180deg, #ffffff, currentColor);
  clip-path: polygon(40% 0%, 100% 38%, 58% 42%, 90% 100%, 0% 56%, 46% 50%);
  filter: drop-shadow(0 0 4px currentColor) drop-shadow(0 0 9px currentColor);
}
.eddie-fx02-spark {
  position: absolute;
  pointer-events: none;
  border-radius: 50%;
  background: #ffffff;
  will-change: transform, opacity;
  box-shadow: 0 0 5px currentColor, 0 0 10px currentColor;
}`;
      document.head.appendChild(style);
      this.style = style;
    }

    this.off = ctx.juice.on("eddieParticles", (e) => {
      this.spawn(e.from.x, e.from.y, Math.max(1, Math.min(40, e.count)), e.color);
    });
  }

  private spawn(x: number, y: number, count: number, color: string): void {
    if (!this.parent) return;
    const rect = this.parent.getBoundingClientRect();
    const localX = x - rect.left;
    const localY = y - rect.top;

    for (let i = 0; i < count; i++) {
      // Roughly one in three is a small spark for crackle texture.
      const isSpark = Math.random() < 0.34;
      const jx = (Math.random() - 0.5) * 50;
      const jy = (Math.random() - 0.5) * 50;
      const sx = localX + jx;
      const sy = localY + jy;

      const el = document.createElement("div");
      el.style.color = color;

      let w: number;
      let h: number;
      if (isSpark) {
        el.className = "eddie-fx02-spark";
        w = 3 + Math.random() * 3;
        h = w;
      } else {
        el.className = "eddie-fx02-bolt";
        w = 16 + Math.random() * 14;
        h = 16 + Math.random() * 14;
      }
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      this.parent.appendChild(el);

      // Lightning snaps fairly straight; sparks scatter more wildly.
      const towardX = (Math.random() - 0.5) * (isSpark ? 120 : 50);
      const towardY = -20 - Math.random() * (isSpark ? 90 : 50);
      const cx = sx + towardX;
      const cy = sy + towardY;

      this.zaps.push({
        el,
        isSpark,
        x0: sx,
        y0: sy,
        cx,
        cy,
        t: 0,
        dur: isSpark ? 0.32 + Math.random() * 0.25 : 0.34 + Math.random() * 0.26,
        flick: Math.random() * Math.PI * 2,
        flickRate: 28 + Math.random() * 30,
        baseRot: (Math.random() - 0.5) * 50,
        w,
        h,
      });
    }
  }

  update(dt: number): void {
    if (!this.parent || !this.resolveScore || this.zaps.length === 0) return;
    const rect = this.parent.getBoundingClientRect();
    const score = this.resolveScore();
    const tx = score.x - rect.left;
    const ty = score.y - rect.top;

    for (let i = this.zaps.length - 1; i >= 0; i--) {
      const z = this.zaps[i];
      z.t += dt / z.dur;
      if (z.t >= 1) {
        z.el.remove();
        this.zaps.splice(i, 1);
        continue;
      }
      // Snappy ease-out: fast launch, decelerate into the readout.
      const e = 1 - (1 - z.t) * (1 - z.t);
      const u = 1 - e;
      const x = u * u * z.x0 + 2 * u * e * z.cx + e * e * tx;
      const y = u * u * z.y0 + 2 * u * e * z.cy + e * e * ty;

      // Travel direction so bolts point where they fly.
      const dirX = 2 * u * (z.cx - z.x0) + 2 * e * (tx - z.cx);
      const dirY = 2 * u * (z.cy - z.y0) + 2 * e * (ty - z.cy);
      const ang = (Math.atan2(dirY, dirX) * 180) / Math.PI;

      z.flick += z.flickRate * dt;
      // Flicker: rapid opacity strobe layered over a fade-out tail.
      const strobe = 0.55 + 0.45 * Math.abs(Math.sin(z.flick));
      const tail = z.t < 0.8 ? 1 : Math.max(0, (1 - z.t) / 0.2);
      const opacity = strobe * tail;

      z.el.style.left = `${x - z.w / 2}px`;
      z.el.style.top = `${y - z.h / 2}px`;
      z.el.style.opacity = `${opacity}`;

      if (z.isSpark) {
        const scale = 1 - e * 0.7;
        z.el.style.transform = `scale(${Math.max(0.15, scale)})`;
      } else {
        const scale = 1 - e * 0.45;
        z.el.style.transform = `rotate(${ang + z.baseRot}deg) scale(${scale})`;
        // Glow pulses with the flicker for a crackling charge feel.
        const glow = 3 + 5 * strobe;
        z.el.style.filter = `drop-shadow(0 0 ${glow}px currentColor) drop-shadow(0 0 ${glow * 2}px currentColor)`;
      }
    }
  }

  dispose(): void {
    this.off?.();
    this.off = undefined;
    for (const z of this.zaps) z.el.remove();
    this.zaps = [];
    if (this.style && this.style.parentNode) this.style.parentNode.removeChild(this.style);
    this.style = undefined;
    this.parent = null;
    this.resolveScore = null;
  }
}

const def: EddieParticlesDef = {
  id: "fx02",
  label: "Electric Zaps",
  blurb: "Jagged lightning glyphs snap toward the score with a flickering charge-glow, scattering tiny white sparks.",
  create: () => new Fx02(),
};

export default def;
