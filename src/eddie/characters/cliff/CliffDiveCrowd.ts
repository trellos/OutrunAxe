// CliffDiveCrowd — the Cliff Dive crowd manager (parallel to CharacterManager;
// it does NOT reuse it). Owns Climbers/Dolphins/Lobsters/Orbs + effects, runs
// the Cliff Dive spawn map, the per-measure dolphin waves, the orb heal policy,
// the lobster-cancels-dolphin interception, the intensity→mermaid swap, and the
// swan-dive finale.
//
// SPAWN MAP (from scored quarters, keyed by subdivision):
//   subdiv 1 (quarter)   -> 2 MEN, one to the LEFT edge + one to the RIGHT edge.
//   subdiv 2 (eighth)    -> 1 MAN, at the MIDDLE of the note bar.
//   subdiv 3 (triplet)   -> 3 healing ORBS (one per diamond).
//   subdiv 4 (sixteenth) -> 4 LOBSTERS (one per diamond).
//
// HEADLESS / TESTABILITY: an injectable rng (default Math.random), an injected
// resolveCell + viewport providers, and pure update(dt) + explicit
// onQuarterDiamonds/measureWave/beat advance. No AudioContext, no wall-clock.
// DOM is created only when `document` exists (entities + effects guard
// themselves), and queryable getters expose the full sim state for assertions.

import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";
import { Climber, type ClimberEdge, type ClimberTier, type BoxRect } from "./Climber";
import { Dolphin } from "./Dolphin";
import { Lobster, LOBSTER_RADIUS } from "./Lobster";
import { Orb } from "./Orb";
import { Splash, type Effect } from "../effects";

export type Rng = () => number;

export interface CliffDiveCrowdConfig {
  juice?: EventBus<EddieJuiceEvents>;
  /** HUD container for DOM rendering (omitted/headless = pure sim). */
  hudParent?: HTMLElement;
  /** Per-measure box rect provider (the art rig's resolveCell). Null tolerated. */
  resolveCell: (measure: number) => DOMRect | BoxRect | null;
  /** Seconds per beat (60 / bpm) — drives climb speed + dolphin arc duration. */
  beatDuration: number;
  /** Viewport size providers (default window). */
  viewW?: () => number;
  viewH?: () => number;
  /** Injectable RNG for determinism. Default Math.random. */
  rng?: Rng;
  /** Scorekeeping callbacks. */
  onDolphinKnockdown?: () => void; // a man was knocked into the water by a dolphin
  onDudeDive?: () => void; // a man cliff-dived (finale)
}

/** Up to this many dolphins jump per measure wave. */
const DOLPHINS_PER_WAVE = 4;
/** A spit-spawned splash water line: fraction of viewport height. */
const WATER_FRACTION = 0.92;

interface PendingQuarter {
  measure: number;
  beat: number;
  subdiv: number;
  notes: Array<{ strong: boolean; quality: number }>;
}

export class CliffDiveCrowd {
  private juice?: EventBus<EddieJuiceEvents>;
  private container: HTMLDivElement | null = null;
  private resolveCell: (measure: number) => DOMRect | BoxRect | null;
  private beatDuration: number;
  private rng: Rng;
  private getViewW: () => number;
  private getViewH: () => number;
  private onDolphinKnockdown?: () => void;
  private onDudeDive?: () => void;

  private climbers: Climber[] = [];
  private dolphins: Dolphin[] = [];
  private lobsters: Lobster[] = [];
  private orbs: Orb[] = [];
  private effects: Effect[] = [];
  private nextId = 0;

  private pendingByMeasure = new Map<number, PendingQuarter[]>();
  private lastActiveMeasure = -1;

  private intensity = 0;
  private offFinale?: () => void;
  private offIntensity?: () => void;

  // Counters (queryable).
  private _dolphinKnockdowns = 0;
  private _dudeDives = 0;

  private patCheck = 0; // throttles the occasional buddy butt-pat check

  // Finale state.
  private finale = false;
  private finaleClock = 0; // accumulates dt; dives one man per beat
  private finaleQueue: Climber[] = []; // men at top, lined up to dive

