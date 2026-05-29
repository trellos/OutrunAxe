// EddieFire — measures lighting ON FIRE when 8th/16th challenges are nailed
// (GDD §8). Subscribes to the juice bus eddieFire { measure, tier }: tier 1 = an
// 8th-tag clear (a contained flame), tier 2 = a 16th-tag clear (a bigger, hotter
// inferno). The fire is anchored over the cleared measure's grid cell, resolved
// via the `resolveCell` callback the factory wires from the grid.
//
// VARIANT option-1: "canvas ember flames" — per-burst <canvas> layers running a
// lightweight upward ember/flame particle sim (amber->orange->magenta gradient),
// drawn in the module's own rAF-free update(dt) tick. Self-removes when spent.
// Pure DOM/canvas; dispose() removes all layers (zero Three.js resources).

import type { EventBus } from "../../engine/EventBus";
import type { EddieJuiceEvents } from "../../music/eddie/eddieTypes";

interface Ember {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
}

interface Burst {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  embers: Ember[];
  age: number;
  duration: number; // total burst time before fade-out
  tier: 1 | 2;
  w: number;
  h: number;
}

export class EddieFire {
  private parent: HTMLElement | null = null;
  private resolveCell: ((measure: number) => DOMRect | null) | null = null;
  private bursts: Burst[] = [];
  private off?: () => void;

  mount(ctx: {
    hudParent: HTMLElement;
    juice: EventBus<EddieJuiceEvents>;
    resolveCell: (measure: number) => DOMRect | null;
  }): void {
    this.parent = ctx.hudParent;
    this.resolveCell = ctx.resolveCell;
    this.off = ctx.juice.on("eddieFire", (e) => this.ignite(e.measure, e.tier));
  }

  private ignite(measure: number, tier: 1 | 2): void {
    if (!this.parent || !this.resolveCell) return;
    const rect = this.resolveCell(measure);
    const parentRect = this.parent.getBoundingClientRect();
    // Fall back to a centred burst if the cell can't be resolved yet.
    const w = rect ? Math.ceil(rect.width) : 160;
    const h = rect ? Math.ceil(rect.height * 1.8) : 220;
    const left = rect ? rect.left - parentRect.left : parentRect.width / 2 - w / 2;
    const top = rect ? rect.bottom - parentRect.top - h : parentRect.height / 2 - h / 2;

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.style.position = "absolute";
    canvas.style.left = `${left}px`;
    canvas.style.top = `${top}px`;
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = "5";
    this.parent.appendChild(canvas);

    const count = tier === 2 ? 90 : 44;
    const embers: Ember[] = [];
    for (let i = 0; i < count; i++) embers.push(this.spawnEmber(w, h, tier));

    this.bursts.push({
      canvas,
      ctx: canvas.getContext("2d")!,
      embers,
      age: 0,
      duration: tier === 2 ? 1.5 : 1.0,
      tier,
      w,
      h,
    });
  }

  private spawnEmber(w: number, h: number, tier: 1 | 2): Ember {
    const maxLife = 0.5 + Math.random() * (tier === 2 ? 0.9 : 0.6);
    return {
      x: w * (0.2 + Math.random() * 0.6),
      y: h - 4,
      vx: (Math.random() - 0.5) * 30,
      vy: -(40 + Math.random() * (tier === 2 ? 130 : 80)),
      life: 0,
      maxLife,
      size: (tier === 2 ? 9 : 6) * (0.6 + Math.random() * 0.7),
    };
  }

  update(dt: number): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.age += dt;
      const { ctx, w, h } = b;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";

      const stillFeeding = b.age < b.duration * 0.6;
      for (const e of b.embers) {
        e.life += dt;
        if (e.life >= e.maxLife) {
          if (stillFeeding) Object.assign(e, this.spawnEmber(w, h, b.tier));
          continue;
        }
        e.vy += 18 * dt; // slight buoyancy reversal => embers slow + curl
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        const k = 1 - e.life / e.maxLife; // 1 hot -> 0 cool
        const r = e.size * (0.4 + k);
        // amber core -> orange -> magenta tip as it cools/rises.
        const col =
          k > 0.66
            ? "rgba(255,240,170,"
            : k > 0.33
              ? "rgba(255,122,43,"
              : "rgba(255,43,214,";
        const a = Math.min(1, k * 1.4) * (b.age > b.duration ? Math.max(0, 1 - (b.age - b.duration) * 3) : 1);
        const grad = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
        grad.addColorStop(0, `${col}${a})`);
        grad.addColorStop(1, `${col}0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";

      // Burst fully spent (animation + fade) — remove.
      if (b.age > b.duration + 0.4) {
        b.canvas.remove();
        this.bursts.splice(i, 1);
      }
    }
  }

  dispose(): void {
    this.off?.();
    this.off = undefined;
    for (const b of this.bursts) b.canvas.remove();
    this.bursts = [];
    this.parent = null;
    this.resolveCell = null;
  }
}
