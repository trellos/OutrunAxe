// bg02 — "Neon Skyline". A wireframe/emissive neon city skyline against a
// night-purple sky with a star + scanline field. Building windows flicker on the
// beat; the whole skyline pumps brightness on the downbeat.
//
// Visuals only (GDD §8): subscribes to the juice bus — eddieBeatPulse flickers
// windows + pumps the neon, eddieShake jolts the parked camera. Sets
// scene.background/fog in mount and RESTORES them in dispose, disposing every
// geometry/material/texture and unsubscribing.

import * as THREE from "three";
import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";
import type { EddieBackgroundDef, EddieBackgroundVariant } from "./types";

const SKY_W = 700;
const SKY_H = 440;
const NEON_COLORS = [0xff2bd6, 0x00f0ff, 0xffd02b, 0xff5a8a];

interface Building {
  edges: THREE.LineSegments;
  edgeMat: THREE.LineBasicMaterial;
  windows: THREE.Points;
  winMat: THREE.PointsMaterial;
  baseHue: THREE.Color;
}

class Bg02 implements EddieBackgroundVariant {
  private scene: THREE.Scene | null = null;
  private group = new THREE.Group();
  private prevBackground: THREE.Scene["background"] = null;
  private prevFog: THREE.Scene["fog"] = null;

  private skyTex!: THREE.CanvasTexture;
  private skyMat!: THREE.MeshBasicMaterial;
  private sky!: THREE.Mesh;

  private starTex!: THREE.CanvasTexture;
  private starMat!: THREE.MeshBasicMaterial;
  private stars!: THREE.Mesh;

  private scanTex!: THREE.CanvasTexture;
  private scanMat!: THREE.MeshBasicMaterial;
  private scan!: THREE.Mesh;

  private buildings: Building[] = [];
  private buildingGeos: THREE.BufferGeometry[] = [];

  private camera: THREE.PerspectiveCamera | null = null;
  private camBaseY = 10;
  private camBaseZ = 70;

  private offBeat?: () => void;
  private offShake?: () => void;

  private pulse = 0;
  private flicker = 0;
  private shake = 0;
  private t = 0;

