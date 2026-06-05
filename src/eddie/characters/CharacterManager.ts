// CharacterManager — spawn, update, and render characters.
//
// Subscribes to juice events (eddieNoteScored), spawns characters,
// manages animation and AI, renders to a container div.

import type { EventBus } from "../../engine/EventBus";
import type { EddieJuiceEvents } from "../../music/eddie/eddieTypes";
import { Character, type CharacterSize, type CharacterTier, type CharacterQuality } from "./Character";
import { loadSpriteSheet, type SpriteSheetId } from "./SpriteLoader";

interface CharacterManagerConfig {
  juice: EventBus<EddieJuiceEvents>;
  hudParent: HTMLElement;
  resolveCell: (measure: number) => DOMRect | null;
}

export class CharacterManager {
  private juice: EventBus<EddieJuiceEvents>;
  private container: HTMLDivElement;
  private characters: Map<number, Character> = new Map();
  private nextId = 0;
  private resolveCell: (measure: number) => DOMRect | null;

  // Listeners
  private offScored?: () => void;
  private offIntensity?: () => void;

  constructor(config: CharacterManagerConfig) {
    this.juice = config.juice;
    this.resolveCell = config.resolveCell;

    // Create container
    this.container = document.createElement("div");
    this.container.className = "eddie-characters";
    this.container.style.position = "absolute";
    this.container.style.inset = "0";
    this.container.style.pointerEvents = "none";
    this.container.style.zIndex = "6";
    this.container.style.overflow = "hidden";
    config.hudParent.appendChild(this.container);
  }

  /** Feet baseline: just below the bottom row of the grid, derived live from the
   *  grid cells so the crowd hugs the lowest timeline on any screen. The +44
   *  clears the tallest (big = 32px) figure plus a small gap below the grid. */
  private groundY(): number {
    let gridBottom = 0;
    for (let m = 12; m <= 15; m++) {
      const r = this.resolveCell(m);
      if (r) gridBottom = Math.max(gridBottom, r.bottom);
    }
    if (gridBottom > 0) return gridBottom + 44;
    const h = this.container.clientHeight || window.innerHeight;
    return h - 90;
  }

  /** Mount: subscribe to events. */
  mount(): void {
    this.offScored = this.juice.on("eddieNoteScored", (ev) => {
      this.onNoteScored(ev);
    });
  }

  /** Handle a scored quarter. Spawn character(s). */
  private onNoteScored(ev: EddieJuiceEvents["eddieNoteScored"]): void {
    const { measure, beat } = ev;

    // Determine size from beat (placeholder: 0→big, 1→medium, 2→medium, 3→small)
    let size: CharacterSize;
    switch (beat) {
      case 0:
        size = "big";
        break;
      case 1:
      case 2:
        size = "medium";
        break;
      case 3:
        size = "small";
        break;
      default:
        size = "big";
    }

    // Determine tier and quality randomly for now (will improve with better event data)
    const tier: CharacterTier = Math.random() > 0.5 ? "strong" : "weak";
    const qualityTier: CharacterQuality = ["loose", "normal", "perfect"][Math.floor(Math.random() * 3)] as CharacterQuality;

    // Get diamond position from measure cell
    const cellRect = this.resolveCell(measure);
    const startX = cellRect ? cellRect.left + cellRect.width / 2 : 250;
    const spawnY = cellRect ? cellRect.top + cellRect.height / 2 : 150;

    // Spawn character
    this.spawnCharacter(size, tier, qualityTier, startX, spawnY);
  }

  /** Spawn a single character. */
  private async spawnCharacter(
    size: CharacterSize,
    tier: CharacterTier,
    quality: CharacterQuality,
    startX: number,
    spawnY: number,
  ): Promise<void> {
    // Land somewhere along the ground near the diamond's column so a crowd
    // reads instead of every character stacking on one pixel.
    const landX = startX + (Math.random() - 0.5) * 80;

    // Load sprite sheet. On failure the character still spawns and renders its
    // solid colored-box fallback — so a missing/404 asset never hides the crowd.
    const spriteId: SpriteSheetId = `${size}-${quality}`;
    const spriteSheet = await loadSpriteSheet(spriteId).catch((err) => {
      console.warn(`[characters] sprite "${spriteId}" failed to load, using box fallback:`, err);
      return null;
    });

    // Create character
    const char = new Character({
      id: this.nextId++,
      size,
      tier,
      quality,
      startX: landX,
      spawnY,
      groundY: this.groundY(),
      spriteSheet,
    });

    // Add to DOM and tracking
    this.container.appendChild(char.el);
    this.characters.set(char.id, char);
  }

  /** Update all characters. Called each frame from art rig. */
  update(dt: number): void {
    for (const char of this.characters.values()) {
      char.update(dt);
    }
  }

  /** Dispose: unsubscribe and clean up all characters. */
  dispose(): void {
    this.offScored?.();
    this.offIntensity?.();
    for (const char of this.characters.values()) {
      char.dispose();
    }
    this.characters.clear();
    this.container.remove();
  }
}
