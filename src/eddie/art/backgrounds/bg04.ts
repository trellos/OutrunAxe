// bg04 — "Vaporwave Plaza → Glitch Meltdown" — a REAL 3D vaporwave plaza the
// camera serenely MEANDERS THROUGH, that corrupts into a datamosh meltdown as
// performance intensity rises.
//
// Scene: a large checkerboard floor extending into the distance under a soft
// magenta→cyan→peach gradient sky dome with a banded vaporwave sun and a neon
// grid laid over the floor. Scattered down the plaza are low-poly objects wearing
// chunky NearestFilter pixel textures: marble BUSTS on plinths, abstract STATUES,
// and PALM TREES. Objects are laid out in a long corridor along -Z; the camera
// flies forward on a gentle serpentine path and objects that fall behind are
// recycled to the front, so the plaza is endless.
//
// MORPH (eddieIntensity, eased toward target each frame — never snaps): drives
// calm→meltdown. Low: serene, near-still. Rising: objects jitter/shear, the floor
// checker tears + heaves, neon brightens. High (≈1): objects datamosh — vertices
// explode outward and shudder, neon colors corrupt/strobe, RGB-split-ish flicker,
// the camera path goes erratic.
// Beat (eddieBeatPulse, downbeat stronger, scaled by morph): a one-shot glitch
// burst layered on top — objects punch/shear harder for a beat.
// Shake (eddieShake): camera jolt that decays.
//
// Visuals only (GDD §8). dispose() restores scene.background/fog, disposes every
// geometry/material/texture, and unsubscribes every listener. frustumCulled=false
// on the near objects so the meltdown vertex-explode never clips out.

import * as THREE from "three";
import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";
import type { EddieBackgroundDef, EddieBackgroundVariant } from "./types";

// Vaporwave palette.
const SKY_TOP = 0x2a1150;
const SKY_BOT = 0xff7ab0;
const NEON_MAGENTA = 0xff2bd6;
const NEON_CYAN = 0x00f0ff;
const CORRUPT_HEX = [0xff2bd6, 0x00f0ff, 0xffd02b, 0xc7ff2b];

// Plaza corridor geometry: objects live in a band along -Z and recycle.
const CORRIDOR_NEAR = 20; // recycle objects that pass behind this z
const CORRIDOR_FAR = -360; // spawn / wrap depth
const CORRIDOR_LEN = CORRIDOR_NEAR - CORRIDOR_FAR;
const LANE_X = 34; // how far objects sit off the centre path

type Kind = "bust" | "statue" | "palm";

interface PlazaObject {
  root: THREE.Group;
  kind: Kind;
  // Meshes whose vertices we shatter on meltdown.
  shatter: { mesh: THREE.Mesh; base: Float32Array; rand: Float32Array }[];
  // Emissive materials we recolor/strobe on corruption.
  emissives: THREE.MeshBasicMaterial[];
  side: number; // -1 left, +1 right
  swaySeed: number;
  // True while the mesh is still displaced and must settle back toward base once
  // corruption drops (so it never freezes mid-shatter).
  dirty: boolean;
}

class Bg04 implements EddieBackgroundVariant {
  private scene: THREE.Scene | null = null;
  private group = new THREE.Group();
  private prevBackground: THREE.Scene["background"] = null;
  private prevFog: THREE.Scene["fog"] = null;

  private camera: THREE.PerspectiveCamera | null = null;

  // Shared resources (disposed once).
  private textures: THREE.Texture[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];

  private floor!: THREE.Mesh;
  private floorMat!: THREE.MeshBasicMaterial;
  private floorTex!: THREE.CanvasTexture;
  private floorBase!: Float32Array;
  private floorCanvas!: HTMLCanvasElement;
  private floorCtx!: CanvasRenderingContext2D;

  private sky!: THREE.Mesh;
  private sun!: THREE.Mesh;
  private sunMat!: THREE.MeshBasicMaterial;
  private objects: PlazaObject[] = [];

  private offBeat?: () => void;
  private offShake?: () => void;
  private offIntensity?: () => void;

  private morph = 0;
  private morphTarget = 0;
  private beat = 0;
  private beatDecay = 6;
  private shake = 0;
  private t = 0;
  private travel = 0; // camera fly-through distance (drives serpentine + recycle)

