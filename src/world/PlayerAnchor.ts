import * as THREE from "three";

export class PlayerAnchor extends THREE.Object3D {
  readonly guitarMount: THREE.Object3D;

  constructor() {
    super();
    this.guitarMount = new THREE.Object3D();
    this.guitarMount.position.set(0, -0.4, -0.6);
    this.add(this.guitarMount);
  }
}
