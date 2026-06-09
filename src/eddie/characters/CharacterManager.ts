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
import { Beam, Spark, Explosion, Blood, Bonk, type Effect } from "./effects";
import { Shark } from "./Shark";
import { TargetProvider } from "./TargetProvider";
import { InteractionDirector } from "./InteractionDirector";

interface CharacterManagerConfig {
  juice: EventBus<EddieJuiceEvents>;
  hudParent: HTMLElement;
  resolveCell: (measure: number) => DOMRect | null;
  beatDuration: number; // seconds per beat (60 / bpm) — drives the perch stagger
  /** Battle mode: the crowd is in the water fighting sharks. Enables shark spawns
   *  (1 per measure), windsurf/boomerang shark kills, and the eat interaction. */
  battle?: boolean;
  /** Battle: the people line, as a fraction of viewport height (≈0.8 = near the
   *  bottom of the water). Overrides the default below-the-grid placement. */
  groundFraction?: number;
  /** Battle scorekeeping callbacks. */
  onSharkKilled?: () => void;
  onDudeEaten?: () => void;
}

// Battle tuning.
const SHARK_DESCEND_MEASURES = 8;    // measures to swim from horizon to the line
const SHARK_KILL_RANGE = 30;         // px proximity for shark↔person/board/boomerang
const SUN_HALF_FRAC = 0.12;          // half-width of the central sun, as frac of W
const HORIZON_FRAC = 0.30;           // shark spawn y, as fraction of viewport height

const PICKUP_RANGE = 16; // px between a dude and a floor gun to pick it up
const TRIGGER_RANGE = 20; // px between a dude and a grounded rocket to set it off

export class CharacterManager {
  private juice: EventBus<EddieJuiceEvents>;
  private container: HTMLDivElement;
  private characters: Map<number, Character> = new Map();
  private guns: Gun[] = [];
  private rockets: Rocket[] = [];
  private sharks: Shark[] = [];
  private effects: Effect[] = [];
  private nextId = 0;
  private resolveCell: (measure: number) => DOMRect | null;
  private beatDuration: number;
  private director: InteractionDirector;
  private targets: TargetProvider;