  mount(ctx: { scene: THREE.Scene; camera?: THREE.PerspectiveCamera; juice: EventBus<EddieJuiceEvents> }): void {
    this.scene = ctx.scene;
    this.prevBackground = ctx.scene.background;
    this.prevFog = ctx.scene.fog;
    ctx.scene.background = new THREE.Color(SKY_TOP);
    // Fog hides the recycle pop at the far end and adds vaporwave depth haze.
    ctx.scene.fog = new THREE.Fog(0x3a1466, 120, 340);

    this.buildSky();
    this.buildFloor();
    this.buildObjects();

    this.scene.add(this.group);

    if (ctx.camera) {
      this.camera = ctx.camera;
      this.camera.position.set(0, 10, CORRIDOR_NEAR - 6);
      this.camera.lookAt(0, 8, -60);
    }

    this.offBeat = ctx.juice.on("eddieBeatPulse", (e) => {
      this.beat = Math.max(this.beat, e.downbeat ? 1 : 0.55);
      this.beatDecay = e.downbeat ? 1 / 0.14 : 1 / 0.2;
    });
    this.offShake = ctx.juice.on("eddieShake", (e) => {
      this.shake = Math.max(this.shake, e.magnitude);
    });
    this.offIntensity = ctx.juice.on("eddieIntensity", (e) => {
      this.morphTarget = Math.min(1, Math.max(0, e.value));
    });
  }

  // --- Build helpers -------------------------------------------------------

  /** Chunky low-res pixel texture via a tiny NearestFilter CanvasTexture. */
  private pixelTexture(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const c = cv.getContext("2d");
    if (!c) throw new Error("bg04: 2D context unavailable");
    c.imageSmoothingEnabled = false;
    draw(c);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    this.textures.push(tex);
    return tex;
  }

