// EddieFire — measures lighting ON FIRE when 8th/16th challenges are nailed
// (GDD §8). Subscribes to the juice bus eddieFire { measure, tier }: tier 1 = an
// 8th-tag clear (a contained flame), tier 2 = a 16th-tag clear (a bigger, hotter
// inferno). The fire is anchored over the cleared measure's grid cell, resolved
// via the `resolveCell` callback the factory wires from the grid.
//
// VARIANT option-3: "retro pixel-fire automaton" — the classic Doom fire
// cellular automaton. Each burst keeps a low-res heat grid: the bottom row is
// seeded hot, and every step each pixel cools by a random amount and drifts
// sideways, propagating upward. Mapped through a synthwave palette ramp
// (amber->magenta->violet) and blitted NEAREST-scaled into the cell for chunky
// 8-bit fire. Pure DOM/canvas; dispose() removes all layers.

import type { EventBus } from "../../engine/EventBus";
import type { EddieJuiceEvents } from "../../music/eddie/eddieTypes";

// Heat -> RGBA palette ramp (index 0 = cold/transparent, high = white-hot).
// 37 stops, synthwave-tinted: violet -> magenta -> orange -> amber -> white.
const PALETTE: [number, number, number, number][] = (() => {
  const stops: [number, number, number][] = [
    [7, 7, 12], // 0 ~ ember off (rendered transparent)
    [44, 8, 60], // deep violet
    [90, 18, 110],
    [177, 75, 255], // violet
    [255, 43, 214], // magenta
    [255, 90, 140],
    [255, 122, 43], // orange
    [255, 170, 60],
    [255, 208, 43], // amber
    [255, 240, 170],
    [255, 255, 255], // white-hot
  ];
  const out: [number, number, number, number][] = [];
  const n = 37;
  for (let i = 0; i < n; i++) {
    const f = (i / (n - 1)) * (stops.length - 1);
    const lo = Math.floor(f);
    const hi = Math.min(stops.length - 1, lo + 1);
    const t = f - lo;
    const r = Math.round(stops[lo][0] + (stops[hi][0] - stops[lo][0]) * t);
    const g = Math.round(stops[lo][1] + (stops[hi][1] - stops[lo][1]) * t);
    const b = Math.round(stops[lo][2] + (stops[hi][2] - stops[lo][2]) * t);
    const a = i === 0 ? 0 : Math.min(255, Math.round((i / 6) * 255));
    out.push([r, g, b, a]);
  }
  return out;
})();
const MAX_HEAT = PALETTE.length - 1;

interface Burst {
  display: HTMLCanvasElement; // scaled-up, on-screen
  dctx: CanvasRenderingContext2D;
  buffer: HTMLCanvasElement; // low-res heat render
  bctx: CanvasRenderingContext2D;
  heat: Uint8Array; // gw*gh heat grid
  gw: number;
  gh: number;
  age: number;
  duration: number;
  stepAccum: number;
  tier: 1 | 2;
}

const STEP_DT = 1 / 60; // automaton tick

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
    const w = rect ? Math.ceil(rect.width) : 160;
    const h = rect ? Math.ceil(rect.height * 1.8) : 220;
    const left = rect ? rect.left - parentRect.left : parentRect.width / 2 - w / 2;
    const top = rect ? rect.bottom - parentRect.top - h : parentRect.height / 2 - h / 2;

    const display = document.createElement("canvas");
    display.width = w;
    display.height = h;
    display.style.position = "absolute";
    display.style.left = `${left}px`;
    display.style.top = `${top}px`;
    display.style.pointerEvents = "none";
    display.style.zIndex = "5";
    display.style.imageRendering = "pixelated";
    this.parent.appendChild(display);

    // Low-res heat grid: a few px per cell-width for chunky fire.
    const gw = Math.max(16, Math.round(w / 6));
    const gh = Math.max(20, Math.round(h / 6));
    const buffer = document.createElement("canvas");
    buffer.width = gw;
    buffer.height = gh;

    this.bursts.push({
      display,
      dctx: display.getContext("2d")!,
      buffer,
      bctx: buffer.getContext("2d")!,
      heat: new Uint8Array(gw * gh),
      gw,
      gh,
      age: 0,
      duration: tier === 2 ? 1.5 : 1.0,
      stepAccum: 0,
      tier,
    });
  }

  private seedBottom(b: Burst, intensity: number): void {
    const { heat, gw, gh } = b;
    const base = (gh - 1) * gw;
    if (intensity <= 0) {
      // Not feeding: clear the base so the column cools and the fire dies out.
      for (let x = 0; x < gw; x++) heat[base + x] = 0;
      return;
    }
    for (let x = 0; x < gw; x++) {
      heat[base + x] = Math.random() < intensity ? MAX_HEAT : Math.floor(MAX_HEAT * 0.7);
    }
  }

  private step(b: Burst): void {
    const { heat, gw, gh } = b;
    // Propagate upward: each pixel = pixel below minus a random decay, with a
    // random horizontal wind so flames curl.
    for (let y = 0; y < gh - 1; y++) {
      for (let x = 0; x < gw; x++) {
        const below = heat[(y + 1) * gw + x];
        const decay = (Math.random() * 3) | 0;
        const wind = ((Math.random() * 3) | 0) - 1;
        const dst = x + wind;
        const v = Math.max(0, below - decay);
        if (dst >= 0 && dst < gw) heat[y * gw + dst] = v;
        else heat[y * gw + x] = v;
      }
    }
  }

  private blit(b: Burst, fade: number): void {
    const { bctx, gw, gh, heat } = b;
    const img = bctx.createImageData(gw, gh);
    const data = img.data;
    for (let i = 0; i < heat.length; i++) {
      const p = PALETTE[heat[i]];
      const o = i * 4;
      data[o] = p[0];
      data[o + 1] = p[1];
      data[o + 2] = p[2];
      data[o + 3] = Math.round(p[3] * fade);
    }
    bctx.putImageData(img, 0, 0);
    // NEAREST scale-up to the display canvas.
    const dctx = b.dctx;
    dctx.clearRect(0, 0, b.display.width, b.display.height);
    dctx.imageSmoothingEnabled = false;
    dctx.drawImage(b.buffer, 0, 0, gw, gh, 0, 0, b.display.width, b.display.height);
  }

  update(dt: number): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.age += dt;

      // Keep feeding the base while the burst is "burning"; stop seeding in the
      // tail so the fire dies out naturally.
      const feeding = b.age < b.duration * 0.7;
      const fade = b.age <= b.duration ? 1 : Math.max(0, 1 - (b.age - b.duration) / 0.4);

      b.stepAccum += dt;
      // Fixed-step the automaton so the look is framerate-independent.
      let steps = 0;
      while (b.stepAccum >= STEP_DT && steps < 4) {
        b.stepAccum -= STEP_DT;
        steps++;
        if (feeding) this.seedBottom(b, b.tier === 2 ? 0.9 : 0.65);
        else this.seedBottom(b, 0); // clear base so it cools
        this.step(b);
      }
      this.blit(b, fade);

      if (b.age > b.duration + 0.4) {
        b.display.remove();
        this.bursts.splice(i, 1);
      }
    }
  }

  dispose(): void {
    this.off?.();
    this.off = undefined;
    for (const b of this.bursts) b.display.remove();
    this.bursts = [];
    this.parent = null;
    this.resolveCell = null;
  }
}
