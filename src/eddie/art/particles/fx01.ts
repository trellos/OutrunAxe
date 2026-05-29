// fx01 — "Chrome Shards": angular metallic shard rectangles that spin and catch
// light (CSS gradient sheen) as they arc to the score readout, trailing a faint
// motion streak. Pure DOM, no Three.js. Default-exports an EddieParticlesDef.
//
// Motion: each shard is flung from `from` along a quadratic Bezier toward the
// score, with a strong upward/outward control point for a "thrown metal" arc.
// Shards spin on two axes (rotateZ + skew sheen) and scale down on arrival; a
// short-lived streak element rides behind each shard and fades. dispose() removes
// every live element and the injected <style>, and unsubscribes.

import type { EddieParticlesDef, EddieParticlesVariant } from "./types";
import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";

interface Shard {
  el: HTMLDivElement;
  sheen: HTMLDivElement;
  streak: HTMLDivElement;
  x0: number;
  y0: number;
  cx: number;
  cy: number;
  t: number;
  dur: number;
  spin: number; // deg/sec
  rot: number; // current rotation
  len: number; // shard length px
  wide: number; // shard width px
  px: number; // previous frame x (for streak orientation)
  py: number;
}

const STYLE_ID = "eddie-fx01-style";

class Fx01 implements EddieParticlesVariant {
  private parent: HTMLElement | null = null;
  private resolveScore: (() => { x: number; y: number }) | null = null;
  private shards: Shard[] = [];
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
.eddie-fx01-shard {
  position: absolute;
  pointer-events: none;
  will-change: transform, opacity;
  transform-origin: 50% 50%;
  border-radius: 1px;
  overflow: hidden;
  box-shadow: 0 0 6px currentColor, 0 0 14px currentColor;
}
.eddie-fx01-sheen {
  position: absolute;
  inset: -40%;
  background: linear-gradient(115deg,
    rgba(255,255,255,0) 30%,
    rgba(255,255,255,0.95) 48%,
    rgba(255,255,255,0) 62%);
  mix-blend-mode: screen;
  will-change: transform;
}
.eddie-fx01-streak {
  position: absolute;
  pointer-events: none;
  height: 2px;
  transform-origin: 0% 50%;
  background: linear-gradient(90deg, currentColor, rgba(255,255,255,0));
  opacity: 0.5;
  will-change: transform, opacity, width;
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
      const jx = (Math.random() - 0.5) * 46;
      const jy = (Math.random() - 0.5) * 46;
      const sx = localX + jx;
      const sy = localY + jy;

      const len = 14 + Math.random() * 16;
      const wide = 3 + Math.random() * 4;

      const el = document.createElement("div");
      el.className = "eddie-fx01-shard";
      el.style.color = color;
      el.style.width = `${len}px`;
      el.style.height = `${wide}px`;
      el.style.background = `linear-gradient(90deg, ${color}, #ffffff 45%, ${color})`;

      const sheen = document.createElement("div");
      sheen.className = "eddie-fx01-sheen";
      el.appendChild(sheen);

      const streak = document.createElement("div");
      streak.className = "eddie-fx01-streak";
      streak.style.color = color;
      streak.style.width = "0px";

      this.parent.appendChild(streak);
      this.parent.appendChild(el);

      // Control point flung up and outward for a tossed-metal arc.
      const cx = sx + (Math.random() - 0.5) * 160;
      const cy = sy - 70 - Math.random() * 140;

      this.shards.push({
        el,
        sheen,
        streak,
        x0: sx,
        y0: sy,
        cx,
        cy,
        t: 0,
        dur: 0.5 + Math.random() * 0.4,
        spin: (Math.random() < 0.5 ? -1 : 1) * (240 + Math.random() * 420),
        rot: Math.random() * 360,
        len,
        wide,
        px: sx,
        py: sy,
      });
    }
  }

  update(dt: number): void {
    if (!this.parent || !this.resolveScore || this.shards.length === 0) return;
    const rect = this.parent.getBoundingClientRect();
    const score = this.resolveScore();
    const tx = score.x - rect.left;
    const ty = score.y - rect.top;

    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      s.t += dt / s.dur;
      if (s.t >= 1) {
        s.el.remove();
        s.streak.remove();
        this.shards.splice(i, 1);
        continue;
      }
      const e = s.t * s.t * (3 - 2 * s.t); // smoothstep
      const u = 1 - e;
      const x = u * u * s.x0 + 2 * u * e * s.cx + e * e * tx;
      const y = u * u * s.y0 + 2 * u * e * s.cy + e * e * ty;

      s.rot += s.spin * dt;
      const scale = 1 - e * 0.55;
      const fade = e < 0.82 ? 1 : Math.max(0, (1 - e) / 0.18);

      // Position the shard centered on (x, y).
      s.el.style.left = `${x - s.len / 2}px`;
      s.el.style.top = `${y - s.wide / 2}px`;
      s.el.style.transform = `rotate(${s.rot}deg) scale(${scale})`;
      s.el.style.opacity = `${fade}`;

      // Sheen sweeps across the shard as it spins, catching the light.
      const sheenPhase = ((s.rot % 360) + 360) % 360;
      s.sheen.style.transform = `translateX(${-60 + (sheenPhase / 360) * 120}%)`;

      // Streak rides from the previous frame position to the current one.
      const dx = x - s.px;
      const dy = y - s.py;
      const dist = Math.hypot(dx, dy);
      const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
      s.streak.style.left = `${s.px}px`;
      s.streak.style.top = `${s.py}px`;
      s.streak.style.width = `${Math.min(dist * 1.6, 40)}px`;
      s.streak.style.transform = `rotate(${ang}deg)`;
      s.streak.style.opacity = `${0.45 * fade}`;
      s.px = x;
      s.py = y;
    }
  }

  dispose(): void {
    this.off?.();
    this.off = undefined;
    for (const s of this.shards) {
      s.el.remove();
      s.streak.remove();
    }
    this.shards = [];
    if (this.style && this.style.parentNode) this.style.parentNode.removeChild(this.style);
    this.style = undefined;
    this.parent = null;
    this.resolveScore = null;
  }
}

const def: EddieParticlesDef = {
  id: "fx01",
  label: "Chrome Shards",
  blurb: "Angular metallic shards spin and catch a sweeping sheen as they arc to the score, dragging faint streaks.",
  create: () => new Fx01(),
};

export default def;
