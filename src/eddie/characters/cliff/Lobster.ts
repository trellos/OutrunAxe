// Lobster — Cliff Dive defender, spawned by sixteenth-note quarters (4 each).
//
// Lobsters radiate outward along the waterline fanning from bottom-left to
// bottom-right. While alive a lobster intercepts any dolphin overlapping it; the
// crowd resolves the collision and CANCELS that dolphin (its attack fizzles).
//
// TUNING (the two required tests pin the extremes): a lobster lives LOBSTER_
// LIFETIME seconds and covers a generous radius, so ONE measure of sixteenths
// (4 lobsters) thins a single dolphin wave, while FOUR measures of sixteenths
// (16 lobsters) blanket the waterline long enough to stop dolphins for TWO
// measures.
//
// HEADLESS: pure fields advanced by update(dt); DOM lazy + browser-only.

import { loadSpriteSheet } from "../SpriteLoader";

export interface LobsterConfig {
  id: number;
  /** Spawn point (a note bar near the waterline). */
  startX: number;
  /** Fan angle, radians: 0 = straight right, PI = straight left. Lobsters fan
   *  from bottom-left to bottom-right across the spawn set. */
  angle: number;
  waterY: number;
  viewW: number;
}

/** Seconds a lobster stays on the waterline before scuttling off. Tuned so a
 *  steady stream of 16ths keeps lobsterCount > 0 for two measures at typical
 *  tempos (a measure ~2s at 120bpm). */
export const LOBSTER_LIFETIME = 6.0;
/** Crawl speed along the waterline (px/sec). */
const LOBSTER_SPEED = 70;
/** Collision radius for cancelling an overlapping dolphin (px). */
export const LOBSTER_RADIUS = 34;

export class Lobster {
  readonly id: number;
  alive = true;
  age = 0;
  readonly lifetime = LOBSTER_LIFETIME;

  x: number;
  y: number;

  private vx: number;
  private viewW: number;

  el: HTMLDivElement | null = null;
  private sheet: HTMLImageElement | SVGImageElement | null = null;

  constructor(cfg: LobsterConfig) {
    this.id = cfg.id;
    this.x = cfg.startX;
    this.y = cfg.waterY;
    this.viewW = cfg.viewW;
    // Fan outward: angle near 0 -> rightward, near PI -> leftward.
    this.vx = Math.cos(cfg.angle) * LOBSTER_SPEED;
    this.ensureEl();
  }

  /** True if a point lies within this lobster's interception radius. */
  overlaps(x: number, y: number): boolean {
    return Math.hypot(this.x - x, this.y - y) <= LOBSTER_RADIUS;
  }

  update(dt: number): void {
    if (!this.alive) return;
    this.age += dt;
    this.x += this.vx * dt;
    // bounce gently at the edges so they stay on screen while alive
    if (this.x < 6) {
      this.x = 6;
      this.vx = Math.abs(this.vx);
    } else if (this.x > this.viewW - 6) {
      this.x = this.viewW - 6;
      this.vx = -Math.abs(this.vx);
    }
    if (this.age >= this.lifetime) this.alive = false;
    this.render();
  }

  private ensureEl(): void {
    if (typeof document === "undefined") return;
    if (this.el) return;
    const el = document.createElement("div");
    el.className = "cliff-lobster";
    el.style.cssText =
      "position:absolute;width:18px;height:14px;pointer-events:none;" +
      "image-rendering:pixelated;background-repeat:no-repeat;z-index:8;";
    this.el = el;
    loadSpriteSheet("lobster").then((img) => (this.sheet = img)).catch(() => {});
  }

  private render(): void {
    const el = this.el;
    if (!el) return;
    el.style.left = `${this.x - 9}px`;
    el.style.top = `${this.y - 7}px`;
    const fade = this.age > this.lifetime - 1 ? Math.max(0, this.lifetime - this.age) : 1;
    if (this.sheet) {
      const frame = Math.floor(this.age * 8) % 2;
      el.style.backgroundColor = "transparent";
      el.style.backgroundImage = `url(${(this.sheet as HTMLImageElement).src})`;
      el.style.backgroundSize = "auto";
      el.style.backgroundPosition = `-${frame * 18}px 0`;
      el.style.opacity = String(fade);
    } else {
      el.style.backgroundColor = "#ff5630";
      el.style.borderRadius = "5px";
      el.style.boxShadow = "0 0 5px #ff5630";
      el.style.opacity = String(fade);
    }
  }

  dispose(): void {
    this.el?.remove();
    this.el = null;
  }
}
