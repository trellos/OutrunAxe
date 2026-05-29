// bg01 — "Chrome Sunset". Airbrushed multi-band sunset sky, a big chrome-gradient
// banded sun, and a row of flat-black palm-tree silhouettes on a hazy horizon.
//
// Visuals only (GDD §8): subscribes to the juice bus — eddieBeatPulse pumps the
// sky/sun brightness on the beat (Art interpolates the decay), eddieShake jolts
// the parked camera with a decaying random offset. Sets scene.background/fog in
// mount and RESTORES them in dispose, disposing every geometry/material/texture.

import * as THREE from "three";
import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";
import type { EddieBackgroundDef, EddieBackgroundVariant } from "./types";

const SKY_W = 700;
const SKY_H = 420;
const SUN_SIZE = 150;
const HAZE_COLOR = 0xff7a2b;

class Bg01 implements EddieBackgroundVariant {
  private scene: THREE.Scene | null = null;
  private group = new THREE.Group();
  private prevBackground: THREE.Scene["background"] = null;
  private prevFog: THREE.Scene["fog"] = null;

  private skyTex!: THREE.CanvasTexture;
  private skyMat!: THREE.MeshBasicMaterial;
  private sky!: THREE.Mesh;

  private sunTex!: THREE.CanvasTexture;
  private sunMat!: THREE.MeshBasicMaterial;
  private sun!: THREE.Mesh;

  private hazeMat!: THREE.MeshBasicMaterial;
  private hazeTex!: THREE.CanvasTexture;
  private haze!: THREE.Mesh;

  private palmTex!: THREE.CanvasTexture;
  private palmMats: THREE.MeshBasicMaterial[] = [];
  private palmGeo!: THREE.PlaneGeometry;
  private palms!: THREE.Group;

  private camera: THREE.PerspectiveCamera | null = null;
  private camBaseY = 8;
  private camBaseZ = 64;

  private offBeat?: () => void;
  private offShake?: () => void;

  private pulse = 0;
  private shake = 0;
  private t = 0;

