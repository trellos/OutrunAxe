// bg06 — "Desert Neon Highway -> Volcanic" — flying down a neon-lined desert
// highway at dusk that erupts into a volcanic hellscape as performance intensity
// climbs. Three.js scene decoration (visuals only, GDD §8).
//
// The road is a single low-res CanvasTexture (NearestFilter, pixely) scrolling
// toward the camera so dashes stream past; distant mesas are chunky pixel
// silhouettes; the sky is a gradient quad. An eased `morph` (0..1) drives the
// whole transformation:
//   morph 0  -> calm dusk highway, cyan/magenta neon edge lines, amber sky.
//   morph ~  -> ground cracks open, lava seams glow between the asphalt, sky reddens.
//   morph 1  -> full VOLCANIC eruption: lava floods the road, fireballs arc and
//               pulse on the beat, ash drifts, everything chaotic and red-hot.
//
// Juice (all three required):
//   eddieBeatPulse  -> beat pump (fireball burst + lava surge; downbeat stronger),
//                      scaled by morph so beats only erupt as intensity rises.
//   eddieShake      -> camera jolt that decays.
//   eddieIntensity  -> stored as target; `morph` eases toward it every frame.
//
// dispose() restores scene.background/fog, disposes every geometry/material/
// texture and unsubscribes all listeners. Bloom-safe (no post-process touched);
// near meshes are frustumCulled=false.

import * as THREE from "three";
import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";
import type { EddieBackgroundDef, EddieBackgroundVariant } from "./types";

const ROAD_W = 96; // road CanvasTexture resolution
const ROAD_H = 160;
const MESA_W = 192;
const MESA_H = 64;
const FIREBALL_COUNT = 14;
const ASH_COUNT = 90;

interface Fireball {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  // Parabolic arc params (recomputed when relaunched on a beat).
  x0: number;
  z0: number;
  vx: number;
  vy: number;
  vz: number;
  y: number;
  t: number;
  life: number;
  active: boolean;
  baseScale: number;
}

class Bg06 implements EddieBackgroundVariant {
  private scene: THREE.Scene | null = null;
  private group = new THREE.Group();
  private prevBackground: THREE.Scene["background"] = null;
  private prevFog: THREE.Scene["fog"] = null;

  // Road (scrolling pixel canvas).
  private roadCanvas!: HTMLCanvasElement;
  private roadCtx!: CanvasRenderingContext2D;
  private roadTex!: THREE.CanvasTexture;
  private roadMat!: THREE.MeshBasicMaterial;
  private roadMesh!: THREE.Mesh;
  private scroll = 0;

  // Sky gradient.
  private skyCanvas!: HTMLCanvasElement;
  private skyCtx!: CanvasRenderingContext2D;
  private skyTex!: THREE.CanvasTexture;
  private skyMat!: THREE.MeshBasicMaterial;
  private skyMesh!: THREE.Mesh;

  // Distant mesa silhouette.
  private mesaTex!: THREE.CanvasTexture;
  private mesaMat!: THREE.MeshBasicMaterial;
  private mesaMesh!: THREE.Mesh;

  // Fireballs + ash (volcanic, high morph).
  private fireballs: Fireball[] = [];
  private fireGeo!: THREE.SphereGeometry;
  private ash!: THREE.Points;
  private ashGeo!: THREE.BufferGeometry;
  private ashMat!: THREE.PointsMaterial;
  private ashVel!: Float32Array;

  private camera: THREE.PerspectiveCamera | null = null;
  private camBaseY = 14;
  private camBaseZ = 36;

  private offBeat?: () => void;
  private offShake?: () => void;
  private offIntensity?: () => void;

  private morph = 0;
  private morphTarget = 0;
  private beat = 0; // beat pump, decays
  private beatDecay = 4;
  private shake = 0;
  private t = 0;

  private bgColor = new THREE.Color();

