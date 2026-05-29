// bg01 — "Neon City -> Inferno" (the showcase background, GDD §8). A seeded,
// pixelated neon GRID CITY the camera DRIVES through, taking corners: it travels
// down a road then turns left/right at intersections onto cross-streets, winding
// through city blocks forever. Buildings are pooled and recycled to the grid
// cells around the moving route so the run is endless.
//
// Performance INTENSITY morphs the world calm->chaos using BIG PIXEL PARTICLE
// fire (chunky square embers, orange->red->yellow, additive but luminance-
// clamped so they read as FIRE, not a glow blob): clean city at morph 0, a few
// fire sources creeping in on the sidewalks/corners as it rises, embers spitting
// upward on the beat at mid, more fire than buildings higher up, and a screen-
// filling ember storm at morph 1. Fire stays ORANGE/RED — never rainbow.
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
const TURN_RATE = 2.4; // radians/sec while taking a corner

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

  private camera: THREE.PerspectiveCamera | null = null;
  private camBaseY = 5;

  private offBeat?: () => void;
  private offShake?: () => void;
  private offIntensity?: () => void;

  private morph = 0; // eased 0..1 — drives the whole transformation
  private intensityTarget = 0;
  private pulse = 0; // decaying beat pump
  private downbeatPulse = 0; // decaying downbeat pump (stronger)
  private shake = 0; // external eddieShake jolt (decays)
  private t = 0;
  private rng = this.makeRng(0xc0ffee);

  // --- Driving route state. The camera moves along grid roads, turning at
  //     intersections. heading = current travel direction (radians, in XZ).
  private posX = 0;
  private posZ = 0;
  private heading = -Math.PI / 2; // start heading down -Z
  private targetHeading = -Math.PI / 2;
  private turning = false;
  private distToNextNode = BLOCK; // distance until the next intersection
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

    // Seed the tower grid + fire sources around the start.
    this.refreshCells(true);

    this.offBeat = ctx.juice.on("eddieBeatPulse", (e) => {
      if (e.downbeat) this.downbeatPulse = 1;
      this.pulse = Math.max(this.pulse, e.downbeat ? 1 : 0.6);
      // Queue a burst of upward embers (the fire SPITS on the beat).
      this.spitQueued += (e.downbeat ? 26 : 12) * (0.25 + this.morph);
    });
    this.offShake = ctx.juice.on("eddieShake", (e) => {
      this.shake = Math.max(this.shake, e.magnitude);
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

  private advanceRoute(dt: number, speed: number): void {
    // While turning, rotate heading toward the target; otherwise drive straight
    // and count down to the next intersection where we may take a corner.
    if (this.turning) {
      const diff = this.angleDiff(this.targetHeading, this.heading);
      const step = Math.sign(diff) * Math.min(Math.abs(diff), TURN_RATE * dt);
      this.heading += step;
      if (Math.abs(this.angleDiff(this.targetHeading, this.heading)) < 0.02) {
        this.heading = this.targetHeading;
        this.turning = false;
        this.distToNextNode = BLOCK;
      }
    } else {
      this.distToNextNode -= speed * dt;
      if (this.distToNextNode <= 0) {
        // Reached an intersection: snap onto the grid line, then decide a turn.
        // ~55% keep straight, ~45% turn left/right onto the cross-street.
        const roll = this.rng();
        if (roll < 0.45) {
          const left = this.rng() < 0.5;
          this.targetHeading = this.heading + (left ? Math.PI / 2 : -Math.PI / 2);
          this.turning = true;
        } else {
          this.distToNextNode = BLOCK;
        }
      }
    }
    // Move forward along the current heading (XZ plane).
    this.posX += Math.cos(this.heading) * speed * dt;
    this.posZ += Math.sin(this.heading) * speed * dt;
  }

  private angleDiff(a: number, b: number): number {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
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
    if (this.shake > 0) this.shake = Math.max(0, this.shake - sdt * 6);

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

    // --- Camera: ride the route at eye height, look down the heading. Banking
    //     into corners + beat shudder + external shake.
    if (this.camera) {
      const lookX = this.posX + Math.cos(this.heading) * 20;
      const lookZ = this.posZ + Math.sin(this.heading) * 20;
      const infernoShudder = m * (0.12 + this.downbeatPulse * 0.3);
      const sx = (Math.random() - 0.5) * (this.shake * 2.0 + infernoShudder);
      const sy = (Math.random() - 0.5) * (this.shake * 1.5 + infernoShudder * 0.7);
      this.camera.position.set(this.posX + sx, this.camBaseY + sy, this.posZ);
      this.camera.lookAt(lookX, this.camBaseY - 1, lookZ);
      // A little roll when taking a corner for a driving feel.
      if (this.turning) {
        const dir = Math.sign(this.angleDiff(this.targetHeading, this.heading));
        this.camera.rotateZ(dir * 0.08);
      }
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