  /** Climbers already spat at during the CURRENT dolphin wave (reset each wave),
   *  so no man is targeted more than once per wave. */
  private waveHits = new Set<number>();

  constructor(cfg: CliffDiveCrowdConfig) {
    this.juice = cfg.juice;
    this.resolveCell = cfg.resolveCell;
    this.beatDuration = cfg.beatDuration;
    this.rng = cfg.rng ?? Math.random;
    this.getViewW = cfg.viewW ?? (() => (typeof window !== "undefined" ? window.innerWidth : 1280));
    this.getViewH = cfg.viewH ?? (() => (typeof window !== "undefined" ? window.innerHeight : 720));
    this.onDolphinKnockdown = cfg.onDolphinKnockdown;
    this.onDudeDive = cfg.onDudeDive;

    if (cfg.hudParent && typeof document !== "undefined") {
      const c = document.createElement("div");
      c.className = "cliff-crowd";
      c.style.cssText =
        "position:absolute;inset:0;pointer-events:none;z-index:6;overflow:hidden;";
      cfg.hudParent.appendChild(c);
      this.container = c;
    }
  }

  mount(): void {
    this.offFinale = this.juice?.on("eddieFinale", () => this.startFinale());
    this.offIntensity = this.juice?.on("eddieIntensity", (e) => this.setIntensity(e.value));
  }

  // --- helpers ---------------------------------------------------------------

  private waterY(): number {
    return this.getViewH() * WATER_FRACTION;
  }

  /** Normalize a resolveCell result into a BoxRect; null if unavailable. */
  private box(measure: number): BoxRect | null {
    const r = this.resolveCell(measure);
    if (!r) return null;
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  }

  /** Fallback box when layout is unavailable (headless without a stub). */
  private fallbackBox(measure: number): BoxRect {
    const W = this.getViewW();
    const cw = W / 4;
    const col = ((measure % 4) + 4) % 4;
    const left = col * cw + 10;
    return { left, right: left + cw - 20, top: 60, bottom: 220 };
  }

  private boxOrFallback(measure: number): BoxRect {
    return this.box(measure) ?? this.fallbackBox(measure);
  }

  private tierForQuality(q: number): ClimberTier {
    if (q >= 0.8) return "strong";
    if (q >= 0.45) return "medium";
    return "weak";
  }

  // --- spawn seam ------------------------------------------------------------

  /** Grid callback: buffer a scored quarter; released when its measure elapses. */
  onQuarterDiamonds(info: PendingQuarter): void {
    let list = this.pendingByMeasure.get(info.measure);
    if (!list) this.pendingByMeasure.set(info.measure, (list = []));
    list.push(info);
  }

  /** Active measure advanced: flush every fully-elapsed measure's spawn map. The
   *  last measure waits for the finale (flushAll). */
  setActiveMeasure(measure: number): void {
    this.lastActiveMeasure = measure;
    if (measure < 0) return;
    for (const m of [...this.pendingByMeasure.keys()].sort((a, b) => a - b)) {
      if (m < measure) this.flushMeasure(m);
    }
  }

  private flushAll(): void {
    for (const m of [...this.pendingByMeasure.keys()].sort((a, b) => a - b)) {
      this.flushMeasure(m);
    }
  }

  private flushMeasure(measure: number): void {
    const quarters = this.pendingByMeasure.get(measure);
    this.pendingByMeasure.delete(measure);
    if (!quarters) return;
    for (const q of quarters) this.spawnQuarter(q);
  }

