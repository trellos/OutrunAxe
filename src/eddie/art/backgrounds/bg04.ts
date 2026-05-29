// bg04 — "VHS Tunnel" — dead-channel analog video tunnel.
//
// A low-res CanvasTexture redrawn every frame as analog video garbage: grain,
// horizontal chroma color bands, a rolling tracking bar, and a torn
// head-switching strip at the very bottom. The texture is wrapped onto the
// inside of a long open cylinder so it reads as a tunnel of screen static
// rushing past the camera. On the beat the noise intensifies, the chroma
// saturates, and the tracking bar jumps — a TV losing sync to the kick drum.
//
// Visuals only: subscribes to eddieBeatPulse (intensity pump) and eddieShake
// (camera jolt), sets+restores scene.background/fog, and disposes every
// geometry/material/texture on teardown.

import * as THREE from "three";
import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";
import type { EddieBackgroundDef, EddieBackgroundVariant } from "./types";

// Deliberately low-res so the static looks chunky and analog, not crisp.
const NOISE_W = 160;
const NOISE_H = 120;
const TUNNEL_R = 90;
const TUNNEL_LEN = 520;

// 80s broadcast chroma bands cycled through the color-burst stripes.
const CHROMA = [
  [255, 43, 214], // #ff2bd6 magenta
  [0, 240, 255], // #00f0ff cyan
  [255, 208, 43], // #ffd02b amber
  [120, 60, 200], // violet
];

class Bg04 implements EddieBackgroundVariant {
  private scene: THREE.Scene | null = null;
  private group = new THREE.Group();
  private prevBackground: THREE.Scene["background"] = null;
  private prevFog: THREE.Scene["fog"] = null;

  private canvas!: HTMLCanvasElement;
  private c2d!: CanvasRenderingContext2D;
  private image!: ImageData;
  private tex!: THREE.CanvasTexture;
  private tunnel!: THREE.Mesh;
  private tunnelMat!: THREE.MeshBasicMaterial;
  private vignette!: THREE.Mesh;
  private vignetteMat!: THREE.MeshBasicMaterial;
  private vignetteTex!: THREE.CanvasTexture;

  private camera: THREE.PerspectiveCamera | null = null;
  private camBaseY = 0;
  private camBaseZ = 0;

  private offBeat?: () => void;
  private offShake?: () => void;

  private pulse = 0; // 0..1 decaying intensity pump
  private shake = 0;
  private t = 0;
  private trackingY = 0.5; // 0..1 rolling tracking-bar position
  private redrawAccum = 0; // throttles the noise redraw a touch

