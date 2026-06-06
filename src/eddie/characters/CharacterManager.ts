// CharacterManager — spawn, update, and render the Infinite Eddie crowd.
//
// Each scored quarter's diamonds spawn entities (one per diamond), chosen by the
// quarter's rhythmic SUBDIVISION and sized by each note's ACCURACY:
//   quarter / 8th (subdiv 1-2) -> dudes
//   triplet      (subdiv 3)    -> guns   (dudes bump into them and pick them up)
//   16th         (subdiv 4)    -> rockets (dudes bump them; they fire skyward)
//
// The manager owns every pool, runs the dude<->gun and dude<->rocket collisions,
// and routes gun/rocket fire at a TargetProvider (today the sky; later: enemies).

import type { EventBus } from "../../engine/EventBus";
import type { EddieJuiceEvents } from "../../music/eddie/eddieTypes";
import { Character, type CharacterSize, type CharacterTier, type CharacterQuality } from "./Character";
import { Gun } from "./Gun";
import { Rocket } from "./Rocket";
import { Beam, Spark, Explosion, type Effect } from "./effects";
import { TargetProvider } from "./TargetProvider";
import { InteractionDirector } from "./InteractionDirector";

interface CharacterManagerConfig {
  juice: EventBus<EddieJuiceEvents>;
  hudParent: HTMLElement;
  resolveCell: (measure: number) => DOMRect | null;
  beatDuration: number; // seconds per beat (60 / bpm) — drives the perch stagger
}

const PICKUP_RANGE = 16; // px between a dude and a floor gun to pick it up
const TRIGGER_RANGE = 20; // px between a dude and a grounded rocket to set it off

export class CharacterManager {
  private juice: EventBus<EddieJuiceEvents>;
  private container: HTMLDivElement;
  private characters: Map<number, Character> = new Map();
  private guns: Gun[] = [];
  private rockets: Rocket[] = [];
  private effects: Effect[] = [];
  private nextId = 0;
  private resolveCell: (measure: number) => DOMRect | null;
  private beatDuration: number;
  private director: InteractionDirector;
  private targets: TargetProvider;

  // Scored quarters (with their per-diamond note content + timing) buffered per
  // MEASURE until that measure finishes, so the crowd spawns every measure.
  private pendingByMeasure = new Map<
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
    this.targets = new TargetProvider(config.resolveCell);

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
   *  grid cells so the crowd hugs the lowest timeline on any screen. The +76
   *  clears the tallest dude (big = 64px) plus a small gap below the grid. */
  private groundY(): number {
    let gridBottom = 0;
    for (let m = 12; m <= 15; m++) {
      const r = this.resolveCell(m);
      if (r) gridBottom = Math.max(gridBottom, r.bottom);
    }
    if (gridBottom > 0) return gridBottom + 76;
    const h = this.container.clientHeight || window.innerHeight;
    return h - 90;
  }

  /** Mount: subscribe to events. */
  mount(): void {
    // The final measure never sees a following measure-boundary; finale releases it.
    this.offFinale = this.juice.on("eddieFinale", () => this.flushAll());
  }

  /** Grid callback: a quarter's diamonds were drawn. Buffer it by measure; the
   *  measure's crowd is released once that measure finishes (see
   *  setActiveMeasure). One `notes` entry per diamond carries that note's
   *  content (strong = chord tone) and timing tightness. */
  onQuarterDiamonds(info: {
    measure: number;
    beat: number;
    subdiv: number;
    notes: Array<{ strong: boolean; quality: number }>;
  }): void {
    let list = this.pendingByMeasure.get(info.measure);
    if (!list) this.pendingByMeasure.set(info.measure, (list = []));
    list.push(info);
  }

  /** Called as the active measure advances. Releases every measure that has now
   *  fully elapsed (the active measure moved past it); the last measure waits
   *  for the finale. */
  setActiveMeasure(measure: number): void {
    if (measure < 0) return; // intro/count-in rows
    for (const m of [...this.pendingByMeasure.keys()].sort((a, b) => a - b)) {
      if (m < measure) this.flushMeasure(m);
    }
  }

  /** Release all remaining buffered measures (song end). */
  private flushAll(): void {
    for (const m of [...this.pendingByMeasure.keys()].sort((a, b) => a - b)) {
      this.flushMeasure(m);
    }
  }

  /** Map note ACCURACY (timing tier) to figure size. Better timing → bigger.
   *  perfect → big, normal → medium, loose → small. */
  private sizeForAccuracy(quality: CharacterQuality): CharacterSize {
    if (quality === "perfect") return "big";
    if (quality === "normal") return "medium";
    return "small";
  }

  /** Map timing tightness (0 loose .. 1 dead-on) to a quality tier. Perfect is
   *  deliberately tight so it stays a visible cut above. */
  private qualityForTiming(q: number): CharacterQuality {
    if (q >= 0.8) return "perfect";
    if (q >= 0.45) return "normal";
    return "loose";
  }

