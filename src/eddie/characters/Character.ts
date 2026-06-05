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
  spriteSheet: HTMLImageElement | SVGImageElement | null; // loaded sprite (null → box fallback)
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
  private spriteSheet: HTMLImageElement | SVGImageElement | null;
  private frameCounts = { idle: 4, walk: 4, jump: 4, interact: 4 }; // frames per pose (one sheet column each)
  private frameRate = 8;        // fps for animation

  // Wander/milling (basic life until interaction AI lands in Phase 3)
  private homeX: number;        // anchor to mill around
  private wanderTarget: number | null = null;
  private wanderTimer = 0;      // idle pause countdown between strolls

  // DOM
  el: HTMLDivElement;

  constructor(config: CharacterConfig) {
    this.id = config.id;
    this.size = config.size;
    this.tier = config.tier;
    this.quality = config.quality;
    this.x = config.startX;
    this.homeX = config.startX;
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
    if (this.isJumping) {
      // Jump phase: arc Y from the diamond down to the ground.
      this.setPose("jump");
      this.jumpPhase = Math.min(1, this.jumpPhase + dt / 0.3); // 0.3s jump duration
      if (this.jumpPhase >= 1) {
        this.isJumping = false;
        this.y = this.groundY;
        this.setPose("idle");
      } else {
        const arc = Math.sin(this.jumpPhase * Math.PI) * 50; // max arc height
        this.y = this.jumpStartY + (this.groundY - this.jumpStartY) * this.jumpPhase - arc;
      }
    } else {
      // Landed: mill around home so the crowd feels alive.
      this.wander(dt);
    }

    // Animation frame cycling
    this.poseTime += dt;
    const frameDuration = 1 / this.frameRate;
    const frameCount = this.frameCounts[this.pose];
    if (this.poseTime >= frameDuration) {
      this.poseTime -= frameDuration;
      this.frameNum = (this.frameNum + 1) % frameCount;
    }

    this.updateDOM();
  }

  /** Basic wander: stroll to a nearby spot, pause, repeat. Perfect-tier moves
   *  faster. Replaced by goal-driven interaction AI in a later phase. */
  private wander(dt: number): void {
    const speed = this.quality === "perfect" ? 34 : this.quality === "normal" ? 26 : 20;
    if (this.wanderTarget === null) {
      this.wanderTimer -= dt;
      this.setPose("idle");
      if (this.wanderTimer <= 0) {
        this.wanderTarget = this.homeX + (Math.random() - 0.5) * 120;
      }
    } else {
      const step = speed * dt;
      if (Math.abs(this.wanderTarget - this.x) <= step) {
        this.x = this.wanderTarget;
        this.wanderTarget = null;
        this.wanderTimer = 0.6 + Math.random() * 1.4; // pause before next stroll
        this.setPose("idle");
      } else {
        this.x += Math.sign(this.wanderTarget - this.x) * step;
        this.setPose("walk");
      }
    }
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

  /** Get sprite frame data (sheet cell position).
   *  Sheet layout: columns = animation frame, rows = pose. */
  getSpriteFrame(): { x: number; y: number; w: number; h: number } {
    const size = this.getSpriteSize();
    const poseIndex = ["idle", "walk", "jump", "interact"].indexOf(this.pose);
    return {
      x: this.frameNum * size.w,
      y: poseIndex * size.h,
      w: size.w,
      h: size.h,
    };
  }

  /** Tier/quality fallback color — visible even if no sprite loads. */
  private fallbackColor(): string {
    // quality drives brightness; tier drives hue (strong = cyan, weak = magenta)
    const lum = this.quality === "perfect" ? 0.75 : this.quality === "normal" ? 0.55 : 0.4;
    const pct = Math.round(lum * 100);
    return this.tier === "strong"
      ? `hsl(190, 100%, ${pct}%)`
      : `hsl(320, 90%, ${pct}%)`;
  }

  /** Update DOM position and background-image offset. */
  private updateDOM(): void {
    // `y` is the character's FEET baseline; offset by sprite height so figures
    // of different sizes rest their bottoms on the same ground line.
    this.el.style.left = this.x + "px";
    this.el.style.top = (this.y - this.getSpriteSize().h) + "px";

    if (this.spriteSheet) {
      // Render the selected cell of the sheet — no tiling.
      const frame = this.getSpriteFrame();
      this.el.style.backgroundColor = "transparent";
      this.el.style.backgroundImage = `url(${(this.spriteSheet as any).src})`;
      this.el.style.backgroundRepeat = "no-repeat";
      this.el.style.backgroundPosition = `-${frame.x}px -${frame.y}px`;
      this.el.style.backgroundSize = "auto";
    } else {
      // No art loaded — show a solid colored box so spawning is still visible.
      this.el.style.backgroundColor = this.fallbackColor();
      this.el.style.borderRadius = "2px";
      this.el.style.boxShadow = `0 0 6px ${this.fallbackColor()}`;
    }
  }

  /** Clean up. */
  dispose(): void {
    this.el.remove();
  }
}
