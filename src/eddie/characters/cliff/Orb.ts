// Orb — Cliff Dive healing pickup, spawned by triplet quarters (3 each).
//
// An orb flies to a man who needs health (hp < max) and heals him on arrival.
// The crowd owns the targeting/heal POLICY (which men, how many); the orb is a
// dumb seeker that reports arrived(). With no assigned target it pulses around
// its spawn bar until the crowd assigns one. The crowd may put the 3rd orb in a
// "slow-seek" mode (slower fly) when fewer than 3 men are needy.
//
// HEADLESS: pure fields advanced by update(dt); DOM lazy + browser-only.

import { loadSpriteSheet } from "../SpriteLoader";

export type OrbPhase = "pulsing" | "seeking" | "consumed";

export interface OrbConfig {
  id: number;
  /** Spawn position (a triplet note bar). */
  startX: number;
  startY: number;
}

/** Px/sec the orb flies toward its target. */
const ORB_SPEED = 420;
const ORB_SLOW_SPEED = 180;
/** Arrival distance (px). */
const ARRIVE_DIST = 10;

export class Orb {
  readonly id: number;
  phase: OrbPhase = "pulsing";
  targetId: number | null = null;

  x: number;
  y: number;
  private spawnX: number;
  private spawnY: number;
  private slow = false;
  private clock = 0;
  /** Live target position, refreshed by the crowd each frame via aimAt(). */
  private targetX = 0;
  private targetY = 0;
  private hasTargetPos = false;

  el: HTMLDivElement | null = null;
  private sheet: HTMLImageElement | SVGImageElement | null = null;

  constructor(cfg: OrbConfig) {
    this.id = cfg.id;
    this.x = cfg.startX;
    this.y = cfg.startY;
    this.spawnX = cfg.startX;
    this.spawnY = cfg.startY;
    this.ensureEl();
  }

  /** Crowd assigns a target man (by id) and whether to slow-seek. */
  assign(targetId: number, slow = false): void {
    this.targetId = targetId;
    this.slow = slow;
    this.phase = "seeking";
  }

  /** Crowd unassigns (target died/healed before arrival): back to pulsing. */
  unassign(): void {
    this.targetId = null;
    this.phase = "pulsing";
    this.hasTargetPos = false;
  }

  /** Crowd feeds the live target position each frame while seeking. */
  aimAt(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
    this.hasTargetPos = true;
  }

  get consumed(): boolean {
    return this.phase === "consumed";
  }

  /** True once the orb is at its target. The crowd applies the heal + consumes. */
  arrived(): boolean {
    if (this.phase !== "seeking" || !this.hasTargetPos) return false;
    return Math.hypot(this.targetX - this.x, this.targetY - this.y) <= ARRIVE_DIST;
  }

  consume(): void {
    this.phase = "consumed";
  }

  update(dt: number): void {
    this.clock += dt;
    if (this.phase === "consumed") {
      this.render();
      return;
    }
    if (this.phase === "seeking" && this.hasTargetPos) {
      const speed = this.slow ? ORB_SLOW_SPEED : ORB_SPEED;
      const dx = this.targetX - this.x;
      const dy = this.targetY - this.y;
      const d = Math.hypot(dx, dy) || 1;
      const step = Math.min(d, speed * dt);
      this.x += (dx / d) * step;
      this.y += (dy / d) * step;
    } else {
      // Pulse a small orbit around the spawn bar.
      const r = 8;
      this.x = this.spawnX + Math.cos(this.clock * 3) * r;
      this.y = this.spawnY + Math.sin(this.clock * 3) * r;
    }
    this.render();
  }

  private ensureEl(): void {
    if (typeof document === "undefined") return;
    if (this.el) return;
    const el = document.createElement("div");
    el.className = "cliff-orb";
    el.style.cssText =
      "position:absolute;width:14px;height:14px;pointer-events:none;z-index:9;" +
      "border-radius:50%;";
    this.el = el;
    loadSpriteSheet("orb").then((img) => (this.sheet = img)).catch(() => {});
  }

  private render(): void {
    const el = this.el;
    if (!el) return;
    el.style.left = `${this.x - 7}px`;
    el.style.top = `${this.y - 7}px`;
    if (this.sheet) {
      const frame = Math.floor(this.clock * 10) % 3;
      el.style.background = "none";
      el.style.backgroundImage = `url(${(this.sheet as HTMLImageElement).src})`;
      el.style.backgroundSize = "auto";
      el.style.backgroundRepeat = "no-repeat";
      el.style.backgroundPosition = `-${frame * 14}px 0`;
    } else {
      el.style.background =
        "radial-gradient(circle,#eafff0 0%,#52ffa8 45%,rgba(82,255,168,0) 75%)";
      el.style.boxShadow = "0 0 8px #52ffa8";
    }
    const pulse = 0.8 + 0.2 * Math.sin(this.clock * 8);
    el.style.transform = `scale(${pulse.toFixed(2)})`;
    el.style.opacity = this.phase === "consumed" ? "0" : "1";
  }

  dispose(): void {
    this.el?.remove();
    this.el = null;
  }
}
