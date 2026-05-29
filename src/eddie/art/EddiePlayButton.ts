// EddiePlayButton — the juicy fire-effect PLAY button on the settings screen
// (GDD §8). Standalone factory the settings state mounts: createEddiePlayButton
// (variant).mount(parent, onPlay) / update(dt) / dispose(). Visual fire/particle
// animation runs in update(dt). dispose() removes all DOM (zero Three.js
// resources).
//
// VARIANT option-1: "amber slab with licking flames" — a chunky amber->orange
// neon button with a canvas flame plume rising behind it (same ember sim flavour
// as EddieFire), intensifying on hover. Clicking calls onPlay.

import type { EddieArtVariant } from "./eddieArtFactory";

interface Ember {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
}

export interface EddiePlayButton {
  mount(parent: HTMLElement, onPlay: () => void): void;
  update(dt: number): void;
  dispose(): void;
}

class PlayButtonOption1 implements EddiePlayButton {
  private btn: HTMLButtonElement | null = null;
  private fctx: CanvasRenderingContext2D | null = null;
  private embers: Ember[] = [];
  private onClick?: () => void;
  private hovering = false;
  private fw = 220;
  private fh = 120;

  mount(parent: HTMLElement, onPlay: () => void): void {
    const btn = document.createElement("button");
    btn.className = "eddie-root eddie-playbtn";
    // The .eddie-root rule sets position:absolute/inset:0; the button must be a
    // normal inline-block, so override the layout bits the shared root sets.
    btn.style.position = "relative";
    btn.style.inset = "auto";
    btn.style.pointerEvents = "auto";
    btn.textContent = "PLAY";

    const flame = document.createElement("canvas");
    flame.className = "eddie-playbtn-flame";
    flame.width = this.fw;
    flame.height = this.fh;
    btn.appendChild(flame);

    this.onClick = onPlay;
    btn.addEventListener("click", this.handleClick);
    btn.addEventListener("mouseenter", this.handleEnter);
    btn.addEventListener("mouseleave", this.handleLeave);

    parent.appendChild(btn);
    this.btn = btn;
    this.fctx = flame.getContext("2d");

    for (let i = 0; i < 40; i++) this.embers.push(this.spawnEmber());
  }

  private handleClick = () => this.onClick?.();
  private handleEnter = () => {
    this.hovering = true;
  };
  private handleLeave = () => {
    this.hovering = false;
  };

  private spawnEmber(): Ember {
    return {
      x: this.fw * (0.15 + Math.random() * 0.7),
      y: this.fh - 2,
      vx: (Math.random() - 0.5) * 26,
      vy: -(40 + Math.random() * 90),
      life: 0,
      maxLife: 0.5 + Math.random() * 0.7,
      size: 6 * (0.6 + Math.random() * 0.7),
    };
  }

  update(dt: number): void {
    const ctx = this.fctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this.fw, this.fh);
    ctx.globalCompositeOperation = "lighter";
    const intensity = this.hovering ? 1.6 : 1;
    for (const e of this.embers) {
      e.life += dt;
      if (e.life >= e.maxLife) {
        Object.assign(e, this.spawnEmber());
        continue;
      }
      e.vy += 16 * dt;
      e.x += e.vx * dt;
      e.y += e.vy * dt * intensity;
      const k = 1 - e.life / e.maxLife;
      const r = e.size * (0.4 + k) * intensity;
      const col =
        k > 0.66 ? "rgba(255,240,170," : k > 0.33 ? "rgba(255,122,43," : "rgba(255,43,214,";
      const grad = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
      grad.addColorStop(0, `${col}${Math.min(1, k * 1.3)})`);
      grad.addColorStop(1, `${col}0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  dispose(): void {
    if (this.btn) {
      this.btn.removeEventListener("click", this.handleClick);
      this.btn.removeEventListener("mouseenter", this.handleEnter);
      this.btn.removeEventListener("mouseleave", this.handleLeave);
      this.btn.remove();
    }
    this.btn = null;
    this.fctx = null;
    this.embers = [];
    this.onClick = undefined;
  }
}

export function createEddiePlayButton(_variant: EddieArtVariant): EddiePlayButton {
  // option-1 baseline. option-2 / option-3 branches swap this implementation.
  return new PlayButtonOption1();
}
