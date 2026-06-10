// Climber — a "man" in Cliff Dive mode.
//
// Lifecycle: hang (dead-hang by the hands on the note lane) -> shimmy (slide to
// the assigned box vertical edge) -> climb (haul up the cliff edge bottom->top)
// -> top (safe idle: walk/gaze/flex/jumping-jacks). A dolphin hit knocks the man
// down 1/4 of the box and costs 1hp; at 0hp (or falling off the bottom) the man
// falls gracefully into the water and is SAFE (dolphins ignore swimmers).
//
// HP comes from timing tightness: perfect (>=0.8) = 3hp STRONG, normal (>=0.45)
// = 2hp MEDIUM, loose = 1hp WEAK. Climb speed scales with hp: 3hp climbs a full
// box in 4 beats, 2hp in 8 beats, 1hp in 12 beats — LINEAR IN REMAINING HEIGHT,
// so a 3hp man halfway up reaches the top in 2 beats.
//
// HEADLESS: all sim state is plain fields advanced by update(dt, beatDuration).
// DOM (this.el) is created lazily and only when `document` exists, so the crowd
// can be driven in node (vitest) with no browser. Persists across grid loops —
// the crowd owns climbers, the grid only erases note bars.

import { loadSpriteSheet } from "../SpriteLoader";

export type ClimberEdge = "left" | "right" | "mid";
export type ClimberPhase =
  | "hang"
  | "shimmy"
  | "climb"
  | "top"
  | "falling"
  | "water";
export type ClimberTier = "strong" | "medium" | "weak"; // 3 / 2 / 1 hp

/** Box geometry a climber climbs: a measure cell's vertical edges. */
export interface BoxRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface ClimberConfig {
  id: number;
  /** Where the man dead-hangs at spawn (the note lane / bar position). */
  hangX: number;
  hangY: number;
  /** The box this man climbs; its left/right edges + top/bottom. */
  box: BoxRect;
  /** Which vertical edge to climb: left/right edges, or "mid" (eighths). */
  edge: ClimberEdge;
  /** HP / strength tier, from the note's timing tightness. */
  tier: ClimberTier;
  /** Water line Y (men splash here and swim). */
  waterY: number;
  /** Viewport width (clamps wandering at the top + in the water). */
  viewW: number;
}

/** Beats to climb a full box height, by current hp. */
const CLIMB_BEATS_BY_HP: Record<number, number> = { 3: 4, 2: 8, 1: 12 };
/** Knockdown from a dolphin hit, as a fraction of box height. */
const KNOCKDOWN_FRACTION = 0.25;
/** Shimmy speed (px/sec) toward the assigned edge before climbing. */
const SHIMMY_SPEED = 90;
/** Graceful fall speed (px/sec) once knocked off / out of hp. */
const FALL_SPEED = 260;

export class Climber {
  readonly id: number;
  readonly tier: ClimberTier;
  readonly maxHp: number;
  hp: number;
  edge: ClimberEdge;
  phase: ClimberPhase = "hang";

  // Position (top-left-ish anchor in viewport px). The crowd never reads these
  // for sim decisions except edge proximity; tests read heightFrac/phase/hp.
  x: number;
  y: number;

  private box: BoxRect;
  private waterY: number;
  private viewW: number;

  /** 0 at the box bottom, 1 at the box top. */
  private heightPx: number; // current px above the box bottom (clamped >=0)
  private hangTimer = 0; // brief dead-hang before shimmying
  private topWander = 0; // top-idle wander target offset
  private topAnim = 0; // top-idle animation clock (gaze/flex/jacks)
  private clock = 0;

  // DOM (lazy, browser-only).
  el: HTMLDivElement | null = null;
  private sheet: HTMLImageElement | SVGImageElement | null = null;
  private gold = false; // finale: gleaming gold surfacing diver