  /** Spawn a whole buffered measure at once — ONE entity per diamond. The
   *  quarter's subdivision picks WHAT spawns; each note's accuracy picks its
   *  size. Each gets its own random perch so the measure falls staggered. */
  private flushMeasure(measure: number): void {
    const quarters = this.pendingByMeasure.get(measure);
    this.pendingByMeasure.delete(measure);
    if (!quarters) return;

    for (const { measure, beat, subdiv, notes } of quarters) {
      // The quarter occupies column `beat` of the 4-column measure cell; its
      // `subdiv` diamonds span that column. Spawn one entity over each.
      const cellRect = this.resolveCell(measure);
      const quarterW = cellRect ? cellRect.width / 4 : 60;
      const quarterLeft = cellRect ? cellRect.left + beat * quarterW : 250;
      const spawnY = cellRect ? cellRect.top + cellRect.height / 2 : 150;

      for (let i = 0; i < subdiv; i++) {
        const diamondX = quarterLeft + ((i + 0.5) / subdiv) * quarterW;
        const note = notes[i] ?? notes[notes.length - 1];
        const quality = this.qualityForTiming(note?.quality ?? 0);
        const size = this.sizeForAccuracy(quality);
        const tier: CharacterTier = note?.strong ? "strong" : "weak";

        if (subdiv <= 2) this.spawnDude(size, tier, quality, diamondX, spawnY);
        else if (subdiv === 3) this.spawnGun(quality, diamondX, spawnY);
        else this.spawnRocket(quality, diamondX, spawnY);
      }
    }
  }

  /** Small landing jitter so neighbours don't perfectly overlap. */
  private jitterX(x: number): number {
    return x + (Math.random() - 0.5) * 14;
  }

  /** Random perch of 0..2 beats so a measure's entities wiggle then fall
   *  staggered (kept short now that a whole measure spawns at once). */
  private randomPerch(): number {
    return Math.random() * 2 * this.beatDuration;
  }

  /** Spawn a dude (quarter/8th). */
  private spawnDude(
    size: CharacterSize,
    tier: CharacterTier,
    quality: CharacterQuality,
    startX: number,
    spawnY: number,
  ): void {
    const char = new Character({
      id: this.nextId++,
      size,
      tier,
      quality,
      startX: this.jitterX(startX),
      spawnY,
      groundY: this.groundY(),
      perchDuration: this.randomPerch(),
      spriteBaseId: `${size}-${quality}`,
      onFire: (origin) => this.fireLaser(origin),
    });
    this.container.appendChild(char.el);
    this.characters.set(char.id, char);
  }

  /** Spawn a floor gun (triplet). */
  private spawnGun(quality: CharacterQuality, startX: number, spawnY: number): void {
    const gun = new Gun({
      id: this.nextId++,
      quality,
      startX: this.jitterX(startX),
      spawnY,
      groundY: this.groundY(),
      perchDuration: this.randomPerch(),
    });
    this.container.appendChild(gun.el);
    this.guns.push(gun);
  }

  /** Spawn a rocket (16th). */
  private spawnRocket(quality: CharacterQuality, startX: number, spawnY: number): void {
    const variant = (1 + Math.floor(Math.random() * 3)) as 1 | 2 | 3;
    const rocket = new Rocket({
      id: this.nextId++,
      quality,
      variant,
      startX: this.jitterX(startX),
      spawnY,
      groundY: this.groundY(),
      perchDuration: this.randomPerch(),
      onEmit: (x, y) => this.effects.push(new Spark(this.container, x, y)),
      onExplode: (x, y, scale) => this.effects.push(new Explosion(this.container, x, y, scale)),
    });
    this.container.appendChild(rocket.el);
    this.rockets.push(rocket);
  }

  /** A dude fired a held gun: shoot a laser from its hand to a sky target. */
  private fireLaser(origin: { x: number; y: number }): void {
    this.effects.push(new Beam(this.container, origin, this.targets.random()));
  }

  /** Update all entities + effects, then resolve pickups/triggers. */
  update(dt: number): void {
    // Director first so it can claim/release characters (parties = idle layer),
    // then each entity animates.
    this.director.update(dt);
    for (const char of this.characters.values()) char.update(dt);
    for (const gun of this.guns) gun.update(dt);
    for (const rocket of this.rockets) rocket.update(dt);

    this.handleCollisions();

    // Reap finished rockets.
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      if (this.rockets[i].isDone) {
        this.rockets[i].dispose();
        this.rockets.splice(i, 1);
      }
    }
    // Tick effects; each removes its own DOM when it returns done.
    for (let i = this.effects.length - 1; i >= 0; i--) {
      if (this.effects[i].update(dt)) this.effects.splice(i, 1);
    }
  }

  /** Dudes incidentally bump guns (pick up) and rockets (set off). Dudes never
   *  aim for them — these only fire when a random wander happens to collide. */
  private handleCollisions(): void {
    // Gun pickups.
    for (let gi = this.guns.length - 1; gi >= 0; gi--) {
      const gun = this.guns[gi];
      if (!gun.available) continue;
      for (const c of this.characters.values()) {
        if (!c.grounded || c.gunsHeld >= 2) continue;
        if (Math.abs(c.x - gun.x) <= PICKUP_RANGE && c.pickupGun()) {
          gun.markPickedUp();
          gun.dispose();
          this.guns.splice(gi, 1);
          break;
        }
      }
    }

    // Rocket triggers.
    for (const r of this.rockets) {
      if (!r.armed) continue;
      for (const c of this.characters.values()) {
        if (!c.grounded) continue;
        if (Math.abs(c.x - r.x) <= TRIGGER_RANGE) {
          r.trigger(this.targets.random());
          break;
        }
      }
    }
  }

  /** Dispose: unsubscribe and clean up everything. */
  dispose(): void {
    this.offFinale?.();
    this.offIntensity?.();
    this.pendingByMeasure.clear();
    for (const char of this.characters.values()) char.dispose();
    this.characters.clear();
    for (const gun of this.guns) gun.dispose();
    this.guns = [];
    for (const rocket of this.rockets) rocket.dispose();
    this.rockets = [];
    for (const fx of this.effects) fx.dispose();
    this.effects = [];
    this.container.remove();
  }
}
