// Rocket — spawned by SIXTEENTH quarters (one per diamond).
//
// Lifecycle: perch on its diamond → fall to the floor → stand pointing up,
// wobbling → (a wandering dude bumps it) → fire up, arcing along a curved path
// toward a sky target while spewing fire sparks → explode on arrival.
//
// Rockets never move until triggered; dudes don't seek them out.

import { loadSpriteSheet } from "./SpriteLoader";
import type { CharacterQuality } from "./Character";

export interface RocketConfig {
  id: number;
  quality: CharacterQuality; // accuracy → size
  variant: 1 | 2 | 3;
  startX: number;
  spawnY: number;
  groundY: number;
  perchDuration: number;
  onEmit: (x: number, y: number) => void;       // spew a trail spark
  onExplode: (x: number, y: number, scale: number) => void;
}

const FRAMES = 4;        // rocket sheet is 4 flicker frames wide
const FLY_DURATION = 1.1; // seconds along the flight path
const EMIT_INTERVAL = 0.025;

export class Rocket {
  readonly id: number;
  x: number;
  private y: number;            // feet baseline while grounded; center while flying
  private groundY: number;
  private quality: CharacterQuality;
  private variant: 1 | 2 | 3;
  private phase: "perch" | "fall" | "ground" | "flying" | "done" = "perch";
  private perchTimer: number;
  private perchTime = 0;
  private jumpPhase = 0;
  private jumpStartY: number;
  private clock = 0;
  private frameNum = 0;
  private frameTime = 0;

  // Flight
  private L = { x: 0, y: 0 };
  private C = { x: 0, y: 0 };
  private T = { x: 0, y: 0 };
  private flyT = 0;
  private emitTimer = 0;
  private angleDeg = 0;

  private onEmit: (x: number, y: number) => void;
  private onExplode: (x: number, y: number, scale: number) => void;
  private sheet: HTMLImageElement | SVGImageElement | null = null;
  private flameSheet: HTMLImageElement | SVGImageElement | null = null;
  private flameEl: HTMLDivElement;

  el: HTMLDivElement;

  constructor(config: RocketConfig) {
    this.id = config.id;
    this.quality = config.quality;
    this.variant = config.variant;
    this.x = config.startX;
    this.jumpStartY = config.spawnY;
    this.y = config.spawnY;
    this.groundY = config.groundY;
    this.perchTimer = config.perchDuration;
    this.onEmit = config.onEmit;
    this.onExplode = config.onExplode;

    const { w, h } = this.size();
    this.el = document.createElement("div");
    this.el.className = `eddie-rocket eddie-rocket-${this.quality}`;
    this.el.style.cssText =
      `position:absolute;width:${w}px;height:${h}px;pointer-events:none;` +
      `transform-origin:50% 100%;background-repeat:no-repeat;`;
    // Fallback sliver until the sheet loads (a bright nose over a body).
    this.el.style.background = "linear-gradient(180deg,#ff4d4d 0 22%,#e8edf4 22%)";
    this.el.style.borderRadius = "40% 40% 20% 20%";

    loadSpriteSheet(`rocket-${this.variant}`)
      .then((img) => {
        this.sheet = img;
        this.el.style.background = "none";
        this.el.style.borderRadius = "0";
        this.el.style.backgroundImage = `url(${(img as HTMLImageElement).src})`;
      })
      .catch(() => {
        /* keep the sliver fallback */
      });

    // Engine flame, attached at the tail; shown only while flying. As a child of
    // `el` it inherits the rocket's rotation, so it always trails the nose.
    this.flameEl = document.createElement("div");
    this.flameEl.className = "eddie-rocket-flame";
    this.flameEl.style.cssText =
      "position:absolute;pointer-events:none;display:none;background-repeat:no-repeat;";
    this.flameEl.style.background =
      "radial-gradient(ellipse at top,#fff,#ffe14d 35%,#ff8a1e 60%,rgba(255,59,31,0) 85%)";
    this.el.appendChild(this.flameEl);
    loadSpriteSheet("rocket-flame")
      .then((img) => {
        this.flameSheet = img;
        this.flameEl.style.background = "none";
        this.flameEl.style.backgroundImage = `url(${(img as HTMLImageElement).src})`;
      })
      .catch(() => {
        /* keep the gradient fallback flame */
      });

    this.updateDOM();
  }

  /** Size by accuracy (aspect ~20:36, matching the rocket sheets). */
  private size(): { w: number; h: number } {
    switch (this.quality) {
      case "perfect":
        return { w: 54, h: 96 };
      case "normal":
        return { w: 40, h: 72 };
      default:
        return { w: 27, h: 48 };
    }
  }

  get grounded(): boolean {
    return this.phase === "ground";
  }

  /** True only while it can still be triggered by a dude. */
  get armed(): boolean {
    return this.phase === "ground";
  }

  get isDone(): boolean {
    return this.phase === "done";
  }

  /** A dude bumped this rocket — launch it toward `target`. */
  trigger(target: { x: number; y: number }): void {
    if (this.phase !== "ground") return;
    const { h } = this.size();
    this.L = { x: this.x, y: this.groundY - h / 2 };
    this.T = { x: target.x, y: target.y };
    // Arc up and bow toward the target side.
    this.C = {
      x: (this.L.x + this.T.x) / 2,
      y: Math.min(this.L.y, this.T.y) - 160,
    };
    this.flyT = 0;
    this.phase = "flying";
  }