  mount(ctx: { scene: THREE.Scene; camera?: THREE.PerspectiveCamera; juice: EventBus<EddieJuiceEvents> }): void {
    this.scene = ctx.scene;
    this.prevBackground = ctx.scene.background;
    this.prevFog = ctx.scene.fog;
    ctx.scene.background = new THREE.Color(0x05030a);
    ctx.scene.fog = new THREE.Fog(0x05030a, 60, TUNNEL_LEN * 0.95);

    // --- Noise canvas. Drawn into an ImageData buffer each redraw for speed.
    this.canvas = document.createElement("canvas");
    this.canvas.width = NOISE_W;
    this.canvas.height = NOISE_H;
    this.c2d = this.canvas.getContext("2d")!;
    this.image = this.c2d.createImageData(NOISE_W, NOISE_H);
    this.paintNoise(0);
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.wrapS = THREE.RepeatWrapping;
    this.tex.wrapT = THREE.RepeatWrapping;
    this.tex.repeat.set(3, 5); // tile around + along the tunnel
    this.tex.magFilter = THREE.NearestFilter; // keep the chunky-static look
    this.tex.minFilter = THREE.LinearMipmapLinearFilter;

    // --- Tunnel: open cylinder, faces inward (BackSide).
    const geo = new THREE.CylinderGeometry(TUNNEL_R, TUNNEL_R, TUNNEL_LEN, 48, 1, true);
    geo.rotateX(Math.PI / 2); // lay the axis along -Z
    this.tunnelMat = new THREE.MeshBasicMaterial({
      map: this.tex,
      side: THREE.BackSide,
      depthWrite: false,
      fog: true,
    });
    this.tunnel = new THREE.Mesh(geo, this.tunnelMat);
    this.tunnel.position.set(0, 0, -TUNNEL_LEN / 2 + 40);
    this.tunnel.renderOrder = -10;
    this.group.add(this.tunnel);

    // --- Vignette ring near the camera to darken the edges like a CRT.
    this.vignetteTex = new THREE.CanvasTexture(this.buildVignette());
    this.vignetteTex.colorSpace = THREE.SRGBColorSpace;
    this.vignetteMat = new THREE.MeshBasicMaterial({
      map: this.vignetteTex,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.vignette = new THREE.Mesh(new THREE.PlaneGeometry(260, 200), this.vignetteMat);
    this.vignette.position.set(0, 0, 24);
    this.vignette.renderOrder = 50;
    this.group.add(this.vignette);

    ctx.scene.add(this.group);

    if (ctx.camera) {
      this.camera = ctx.camera;
      this.camBaseY = 0;
      this.camBaseZ = 40;
      this.camera.position.set(0, this.camBaseY, this.camBaseZ);
      this.camera.lookAt(0, 0, -200);
    }

    this.offBeat = ctx.juice.on("eddieBeatPulse", (e) => {
      this.pulse = e.downbeat ? 1 : 0.6;
      // A beat kicks the tracking bar to a new random row — TV loses sync.
      this.trackingY = Math.random();
    });
    this.offShake = ctx.juice.on("eddieShake", (e) => {
      this.shake = Math.max(this.shake, e.magnitude);
    });
  }

  /** Paint one frame of analog video garbage into the ImageData buffer. */
  private paintNoise(intensity: number): void {
    const data = this.image.data;
    const sat = 0.35 + intensity * 0.55; // chroma strength rises on the beat
    const trackRow = Math.floor(this.trackingY * NOISE_H);
    const trackThick = 5 + Math.floor(intensity * 7);
    const tearRow = NOISE_H - 6; // head-switching tear lives at the bottom

    for (let y = 0; y < NOISE_H; y++) {
      // Horizontal scanline base luma — gentle dark/light banding.
      const scan = 0.5 + 0.5 * Math.sin((y + this.t * 30) * 0.5);
      // Chroma color band for this scanline (slow vertical drift).
      const band = CHROMA[(y + Math.floor(this.t * 4)) % CHROMA.length];

      const inTrack = y >= trackRow && y < trackRow + trackThick;
      const inTear = y >= tearRow;

      for (let x = 0; x < NOISE_W; x++) {
        const i = (y * NOISE_W + x) * 4;
        // Base grain.
        let g = Math.random() * 255;

        if (inTear) {
          // Head-switching: torn, smeared bright/dark blocks at the bottom.
          const smear = (Math.sin(x * 0.4 + this.t * 60) + 1) * 0.5;
          g = smear * 255;
          data[i] = g;
          data[i + 1] = g;
          data[i + 2] = g;
          data[i + 3] = 255;
          continue;
        }

        if (inTrack) {
          // The rolling tracking bar: a brighter, noisier washed-out strip.
          g = 140 + Math.random() * 115;
        } else {
          g *= 0.35 + scan * 0.65;
        }

        // Mix grain luma with the chroma band by saturation amount.
        const r = g * (1 - sat) + band[0] * sat * (g / 255);
        const gg = g * (1 - sat) + band[1] * sat * (g / 255);
        const b = g * (1 - sat) + band[2] * sat * (g / 255);
        data[i] = r;
        data[i + 1] = gg;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
    }
    this.c2d.putImageData(this.image, 0, 0);
  }

  /** Radial CRT vignette: transparent center, dark feathered edges. */
  private buildVignette(): HTMLCanvasElement {
    const cv = document.createElement("canvas");
    cv.width = 256;
    cv.height = 256;
    const g2d = cv.getContext("2d")!;
    const rg = g2d.createRadialGradient(128, 128, 40, 128, 128, 150);
    rg.addColorStop(0, "rgba(5,3,10,0)");
    rg.addColorStop(0.7, "rgba(5,3,10,0)");
    rg.addColorStop(1, "rgba(5,3,10,0.92)");
    g2d.fillStyle = rg;
    g2d.fillRect(0, 0, 256, 256);
    return cv;
  }

  update(dt: number, _audioTime: number): void {
    this.t += dt;

    // Redraw the static ~30fps regardless of frame rate (it's expensive-ish).
    this.redrawAccum += dt;
    if (this.redrawAccum >= 1 / 30) {
      this.redrawAccum = 0;
      this.paintNoise(this.pulse);
      this.tex.needsUpdate = true;
    }

    // Scroll the texture down the tunnel toward the camera + slow roll around.
    this.tex.offset.y = (this.tex.offset.y + dt * 0.9) % 1;
    this.tex.offset.x = (this.tex.offset.x + dt * 0.05) % 1;

    // Beat-pulse: brighten the tunnel material and nudge the FOV-ish scale.
    if (this.pulse > 0) this.pulse = Math.max(0, this.pulse - dt * 2.6);
    const pump = 1 + this.pulse * 0.6;
    this.tunnelMat.color.setScalar(0.85 * pump);
    this.tunnel.rotation.z += dt * (0.12 + this.pulse * 0.5);
    this.vignetteMat.opacity = 1 - this.pulse * 0.25;

    // Shake decay + camera jolt; otherwise drift forward with a slow weave.
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 6);
      if (this.camera) {
        const m = this.shake;
        this.camera.position.set(
          (Math.random() - 0.5) * m * 2.4,
          (Math.random() - 0.5) * m * 2.0,
          this.camBaseZ + (Math.random() - 0.5) * m,
        );
        this.camera.lookAt(0, 0, -200);
      }
    } else if (this.camera) {
      const weave = Math.sin(this.t * 0.7) * 1.2;
      this.camera.position.set(weave, Math.cos(this.t * 0.5) * 0.8, this.camBaseZ);
      this.camera.lookAt(weave * 0.3, 0, -200);
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

    this.tunnel.geometry.dispose();
    this.tunnelMat.dispose();
    this.tex.dispose();
    this.vignette.geometry.dispose();
    this.vignetteMat.dispose();
    this.vignetteTex.dispose();
    this.camera = null;
  }
}

const def: EddieBackgroundDef = {
  id: "bg04",
  label: "VHS Tunnel",
  blurb: "Dead-channel analog video tunnel — grain, chroma bands, rolling tracking bar and head-switching tear, all losing sync to the beat.",
  create: () => new Bg04(),
};

export default def;