  mount(ctx: { scene: THREE.Scene; camera?: THREE.PerspectiveCamera; juice: EventBus<EddieJuiceEvents> }): void {
    this.scene = ctx.scene;
    this.prevBackground = ctx.scene.background;
    this.prevFog = ctx.scene.fog;
    ctx.scene.background = new THREE.Color(0x1a0030);
    ctx.scene.fog = null;

    // --- Sky: lush airbrushed multi-band sunset gradient on a tall canvas.
    const cv = document.createElement("canvas");
    cv.width = 8;
    cv.height = 512;
    const c2d = cv.getContext("2d")!;
    const grad = c2d.createLinearGradient(0, 0, 0, cv.height);
    grad.addColorStop(0.0, "#160030");
    grad.addColorStop(0.22, "#3a0a5e");
    grad.addColorStop(0.42, "#8a1a86");
    grad.addColorStop(0.58, "#ff2bd6");
    grad.addColorStop(0.72, "#ff5a8a");
    grad.addColorStop(0.84, "#ff7a2b");
    grad.addColorStop(0.93, "#ffb347");
    grad.addColorStop(1.0, "#ffd02b");
    c2d.fillStyle = grad;
    c2d.fillRect(0, 0, cv.width, cv.height);
    this.skyTex = new THREE.CanvasTexture(cv);
    this.skyTex.colorSpace = THREE.SRGBColorSpace;
    this.skyMat = new THREE.MeshBasicMaterial({ map: this.skyTex, depthWrite: false, depthTest: false, fog: false });
    this.sky = new THREE.Mesh(new THREE.PlaneGeometry(SKY_W, SKY_H), this.skyMat);
    this.sky.position.set(0, 60, -200);
    this.sky.renderOrder = -20;
    this.group.add(this.sky);

    // --- Sun: chrome-gradient banded disc (venetian-blind slats in lower half).
    const sunCv = document.createElement("canvas");
    sunCv.width = 256;
    sunCv.height = 256;
    const s2d = sunCv.getContext("2d")!;
    const sg = s2d.createLinearGradient(0, 8, 0, 248);
    sg.addColorStop(0.0, "#fff7e0");
    sg.addColorStop(0.32, "#ffe07a");
    sg.addColorStop(0.62, "#ff9a3c");
    sg.addColorStop(0.82, "#ff3a8e");
    sg.addColorStop(1.0, "#ff2bd6");
    s2d.fillStyle = sg;
    s2d.beginPath();
    s2d.arc(128, 128, 120, 0, Math.PI * 2);
    s2d.fill();
    // A subtle bright chrome streak across the upper third for the airbrushed sheen.
    s2d.globalCompositeOperation = "lighter";
    const sheen = s2d.createLinearGradient(0, 64, 0, 110);
    sheen.addColorStop(0, "rgba(255,255,255,0)");
    sheen.addColorStop(0.5, "rgba(255,255,255,0.45)");
    sheen.addColorStop(1, "rgba(255,255,255,0)");
    s2d.fillStyle = sheen;
    s2d.fillRect(0, 64, 256, 46);
    // Cut horizontal slats in the lower half (retro sun bars).
    s2d.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 7; i++) {
      const y = 146 + i * 14;
      s2d.fillRect(0, y, 256, 5 + i);
    }
    s2d.globalCompositeOperation = "source-over";
    this.sunTex = new THREE.CanvasTexture(sunCv);
    this.sunTex.colorSpace = THREE.SRGBColorSpace;
    this.sunMat = new THREE.MeshBasicMaterial({
      map: this.sunTex,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.sun = new THREE.Mesh(new THREE.PlaneGeometry(SUN_SIZE, SUN_SIZE), this.sunMat);
    this.sun.position.set(0, 34, -190);
    this.sun.renderOrder = -19;
    this.group.add(this.sun);

    // --- Haze: a soft horizontal band glowing along the horizon line.
    const hzCv = document.createElement("canvas");
    hzCv.width = 8;
    hzCv.height = 64;
    const h2d = hzCv.getContext("2d")!;
    const hg = h2d.createLinearGradient(0, 0, 0, 64);
    hg.addColorStop(0, "rgba(255,122,43,0)");
    hg.addColorStop(0.5, "rgba(255,160,80,0.55)");
    hg.addColorStop(1, "rgba(255,122,43,0)");
    h2d.fillStyle = hg;
    h2d.fillRect(0, 0, 8, 64);
    this.hazeTex = new THREE.CanvasTexture(hzCv);
    this.hazeTex.colorSpace = THREE.SRGBColorSpace;
    this.hazeMat = new THREE.MeshBasicMaterial({
      map: this.hazeTex,
      color: HAZE_COLOR,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.haze = new THREE.Mesh(new THREE.PlaneGeometry(SKY_W, 70), this.hazeMat);
    this.haze.position.set(0, 6, -188);
    this.haze.renderOrder = -18;
    this.group.add(this.haze);

    // --- Palms: flat-black silhouettes stamped on one shared canvas texture,
    //     instanced across the horizon at varied scale/depth.
    this.palmTex = this.buildPalmTexture();
    this.palmGeo = new THREE.PlaneGeometry(40, 56);
    this.palms = new THREE.Group();
    const placements = [
      { x: -150, s: 1.15, z: -176 },
      { x: -96, s: 0.85, z: -180 },
      { x: -54, s: 1.35, z: -172 },
      { x: 60, s: 1.0, z: -178 },
      { x: 104, s: 1.5, z: -170 },
      { x: 158, s: 0.92, z: -181 },
    ];
    for (const p of placements) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.palmTex,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        fog: false,
      });
      this.palmMats.push(mat);
      const m = new THREE.Mesh(this.palmGeo, mat);
      m.scale.setScalar(p.s);
      // Anchor the trunk bases roughly on the horizon line (haze at y≈6).
      m.position.set(p.x, 6 + (56 * p.s) / 2 - 6, p.z);
      m.renderOrder = -17;
      this.palms.add(m);
    }
    this.group.add(this.palms);

    ctx.scene.add(this.group);

    if (ctx.camera) {
      this.camera = ctx.camera;
      this.camera.position.set(0, this.camBaseY, this.camBaseZ);
      this.camera.lookAt(0, 24, -180);
    }

    this.offBeat = ctx.juice.on("eddieBeatPulse", (e) => {
      this.pulse = e.downbeat ? 1 : 0.55;
    });
    this.offShake = ctx.juice.on("eddieShake", (e) => {
      this.shake = Math.max(this.shake, e.magnitude);
    });
  }