  update(dt: number): void {
    this.clock += dt;
    // Flicker the sheet frame.
    this.frameTime += dt;
    if (this.frameTime >= 1 / 12) {
      this.frameTime -= 1 / 12;
      this.frameNum = (this.frameNum + 1) % FRAMES;
    }

    if (this.phase === "perch") {
      this.perchTime += dt;
      this.perchTimer -= dt;
      if (this.perchTimer <= 0) this.phase = "fall";
    } else if (this.phase === "fall") {
      this.jumpPhase = Math.min(1, this.jumpPhase + dt / 0.3);
      if (this.jumpPhase >= 1) {
        this.phase = "ground";
        this.y = this.groundY;
      } else {
        const arc = Math.sin(this.jumpPhase * Math.PI) * 45;
        this.y = this.jumpStartY + (this.groundY - this.jumpStartY) * this.jumpPhase - arc;
      }
    } else if (this.phase === "flying") {
      this.flyT = Math.min(1, this.flyT + dt / FLY_DURATION);
      const t = this.flyT;
      const mt = 1 - t;
      // Quadratic Bézier position.
      const px = mt * mt * this.L.x + 2 * mt * t * this.C.x + t * t * this.T.x;
      const py = mt * mt * this.L.y + 2 * mt * t * this.C.y + t * t * this.T.y;
      // Derivative → heading.
      const vx = 2 * mt * (this.C.x - this.L.x) + 2 * t * (this.T.x - this.C.x);
      const vy = 2 * mt * (this.C.y - this.L.y) + 2 * t * (this.T.y - this.C.y);
      this.x = px;
      this.y = py;
      this.angleDeg = (Math.atan2(vy, vx) * 180) / Math.PI + 90; // sprite points up

      // Spew sparks from the tail (behind the heading).
      this.emitTimer -= dt;
      if (this.emitTimer <= 0) {
        this.emitTimer = EMIT_INTERVAL;
        const vlen = Math.hypot(vx, vy) || 1;
        const { h } = this.size();
        const tailX = px - (vx / vlen) * (h / 2);
        const tailY = py - (vy / vlen) * (h / 2);
        this.onEmit(tailX, tailY);
      }

      if (t >= 1) {
        const scale = this.quality === "perfect" ? 1.4 : this.quality === "normal" ? 1.1 : 0.85;
        this.onExplode(this.T.x, this.T.y, scale);
        this.phase = "done";
      }
    }

    this.updateDOM();
  }

  private updateDOM(): void {
    const { w, h } = this.size();
    if (this.sheet) {
      this.el.style.backgroundSize = `${w * FRAMES}px ${h}px`;
      this.el.style.backgroundPosition = `-${this.frameNum * w}px 0`;
    }

    // Engine flame trails from the tail (positioned in el-local coords, so it
    // inherits the rocket's rotation). Visible only while flying.
    const fw = w * 0.7;
    const fh = h * 0.55;
    this.flameEl.style.width = `${fw.toFixed(1)}px`;
    this.flameEl.style.height = `${fh.toFixed(1)}px`;
    this.flameEl.style.left = `${((w - fw) / 2).toFixed(1)}px`;
    this.flameEl.style.top = `${(h - fh * 0.25).toFixed(1)}px`;
    if (this.flameSheet) {
      this.flameEl.style.backgroundSize = `${(fw * FRAMES).toFixed(1)}px ${fh.toFixed(1)}px`;
      this.flameEl.style.backgroundPosition = `-${(this.frameNum * fw).toFixed(1)}px 0`;
    }
    this.flameEl.style.display = this.phase === "flying" ? "block" : "none";

    if (this.phase === "flying") {
      // Position by CENTER; rotate to face the heading; engine glow.
      this.el.style.transformOrigin = "50% 50%";
      this.el.style.left = `${this.x - w / 2}px`;
      this.el.style.top = `${this.y - h / 2}px`;
      this.el.style.transform = `rotate(${this.angleDeg.toFixed(1)}deg)`;
      this.el.style.filter = "drop-shadow(0 0 6px #ff8a1e) drop-shadow(0 0 12px #ff4d1e)";
      return;
    }

    // Grounded / perch / fall: anchor feet at y.
    this.el.style.transformOrigin = "50% 100%";
    this.el.style.left = `${this.x - w / 2}px`;
    this.el.style.top = `${this.y - h}px`;

    if (this.phase === "perch") {
      const wiggle = Math.sin(this.perchTime * 14);
      const pulse = 0.5 + 0.5 * Math.sin(this.perchTime * 6);
      const blur = w * 0.3 * (0.6 + 0.4 * pulse);
      this.el.style.transform = `translateY(${(-1.5 * Math.abs(wiggle)).toFixed(2)}px) rotate(${(wiggle * 8).toFixed(2)}deg)`;
      this.el.style.filter = `drop-shadow(0 0 ${blur.toFixed(1)}px #ff7a4d)`;
    } else {
      // Grounded (or mid-fall): stand dead still until a dude triggers it.
      this.el.style.transform = "";
      this.el.style.filter = "";
    }
  }

  dispose(): void {
    this.el.remove();
  }
}