  /** Run the Cliff Dive spawn map for one scored quarter. */
  private spawnQuarter(q: PendingQuarter): void {
    const box = this.boxOrFallback(q.measure);
    const quarterW = (box.right - box.left) / 4;
    const quarterLeft = box.left + q.beat * quarterW;
    const midX = quarterLeft + quarterW / 2;
    const barY = box.bottom; // dead-hang on the note lane near the box bottom
    const subdiv = q.subdiv;

    if (subdiv === 1) {
      // 2 MEN: both dead-hang on the NOTE lane, then shimmy out to the box's
      // LEFT and RIGHT edges (the visible "hang then split to the sides").
      const tier = this.tierForQuality(q.notes[0]?.quality ?? 0);
      this.spawnClimber(q.measure, box, "left", tier, midX, barY);
      this.spawnClimber(q.measure, box, "right", tier, midX, barY);
    } else if (subdiv === 2) {
      // 1 MAN: dead-hangs on the note lane, then shimmies to the NEARER box edge
      // and climbs the side (men climb the box EDGES, never the note bars inside).
      const tier = this.tierForQuality(q.notes[0]?.quality ?? 0);
      const edge: "left" | "right" = midX <= (box.left + box.right) / 2 ? "left" : "right";
      this.spawnClimber(q.measure, box, edge, tier, midX, barY);
    } else if (subdiv === 3) {
      // 3 healing ORBS, one per diamond.
      for (let i = 0; i < 3; i++) {
        const ox = quarterLeft + ((i + 0.5) / 3) * quarterW;
        this.spawnOrb(ox, box.top + (box.bottom - box.top) * 0.5);
      }
    } else {
      // subdiv 4: 4 LOBSTERS, fanning bottom-left -> bottom-right.
      for (let i = 0; i < 4; i++) {
        const angle = Math.PI - (i / 3) * Math.PI; // i=0 -> left, i=3 -> right
        this.spawnLobster(midX, angle);
      }
    }
  }

  private spawnClimber(
    measure: number,
    box: BoxRect,
    edge: ClimberEdge,
    tier: ClimberTier,
    hangX: number,
    hangY: number,
  ): void {
    void measure;
    const c = new Climber({
      id: this.nextId++,
      hangX,
      hangY,
      box,
      edge,
      tier,
      waterY: this.waterY(),
      viewW: this.getViewW(),
    });
    if (this.container && c.el) this.container.appendChild(c.el);
    this.climbers.push(c);
  }

  private spawnOrb(x: number, y: number): void {
    const o = new Orb({ id: this.nextId++, startX: x, startY: y });
    if (this.container && o.el) this.container.appendChild(o.el);
    this.orbs.push(o);
  }

  private spawnLobster(x: number, angle: number): void {
    const l = new Lobster({
      id: this.nextId++,
      startX: x,
      angle,
      waterY: this.waterY(),
      viewW: this.getViewW(),
    });
    if (this.container && l.el) this.container.appendChild(l.el);
    this.lobsters.push(l);
  }

  // --- dolphin waves ---------------------------------------------------------

  /** Schedule a wave of up to 4 dolphins for `measure`. Each dolphin menaces ONE
   *  measure box in the rolling 4-window (its assigned edge is the box edge it
   *  passes under; as it passes it can spit at a man on EITHER edge of that box —
   *  see resolveDolphinSpits). Called once per measure boundary. */
  measureWave(measure: number): void {
    if (this.finale) return;
    this.waveHits.clear(); // a fresh wave: every man is targetable again
    const base = this.waterY();
    const dur = 2.6 * this.beatDuration; // a snappy breach, not a screen crossing
    const span = 130; // horizontal width of the leap arc, centred on the edge
    // One dolphin BREACHES beside each box edge in the rolling 4-measure window,
    // leaping up to the foot of that edge to spit (up to DOLPHINS_PER_WAVE).
    const windowStart = Math.max(0, measure - (measure % 4));
    for (let i = 0; i < DOLPHINS_PER_WAVE; i++) {
      const targetMeasure = windowStart + i;
      const box = this.box(targetMeasure) ?? this.fallbackBox(targetMeasure);
      const edge: "left" | "right" = this.rng() < 0.5 ? "left" : "right";
      const edgeX = edge === "left" ? box.left : box.right;
      const dir = this.rng() < 0.5 ? 1 : -1; // leap rightward or leftward
      const d = new Dolphin({
        id: this.nextId++,
        targetMeasure,
        targetEdge: edge,
        edgeX,
        startX: edgeX - (dir * span) / 2,
        endX: edgeX + (dir * span) / 2,
        baseY: base,
        peakY: box.bottom, // rise up to the foot of the climb
        duration: dur,
      });
      d.setMermaid(this.intensity >= 0.6);
      if (this.container && d.el) this.container.appendChild(d.el);
      this.dolphins.push(d);
    }
  }

  // --- intensity / mermaid swap ---------------------------------------------

