// bg01 — "Neon City -> Inferno" (the showcase background, GDD §8). A seeded,
// pixelated neon GRID CITY the camera DRIVES through, ON THE ROADS: it travels
// down a road centerline then PIVOTS through intersections onto cross-streets,
// winding through city blocks forever and NEVER passing through a building (the
// route is constrained to road centerlines; buildings sit set back inside the
// blocks). Buildings are pooled + recycled to the grid cells around the route so
// the run is endless.
//
// Performance INTENSITY morphs the world calm->chaos using BIG PIXEL PARTICLE
// fire (chunky square embers, orange->red->yellow, additive but luminance-
// clamped so they read as FIRE, not a glow blob): clean city at morph 0, a few
// fire sources creeping in on the sidewalks/corners as it rises, embers spitting
// upward on the beat at mid, more fire than buildings higher up, and at morph ~1
// a HELLISH GROUND FIRE PLANE — a screen-filling sea of molten ember fire — that
// the buildings only poke their TOPS through. Fire stays ORANGE/RED — never
// rainbow.
//
// Juice contract (all three events handled):
//  - eddieBeatPulse (downbeat stronger) -> window gleam, building shake, fire
//    SPIT (burst of upward embers). Beat reactions scale with `morph`.
//  - eddieShake {magnitude} -> camera jolt that decays.
//  - eddieIntensity {value 0..1} -> stored as target; `morph` EASES toward it
//    each frame (never snaps) and drives the whole transformation.
// dispose() restores scene.background/fog, disposes ALL geometry/material/
// texture, and unsubscribes ALL listeners.

import * as THREE from "three";
import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";
import type { EddieBackgroundDef, EddieBackgroundVariant } from "./types";

// Grid-city layout (world units).
const BLOCK = 40; // grid spacing between intersections (road centerlines)
const ROAD_HALF = 7; // half-width of a road (buildings sit outside this)
const CELL_VIEW = 3; // generate building cells within +-3 grid cells of camera
const TOWER_POOL = (CELL_VIEW * 2 + 1) * (CELL_VIEW * 2 + 1); // one tower/cell
const DRIVE_SPEED = 22; // base forward speed (units/s), eases up with morph

const NEON_TINTS = [0xff2bd6, 0x00f0ff, 0xffd02b, 0xff5a8a, 0x7a3cff, 0x36e07a];

// Big-pixel fire palette (strictly hot fire — yellow core -> orange -> red).
const FIRE_PALETTE = [
  [255, 244, 190], // yellow-white core
  [255, 210, 90], // yellow
  [255, 150, 40], // orange
  [235, 90, 25], // deep orange
  [200, 45, 20], // red
];

interface Tower {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  baseColor: THREE.Color;
  cellX: number; // grid cell currently occupied (so we don't double-fill)
  cellZ: number;
}

interface FireSource {
  x: number;
  z: number;
  active: boolean;
}

interface Ember {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  vx: number;
  vy: number;
  vz: number;
  life: number; // remaining life (s)
  maxLife: number;
  size: number;
}

class Bg01 implements EddieBackgroundVariant {
  private scene: THREE.Scene | null = null;
  private group = new THREE.Group();
  private prevBackground: THREE.Scene["background"] = null;
  private prevFog: THREE.Scene["fog"] = null;

  // Shared chunky textures + geometry.
  private facadeTex!: THREE.CanvasTexture;
  private pixelTex!: THREE.CanvasTexture; // 1 solid white pixel (tinted per ember)
  private boxGeo!: THREE.BoxGeometry;
  private emberGeo!: THREE.PlaneGeometry;

  private towers: Tower[] = [];
  private fireSources: FireSource[] = [];
  private embers: Ember[] = [];

  private ground!: THREE.Mesh;
  private groundMat!: THREE.MeshBasicMaterial;
  private skyMat!: THREE.MeshBasicMaterial;
  private skyTex!: THREE.CanvasTexture;
  private sky!: THREE.Mesh;

  // Hellish ground fire plane (max-morph: a sea of molten ember fire the towers
  // poke their tops through). A big-pixel ember-field canvas, scrolled + flicker-
  // animated, on a large ground-hugging plane that rises in opacity with morph.
  private firePlane!: THREE.Mesh;
  private firePlaneMat!: THREE.MeshBasicMaterial;
  private firePlaneTex!: THREE.CanvasTexture;
  private firePlaneCv!: HTMLCanvasElement;
  private firePlane2d!: CanvasRenderingContext2D;
  private firePlaneRepaint = 0; // throttle the ember-field repaint

  private camera: THREE.PerspectiveCamera | null = null;
  private camBaseY = 5;

  private offBeat?: () => void;
  private offShake?: () => void;
  private offIntensity?: () => void;

