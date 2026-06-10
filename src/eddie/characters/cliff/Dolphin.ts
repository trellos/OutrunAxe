// Dolphin — a Cliff Dive attacker.
//
// Arcs across the screen once per wave (progress 0..1 via update(dt)), aimed at
// ONE measure box's vertical edge. As it passes UNDER its target edge it spits
// at one climber on that edge (the crowd chooses the victim and applies the hit;
// a climber is never targeted twice in one wave). Colliding with a live lobster
// CANCELS the dolphin: it dives back down and never spits.
//
// When the player is doing well (high intensity) the dolphin RENDERS as a
// MERMAID (sprite swap only — identical gameplay) via setMermaid(true).
//
// HEADLESS: pure sim fields advanced by update(dt); DOM (this.el) is lazy and
// browser-only so the crowd runs in node tests.

import { loadSpriteSheet } from "../SpriteLoader";

export interface DolphinConfig {
  id: number;
  /** Target measure box (so the crowd can map spit→that edge's climbers). */
  targetMeasure: number;
  /** "left" | "right" — which vertical edge of the box this dolphin menaces. */
  targetEdge: "left" | "right";
  /** X of the target edge (where the spit lands). */
  edgeX: number;
  /** Arc geometry: the jump spans startX -> endX, peaking at peakY. */
  startX: number;
  endX: number;
  baseY: number; // water line the arc launches from / lands at
  peakY: number; // apex height (smaller y = higher)
  /** Seconds to traverse the whole arc. */
  duration: number;
}

export class Dolphin {
  readonly id: number;
  readonly targetMeasure: number;
  readonly targetEdge: "left" | "right";
  readonly edgeX: number;

  progress = 0; // 0..1 across the arc
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
  /** Arc progress (0..1) at which the dolphin is directly over its edge. */
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
    this.x = cfg.startX;
    this.y = cfg.baseY;
    // The arc reaches edgeX at this fraction of its horizontal span.
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

  /** True the moment the dolphin crosses its edge and is ready to spit. The crowd
   *  polls this each frame; once it applies the hit it calls markSpat(). */
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
    // Parabolic arc: 0 at ends, 1 at the middle.
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
      "position:absolute;width:40px;height:24px;pointer-events:none;" +
      "image-rendering:pixelated;background-repeat:no-repeat;z-index:9;";
    this.el = el;
    loadSpriteSheet("dolphin").then((img) => (this.dolphinSheet = img)).catch(() => {});
    loadSpriteSheet("mermaid").then((img) => (this.mermaidSheet = img)).catch(() => {});
  }

  private render(): void {
    const el = this.el;
    if (!el) return;
    el.style.left = `${this.x - 20}px`;
    el.style.top = `${this.y - 12}px`;
    // Face travel direction.
    const flip = this.endX < this.startX ? "scaleX(-1)" : "";
    const sheet = this.isMermaid ? this.mermaidSheet : this.dolphinSheet;
    if (sheet) {
      const frame = this.cancelled ? 2 : this.hasSpat ? 1 : 0;
      el.style.backgroundColor = "transparent";
      el.style.backgroundImage = `url(${(sheet as HTMLImageElement).src})`;
      el.style.backgroundSize = "auto";
      el.style.backgroundPosition = `-${frame * 40}px 0`;
      el.style.transform = flip;
    } else {
      el.style.backgroundColor = this.isMermaid ? "#ff66cc" : "#1f93c4";
      el.style.borderRadius = "12px 12px 12px 4px";
      el.style.boxShadow = `0 0 6px ${this.isMermaid ? "#ff66cc" : "#1f93c4"}`;
      el.style.transform = flip;
      el.style.opacity = this.cancelled ? "0.6" : "1";
    }
  }

  dispose(): void {
    this.el?.remove();
    this.el = null;
  }
}