  setIntensity(v: number): void {
    this.intensity = Math.max(0, Math.min(1, v));
    const merm = this.intensity >= 0.6;
    for (const d of this.dolphins) if (!d.hasSpat) d.setMermaid(merm);
  }

  // --- finale ----------------------------------------------------------------

  private startFinale(): void {
    if (this.finale) return;
    this.finale = true;
    this.flushAll();
  }

  /** Beat tick from CliffDiveState; during the finale, one man per line dives. */
  beat(): void {
    if (!this.finale) return;
    // Refresh the dive queue with men currently at the top.
    this.finaleQueue = this.climbers.filter((c) => c.atTop);
    const diver = this.finaleQueue.shift();
    if (diver) this.diveOff(diver);
  }

  private diveOff(c: Climber): void {
    // The man swan-dives: push him off the top into the water + screen shake +
    // gold surfacing. Climber handles the graceful fall via takeDolphinHit-style
    // transition; here we force the falling phase and gold it.
    c.makeGold();
    // Force a graceful swan dive. A man at the top is "safe", so takeDolphinHit
    // is a no-op there — dive() bypasses that guard (the diver leaps by choice).
    c.dive();
    this._dudeDives++;
    this.onDudeDive?.();
    this.juice?.emit("eddieShake", {
      magnitude: 1.2,
      audioTime: 0,
    });
    // The splash fires when he actually HITS the water (see update), not here.
  }

  // --- per-frame update + interactions --------------------------------------

  /** Advance the whole sim by `dt` seconds. The optional second arg is ignored
   *  (the crowd uses its configured beatDuration); it exists only so tests can
   *  call update(dt, beat) uniformly across the crowd and its entities. */
  update(dt: number, _beatDuration?: number): void {
    void _beatDuration;
    // Finale: the bass plays on and ONE man dives per beat. Driven from here (the
    // render loop), NOT the conductor — which has stopped firing beats by the time
    // the finale starts — so every man at the top eventually swan-dives off.
    if (this.finale) {
      this.finaleClock += dt;
      if (this.finaleClock >= this.beatDuration) {
        this.finaleClock -= this.beatDuration;
        this.beat();
      }
    }
    // Snapshot who is already swimming, so we can splash men who hit the water
    // THIS frame (a slip-off OR a finale dive) — when they actually land.
    const wasInWater = new Set<number>();
    for (const c of this.climbers) if (c.inWater) wasInWater.add(c.id);

    for (const c of this.climbers) c.update(dt, this.beatDuration);

    for (const c of this.climbers) {
      if (c.inWater && !wasInWater.has(c.id)) this.spawnSplash(c.x, c.isGold);
    }

    // Occasional buddy butt-pat between two top men who stroll close (cosmetic,
    // uses Math.random so it never perturbs the seeded gameplay rng).
    this.patCheck -= dt;
    if (this.patCheck <= 0) {
      this.patCheck = 0.4;
      const tops = this.climbers.filter((c) => c.atTop && !c.isPatting);
      pairs: for (let i = 0; i < tops.length; i++) {
        for (let j = i + 1; j < tops.length; j++) {
          if (Math.abs(tops[i].x - tops[j].x) <= 24 && Math.random() < 0.35) {
            tops[i].pat();
            tops[j].pat();
            break pairs;
          }
        }
      }
    }

    for (const d of this.dolphins) d.update(dt);
    for (const l of this.lobsters) l.update(dt);
    for (const o of this.orbs) o.update(dt);

    this.resolveLobsterDolphin();
    this.resolveDolphinSpits();
    this.resolveOrbHeals();

    // Reap dead entities.
    this.reapDolphins();
    this.lobsters = this.lobsters.filter((l) => {
      if (!l.alive) { l.dispose(); return false; }
      return true;
    });
    this.orbs = this.orbs.filter((o) => {
      if (o.consumed) { o.dispose(); return false; }
      return true;
    });
    for (let i = this.effects.length - 1; i >= 0; i--) {
      if (this.effects[i].update(dt)) this.effects.splice(i, 1);
    }
  }