  private morph = 0; // eased 0..1 — drives the whole transformation
  private intensityTarget = 0;
  private pulse = 0; // decaying beat pump
  private downbeatPulse = 0; // decaying downbeat pump (stronger)
  private t = 0;
  private rng = this.makeRng(0xc0ffee);

  // --- Driving route state. The camera position is ALWAYS on a road centerline
  //     (a grid line x=k*BLOCK or z=k*BLOCK). It drives in axis-aligned segments
  //     between intersection nodes; at a node it either continues straight or
  //     PIVOTS through a quarter-circle arc onto the cross-street so it never
  //     cuts the corner into a building. dir is the unit travel direction.
  private posX = 0;
  private posZ = 0;
  private dirX = 0; // unit travel direction (axis-aligned when not turning)
  private dirZ = -1; // start heading down -Z
  private heading = -Math.PI / 2; // derived camera look heading (radians, XZ)
  // The intersection node we are driving toward (always a grid corner).
  private nodeX = 0;
  private nodeZ = -BLOCK;
  // Turn arc state: when turning we sweep around a pivot corner.
  private turning = false;
  private turnFrom = 0; // start angle on the arc (radians)
  private turnTo = 0; // end angle on the arc
  private turnT = 0; // 0..1 progress along the arc
  private turnPivotX = 0; // arc center
  private turnPivotZ = 0;
  private turnSign = 1; // +1 left, -1 right
  private emberCursor = 0; // round-robin index into the ember pool
  private spitQueued = 0; // beat-spit budget (extra embers to launch)

