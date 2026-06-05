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
  private groundY: number = 0;

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

    // Estimate ground Y (below grid, or in grid footer area)
    // For now, a fixed reasonable value; could be tuned later
    this.groundY = 500;
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
    // Load sprite sheet
    const spriteId: SpriteSheetId = `${size}-${quality}`;
    const spriteSheet = await loadSpriteSheet(spriteId).catch((err) => {
      console.warn(err);
      return null;
    });

    if (!spriteSheet) return; // Failed to load sprite

    // Create character
    const char = new Character({
      id: this.nextId++,
      size,
      tier,
      quality,
      startX,
      spawnY,
      groundY: this.groundY,
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
