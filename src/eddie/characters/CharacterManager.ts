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
  beatDuration: number; // seconds per beat (60 / bpm) — drives the perch stagger
}

export class CharacterManager {
  private juice: EventBus<EddieJuiceEvents>;
  private container: HTMLDivElement;
  private characters: Map<number, Character> = new Map();
  private nextId = 0;
  private resolveCell: (measure: number) => DOMRect | null;
  private beatDuration: number;

  // Scored quarters buffered per grid row until the row finishes.
  private pendingByRow = new Map<number, Array<{ measure: number; beat: number }>>();

  // Listeners
  private offScored?: () => void;
  private offFinale?: () => void;
  private offIntensity?: () => void;

  constructor(config: CharacterManagerConfig) {
    this.juice = config.juice;
    this.resolveCell = config.resolveCell;
    this.beatDuration = config.beatDuration;

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
    // Buffer scored quarters by grid row; the whole row's crowd is released
    // together once the row's final measure finishes (see setActiveMeasure).
    this.offScored = this.juice.on("eddieNoteScored", (ev) => {
      const row = Math.floor(ev.measure / 4);
      let list = this.pendingByRow.get(row);
      if (!list) this.pendingByRow.set(row, (list = []));
      list.push({ measure: ev.measure, beat: ev.beat });
    });
    // Final row never sees a following row-boundary; the finale releases it.
    this.offFinale = this.juice.on("eddieFinale", () => this.flushAllRows());
  }

  /** Called as the active measure advances. Releases every row whose final
   *  measure has now fully elapsed (rows 0..N-2; the last row waits for finale). */
  setActiveMeasure(measure: number): void {
    if (measure < 0) return; // intro/count-in rows
    for (const row of [...this.pendingByRow.keys()].sort((a, b) => a - b)) {
      if ((row + 1) * 4 <= measure) this.flushRow(row);
    }
  }

  /** Release all remaining buffered rows (song end). */
  private flushAllRows(): void {
    for (const row of [...this.pendingByRow.keys()].sort((a, b) => a - b)) {
      this.flushRow(row);
    }
  }

  /** Spawn the whole buffered row at once; each character gets its own random
   *  0..4 beat perch so the row falls staggered across four beats. */
  private flushRow(row: number): void {
    const quarters = this.pendingByRow.get(row);
    this.pendingByRow.delete(row);
    if (!quarters) return;

    for (const { measure, beat } of quarters) {
      // Size from beat (placeholder: 0→big, 1/2→medium, 3→small).
      const size: CharacterSize =
        beat === 0 ? "big" : beat === 3 ? "small" : "medium";

      // Tier/quality still randomized (real note-content + timing TBD).
      const tier: CharacterTier = Math.random() > 0.5 ? "strong" : "weak";
      const quality: CharacterQuality =
        (["loose", "normal", "perfect"] as const)[Math.floor(Math.random() * 3)];

      // Diamond position from the measure's grid cell.
      const cellRect = this.resolveCell(measure);
      const startX = cellRect ? cellRect.left + cellRect.width / 2 : 250;
      const spawnY = cellRect ? cellRect.top + cellRect.height / 2 : 150;

      this.spawnCharacter(size, tier, quality, startX, spawnY);
    }
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

    // Random perch of 0..4 beats so the row's characters wiggle on their
    // diamonds and then fall at staggered times over four beats.
    const perchDuration = Math.random() * 4 * this.beatDuration;

    // Create character
    const char = new Character({
      id: this.nextId++,
      size,
      tier,
      quality,
      startX: landX,
      spawnY,
      groundY: this.groundY(),
      perchDuration,
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
    this.offFinale?.();
    this.offIntensity?.();
    this.pendingByRow.clear();
    for (const char of this.characters.values()) {
      char.dispose();
    }
    this.characters.clear();
    this.container.remove();
  }
}
