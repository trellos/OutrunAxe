// bg04 — "Roman Garden → Glitch Meltdown" — a formal, endless Roman/Italian-villa
// garden the camera glides through on a smooth spline, that corrupts into a
// tasteful datamosh meltdown as performance intensity rises.
//
// Layout: a long central PATH (checkerboard marble) runs down -Z, flanked by
// symmetric garden "rooms": pairs of marble BUSTS and STATUES on plinths,
// COLUMNS, low HEDGES, and round FOUNTAINS with a little animated water spout.
// Everything is mirrored left/right for the formal Roman feel. The whole layout
// is laid in a band along -Z and recycled (room by room) behind→front, so the
// garden is endless. A soft magenta→cyan→peach vaporwave sky dome + a banded sun
// sit behind it, and the marble/checkerboard palette keeps the vaporwave vibe.
//
// CAMERA: glides along a CATMULL-ROM SPLINE through gentle waypoints that weave
// softly between the garden rooms — slow, graceful, eased. eddieShake is only a
// gentle nudge (small, decays), and there is NO high-frequency idle jitter, so
// the ride is smooth even at full meltdown.
//
// MORPH (eddieIntensity, eased — never snaps): calm formal garden at 0 → at high
// intensity the marble shatters (vertex displacement + shudder), the path checker
// tears, neon trim corrupts/strobes, and the fountains spray erratically. The
// camera path stays smooth throughout (meltdown is in the world, not the lens).
// Beat (eddieBeatPulse, downbeat stronger, scaled by morph): a one-shot burst.
// Shake (eddieShake): a small, smooth camera offset that decays.
//
// Visuals only (GDD §8). dispose() restores scene.background/fog, disposes every
// geometry/material/texture, and unsubscribes every listener. frustumCulled=false
// on the meltdown meshes so vertex-explode never clips out.

import * as THREE from "three";
import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";
import type { EddieBackgroundDef, EddieBackgroundVariant } from "./types";

// Vaporwave palette.
const SKY_TOP = 0x2a1150;
const SKY_BOT = 0xff7ab0;
const NEON_MAGENTA = 0xff2bd6;
const NEON_CYAN = 0x00f0ff;
const MARBLE = 0xe8e2ff;
const HEDGE = 0x2f6f4a;
const WATER = 0x9fe8ff;
const CORRUPT_HEX = [0xff2bd6, 0x00f0ff, 0xffd02b, 0xc7ff2b];

// Corridor of garden rooms along -Z.
const ROOM_SPACING = 46; // distance between consecutive garden rooms
const ROOM_COUNT = 9; // rooms alive at once
const CORRIDOR_NEAR = 24; // recycle a room once it passes behind this z
const CORRIDOR_LEN = ROOM_SPACING * ROOM_COUNT;
const PATH_HALF = 9; // half-width of the central path
const LANE_X = 24; // how far flanking objects sit from the centre

interface ShatterPart {
  mesh: THREE.Mesh;
  base: Float32Array;
  rand: Float32Array;
}

interface Fountain {
  spout: THREE.Points;
  spoutPos: Float32Array; // live positions
  vel: Float32Array; // per-particle velocity
  life: Float32Array; // per-particle remaining life
  origin: THREE.Vector3; // local nozzle position within the room
}

interface Room {
  root: THREE.Group;
  shatter: ShatterPart[];
  emissives: { mat: THREE.MeshBasicMaterial; seed: number }[];
  fountains: Fountain[];
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

  private path!: THREE.Mesh;
  private pathMat!: THREE.MeshBasicMaterial;
  private pathTex!: THREE.CanvasTexture;
  private pathBase!: Float32Array;
  private pathCanvas!: HTMLCanvasElement;
  private pathCtx!: CanvasRenderingContext2D;

  private sky!: THREE.Mesh;
  private sun!: THREE.Mesh;
  private sunMat!: THREE.MeshBasicMaterial;
  private rooms: Room[] = [];

  private offBeat?: () => void;
  private offShake?: () => void;
  private offIntensity?: () => void;