  private makeRng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }

  mount(ctx: { scene: THREE.Scene; camera?: THREE.PerspectiveCamera; juice: EventBus<EddieJuiceEvents> }): void {
    this.scene = ctx.scene;
    this.prevBackground = ctx.scene.background;
    this.prevFog = ctx.scene.fog;
    ctx.scene.background = new THREE.Color(0x0a0612);
    // Fog hides the edge of the generated cells around the route.
    ctx.scene.fog = new THREE.Fog(0x0a0612, 40, BLOCK * (CELL_VIEW + 0.5));

    this.facadeTex = this.buildFacadeTexture();
    this.pixelTex = this.buildPixelTexture();
    this.boxGeo = new THREE.BoxGeometry(1, 1, 1);
    this.emberGeo = new THREE.PlaneGeometry(1, 1);

    // --- Sky backdrop: night-purple gradient (red-shifts as morph rises).
    const skyCv = document.createElement("canvas");
    skyCv.width = 8;
    skyCv.height = 128;
    const sc = skyCv.getContext("2d")!;
    const sg = sc.createLinearGradient(0, 0, 0, 128);
    sg.addColorStop(0.0, "#06030f");
    sg.addColorStop(0.55, "#1a0a36");
    sg.addColorStop(1.0, "#3a0f5e");
    sc.fillStyle = sg;
    sc.fillRect(0, 0, 8, 128);
    this.skyTex = new THREE.CanvasTexture(skyCv);
    this.skyTex.colorSpace = THREE.SRGBColorSpace;
    this.skyMat = new THREE.MeshBasicMaterial({ map: this.skyTex, depthWrite: false, depthTest: false, fog: false });
    this.sky = new THREE.Mesh(new THREE.PlaneGeometry(900, 360), this.skyMat);
    this.sky.renderOrder = -30;
    this.group.add(this.sky);

    // --- Ground: dark asphalt with neon grid lines baked into a tiled texture so
    //     roads read in every direction (it's a grid city).
    const grCv = document.createElement("canvas");
    grCv.width = 64;
    grCv.height = 64;
    const gc = grCv.getContext("2d")!;
    gc.fillStyle = "#070410";
    gc.fillRect(0, 0, 64, 64);
    // Road bands (cyan edges) along both axes at the tile borders.
    gc.fillStyle = "#0c1430";
    gc.fillRect(0, 0, 64, 12);
    gc.fillRect(0, 0, 12, 64);
    gc.fillStyle = "#00f0ff";
    gc.fillRect(0, 1, 64, 1);
    gc.fillRect(1, 0, 1, 64);
    gc.fillStyle = "#ff2bd6";
    gc.fillRect(0, 10, 64, 1);
    gc.fillRect(10, 0, 1, 64);
    // Centerline dashes down each road.
    gc.fillStyle = "#ffd02b";
    for (let d = 16; d < 64; d += 12) {
      gc.fillRect(5, d, 2, 6);
      gc.fillRect(d, 5, 6, 2);
    }
    const grTex = new THREE.CanvasTexture(grCv);
    grTex.colorSpace = THREE.SRGBColorSpace;
    grTex.magFilter = THREE.NearestFilter;
    grTex.minFilter = THREE.NearestFilter;
    grTex.generateMipmaps = false;
    grTex.wrapS = THREE.RepeatWrapping;
    grTex.wrapT = THREE.RepeatWrapping;
    const groundSpan = BLOCK * (CELL_VIEW * 2 + 4);
    grTex.repeat.set(groundSpan / BLOCK, groundSpan / BLOCK);
    this.groundMat = new THREE.MeshBasicMaterial({ map: grTex });
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(groundSpan, groundSpan), this.groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.group.add(this.ground);

    // --- Hellish ground fire plane: a big-pixel ember field on a ground-hugging
    //     plane, hidden at low morph, rising to a screen-filling sea of fire at
    //     morph ~1 (buildings poke their tops through it).
    this.firePlaneCv = document.createElement("canvas");
    this.firePlaneCv.width = 96;
    this.firePlaneCv.height = 96;
    this.firePlane2d = this.firePlaneCv.getContext("2d")!;
    this.paintFireField(0);
    this.firePlaneTex = new THREE.CanvasTexture(this.firePlaneCv);
    this.firePlaneTex.colorSpace = THREE.SRGBColorSpace;
    this.firePlaneTex.magFilter = THREE.NearestFilter;
    this.firePlaneTex.minFilter = THREE.NearestFilter;
    this.firePlaneTex.generateMipmaps = false;
    this.firePlaneTex.wrapS = THREE.RepeatWrapping;
    this.firePlaneTex.wrapT = THREE.RepeatWrapping;
    this.firePlaneTex.repeat.set(8, 8);
    this.firePlaneMat = new THREE.MeshBasicMaterial({
      map: this.firePlaneTex,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
    });
    this.firePlane = new THREE.Mesh(new THREE.PlaneGeometry(groundSpan, groundSpan), this.firePlaneMat);
    this.firePlane.rotation.x = -Math.PI / 2;
    this.firePlane.position.y = 1.2; // just above the asphalt
    this.firePlane.renderOrder = 4;
    this.firePlane.frustumCulled = false;
    this.group.add(this.firePlane);

    // --- Towers: one per visible grid cell, repositioned as the camera drives.
    for (let i = 0; i < TOWER_POOL; i++) {
      const t = this.makeTower();
      this.towers.push(t);
      this.group.add(t.mesh);
    }

    // --- Fire sources: a pool placed near the route; activated as morph rises.
    for (let i = 0; i < 28; i++) this.fireSources.push({ x: 0, z: 0, active: false });

    // --- Ember pool: chunky square pixels. Start dead (hidden).
    const EMBER_POOL = 520;
    for (let i = 0; i < EMBER_POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.pixelTex,
        color: new THREE.Color(0xff7a28),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: true,
      });
      const mesh = new THREE.Mesh(this.emberGeo, mat);
      mesh.scale.set(0.001, 0.001, 1);
      mesh.frustumCulled = false;
      mesh.renderOrder = 6;
      this.group.add(mesh);
      this.embers.push({ mesh, mat, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, size: 1 });
    }

    ctx.scene.add(this.group);

    if (ctx.camera) {
      this.camera = ctx.camera;
      this.camera.position.set(this.posX, this.camBaseY, this.posZ);
    }

    // Initialize the road route: lock onto the start road + pick the first node.
    this.snapToRoad();
    this.chooseNextNode();

    // Seed the tower grid + fire sources around the start.
    this.refreshCells(true);

    this.offBeat = ctx.juice.on("eddieBeatPulse", (e) => {
      if (e.downbeat) this.downbeatPulse = 1;
      this.pulse = Math.max(this.pulse, e.downbeat ? 1 : 0.6);
      // Queue a burst of upward embers (the fire SPITS on the beat).
      this.spitQueued += (e.downbeat ? 26 : 12) * (0.25 + this.morph);
    });
    // Intentional NO-OP: the camera never shakes (design choice — a calm, steady
    // road camera even at full inferno). We still subscribe so the listener is
    // accounted for and cleanly unsubscribed in dispose, but it does nothing.
    this.offShake = ctx.juice.on("eddieShake", () => {
      /* no camera shake */
    });
    this.offIntensity = ctx.juice.on("eddieIntensity", (e) => {
      this.intensityTarget = Math.min(1, Math.max(0, e.value));
    });
  }

  // ---- Asset builders -----------------------------------------------------

  private buildFacadeTexture(): THREE.CanvasTexture {
    const cv = document.createElement("canvas");
    cv.width = 32;
    cv.height = 64;
    const g = cv.getContext("2d")!;
    g.fillStyle = "#0c0820";
    g.fillRect(0, 0, 32, 64);
    const rng = this.makeRng(0x5151);
    for (let y = 3; y < 62; y += 5) {
      for (let x = 3; x < 30; x += 5) {
        if (rng() < 0.25) continue; // unlit window
        const lit = 0.6 + rng() * 0.4;
        const v = Math.floor(180 + lit * 60);
        g.fillStyle = `rgb(${v},${v},${Math.floor(v * 0.95)})`;
        g.fillRect(x, y, 3, 3);
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  // A single solid white pixel; ember color comes from the per-mesh tint, and
  // NearestFilter on a 1x1 quad gives a perfectly crisp chunky square.
  private buildPixelTexture(): THREE.CanvasTexture {
    const cv = document.createElement("canvas");
    cv.width = 1;
    cv.height = 1;
    const g = cv.getContext("2d")!;
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 1, 1);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    return tex;
  }

  // Paint the big-pixel ember field for the ground fire plane. Chunky cells of
  // yellow/orange/red over near-black gaps, twinkled by `phase` so the molten
  // sea shimmers. Strictly hot fire colors — no rainbow.
  private paintFireField(phase: number): void {
    const g = this.firePlane2d;
    const W = this.firePlaneCv.width;
    const H = this.firePlaneCv.height;
    g.globalCompositeOperation = "source-over";
    g.fillStyle = "#1a0500";
    g.fillRect(0, 0, W, H);
    const cell = 4; // chunky pixel size
    let s = 0x9e3779b1;
    const rnd = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    for (let y = 0; y < H; y += cell) {
      for (let x = 0; x < W; x += cell) {
        const base = rnd();
        // Flicker each cell on its own phase so the field churns like coals.
        const flick = 0.5 + 0.5 * Math.sin(phase * 6 + base * 30 + x * 0.3 + y * 0.21);
        const heat = base * 0.5 + flick * 0.5;
        if (heat < 0.32) continue; // dark gap (reads as ember bed)
        let col: number[];
        if (heat > 0.86) col = FIRE_PALETTE[0]; // yellow-white core
        else if (heat > 0.66) col = FIRE_PALETTE[1]; // yellow
        else if (heat > 0.5) col = FIRE_PALETTE[2]; // orange
        else col = FIRE_PALETTE[3]; // deep orange
        // Luminance-clamp the cell alpha so additive stacking won't white out.
        const a = Math.min(0.8, heat * 0.9);
        g.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${a.toFixed(3)})`;
        g.fillRect(x, y, cell, cell);
      }
    }
    this.firePlaneTex && (this.firePlaneTex.needsUpdate = true);
  }

  private makeTower(): Tower {
    const baseColor = new THREE.Color(NEON_TINTS[(this.rng() * NEON_TINTS.length) | 0]);
    const mat = new THREE.MeshBasicMaterial({ map: this.facadeTex.clone(), color: baseColor.clone(), fog: true });
    const mesh = new THREE.Mesh(this.boxGeo, mat);
    mesh.frustumCulled = false;
    return { mesh, mat, baseColor, cellX: NaN, cellZ: NaN };
  }

  // ---- Grid cell management (endless city) --------------------------------

  // Position the tower pool onto the grid cells around the camera. Each cell
  // (gx,gz) hosts a building set back from the two roads bounding it. Called when
  // the camera crosses into a new cell so the city is always populated ahead.
  private refreshCells(force: boolean): void {
    const camGX = Math.round(this.posX / BLOCK);
    const camGZ = Math.round(this.posZ / BLOCK);

    // Build the set of cells we want occupied (a square around the camera).
    let idx = 0;
    for (let dz = -CELL_VIEW; dz <= CELL_VIEW; dz++) {
      for (let dx = -CELL_VIEW; dx <= CELL_VIEW; dx++) {
        const gx = camGX + dx;
        const gz = camGZ + dz;
        const tw = this.towers[idx++];
        if (!force && tw.cellX === gx && tw.cellZ === gz) continue;
        this.placeTowerInCell(tw, gx, gz);
      }
    }
  }

  // Deterministic per-cell building so the same cell always looks the same
  // (no popping when revisited). Building sits in the cell interior, offset from
  // the road grid lines.
  private placeTowerInCell(tw: Tower, gx: number, gz: number): void {
    const seed = (((gx * 73856093) ^ (gz * 19349663)) >>> 0) || 1;
    const r = this.makeRng(seed);
    const height = 16 + r() * 40;
    const width = 12 + r() * 14;
    const depth = 12 + r() * 14;
    // Center of the block is offset half a cell from the intersection at (gx,gz).
    const cx = gx * BLOCK + BLOCK * 0.5;
    const cz = gz * BLOCK + BLOCK * 0.5;
    // Nudge within the block so the silhouette isn't a perfect lattice.
    const jx = (r() - 0.5) * (BLOCK * 0.5 - width * 0.5 - ROAD_HALF);
    const jz = (r() - 0.5) * (BLOCK * 0.5 - depth * 0.5 - ROAD_HALF);
    tw.mesh.scale.set(width, height, depth);
    tw.mesh.position.set(cx + jx, height / 2, cz + jz);
    tw.mesh.userData.lastJx = 0; // reset beat-jitter accumulator for the new cell
    tw.baseColor.set(NEON_TINTS[(r() * NEON_TINTS.length) | 0]);
    const map = tw.mat.map!;
    map.repeat.set(Math.max(1, Math.round(width / 4)), Math.max(2, Math.round(height / 5)));
    map.needsUpdate = true;
    tw.cellX = gx;
    tw.cellZ = gz;
  }

  // Reposition fire sources onto sidewalks near the camera's current roads +
  // upcoming corner. Deterministic per cell-edge so they don't teleport jarringly.
  private refreshFireSources(): void {
    const camGX = Math.round(this.posX / BLOCK);
    const camGZ = Math.round(this.posZ / BLOCK);
    let i = 0;
    for (let dz = -1; dz <= 1 && i < this.fireSources.length; dz++) {
      for (let dx = -1; dx <= 1 && i < this.fireSources.length; dx++) {
        const gx = camGX + dx;
        const gz = camGZ + dz;
        const seed = (((gx * 0x1f1f1f1f) ^ (gz * 0x2c2c2c2c)) >>> 0) || 7;
        const r = this.makeRng(seed);
        // A few sources per nearby intersection, along the sidewalks (just off
        // the road edge, hugging the building corners).
        for (let k = 0; k < 3 && i < this.fireSources.length; k++) {
          const onX = r() < 0.5;
          const sign = r() < 0.5 ? -1 : 1;
          const along = (r() - 0.5) * BLOCK * 0.8;
          const fs = this.fireSources[i++];
          if (onX) {
            fs.x = gx * BLOCK + along;
            fs.z = gz * BLOCK + sign * (ROAD_HALF + 1);
          } else {
            fs.x = gx * BLOCK + sign * (ROAD_HALF + 1);
            fs.z = gz * BLOCK + along;
          }
        }
      }
    }
  }

  // ---- Ember emission -----------------------------------------------------

  private spawnEmber(x: number, z: number, upBurst: number): void {
    const e = this.embers[this.emberCursor];
    this.emberCursor = (this.emberCursor + 1) % this.embers.length;
    const r = this.rng;
    e.maxLife = 0.6 + r() * 0.9;
    e.life = e.maxLife;
    // Chunky square ember: bigger pixels at low altitude, scaled by morph.
    e.size = (0.6 + r() * 1.4) * (1 + this.morph * 1.2);
    e.vx = (r() - 0.5) * 2.2;
    e.vz = (r() - 0.5) * 2.2;
    e.vy = 5 + r() * 6 + upBurst; // rises; beat spit adds upward velocity
    e.mesh.position.set(x + (r() - 0.5) * 2, 0.5 + r() * 1.5, z + (r() - 0.5) * 2);
    e.mesh.scale.set(e.size, e.size, 1);
    e.mat.opacity = 1;
  }

  // ---- Per-frame ----------------------------------------------------------

  // Radius of the corner-turn arc. Kept <= ROAD_HALF so the swept path stays on
  // the road and never reaches into a block (buildings start at ROAD_HALF).
  private readonly turnRadius = Math.min(ROAD_HALF - 1, 5);

  private advanceRoute(dt: number, speed: number): void {
    let remaining = speed * dt;
    // Resolve movement in small chunks so a node/turn transition lands exactly
    // on the road even across a single frame.
    let guard = 0;
    while (remaining > 1e-4 && guard++ < 8) {
      if (this.turning) {
        // Sweep along the quarter-circle arc about the pivot corner.
        const arcLen = (Math.PI / 2) * this.turnRadius;
        const dT = remaining / arcLen;
        const prevT = this.turnT;
        this.turnT = Math.min(1, this.turnT + dT);
        const consumed = (this.turnT - prevT) * arcLen;
        remaining -= consumed;
        const ang = this.turnFrom + (this.turnTo - this.turnFrom) * this.turnT;
        this.posX = this.turnPivotX + Math.cos(ang) * this.turnRadius;
        this.posZ = this.turnPivotZ + Math.sin(ang) * this.turnRadius;
        // Tangent direction along the arc = derivative of position.
        const tang = ang + this.turnSign * (Math.PI / 2);
        this.dirX = Math.cos(tang);
        this.dirZ = Math.sin(tang);
        this.heading = Math.atan2(this.dirZ, this.dirX);
        if (this.turnT >= 1) {
          this.turning = false;
          // Snap exactly onto the outgoing road centerline + pick the next node.
          this.snapToRoad();
          this.chooseNextNode();
        }
      } else {
        // Drive straight toward the node; stop when we reach the turn-entry point
        // (turnRadius short of the node so the arc starts on the road).
        const toNodeX = this.nodeX - this.posX;
        const toNodeZ = this.nodeZ - this.posZ;
        const distToNode = Math.abs(toNodeX) + Math.abs(toNodeZ); // axis-aligned
        const entryDist = Math.max(0, distToNode - this.turnRadius);
        if (remaining < entryDist || this.pendingStraight) {
          // Either we don't reach the corner this step, or we're going straight
          // through this node (no arc) — just advance and possibly cross it.
          const step = Math.min(remaining, this.pendingStraight ? distToNode : entryDist);
          this.posX += this.dirX * step;
          this.posZ += this.dirZ * step;
          remaining -= step;
          if (this.pendingStraight && distToNode - step <= 1e-3) {
            // Crossed the node going straight: lock onto it and choose the next.
            this.posX = this.nodeX;
            this.posZ = this.nodeZ;
            this.pendingStraight = false;
            this.chooseNextNode();
          } else if (remaining <= 1e-4) {
            break;
          }
        } else {
          // Advance to the arc-entry point, then begin the turn (if one is set).
          this.posX += this.dirX * entryDist;
          this.posZ += this.dirZ * entryDist;
          remaining -= entryDist;
          this.beginTurn();
        }
      }
    }
    this.heading = Math.atan2(this.dirZ, this.dirX);
  }

  // Snap the camera exactly onto the nearest road centerline on its cross axis
  // (the axis perpendicular to travel) so float drift can't push it off-road.
  private snapToRoad(): void {
    if (Math.abs(this.dirX) > Math.abs(this.dirZ)) {
      // Travelling along X: lock Z to the nearest grid line.
      this.posZ = Math.round(this.posZ / BLOCK) * BLOCK;
      this.dirZ = 0;
      this.dirX = Math.sign(this.dirX) || 1;
    } else {
      this.posX = Math.round(this.posX / BLOCK) * BLOCK;
      this.dirX = 0;
      this.dirZ = Math.sign(this.dirZ) || 1;
    }
  }

  // Decide the next intersection node ahead. ~55% straight, ~45% a turn. The
  // node is one block ahead along the current direction.
  private pendingStraight = false;
  private pendingTurnLeft = false;
  private pendingTurn = false;
  private chooseNextNode(): void {
    this.snapToRoad();
    this.nodeX = Math.round((this.posX + this.dirX * BLOCK) / BLOCK) * BLOCK;
    this.nodeZ = Math.round((this.posZ + this.dirZ * BLOCK) / BLOCK) * BLOCK;
    if (this.rng() < 0.45) {
      this.pendingTurn = true;
      this.pendingTurnLeft = this.rng() < 0.5;
      this.pendingStraight = false;
    } else {
      this.pendingTurn = false;
      this.pendingStraight = true;
    }
  }

  // Set up the quarter-circle arc that pivots from the incoming road onto the
  // chosen cross-street, centered so the arc stays within turnRadius of the node.
  private beginTurn(): void {
    if (!this.pendingTurn) {
      this.pendingStraight = true;
      return;
    }
    this.pendingTurn = false;
    // Left turn = +90deg (CCW) in XZ; right = -90deg. The pivot is offset from
    // the node perpendicular to travel, toward the turn side.
    this.turnSign = this.pendingTurnLeft ? 1 : -1;
    // Perpendicular (left of travel) unit vector in XZ.
    const leftX = -this.dirZ;
    const leftZ = this.dirX;
    const px = this.posX + leftX * this.turnSign * this.turnRadius;
    const pz = this.posZ + leftZ * this.turnSign * this.turnRadius;
    this.turnPivotX = px;
    this.turnPivotZ = pz;
    // Start angle points from pivot back to current position.
    this.turnFrom = Math.atan2(this.posZ - pz, this.posX - px);
    this.turnTo = this.turnFrom + this.turnSign * (Math.PI / 2);
    this.turnT = 0;
    this.turning = true;
  }

  update(dt: number, _audioTime: number): void {
    this.t += dt;
    // Clamp dt so a long frame can't fling the route across the grid.
    const sdt = Math.min(dt, 0.05);

    // Ease morph toward the intensity target (never snap).
    this.morph += (this.intensityTarget - this.morph) * sdt * 1.5;
    this.morph = Math.min(1, Math.max(0, this.morph));
    const m = this.morph;

    if (this.pulse > 0) this.pulse = Math.max(0, this.pulse - sdt * 3.2);
    if (this.downbeatPulse > 0) this.downbeatPulse = Math.max(0, this.downbeatPulse - sdt * 2.6);

    // --- Drive the route (turning at corners). Faster as the inferno builds.
    const speed = DRIVE_SPEED * (1 + m * 0.7);
    const prevGX = Math.round(this.posX / BLOCK);
    const prevGZ = Math.round(this.posZ / BLOCK);
    this.advanceRoute(sdt, speed);
    const gx = Math.round(this.posX / BLOCK);
    const gz = Math.round(this.posZ / BLOCK);
    if (gx !== prevGX || gz !== prevGZ) {
      this.refreshCells(false);
      this.refreshFireSources();
    }

    // --- Towers: beat gleam + shake; dim + red-shift as fire takes over.
    const beatShake = (this.pulse + this.downbeatPulse) * (0.1 + m * 0.5);
    for (const tw of this.towers) {
      const ph = this.t * 28 + tw.cellX * 1.7 + tw.cellZ * 0.9;
      const jx = Math.sin(ph) * beatShake;
      const jy = Math.cos(ph * 1.3) * beatShake * 0.5;
      tw.mesh.position.y = tw.mesh.scale.y / 2 + jy;
      tw.mesh.rotation.z = Math.sin(ph * 0.7) * beatShake * 0.01;
      tw.mesh.position.x += jx - (tw.mesh.userData.lastJx ?? 0);
      tw.mesh.userData.lastJx = jx;

      const gleam = 1 + (this.pulse * 0.35 + this.downbeatPulse * 0.35) * (1 - m * 0.4);
      const dim = 1 - m * 0.55;
      tw.mat.color.setRGB(
        Math.min(1, tw.baseColor.r * gleam * dim + m * 0.22),
        Math.min(1, tw.baseColor.g * gleam * dim),
        Math.min(1, tw.baseColor.b * gleam * dim),
      );
    }

    // --- Sky/ground/fog red-shift as the inferno grows.
    this.skyMat.color.setRGB(1 + m * 0.5, 1 - m * 0.45, 1 - m * 0.7);
    this.groundMat.color.setRGB(1 + m * 0.4, 1 - m * 0.2, 1 - m * 0.3);
    if (this.scene && this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.setRGB(0.04 + m * 0.5, 0.024 + m * 0.04, 0.07);
    }
    if (this.scene && this.scene.background instanceof THREE.Color) {
      this.scene.background.setRGB(0.04 + m * 0.45, 0.024 + m * 0.03, Math.max(0, 0.07 - m * 0.04));
    }

    // --- Fire emission. Active source count + per-source rate scale with morph.
    const activeSources = Math.round(THREE.MathUtils.lerp(2, this.fireSources.length, Math.min(1, m * 1.15)));
    for (let i = 0; i < this.fireSources.length; i++) {
      this.fireSources[i].active = i < activeSources;
    }
    // Steady emission rate (embers/sec across all active sources), morph-scaled.
    const baseRate = activeSources * THREE.MathUtils.lerp(6, 34, m);
    let toSpawn = baseRate * sdt;
    // Beat spit: drain the queued burst quickly so it reads as a synced spit.
    if (this.spitQueued > 0) {
      const burst = Math.min(this.spitQueued, 220 * sdt + 4);
      toSpawn += burst;
      this.spitQueued -= burst;
    }
    let count = Math.floor(toSpawn);
    if (this.rng() < toSpawn - count) count++;
    for (let k = 0; k < count; k++) {
      // Pick a random active source; prefer ones near the camera/route.
      const src = this.fireSources[(this.rng() * activeSources) | 0];
      if (!src || !src.active) continue;
      const upBurst = (this.pulse + this.downbeatPulse) * (3 + m * 9);
      this.spawnEmber(src.x, src.z, upBurst);
    }

    // --- Integrate embers (rise, drift, flicker, fade through the fire palette).
    for (const e of this.embers) {
      if (e.life <= 0) {
        if (e.mat.opacity !== 0) {
          e.mat.opacity = 0;
          e.mesh.scale.set(0.001, 0.001, 1);
        }
        continue;
      }
      e.life -= sdt;
      // Buoyant rise that slows as it cools; lateral drift + a little turbulence.
      e.vy += 2.5 * sdt; // hot air keeps lifting
      e.vy *= 0.98;
      const turb = Math.sin((e.life + e.mesh.position.x) * 12) * 1.4;
      e.mesh.position.x += (e.vx + turb) * sdt;
      e.mesh.position.y += e.vy * sdt;
      e.mesh.position.z += e.vz * sdt;

      const f = 1 - e.life / e.maxLife; // 0 fresh .. 1 dying
      // Color through the fire palette: yellow-white core -> orange -> red.
      const pf = Math.min(FIRE_PALETTE.length - 1, f * (FIRE_PALETTE.length - 1));
      const i0 = Math.floor(pf);
      const i1 = Math.min(FIRE_PALETTE.length - 1, i0 + 1);
      const frac = pf - i0;
      const c0 = FIRE_PALETTE[i0];
      const c1 = FIRE_PALETTE[i1];
      // Luminance-clamped so additive blending reads as FIRE, not a white blob.
      const r = (c0[0] + (c1[0] - c0[0]) * frac) / 255;
      const g = (c0[1] + (c1[1] - c0[1]) * frac) / 255;
      const b = (c0[2] + (c1[2] - c0[2]) * frac) / 255;
      const flick = 0.8 + 0.2 * Math.sin(this.t * 30 + e.maxLife * 50);
      e.mat.color.setRGB(r * flick, g * flick, b * flick);
      // Big-pixel ember: shrinks + fades as it dies; opacity capped under 1 so
      // overlapping embers stack into flame without clipping to white.
      const sz = e.size * (0.4 + (1 - f) * 0.6);
      e.mesh.scale.set(sz, sz, 1);
      e.mat.opacity = Math.min(0.85, (1 - f) * 0.95 + 0.1);
      // Billboard the square toward the camera so it stays a crisp facing pixel.
      if (this.camera) e.mesh.quaternion.copy(this.camera.quaternion);
    }

    // --- Camera: ride the route at eye height, look down the heading. The ONLY
    //     camera motion is the smooth drive along the roads (and a slight roll
    //     into corners) — NO shake, NO inferno rumble, steady even at full fire.
    if (this.camera) {
      const lookX = this.posX + Math.cos(this.heading) * 20;
      const lookZ = this.posZ + Math.sin(this.heading) * 20;
      this.camera.position.set(this.posX, this.camBaseY, this.posZ);
      this.camera.lookAt(lookX, this.camBaseY - 1, lookZ);
      // A little roll when taking a corner for a driving feel.
      if (this.turning) this.camera.rotateZ(-this.turnSign * 0.1);
    }

    // Keep sky + ground riding with the camera so the city never runs out.
    this.sky.position.set(
      this.posX + Math.cos(this.heading) * (BLOCK * CELL_VIEW),
      40,
      this.posZ + Math.sin(this.heading) * (BLOCK * CELL_VIEW),
    );
    if (this.camera) this.sky.quaternion.copy(this.camera.quaternion);
    this.ground.position.set(this.posX, 0, this.posZ);
    // Scroll the ground texture so road lines stay locked to world space.
    const map = this.groundMat.map!;
    map.offset.set(this.posX / BLOCK, -this.posZ / BLOCK);

    // --- Hellish ground fire plane. Ramps in over the top of the morph range so
    //     it's "more fire than buildings" approaching 1: a screen-filling sea of
    //     molten ember the towers poke their tops through. Stays orange/red.
    const fireSea = THREE.MathUtils.clamp((m - 0.45) / 0.55, 0, 1); // 0 until ~mid
    this.firePlane.position.set(this.posX, 1.2 + fireSea * 6.5, this.posZ);
    this.firePlaneMat.opacity = Math.min(0.82, fireSea * fireSea * 0.95);
    // Beat makes the sea surge brighter/taller for a frame.
    const surge = (this.pulse + this.downbeatPulse) * 0.12 * fireSea;
    this.firePlaneMat.color.setRGB(1 + surge, 1 - surge * 0.3, 1 - surge * 0.5);
    // Drift the ember field with travel + repaint a few times a second so it
    // churns like live coals.
    this.firePlaneTex.offset.set(this.posX / 12 + this.t * 0.05, -this.posZ / 12 + this.t * 0.08);
    this.firePlaneRepaint += sdt;
    if (fireSea > 0.01 && this.firePlaneRepaint >= 0.08) {
      this.firePlaneRepaint = 0;
      this.paintFireField(this.t);
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

    // Towers each own a cloned facade texture + material.
    for (const tw of this.towers) {
      (tw.mat.map as THREE.Texture | null)?.dispose();
      tw.mat.dispose();
    }
    this.towers = [];
    // Embers share pixelTex (disposed below); dispose their materials.
    for (const e of this.embers) e.mat.dispose();
    this.embers = [];
    this.fireSources = [];

    this.boxGeo.dispose();
    this.emberGeo.dispose();
    this.facadeTex.dispose();
    this.pixelTex.dispose();

    this.ground.geometry.dispose();
    (this.groundMat.map as THREE.Texture | null)?.dispose();
    this.groundMat.dispose();
    this.sky.geometry.dispose();
    this.skyTex.dispose();
    this.skyMat.dispose();
    this.firePlane.geometry.dispose();
    this.firePlaneTex.dispose();
    this.firePlaneMat.dispose();

    this.camera = null;
  }
}

const def: EddieBackgroundDef = {
  id: "bg01",
  label: "Neon City → Inferno",
  blurb:
    "Drive a pixelated neon grid city, taking corners, as performance intensity morphs the streets into a screen-filling storm of big-pixel orange fire.",
  create: () => new Bg01(),
};

export default def;
