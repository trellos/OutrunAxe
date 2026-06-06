// Gun — a laser pistol that perches on its diamond, falls to the floor, and
// then lies there until a wandering dude bumps into it and picks it up.
//
// Spawned by TRIPLET quarters (one per diamond). Guns never move on their own.

import { loadSpriteSheet } from "./SpriteLoader";
import type { CharacterQuality } from "./Character";

export interface GunConfig {
  id: number;
  quality: CharacterQuality; // accuracy → size
  startX: number;
  spawnY: number;
  groundY: number;
  perchDuration: number;
}

export class Gun {
  readonly id: number;
  x: number;
  private y: number;
  private groundY: number;
  private quality: CharacterQuality;
  private phase: "perch" | "fall" | "ground" = "perch";
  private perchTimer: number;
  private perchTime = 0;
  private jumpPhase = 0;
  private jumpStartY: number;
  private clock = 0;
  private pickedUp = false;

  el: HTMLDivElement;

  constructor(config: GunConfig) {
    this.id = config.id;
    this.quality = config.quality;
    this.x = config.startX;
    this.jumpStartY = config.spawnY;
    this.y = config.spawnY;
    this.groundY = config.groundY;
    this.perchTimer = config.perchDuration;

    const { w, h } = this.size();
    this.el = document.createElement("div");
    this.el.className = `eddie-gun eddie-gun-${this.quality}`;
    this.el.style.cssText =
      `position:absolute;width:${w}px;height:${h}px;pointer-events:none;` +
      `transform-origin:50% 100%;background-repeat:no-repeat;background-size:${w}px ${h}px;`;
    // Color-box fallback (a metal sliver) until the sprite loads.
    this.el.style.background = "linear-gradient(90deg,#7d8696,#aab3c2 70%,#ff4d4d 70%)";
    this.el.style.borderRadius = "2px";

    loadSpriteSheet("gun-floor")
      .then((img) => {
        this.el.style.background = "none";
        this.el.style.backgroundImage = `url(${(img as HTMLImageElement).src})`;
        this.el.style.backgroundSize = `${w}px ${h}px`;
      })
      .catch(() => {
        /* keep the metal-sliver fallback */
      });

    this.updateDOM();
  }

  /** Floor footprint by accuracy (aspect ~2:1, matching gun-floor.svg). */
  private size(): { w: number; h: number } {
    switch (this.quality) {
      case "perfect":
        return { w: 96, h: 48 };
      case "normal":
        return { w: 72, h: 36 };
      default:
        return { w: 48, h: 24 };
    }
  }

  get grounded(): boolean {
    return this.phase === "ground";
  }

  /** Available to be picked up: on the ground and not already claimed. */
  get available(): boolean {
    return this.phase === "ground" && !this.pickedUp;
  }

  markPickedUp(): void {
    this.pickedUp = true;
  }

  update(dt: number): void {
    this.clock += dt;
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
        const arc = Math.sin(this.jumpPhase * Math.PI) * 40;
        this.y = this.jumpStartY + (this.groundY - this.jumpStartY) * this.jumpPhase - arc;
      }
    }
    this.updateDOM();
  }

  private updateDOM(): void {
    const { h } = this.size();
    this.el.style.left = `${this.x - this.size().w / 2}px`;
    this.el.style.top = `${this.y - h}px`;
    if (this.phase === "perch") {
      const wiggle = Math.sin(this.perchTime * 14);
      const pulse = 0.5 + 0.5 * Math.sin(this.perchTime * 6);
      const blur = this.size().w * 0.25 * (0.6 + 0.4 * pulse);
      this.el.style.transform = `translateY(${(-1.2 * Math.abs(wiggle)).toFixed(2)}px) rotate(${(wiggle * 7).toFixed(2)}deg)`;
      this.el.style.filter = `drop-shadow(0 0 ${blur.toFixed(1)}px #ff7a4d)`;
    } else if (this.phase === "ground") {
      // Faint glint so a dropped gun stays noticeable on the floor.
      const glint = 0.4 + 0.3 * Math.sin(this.clock * 3);
      this.el.style.transform = "";
      this.el.style.filter = `drop-shadow(0 0 ${(2 * glint).toFixed(1)}px #ffb04d)`;
    } else {
      this.el.style.transform = "";
      this.el.style.filter = "";
    }
  }

  dispose(): void {
    this.el.remove();
  }
}