  private morph = 0;
  private morphTarget = 0;
  private beat = 0;
  private beatDecay = 6;
  private shake = 0;
  private shakeOffset = new THREE.Vector3(); // smoothed shake nudge
  private t = 0;
  private travel = 0; // forward distance along the path

  // Camera spline: a ring of gentle waypoints the camera glides through.
  private waypoints: THREE.Vector3[] = [];
  private readonly WP_SPACING = 30; // z-distance between waypoints
  private readonly WP_COUNT = 24; // total ring length (z span = SPACING*COUNT)

  mount(ctx: { scene: THREE.Scene; camera?: THREE.PerspectiveCamera; juice: EventBus<EddieJuiceEvents> }): void {
    this.scene = ctx.scene;
    this.prevBackground = ctx.scene.background;
    this.prevFog = ctx.scene.fog;
    ctx.scene.background = new THREE.Color(SKY_TOP);
    ctx.scene.fog = new THREE.Fog(0x3a1466, 140, 380);

    this.buildSky();
    this.buildPath();
    this.buildRooms();
    this.buildWaypoints();

    this.scene.add(this.group);

    if (ctx.camera) {
      this.camera = ctx.camera;
      this.positionCamera(0);
    }

    this.offBeat = ctx.juice.on("eddieBeatPulse", (e) => {
      this.beat = Math.max(this.beat, e.downbeat ? 1 : 0.55);
      this.beatDecay = e.downbeat ? 1 / 0.14 : 1 / 0.2;
    });
    this.offShake = ctx.juice.on("eddieShake", (e) => {
      // Gentle nudge only — clamp hard so scoring shake can never thrash the lens.
      this.shake = Math.min(1.2, Math.max(this.shake, e.magnitude * 0.35));
    });
    this.offIntensity = ctx.juice.on("eddieIntensity", (e) => {
      this.morphTarget = Math.min(1, Math.max(0, e.value));
    });
  }

