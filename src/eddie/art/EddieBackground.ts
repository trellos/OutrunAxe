// EddieBackground — the beat-pulsing, shaking 80s background (GDD §8).
//
// Lives in the Three.js worldScene. Subscribes to the juice bus: eddieBeatPulse
// brightens/pumps the scene on the beat (Art interpolates the decay), eddieShake
// jolts the camera (bigger magnitude => bigger jolt). update(dt, audioTime)
// drives the synthwave sun shimmer + grid scroll off rAF dt, never deciding
// scoring.
//
// VARIANT option-1: "synthwave sunset + receding neon floor grid" — a classic
// magenta->cyan vertical gradient sky, a banded amber/orange sun on the horizon,
// and a perspective wireframe floor grid scrolling toward the camera. The whole
// scene pumps brightness on the downbeat and shakes on scoring.

import * as THREE from "three";
import type { EventBus } from "../../engine/EventBus";
import type { EddieJuiceEvents } from "../../music/eddie/eddieTypes";

const SKY_W = 600;
const SKY_H = 340;
const GRID_HALF = 120;
const GRID_LINES = 28;

export class EddieBackground {
  private scene: THREE.Scene | null = null;
  private group = new THREE.Group();
  private prevBackground: THREE.Scene["background"] = null;
  private prevFog: THREE.Scene["fog"] = null;

  private sky!: THREE.Mesh;
  private skyMat!: THREE.MeshBasicMaterial;
  private skyTex!: THREE.CanvasTexture;
  private sun!: THREE.Mesh;
  private sunMat!: THREE.MeshBasicMaterial;
  private grid!: THREE.LineSegments;
  private gridMat!: THREE.LineBasicMaterial;

  private camera: THREE.PerspectiveCamera | null = null;
  private camBaseY = 0;
  private camBaseZ = 0;

  private offBeat?: () => void;
  private offShake?: () => void;

  private pulse = 0; // 0..1 decaying brightness pump
  private shake = 0; // current shake magnitude, decays
  private scroll = 0; // grid scroll phase
  private t = 0;

