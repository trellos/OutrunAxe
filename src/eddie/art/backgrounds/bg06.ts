// bg06 — "Op-Art Horizon" — Memphis-design checkerboard floor + ring sky.
//
// A high-contrast perspective checkerboard floor recedes to a hard horizon line
// under a bold magenta->cyan gradient sky, with floating neon geometric rings
// hovering over the vanishing point. The checker phase scrolls toward the
// camera; on the beat the checker contrast snaps to full black/white, the
// horizon glow flares, and the rings expand — pure 1980s op-art set design.
//
// Visuals only: subscribes to eddieBeatPulse (contrast/flare pump) and
// eddieShake (camera jolt), sets+restores scene.background/fog, disposes every
// geometry/material/texture on teardown.

import * as THREE from "three";
import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";
import type { EddieBackgroundDef, EddieBackgroundVariant } from "./types";

const FLOOR_W = 600;
const FLOOR_D = 800;
const CHECK_TEX = 512;
const RING_NEON = [0xff2bd6, 0x00f0ff, 0xffd02b];

class Bg06 implements EddieBackgroundVariant {
  private scene: THREE.Scene | null = null;
  private group = new THREE.Group();
  private prevBackground: THREE.Scene["background"] = null;
  private prevFog: THREE.Scene["fog"] = null;

  private sky!: THREE.Mesh;
  private skyMat!: THREE.MeshBasicMaterial;
  private skyTex!: THREE.CanvasTexture;

  private floor!: THREE.Mesh;
  private floorMat!: THREE.MeshBasicMaterial;
  private checkCanvas!: HTMLCanvasElement;
  private checkCtx!: CanvasRenderingContext2D;
  private checkTex!: THREE.CanvasTexture;

  private horizon!: THREE.Mesh;
  private horizonMat!: THREE.MeshBasicMaterial;
  private horizonTex!: THREE.CanvasTexture;

  private rings: THREE.Mesh[] = [];
  private ringMats: THREE.MeshBasicMaterial[] = [];
  private ringGeos: THREE.RingGeometry[] = [];

  private camera: THREE.PerspectiveCamera | null = null;
  private camBaseY = 0;
  private camBaseZ = 0;

  private offBeat?: () => void;
  private offShake?: () => void;

  private pulse = 0; // 0..1 decaying contrast/flare pump
  private shake = 0;
  private t = 0;
  private lastContrast = -1; // avoid redrawing the checker texture every frame

