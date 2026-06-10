// Shark — the Battle-mode enemy. Swims in from the horizon near the sun, slowly
// down to the line of people, then sweeps across to the far side eating anyone
// in its path. Killed only by a windsurfing dude or a thrown boomerang (handled
// by CharacterManager); on death it bursts into a Blood splash.
//
// Lifecycle:
//   descend : from the horizon (startY) down to the people line (groundY) over
//             `descendSeconds` (= 8 measures). Renders the nose-down sheet.
//   sweep   : at the bottom, swim horizontally toward the far side at a steady
//             pace. Renders the side sheet, flipped to face the travel direction.
//   done    : off the far edge — reaped by the manager.

import { loadSpriteSheet } from "./SpriteLoader";

export interface SharkConfig {
  id: number;
  startX: number;        // horizon spawn x (outer band, one side of the sun)
  startY: number;        // horizon y
  groundY: number;       // the people line (feet baseline)
  descendSeconds: number; // 8 measures' worth of seconds
  screenW: number;       // viewport width (for the off-screen / sweep direction)
  sweepSpeed?: number;   // px/s along the bottom (default 90)
}

// Display sizes (must match the shark sprite sheets' per-frame aspect).
const DOWN = { w: 40, h: 60, frames: 4 }; // nose-down sheet cell ~32x48
const SIDE = { w: 64, h: 32, frames: 4 }; // side sheet cell ~48x24

export class Shark {
  readonly id: number;
  x: number;
  y: number;
  private groundY: number;
  private startY: number;
  private descendSeconds: number;
  private screenW: number;
  private sweepSpeed: number;
  /** +1 sweeps right, -1 sweeps left — toward the side opposite the spawn. */
  private sweepDir: number;
  private phase: "descend" | "sweep" | "done" = "descend";
  private descendT = 0;
  private clock = 0;
  private frameNum = 0;
  private frameTime = 0;
  private dead = false;

  private downSheet: HTMLImageElement | SVGImageElement | null = null;
  private sideSheet: HTMLImageElement | SVGImageElement | null = null;

  el: HTMLDivElement;

  constructor(config: SharkConfig) {
    this.id = config.id;
    this.x = config.startX;
    this.y = config.startY;
    this.startY = config.startY;
    this.groundY = config.groundY;
    this.descendSeconds = Math.max(0.5, config.descendSeconds);
    this.screenW = config.screenW;
    this.sweepSpeed = config.sweepSpeed ?? 90;
    // Sweep away from the side it entered on (spawned right of centre → go left).
    this.sweepDir = config.startX > config.screenW / 2 ? -1 : 1;

    this.el = document.createElement("div");
    this.el.className = "eddie-shark";
    this.el.style.cssText =
      "position:absolute;pointer-events:none;background-repeat:no-repeat;z-index:5;" +
      "transform-origin:50% 50%;";
    // Fallback: a dark grey fin-ish box until the sheets load.
    this.el.style.background = "linear-gradient(180deg,#9fb0c0,#3a4654)";
    this.el.style.borderRadius = "40% 40% 50% 50%";

    loadSpriteSheet("shark-down")
      .then((img) => { this.downSheet = img; })
      .catch(() => {});
    loadSpriteSheet("shark-side")
      .then((img) => { this.sideSheet = img; })
      .catch(() => {});

    this.updateDOM();
  }

  get alive(): boolean { return !this.dead && this.phase !== "done"; }
  get isDone(): boolean { return this.phase === "done"; }

  /** Killed by a board/boomerang — caller spawns the Blood splash. */
  kill(): void {
    this.dead = true;
    this.phase = "done";
  }

  update(dt: number): void {
    if (this.dead) return;
    this.clock += dt;
    this.frameTime += dt;
    if (this.frameTime >= 1 / 8) {
      this.frameTime -= 1 / 8;
      this.frameNum = (this.frameNum + 1) % 4;
    }

    if (this.phase === "descend") {
      this.descendT = Math.min(1, this.descendT + dt / this.descendSeconds);
      this.y = this.startY + (this.groundY - this.startY) * this.descendT;
      // A gentle weave as it descends so it reads as swimming.
      this.x += Math.sin(this.clock * 2) * 12 * dt;
      // Turn toward the people EARLY: once it's about 1/3 of the way up from the
      // people line toward the horizon, commit to the horizontal attack run.
      const turnY = this.groundY - (this.groundY - this.startY) / 3;
      if (this.y >= turnY || this.descendT >= 1) this.phase = "sweep";
    } else if (this.phase === "sweep") {
      this.x += this.sweepDir * this.sweepSpeed * dt;
      // Keep angling DOWN into the crowd until it reaches the people line, then
      // just bob along it — so the turn reads as "heading for the people".
      if (this.y < this.groundY - 1) {
        this.y += (this.groundY - this.y) * Math.min(1, 2.5 * dt);
      } else {
        this.y = this.groundY + Math.sin(this.clock * 4) * 4;
      }
      if (this.x < -120 || this.x > this.screenW + 120) this.phase = "done";
    }

    this.updateDOM();
  }

  private updateDOM(): void {
    const down = this.phase === "descend";
    const cell = down ? DOWN : SIDE;
    const sheet = down ? this.downSheet : this.sideSheet;
    this.el.style.width = `${cell.w}px`;
    this.el.style.height = `${cell.h}px`;
    this.el.style.left = `${this.x - cell.w / 2}px`;
    this.el.style.top = `${this.y - cell.h / 2}px`;
    if (sheet) {
      this.el.style.background = "none";
      this.el.style.borderRadius = "0";
      this.el.style.backgroundImage = `url(${(sheet as HTMLImageElement).src})`;
      this.el.style.backgroundSize = `${cell.w * cell.frames}px ${cell.h}px`;
      this.el.style.backgroundPosition = `-${this.frameNum * cell.w}px 0`;
    }
    // Face the sweep direction (side sheet drawn facing left by default → flip
    // when sweeping right). Descending: no flip.
    this.el.style.transform = !down && this.sweepDir > 0 ? "scaleX(-1)" : "";
  }

  dispose(): void {
    this.el.remove();
  }
}
