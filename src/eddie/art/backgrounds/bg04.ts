// bg04 — "Roman Garden → Glitch Meltdown" — a formal Roman/Italian-villa garden
// whose path WINDS through the grounds, with the camera STEERING along the curve,
// that corrupts into a tasteful datamosh meltdown as performance intensity rises.
//
// The garden is laid along a closed, WINDING Catmull-Rom curve (gentle left/right
// bends) in the world XZ plane. The camera travels along this curve and turns to
// FOLLOW it — looking down the path ahead, so it actually steers through the
// bends rather than sliding down a straight corridor. Because the curve is a
// closed loop, the journey is endless with no per-object recycling.
//
// Along the curve sit formal, mirrored garden ROOMS — marble BUSTS and STATUES on
// plinths, COLONNADES of fluted COLUMNS, low HEDGES lining the path, and round
// FOUNTAINS with a little animated water spout. Each room is oriented to the
// path's tangent and its features flank the path left/right (along the curve
// normal). A checkerboard MARBLE path ribbon follows the curve; a vaporwave sky
// dome + banded sun sit behind it, keeping the marble/checkerboard palette.
//
// CAMERA: glides along the curve with smooth arc-length easing — slow, graceful.
// eddieShake is only a small, smoothed nudge (no high-frequency jitter), so the
// ride stays comfortable even at full meltdown.
//
// MORPH (eddieIntensity, eased — never snaps): calm formal garden at 0 → at high
// intensity the marble shatters (vertex displacement + shudder), the path checker
// tears, neon trim corrupts/strobes, and the fountains spray erratically. The
// camera path stays smooth throughout.
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

const PATH_HALF = 9; // half-width of the path ribbon
const LANE_X = 22; // how far flanking objects sit from the path centre (along normal)
const ROOM_COUNT = 12; // garden rooms spaced evenly along the winding loop
const CAM_LOOK_AHEAD = 0.012; // fraction of the loop the camera looks ahead (steering)

interface ShatterPart {
  mesh: THREE.Mesh;
  base: Float32Array;
  rand: Float32Array;
}

interface Fountain {
  spout: THREE.Points;
  spoutPos: Float32Array;
  vel: Float32Array;
  life: Float32Array;
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

  private curve!: THREE.CatmullRomCurve3; // the winding garden path (closed loop)
  private path!: THREE.Mesh; // checkerboard ribbon following the curve
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
  private shakeOffset = new THREE.Vector3();
  private t = 0;
  private progress = 0; // 0..1 position along the loop

  // Scratch vectors reused per frame (no per-frame allocation).
  private vPos = new THREE.Vector3();
  private vLook = new THREE.Vector3();
  private vUp = new THREE.Vector3(0, 1, 0);

  mount(ctx: { scene: THREE.Scene; camera?: THREE.PerspectiveCamera; juice: EventBus<EddieJuiceEvents> }): void {
    this.scene = ctx.scene;
    this.prevBackground = ctx.scene.background;
    this.prevFog = ctx.scene.fog;
    ctx.scene.background = new THREE.Color(SKY_TOP);
    ctx.scene.fog = new THREE.Fog(0x3a1466, 120, 360);

    this.buildCurve();
    this.buildSky();
    this.buildPath();
    this.buildRooms();

    this.scene.add(this.group);

    if (ctx.camera) {
      this.camera = ctx.camera;
      this.positionCamera();
    }

    this.offBeat = ctx.juice.on("eddieBeatPulse", (e) => {
      this.beat = Math.max(this.beat, e.downbeat ? 1 : 0.55);
      this.beatDecay = e.downbeat ? 1 / 0.14 : 1 / 0.2;
    });
    this.offShake = ctx.juice.on("eddieShake", (e) => {
      this.shake = Math.min(1.2, Math.max(this.shake, e.magnitude * 0.35));
    });
    this.offIntensity = ctx.juice.on("eddieIntensity", (e) => {
      this.morphTarget = Math.min(1, Math.max(0, e.value));
    });
  }

  // --- Curve ---------------------------------------------------------------