  /** Live lobsters intercept dolphins → cancel them (before they spit). A lobster
   *  cancels a dolphin if it is near the dolphin itself OR is guarding the edge
   *  the dolphin is diving for (within LOBSTER_RADIUS of edgeX along the
   *  waterline). The edge-guard check is what lets a wall of lobsters shut down a
   *  wave: dolphins spit high over the edge, so positional overlap alone would
   *  miss them — but a lobster posted under that edge picks them off on approach. */
  private resolveLobsterDolphin(): void {
    for (const d of this.dolphins) {
      if (!d.alive || d.cancelled || d.hasSpat) continue;
      for (const l of this.lobsters) {
        if (!l.alive) continue;
        const nearDolphin = Math.hypot(l.x - d.x, l.y - d.y) <= LOBSTER_RADIUS;
        const guardsEdge = Math.abs(l.x - d.edgeX) <= LOBSTER_RADIUS;
        if (nearDolphin || guardsEdge) {
          d.cancel();
          break;
        }
      }
    }
  }

  /** Each dolphin spits ONCE as it passes its target box, hitting one random
   *  climber on the box's LEFT edge and one on the RIGHT edge (a "mid" climber is
   *  assigned to its nearer edge). No climber is hit more than once per wave. */
  private resolveDolphinSpits(): void {
    for (const d of this.dolphins) {
      if (!d.readyToSpit) continue;
      d.markSpat();
      this.spitAtEdge(d.targetMeasure, "left");
      this.spitAtEdge(d.targetMeasure, "right");
    }
  }

  /** Pick one un-hit climbing man on `measure`'s `edge` and hit him. */
  private spitAtEdge(measure: number, edge: "left" | "right"): void {
    const victims = this.climbers.filter(
      (c) => c.climbing && !this.waveHits.has(c.id) && this.climberOnEdge(c, measure, edge),
    );
    if (victims.length === 0) return;
    // Go for the man closest to escaping (highest), breaking ties with the rng so
    // selection stays deterministic under a seeded generator.
    let victim = victims[0];
    for (const v of victims) {
      if (v.heightFrac > victim.heightFrac) victim = v;
    }
    this.waveHits.add(victim.id);
    const wasClimbing = victim.climbing;
    victim.takeDolphinHit();
    // A knockdown is scored the moment a dolphin hit sends a climbing man off the
    // cliff (he drops to 0hp and starts falling toward the water).
    if (wasClimbing && (victim.phase === "falling" || victim.inWater)) {
      this._dolphinKnockdowns++;
      this.onDolphinKnockdown?.();
      // Splash fires when he hits the water (see update), not here at the hit.
    }
  }

  /** Is this climber a valid spit target for `measure`'s `edge`? L/R-edge men
   *  match their own edge; a "mid" man (eighths) hangs at the box centre and is
   *  assigned to its NEARER edge so exactly one edge-spit can claim him. Match by
   *  X proximity to the live box rect (boxes can roll). */
  private climberOnEdge(c: Climber, measure: number, edge: "left" | "right"): boolean {
    const box = this.box(measure) ?? this.fallbackBox(measure);
    if (c.x < box.left - 40 || c.x > box.right + 40) return false;
    if (c.edge === "mid") {
      const mid = (box.left + box.right) / 2;
      const nearer: "left" | "right" = c.x <= mid ? "left" : "right";
      return nearer === edge;
    }
    return c.edge === edge;
  }

  private spawnSplash(x: number, gold = false): void {
    if (this.container) this.effects.push(new Splash(this.container, x, this.waterY(), 1, gold));
  }