  private buildPalmTexture(): THREE.CanvasTexture {
    const cv = document.createElement("canvas");
    cv.width = 128;
    cv.height = 180;
    const g = cv.getContext("2d")!;
    g.fillStyle = "#000000";
    // Trunk: a gently curved tapering column.
    g.beginPath();
    g.moveTo(58, 178);
    g.quadraticCurveTo(72, 110, 64, 64);
    g.lineTo(72, 64);
    g.quadraticCurveTo(82, 112, 70, 178);
    g.closePath();
    g.fill();
    // Crown: radiating fronds drawn as tapered quad strokes.
    const cx = 66;
    const cy = 60;
    const fronds = [
      { a: -2.5, len: 52 },
      { a: -1.8, len: 60 },
      { a: -1.1, len: 56 },
      { a: -0.4, len: 50 },
      { a: 0.4, len: 50 },
      { a: 1.1, len: 56 },
      { a: 1.8, len: 60 },
      { a: 2.5, len: 52 },
    ];
    for (const f of fronds) {
      const ex = cx + Math.cos(f.a - Math.PI / 2) * f.len;
      const ey = cy + Math.sin(f.a - Math.PI / 2) * f.len + 10;
      const mx = cx + Math.cos(f.a - Math.PI / 2) * f.len * 0.5;
      const my = cy + Math.sin(f.a - Math.PI / 2) * f.len * 0.5;
      g.beginPath();
      g.moveTo(cx, cy);
      g.quadraticCurveTo(mx, my - 8, ex, ey);
      g.quadraticCurveTo(mx, my + 4, cx, cy);
      g.closePath();
      g.fill();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  update(dt: number, _audioTime: number): void {
    this.t += dt;

    // Beat-pulse brightness pump (decays).
    if (this.pulse > 0) this.pulse = Math.max(0, this.pulse - dt * 3.0);
    this.skyMat.color.setScalar(1 + this.pulse * 0.22);
    this.sunMat.color.setScalar(1 + this.pulse * 0.3);
    this.sun.scale.setScalar(1 + this.pulse * 0.07 + Math.sin(this.t * 1.3) * 0.012);
    this.hazeMat.opacity = 0.65 + this.pulse * 0.3 + Math.sin(this.t * 0.8) * 0.05;
    // Palms hold their flat black; only their crowns sway a hair on the pulse.
    const sway = Math.sin(this.t * 0.9) * 0.015 + this.pulse * 0.01;
    for (const m of this.palms.children) m.rotation.z = sway;

    // Shake decay + camera jolt.
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 6);
      if (this.camera) {
        const m = this.shake;
        this.camera.position.set(
          (Math.random() - 0.5) * m * 2.2,
          this.camBaseY + (Math.random() - 0.5) * m * 1.8,
          this.camBaseZ + (Math.random() - 0.5) * m,
        );
        this.camera.lookAt(0, 24, -180);
      }
    } else if (this.camera) {
      this.camera.position.set(0, this.camBaseY, this.camBaseZ);
      this.camera.lookAt(0, 24, -180);
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
    this.sunTex.dispose();
    this.sunMat.dispose();
    this.haze.geometry.dispose();
    this.hazeTex.dispose();
    this.hazeMat.dispose();
    this.palmGeo.dispose();
    this.palmTex.dispose();
    for (const m of this.palmMats) m.dispose();
    this.palmMats = [];
    this.camera = null;
  }
}

const def: EddieBackgroundDef = {
  id: "bg01",
  label: "Chrome Sunset",
  blurb: "Airbrushed multi-band sunset, chrome banded sun, black palm silhouettes on a hazy horizon — pumps on the beat.",
  create: () => new Bg01(),
};

export default def;