  constructor(cfg: ClimberConfig) {
    this.id = cfg.id;
    this.tier = cfg.tier;
    this.maxHp = cfg.tier === "strong" ? 3 : cfg.tier === "medium" ? 2 : 1;
    this.hp = this.maxHp;
    this.edge = cfg.edge;
    this.box = cfg.box;
    this.waterY = cfg.waterY;
    this.viewW = cfg.viewW;
    this.x = cfg.hangX;
    this.y = cfg.hangY;
    this.heightPx = 0;
    this.hangTimer = 0.25;
    this.ensureEl();
  }

  /** Box height in px (>=1 to avoid div-by-zero in headless stubs). */
  private boxHeight(): number {
    return Math.max(1, this.box.bottom - this.box.top);
  }

  /** Target X for the assigned edge. */
  private edgeX(): number {
    if (this.edge === "left") return this.box.left;
    if (this.edge === "right") return this.box.right;
    return (this.box.left + this.box.right) / 2;
  }

  /** 0..1 up the box (0 = bottom, 1 = top). Tests assert this. */
  get heightFrac(): number {
    return Math.max(0, Math.min(1, this.heightPx / this.boxHeight()));
  }

  get safe(): boolean {
    return this.phase === "top" || this.phase === "water";
  }
  get inWater(): boolean {
    return this.phase === "water";
  }
  get atTop(): boolean {
    return this.phase === "top";
  }
  /** Climbing (or shimmying/hanging toward a climb) — still on the cliff. */
  get climbing(): boolean {
    return this.phase === "hang" || this.phase === "shimmy" || this.phase === "climb";
  }

  /** A dolphin spat at this man: lose 1hp and get knocked down 1/4 box. At 0hp
   *  the man falls. Ignored once safe. */
  takeDolphinHit(): void {
    if (this.safe || this.phase === "falling") return;
    this.hp -= 1;
    this.heightPx = Math.max(0, this.heightPx - this.boxHeight() * KNOCKDOWN_FRACTION);
    if (this.hp <= 0) {
      this.hp = 0;
      this.startFalling();
    }
  }

  /** An orb reached this man: heal 1hp up to max. No effect if not needy/safe. */
  heal(): void {
    if (this.safe || this.phase === "falling") return;
    if (this.hp < this.maxHp) this.hp += 1;
  }

  get needsHealth(): boolean {
    return this.climbing && this.hp < this.maxHp;
  }

  /** Finale: turn this surfaced diver gold (gleaming). */
  makeGold(): void {
    this.gold = true;
  }

  /** Finale: force this man off the cliff into a graceful swan dive, even from
   *  the safe "top" idle. Unlike a dolphin hit (a no-op once safe), the diver
   *  CHOOSES to leap, so this bypasses the safe guard. */
  dive(): void {
    if (this.phase === "falling" || this.phase === "water") return;
    this.hp = 0;
    this.startFalling();
  }

  private startFalling(): void {
    this.phase = "falling";
  }

  /** Pure update. `beatDuration` is seconds/beat (Conductor-derived). */
  update(dt: number, beatDuration: number): void {
    this.clock += dt;
    const bd = Math.max(0.0001, beatDuration);

    switch (this.phase) {
      case "hang": {
        this.hangTimer -= dt;
        if (this.hangTimer <= 0) this.phase = "shimmy";
        break;
      }
      case "shimmy": {
        const tx = this.edgeX();
        const step = SHIMMY_SPEED * dt;
        if (Math.abs(tx - this.x) <= step) {
          this.x = tx;
          this.phase = "climb";
        } else {
          this.x += Math.sign(tx - this.x) * step;
        }
        // hold at the box bottom while shimmying
        this.heightPx = 0;
        break;
      }
      case "climb": {
        // Linear in remaining height: rate = boxHeight / (climbBeats * bd), so
        // a higher man covers the same px/sec but has less to go.
        const climbBeats = CLIMB_BEATS_BY_HP[this.hp] ?? 12;
        const rate = this.boxHeight() / (climbBeats * bd); // px per second
        this.heightPx += rate * dt;
        if (this.heightPx >= this.boxHeight()) {
          this.heightPx = this.boxHeight();
          this.phase = "top";
          this.topWander = this.x;
        }
        break;
      }
      case "top": {
        // Safe idle: wander a little along the top, animating gaze/flex/jacks.
        this.topAnim += dt;
        const target = this.topWander;
        const step = 24 * dt;
        if (Math.abs(target - this.x) <= step) {
          if (Math.random() < 0.02) {
            this.topWander = Math.max(
              4,
              Math.min(this.viewW - 4, this.x + (Math.random() - 0.5) * 60),
            );
          }
        } else {
          this.x += Math.sign(target - this.x) * step;
        }
        break;
      }
      case "falling": {
        this.y += FALL_SPEED * dt;
        // drift toward the water gently
        if (this.y >= this.waterY) {
          this.y = this.waterY;
          this.phase = "water";
          this.topWander = this.x;
        }
        break;
      }
      case "water": {
        // Swim around safely.
        const target = this.topWander;
        const step = 30 * dt;
        if (Math.abs(target - this.x) <= step) {
          if (Math.random() < 0.02) {
            this.topWander = Math.max(
              8,
              Math.min(this.viewW - 8, this.x + (Math.random() - 0.5) * 120),
            );
          }
        } else {
          this.x += Math.sign(target - this.x) * step;
        }
        break;
      }
    }

    this.render();
  }