  /** Orb heal policy. Prefer distinct needy men; the 3rd orb slow-seeks a still-
   *  needy man if one exists; with no needy man orbs pulse; only one heal is
   *  applied per needy slot even if more orbs are present. */
  private resolveOrbHeals(): void {
    const needy = this.climbers.filter((c) => c.needsHealth);
    const seeking = this.orbs.filter((o) => o.phase !== "consumed");

    // Assignment: distinct needy men first, then spares slow-seek remaining need.
    const assignedTargets = new Set<number>();
    // Re-validate existing assignments.
    for (const o of seeking) {
      if (o.targetId !== null) {
        const t = this.climbers.find((c) => c.id === o.targetId);
        if (!t || !t.needsHealth || assignedTargets.has(t.id)) {
          o.unassign();
        } else {
          assignedTargets.add(t.id);
        }
      }
    }
    // Assign unassigned orbs to unclaimed needy men.
    for (const o of seeking) {
      if (o.targetId !== null) continue;
      const target = needy.find((c) => !assignedTargets.has(c.id));
      if (target) {
        // slow-seek if this would be a "spare" beyond the distinct-needy set
        const slow = assignedTargets.size >= needy.length;
        o.assign(target.id, slow);
        assignedTargets.add(target.id);
      }
    }
    // Feed live target positions + apply arrivals.
    for (const o of seeking) {
      if (o.targetId === null) continue;
      const t = this.climbers.find((c) => c.id === o.targetId);
      if (!t || !t.needsHealth) {
        o.unassign();
        continue;
      }
      o.aimAt(t.x, this.climberRenderY(t));
      if (o.arrived()) {
        t.heal();
        o.consume();
        assignedTargets.delete(t.id);
      }
    }
  }

  /** A vertical target for an orb seeking this man. The man's X is exact; this Y
   *  just needs to be close enough that the orb converges. Use mid-screen. */
  private climberRenderY(_c: Climber): number {
    return this.waterY() * 0.5;
  }

  private reapDolphins(): void {
    this.dolphins = this.dolphins.filter((d) => {
      if (!d.alive) { d.dispose(); return false; }
      return true;
    });
  }

  // --- queryable state (tests) ----------------------------------------------

  get menClimbing(): number {
    return this.climbers.filter((c) => c.climbing).length;
  }
  get menAtTop(): number {
    return this.climbers.filter((c) => c.atTop).length;
  }
  get menInWater(): number {
    return this.climbers.filter((c) => c.inWater).length;
  }
  get totalMen(): number {
    return this.climbers.length;
  }
  get lobsterCount(): number {
    return this.lobsters.filter((l) => l.alive).length;
  }
  get orbCount(): number {
    return this.orbs.filter((o) => o.phase !== "consumed").length;
  }
  get dolphinWaveActive(): boolean {
    return this.dolphins.some((d) => d.alive);
  }
  get dolphinKnockdowns(): number {
    return this._dolphinKnockdowns;
  }
  get dudeDives(): number {
    return this._dudeDives;
  }
  /** True once the finale has cleared the cliff: it has started AND no man is
   *  still climbing or idling at the top (everyone dived or is in the water). */
  get finaleResolved(): boolean {
    return this.finale && this.menClimbing === 0 && this.menAtTop === 0;
  }
  /** The most recent active measure handed to setActiveMeasure (tests/debug). */
  get activeMeasure(): number {
    return this.lastActiveMeasure;
  }
  /** Read-only snapshots for assertions. */
  get dolphinStates(): Array<{
    targetEdge: "left" | "right";
    targetMeasure: number;
    hasSpat: boolean;
    cancelled: boolean;
    alive: boolean;
  }> {
    return this.dolphins.map((d) => ({
      targetEdge: d.targetEdge,
      targetMeasure: d.targetMeasure,
      hasSpat: d.hasSpat,
      cancelled: d.cancelled,
      alive: d.alive,
    }));
  }
  get climberStates(): Array<{
    id: number;
    hp: number;
    maxHp: number;
    edge: ClimberEdge;
    phase: string;
    heightFrac: number;
  }> {
    return this.climbers.map((c) => ({
      id: c.id,
      hp: c.hp,
      maxHp: c.maxHp,
      edge: c.edge,
      phase: c.phase,
      heightFrac: c.heightFrac,
    }));
  }

  dispose(): void {
    this.offFinale?.();
    this.offIntensity?.();
    this.pendingByMeasure.clear();
    for (const c of this.climbers) c.dispose();
    for (const d of this.dolphins) d.dispose();
    for (const l of this.lobsters) l.dispose();
    for (const o of this.orbs) o.dispose();
    for (const fx of this.effects) fx.dispose();
    this.climbers = [];
    this.dolphins = [];
    this.lobsters = [];
    this.orbs = [];
    this.effects = [];
    this.container?.remove();
    this.container = null;
  }
}
