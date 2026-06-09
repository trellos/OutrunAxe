// Character — a party character (a "dude") spawned from quarter/8th diamonds.
//
// Represents a single animated character on the ground plane. Handles state,
// animation frame management, movement, AI, and rendering via DOM. Dudes can
// pick up guns (one per hand) and occasionally fire a laser into the sky.

import { loadSpriteSheet } from "./SpriteLoader";

export type CharacterSize = "big" | "medium" | "small";
export type CharacterTier = "strong" | "weak";
export type CharacterQuality = "loose" | "normal" | "perfect";
export type CharacterPose = "idle" | "walk" | "jump" | "interact";

/** Which gun-variant sheet matches the current hands. */
type GunVariant = "" | "-gunL" | "-gunR" | "-gunLR";

export interface CharacterConfig {
  id: number;
  size: CharacterSize;          // big (perfect), medium (normal), small (loose)
  tier: CharacterTier;          // strong (root/3/5) or weak (other)
  quality: CharacterQuality;    // loose, normal, perfect (timing)
  startX: number;               // ground position (pixel)
  spawnY: number;               // diamond Y (for jump arc)
  groundY: number;              // landed Y position
  perchDuration: number;        // seconds to glow+wiggle on the diamond before falling
  spriteBaseId: string;         // e.g. "big-perfect"; gun variants append a suffix
  onFire?: (origin: { x: number; y: number }) => void; // request a laser shot
  /** Battle mode: the dude is in the water. It swims left/right; if it mounts a
   *  windsurf board it sails faster + wider and kills sharks on contact. No
   *  held-gun sheets are used (windsurf is a pose row on the base sheet). */
  battle?: boolean;
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
  private frameCounts = { idle: 4, walk: 4, jump: 4, interact: 4 }; // frames per pose (one sheet column each)
  private frameRate = 8;        // fps for animation

  // Sprite sheets, keyed by gun variant; loaded lazily and hot-swapped when a
  // gun is picked up. A missing/failed sheet falls back to a colored box.
  private spriteBaseId: string;
  private sheets = new Map<GunVariant, HTMLImageElement | SVGImageElement | null>();
  private pending = new Set<GunVariant>();

  // Guns: one per hand, max two. `hands` tracks which hands are armed.
  private hands = { left: false, right: false };
  private fireCooldown: number;
  private onFire?: (origin: { x: number; y: number }) => void;

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

  // Battle mode (water). `windsurfing` = riding a board (faster/wider, kills
  // sharks on contact, board consumed on first kill). `facing` flips the sprite.
  private battle: boolean;
  private windsurfing = false;
  private facing = 1;           // +1 faces right, -1 faces left

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
    this.spriteBaseId = config.spriteBaseId;
    this.onFire = config.onFire;
    this.battle = config.battle ?? false;
    this.fireCooldown = this.randomFireDelay();

    // Create DOM element
    this.el = document.createElement("div");
    this.el.className = `eddie-character eddie-character-${this.size} eddie-character-${this.tier} eddie-character-${this.quality}`;
    this.el.style.position = "absolute";
    this.el.style.width = this.getSpriteSize().w + "px";
    this.el.style.height = this.getSpriteSize().h + "px";
    // Rotate/scale about the feet so the perch wiggle reads like standing.
    this.el.style.transformOrigin = "50% 100%";