  mount(ctx: { scene: THREE.Scene; camera?: THREE.PerspectiveCamera; juice: EventBus<EddieJuiceEvents> }): void {
    this.scene = ctx.scene;
    this.prevBackground = ctx.scene.background;
    this.prevFog = ctx.scene.fog;
    ctx.scene.background = new THREE.Color(0x0a0612);
    ctx.scene.fog = null;

    // --- Sky: vertical magenta->cyan gradient with sunset bands, on a canvas.
    const cv = document.createElement("canvas");
    cv.width = 16;
    cv.height = 256;
    const c2d = cv.getContext("2d")!;
    const grad = c2d.createLinearGradient(0, 0, 0, cv.height);
    grad.addColorStop(0.0, "#1a0030");
    grad.addColorStop(0.35, "#5a1170");
    grad.addColorStop(0.6, "#ff2bd6");
    grad.addColorStop(0.78, "#ff7a2b");
    grad.addColorStop(0.92, "#ffd02b");
    grad.addColorStop(1.0, "#00f0ff");
    c2d.fillStyle = grad;
    c2d.fillRect(0, 0, cv.width, cv.height);
    this.skyTex = new THREE.CanvasTexture(cv);
    this.skyTex.colorSpace = THREE.SRGBColorSpace;
    this.skyMat = new THREE.MeshBasicMaterial({
      map: this.skyTex,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.PlaneGeometry(SKY_W, SKY_H), this.skyMat);
    this.sky.position.set(0, 40, -180);
    this.sky.renderOrder = -10;
    this.group.add(this.sky);

    // --- Sun: a banded disc (horizontal slats cut out give the retro look).
    const sunCv = document.createElement("canvas");
    sunCv.width = 256;
    sunCv.height = 256;
    const s2d = sunCv.getContext("2d")!;
    const sg = s2d.createLinearGradient(0, 0, 0, 256);
    sg.addColorStop(0, "#fff2a8");
    sg.addColorStop(0.5, "#ffd02b");
    sg.addColorStop(1, "#ff2bd6");
    s2d.fillStyle = sg;
    s2d.beginPath();
    s2d.arc(128, 128, 120, 0, Math.PI * 2);
    s2d.fill();
    // Cut horizontal slats in the lower half for the venetian-blind sun.
    s2d.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 7; i++) {
      const y = 140 + i * 16;
      s2d.fillRect(0, y, 256, 6 + i);
    }
    s2d.globalCompositeOperation = "source-over";
    const sunTex = new THREE.CanvasTexture(sunCv);
    sunTex.colorSpace = THREE.SRGBColorSpace;
    this.sunMat = new THREE.MeshBasicMaterial({
      map: sunTex,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.sun = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), this.sunMat);
    this.sun.position.set(0, 30, -170);
    this.sun.renderOrder = -9;
    this.group.add(this.sun);

    // --- Floor grid: a perspective wireframe receding to the horizon.
    this.grid = new THREE.LineSegments(this.buildGridGeometry(0), undefined);
    this.gridMat = new THREE.LineBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.7,
      fog: false,
    });
    this.grid.material = this.gridMat;
    this.grid.position.set(0, -14, 0);
    this.grid.rotation.x = -Math.PI / 2;
    this.grid.renderOrder = -8;
    this.group.add(this.grid);

    ctx.scene.add(this.group);

    // Camera parking: a calm wide shot looking at the horizon. Shake jolts it.
    if (ctx.camera) {
      this.camera = ctx.camera;
      this.camBaseY = 6;
      this.camBaseZ = 60;
      this.camera.position.set(0, this.camBaseY, this.camBaseZ);
      this.camera.lookAt(0, 18, -160);
    }

    this.offBeat = ctx.juice.on("eddieBeatPulse", (e) => {
      this.pulse = e.downbeat ? 1 : 0.55;
    });
    this.offShake = ctx.juice.on("eddieShake", (e) => {
      this.shake = Math.max(this.shake, e.magnitude);
    });
  }

  private buildGridGeometry(scroll: number): THREE.BufferGeometry {
    const pts: number[] = [];
    const step = (GRID_HALF * 2) / GRID_LINES;
    // Lines parallel to camera (vary z), scrolling toward viewer.
    for (let i = 0; i <= GRID_LINES; i++) {
      const z = -GRID_HALF + ((i * step + scroll) % (GRID_HALF * 2));
      pts.push(-GRID_HALF, z, 0, GRID_HALF, z, 0);
    }
    // Lines perpendicular (vary x), fixed.
    for (let i = 0; i <= GRID_LINES; i++) {
      const x = -GRID_HALF + i * step;
      pts.push(x, -GRID_HALF, 0, x, GRID_HALF, 0);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return geo;
  }

  update(dt: number, _audioTime?: number): void {
    this.t += dt;

    // Grid scroll toward the camera.
    this.scroll = (this.scroll + dt * 18) % ((GRID_HALF * 2) / GRID_LINES);
    const old = this.grid.geometry;
    this.grid.geometry = this.buildGridGeometry(this.scroll);
    old.dispose();

    // Beat-pulse brightness pump (decays).
    if (this.pulse > 0) this.pulse = Math.max(0, this.pulse - dt * 3.2);
    const pump = 1 + this.pulse * 0.5;
    this.gridMat.opacity = 0.55 + this.pulse * 0.4;
    this.gridMat.color.setRGB(0, 0.94 * pump, 1 * Math.min(1, pump));
    this.skyMat.color.setScalar(1 + this.pulse * 0.25);
    this.sun.scale.setScalar(1 + this.pulse * 0.06 + Math.sin(this.t * 1.5) * 0.01);

    // Shake decay + camera jolt.
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 6);
      if (this.camera) {
        const m = this.shake;
        this.camera.position.set(
          (Math.random() - 0.5) * m * 2.4,
          this.camBaseY + (Math.random() - 0.5) * m * 2.0,
          this.camBaseZ + (Math.random() - 0.5) * m,
        );
        this.camera.lookAt(0, 18, -160);
      }
    } else if (this.camera) {
      this.camera.position.set(0, this.camBaseY, this.camBaseZ);
      this.camera.lookAt(0, 18, -160);
    }
  }

  dispose(): void {
    this.offBeat?.();
    this.offShake?.();
    this.offBeat = undefined;
    this.offShake = undefined;

    if (this.scene) {
      this.scene.remove(this.group);
      this.scene.background = this.prevBackground;
      this.scene.fog = this.prevFog;
    }
    this.scene = null;

    this.sky.geometry.dispose();
    this.skyTex.dispose();
    this.skyMat.dispose();
    this.sun.geometry.dispose();
    (this.sunMat.map as THREE.Texture | null)?.dispose();
    this.sunMat.dispose();
    this.grid.geometry.dispose();
    this.gridMat.dispose();
    this.camera = null;
  }
}
