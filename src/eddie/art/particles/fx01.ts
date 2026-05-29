// fx01 — "Chroma Shards": chunky pixel blocks that home to the score with a
// chromatic RGB-split glitch. Each block carries two offset ghost copies (a cyan
// and a magenta channel) that separate and re-converge as it travels, plus a
// 1-frame horizontal tear jitter so the motion reads as a glitching CRT signal.
// A fraction are tiny pixel digits (0-9) for arcade flavor. Pure DOM, no Three.js.
//
// Evolved from the old fx05 "Pixel Burst": same crisp pixel-grid snapping and
// digit sprites, but the burst-march is replaced with an RGB-split datachannel
// glitch homing run. Blocks self-remove on arrival; dispose() removes every
// element + injected <style> and unsubscribes (no leaks).

import type { EddieParticlesDef, EddieParticlesVariant } from "./types";
import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";

const STYLE_ID = "eddie-fx01-chroma-style";
const STEP = 4; // px snap grid — chunky IIgs pixel cadence
const DIGITS = "0123456789";
// Limited retro palette (Apple IIgs-ish saturated set) used for the core block.
const PALETTE = ["#00f0ff", "#ff2bd6", "#ffd02b", "#c7ff2b", "#ffffff"];

interface Shard {
  el: HTMLDivElement; // wrapper
  rGhost: HTMLDivElement; // red/magenta channel ghost
  bGhost: HTMLDivElement; // blue/cyan channel ghost
  x0: number;
  y0: number;
  cx: number; // arc control
  cy: number;
  t: number;
  dur: number;
  glitchPhase: number;
  glitchRate: number;
}

class Fx01 implements EddieParticlesVariant {
  private parent: HTMLElement | null = null;
  private resolveScore: (() => { x: number; y: number }) | null = null;
  private shards: Shard[] = [];
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
.eddie-fx01-shard{position:absolute;left:0;top:0;pointer-events:none;
  will-change:transform,opacity;image-rendering:pixelated;}
.eddie-fx01-px{position:absolute;left:0;top:0;image-rendering:pixelated;
  will-change:transform;}
.eddie-fx01-core{box-shadow:0 0 0 1px rgba(0,0,0,.5),0 0 7px currentColor;}
.eddie-fx01-ghost{mix-blend-mode:screen;opacity:.85;}
.eddie-fx01-digit{position:absolute;left:0;top:0;pointer-events:none;
  font-family:"Courier New",monospace;font-weight:900;line-height:1;
  -webkit-font-smoothing:none;image-rendering:pixelated;will-change:transform,opacity;
  text-shadow:1px 0 0 #ff2bd6,-1px 0 0 #00f0ff,0 0 6px currentColor;}`;
    document.head.appendChild(s);
    this.styleEl = s;
  }

  private spawn(x: number, y: number, count: number, color: string): void {
    if (!this.parent) return;
    const rect = this.parent.getBoundingClientRect();
    const lx = x - rect.left;
    const ly = y - rect.top;

    for (let i = 0; i < count; i++) {
      const isDigit = Math.random() < 0.3;
      const jx = (Math.random() - 0.5) * 44;
      const jy = (Math.random() - 0.5) * 44;
      const x0 = snap(lx + jx);
      const y0 = snap(ly + jy);

      const wrap = document.createElement("div");
      wrap.className = "eddie-fx01-shard";

      let core: HTMLDivElement;
      const rGhost = document.createElement("div");
      const bGhost = document.createElement("div");

      if (isDigit) {
        const size = 12 + Math.random() * 8;
        const ch = DIGITS[(Math.random() * 10) | 0];
        core = document.createElement("div");
        core.className = "eddie-fx01-digit";
        core.textContent = ch;
        core.style.color = "#ffffff";
        core.style.fontSize = `${size}px`;
        rGhost.className = "eddie-fx01-digit eddie-fx01-ghost";
        bGhost.className = "eddie-fx01-digit eddie-fx01-ghost";
        rGhost.textContent = ch;
        bGhost.textContent = ch;
        rGhost.style.color = "#ff2bd6";
        bGhost.style.color = "#00f0ff";
        rGhost.style.fontSize = `${size}px`;
        bGhost.style.fontSize = `${size}px`;
        rGhost.style.textShadow = "none";
        bGhost.style.textShadow = "none";
      } else {
        const size = STEP * (2 + ((Math.random() * 3) | 0)); // 8..16 px chunky blocks
        const pal = PALETTE[(Math.random() * PALETTE.length) | 0] || color;
        core = document.createElement("div");
        core.className = "eddie-fx01-px eddie-fx01-core";
        core.style.background = pal;
        core.style.color = pal;
        sizePx(core, size);
        rGhost.className = "eddie-fx01-px eddie-fx01-ghost";
        bGhost.className = "eddie-fx01-px eddie-fx01-ghost";
        rGhost.style.background = "#ff2bd6";
        bGhost.style.background = "#00f0ff";
        sizePx(rGhost, size);
        sizePx(bGhost, size);
      }

      // Ghosts under the core so the bright core reads on top.
      wrap.appendChild(rGhost);
      wrap.appendChild(bGhost);
      wrap.appendChild(core);
      this.parent.appendChild(wrap);

      // Arc control biased up + toward score for a flung feel.
      const cx = x0 + (Math.random() - 0.5) * 140;
      const cy = y0 - 50 - Math.random() * 120;

      this.shards.push({
        el: wrap,
        rGhost,
        bGhost,
        x0,
        y0,
        cx,
        cy,
        t: 0,
        dur: 0.5 + Math.random() * 0.4,
        glitchPhase: Math.random() * Math.PI * 2,
        glitchRate: 26 + Math.random() * 26,
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
      const p = this.shards[i];
      p.t += dt / p.dur;
      if (p.t >= 1) {
        p.el.remove();
        this.shards.splice(i, 1);
        continue;
      }
      const e = p.t * p.t * (3 - 2 * p.t); // smoothstep
      const u = 1 - e;
      let x = u * u * p.x0 + 2 * u * e * p.cx + e * e * tx;
      let y = u * u * p.y0 + 2 * u * e * p.cy + e * e * ty;

      // 1-frame horizontal tear: occasional sudden offset that snaps back.
      p.glitchPhase += p.glitchRate * dt;
      const tear = Math.sin(p.glitchPhase) > 0.85 ? (Math.random() - 0.5) * 14 : 0;
      x = snap(x + tear);
      y = snap(y);

      // RGB split magnitude swells mid-flight, collapses on arrival.
      const split = (3 + 7 * Math.sin(Math.PI * p.t)) * (0.6 + 0.4 * Math.abs(Math.sin(p.glitchPhase)));
      this.applyGhost(p.rGhost, -split);
      this.applyGhost(p.bGhost, split);

      const fade = p.t < 0.82 ? 1 : Math.max(0, (1 - p.t) / 0.18);
      p.el.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%)`;
      p.el.style.opacity = `${fade}`;
    }
  }

  private applyGhost(g: HTMLDivElement, dx: number): void {
    g.style.transform = `translate(${Math.round(dx)}px,0)`;
  }

  dispose(): void {
    this.off?.();
    this.off = undefined;
    for (const p of this.shards) p.el.remove();
    this.shards = [];
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
  id: "fx01",
  label: "Chroma Shards",
  blurb: "Chunky pixel blocks home to the score with a chromatic RGB-split glitch, ghost channels tearing apart and snapping back.",
  create: () => new Fx01(),
};

export default def;
