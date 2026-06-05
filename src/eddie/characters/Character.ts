// Character — a party character spawned from diamonds.
//
// Represents a single animated character on the ground plane. Handles state,
// animation frame management, movement, and rendering via DOM.

export type CharacterSize = "big" | "medium" | "small";
export type CharacterTier = "strong" | "weak";
export type CharacterQuality = "loose" | "normal" | "perfect";
export type CharacterPose = "idle" | "walk" | "jump" | "interact";

export interface CharacterConfig {
  id: number;
  size: CharacterSize;          // big (8th), medium (triplet), small (16th)
  tier: CharacterTier;          // strong (root/3/5) or weak (other)
  quality: CharacterQuality;    // loose, normal, perfect (timing)
  startX: number;               // ground position (pixel)
  spawnY: number;               // diamond Y (for jump arc)
  groundY: number;              // landed Y position
  spriteSheet: HTMLImageElement | SVGImageElement; // loaded sprite
}

export class Character {
  readonly id: number;
  readonly size: CharacterSize;
  readonly tier: CharacterTier;
  readonly quality: CharacterQuality;

  // Position & state
  x: number;                    // ground position (horizontal)
  private y: number;            // current Y (for jumping/interactions)
  private groundY: number;      // Y when landed on ground
  private isJumping = true;     // start in jump phase
  private jumpPhase = 0;        // 0..1 (animation progress)
  private jumpStartY: number;   // diamond Y (arc from here)

  // Animation
  private pose: CharacterPose = "idle";
  private frameNum = 0;
  private poseTime = 0;         // elapsed time in current pose
  private spriteSheet: HTMLImageElement | SVGImageElement;
  private frameCounts = { idle: 1, walk: 2, jump: 3, interact: 4 }; // frames per pose
  private frameRate = 10;       // fps for animation

  // DOM
  el: HTMLDivElement;

  constructor(config: CharacterConfig) {
    this.id = config.id;
    this.size = config.size;
    this.tier = config.tier;
    this.quality = config.quality;
    this.x = config.startX;
    this.jumpStartY = config.spawnY;
    this.groundY = config.groundY;
    this.y = this.jumpStartY;
    this.spriteSheet = config.spriteSheet;

    // Create DOM element
    this.el = document.createElement("div");
    this.el.className = `eddie-character eddie-character-${this.size} eddie-character-${this.tier} eddie-character-${this.quality}`;
    this.el.style.position = "absolute";
    this.el.style.width = this.getSpriteSize().w + "px";
    this.el.style.height = this.getSpriteSize().h + "px";
    this.updateDOM();
  }

  /** Size in pixels for this character. */
  getSpriteSize(): { w: number; h: number } {
    switch (this.size) {
      case "big":
        return { w: 32, h: 32 };
      case "medium":
        return { w: 24, h: 24 };
      case "small":
        return { w: 16, h: 16 };
    }
  }

  /** Update position, animation frame, and render. Called each frame. */
  update(dt: number): void {
    // Jump phase: animate Y position
    if (this.isJumping) {
      this.jumpPhase = Math.min(1, this.jumpPhase + dt / 0.3); // 0.3s jump duration
      if (this.jumpPhase >= 1) {
        this.isJumping = false;
        this.y = this.groundY;
        this.pose = "idle";
        this.poseTime = 0;
      } else {
        // Quadratic arc: start at jumpStartY, peak at -50px above ground, land at groundY
        const arc = Math.sin(this.jumpPhase * Math.PI) * 50; // max arc height
        this.y = this.jumpStartY + (this.groundY - this.jumpStartY) * this.jumpPhase - arc;
      }
    }

    // Animation frame cycling
    this.poseTime += dt;
    const frameDuration = 1 / this.frameRate;
    const frameCount = this.frameCounts[this.pose];
    if (this.poseTime >= frameDuration) {
      this.poseTime = 0;
      this.frameNum = (this.frameNum + 1) % frameCount;
    }

    this.updateDOM();
  }

  /** Set pose (idle, walk, jump, interact). */
  setPose(pose: CharacterPose): void {
    if (pose !== this.pose) {
      this.pose = pose;
      this.frameNum = 0;
      this.poseTime = 0;
    }
  }

  /** Move toward a target X position. */
  moveTo(targetX: number, speed: number = 20): void {
    const movePerFrame = speed / 60; // assume 60fps
    if (Math.abs(targetX - this.x) < movePerFrame) {
      this.x = targetX;
      this.setPose("idle");
    } else {
      this.x += (targetX > this.x ? 1 : -1) * movePerFrame;
      this.setPose("walk");
    }
  }

  /** Get sprite frame data (SVG/PNG cell position). */
  getSpriteFrame(): { x: number; y: number; w: number; h: number } {
    const size = this.getSpriteSize();
    const poseIndex = ["idle", "walk", "jump", "interact"].indexOf(this.pose);
    return {
      x: poseIndex * size.w,
      y: 0,
      w: size.w,
      h: size.h,
    };
  }

  /** Update DOM position and background-image offset. */
  private updateDOM(): void {
    const frame = this.getSpriteFrame();
    this.el.style.left = this.x + "px";
    this.el.style.top = this.y + "px";
    this.el.style.backgroundImage = `url(${(this.spriteSheet as any).src})`;
    this.el.style.backgroundPosition = `-${frame.x}px -${frame.y}px`;
    this.el.style.backgroundSize = "auto";
  }

  /** Clean up. */
  dispose(): void {
    this.el.remove();
  }
}
