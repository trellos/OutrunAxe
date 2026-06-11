// Dolphin — a Cliff Dive attacker that BREACHES out of the ocean.
//
// It launches from the waterline beside a measure box's vertical edge, leaps in
// a tight parabolic arc up to the foot of that edge (tilting nose-up on the way
// up, nose-down on the way down, like a real breaching dolphin), spits at one
// climber on that edge at the apex, then falls back into the sea. It does NOT
// traverse the whole screen. A climber is never targeted twice in one wave.
// Colliding with a live lobster CANCELS the dolphin: it dives back without
// spitting.
//
// When the player is doing well (high intensity) it RENDERS as a MERMAID
// (sprite swap only — identical gameplay) via setMermaid(true).
//
// HEADLESS: pure sim fields advanced by update(dt); DOM (this.el) is lazy and
// browser-only so the crowd runs in node tests.

import { loadSpriteSheet } from "../SpriteLoader";

/** On-screen render scale (matches the climbers' 1.8x so line weights agree). */
const SCALE = 1.8;
const CW = 40; // sprite cell width (design px)
const CH = 24; // sprite cell height
/** Max nose tilt (degrees) along the leap arc. */
const TILT_DEG = 55;

export interface DolphinConfig {
  id: number;
  /** Target measure box (so the crowd can map spit→that edge's climbers). */
  targetMeasure: number;
  /** "left" | "right" — which vertical edge of the box this dolphin menaces. */
  targetEdge: "left" | "right";
  /** X of the target edge (where the spit lands; the arc peaks here). */
  edgeX: number;
  /** Leap geometry: a SHORT arc startX -> endX (centred on edgeX), peaking at
   *  peakY (the foot of the cliff edge). */
  startX: number;
  endX: number;
  baseY: number; // waterline the leap launches from / lands at
  peakY: number; // apex height (smaller y = higher)
  /** Seconds for the whole leap. */
  duration: number;
}

export class Dolphin {
  readonly id: number;
  readonly targetMeasure: number;
  readonly targetEdge: "left" | "right";
  readonly edgeX: number;

  progress = 0; // 0..1 across the leap
  hasSpat = false;
  cancelled = false;
  alive = true;
  isMermaid = false;

  x: number;
  y: number;

  private startX: number;
  private endX: number;
  private baseY: number;
  private peakY: number;
  private duration: number;
  private dir: number; // +1 leaping right, -1 leaping left
  /** Arc progress (0..1) at which the dolphin is over its edge (apex). */
  private spitAt: number;
  private diveProgress = 0; // when cancelled, dives this far past current point

  el: HTMLDivElement | null = null;
  private dolphinSheet: HTMLImageElement | SVGImageElement | null = null;
  private mermaidSheet: HTMLImageElement | SVGImageElement | null = null;

  constructor(cfg: DolphinConfig) {
    this.id = cfg.id;
    this.targetMeasure = cfg.targetMeasure;
    this.targetEdge = cfg.targetEdge;
    this.edgeX = cfg.edgeX;
    this.startX = cfg.startX;
    this.endX = cfg.endX;
    this.baseY = cfg.baseY;
    this.peakY = cfg.peakY;
    this.duration = Math.max(0.1, cfg.duration);
    this.dir = cfg.endX >= cfg.startX ? 1 : -1;
    this.x = cfg.startX;
    this.y = cfg.baseY;
    // The arc reaches edgeX at this fraction of its span (the apex, ~0.5).
    const span = this.endX - this.startX;
    this.spitAt =
      Math.abs(span) < 1
        ? 0.5
        : Math.max(0.05, Math.min(0.95, (this.edgeX - this.startX) / span));
    this.ensureEl();
  }

  setMermaid(on: boolean): void {
    this.isMermaid = on;
  }

  /** Cancel this dolphin (hit a lobster): it dives down and never spits. */
  cancel(): void {
    if (this.hasSpat) return;
    this.cancelled = true;
  }

  /** True the moment the dolphin reaches its edge (apex) and is ready to spit. */
  get readyToSpit(): boolean {
    return (
      this.alive && !this.cancelled && !this.hasSpat && this.progress >= this.spitAt
    );
  }

  markSpat(): void {
    this.hasSpat = true;
  }

  update(dt: number): void {
    if (!this.alive) return;
    if (this.cancelled) {
      // Dive back into the water and disappear.
      this.diveProgress += dt / 0.4;
      this.y += 320 * dt;
      if (this.diveProgress >= 1 || this.y >= this.baseY + 60) this.alive = false;
      this.render();
      return;
    }
    this.progress += dt / this.duration;
    if (this.progress >= 1) {
      this.progress = 1;
      this.alive = false;
    }
    const p = this.progress;
    this.x = this.startX + (this.endX - this.startX) * p;
    // Parabolic leap: 0 at the waterline ends, 1 at the apex over the edge.
    const arc = 4 * p * (1 - p);
    this.y = this.baseY + (this.peakY - this.baseY) * arc;
    this.render();
  }

  // --- rendering (browser-only) ---------------------------------------------

  private ensureEl(): void {
    if (typeof document === "undefined") return;
    if (this.el) return;
    const el = document.createElement("div");
    el.className = "cliff-dolphin";
    el.style.cssText =
      `position:absolute;width:${CW * SCALE}px;height:${CH * SCALE}px;` +
      "pointer-events:none;image-rendering:pixelated;background-repeat:no-repeat;" +
      "z-index:9;transform-origin:50% 50%;";
    this.el = el;
    loadSpriteSheet("dolphin").then((img) => (this.dolphinSheet = img)).catch(() => {});
    loadSpriteSheet("mermaid").then((img) => (this.mermaidSheet = img)).catch(() => {});
  }

  private render(): void {
    const el = this.el;
    if (!el) return;
    el.style.left = `${this.x - (CW * SCALE) / 2}px`;
    el.style.top = `${this.y - (CH * SCALE) / 2}px`;
    // Tilt the nose along the leap arc (up on the way up, down on the way down),
    // facing the leap direction. Cancelled = nose-down plunge.
    const tilt = this.cancelled ? 70 : (this.progress - 0.5) * TILT_DEG;
    const transform = (this.dir > 0 ? "scaleX(-1) " : "") + `rotate(${tilt}deg)`;
    const sheet = this.isMermaid ? this.mermaidSheet : this.dolphinSheet;
    if (sheet) {
      const img = sheet as HTMLImageElement;
      const frame = this.cancelled ? 2 : this.hasSpat ? 1 : 0;
      el.style.backgroundColor = "transparent";
      el.style.backgroundImage = `url(${img.src})`;
      el.style.backgroundSize = `${img.naturalWidth * SCALE}px ${img.naturalHeight * SCALE}px`;
      el.style.backgroundPosition = `-${frame * CW * SCALE}px 0`;
      el.style.transform = transform;
    } else {
      el.style.backgroundColor = this.isMermaid ? "#ff66cc" : "#1f93c4";
      el.style.borderRadius = "12px 12px 12px 4px";
      el.style.boxShadow = `0 0 6px ${this.isMermaid ? "#ff66cc" : "#1f93c4"}`;
      el.style.transform = transform;
      el.style.opacity = this.cancelled ? "0.6" : "1";
    }
  }

  dispose(): void {
    this.el?.remove();
    this.el = null;
  }
}