  // --- rendering (browser-only) ---------------------------------------------

  private ensureEl(): void {
    if (typeof document === "undefined") return;
    if (this.el) return;
    const el = document.createElement("div");
    el.className = `cliff-climber cliff-climber-${this.tier}`;
    el.style.cssText =
      "position:absolute;width:22px;height:30px;pointer-events:none;" +
      "image-rendering:pixelated;background-repeat:no-repeat;z-index:7;" +
      "transform-origin:50% 100%;";
    this.el = el;
    // Sprite id maps tier -> placeholder sheet (gold variant for the finale).
    loadSpriteSheet(`climber-${this.tier}`)
      .then((img) => {
        this.sheet = img;
      })
      .catch(() => {
        /* keep CSS fallback */
      });
    loadSpriteSheet("climber-gold").catch(() => {});
  }

  /** Tier shade fallback (visible without sprites). Three distinct shades. */
  private fallbackColor(): string {
    if (this.gold) return "#ffd84d";
    if (this.tier === "strong") return "#3df0a0"; // bright green = STRONG
    if (this.tier === "medium") return "#3da0f0"; // blue = MEDIUM
    return "#b06bf0"; // dim purple = WEAK
  }

  private render(): void {
    const el = this.el;
    if (!el) return;
    const drawY =
      this.phase === "falling" || this.phase === "water"
        ? this.y
        : this.box.bottom - this.heightPx;
    el.style.left = `${this.x - 11}px`;
    el.style.top = `${drawY - 30}px`;
    if (this.sheet) {
      el.style.backgroundColor = "transparent";
      el.style.backgroundImage = `url(${(this.sheet as HTMLImageElement).src})`;
      el.style.backgroundSize = "auto";
      // pose row index by phase, frame by clock
      const pose = this.poseRow();
      const frame = Math.floor(this.clock * 8) % 4;
      el.style.backgroundPosition = `-${frame * 22}px -${pose * 30}px`;
      el.style.filter = this.gold
        ? "drop-shadow(0 0 6px #ffd84d) drop-shadow(0 0 12px #ffae00)"
        : "";
    } else {
      el.style.backgroundColor = this.fallbackColor();
      el.style.borderRadius = "3px";
      el.style.boxShadow = `0 0 6px ${this.fallbackColor()}`;
      // tiny "low hp" wobble cue
      el.style.opacity = this.hp <= 0 ? "0.7" : "1";
    }
  }

  private poseRow(): number {
    switch (this.phase) {
      case "hang":
        return 0;
      case "shimmy":
        return 1;
      case "climb":
        return 2;
      case "top":
        return 3;
      case "falling":
        return 4;
      case "water":
        return 5;
    }
  }

  dispose(): void {
    this.el?.remove();
    this.el = null;
  }
}