  mount(ctx: { scene: THREE.Scene; camera?: THREE.PerspectiveCamera; juice: EventBus<EddieJuiceEvents> }): void {
    this.scene = ctx.scene;
    this.prevBackground = ctx.scene.background;
    this.prevFog = ctx.scene.fog;
    ctx.scene.background = new THREE.Color(0x0a0612);
    ctx.scene.fog = null;

    // --- Sky: deep night-purple vertical gradient.
    const cv = document.createElement("canvas");
    cv.width = 8;
    cv.height = 256;
    const c2d = cv.getContext("2d")!;
    const grad = c2d.createLinearGradient(0, 0, 0, cv.height);
    grad.addColorStop(0.0, "#05030f");
    grad.addColorStop(0.5, "#170a35");
    grad.addColorStop(0.82, "#3a0f5e");
    grad.addColorStop(1.0, "#5a1170");
    c2d.fillStyle = grad;
    c2d.fillRect(0, 0, cv.width, cv.height);
    this.skyTex = new THREE.CanvasTexture(cv);
    this.skyTex.colorSpace = THREE.SRGBColorSpace;
    this.skyMat = new THREE.MeshBasicMaterial({ map: this.skyTex, depthWrite: false, depthTest: false, fog: false });
    this.sky = new THREE.Mesh(new THREE.PlaneGeometry(SKY_W, SKY_H), this.skyMat);
    this.sky.position.set(0, 60, -210);
    this.sky.renderOrder = -20;
    this.group.add(this.sky);

    // --- Stars: scattered white dots stamped on a transparent canvas.
    this.starTex = this.buildStarTexture();
    this.starMat = new THREE.MeshBasicMaterial({
      map: this.starTex,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.stars = new THREE.Mesh(new THREE.PlaneGeometry(SKY_W, SKY_H * 0.7), this.starMat);
    this.stars.position.set(0, 90, -205);
    this.stars.renderOrder = -19;
    this.group.add(this.stars);

    // --- Buildings: an emissive wireframe skyline with point-sprite windows.
    let cursorX = -200;
    let idx = 0;
    while (cursorX < 200) {
      const w = 18 + Math.random() * 26;
      const h = 40 + Math.random() * 130;
      const d = 16 + Math.random() * 18;
      const color = new THREE.Color(NEON_COLORS[idx % NEON_COLORS.length]);
      this.buildings.push(this.buildBuilding(cursorX + w / 2, w, h, d, color));
      cursorX += w + 6 + Math.random() * 10;
      idx++;
    }

    // --- Scanlines: faint horizontal CRT bands overlaid on everything far.
    this.scanTex = this.buildScanTexture();
    this.scanMat = new THREE.MeshBasicMaterial({
      map: this.scanTex,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.scan = new THREE.Mesh(new THREE.PlaneGeometry(SKY_W, SKY_H), this.scanMat);
    this.scan.position.set(0, 60, -160);
    this.scan.renderOrder = -10;
    this.group.add(this.scan);

    ctx.scene.add(this.group);

    if (ctx.camera) {
      this.camera = ctx.camera;
      this.camera.position.set(0, this.camBaseY, this.camBaseZ);
      this.camera.lookAt(0, 36, -180);
    }

    this.offBeat = ctx.juice.on("eddieBeatPulse", (e) => {
      this.pulse = e.downbeat ? 1 : 0.55;
      this.flicker = e.downbeat ? 1 : 0.7;
    });
    this.offShake = ctx.juice.on("eddieShake", (e) => {
      this.shake = Math.max(this.shake, e.magnitude);
    });
  }

  private buildBuilding(x: number, w: number, h: number, d: number, color: THREE.Color): Building {
    // Emissive wireframe box edges.
    const boxGeo = new THREE.BoxGeometry(w, h, d);
    const edgeGeo = new THREE.EdgesGeometry(boxGeo);
    boxGeo.dispose();
    this.buildingGeos.push(edgeGeo);
    const edgeMat = new THREE.LineBasicMaterial({
      color: color.clone(),
      transparent: true,
      opacity: 0.9,
      fog: false,
    });
    const edges = new THREE.LineSegments(edgeGeo, edgeMat);
    edges.position.set(x, h / 2 - 18, -150 - Math.random() * 20);
    edges.renderOrder = -15;
    this.group.add(edges);

    // Windows: a grid of point sprites on the building's near face.
    const winPts: number[] = [];
    const cols = Math.max(2, Math.floor(w / 7));
    const rows = Math.max(3, Math.floor(h / 9));
    const halfW = w / 2 - 3;
    const halfH = h / 2 - 4;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (Math.random() < 0.28) continue; // some windows dark
        const wx = cols > 1 ? -halfW + (c / (cols - 1)) * (halfW * 2) : 0;
        const wy = rows > 1 ? -halfH + (r / (rows - 1)) * (halfH * 2) : 0;
        winPts.push(wx, wy, d / 2 + 0.4);
      }
    }
    const winGeo = new THREE.BufferGeometry();
    winGeo.setAttribute("position", new THREE.Float32BufferAttribute(winPts, 3));
    this.buildingGeos.push(winGeo);
    const winMat = new THREE.PointsMaterial({
      color: color.clone().offsetHSL(0, -0.1, 0.25),
      size: 2.2,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const windows = new THREE.Points(winGeo, winMat);
    windows.position.copy(edges.position);
    windows.renderOrder = -14;
    windows.frustumCulled = false;
    this.group.add(windows);

    return { edges, edgeMat, windows, winMat, baseHue: color.clone() };
  }

  private buildStarTexture(): THREE.CanvasTexture {
    const cv = document.createElement("canvas");
    cv.width = 512;
    cv.height = 256;
    const g = cv.getContext("2d")!;
    g.clearRect(0, 0, 512, 256);
    for (let i = 0; i < 220; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 256;
      const r = Math.random() * 1.3 + 0.3;
      g.globalAlpha = 0.4 + Math.random() * 0.6;
      g.fillStyle = Math.random() < 0.15 ? "#00f0ff" : "#ffffff";
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private buildScanTexture(): THREE.CanvasTexture {
    const cv = document.createElement("canvas");
    cv.width = 4;
    cv.height = 256;
    const g = cv.getContext("2d")!;
    g.clearRect(0, 0, 4, 256);
    g.fillStyle = "#00f0ff";
    for (let y = 0; y < 256; y += 3) g.fillRect(0, y, 4, 1);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 30);
    return tex;
  }

  update(dt: number, _audioTime: number): void {
    this.t += dt;

    if (this.pulse > 0) this.pulse = Math.max(0, this.pulse - dt * 3.0);
    if (this.flicker > 0) this.flicker = Math.max(0, this.flicker - dt * 4.5);

    this.skyMat.color.setScalar(1 + this.pulse * 0.18);
    this.starMat.opacity = 0.7 + this.pulse * 0.3 + Math.sin(this.t * 2.0) * 0.08;
    this.scanMat.opacity = 0.14 + this.pulse * 0.12;
    // Slow scanline drift for the rolling-CRT feel.
    this.scanTex.offset.y = (this.t * 0.05) % 1;

    const neon = 1 + this.pulse * 0.6;
    for (let i = 0; i < this.buildings.length; i++) {
      const b = this.buildings[i];
      b.edgeMat.opacity = 0.65 + this.pulse * 0.35;
      b.edgeMat.color.copy(b.baseHue).multiplyScalar(Math.min(1.0, neon));
      // Per-building window flicker, phase-offset so they don't all blink in sync.
      const ph = Math.sin(this.t * 9 + i * 1.7) * 0.5 + 0.5;
      const lit = 0.55 + this.flicker * 0.45 * ph;
      b.winMat.opacity = Math.min(1, 0.5 + lit * 0.5);
      b.winMat.size = 2.0 + this.flicker * 1.4 * ph;
    }

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 6);
      if (this.camera) {
        const m = this.shake;
        this.camera.position.set(
          (Math.random() - 0.5) * m * 2.2,
          this.camBaseY + (Math.random() - 0.5) * m * 1.8,
          this.camBaseZ + (Math.random() - 0.5) * m,
        );
        this.camera.lookAt(0, 36, -180);
      }
    } else if (this.camera) {
      this.camera.position.set(0, this.camBaseY, this.camBaseZ);
      this.camera.lookAt(0, 36, -180);
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
    this.stars.geometry.dispose();
    this.starTex.dispose();
    this.starMat.dispose();
    this.scan.geometry.dispose();
    this.scanTex.dispose();
    this.scanMat.dispose();

    for (const b of this.buildings) {
      b.edgeMat.dispose();
      b.winMat.dispose();
    }
    for (const g of this.buildingGeos) g.dispose();
    this.buildings = [];
    this.buildingGeos = [];
    this.camera = null;
  }
}

const def: EddieBackgroundDef = {
  id: "bg02",
  label: "Neon Skyline",
  blurb: "Emissive wireframe city skyline against a night-purple sky with stars + scanlines — windows flicker on the beat.",
  create: () => new Bg02(),
};

export default def;