  mount(ctx: {
    scene: THREE.Scene;
    camera?: THREE.PerspectiveCamera;
    juice: EventBus<EddieJuiceEvents>;
  }): void {
    this.scene = ctx.scene;
    this.prevBackground = ctx.scene.background;
    this.prevFog = ctx.scene.fog;
    ctx.scene.background = new THREE.Color(0x2a1830);
    // Fog tints distance; color is morph-driven each frame.
    ctx.scene.fog = new THREE.Fog(0x2a1830, 40, 180);

    // --- Road -------------------------------------------------------------
    this.roadCanvas = document.createElement("canvas");
    this.roadCanvas.width = ROAD_W;
    this.roadCanvas.height = ROAD_H;
    this.roadCtx = this.roadCanvas.getContext("2d")!;
    this.roadCtx.imageSmoothingEnabled = false;
    this.roadTex = new THREE.CanvasTexture(this.roadCanvas);
    this.roadTex.colorSpace = THREE.SRGBColorSpace;
    this.roadTex.magFilter = THREE.NearestFilter;
    this.roadTex.minFilter = THREE.NearestFilter;
    this.roadTex.generateMipmaps = false;
    this.roadTex.wrapS = THREE.ClampToEdgeWrapping;
    this.roadTex.wrapT = THREE.RepeatWrapping;
    this.roadMat = new THREE.MeshBasicMaterial({
      map: this.roadTex,
      depthWrite: false,
      transparent: true,
      fog: true,
    });
    // Lay the road flat, receding from under the camera to the horizon.
    this.roadMesh = new THREE.Mesh(new THREE.PlaneGeometry(120, 320), this.roadMat);
    this.roadMesh.rotation.x = -Math.PI / 2;
    this.roadMesh.position.set(0, 0, -110);
    this.roadMesh.renderOrder = -10;
    this.roadMesh.frustumCulled = false;
    this.group.add(this.roadMesh);

    // --- Sky --------------------------------------------------------------
    this.skyCanvas = document.createElement("canvas");
    this.skyCanvas.width = 8;
    this.skyCanvas.height = 64;
    this.skyCtx = this.skyCanvas.getContext("2d")!;
    this.skyTex = new THREE.CanvasTexture(this.skyCanvas);
    this.skyTex.colorSpace = THREE.SRGBColorSpace;
    this.skyTex.magFilter = THREE.LinearFilter;
    this.skyTex.minFilter = THREE.LinearFilter;
    this.skyTex.generateMipmaps = false;
    this.skyMat = new THREE.MeshBasicMaterial({
      map: this.skyTex,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.skyMesh = new THREE.Mesh(new THREE.PlaneGeometry(640, 260), this.skyMat);
    this.skyMesh.position.set(0, 70, -260);
    this.skyMesh.renderOrder = -30;
    this.skyMesh.frustumCulled = false;
    this.group.add(this.skyMesh);

    // --- Mesas ------------------------------------------------------------
    this.mesaTex = this.buildMesaTexture();
    this.mesaMat = new THREE.MeshBasicMaterial({
      map: this.mesaTex,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.mesaMesh = new THREE.Mesh(new THREE.PlaneGeometry(560, 120), this.mesaMat);
    this.mesaMesh.position.set(0, 24, -240);
    this.mesaMesh.renderOrder = -25;
    this.mesaMesh.frustumCulled = false;
    this.group.add(this.mesaMesh);

    // --- Fireballs --------------------------------------------------------
    this.fireGeo = new THREE.SphereGeometry(2.4, 10, 8);
    for (let i = 0; i < FIREBALL_COUNT; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xff6a1a,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(this.fireGeo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.group.add(mesh);
      this.fireballs.push({
        mesh,
        mat,
        x0: 0,
        z0: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        y: 0,
        t: 0,
        life: 1,
        active: false,
        baseScale: 1,
      });
    }

    // --- Ash --------------------------------------------------------------
    this.ashGeo = new THREE.BufferGeometry();
    const pos = new Float32Array(ASH_COUNT * 3);
    this.ashVel = new Float32Array(ASH_COUNT * 3);
    for (let i = 0; i < ASH_COUNT; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 160;
      pos[i * 3 + 1] = Math.random() * 90;
      pos[i * 3 + 2] = -40 - Math.random() * 180;
      this.ashVel[i * 3] = (Math.random() - 0.5) * 2;
      this.ashVel[i * 3 + 1] = -2 - Math.random() * 4;
      this.ashVel[i * 3 + 2] = 4 + Math.random() * 8;
    }
    this.ashGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.ashMat = new THREE.PointsMaterial({
      color: 0x554a44,
      size: 1.6,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: true,
      sizeAttenuation: true,
    });
    this.ash = new THREE.Points(this.ashGeo, this.ashMat);
    this.ash.frustumCulled = false;
    this.group.add(this.ash);

    ctx.scene.add(this.group);

    if (ctx.camera) {
      this.camera = ctx.camera;
      this.camera.position.set(0, this.camBaseY, this.camBaseZ);
      this.camera.lookAt(0, 8, -120);
    }

    this.paintRoad();
    this.paintSky();

    this.offBeat = ctx.juice.on("eddieBeatPulse", (e) => {
      this.beat = Math.max(this.beat, e.downbeat ? 1 : 0.55);
      this.beatDecay = e.downbeat ? 1 / 0.28 : 1 / 0.18;
      // Volcanic beat reaction scales with morph: launch fireballs + lava surge.
      if (this.morph > 0.45) {
        const launches = e.downbeat ? 3 + Math.floor(this.morph * 4) : 1 + Math.floor(this.morph * 2);
        for (let i = 0; i < launches; i++) this.launchFireball();
      }
    });
    this.offShake = ctx.juice.on("eddieShake", (e) => {
      this.shake = Math.max(this.shake, e.magnitude);
    });
    this.offIntensity = ctx.juice.on("eddieIntensity", (e) => {
      this.morphTarget = Math.max(0, Math.min(1, e.value));
    });
  }

  private launchFireball(): void {
    const f = this.fireballs.find((x) => !x.active);
    if (!f) return;
    f.active = true;
    f.mesh.visible = true;
    f.t = 0;
    f.life = 0.7 + Math.random() * 0.6;
    f.x0 = (Math.random() - 0.5) * 70;
    f.z0 = -60 - Math.random() * 90;
    f.y = 0;
    f.vx = (Math.random() - 0.5) * 24;
    f.vy = 40 + Math.random() * 40 + this.morph * 30; // higher arcs at full eruption
    f.vz = 10 + Math.random() * 24;
    f.baseScale = 0.8 + Math.random() * 1.4;
  }

  /** Pixel road: asphalt + neon edge lines + center dashes; lava seams at morph. */
  private paintRoad(): void {
    const ctx = this.roadCtx;
    const m = this.morph;
    ctx.clearRect(0, 0, ROAD_W, ROAD_H);

    // Asphalt base — darkens and reddens with morph.
    const baseR = Math.floor(18 + m * 60);
    const baseG = Math.floor(16 - m * 8);
    const baseB = Math.floor(26 - m * 18);
    ctx.fillStyle = `rgb(${baseR},${Math.max(0, baseG)},${Math.max(0, baseB)})`;
    ctx.fillRect(0, 0, ROAD_W, ROAD_H);

    // Lava seams between "asphalt slabs": horizontal cracks that glow with morph.
    if (m > 0.12) {
      const glow = Math.min(1, (m - 0.12) / 0.5);
      for (let y = 0; y < ROAD_H; y += 10) {
        const jitter = ((y * 73) % 7) - 3;
        const lr = Math.floor(160 + 95 * glow);
        const lg = Math.floor(40 + 80 * glow * (0.4 + 0.6 * Math.random()));
        ctx.fillStyle = `rgba(${lr},${lg},20,${0.25 + 0.75 * glow})`;
        ctx.fillRect(0, y + jitter, ROAD_W, 1 + Math.round(glow * 2));
      }
      // Longitudinal cracks for a shattered-ground feel at high morph.
      if (m > 0.55) {
        const cracks = Math.floor((m - 0.55) * 10);
        for (let i = 0; i < cracks; i++) {
          const cx = (i * 29 + 7) % ROAD_W;
          ctx.fillStyle = `rgba(255,${100 + Math.floor(Math.random() * 80)},20,${0.5 + 0.5 * Math.random()})`;
          ctx.fillRect(cx, 0, 1 + Math.round(m), ROAD_H);
        }
      }
    }

    // Neon edge lines (cyan left, magenta right) fade out as lava takes over.
    const edgeFade = Math.max(0, 1 - m * 1.1);
    if (edgeFade > 0.02) {
      ctx.fillStyle = `rgba(0,240,255,${edgeFade})`;
      ctx.fillRect(8, 0, 3, ROAD_H);
      ctx.fillStyle = `rgba(255,43,214,${edgeFade})`;
      ctx.fillRect(ROAD_W - 11, 0, 3, ROAD_H);
    }

    // Center dashes — amber, become molten orange with morph.
    const dr = 255;
    const dg = Math.floor(200 - m * 90);
    const db = Math.floor(40 - m * 40);
    ctx.fillStyle = `rgb(${dr},${Math.max(0, dg)},${Math.max(0, db)})`;
    for (let y = 0; y < ROAD_H; y += 16) {
      ctx.fillRect(ROAD_W / 2 - 2, y, 4, 8);
    }

    this.roadTex.needsUpdate = true;
  }

  /** Vertical gradient sky: dusk amber/purple at morph 0 -> blood red at morph 1. */
  private paintSky(): void {
    const ctx = this.skyCtx;
    const m = this.morph;
    const grad = ctx.createLinearGradient(0, 0, 0, 64);
    // Top.
    const topR = Math.floor(40 + m * 70);
    const topG = Math.floor(10 + m * 6);
    const topB = Math.floor(60 - m * 50);
    // Horizon.
    const horR = Math.floor(255);
    const horG = Math.floor(120 - m * 90);
    const horB = Math.floor(40 - m * 35);
    grad.addColorStop(0, `rgb(${topR},${topG},${Math.max(0, topB)})`);
    grad.addColorStop(0.6, `rgb(${Math.floor(180 + m * 60)},${Math.floor(50 - m * 20)},${Math.max(0, Math.floor(60 - m * 50))})`);
    grad.addColorStop(1, `rgb(${horR},${Math.max(0, horG)},${Math.max(0, horB)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 8, 64);
    this.skyTex.needsUpdate = true;
  }

  private buildMesaTexture(): THREE.CanvasTexture {
    const c = document.createElement("canvas");
    c.width = MESA_W;
    c.height = MESA_H;
    const g = c.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, MESA_W, MESA_H);
    // Chunky pixel mesa silhouettes along the bottom.
    g.fillStyle = "#1a0e1e";
    let x = 0;
    while (x < MESA_W) {
      const w = 12 + Math.floor(Math.random() * 30);
      const h = 14 + Math.floor(Math.random() * 36);
      g.fillRect(x, MESA_H - h, w, h);
      x += w + Math.floor(Math.random() * 8);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    return tex;
  }

  update(dt: number, _audioTime: number): void {
    this.t += dt;

    // Ease morph toward target (never snap).
    this.morph += (this.morphTarget - this.morph) * dt * 1.5;
    const m = this.morph;

    if (this.beat > 0) this.beat = Math.max(0, this.beat - dt * this.beatDecay);

    // Scroll the road toward the camera; speed pumps on the beat (scaled by morph).
    const speed = 0.4 + 0.5 * m + this.beat * (0.4 + m * 0.8);
    this.scroll = (this.scroll + dt * speed) % 1;
    this.roadTex.offset.y = -this.scroll;

    // Repaint pixel canvases (cheap at this resolution); morph drives their look.
    this.paintRoad();
    this.paintSky();

    // Mesa silhouette reddens and brightens slightly with morph + beat.
    this.mesaMat.color.setRGB(1, 0.6 - m * 0.4, 0.6 - m * 0.5);
    this.mesaMat.opacity = 1;

    // Scene background + fog track the sky mood.
    const bgT = 0.16 + m * 0.12 + this.beat * 0.05;
    this.bgColor.setRGB(0.16 + m * 0.5, 0.09 - m * 0.05, 0.19 - m * 0.16);
    if (this.bgColor.g < 0) this.bgColor.g = 0;
    if (this.bgColor.b < 0) this.bgColor.b = 0;
    if (this.scene && this.scene.background instanceof THREE.Color) {
      this.scene.background.copy(this.bgColor).multiplyScalar(1 + bgT * 0.5);
    }
    if (this.scene && this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(this.bgColor);
      this.scene.fog.near = 40 - m * 18;
      this.scene.fog.far = 180 - m * 60;
    }

    // Fireballs: parabolic arc, glow + pulse on the beat, fade on landing.
    for (const f of this.fireballs) {
      if (!f.active) continue;
      f.t += dt;
      const k = f.t / f.life;
      if (k >= 1) {
        f.active = false;
        f.mesh.visible = false;
        f.mat.opacity = 0;
        continue;
      }
      const x = f.x0 + f.vx * f.t;
      const y = Math.max(0, f.vy * f.t - 0.5 * 90 * f.t * f.t);
      const z = f.z0 + f.vz * f.t;
      f.mesh.position.set(x, y, z);
      const pulse = 1 + this.beat * 0.6;
      const s = f.baseScale * pulse * (0.6 + 0.4 * Math.sin(k * Math.PI));
      f.mesh.scale.setScalar(s);
      // Color ramps hotter at the apex.
      const heat = 0.5 + 0.5 * Math.sin(k * Math.PI);
      f.mat.color.setRGB(1, 0.35 + heat * 0.35, heat * 0.15);
      f.mat.opacity = Math.sin(k * Math.PI) * (0.7 + 0.3 * this.beat);
    }

    // Ash: visible only at high morph, drifting toward the camera.
    this.ashMat.opacity = Math.max(0, (m - 0.5) / 0.5) * 0.6;
    if (this.ashMat.opacity > 0.01) {
      const pos = this.ashGeo.getAttribute("position") as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < ASH_COUNT; i++) {
        arr[i * 3] += this.ashVel[i * 3] * dt;
        arr[i * 3 + 1] += this.ashVel[i * 3 + 1] * dt;
        arr[i * 3 + 2] += this.ashVel[i * 3 + 2] * dt * (1 + m);
        if (arr[i * 3 + 2] > 40 || arr[i * 3 + 1] < -4) {
          arr[i * 3] = (Math.random() - 0.5) * 160;
          arr[i * 3 + 1] = 70 + Math.random() * 30;
          arr[i * 3 + 2] = -120 - Math.random() * 120;
        }
      }
      pos.needsUpdate = true;
    }

    // Camera: parked, with beat bob + decaying shake.
    if (this.camera) {
      const bob = Math.sin(this.t * 6) * (0.3 + m * 0.6) + this.beat * 1.2;
      let px = 0;
      let py = this.camBaseY + bob;
      let pz = this.camBaseZ;
      if (this.shake > 0) {
        this.shake = Math.max(0, this.shake - dt * 6);
        const a = this.shake;
        px += (Math.random() - 0.5) * a * 2.2;
        py += (Math.random() - 0.5) * a * 1.8;
        pz += (Math.random() - 0.5) * a;
      }
      this.camera.position.set(px, py, pz);
      this.camera.lookAt(0, 8, -120);
    }
  }

  dispose(): void {
    this.offBeat?.();
    this.offShake?.();
    this.offIntensity?.();
    this.offBeat = undefined;
    this.offShake = undefined;
    this.offIntensity = undefined;

    if (this.scene) {
      this.scene.remove(this.group);
      this.scene.background = this.prevBackground;
      this.scene.fog = this.prevFog;
    }
    this.scene = null;

    this.roadMesh.geometry.dispose();
    this.roadMat.dispose();
    this.roadTex.dispose();
    this.skyMesh.geometry.dispose();
    this.skyMat.dispose();
    this.skyTex.dispose();
    this.mesaMesh.geometry.dispose();
    this.mesaMat.dispose();
    this.mesaTex.dispose();
    this.fireGeo.dispose();
    for (const f of this.fireballs) f.mat.dispose();
    this.fireballs = [];
    this.ashGeo.dispose();
    this.ashMat.dispose();
    this.camera = null;
  }
}

const def: EddieBackgroundDef = {
  id: "bg06",
  label: "Desert Highway -> Volcanic",
  blurb: "A neon-lined dusk desert highway streams past; rising intensity cracks the ground, floods lava between the asphalt, and erupts fireballs that pulse on the beat under a blood-red sky.",
  create: () => new Bg06(),
};

export default def;