  mount(ctx: { scene: THREE.Scene; camera?: THREE.PerspectiveCamera; juice: EventBus<EddieJuiceEvents> }): void {
    this.scene = ctx.scene;
    this.prevBackground = ctx.scene.background;
    this.prevFog = ctx.scene.fog;
    ctx.scene.background = new THREE.Color(0x0a0612);
    ctx.scene.fog = new THREE.Fog(0x12002a, 280, FLOOR_D * 0.9);

    // --- Sky: bold magenta->cyan gradient with a deep-purple top.
    const skyCv = document.createElement("canvas");
    skyCv.width = 16;
    skyCv.height = 256;
    const s2d = skyCv.getContext("2d")!;
    const sg = s2d.createLinearGradient(0, 0, 0, 256);
    sg.addColorStop(0.0, "#0a0612");
    sg.addColorStop(0.4, "#3a0a5a");
    sg.addColorStop(0.7, "#ff2bd6");
    sg.addColorStop(0.88, "#ff7ad0");
    sg.addColorStop(1.0, "#00f0ff");
    s2d.fillStyle = sg;
    s2d.fillRect(0, 0, 16, 256);
    this.skyTex = new THREE.CanvasTexture(skyCv);
    this.skyTex.colorSpace = THREE.SRGBColorSpace;
    this.skyMat = new THREE.MeshBasicMaterial({ map: this.skyTex, depthWrite: false, depthTest: false, fog: false });
    this.sky = new THREE.Mesh(new THREE.PlaneGeometry(1400, 600), this.skyMat);
    this.sky.position.set(0, 120, -FLOOR_D * 0.85);
    this.sky.renderOrder = -12;
    this.group.add(this.sky);

    // --- Checkerboard floor texture (redrawn only when contrast changes).
    this.checkCanvas = document.createElement("canvas");
    this.checkCanvas.width = CHECK_TEX;
    this.checkCanvas.height = CHECK_TEX;
    this.checkCtx = this.checkCanvas.getContext("2d")!;
    this.paintChecker(0);
    this.checkTex = new THREE.CanvasTexture(this.checkCanvas);
    this.checkTex.colorSpace = THREE.SRGBColorSpace;
    this.checkTex.wrapS = THREE.RepeatWrapping;
    this.checkTex.wrapT = THREE.RepeatWrapping;
    this.checkTex.repeat.set(16, 22);
    this.checkTex.anisotropy = 4;
    this.floorMat = new THREE.MeshBasicMaterial({ map: this.checkTex, fog: true, depthWrite: true });
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR_W, FLOOR_D), this.floorMat);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.set(0, -16, -FLOOR_D / 2 + 60);
    this.floor.renderOrder = -10;
    this.group.add(this.floor);

    // --- Horizon glow strip sitting on the floor's far edge.
    this.horizonTex = new THREE.CanvasTexture(this.buildHorizonGlow());
    this.horizonTex.colorSpace = THREE.SRGBColorSpace;
    this.horizonMat = new THREE.MeshBasicMaterial({
      map: this.horizonTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.horizon = new THREE.Mesh(new THREE.PlaneGeometry(1400, 130), this.horizonMat);
    this.horizon.position.set(0, 2, -FLOOR_D * 0.84);
    this.horizon.renderOrder = -9;
    this.group.add(this.horizon);

    // --- Floating neon rings over the vanishing point.
    for (let r = 0; r < 3; r++) {
      const inner = 26 + r * 16;
      const geo = new THREE.RingGeometry(inner, inner + 4, 48);
      const mat = new THREE.MeshBasicMaterial({
        color: RING_NEON[r % RING_NEON.length],
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
        fog: false,
      });
      const ring = new THREE.Mesh(geo, mat);
      ring.position.set(0, 70 + r * 4, -FLOOR_D * 0.8);
      ring.renderOrder = -8;
      this.ringGeos.push(geo);
      this.ringMats.push(mat);
      this.rings.push(ring);
      this.group.add(ring);
    }

    ctx.scene.add(this.group);

    if (ctx.camera) {
      this.camera = ctx.camera;
      this.camBaseY = 10;
      this.camBaseZ = 70;
      this.camera.position.set(0, this.camBaseY, this.camBaseZ);
      this.camera.lookAt(0, 30, -FLOOR_D);
    }

    this.offBeat = ctx.juice.on("eddieBeatPulse", (e) => {
      this.pulse = e.downbeat ? 1 : 0.6;
    });
    this.offShake = ctx.juice.on("eddieShake", (e) => {
      this.shake = Math.max(this.shake, e.magnitude);
    });
  }

  /** Draw a 2x2 checker. `contrast` 0..1 pushes the dark cell from charcoal to
   *  pure black and the light cell from off-white to pure white. */
  private paintChecker(contrast: number): void {
    const dark = Math.round(26 * (1 - contrast)); // 26 -> 0
    const light = Math.round(210 + 45 * contrast); // 210 -> 255
    const dHex = `rgb(${dark},${dark},${Math.round(dark + 8 * (1 - contrast))})`;
    const lHex = `rgb(${light},${light},${light})`;
    const ctx = this.checkCtx;
    const half = CHECK_TEX / 2;
    ctx.fillStyle = dHex;
    ctx.fillRect(0, 0, CHECK_TEX, CHECK_TEX);
    ctx.fillStyle = lHex;
    ctx.fillRect(0, 0, half, half);
    ctx.fillRect(half, half, half, half);
    this.lastContrast = contrast;
  }

  /** Bright additive horizon line, hottest at center. */
  private buildHorizonGlow(): HTMLCanvasElement {
    const cv = document.createElement("canvas");
    cv.width = 512;
    cv.height = 64;
    const g2d = cv.getContext("2d")!;
    const grad = g2d.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, "rgba(0,240,255,0)");
    grad.addColorStop(0.5, "rgba(255,255,255,0.95)");
    grad.addColorStop(0.55, "rgba(255,43,214,0.9)");
    grad.addColorStop(1, "rgba(255,43,214,0)");
    g2d.fillStyle = grad;
    g2d.fillRect(0, 0, 512, 64);
    // Fade the horizontal ends so the strip doesn't show hard edges.
    const h = g2d.createLinearGradient(0, 0, 512, 0);
    h.addColorStop(0, "rgba(0,0,0,1)");
    h.addColorStop(0.15, "rgba(0,0,0,0)");
    h.addColorStop(0.85, "rgba(0,0,0,0)");
    h.addColorStop(1, "rgba(0,0,0,1)");
    g2d.globalCompositeOperation = "destination-out";
    g2d.fillStyle = h;
    g2d.fillRect(0, 0, 512, 64);
    g2d.globalCompositeOperation = "source-over";
    return cv;
  }

  update(dt: number, _audioTime: number): void {
    this.t += dt;

    // Scroll the checker toward the camera.
    this.checkTex.offset.y = (this.checkTex.offset.y - dt * 0.35 + 1) % 1;

    // Beat-pulse: snap checker contrast up, flare the horizon, expand rings.
    if (this.pulse > 0) this.pulse = Math.max(0, this.pulse - dt * 2.8);

    // Only repaint the checker texture when contrast moves meaningfully.
    const targetContrast = this.pulse;
    if (Math.abs(targetContrast - this.lastContrast) > 0.04) {
      this.paintChecker(targetContrast);
      this.checkTex.needsUpdate = true;
    }

    this.skyMat.color.setScalar(1 + this.pulse * 0.2);
    this.horizonMat.color.setScalar(1 + this.pulse * 1.1);
    this.horizon.scale.setY(1 + this.pulse * 0.4);

    for (let r = 0; r < this.rings.length; r++) {
      const ring = this.rings[r];
      ring.rotation.z += dt * (0.3 + r * 0.12);
      const breathe = 1 + Math.sin(this.t * 1.5 + r) * 0.04;
      ring.scale.setScalar(breathe + this.pulse * (0.25 + r * 0.1));
      this.ringMats[r].opacity = 0.7 + this.pulse * 0.3;
    }

    // Shake decay + camera jolt; otherwise a slow bob for life.
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 6);
      if (this.camera) {
        const m = this.shake;
        this.camera.position.set(
          (Math.random() - 0.5) * m * 2.4,
          this.camBaseY + (Math.random() - 0.5) * m * 2.0,
          this.camBaseZ + (Math.random() - 0.5) * m,
        );
        this.camera.lookAt(0, 30, -FLOOR_D);
      }
    } else if (this.camera) {
      this.camera.position.set(
        Math.sin(this.t * 0.5) * 1.5,
        this.camBaseY + Math.sin(this.t * 0.8) * 0.6,
        this.camBaseZ,
      );
      this.camera.lookAt(0, 30, -FLOOR_D);
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
    this.skyMat.dispose();
    this.skyTex.dispose();
    this.floor.geometry.dispose();
    this.floorMat.dispose();
    this.checkTex.dispose();
    this.horizon.geometry.dispose();
    this.horizonMat.dispose();
    this.horizonTex.dispose();
    for (const g of this.ringGeos) g.dispose();
    for (const m of this.ringMats) m.dispose();
    this.ringGeos = [];
    this.ringMats = [];
    this.rings = [];
    this.camera = null;
  }
}

const def: EddieBackgroundDef = {
  id: "bg06",
  label: "Op-Art Horizon",
  blurb: "High-contrast perspective checkerboard floor receding to a flaring neon horizon under a bold gradient sky — the checker snaps to full contrast on the beat.",
  create: () => new Bg06(),
};

export default def;