  // Battle state.
  private battle: boolean;
  private groundFraction?: number;
  private onSharkKilled?: () => void;
  private onDudeEaten?: () => void;

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
    this.battle = config.battle ?? false;
    this.groundFraction = config.groundFraction;
    this.onSharkKilled = config.onSharkKilled;
    this.onDudeEaten = config.onDudeEaten;
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
    // Battle: line the people up at a fixed fraction down the water (≈80%).
    if (this.battle && this.groundFraction !== undefined) {
      return (this.container.clientHeight || window.innerHeight) * this.groundFraction;
    }
    let gridBottom = 0;
    for (let m = 12; m <= 15; m++) {
      const r = this.resolveCell(m);
      if (r) gridBottom = Math.max(gridBottom, r.bottom);
    }
    if (gridBottom > 0) return gridBottom + 152; // twice as far below the timelines
    const h = this.container.clientHeight || window.innerHeight;
    return h - 90;
  }

  private viewW(): number {
    return this.container.clientWidth || window.innerWidth;
  }

  private viewH(): number {
    return this.container.clientHeight || window.innerHeight;
  }

  /** Spawn one shark from the horizon, in an outer band on one side of the sun.
   *  Music-locked: called once per measure from setActiveMeasure in battle. */
  private spawnShark(): void {
    const W = this.viewW();
    const cx = W / 2;
    const sunHalf = W * SUN_HALF_FRAC;
    // Band on each side: from the midpoint of (sun edge → screen edge) to the edge.
    const rightBand = { lo: (cx + sunHalf + W) / 2, hi: W * 0.97 };
    const leftBand = { lo: W * 0.03, hi: (cx - sunHalf) / 2 };
    const right = Math.random() < 0.5;
    const band = right ? rightBand : leftBand;
    const startX = band.lo + Math.random() * Math.max(1, band.hi - band.lo);
    const shark = new Shark({
      id: this.nextId++,
      startX,
      startY: this.viewH() * HORIZON_FRAC,
      groundY: this.groundY(),
      descendSeconds: SHARK_DESCEND_MEASURES * 4 * this.beatDuration,
      screenW: W,
    });
    this.container.appendChild(shark.el);
    this.sharks.push(shark);
  }

  /** Nearest live shark to a point, or null. Used to aim boomerangs. */
  private nearestShark(x: number, y: number): Shark | null {
    let best: Shark | null = null;
    let bestD = Infinity;
    for (const s of this.sharks) {
      if (!s.alive) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  /** Kill a shark: blood splash at it, score it, remove it. */
  private killShark(s: Shark): void {
    if (!s.alive) return;
    this.effects.push(new Blood(this.container, s.x, s.y, 1));
    s.kill();
    this.onSharkKilled?.();
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

  /** Battle: spawn one shark — called once per BEAT from BattleState so sharks
   *  pour in fast. No-op outside battle. */
  battleBeat(): void {
    if (this.battle) this.spawnShark();
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
      // Battle dudes swim in the water (separate sheets, no held guns/lasers).
      spriteBaseId: this.battle ? `swim-${size}` : `${size}-${quality}`,
      battle: this.battle,
      onFire: this.battle ? undefined : (origin) => this.fireLaser(origin),
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
      battle: this.battle, // windsurf board in battle
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
      battle: this.battle, // boomerang in battle
      onEmit: (x, y) => this.effects.push(new Spark(this.container, x, y)),
      // Battle: the boomerang reaching its target without a mid-flight hit just
      // splashes (kills are resolved by proximity in handleCollisions). Score Run:
      // a real explosion.
      onExplode: (x, y, scale) =>
        this.effects.push(
          this.battle ? new Spark(this.container, x, y) : new Explosion(this.container, x, y, scale),
        ),
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
    // In battle the crowd is fighting, not partying — skip the idle director so
    // dudes keep swimming/sailing freely.
    if (!this.battle) this.director.update(dt);
    for (const char of this.characters.values()) char.update(dt);
    for (const gun of this.guns) gun.update(dt);
    for (const rocket of this.rockets) rocket.update(dt);
    for (const shark of this.sharks) shark.update(dt);

    this.handleCollisions();

    // Reap finished rockets.
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      if (this.rockets[i].isDone) {
        this.rockets[i].dispose();
        this.rockets.splice(i, 1);
      }
    }
    // Reap finished sharks (swam off, or killed).
    for (let i = this.sharks.length - 1; i >= 0; i--) {
      if (this.sharks[i].isDone) {
        this.sharks[i].dispose();
        this.sharks.splice(i, 1);
      }
    }
    // Tick effects; each removes its own DOM when it returns done.
    for (let i = this.effects.length - 1; i >= 0; i--) {
      if (this.effects[i].update(dt)) this.effects.splice(i, 1);
    }
  }

  /** Dudes incidentally bump guns (pick up) and rockets (set off). Dudes never
   *  aim for them — these only fire when a random wander happens to collide. */
  /** A shark reached a person: blood splash + the dude is removed (eaten). */
  private eatDude(c: Character): void {
    this.effects.push(new Blood(this.container, c.x, this.groundY() - 18, 0.9));
    this.characters.delete(c.id);
    c.dispose();
    this.onDudeEaten?.();
  }

  /** Battle interactions: board mounts, boomerang launches/strikes, and sharks
   *  eating people / being killed by windsurfers + boomerangs. */
  private handleBattleCollisions(): void {
    const line = this.groundY();

    // Windsurf board pickups → the dude mounts and starts sailing.
    for (let gi = this.guns.length - 1; gi >= 0; gi--) {
      const board = this.guns[gi];
      if (!board.available) continue;
      for (const c of this.characters.values()) {
        if (!c.grounded || c.isWindsurfing) continue;
        if (Math.abs(c.x - board.x) <= PICKUP_RANGE) {
          c.mountBoard();
          board.markPickedUp();
          board.dispose();
          this.guns.splice(gi, 1);
          break;
        }
      }
    }

    // Boomerang launches: a grounded dude bumps a grounded boomerang → it flies
    // at the nearest shark (or off toward the horizon if none).
    for (const r of this.rockets) {
      if (!r.armed) continue;
      for (const c of this.characters.values()) {
        if (!c.grounded) continue;
        if (Math.abs(c.x - r.x) <= TRIGGER_RANGE) {
          const s = this.nearestShark(r.x, line);
          r.trigger(s ? { x: s.x, y: s.y } : { x: r.x, y: this.viewH() * HORIZON_FRAC });
          break;
        }
      }
    }

    // A boomerang in flight strikes a shark → bonk + blood + kill.
    for (const r of this.rockets) {
      if (!r.flying) continue;
      for (const s of this.sharks) {
        if (!s.alive) continue;
        if (Math.hypot(s.x - r.cx, s.y - r.cy) <= SHARK_KILL_RANGE) {
          this.effects.push(new Bonk(this.container, s.x, s.y));
          this.killShark(s);
          r.endFlight();
          break;
        }
      }
    }

    // Sharks meeting people at the line: a windsurfer kills the shark (board
    // destroyed); a plain dude gets eaten.
    for (const s of this.sharks) {
      if (!s.alive) continue;
      if (Math.abs(s.y - line) > 70) continue; // only interact near the line
      for (const c of this.characters.values()) {
        if (!c.grounded) continue;
        if (Math.abs(c.x - s.x) > SHARK_KILL_RANGE) continue;
        if (c.isWindsurfing) {
          this.killShark(s);
          c.dismountBoard();
        } else {
          this.eatDude(c);
        }
        break; // one interaction per shark per frame
      }
    }
  }

  private handleCollisions(): void {
    if (this.battle) {
      this.handleBattleCollisions();
      return;
    }
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
    for (const shark of this.sharks) shark.dispose();
    this.sharks = [];
    for (const fx of this.effects) fx.dispose();
    this.effects = [];
    this.container.remove();
  }
}