    this.ensureSheet(""); // load the gunless base sheet
    this.updateDOM();
  }

  /** Lazily load the sheet for a gun variant and cache it (null on failure). */
  private ensureSheet(variant: GunVariant): void {
    if (this.sheets.has(variant) || this.pending.has(variant)) return;
    this.pending.add(variant);
    loadSpriteSheet(`${this.spriteBaseId}${variant}`)
      .then((img) => this.sheets.set(variant, img))
      .catch(() => this.sheets.set(variant, null))
      .finally(() => this.pending.delete(variant));
  }

  /** The gun variant matching the current hands. Battle has no held-gun sheets
   *  (windsurfing is a pose on the base sheet), so it always uses the base. */
  private gunVariant(): GunVariant {
    if (this.battle) return "";
    if (this.hands.left && this.hands.right) return "-gunLR";
    if (this.hands.left) return "-gunL";
    if (this.hands.right) return "-gunR";
    return "";
  }

  /** Battle: mount a windsurf board — sail faster/wider and kill sharks on
   *  contact until the board is destroyed. */
  mountBoard(): void {
    this.windsurfing = true;
    this.wanderTarget = null;
    this.wanderTimer = 0;
  }

  /** Battle: the board was destroyed (after a shark kill). Back to swimming. */
  dismountBoard(): void {
    this.windsurfing = false;
  }

  get isWindsurfing(): boolean {
    return this.windsurfing;
  }

  private currentSheet(): HTMLImageElement | SVGImageElement | null {
    return this.sheets.get(this.gunVariant()) ?? null;
  }

  /** Number of guns currently held (0..2). */
  get gunsHeld(): number {
    return (this.hands.left ? 1 : 0) + (this.hands.right ? 1 : 0);
  }

  /** Try to take a gun into a free hand. First gun goes to a random hand, the
   *  second fills the other. Returns true if it was taken. */
  pickupGun(): boolean {
    if (this.gunsHeld >= 2) return false;
    if (!this.hands.left && !this.hands.right) {
      // First gun: random hand.
      if (Math.random() < 0.5) this.hands.left = true;
      else this.hands.right = true;
    } else if (!this.hands.left) {
      this.hands.left = true;
    } else {
      this.hands.right = true;
    }
    this.ensureSheet(this.gunVariant()); // preload the armed sheet
    return true;
  }

  private randomFireDelay(): number {
    return 1.5 + Math.random() * 3;
  }

  /** Size in pixels for this character. */
  getSpriteSize(): { w: number; h: number } {
    switch (this.size) {
      case "big":
        return { w: 64, h: 64 };
      case "medium":
        return { w: 48, h: 48 };
      case "small":
        return { w: 32, h: 32 };
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

    // Occasionally fire a held gun into the sky (even mid-party).
    if (this.phase === "ground" && this.gunsHeld > 0 && this.onFire) {
      this.fireCooldown -= dt;
      if (this.fireCooldown <= 0) {
        this.fireCooldown = this.randomFireDelay();
        this.onFire(this.gunHandOrigin());
      }
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

  /** World position of a gun-holding hand (for the laser origin). Prefers a
   *  random armed hand. */
  private gunHandOrigin(): { x: number; y: number } {
    const { w, h } = this.getSpriteSize();
    // Choose an armed hand.
    let right: boolean;
    if (this.hands.left && this.hands.right) right = Math.random() < 0.5;
    else right = this.hands.right;
    const hx = this.x + (right ? 1 : -1) * w * 0.3;
    const hy = this.y - this.elevation - h * 0.55; // ~chest height
    return { x: hx, y: hy };
  }

  /** Continuous wander: stroll to a nearby spot, then almost always pick a fresh
   *  spot immediately so dudes keep moving and never park (e.g. on top of a gun).
   *  Only occasionally take a short breather. Perfect-tier moves faster. Dudes
   *  wander randomly — they do NOT seek out, target, or stop for guns/rockets;
   *  picking a gun up happens in passing and never touches this movement state. */
  private wander(dt: number): void {
    // Battle: a windsurfing dude sails fast across a wide stretch of water (and
    // never rests); a plain dude swims back and forth in a modest range. The
    // "walk" pose row is the swim/sail animation; "jump" row is the windsurf one.
    const windsurf = this.battle && this.windsurfing;
    const range = windsurf ? 360 : this.battle ? 140 : 160;
    const speed = windsurf
      ? 95
      : this.quality === "perfect" ? 34 : this.quality === "normal" ? 26 : 20;
    const movePose: CharacterPose = windsurf ? "jump" : "walk";

    if (this.wanderTarget === null) {
      // Windsurfers don't rest — pick a new far spot immediately.
      if (windsurf) {
        this.wanderTarget = this.homeX + (Math.random() - 0.5) * 2 * range;
        return;
      }
      this.wanderTimer -= dt;
      this.setPose("idle");
      if (this.wanderTimer <= 0) {
        this.wanderTarget = this.homeX + (Math.random() - 0.5) * range;
      }
      return;
    }
    const step = speed * dt;
    if (Math.abs(this.wanderTarget - this.x) <= step) {
      this.x = this.wanderTarget;
      if (!windsurf && Math.random() < 0.15) {
        this.wanderTarget = null;
        this.wanderTimer = 0.3 + Math.random() * 0.5;
        this.setPose("idle");
      } else {
        this.wanderTarget = this.homeX + (Math.random() - 0.5) * range;
        this.setPose(movePose);
      }
    } else {
      const dir = Math.sign(this.wanderTarget - this.x);
      this.facing = dir || this.facing;
      this.x += dir * step;
      this.setPose(movePose);
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

  /** Battle: flip the sprite to face the travel direction. No-op on land. */
  private facingFlip(): string {
    return this.battle && this.facing < 0 ? "scaleX(-1)" : "";
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
      this.el.style.transform = this.facingFlip();
      this.el.style.filter = `drop-shadow(0 0 ${blur.toFixed(1)}px ${glow})`;
    } else {
      this.el.style.transform = this.facingFlip();
      this.el.style.filter = "";
    }

    const sheet = this.currentSheet();
    if (sheet) {
      // Render the selected cell of the sheet — no tiling.
      const frame = this.getSpriteFrame();
      this.el.style.backgroundColor = "transparent";
      // Clear the fallback box styling (set before the sheet loaded) so no
      // rounded glowing rectangle lingers behind the transparent sprite.
      this.el.style.borderRadius = "0";
      this.el.style.boxShadow = "none";
      this.el.style.backgroundImage = `url(${(sheet as HTMLImageElement).src})`;
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