  private buildSky(): void {
    // Inward-facing gradient dome painted as a tall pixel strip.
    const tex = this.pixelTexture(2, 64, (c) => {
      const top = new THREE.Color(SKY_TOP);
      const mid = new THREE.Color(0x7a2a8f);
      const bot = new THREE.Color(SKY_BOT);
      for (let y = 0; y < 64; y++) {
        const f = y / 63;
        const col = f < 0.5 ? top.clone().lerp(mid, f * 2) : mid.clone().lerp(bot, (f - 0.5) * 2);
        c.fillStyle = `#${col.getHexString()}`;
        c.fillRect(0, 63 - y, 2, 1); // y=0 at texture bottom → top of sky
      }
    });
    const geo = new THREE.SphereGeometry(600, 24, 16);
    this.geometries.push(geo);
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false, fog: false });
    this.materials.push(mat);
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.frustumCulled = false;
    this.group.add(this.sky);

    // Banded vaporwave sun, far down the corridor (emissive → bloom-safe).
    const sunTex = this.pixelTexture(32, 32, (c) => {
      c.clearRect(0, 0, 32, 32);
      const cx = 16;
      const cy = 16;
      const r = 15;
      for (let y = 0; y < 32; y++) {
        const dy = y - cy;
        const half = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)));
        if (half <= 0) continue;
        if (dy > 0 && dy % 4 < 2) continue; // banding gaps in lower half
        const f = y / 31;
        const col = new THREE.Color(0xfff2a8).lerp(new THREE.Color(0xff5a8a), f);
        c.fillStyle = `#${col.getHexString()}`;
        c.fillRect(cx - half, y, half * 2, 1);
      }
    });
    const sunGeo = new THREE.PlaneGeometry(90, 90);
    this.geometries.push(sunGeo);
    this.sunMat = new THREE.MeshBasicMaterial({ map: sunTex, transparent: true, depthWrite: false, fog: false });
    this.materials.push(this.sunMat);
    this.sun = new THREE.Mesh(sunGeo, this.sunMat);
    this.sun.position.set(0, 40, CORRIDOR_FAR - 80);
    this.sun.frustumCulled = false;
    this.group.add(this.sun);
  }

  private buildFloor(): void {
    this.floorCanvas = document.createElement("canvas");
    this.floorCanvas.width = 64;
    this.floorCanvas.height = 64;
    const fctx = this.floorCanvas.getContext("2d");
    if (!fctx) throw new Error("bg04: 2D context unavailable");
    this.floorCtx = fctx;
    this.floorCtx.imageSmoothingEnabled = false;
    this.paintFloorTexture(0);

    this.floorTex = new THREE.CanvasTexture(this.floorCanvas);
    this.floorTex.colorSpace = THREE.SRGBColorSpace;
    this.floorTex.magFilter = THREE.NearestFilter;
    this.floorTex.minFilter = THREE.NearestFilter;
    this.floorTex.generateMipmaps = false;
    this.floorTex.wrapS = THREE.RepeatWrapping;
    this.floorTex.wrapT = THREE.RepeatWrapping;
    this.floorTex.repeat.set(24, 60);

    const geo = new THREE.PlaneGeometry(400, CORRIDOR_LEN + 160, 60, 90);
    this.geometries.push(geo);
    this.floorMat = new THREE.MeshBasicMaterial({ map: this.floorTex, fog: true });
    this.materials.push(this.floorMat);
    this.floor = new THREE.Mesh(geo, this.floorMat);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.set(0, 0, (CORRIDOR_NEAR + CORRIDOR_FAR) / 2);
    this.floor.frustumCulled = false;
    // Stash pristine vertex positions so the meltdown heave is reversible.
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    this.floorBase = Float32Array.from(pos.array as Float32Array);
    this.group.add(this.floor);
  }

  private paintFloorTexture(g: number): void {
    const c = this.floorCtx;
    const dark = "#1a0a33";
    const light = "#3a1466";
    c.fillStyle = dark;
    c.fillRect(0, 0, 64, 64);
    c.fillStyle = light;
    c.fillRect(0, 0, 32, 32);
    c.fillRect(32, 32, 32, 32);
    // Neon grid borders, brighter as corruption rises.
    c.fillStyle = g > 0.5 ? "#ff2bd6" : "#00f0ff";
    c.globalAlpha = 0.5 + g * 0.5;
    c.fillRect(0, 0, 64, 2);
    c.fillRect(0, 0, 2, 64);
    c.fillRect(0, 32, 64, 1);
    c.fillRect(32, 0, 1, 64);
    c.globalAlpha = 1;
    // Checker tear: punch displaced glitch blocks at high corruption.
    if (g > 0.3) {
      const n = Math.floor(g * 6);
      for (let i = 0; i < n; i++) {
        const bx = (Math.random() * 64) | 0;
        const by = (Math.random() * 64) | 0;
        const bw = 4 + ((Math.random() * 12) | 0);
        const bh = 2 + ((Math.random() * 6) | 0);
        const col = CORRUPT_HEX[(Math.random() * CORRUPT_HEX.length) | 0];
        c.fillStyle = `#${col.toString(16).padStart(6, "0")}`;
        c.globalAlpha = 0.4 + g * 0.5;
        c.fillRect(bx, by, bw, bh);
        c.globalAlpha = 1;
      }
    }
  }

  /** Marble/stone material with a chunky pixel speckle texture. */
  private stoneMaterial(tint: number): THREE.MeshBasicMaterial {
    const base = new THREE.Color(tint);
    const tex = this.pixelTexture(8, 8, (c) => {
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const v = (x * 7 + y * 13) % 5 === 0 ? 0.78 : 1;
          const col = base.clone().multiplyScalar(v);
          c.fillStyle = `#${col.getHexString()}`;
          c.fillRect(x, y, 1, 1);
        }
      }
    });
    const mat = new THREE.MeshBasicMaterial({ map: tex, fog: true });
    this.materials.push(mat);
    return mat;
  }

  /** Emissive neon material (bloom-safe accent). */
  private neonMaterial(hex: number): THREE.MeshBasicMaterial {
    const mat = new THREE.MeshBasicMaterial({ color: hex, fog: false });
    this.materials.push(mat);
    return mat;
  }

  private buildObjects(): void {
    const kinds: Kind[] = ["bust", "statue", "palm"];
    const spacing = 26;
    let i = 0;
    for (let z = CORRIDOR_NEAR - 10; z > CORRIDOR_FAR; z -= spacing) {
      const side = i % 2 === 0 ? -1 : 1;
      const kind = kinds[i % kinds.length];
      const obj = this.makeObject(kind, side);
      const x = side * (LANE_X + (Math.random() * 8 - 4));
      obj.root.position.set(x, 0, z);
      obj.root.rotation.y = side < 0 ? 0.4 : -0.4;
      this.objects.push(obj);
      this.group.add(obj.root);
      i++;
    }
  }

  private registerShatter(obj: PlazaObject, mesh: THREE.Mesh): void {
    const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const base = Float32Array.from(pos.array as Float32Array);
    const rand = new Float32Array(base.length);
    for (let k = 0; k < rand.length; k++) rand[k] = Math.random() - 0.5;
    mesh.frustumCulled = false;
    obj.shatter.push({ mesh, base, rand });
  }

  private makeObject(kind: Kind, side: number): PlazaObject {
    const root = new THREE.Group();
    const obj: PlazaObject = {
      root,
      kind,
      shatter: [],
      emissives: [],
      side,
      swaySeed: Math.random() * Math.PI * 2,
      dirty: false,
    };

    if (kind === "palm") {
      const trunkGeo = new THREE.CylinderGeometry(0.7, 1.1, 18, 6, 1);
      this.geometries.push(trunkGeo);
      const trunk = new THREE.Mesh(trunkGeo, this.stoneMaterial(0x6a4a2a));
      trunk.position.y = 9;
      this.registerShatter(obj, trunk);
      root.add(trunk);
      const frondMat = this.neonMaterial(0x2bd97a);
      obj.emissives.push(frondMat);
      for (let f = 0; f < 6; f++) {
        const frondGeo = new THREE.ConeGeometry(1.6, 10, 4, 1, true);
        this.geometries.push(frondGeo);
        const frond = new THREE.Mesh(frondGeo, frondMat);
        const a = (f / 6) * Math.PI * 2;
        frond.position.set(Math.cos(a) * 4, 18, Math.sin(a) * 4);
        frond.rotation.z = Math.PI / 2.6;
        frond.rotation.y = -a;
        this.registerShatter(obj, frond);
        root.add(frond);
      }
      return obj;
    }

    // Plinth shared by bust + statue.
    const plinthGeo = new THREE.BoxGeometry(6, 6, 6);
    this.geometries.push(plinthGeo);
    const plinth = new THREE.Mesh(plinthGeo, this.stoneMaterial(0x4a3f6a));
    plinth.position.y = 3;
    this.registerShatter(obj, plinth);
    root.add(plinth);

    if (kind === "bust") {
      const marble = this.stoneMaterial(0xe8e2ff);
      const headGeo = new THREE.IcosahedronGeometry(3.2, 1);
      this.geometries.push(headGeo);
      const head = new THREE.Mesh(headGeo, marble);
      head.position.y = 13;
      head.scale.set(0.85, 1.15, 0.85);
      this.registerShatter(obj, head);
      root.add(head);
      const shGeo = new THREE.BoxGeometry(7, 4, 4);
      this.geometries.push(shGeo);
      const sh = new THREE.Mesh(shGeo, marble);
      sh.position.y = 8.5;
      this.registerShatter(obj, sh);
      root.add(sh);
      const ringMat = this.neonMaterial(NEON_MAGENTA);
      obj.emissives.push(ringMat);
      const ringGeo = new THREE.TorusGeometry(4, 0.25, 6, 16);
      this.geometries.push(ringGeo);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 6.2;
      this.registerShatter(obj, ring);
      root.add(ring);
    } else {
      const marble = this.stoneMaterial(0xd9d2f0);
      const torsoGeo = new THREE.CylinderGeometry(1.6, 2.6, 14, 6, 3);
      this.geometries.push(torsoGeo);
      const torso = new THREE.Mesh(torsoGeo, marble);
      torso.position.y = 13;
      torso.rotation.y = 0.5;
      this.registerShatter(obj, torso);
      root.add(torso);
      const orbGeo = new THREE.OctahedronGeometry(2.4, 0);
      this.geometries.push(orbGeo);
      const orb = new THREE.Mesh(orbGeo, marble);
      orb.position.y = 22;
      this.registerShatter(obj, orb);
      root.add(orb);
      const spineMat = this.neonMaterial(NEON_CYAN);
      obj.emissives.push(spineMat);
      const spineGeo = new THREE.BoxGeometry(0.4, 14, 0.4);
      this.geometries.push(spineGeo);
      const spine = new THREE.Mesh(spineGeo, spineMat);
      spine.position.set(0, 13, 1.6);
      this.registerShatter(obj, spine);
      root.add(spine);
    }
    return obj;
  }

  // --- Per-frame -----------------------------------------------------------

  private corruption(): number {
    return Math.min(1, this.morph + this.beat * (0.2 + this.morph * 0.8));
  }

  update(dt: number, _audioTime: number): void {
    this.t += dt;
    this.morph += (this.morphTarget - this.morph) * dt * 1.5;
    if (this.beat > 0) this.beat = Math.max(0, this.beat - dt * this.beatDecay);
    const g = this.corruption();

    const speed = 16 + this.morph * 10;
    this.travel += dt * speed;

    // Recycle objects that pass behind the camera back to the far end.
    for (const o of this.objects) {
      o.root.position.z += dt * speed;
      if (o.root.position.z > CORRIDOR_NEAR + 8) {
        o.root.position.z -= CORRIDOR_LEN + 16;
        o.root.position.x = o.side * (LANE_X + (Math.random() * 8 - 4));
      }
    }

    this.animateObjects(dt, g);
    this.animateFloor(g);

    this.paintFloorTexture(g);
    this.floorTex.needsUpdate = true;

    this.sunMat.opacity = 0.85 + Math.sin(this.t) * 0.05;

    this.animateCamera(dt, g);
  }

  private animateObjects(dt: number, g: number): void {
    const explode = g * g; // ramp late so low morph stays serene
    const shudder = 1 + Math.sin(this.t * 30) * 0.4 * g;
    const amp = explode * 3.2 * shudder;
    for (const o of this.objects) {
      if (o.kind === "palm") {
        o.root.rotation.z = Math.sin(this.t * 0.8 + o.swaySeed) * (0.04 + g * 0.25);
      } else {
        o.root.rotation.y += dt * (0.05 + g * 0.6) * o.side;
      }

      // Vertex shatter: displace each vertex along its stable random direction.
      // Keep writing while displaced OR still settling so it eases back to rest.
      const wantShatter = amp > 0.001;
      if (wantShatter || o.dirty) {
        for (const s of o.shatter) {
          const pos = s.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
          const arr = pos.array as Float32Array;
          for (let k = 0; k < arr.length; k++) arr[k] = s.base[k] + s.rand[k] * amp;
          pos.needsUpdate = true;
        }
        o.dirty = wantShatter;
      }

      // Emissive corruption: recolor/strobe neon accents at high morph.
      for (const m of o.emissives) {
        if (g > 0.45) {
          const strobe = Math.sin(this.t * 26 + o.swaySeed) > 0 ? 1 : 0.4;
          const hex = CORRUPT_HEX[(Math.floor(this.t * (2 + g * 6)) + o.shatter.length) % CORRUPT_HEX.length];
          m.color.setHex(hex).multiplyScalar(strobe);
        }
      }
    }
  }

  private animateFloor(g: number): void {
    const geo = this.floor.geometry as THREE.PlaneGeometry;
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const amp = g * 4;
    for (let k = 0; k < arr.length; k += 3) {
      const bx = this.floorBase[k];
      const by = this.floorBase[k + 1];
      arr[k] = bx;
      arr[k + 1] = by;
      // index k+2 is the plane's local Z (world height after the -90° rotation).
      arr[k + 2] = this.floorBase[k + 2] + (amp > 0.001 ? Math.sin(this.t * 2 + bx * 0.08 + by * 0.05) * amp : 0);
    }
    pos.needsUpdate = true;
    this.floorMat.color.setScalar(1 + g * 0.35);
  }

  private animateCamera(dt: number, g: number): void {
    if (!this.camera) return;
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 6);

    // Gentle serpentine weave; amplitude steadies but erratic-jitter grows with
    // corruption + shake + a high-morph idle tremor.
    const weaveX = Math.sin(this.travel * 0.04) * 16 * (1 - g * 0.3);
    const weaveY = 10 + Math.sin(this.travel * 0.06) * 2.5;
    const erratic = g * 6 + this.beat * g * 8;
    const jolt = this.shake * 2;
    this.camera.position.set(
      weaveX + (Math.random() - 0.5) * (erratic + jolt),
      weaveY + (Math.random() - 0.5) * (erratic * 0.6 + jolt),
      CORRIDOR_NEAR - 6 + (Math.random() - 0.5) * (jolt + g * 2),
    );
    const lookX = Math.sin(this.travel * 0.04 + 0.6) * 10 * (1 - g * 0.4);
    this.camera.lookAt(lookX, 8, -80);
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

    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
    this.floorTex.dispose();
    this.geometries = [];
    this.materials = [];
    this.textures = [];
    this.objects = [];
    this.camera = null;
  }
}

const def: EddieBackgroundDef = {
  id: "bg04",
  label: "Vaporwave Plaza → Meltdown",
  blurb: "A real 3D vaporwave plaza — checkerboard floor, marble busts, statues, palms — that the camera serenely weaves through, datamoshing into a corrupted meltdown as intensity climbs.",
  create: () => new Bg04(),
};

export default def;
