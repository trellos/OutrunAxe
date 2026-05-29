import * as THREE from "three";
import type { Conductor } from "../audio/Conductor";
import type { LevelConfig } from "../levels/level1";
import type { PitchClass } from "../music/keys";
import { Enemy } from "./Enemy";

const SPAWN_DISTANCE_AHEAD = 36;

export class EnemyDirector {
  private active: Enemy[] = [];
  private spawned = new Set<number>();
  private readonly scene: THREE.Scene;
  private readonly conductor: Conductor;
  private readonly level: LevelConfig;
  private readonly getRailHead: () => { pos: THREE.Vector3; forward: THREE.Vector3 };

  constructor(
    scene: THREE.Scene,
    conductor: Conductor,
    level: LevelConfig,
    getRailHead: () => { pos: THREE.Vector3; forward: THREE.Vector3 },
  ) {
    this.scene = scene;
    this.conductor = conductor;
    this.level = level;
    this.getRailHead = getRailHead;
  }

  update(audioTime: number): Enemy[] {
    this.maybeSpawn(audioTime);
    const reached: Enemy[] = [];
    // Show enemies during the count-in (and preroll) too — the player should
    // SEE the first wave coming, just far away. The eased approach curve in
    // Enemy.update keeps them distant until the music is well underway, so
    // visibility no longer needs to gate the "rushed" feeling.
    const phase = this.conductor.currentPhase;
    const visible = phase === "playing" || phase === "countIn" || phase === "preroll";
    for (const e of this.active) {
      e.object.visible = visible;
      e.update(audioTime);
    }

    const remaining: Enemy[] = [];
    for (const e of this.active) {
      if (!e.alive) {
        // Defer disposal until the slow expand-fade death animation completes
        // (see Enemy.DEATH_DURATION). The enemy is gone from `enemiesAlive()`
        // immediately so new shots can't target it, but the mesh stays in
        // scene so the player sees it die.
        if (e.deathDoneAt > 0 && audioTime >= e.deathDoneAt) {
          this.scene.remove(e.object);
          e.dispose();
          continue;
        }
        remaining.push(e);
        continue;
      }
      if (e.hasReachedPlayer(audioTime)) {
        reached.push(e);
        this.scene.remove(e.object);
        e.dispose();
        continue;
      }
      remaining.push(e);
    }
    this.active = remaining;
    return reached;
  }

  /** Every alive enemy whose key contains pitch class `pc` — i.e. every
   *  enemy that a played note of that pitch class scores a hit against. */
  enemiesVulnerableTo(pc: PitchClass): Enemy[] {
    return this.active.filter((e) => e.alive && e.isVulnerableTo(pc));
  }

  enemiesAlive(): Enemy[] {
    return this.active.filter((e) => e.alive);
  }

  get aliveCount(): number {
    // Dying enemies linger in `active` until their death animation completes
    // so the visual fade can play — they're already removed from gameplay
    // (no new hits, no contact). Count only the still-alive ones for HUD.
    let n = 0;
    for (const e of this.active) if (e.alive) n++;
    return n;
  }

  get totalSpawned(): number {
    return this.spawned.size;
  }

  get totalScripted(): number {
    return this.level.spawns.length;
  }

  reset() {
    for (const e of this.active) {
      this.scene.remove(e.object);
      e.dispose();
    }
    this.active = [];
    this.spawned.clear();
  }

  private maybeSpawn(audioTime: number) {
    const phase = this.conductor.currentPhase;
    // Spawn during count-in so the first wave reaches the player ON beat 1
    // of play. Visibility is gated in update() below so the player doesn't
    // see enemies during the count-in.
    if (phase !== "countIn" && phase !== "playing") return;
    const playStart = this.conductor.measureStartTime(0);
    if (!isFinite(playStart)) return;
    const beatDur = 60 / this.conductor.currentBpm;

    for (let i = 0; i < this.level.spawns.length; i++) {
      if (this.spawned.has(i)) continue;
      const spawn = this.level.spawns[i];
      const scheduledSpawnTime =
        playStart + spawn.beat * beatDur - spawn.travelBeats * beatDur;
      if (audioTime < scheduledSpawnTime) continue;

      const arriveAt = playStart + spawn.beat * beatDur;
      // If we already missed the arrival window (e.g. first frame fired after
      // a page hitch), skip — don't dump a stale enemy into the player.
      if (audioTime >= arriveAt) {
        this.spawned.add(i);
        continue;
      }

      const head = this.getRailHead();
      const spawnPos = head.pos
        .clone()
        .add(head.forward.clone().multiplyScalar(SPAWN_DISTANCE_AHEAD))
        .add(new THREE.Vector3(spawn.lane, 0, 0));
      const targetPos = head.pos.clone();

      const enemy = new Enemy({
        pitchClass: spawn.pitchClass,
        keyRoot: spawn.keyRoot,
        keyMode: spawn.keyMode,
        hp: spawn.hp,
        spawnPosition: spawnPos,
        targetPosition: targetPos,
        // Use the scheduled spawn time, not "now" — preserves the intended
        // travel duration so a late-firing spawn doesn't shrink the window.
        spawnedAt: scheduledSpawnTime,
        arriveAt,
      });
      this.scene.add(enemy.object);
      this.active.push(enemy);
      this.spawned.add(i);
    }
  }
}
