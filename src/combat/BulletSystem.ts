import * as THREE from "three";
import type { PitchClass } from "../music/keys";
import type { Enemy } from "./Enemy";

const TRACER_LIFETIME = 0.18;
const ROOT_TRACER_LIFETIME = 0.26;
const TRACER_BASE_DAMAGE = 1.0;
// Hitting an enemy with its own root note (e.g. C on a C-major enemy) lands
// significantly more damage than other in-key notes. Pairs with early-enemy
// hp ≈ 2.5 so a fresh enemy is killed by root + any in-key (≈3.5), takes
// two non-root notes to chip (≈2.0 — not a kill), and a single full-confidence
// root one-shots (=2.5). Tweak this knob first if difficulty feels off.
const ROOT_DAMAGE_MULTIPLIER = 2.5;

interface Tracer {
  line: THREE.Line;
  expireAt: number;
  lifetime: number;
}

export class BulletSystem {
  private tracers: Tracer[] = [];
  private readonly scene: THREE.Scene;
  private readonly originGetter: () => THREE.Vector3;

  constructor(scene: THREE.Scene, originGetter: () => THREE.Vector3) {
    this.scene = scene;
    this.originGetter = originGetter;
  }

  /** Returns { applied, rootHit } so the caller can branch on whether ANY
   *  target was hit with its root note (used for hit-thud pitch + popup tint). */
  fire(
    targets: Enemy[],
    pitchClass: PitchClass,
    confidence: number,
    audioTime: number,
  ): { applied: number; rootHit: boolean } {
    if (targets.length === 0) return { applied: 0, rootHit: false };
    const base = TRACER_BASE_DAMAGE * (0.25 + 0.75 * confidence);
    const origin = this.originGetter();
    let totalApplied = 0;
    let rootHit = false;
    for (const e of targets) {
      const isRoot = e.pitchClass === pitchClass;
      if (isRoot) rootHit = true;
      const dmg = isRoot ? base * ROOT_DAMAGE_MULTIPLIER : base;
      totalApplied += e.takeDamage(dmg, audioTime);
      this.spawnTracer(origin, e.object.position, confidence, audioTime, isRoot);
    }
    return { applied: totalApplied, rootHit };
  }

  update(audioTime: number) {
    const remaining: Tracer[] = [];
    for (const t of this.tracers) {
      if (audioTime >= t.expireAt) {
        this.scene.remove(t.line);
        (t.line.material as THREE.LineBasicMaterial).dispose();
        t.line.geometry.dispose();
        continue;
      }
      const lifeLeft = (t.expireAt - audioTime) / t.lifetime;
      (t.line.material as THREE.LineBasicMaterial).opacity = lifeLeft;
      remaining.push(t);
    }
    this.tracers = remaining;
  }

  reset() {
    for (const t of this.tracers) {
      this.scene.remove(t.line);
      (t.line.material as THREE.LineBasicMaterial).dispose();
      t.line.geometry.dispose();
    }
    this.tracers = [];
  }

  private spawnTracer(
    from: THREE.Vector3,
    to: THREE.Vector3,
    confidence: number,
    audioTime: number,
    isRoot: boolean,
  ) {
    if (isRoot) {
      // Root-note hits get a fatter, warmer, longer-lived beam. Two parallel
      // offset segments fake thickness without pulling in Line2/LineMaterial.
      // Offset is perpendicular to the beam direction in the horizontal plane.
      const dir = new THREE.Vector3().subVectors(to, from);
      const perp = new THREE.Vector3(-dir.z, 0, dir.x).normalize().multiplyScalar(0.06);
      const color = new THREE.Color().setHSL(0.15, 1, 0.7); // warm yellow/white
      for (const sign of [-1, 1]) {
        const off = perp.clone().multiplyScalar(sign);
        const geom = new THREE.BufferGeometry().setFromPoints([
          from.clone().add(off),
          to.clone().add(off),
        ]);
        const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 });
        const line = new THREE.Line(geom, mat);
        this.scene.add(line);
        this.tracers.push({
          line,
          expireAt: audioTime + ROOT_TRACER_LIFETIME,
          lifetime: ROOT_TRACER_LIFETIME,
        });
      }
      return;
    }
    const geom = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const color = new THREE.Color().setHSL(0.85 - 0.15 * confidence, 1, 0.65);
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 1,
    });
    const line = new THREE.Line(geom, mat);
    this.scene.add(line);
    this.tracers.push({
      line,
      expireAt: audioTime + TRACER_LIFETIME,
      lifetime: TRACER_LIFETIME,
    });
  }
}
