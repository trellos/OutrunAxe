// CharacterManager — spawn, update, and render characters.
//
// Subscribes to juice events (eddieNoteScored), spawns characters,
// manages animation and AI, renders to a container div.

import type { EventBus } from "../../engine/EventBus";
import type { EddieJuiceEvents } from "../../music/eddie/eddieTypes";
import { Character, type CharacterSize, type CharacterTier, type CharacterQuality } from "./Character";
import { loadSpriteSheet, type SpriteSheetId } from "./SpriteLoader";
import { InteractionDirector } from "./InteractionDirector";

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
  private director: InteractionDirector;

  // Scored quarters (with their per-diamond note content + timing) buffered per
  // grid row until the row finishes.
  private pendingByRow = new Map<
    number,
    Array<{
      measure: number;
      beat: number;
      subdiv: number;
      notes: Array<{ strong: boolean; quality: number }>;
    }>
  >();

  // Listeners
  private offFinale?: () => void;
  private offIntensity?: () => void;

  constructor(config: CharacterManagerConfig) {
    this.juice = config.juice;
    this.resolveCell = config.resolveCell;
    this.beatDuration = config.beatDuration;
    this.director = new InteractionDirector(() => this.characters.values());

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
    // Final row never sees a following row-boundary; the finale releases it.
    this.offFinale = this.juice.on("eddieFinale", () => this.flushAllRows());
  }

  /** Grid callback: a quarter's diamonds were drawn. Buffer it by grid row; the
   *  whole row's crowd is released together once the row's final measure
   *  finishes (see setActiveMeasure). One `notes` entry per diamond carries that
   *  note's content (strong = chord tone) and timing tightness. */
  onQuarterDiamonds(info: {
    measure: number;
    beat: number;
    subdiv: number;
    notes: Array<{ strong: boolean; quality: number }>;
  }): void {
    const row = Math.floor(info.measure / 4);
    let list = this.pendingByRow.get(row);
    if (!list) this.pendingByRow.set(row, (list = []));
    list.push(info);
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

  /** Map a quarter's subdivision (1..4 diamonds) to character size.
   *  quarter/eighth → big, triplet → medium, sixteenth → small. */
  private sizeForSubdiv(subdiv: number): CharacterSize {
    if (subdiv >= 4) return "small";
    if (subdiv === 3) return "medium";
    return "big";
  }

  /** Map timing tightness (0 loose .. 1 dead-on) to a quality tier. Perfect is
   *  deliberately tight so it stays a visible cut above. */
  private qualityForTiming(q: number): CharacterQuality {
    if (q >= 0.8) return "perfect";
    if (q >= 0.45) return "normal";
    return "loose";
  }

  /** Spawn the whole buffered row at once — ONE character per diamond. Each
   *  character gets its own random 0..4 beat perch so the row falls staggered
   *  across four beats. */
  private flushRow(row: number): void {
    const quarters = this.pendingByRow.get(row);
    this.pendingByRow.delete(row);
    if (!quarters) return;

    for (const { measure, beat, subdiv, notes } of quarters) {
      // Size comes from the rhythm (subdivision); tier + quality come from the
      // note that drew each diamond.
      const size = this.sizeForSubdiv(subdiv);

      // The quarter occupies column `beat` of the 4-column measure cell; its
      // `subdiv` diamonds span that column. Spawn one character over each.
      const cellRect = this.resolveCell(measure);
      const quarterW = cellRect ? cellRect.width / 4 : 60;
      const quarterLeft = cellRect ? cellRect.left + beat * quarterW : 250;
      const spawnY = cellRect ? cellRect.top + cellRect.height / 2 : 150;

      for (let i = 0; i < subdiv; i++) {
        const diamondX = quarterLeft + ((i + 0.5) / subdiv) * quarterW;
        const note = notes[i] ?? notes[notes.length - 1];
        const tier: CharacterTier = note?.strong ? "strong" : "weak";
        const qualityTier = this.qualityForTiming(note?.quality ?? 0);
        this.spawnCharacter(size, tier, qualityTier, diamondX, spawnY);
      }
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
    // Small jitter so neighbours don't perfectly overlap, but each still lands
    // under its own diamond.
    const landX = startX + (Math.random() - 0.5) * 14;

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
    // Director first so it can claim/release characters, then each character
    // animates (busy ones are driven by the director, the rest wander).
    this.director.update(dt);
    for (const char of this.characters.values()) {
      char.update(dt);
    }
  }

  /** Dispose: unsubscribe and clean up all characters. */
  dispose(): void {
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