  // --- Build helpers -------------------------------------------------------

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
    const tex = this.pixelTexture(2, 64, (c) => {
      const top = new THREE.Color(SKY_TOP);
      const mid = new THREE.Color(0x7a2a8f);
      const bot = new THREE.Color(SKY_BOT);
      for (let y = 0; y < 64; y++) {
        const f = y / 63;
        const col = f < 0.5 ? top.clone().lerp(mid, f * 2) : mid.clone().lerp(bot, (f - 0.5) * 2);
        c.fillStyle = `#${col.getHexString()}`;
        c.fillRect(0, 63 - y, 2, 1);
      }
    });
    const geo = new THREE.SphereGeometry(700, 24, 16);
    this.geometries.push(geo);
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false, fog: false });
    this.materials.push(mat);
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.frustumCulled = false;
    this.group.add(this.sky);

    const sunTex = this.pixelTexture(32, 32, (c) => {
      c.clearRect(0, 0, 32, 32);
      const cx = 16;
      const r = 15;
      for (let y = 0; y < 32; y++) {
        const dy = y - 16;
        const half = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)));
        if (half <= 0) continue;
        if (dy > 0 && dy % 4 < 2) continue;
        const col = new THREE.Color(0xfff2a8).lerp(new THREE.Color(0xff5a8a), y / 31);
        c.fillStyle = `#${col.getHexString()}`;
        c.fillRect(cx - half, y, half * 2, 1);
      }
    });
    const sunGeo = new THREE.PlaneGeometry(110, 110);
    this.geometries.push(sunGeo);
    this.sunMat = new THREE.MeshBasicMaterial({ map: sunTex, transparent: true, depthWrite: false, fog: false });
    this.materials.push(this.sunMat);
    this.sun = new THREE.Mesh(sunGeo, this.sunMat);
    this.sun.position.set(0, 48, -CORRIDOR_LEN - 120);
    this.sun.frustumCulled = false;
    this.group.add(this.sun);
  }

  private buildPath(): void {
    this.pathCanvas = document.createElement("canvas");
    this.pathCanvas.width = 64;
    this.pathCanvas.height = 64;
    const pctx = this.pathCanvas.getContext("2d");
    if (!pctx) throw new Error("bg04: 2D context unavailable");
    this.pathCtx = pctx;
    this.pathCtx.imageSmoothingEnabled = false;
    this.paintPathTexture(0);

    this.pathTex = new THREE.CanvasTexture(this.pathCanvas);
    this.pathTex.colorSpace = THREE.SRGBColorSpace;
    this.pathTex.magFilter = THREE.NearestFilter;
    this.pathTex.minFilter = THREE.NearestFilter;
    this.pathTex.generateMipmaps = false;
    this.pathTex.wrapS = THREE.RepeatWrapping;
    this.pathTex.wrapT = THREE.RepeatWrapping;
    this.pathTex.repeat.set(4, 48);

    const geo = new THREE.PlaneGeometry(PATH_HALF * 2 + 4, CORRIDOR_LEN + 200, 8, 120);
    this.geometries.push(geo);
    this.pathMat = new THREE.MeshBasicMaterial({ map: this.pathTex, fog: true });
    this.materials.push(this.pathMat);
    this.path = new THREE.Mesh(geo, this.pathMat);
    this.path.rotation.x = -Math.PI / 2;
    this.path.position.set(0, 0, -CORRIDOR_LEN / 2 + CORRIDOR_NEAR);
    this.path.frustumCulled = false;
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    this.pathBase = Float32Array.from(pos.array as Float32Array);
    this.group.add(this.path);

    // Lawn/ground plane under everything (flat, fog-tinted) so the world isn't void.
    const lawnGeo = new THREE.PlaneGeometry(400, CORRIDOR_LEN + 300);
    this.geometries.push(lawnGeo);
    const lawnMat = new THREE.MeshBasicMaterial({ color: 0x1c2a22, fog: true });
    this.materials.push(lawnMat);
    const lawn = new THREE.Mesh(lawnGeo, lawnMat);
    lawn.rotation.x = -Math.PI / 2;
    lawn.position.set(0, -0.2, -CORRIDOR_LEN / 2 + CORRIDOR_NEAR);
    lawn.frustumCulled = false;
    this.group.add(lawn);
  }

  private paintPathTexture(g: number): void {
    const c = this.pathCtx;
    const dark = "#d8d2ea";
    const light = "#b7aed6";
    c.fillStyle = dark;
    c.fillRect(0, 0, 64, 64);
    c.fillStyle = light;
    c.fillRect(0, 0, 32, 32);
    c.fillRect(32, 32, 32, 32);
    // Neon seam lines.
    c.fillStyle = g > 0.5 ? "#ff2bd6" : "#00f0ff";
    c.globalAlpha = 0.4 + g * 0.5;
    c.fillRect(0, 0, 64, 1);
    c.fillRect(0, 32, 64, 1);
    c.globalAlpha = 1;
    if (g > 0.3) {
      const n = Math.floor(g * 6);
      for (let i = 0; i < n; i++) {
        const col = CORRUPT_HEX[(Math.random() * CORRUPT_HEX.length) | 0];
        c.fillStyle = `#${col.toString(16).padStart(6, "0")}`;
        c.globalAlpha = 0.4 + g * 0.5;
        c.fillRect((Math.random() * 64) | 0, (Math.random() * 64) | 0, 4 + ((Math.random() * 12) | 0), 2 + ((Math.random() * 5) | 0));
        c.globalAlpha = 1;
      }
    }
  }

  private stoneMaterial(tint: number): THREE.MeshBasicMaterial {
    const base = new THREE.Color(tint);
    const tex = this.pixelTexture(8, 8, (c) => {
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const v = (x * 7 + y * 13) % 5 === 0 ? 0.8 : 1;
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

  private neonMaterial(hex: number): THREE.MeshBasicMaterial {
    const mat = new THREE.MeshBasicMaterial({ color: hex, fog: false });
    this.materials.push(mat);
    return mat;
  }

  private registerShatter(room: Room, mesh: THREE.Mesh): void {
    const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const base = Float32Array.from(pos.array as Float32Array);
    const rand = new Float32Array(base.length);
    for (let k = 0; k < rand.length; k++) rand[k] = Math.random() - 0.5;
    mesh.frustumCulled = false;
    room.shatter.push({ mesh, base, rand });
  }

  private buildRooms(): void {
    // Each room index gets a formal, mirrored feature set; rooms repeat by type.
    for (let i = 0; i < ROOM_COUNT; i++) {
      const room = this.makeRoom(i);
      room.root.position.z = CORRIDOR_NEAR - i * ROOM_SPACING;
      this.rooms.push(room);
      this.group.add(room.root);
    }
  }

  /** Build one symmetric garden room. Feature rotates by index for variety:
   *  busts | statues+fountain | columns+hedges. All mirrored left/right. */
  private makeRoom(index: number): Room {
    const root = new THREE.Group();
    const room: Room = { root, shatter: [], emissives: [], fountains: [], dirty: false };
    const feature = index % 3;

    // Low hedges line both sides of the path in every room (formal border).
    const hedgeMat = this.stoneMaterial(HEDGE);
    for (const side of [-1, 1]) {
      const hedgeGeo = new THREE.BoxGeometry(2, 3, ROOM_SPACING - 6);
      this.geometries.push(hedgeGeo);
      const hedge = new THREE.Mesh(hedgeGeo, hedgeMat);
      hedge.position.set(side * (PATH_HALF + 2), 1.5, 0);
      this.registerShatter(room, hedge);
      root.add(hedge);
    }

    if (feature === 0) {
      // Mirrored marble busts on plinths.
      for (const side of [-1, 1]) this.addBust(room, side * LANE_X);
    } else if (feature === 1) {
      // Central fountain + mirrored statues.
      this.addFountain(room, 0);
      for (const side of [-1, 1]) this.addStatue(room, side * LANE_X);
    } else {
      // Colonnade: mirrored columns marching down the room.
      for (const side of [-1, 1]) {
        for (let z = -ROOM_SPACING / 2 + 8; z < ROOM_SPACING / 2; z += 14) {
          this.addColumn(room, side * (LANE_X - 4), z);
        }
      }
    }
    return room;
  }

  private addPlinth(room: Room, x: number, z = 0): void {
    const geo = new THREE.BoxGeometry(6, 6, 6);
    this.geometries.push(geo);
    const m = new THREE.Mesh(geo, this.stoneMaterial(0x4a3f6a));
    m.position.set(x, 3, z);
    this.registerShatter(room, m);
    room.root.add(m);
  }

  private addBust(room: Room, x: number): void {
    this.addPlinth(room, x);
    const marble = this.stoneMaterial(MARBLE);
    const headGeo = new THREE.IcosahedronGeometry(3.2, 1);
    this.geometries.push(headGeo);
    const head = new THREE.Mesh(headGeo, marble);
    head.position.set(x, 13, 0);
    head.scale.set(0.85, 1.15, 0.85);
    this.registerShatter(room, head);
    room.root.add(head);
    const shGeo = new THREE.BoxGeometry(7, 4, 4);
    this.geometries.push(shGeo);
    const sh = new THREE.Mesh(shGeo, marble);
    sh.position.set(x, 8.5, 0);
    this.registerShatter(room, sh);
    room.root.add(sh);
    const ringMat = this.neonMaterial(NEON_MAGENTA);
    room.emissives.push({ mat: ringMat, seed: Math.random() * 6.28 });
    const ringGeo = new THREE.TorusGeometry(4, 0.25, 6, 16);
    this.geometries.push(ringGeo);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, 6.2, 0);
    this.registerShatter(room, ring);
    room.root.add(ring);
  }

  private addStatue(room: Room, x: number): void {
    this.addPlinth(room, x);
    const marble = this.stoneMaterial(0xd9d2f0);
    const torsoGeo = new THREE.CylinderGeometry(1.6, 2.6, 14, 6, 3);
    this.geometries.push(torsoGeo);
    const torso = new THREE.Mesh(torsoGeo, marble);
    torso.position.set(x, 13, 0);
    torso.rotation.y = 0.5;
    this.registerShatter(room, torso);
    room.root.add(torso);
    const orbGeo = new THREE.OctahedronGeometry(2.4, 0);
    this.geometries.push(orbGeo);
    const orb = new THREE.Mesh(orbGeo, marble);
    orb.position.set(x, 22, 0);
    this.registerShatter(room, orb);
    room.root.add(orb);
    const spineMat = this.neonMaterial(NEON_CYAN);
    room.emissives.push({ mat: spineMat, seed: Math.random() * 6.28 });
    const spineGeo = new THREE.BoxGeometry(0.4, 14, 0.4);
    this.geometries.push(spineGeo);
    const spine = new THREE.Mesh(spineGeo, spineMat);
    spine.position.set(x, 13, 1.6);
    this.registerShatter(room, spine);
    room.root.add(spine);
  }

  private addColumn(room: Room, x: number, z: number): void {
    const marble = this.stoneMaterial(MARBLE);
    // Base.
    const baseGeo = new THREE.BoxGeometry(4, 1.5, 4);
    this.geometries.push(baseGeo);
    const base = new THREE.Mesh(baseGeo, marble);
    base.position.set(x, 0.75, z);
    this.registerShatter(room, base);
    room.root.add(base);
    // Fluted shaft.
    const shaftGeo = new THREE.CylinderGeometry(1.3, 1.5, 18, 12, 2);
    this.geometries.push(shaftGeo);
    const shaft = new THREE.Mesh(shaftGeo, marble);
    shaft.position.set(x, 10.5, z);
    this.registerShatter(room, shaft);
    room.root.add(shaft);
    // Capital.
    const capGeo = new THREE.BoxGeometry(4, 1.5, 4);
    this.geometries.push(capGeo);
    const cap = new THREE.Mesh(capGeo, marble);
    cap.position.set(x, 20.2, z);
    this.registerShatter(room, cap);
    room.root.add(cap);
  }

  private addFountain(room: Room, x: number): void {
    const marble = this.stoneMaterial(0xcfc7e8);
    // Basin (torus rim + disc).
    const rimGeo = new THREE.TorusGeometry(6, 1, 8, 20);
    this.geometries.push(rimGeo);
    const rim = new THREE.Mesh(rimGeo, marble);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(x, 1.5, 0);
    this.registerShatter(room, rim);
    room.root.add(rim);
    // Pedestal.
    const pedGeo = new THREE.CylinderGeometry(1, 1.6, 5, 8);
    this.geometries.push(pedGeo);
    const ped = new THREE.Mesh(pedGeo, marble);
    ped.position.set(x, 3.5, 0);
    this.registerShatter(room, ped);
    room.root.add(ped);
    // Glowing water-pool disc (emissive, bloom-safe).
    const poolMat = this.neonMaterial(0x2a6f8f);
    room.emissives.push({ mat: poolMat, seed: Math.random() * 6.28 });
    const poolGeo = new THREE.CircleGeometry(5.6, 20);
    this.geometries.push(poolGeo);
    const pool = new THREE.Mesh(poolGeo, poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(x, 1.2, 0);
    pool.frustumCulled = false;
    room.root.add(pool);

    // Animated water spout: a small THREE.Points fountain.
    const N = 70;
    const positions = new Float32Array(N * 3);
    const vel = new Float32Array(N * 3);
    const life = new Float32Array(N);
    const origin = new THREE.Vector3(x, 6, 0);
    for (let i = 0; i < N; i++) this.seedDroplet(positions, vel, life, i, origin, 0);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.geometries.push(geo);
    const mat = new THREE.PointsMaterial({
      color: WATER,
      size: 0.8,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.materials.push(mat);
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    room.root.add(pts);
    room.fountains.push({ spout: pts, spoutPos: positions, vel, life, origin });
  }

  private seedDroplet(
    pos: Float32Array,
    vel: Float32Array,
    life: Float32Array,
    i: number,
    origin: THREE.Vector3,
    spread: number,
  ): void {
    const a = Math.random() * Math.PI * 2;
    const out = (0.3 + Math.random() * 0.7) * (1 + spread * 3);
    pos[i * 3] = origin.x;
    pos[i * 3 + 1] = origin.y;
    pos[i * 3 + 2] = origin.z;
    vel[i * 3] = Math.cos(a) * out;
    vel[i * 3 + 1] = 7 + Math.random() * 3; // upward
    vel[i * 3 + 2] = Math.sin(a) * out;
    life[i] = 0.6 + Math.random() * 0.6;
  }

  private buildWaypoints(): void {
    // A ring of gentle waypoints down the path centre with a soft serpentine
    // sway. The camera advances along this ring with Catmull-Rom interpolation;
    // because z is taken modulo the ring length, the journey loops endlessly.
    for (let i = 0; i < this.WP_COUNT; i++) {
      const sway = Math.sin(i * 0.5) * (PATH_HALF - 3);
      this.waypoints.push(new THREE.Vector3(sway, 9 + Math.sin(i * 0.33) * 1.5, 0));
    }
  }

  // --- Per-frame -----------------------------------------------------------

  private corruption(): number {
    return Math.min(1, this.morph + this.beat * (0.2 + this.morph * 0.8));
  }

  /** Catmull-Rom between waypoint ring samples, with the path's forward z folded
   *  in so the camera always advances down -Z while swaying smoothly. */
  private positionCamera(travel: number): void {
    if (!this.camera) return;
    const ringLen = this.WP_SPACING * this.WP_COUNT;
    const u = ((travel % ringLen) + ringLen) % ringLen; // 0..ringLen
    const seg = u / this.WP_SPACING; // float segment index
    const i1 = Math.floor(seg) % this.WP_COUNT;
    const f = seg - Math.floor(seg);
    const i0 = (i1 - 1 + this.WP_COUNT) % this.WP_COUNT;
    const i2 = (i1 + 1) % this.WP_COUNT;
    const i3 = (i1 + 2) % this.WP_COUNT;
    // Catmull-Rom for the lateral (x) + height (y) sway only; z is the smooth
    // forward march so the world scrolls toward the camera (objects move, camera
    // holds near z so recycling stays simple).
    const x = catmull(this.waypoints[i0].x, this.waypoints[i1].x, this.waypoints[i2].x, this.waypoints[i3].x, f);
    const y = catmull(this.waypoints[i0].y, this.waypoints[i1].y, this.waypoints[i2].y, this.waypoints[i3].y, f);

    this.camera.position.set(
      x + this.shakeOffset.x,
      y + this.shakeOffset.y,
      CORRIDOR_NEAR - 2 + this.shakeOffset.z,
    );
    // Smooth look-ahead target a little down the path, swaying with the next WP.
    const ax = catmull(
      this.waypoints[i1].x,
      this.waypoints[i2].x,
      this.waypoints[i3].x,
      this.waypoints[(i3 + 1) % this.WP_COUNT].x,
      f,
    );
    this.camera.lookAt(ax * 0.5, 8, -90);
  }

  update(dt: number, _audioTime: number): void {
    this.t += dt;
    this.morph += (this.morphTarget - this.morph) * dt * 1.5;
    if (this.beat > 0) this.beat = Math.max(0, this.beat - dt * this.beatDecay);
    const g = this.corruption();

    // Gentle, steady forward glide. Speed barely lifts with morph so the ride
    // stays graceful even during meltdown.
    const speed = 13 + this.morph * 4;
    this.travel += dt * speed;

    // Scroll the world toward the camera; recycle rooms behind→front.
    for (const room of this.rooms) {
      room.root.position.z += dt * speed;
      if (room.root.position.z > CORRIDOR_NEAR + ROOM_SPACING * 0.5) {
        room.root.position.z -= CORRIDOR_LEN;
      }
    }

    this.animateRooms(dt, g);
    this.animatePath(g);

    this.paintPathTexture(g);
    this.pathTex.needsUpdate = true;
    this.sunMat.opacity = 0.85 + Math.sin(this.t) * 0.05;

    // Smooth shake: decay magnitude, and ease a small offset toward a slow target
    // (no per-frame random thrash — a gentle drift nudge only).
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 3);
    const targetOff = this.shake * 1.6;
    const sx = Math.sin(this.t * 6.1) * targetOff;
    const sy = Math.cos(this.t * 5.3) * targetOff * 0.7;
    this.shakeOffset.x += (sx - this.shakeOffset.x) * Math.min(1, dt * 6);
    this.shakeOffset.y += (sy - this.shakeOffset.y) * Math.min(1, dt * 6);
    this.shakeOffset.z += (0 - this.shakeOffset.z) * Math.min(1, dt * 6);

    this.positionCamera(this.travel);
  }

  private animateRooms(dt: number, g: number): void {
    const explode = g * g;
    const shudder = 1 + Math.sin(this.t * 26) * 0.4 * g;
    const amp = explode * 3.0 * shudder;
    for (const room of this.rooms) {
      const wantShatter = amp > 0.001;
      if (wantShatter || room.dirty) {
        for (const s of room.shatter) {
          const pos = s.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
          const arr = pos.array as Float32Array;
          for (let k = 0; k < arr.length; k++) arr[k] = s.base[k] + s.rand[k] * amp;
          pos.needsUpdate = true;
        }
        room.dirty = wantShatter;
      }

      for (const e of room.emissives) {
        if (g > 0.45) {
          const strobe = Math.sin(this.t * 22 + e.seed) > 0 ? 1 : 0.45;
          const hex = CORRUPT_HEX[(Math.floor(this.t * (2 + g * 6) + e.seed) % CORRUPT_HEX.length + CORRUPT_HEX.length) % CORRUPT_HEX.length];
          e.mat.color.setHex(hex).multiplyScalar(strobe);
        }
      }

      this.animateFountains(room, dt, g);
    }
  }

  private animateFountains(room: Room, dt: number, g: number): void {
    for (const f of room.fountains) {
      const pos = f.spoutPos;
      const vel = f.vel;
      const life = f.life;
      const n = life.length;
      // Erratic spray at high corruption: extra outward kick + gravity wobble.
      const spread = g;
      for (let i = 0; i < n; i++) {
        life[i] -= dt;
        if (life[i] <= 0) {
          this.seedDroplet(pos, vel, life, i, f.origin, spread);
          continue;
        }
        vel[i * 3 + 1] -= 18 * dt; // gravity
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        // Reset droplets that fall back into the basin.
        if (pos[i * 3 + 1] < f.origin.y - 5) this.seedDroplet(pos, vel, life, i, f.origin, spread);
      }
      (f.spout.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      const mat = f.spout.material as THREE.PointsMaterial;
      mat.opacity = 0.85;
      mat.color.setHex(g > 0.6 ? CORRUPT_HEX[(Math.floor(this.t * 8)) % CORRUPT_HEX.length] : WATER);
    }
  }

  private animatePath(g: number): void {
    const geo = this.path.geometry as THREE.PlaneGeometry;
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const amp = g * 3;
    for (let k = 0; k < arr.length; k += 3) {
      const bx = this.pathBase[k];
      const by = this.pathBase[k + 1];
      arr[k] = bx;
      arr[k + 1] = by;
      arr[k + 2] = this.pathBase[k + 2] + (amp > 0.001 ? Math.sin(this.t * 2 + bx * 0.1 + by * 0.05) * amp : 0);
    }
    pos.needsUpdate = true;
    this.pathMat.color.setScalar(1 + g * 0.3);
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
    this.pathTex.dispose();
    this.geometries = [];
    this.materials = [];
    this.textures = [];
    this.rooms = [];
    this.waypoints = [];
    this.camera = null;
  }
}

/** Centripetal-ish Catmull-Rom scalar interpolation (uniform). */
function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

const def: EddieBackgroundDef = {
  id: "bg04",
  label: "Roman Garden → Meltdown",
  blurb: "A formal endless Roman villa garden — marble busts, statues, columns, hedges and fountains along a checkerboard path — that the camera glides through on a smooth spline before it tastefully datamoshes at high intensity.",
  create: () => new Bg04(),
};

export default def;
