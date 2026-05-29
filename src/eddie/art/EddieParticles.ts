// EddieParticles — score particles flying to the score readout (GDD §8).
//
// Subscribes to the juice bus eddieParticles { from, count, color }: spawns
// `count` particles at `from` (viewport coords) and animates them on a curved
// path toward the score readout, resolved via the `resolveScore` callback the
// factory wires from the rig's score element. Pure DOM; dispose() removes all
// live particles (zero Three.js resources).
//
// VARIANT option-1: "neon comet streaks" — round glowing DOM dots driven by a
// JS-eased lerp from origin to the score, with a slight arc and shrink-on-arrival.
// Each particle self-removes when it reaches the readout.

import type { EventBus } from "../../engine/EventBus";
import type { EddieJuiceEvents } from "../../music/eddie/eddieTypes";

interface Particle {
  el: HTMLDivElement;
  x0: number;
  y0: number;
  cx: number; // control point for the arc
  cy: number;
  t: number; // 0..1 progress
  dur: number; // seconds
  size: number;
}

export class EddieParticles {
  private parent: HTMLElement | null = null;
  private resolveScore: (() => { x: number; y: number }) | null = null;
  private particles: Particle[] = [];
  private off?: () => void;

  mount(ctx: {
    hudParent: HTMLElement;
    juice: EventBus<EddieJuiceEvents>;
    resolveScore: () => { x: number; y: number };
  }): void {
    this.parent = ctx.hudParent;
    this.resolveScore = ctx.resolveScore;
    this.off = ctx.juice.on("eddieParticles", (e) => {
      this.spawn(e.from.x, e.from.y, Math.max(1, Math.min(40, e.count)), e.color);
    });
  }

  private spawn(x: number, y: number, count: number, color: string): void {
    if (!this.parent) return;
    const parentRect = this.parent.getBoundingClientRect();
    const localX = x - parentRect.left;
    const localY = y - parentRect.top;
    for (let i = 0; i < count; i++) {
      const el = document.createElement("div");
      el.className = "eddie-particle";
      el.style.color = color;
      el.style.background = color;
      const size = 5 + Math.random() * 7;
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      const jx = (Math.random() - 0.5) * 40;
      const jy = (Math.random() - 0.5) * 40;
      el.style.left = `${localX + jx}px`;
      el.style.top = `${localY + jy}px`;
      this.parent.appendChild(el);

      // Arc control point biased upward + toward the score for a flung feel.
      const cx = localX + jx + (Math.random() - 0.5) * 120;
      const cy = localY + jy - 40 - Math.random() * 120;
      this.particles.push({
        el,
        x0: localX + jx,
        y0: localY + jy,
        cx,
        cy,
        t: 0,
        dur: 0.45 + Math.random() * 0.35,
        size,
      });
    }
  }

  update(dt: number): void {
    if (!this.parent || !this.resolveScore || this.particles.length === 0) return;
    const parentRect = this.parent.getBoundingClientRect();
    const score = this.resolveScore();
    const tx = score.x - parentRect.left;
    const ty = score.y - parentRect.top;

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.t += dt / p.dur;
      if (p.t >= 1) {
        p.el.remove();
        this.particles.splice(i, 1);
        continue;
      }
      // Quadratic Bezier: x0 -> control -> score target, eased.
      const e = p.t * p.t * (3 - 2 * p.t); // smoothstep
      const u = 1 - e;
      const x = u * u * p.x0 + 2 * u * e * p.cx + e * e * tx;
      const y = u * u * p.y0 + 2 * u * e * p.cy + e * e * ty;
      p.el.style.left = `${x}px`;
      p.el.style.top = `${y}px`;
      const scale = 1 - e * 0.6;
      p.el.style.transform = `scale(${scale})`;
      p.el.style.opacity = `${e < 0.85 ? 1 : (1 - e) / 0.15}`;
    }
  }

  dispose(): void {
    this.off?.();
    this.off = undefined;
    for (const p of this.particles) p.el.remove();
    this.particles = [];
    this.parent = null;
    this.resolveScore = null;
  }
}
