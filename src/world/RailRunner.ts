import * as THREE from "three";

export interface RailRunnerOptions {
  curve: THREE.CatmullRomCurve3;
  speed: number;
  lookAhead?: number;
}

export class RailRunner {
  private curve: THREE.CatmullRomCurve3;
  private speed: number;
  private lookAhead: number;
  private t = 0;
  private curveLength: number;
  private running = false;

  constructor(opts: RailRunnerOptions) {
    this.curve = opts.curve;
    this.speed = opts.speed;
    this.lookAhead = opts.lookAhead ?? 0.02;
    this.curveLength = this.curve.getLength();
  }

  setRunning(running: boolean) {
    this.running = running;
  }

  update(dt: number) {
    if (!this.running) return;
    const advance = (this.speed * dt) / this.curveLength;
    this.t = Math.min(1, this.t + advance);
  }

  get position(): THREE.Vector3 {
    return this.curve.getPointAt(this.t);
  }

  get lookAtPoint(): THREE.Vector3 {
    const t2 = Math.min(1, this.t + this.lookAhead);
    return this.curve.getPointAt(t2);
  }

  /** Unit forward vector along the rail at the current position. */
  get forward(): THREE.Vector3 {
    return this.lookAtPoint.clone().sub(this.position).normalize();
  }

  get progress(): number {
    return this.t;
  }

  get done(): boolean {
    return this.t >= 1;
  }
}