  private buildCurve(): void {
    // A closed, winding loop of waypoints in world XZ (y≈0 ground plane). Gentle
    // left/right bends give the meandering garden-path feel; closed → endless.
    const pts = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(36, 0, -64),
      new THREE.Vector3(18, 0, -148),
      new THREE.Vector3(-44, 0, -196),
      new THREE.Vector3(-96, 0, -150),
      new THREE.Vector3(-80, 0, -60),
      new THREE.Vector3(-118, 0, 26),
      new THREE.Vector3(-70, 0, 96),
      new THREE.Vector3(20, 0, 104),
      new THREE.Vector3(74, 0, 52),
    ];
    this.curve = new THREE.CatmullRomCurve3(pts, true, "catmullrom", 0.5);
  }

  /** World position on the path centre at loop fraction u (0..1). */
  private curvePoint(u: number, out: THREE.Vector3): THREE.Vector3 {
    return this.curve.getPointAt(((u % 1) + 1) % 1, out);
  }

  /** Unit tangent (forward along the path) at loop fraction u. */
  private curveTangent(u: number, out: THREE.Vector3): THREE.Vector3 {
    return this.curve.getTangentAt(((u % 1) + 1) % 1, out);
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
    const sunGeo = new THREE.PlaneGeometry(120, 120);
    this.geometries.push(sunGeo);
    this.sunMat = new THREE.MeshBasicMaterial({ map: sunTex, transparent: true, depthWrite: false, fog: false });
    this.materials.push(this.sunMat);
    this.sun = new THREE.Mesh(sunGeo, this.sunMat);
    // The sun sits high + far; it billboards toward the camera each frame.
    this.sun.position.set(0, 60, -300);
    this.sun.frustumCulled = false;
    this.group.add(this.sun);

    // Ground lawn so the world isn't void under the garden.
    const lawnGeo = new THREE.PlaneGeometry(700, 700);
    this.geometries.push(lawnGeo);
    const lawnMat = new THREE.MeshBasicMaterial({ color: 0x1c2a22, fog: true });
    this.materials.push(lawnMat);
    const lawn = new THREE.Mesh(lawnGeo, lawnMat);
    lawn.rotation.x = -Math.PI / 2;
    lawn.position.y = -0.25;
    lawn.frustumCulled = false;
    this.group.add(lawn);
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

    // Build the path ribbon by sampling the curve and laying a quad strip along
    // it (offset ±PATH_HALF along the per-sample normal). One BufferGeometry.
    const SEG = 600;
    const positions = new Float32Array((SEG + 1) * 2 * 3);
    const uvs = new Float32Array((SEG + 1) * 2 * 2);
    const indices: number[] = [];
    const p = new THREE.Vector3();
    const tan = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    let totalLen = 0;
    const prev = new THREE.Vector3();
    for (let i = 0; i <= SEG; i++) {
      const u = i / SEG;
      this.curvePoint(u, p);
      this.curveTangent(u, tan);
      // Horizontal normal (perpendicular to tangent in XZ).
      nrm.set(-tan.z, 0, tan.x).normalize();
      if (i > 0) totalLen += p.distanceTo(prev);
      prev.copy(p);
      const li = i * 2;
      positions[li * 3] = p.x + nrm.x * PATH_HALF;
      positions[li * 3 + 1] = 0.02;
      positions[li * 3 + 2] = p.z + nrm.z * PATH_HALF;
      positions[(li + 1) * 3] = p.x - nrm.x * PATH_HALF;
      positions[(li + 1) * 3 + 1] = 0.02;
      positions[(li + 1) * 3 + 2] = p.z - nrm.z * PATH_HALF;
      const v = totalLen / 14; // repeat checker roughly every 14 world units
      uvs[li * 2] = 0;
      uvs[li * 2 + 1] = v;
      uvs[(li + 1) * 2] = 1;
      uvs[(li + 1) * 2 + 1] = v;
      if (i < SEG) {
        const a = li;
        const b = li + 1;
        const c = li + 2;
        const d = li + 3;
        indices.push(a, b, c, b, d, c);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    this.geometries.push(geo);
    this.pathMat = new THREE.MeshBasicMaterial({ map: this.pathTex, fog: true, side: THREE.DoubleSide });
    this.materials.push(this.pathMat);
    this.path = new THREE.Mesh(geo, this.pathMat);
    this.path.frustumCulled = false;
    this.pathBase = Float32Array.from(positions);
    this.group.add(this.path);
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
    // Place rooms evenly along the loop; each is positioned at its curve point
    // and rotated so its local -Z faces along the path tangent. Features flank
    // the path left/right (room-local X = curve normal).
    const p = new THREE.Vector3();
    const tan = new THREE.Vector3();
    for (let i = 0; i < ROOM_COUNT; i++) {
      const u = i / ROOM_COUNT;
      const room = this.makeRoom(i);
      this.curvePoint(u, p);
      this.curveTangent(u, tan);
      room.root.position.copy(p);
      // Yaw so local -Z aligns with the tangent direction.
      room.root.rotation.y = Math.atan2(tan.x, tan.z);
      this.rooms.push(room);
      this.group.add(room.root);
    }
  }

  /** Build one symmetric garden room (local space: path runs along ±Z, features
   *  flank along ±X). Feature rotates by index. */
  private makeRoom(index: number): Room {
    const root = new THREE.Group();
    const room: Room = { root, shatter: [], emissives: [], fountains: [], dirty: false };
    const feature = index % 4;

    // Low hedges line both sides of the path.
    const hedgeMat = this.stoneMaterial(HEDGE);
    for (const side of [-1, 1]) {
      const hedgeGeo = new THREE.BoxGeometry(2, 3, 28);
      this.geometries.push(hedgeGeo);
      const hedge = new THREE.Mesh(hedgeGeo, hedgeMat);
      hedge.position.set(side * (PATH_HALF + 2), 1.5, 0);
      this.registerShatter(room, hedge);
      root.add(hedge);
    }

    if (feature === 0) {
      for (const side of [-1, 1]) this.addBust(room, side * LANE_X);
    } else if (feature === 1) {
      this.addFountain(room, 0);
      for (const side of [-1, 1]) this.addStatue(room, side * LANE_X);
    } else if (feature === 2) {
      for (const side of [-1, 1]) {
        for (let z = -12; z <= 12; z += 12) this.addColumn(room, side * (LANE_X - 4), z);
      }
    } else {
      // Venus Genetrix centerpiece, flanked by a pair of columns framing her.
      this.addVenus(room, 0);
      for (const side of [-1, 1]) this.addColumn(room, side * LANE_X, -10);
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

  /** Venus Genetrix — the classical draped-Venus type: a standing female figure
   *  in clinging drapery, weight on one leg (contrapposto), one arm raised, one
   *  shoulder/breast bared. Low-poly/pixely marble on a plinth with a neon ring,
   *  matching the other statues. Built in the room's local space (faces +Z toward
   *  the path) with a slight contrapposto lean. */
  private addVenus(room: Room, x: number): void {
    this.addPlinth(room, x);
    const marble = this.stoneMaterial(MARBLE);
    const drape = this.stoneMaterial(0xdad3f2); // faintly distinct drapery marble

    // A small subgroup so the whole figure can carry the contrapposto S-curve.
    const fig = new THREE.Group();
    fig.position.set(x, 6, 0); // sit on top of the 6-tall plinth
    fig.rotation.y = Math.PI; // face the path (+Z in room space)
    room.root.add(fig);

    // Weight leg (straight, supporting) — slightly toward +X.
    const legW = new THREE.CylinderGeometry(1.0, 1.2, 8, 6, 1);
    this.geometries.push(legW);
    const weightLeg = new THREE.Mesh(legW, drape);
    weightLeg.position.set(1.1, 4, 0);
    this.registerShatter(room, weightLeg);
    fig.add(weightLeg);

    // Free leg (relaxed, knee pushed forward + outward) — gives contrapposto.
    const legF = new THREE.CylinderGeometry(0.9, 1.1, 7.5, 6, 1);
    this.geometries.push(legF);
    const freeLeg = new THREE.Mesh(legF, drape);
    freeLeg.position.set(-1.3, 3.9, 0.7);
    freeLeg.rotation.x = 0.18;
    freeLeg.rotation.z = 0.12;
    this.registerShatter(room, freeLeg);
    fig.add(freeLeg);

    // Clinging drapery skirt: tapered, slightly fluted lower body over the legs,
    // tilted so the hip swings over the weight leg (the Venus S-curve).
    const skirtGeo = new THREE.CylinderGeometry(2.0, 3.0, 9, 8, 2);
    this.geometries.push(skirtGeo);
    const skirt = new THREE.Mesh(skirtGeo, drape);
    skirt.position.set(0.4, 9, 0);
    skirt.rotation.z = -0.08; // hip shifts toward the weight leg
    this.registerShatter(room, skirt);
    fig.add(skirt);

    // Torso: tilts the opposite way to the hips (counter-balance of contrapposto).
    const torsoGeo = new THREE.CylinderGeometry(1.5, 2.0, 7, 8, 1);
    this.geometries.push(torsoGeo);
    const torso = new THREE.Mesh(torsoGeo, marble);
    torso.position.set(0.0, 15.5, 0);
    torso.rotation.z = 0.1;
    this.registerShatter(room, torso);
    fig.add(torso);

    // Drapery strap across one shoulder, leaving the other shoulder/breast bared
    // — a thin angled box from the left hip up over the right shoulder.
    const strapGeo = new THREE.BoxGeometry(0.7, 9, 0.7);
    this.geometries.push(strapGeo);
    const strap = new THREE.Mesh(strapGeo, drape);
    strap.position.set(-0.4, 15.5, 1.4);
    strap.rotation.z = -0.5;
    this.registerShatter(room, strap);
    fig.add(strap);

    // Bared shoulder/breast accent: a small marble sphere proud of the torso on
    // the uncovered side, so the figure reads as the half-draped Venus.
    const breastGeo = new THREE.IcosahedronGeometry(0.9, 0);
    this.geometries.push(breastGeo);
    const breast = new THREE.Mesh(breastGeo, marble);
    breast.position.set(1.2, 16.5, 1.4);
    this.registerShatter(room, breast);
    fig.add(breast);

    // Neck + head.
    const neckGeo = new THREE.CylinderGeometry(0.5, 0.7, 1.6, 6);
    this.geometries.push(neckGeo);
    const neck = new THREE.Mesh(neckGeo, marble);
    neck.position.set(-0.1, 19.6, 0);
    this.registerShatter(room, neck);
    fig.add(neck);
    const headGeo = new THREE.IcosahedronGeometry(1.7, 1);
    this.geometries.push(headGeo);
    const head = new THREE.Mesh(headGeo, marble);
    head.position.set(-0.2, 21.4, 0);
    head.scale.set(0.85, 1.05, 0.85);
    head.rotation.y = 0.3; // gaze turned slightly, as the type often is
    this.registerShatter(room, head);
    fig.add(head);

    // Raised arm (upper + fore-arm), lifted to the side as in the Venus Genetrix
    // gesture; the other arm rests lower across the body.
    const upArmGeo = new THREE.CylinderGeometry(0.5, 0.6, 4.5, 6);
    this.geometries.push(upArmGeo);
    const upperArm = new THREE.Mesh(upArmGeo, marble);
    upperArm.position.set(-2.2, 17.8, 0);
    upperArm.rotation.z = 0.9; // lifts outward/up
    this.registerShatter(room, upperArm);
    fig.add(upperArm);
    const foreArmGeo = new THREE.CylinderGeometry(0.4, 0.5, 4, 6);
    this.geometries.push(foreArmGeo);
    const foreArm = new THREE.Mesh(foreArmGeo, marble);
    foreArm.position.set(-3.6, 20.4, 0.2);
    foreArm.rotation.z = 0.35;
    this.registerShatter(room, foreArm);
    fig.add(foreArm);

    // Resting arm across the lower torso (holds the drape).
    const restArmGeo = new THREE.CylinderGeometry(0.5, 0.55, 5, 6);
    this.geometries.push(restArmGeo);
    const restArm = new THREE.Mesh(restArmGeo, drape);
    restArm.position.set(1.8, 14.5, 1.0);
    restArm.rotation.z = -0.5;
    restArm.rotation.x = 0.3;
    this.registerShatter(room, restArm);
    fig.add(restArm);

    // Neon accent ring on the plinth, like the other statues.
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

  private addColumn(room: Room, x: number, z: number): void {
    const marble = this.stoneMaterial(MARBLE);
    const baseGeo = new THREE.BoxGeometry(4, 1.5, 4);
    this.geometries.push(baseGeo);
    const base = new THREE.Mesh(baseGeo, marble);
    base.position.set(x, 0.75, z);
    this.registerShatter(room, base);
    room.root.add(base);
    const shaftGeo = new THREE.CylinderGeometry(1.3, 1.5, 18, 12, 2);
    this.geometries.push(shaftGeo);
    const shaft = new THREE.Mesh(shaftGeo, marble);
    shaft.position.set(x, 10.5, z);
    this.registerShatter(room, shaft);
    room.root.add(shaft);
    const capGeo = new THREE.BoxGeometry(4, 1.5, 4);
    this.geometries.push(capGeo);
    const cap = new THREE.Mesh(capGeo, marble);
    cap.position.set(x, 20.2, z);
    this.registerShatter(room, cap);
    room.root.add(cap);
  }

  private addFountain(room: Room, x: number): void {
    const marble = this.stoneMaterial(0xcfc7e8);
    const rimGeo = new THREE.TorusGeometry(6, 1, 8, 20);
    this.geometries.push(rimGeo);
    const rim = new THREE.Mesh(rimGeo, marble);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(x, 1.5, 0);
    this.registerShatter(room, rim);
    room.root.add(rim);
    const pedGeo = new THREE.CylinderGeometry(1, 1.6, 5, 8);
    this.geometries.push(pedGeo);
    const ped = new THREE.Mesh(pedGeo, marble);
    ped.position.set(x, 3.5, 0);
    this.registerShatter(room, ped);
    room.root.add(ped);
    const poolMat = this.neonMaterial(0x2a6f8f);
    room.emissives.push({ mat: poolMat, seed: Math.random() * 6.28 });
    const poolGeo = new THREE.CircleGeometry(5.6, 20);
    this.geometries.push(poolGeo);
    const pool = new THREE.Mesh(poolGeo, poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(x, 1.2, 0);
    pool.frustumCulled = false;
    room.root.add(pool);

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
    vel[i * 3 + 1] = 7 + Math.random() * 3;
    vel[i * 3 + 2] = Math.sin(a) * out;
    life[i] = 0.6 + Math.random() * 0.6;
  }

  // --- Per-frame -----------------------------------------------------------

  private corruption(): number {
    return Math.min(1, this.morph + this.beat * (0.2 + this.morph * 0.8));
  }

  /** Place + steer the camera along the winding curve at the current progress. */
  private positionCamera(): void {
    if (!this.camera) return;
    this.curvePoint(this.progress, this.vPos);
    // Eye height above the path + the smoothed shake nudge.
    this.camera.position.set(
      this.vPos.x + this.shakeOffset.x,
      this.vPos.y + 8 + this.shakeOffset.y,
      this.vPos.z + this.shakeOffset.z,
    );
    // Look ahead down the path so the camera turns to FOLLOW the bends.
    this.curvePoint(this.progress + CAM_LOOK_AHEAD, this.vLook);
    this.vLook.y += 6;
    this.camera.up.copy(this.vUp);
    this.camera.lookAt(this.vLook);

    // Billboard the sun to sit behind the look direction (kept high + distant).
    const ahead = this.vLook.clone().sub(this.camera.position).setY(0).normalize();
    this.sun.position.set(
      this.camera.position.x + ahead.x * 280,
      62,
      this.camera.position.z + ahead.z * 280,
    );
    this.sun.lookAt(this.camera.position.x, 62, this.camera.position.z);
  }

  update(dt: number, _audioTime: number): void {
    this.t += dt;
    this.morph += (this.morphTarget - this.morph) * dt * 1.5;
    if (this.beat > 0) this.beat = Math.max(0, this.beat - dt * this.beatDecay);
    const g = this.corruption();

    // Advance smoothly along the loop. Curve length is large; tune so the glide
    // is gentle. Speed barely lifts with morph so the ride stays graceful.
    const loopLen = this.curve.getLength();
    const worldSpeed = 13 + this.morph * 4; // world units / sec
    this.progress = (this.progress + (dt * worldSpeed) / loopLen) % 1;

    this.animateRooms(dt, g);
    this.animatePath(g);

    this.paintPathTexture(g);
    this.pathTex.needsUpdate = true;
    this.sunMat.opacity = 0.85 + Math.sin(this.t) * 0.05;

    // Smooth shake: decay magnitude; ease a small sinusoidal offset (no thrash).
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 3);
    const targetOff = this.shake * 1.6;
    const sx = Math.sin(this.t * 6.1) * targetOff;
    const sy = Math.cos(this.t * 5.3) * targetOff * 0.7;
    const k = Math.min(1, dt * 6);
    this.shakeOffset.x += (sx - this.shakeOffset.x) * k;
    this.shakeOffset.y += (sy - this.shakeOffset.y) * k;
    this.shakeOffset.z += (0 - this.shakeOffset.z) * k;

    this.positionCamera();
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
          for (let kk = 0; kk < arr.length; kk++) arr[kk] = s.base[kk] + s.rand[kk] * amp;
          pos.needsUpdate = true;
        }
        room.dirty = wantShatter;
      }

      for (const e of room.emissives) {
        if (g > 0.45) {
          const strobe = Math.sin(this.t * 22 + e.seed) > 0 ? 1 : 0.45;
          const idx = ((Math.floor(this.t * (2 + g * 6) + e.seed) % CORRUPT_HEX.length) + CORRUPT_HEX.length) % CORRUPT_HEX.length;
          e.mat.color.setHex(CORRUPT_HEX[idx]).multiplyScalar(strobe);
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
      const spread = g;
      for (let i = 0; i < n; i++) {
        life[i] -= dt;
        if (life[i] <= 0) {
          this.seedDroplet(pos, vel, life, i, f.origin, spread);
          continue;
        }
        vel[i * 3 + 1] -= 18 * dt;
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        if (pos[i * 3 + 1] < f.origin.y - 5) this.seedDroplet(pos, vel, life, i, f.origin, spread);
      }
      (f.spout.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      const mat = f.spout.material as THREE.PointsMaterial;
      mat.color.setHex(g > 0.6 ? CORRUPT_HEX[Math.floor(this.t * 8) % CORRUPT_HEX.length] : WATER);
    }
  }

  private animatePath(g: number): void {
    // Heave the path ribbon vertices on a travelling sine wave as it corrupts.
    const geo = this.path.geometry;
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const amp = g * 2.5;
    for (let k = 0; k < arr.length; k += 3) {
      const bx = this.pathBase[k];
      const bz = this.pathBase[k + 2];
      arr[k] = bx;
      arr[k + 1] = this.pathBase[k + 1] + (amp > 0.001 ? Math.sin(this.t * 2 + bx * 0.1 + bz * 0.1) * amp : 0);
      arr[k + 2] = bz;
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
    this.camera = null;
  }
}

const def: EddieBackgroundDef = {
  id: "bg04",
  label: "Roman Garden → Meltdown",
  blurb: "A formal Roman villa garden whose checkerboard path winds through busts, statues, colonnades and fountains — the camera steers smoothly along the bends before it tastefully datamoshes at high intensity.",
  create: () => new Bg04(),
};

export default def;
