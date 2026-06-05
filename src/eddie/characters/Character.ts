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
  perchDuration: number;        // seconds to glow+wiggle on the diamond before falling
  spriteSheet: HTMLImageElement | SVGImageElement | null; // loaded sprite (null → box fallback)
}

export class Character {
  readonly id: number;
  readonly size: CharacterSize;
  readonly tier: CharacterTier;
  readonly quality: CharacterQuality;

  // Position & state
  x: number;                    // ground position (horizontal)
  private y: number;            // current feet baseline Y
  private groundY: number;      // feet Y when landed on ground
  // Lifecycle: perch on the diamond (glow+wiggle) -> fall -> ground (mill).
  private phase: "perch" | "fall" | "ground" = "perch";
  private perchTimer: number;   // seconds remaining on the diamond
  private perchTime = 0;        // elapsed perch time (drives wiggle/glow)
  private jumpPhase = 0;        // 0..1 (fall progress)
  private jumpStartY: number;   // diamond Y (arc from here)

  // Animation
  private pose: CharacterPose = "idle";
  private frameNum = 0;
  private poseTime = 0;         // elapsed time in current pose
  private spriteSheet: HTMLImageElement | SVGImageElement | null;
  private frameCounts = { idle: 4, walk: 4, jump: 4, interact: 4 }; // frames per pose (one sheet column each)
  private frameRate = 8;        // fps for animation

  // Wander/milling (basic life until claimed by an interaction)
  private homeX: number;        // anchor to mill around
  private wanderTarget: number | null = null;
  private wanderTimer = 0;      // idle pause countdown between strolls

  // Interaction control: when an activity claims this character, `busy` stops
  // its self-driven wander and the director sets pose/position directly.
  busy = false;
  glow = false;                 // pulsing aura while performing
  private elevation = 0;        // raised above the ground line (pyramid stacking)
  private clock = 0;            // ever-advancing time for glow pulsing

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
    this.perchTimer = config.perchDuration;
    this.spriteSheet = config.spriteSheet;

    // Create DOM element
    this.el = document.createElement("div");
    this.el.className = `eddie-character eddie-character-${this.size} eddie-character-${this.tier} eddie-character-${this.quality}`;
    this.el.style.position = "absolute";
    this.el.style.width = this.getSpriteSize().w + "px";
    this.el.style.height = this.getSpriteSize().h + "px";
    // Rotate/scale about the feet so the perch wiggle reads like standing.
    this.el.style.transformOrigin = "50% 100%";
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

  /** True once the character has landed and is free to interact. */
  get grounded(): boolean {
    return this.phase === "ground";
  }

  /** Walk toward a target X this frame; returns true once arrived. Used by the
   *  interaction director while `busy`. */
  walkToward(targetX: number, dt: number, speed = 30): boolean {
    const step = speed * dt;
    if (Math.abs(targetX - this.x) <= step) {
      this.x = targetX;
      this.setPose("idle");
      return true;
    }
    this.x += Math.sign(targetX - this.x) * step;
    this.setPose("walk");
    return false;
  }

  /** Raise the character above the ground line (for pyramid tiers). */
  setElevation(px: number): void {
    this.elevation = px;
  }

  /** Update position, animation frame, and render. Called each frame. */
  update(dt: number): void {
    this.clock += dt;
    if (this.phase === "perch") {
      // Sit on the diamond, glowing + wiggling, until the perch timer elapses.
      this.perchTime += dt;
      this.perchTimer -= dt;
      this.setPose("idle");
      if (this.perchTimer <= 0) this.phase = "fall";
    } else if (this.phase === "fall") {
      // Arc Y from the diamond down to the ground.
      this.setPose("jump");
      this.jumpPhase = Math.min(1, this.jumpPhase + dt / 0.3); // 0.3s fall duration
      if (this.jumpPhase >= 1) {
        this.phase = "ground";
        this.y = this.groundY;
        this.setPose("idle");
      } else {
        const arc = Math.sin(this.jumpPhase * Math.PI) * 50; // max arc height
        this.y = this.jumpStartY + (this.groundY - this.jumpStartY) * this.jumpPhase - arc;
      }
    } else if (!this.busy) {
      // Landed and unclaimed: mill around home so the crowd feels alive. While
      // `busy`, the interaction director drives pose/position instead.
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
    // of different sizes rest their bottoms on the same ground line. `elevation`
    // raises the figure for pyramid tiers.
    this.el.style.left = this.x + "px";
    this.el.style.top = (this.y - this.elevation - this.getSpriteSize().h) + "px";

    if (this.phase === "perch") {
      // Perch flourish: glow + wiggle while waiting on the diamond to fall.
      const wiggle = Math.sin(this.perchTime * 14); // fast side-to-side
      const pulse = 0.5 + 0.5 * Math.sin(this.perchTime * 6);
      const glow = this.fallbackColor();
      const blur = (this.getSpriteSize().w * 0.4) * (0.6 + 0.4 * pulse);
      this.el.style.transform = `translateY(${(-1.5 * Math.abs(wiggle)).toFixed(2)}px) rotate(${(wiggle * 9).toFixed(2)}deg)`;
      this.el.style.filter =
        `drop-shadow(0 0 ${blur.toFixed(1)}px ${glow}) drop-shadow(0 0 ${(blur * 0.5).toFixed(1)}px ${glow})`;
    } else if (this.glow) {
      // Performing an activity: steady pulsing aura, no wiggle.
      const pulse = 0.5 + 0.5 * Math.sin(this.clock * 8);
      const glow = this.fallbackColor();
      const blur = (this.getSpriteSize().w * 0.5) * (0.6 + 0.4 * pulse);
      this.el.style.transform = "";
      this.el.style.filter = `drop-shadow(0 0 ${blur.toFixed(1)}px ${glow})`;
    } else {
      this.el.style.transform = "";
      this.el.style.filter = "";
    }

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
