// fx03 — "Cassette Confetti": little 80s icons (tape-reel rectangles, triangles,
// stars) tumbling with rotation and a paper-confetti flutter as they home to the
// score readout. Pure DOM, no Three.js. Default-exports an EddieParticlesDef.
//
// Motion: each piece is flung outward/up then homes toward the score on a
// quadratic Bezier. On top of the path it flutters — a sinusoidal sideways sway
// plus a scaleX "card flip" that simulates paper catching the air — while
// tumbling via rotateZ. Shapes are drawn with CSS (clip-path triangle/star, a
// two-window cassette reel rectangle). dispose() removes every live element + the
// injected <style> and unsubscribes.

import type { EddieParticlesDef, EddieParticlesVariant } from "./types";
import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";

type Shape = "reel" | "triangle" | "star";

interface Confetti {
  el: HTMLDivElement;
  x0: number;
  y0: number;
  cx: number;
  cy: number;
  t: number;
  dur: number;
  rot: number;
  spin: number; // deg/sec tumble
  flutterPhase: number;
  flutterRate: number;
  flutterAmp: number; // px sideways sway
  size: number;
}

const STYLE_ID = "eddie-fx03-style";
const SHAPES: Shape[] = ["reel", "triangle", "star"];

class Fx03 implements EddieParticlesVariant {
  private parent: HTMLElement | null = null;
  private resolveScore: (() => { x: number; y: number }) | null = null;
  private pieces: Confetti[] = [];
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
.eddie-fx03-piece {
  position: absolute;
  pointer-events: none;
  will-change: transform, opacity;
  transform-origin: 50% 50%;
}
.eddie-fx03-reel {
  border-radius: 2px;
  background: currentColor;
  box-shadow: 0 0 5px currentColor;
  display: flex;
  align-items: center;
  justify-content: space-around;
}
.eddie-fx03-reel::before,
.eddie-fx03-reel::after {
  content: "";
  width: 28%;
  height: 60%;
  border-radius: 50%;
  background: rgba(0,0,0,0.55);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.4);
}
.eddie-fx03-triangle {
  background: currentColor;
  clip-path: polygon(50% 0%, 100% 100%, 0% 100%);
  filter: drop-shadow(0 0 4px currentColor);
}
.eddie-fx03-star {
  background: currentColor;
  clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);
  filter: drop-shadow(0 0 4px currentColor);
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
      const jx = (Math.random() - 0.5) * 48;
      const jy = (Math.random() - 0.5) * 48;
      const sx = localX + jx;
      const sy = localY + jy;

      const shape = SHAPES[i % SHAPES.length];
      const size = 9 + Math.random() * 8;

      const el = document.createElement("div");
      el.style.color = color;
      if (shape === "reel") {
        el.className = "eddie-fx03-piece eddie-fx03-reel";
        el.style.width = `${size * 1.6}px`;
        el.style.height = `${size}px`;
      } else if (shape === "triangle") {
        el.className = "eddie-fx03-piece eddie-fx03-triangle";
        el.style.width = `${size}px`;
        el.style.height = `${size}px`;
      } else {
        el.className = "eddie-fx03-piece eddie-fx03-star";
        el.style.width = `${size}px`;
        el.style.height = `${size}px`;
      }
      this.parent.appendChild(el);

      // Toss up and out, then home in — confetti pops before it settles.
      const cx = sx + (Math.random() - 0.5) * 150;
      const cy = sy - 60 - Math.random() * 130;

      this.pieces.push({
        el,
        x0: sx,
        y0: sy,
        cx,
        cy,
        t: 0,
        dur: 0.62 + Math.random() * 0.45,
        rot: Math.random() * 360,
        spin: (Math.random() < 0.5 ? -1 : 1) * (160 + Math.random() * 320),
        flutterPhase: Math.random() * Math.PI * 2,
        flutterRate: 6 + Math.random() * 6,
        flutterAmp: 6 + Math.random() * 10,
        size,
      });
    }
  }

  update(dt: number): void {
    if (!this.parent || !this.resolveScore || this.pieces.length === 0) return;
    const rect = this.parent.getBoundingClientRect();
    const score = this.resolveScore();
    const tx = score.x - rect.left;
    const ty = score.y - rect.top;

    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i];
      p.t += dt / p.dur;
      if (p.t >= 1) {
        p.el.remove();
        this.pieces.splice(i, 1);
        continue;
      }
      const e = p.t * p.t * (3 - 2 * p.t); // smoothstep along the homing path
      const u = 1 - e;
      let x = u * u * p.x0 + 2 * u * e * p.cx + e * e * tx;
      const y = u * u * p.y0 + 2 * u * e * p.cy + e * e * ty;

      // Flutter: sideways sway that eases out as it nears the target.
      p.flutterPhase += p.flutterRate * dt;
      x += Math.sin(p.flutterPhase) * p.flutterAmp * (1 - e);

      // Tumble + paper "card flip" (scaleX driven by a second sine).
      p.rot += p.spin * dt;
      const flip = 0.35 + 0.65 * Math.abs(Math.cos(p.flutterPhase * 0.9));
      const scale = 1 - e * 0.4;
      const fade = e < 0.85 ? 1 : Math.max(0, (1 - e) / 0.15);

      p.el.style.left = `${x - p.size / 2}px`;
      p.el.style.top = `${y - p.size / 2}px`;
      p.el.style.transform = `rotate(${p.rot}deg) scale(${scale}) scaleX(${flip})`;
      p.el.style.opacity = `${fade}`;
    }
  }

  dispose(): void {
    this.off?.();
    this.off = undefined;
    for (const p of this.pieces) p.el.remove();
    this.pieces = [];
    if (this.style && this.style.parentNode) this.style.parentNode.removeChild(this.style);
    this.style = undefined;
    this.parent = null;
    this.resolveScore = null;
  }
}

const def: EddieParticlesDef = {
  id: "fx03",
  label: "Cassette Confetti",
  blurb: "Tape reels, triangles and stars tumble and flutter like paper confetti as they home in on the score.",
  create: () => new Fx03(),
};

export default def;
