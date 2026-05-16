import * as THREE from "three";
import type { Enemy } from "./Enemy";

const TRACER_LIFETIME = 0.18;
const TRACER_BASE_DAMAGE = 1.0;

interface Tracer {
  line: THREE.Line;
  expireAt: number;
}

export class BulletSystem {
  private tracers: Tracer[] = [];
  private readonly scene: THREE.Scene;
  private readonly originGetter: () => THREE.Vector3;

  constructor(scene: THREE.Scene, originGetter: () => THREE.Vector3) {
    this.scene = scene;
    this.originGetter = originGetter;
  }

  fire(targets: Enemy[], confidence: number, audioTime: number): number {
    if (targets.length === 0) return 0;
    const damage = TRACER_BASE_DAMAGE * (0.25 + 0.75 * confidence);
    const origin = this.originGetter();
    let totalApplied = 0;
    for (const e of targets) {
      totalApplied += e.takeDamage(damage, audioTime);
      this.spawnTracer(origin, e.object.position, confidence, audioTime);
    }
    return totalApplied;
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
      const lifeLeft = (t.expireAt - audioTime) / TRACER_LIFETIME;
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
  ) {
    const geom = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const color = new THREE.Color().setHSL(0.85 - 0.15 * confidence, 1, 0.65);
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 1,
    });
    const line = new THREE.Line(geom, mat);
    this.scene.add(line);
    this.tracers.push({ line, expireAt: audioTime + TRACER_LIFETIME });
  }
}
