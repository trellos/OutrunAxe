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
/** Beats to dead-hang from the note lane before shimmying to the edge — long
 *  enough to clearly READ as "spawned hanging by the hands" before the climb. */
const HANG_BEATS = 1;
/** Knockdown from a dolphin hit, as a fraction of box height. */
const KNOCKDOWN_FRACTION = 0.25;
/** Shimmy speed (px/sec) toward the assigned edge before climbing. */
const SHIMMY_SPEED = 90;
/** Graceful fall speed (px/sec) once knocked off / out of hp (slip-off tumble). */
const FALL_SPEED = 260;
/** Finale swan-dive ballistics: an upward pop, gravity, and outward drift. */
const DIVE_JUMP = 230; // initial upward velocity (px/sec)
const DIVE_GRAVITY = 560; // px/sec^2
const DIVE_DRIFT = 60; // outward horizontal drift (px/sec)
/** Sprite cell size (design px) and the on-screen render scale. The sheets are
 *  22x30 cells; we draw them bigger than 1:1 so the climbers read clearly. */
const CELL_W = 22;
const CELL_H = 30;
const SCALE = 1.8;

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
  // Finale swan-dive ballistics (gold divers only).
  private diving = false;
  private vy = 0; // vertical velocity during a dive
  private diveVx = 0; // outward horizontal drift during a dive
  // Top-idle action: mostly relax/stroll, an OCCASIONAL flex, a buddy butt-pat.
  private topAction: "relax" | "flex" | "walk" = "relax";
  private actionTimer = 0;
  private patTimer = 0; // >0 = mid butt-pat gesture

  // DOM (lazy, browser-only).
  el: HTMLDivElement | null = null;
  private sheet: HTMLImageElement | SVGImageElement | null = null;
  private goldSheet: HTMLImageElement | SVGImageElement | null = null;
  private gold = false; // finale: gleaming gold swan-diver / surfacing swimmer

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
    this.hangTimer = HANG_BEATS; // counted DOWN in beats (see update)
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
  /** A finale cliff-diver (gleaming gold). */
  get isGold(): boolean {
    return this.gold;
  }
  /** Mid buddy butt-pat gesture (so the crowd doesn't re-trigger one). */
  get isPatting(): boolean {
    return this.patTimer > 0;
  }

  /** Idle flourish: a quick athlete butt-pat when two top men pass each other. */
  pat(): void {
    if (this.phase !== "top" || this.patTimer > 0) return;
    this.patTimer = 0.5;
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
    // Leap UP off the cliff and drift outward (away from the box) for an elegant
    // arc, rather than dropping straight down.
    this.diving = true;
    this.vy = -DIVE_JUMP;
    this.diveVx = (this.edge === "right" ? 1 : -1) * DIVE_DRIFT;
    this.startFalling();
  }

  private startFalling(): void {
    // Begin the fall from where he actually IS on the cliff (not the stale spawn
    // Y), so the drop is continuous — no teleport down before falling.
    this.y = this.box.bottom - this.heightPx;
    this.phase = "falling";
  }

  /** Pure update. `beatDuration` is seconds/beat (Conductor-derived). */
  update(dt: number, beatDuration: number): void {
    this.clock += dt;
    const bd = Math.max(0.0001, beatDuration);

    switch (this.phase) {
      case "hang": {
        // Count the hang in BEATS so it reads at any tempo.
        this.hangTimer -= dt / bd;
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
        // Safe idle: mostly relax, OCCASIONALLY flex, sometimes stroll along the
        // top (which lets buddies pass + butt-pat). A pat gesture holds briefly.
        this.topAnim += dt;
        if (this.patTimer > 0) {
          this.patTimer -= dt;
          break; // hold the pat, stand still
        }
        this.actionTimer -= dt;
        if (this.actionTimer <= 0) {
          const r = Math.random();
          if (r < 0.15) {
            this.topAction = "flex"; // flexing is the rare treat
            this.actionTimer = 1 + Math.random() * 0.8;
          } else if (r < 0.6) {
            this.topAction = "walk"; // stroll to a new spot
            this.actionTimer = 1.5 + Math.random() * 2;
            this.topWander = Math.max(
              8,
              Math.min(this.viewW - 8, this.x + (Math.random() - 0.5) * 160),
            );
          } else {
            this.topAction = "relax";
            this.actionTimer = 1.5 + Math.random() * 2.5;
          }
        }
        if (this.topAction === "walk") {
          const step = 26 * dt;
          if (Math.abs(this.topWander - this.x) <= step) {
            this.x = this.topWander;
            this.topAction = "relax";
            this.actionTimer = 1 + Math.random() * 2;
          } else {
            this.x += Math.sign(this.topWander - this.x) * step;
          }
        }
        break;
      }
      case "falling": {
        if (this.diving) {
          // A finale diver LEAPS: an upward pop, then gravity arcs him over and
          // down into the sea (an elegant parabola), drifting out off the cliff.
          this.vy += DIVE_GRAVITY * dt;
          this.y += this.vy * dt;
          this.x += this.diveVx * dt;
        } else {
          // A slip-off just drops (desperate tumble).
          this.y += FALL_SPEED * dt;
        }
        if (this.y >= this.waterY) {
          this.y = this.waterY;
          this.phase = "water";
          this.topWander = this.x;
          this.diving = false;
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
      `position:absolute;width:${CELL_W * SCALE}px;height:${CELL_H * SCALE}px;` +
      "pointer-events:none;image-rendering:pixelated;background-repeat:no-repeat;" +
      "z-index:7;transform-origin:50% 100%;";
    this.el = el;
    // Sprite id maps tier -> placeholder sheet (gold variant for the finale).
    loadSpriteSheet(`climber-${this.tier}`)
      .then((img) => {
        this.sheet = img;
      })
      .catch(() => {
        /* keep CSS fallback */
      });
    // The gold finale sheet (line-dance / swan-dive / surface-swim) — used once
    // makeGold() flips this man into a cliff-diver.
    loadSpriteSheet("climber-gold")
      .then((img) => {
        this.goldSheet = img;
      })
      .catch(() => {});
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
    let drawY =
      this.phase === "falling" || this.phase === "water"
        ? this.y
        : this.box.bottom - this.heightPx;
    let drawX = this.x;
    if (this.phase === "climb") {
      // Hand-over-hand: the body hitches UP on each power stroke and leans
      // slightly side to side as the arms reach, so it reads as climbing rather
      // than floating. Visual only — heightPx stays linear, so the climb-speed
      // law and the headless tests are unaffected.
      const ph = this.clock * 6;
      drawY -= Math.abs(Math.sin(ph)) * 2.2;
      drawX += Math.sin(ph) * 1.3;
    }
    // Anchor bottom-centre on (drawX, drawY), scaled.
    el.style.left = `${drawX - (CELL_W * SCALE) / 2}px`;
    el.style.top = `${drawY - CELL_H * SCALE}px`;
    // A finale cliff-diver uses the GOLD sheet (line-dance / swan-dive /
    // surface-swim); everyone else uses their tier sheet.
    const useGold = this.gold && this.goldSheet;
    const img = (useGold ? this.goldSheet : this.sheet) as HTMLImageElement | null;
    if (img) {
      el.style.backgroundColor = "transparent";
      el.style.backgroundImage = `url(${img.src})`;
      // Scale the whole sheet so each 22x30 cell renders at SCALE.
      el.style.backgroundSize = `${img.naturalWidth * SCALE}px ${img.naturalHeight * SCALE}px`;
      // Clear any leftover CSS-fallback styling so only the sprite shows.
      el.style.borderRadius = "";
      el.style.boxShadow = "";
      // pose row index by phase, frame by clock
      const pose = useGold ? this.goldPoseRow() : this.poseRow();
      const frame = Math.floor(this.clock * 8) % 4;
      el.style.backgroundPosition = `-${frame * CELL_W * SCALE}px -${pose * CELL_H * SCALE}px`;
      // A soft glow keeps the figure readable on the busy ocean (gold = the
      // gleaming finale diver).
      el.style.filter = this.gold
        ? "drop-shadow(0 0 6px #ffd84d) drop-shadow(0 0 12px #ffae00)"
        : "drop-shadow(0 0 2px rgba(0,0,0,0.9))";
    } else {
      el.style.backgroundColor = this.fallbackColor();
      el.style.borderRadius = "3px";
      el.style.boxShadow = `0 0 6px ${this.fallbackColor()}`;
      // tiny "low hp" wobble cue
      el.style.opacity = this.hp <= 0 ? "0.7" : "1";
    }
    // A finale diver rotates HEAD-DOWN as he falls — a graceful swan dive into
    // the sea. Everyone else is upright.
    if (this.gold && this.phase === "falling") {
      // ALWAYS head-first: point the head (sprite "up") along the velocity vector,
      // so he leads head-up on the launch, curves over, and enters head-down — a
      // committed dive, never a stumble.
      const deg = (Math.atan2(this.vy, this.diveVx) * 180) / Math.PI + 90;
      el.style.transformOrigin = "50% 50%";
      el.style.transform = `rotate(${deg.toFixed(1)}deg)`;
    } else {
      el.style.transform = "";
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
        if (this.patTimer > 0) return 8; // buddy butt-pat
        if (this.topAction === "flex") return 6; // occasional flex
        if (this.topAction === "walk") return 7; // strolling
        return 3; // relaxed stand
      case "falling":
        return 4;
      case "water":
        return 5;
    }
  }

  /** Gold finale sheet rows: 0 line-dance, 1 swan-dive, 2 surface-swim. */
  private goldPoseRow(): number {
    if (this.phase === "water") return 2; // gleaming gold surface swim
    if (this.phase === "falling") return 1; // graceful swan dive
    return 0; // line-dance (at the top, before the dive)
  }

  dispose(): void {
    this.el?.remove();
    this.el = null;
  }
}
