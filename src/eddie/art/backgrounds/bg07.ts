// bg07 — "Circuit Board -> Spy Hunter Pixel City" — a richly detailed top-down
// PCB that transforms into a DENSE 80s-arcade top-down pixel city as
// performance intensity climbs. Three.js scene decoration (visuals only, §8).
//
// VISUAL TARGET (researched references):
//   * SPY HUNTER (Bally Midway, 1983) — top-down vertically-scrolling roads with
//     shoulders + dashed centre line, and chunky readable top-down CAR sprites
//     (distinct body + windshield, a few colours).
//       https://en.wikipedia.org/wiki/Spy_Hunter
//       https://www.mobygames.com/game/7668/spy-hunter/screenshots/arcade/
//   * 720 DEGREES (Atari, 1986) — DENSE top-down neighbourhood / Skate-City: city
//     BLOCKS packed with buildings, lots and parks, streets as corridors between
//     them, with little walking FIGURES, cars and BMX riders moving around.
//       https://en.wikipedia.org/wiki/720%C2%B0
//       https://www.arcade-history.com/game/23/720_degrees
//   * APPLE //e HGR hi-res — the 6-colour artifact palette: black, white, GREEN,
//     PURPLE/VIOLET, ORANGE, BLUE — chunky pixels, bright "clashy" look.
//       https://en.wikipedia.org/wiki/Apple_II_graphics
//       https://www.xtof.info/hires-graphics-apple-ii.html
//
// The whole board is one HI-RES low-res CanvasTexture (384x240, NearestFilter,
// pixely) on a FLAT quad with the camera looking straight down. An eased `morph`
// (0..1) cross-fades every element between circuit and city — it NEVER snaps
// (morph += (target-morph)*dt*1.5):
//   morph 0 -> CIRCUIT: green substrate, dense neon traces with DATA PULSES, and
//              many components — ICs/chips with pins, caps, resistors, LEDs, pads.
//   mid     -> dissolve: traces widen into roads, the BLOCKS between them fill in
//              with buildings, chip pins fade into windows, arcs jump between pads.
//   morph 1 -> SPY-HUNTER PIXEL CITY: a full top-down city map — every block
//              between the streets PACKED with HGR-palette buildings (varied
//              footprints/heights/rooftops), parking lots and greenery in the
//              gaps; asphalt roads with shoulders + dashed centre lines as
//              corridors; sprite CARS (body+windshield) driving them and 2-frame
//              pixel PEOPLE walking sidewalks. Cars + people STEP on every beat.
//
// Juice (all three required):
//   eddieBeatPulse -> circuit: data wavefront sweep. city: every car + person
//                     STEPS one stride (downbeat bigger) + a city flash. Stored as
//                     a decaying `beat` pump for continuous glow.
//   eddieShake     -> decaying camera jolt.
//   eddieIntensity -> stored as `morphTarget`; `morph` eases toward it/frame.
//
// dispose() restores scene.background/fog, disposes every geometry/material/
// texture and unsubscribes all listeners. Bloom-safe; the quad is
// frustumCulled=false.

import * as THREE from "three";
import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";
import type { EddieBackgroundDef, EddieBackgroundVariant } from "./types";

// HI-RES low-res texture = finer crisp pixels under NearestFilter.
const TEX_W = 384;
const TEX_H = 240;

const COMP_COUNT = 16; // landmark feature buildings (on top of the dense fill)
const PAD_COUNT = 16; // solder pads / plazas
const PULSE_COUNT = 56; // data pulses (circuit era)
const CAR_COUNT = 34; // cars (city era) — bound to roads
const PED_COUNT = 56; // pixel people (city era)

// Road lattice: evenly spaced avenues, a few jittered, defining the city blocks.
const COL_ROADS = 7; // vertical avenues
const ROW_ROADS = 5; // horizontal streets

// Apple //e HGR 6-colour artifact palette (the authentic clashy set).
const HGR_GREEN = "#1efe1e";
const HGR_PURPLE = "#a93bff";
const HGR_ORANGE = "#ff7e1e";
const HGR_BLUE = "#3b6bff";
const HGR_WHITE = "#f6f6f6";
const CAR_COLORS = [HGR_BLUE, HGR_ORANGE, HGR_GREEN, HGR_PURPLE, HGR_WHITE, "#e23b3b"];
// Building body tints (muted HGR concretes) + their HGR rooftop accents.
const BUILDING_BODY = ["#3a4a6e", "#4a3a5e", "#5e4a36", "#365e44", "#52526a", "#604040"];
const ROOF_ACCENT = [HGR_BLUE, HGR_PURPLE, HGR_ORANGE, HGR_GREEN, HGR_WHITE, "#e23b3b"];

type Dir = 0 | 1; // 0 = horizontal road, 1 = vertical road

interface Trace {
  x: number;
  y: number;
  len: number;
  dir: Dir;
  road: boolean; // part of the city street lattice (gets full road treatment)
}

interface Pulse {
  trace: number;
  pos: number;
  speed: number;
}

// A building inside a city block. Drawn only in city form (fades in with morph).
interface Building {
  x: number;
  y: number;
  w: number;
  h: number;
  body: number; // index into BUILDING_BODY
  roof: number; // index into ROOF_ACCENT
  roofStyle: number; // 0..2
  height: number; // 0..1 "tallness" → window density + drop-shadow length
  lot: number; // 0 building, 1 parking lot, 2 greenery/park
}

interface Comp {
  x: number;
  y: number;
  w: number;
  h: number;
  chip: boolean;
  pins: number;
  hue: number;
  blink: number;
  blinkRate: number;
}

interface Pad {
  x: number;
  y: number;
  r: number;
  blink: number;
  blinkRate: number;
}

interface Car {
  trace: number;
  pos: number;
  step: number;
  speed: number;
  fwd: 1 | -1;
  color: number;
  lane: number;
}

interface Ped {
  trace: number;
  pos: number;
  step: number;
  fwd: 1 | -1;
  off: number;
  hue: number;
  frame: number;
}

interface Arc {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  life: number;
  t: number;
  active: boolean;
}

class Bg07 implements EddieBackgroundVariant {
  private scene: THREE.Scene | null = null;
  private group = new THREE.Group();
  private prevBackground: THREE.Scene["background"] = null;
  private prevFog: THREE.Scene["fog"] = null;

  private canvas!: HTMLCanvasElement;
  private ctx2d!: CanvasRenderingContext2D;
  private tex!: THREE.CanvasTexture;
  private mat!: THREE.MeshBasicMaterial;
  private mesh!: THREE.Mesh;

  private traces: Trace[] = [];
  private pulses: Pulse[] = [];
  private buildings: Building[] = [];
  private comps: Comp[] = [];
  private pads: Pad[] = [];
  private cars: Car[] = [];
  private peds: Ped[] = [];
  private arcs: Arc[] = [];

  // Road centre coordinates of the lattice (for block derivation + car binding).
  private colX: number[] = [];
  private rowY: number[] = [];
  private roadW = 9; // street width in tex px (city form)

  private camera: THREE.PerspectiveCamera | null = null;
  private camBaseY = 120;

  private offBeat?: () => void;
  private offShake?: () => void;
  private offIntensity?: () => void;

  private morph = 0;
  private morphTarget = 0;
  private beat = 0;
  private beatDecay = 4;
  private surge = -1;
  private shake = 0;
  private t = 0;
  private rngState = 0x9e37 >>> 0;

  mount(ctx: {
    scene: THREE.Scene;
    camera?: THREE.PerspectiveCamera;
    juice: EventBus<EddieJuiceEvents>;
  }): void {
    this.scene = ctx.scene;
    this.prevBackground = ctx.scene.background;
    this.prevFog = ctx.scene.fog;
    ctx.scene.background = new THREE.Color(0x04130a);
    ctx.scene.fog = null;

    this.canvas = document.createElement("canvas");
    this.canvas.width = TEX_W;
    this.canvas.height = TEX_H;
    const c = this.canvas.getContext("2d");
    if (!c) throw new Error("bg07: 2D context unavailable");
    this.ctx2d = c;
    this.ctx2d.imageSmoothingEnabled = false;

    this.buildBoard();

    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;

    this.mat = new THREE.MeshBasicMaterial({
      map: this.tex,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(360, 232), this.mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(0, -10, -40);
    this.mesh.renderOrder = -20;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);

    ctx.scene.add(this.group);

    if (ctx.camera) {
      this.camera = ctx.camera;
      this.camera.position.set(0, this.camBaseY, -40);
      this.camera.lookAt(0, -10, -40);
    }

    this.paint();

    this.offBeat = ctx.juice.on("eddieBeatPulse", (e) => {
      this.beat = Math.max(this.beat, e.downbeat ? 1 : 0.55);
      this.beatDecay = e.downbeat ? 1 / 0.26 : 1 / 0.16;
      this.surge = 0;
      this.stepAgents(e.downbeat);
      if (this.morph > 0.3 && this.morph < 0.85) {
        const flashes = e.downbeat ? 2 : 1;
        for (let i = 0; i < flashes; i++) this.spawnArc();
      }
    });
    this.offShake = ctx.juice.on("eddieShake", (e) => {
      this.shake = Math.max(this.shake, e.magnitude);
    });
    this.offIntensity = ctx.juice.on("eddieIntensity", (e) => {
      this.morphTarget = Math.max(0, Math.min(1, e.value));
    });
  }

  /** Deterministic xorshift so the layout is stable per mount. */
  private rng(): number {
    let s = this.rngState;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.rngState = s >>> 0;
    return (this.rngState % 100000) / 100000;
  }

  private buildBoard(): void {
    // --- Street lattice: evenly spaced avenues/streets (slightly jittered). ---
    const colGap = TEX_W / (COL_ROADS + 1);
    for (let i = 1; i <= COL_ROADS; i++) {
      const jitter = Math.floor((this.rng() - 0.5) * colGap * 0.3);
      this.colX.push(Math.round(i * colGap + jitter));
    }
    const rowGap = TEX_H / (ROW_ROADS + 1);
    for (let i = 1; i <= ROW_ROADS; i++) {
      const jitter = Math.floor((this.rng() - 0.5) * rowGap * 0.3);
      this.rowY.push(Math.round(i * rowGap + jitter));
    }
    // Lattice roads (full-length corridors).
    for (const x of this.colX) {
      this.traces.push({ x, y: 4, len: TEX_H - 8, dir: 1, road: true });
    }
    for (const y of this.rowY) {
      this.traces.push({ x: 4, y, len: TEX_W - 8, dir: 0, road: true });
    }
    // A few extra short "alley" traces for circuit busyness (not full roads).
    for (let i = 0; i < 12; i++) {
      const dir: Dir = this.rng() < 0.5 ? 0 : 1;
      if (dir === 0) {
        const y = 6 + Math.floor(this.rng() * (TEX_H - 12));
        const x = Math.floor(this.rng() * (TEX_W - 60));
        this.traces.push({ x, y, len: 30 + Math.floor(this.rng() * 50), dir, road: false });
      } else {
        const x = 6 + Math.floor(this.rng() * (TEX_W - 12));
        const y = Math.floor(this.rng() * (TEX_H - 60));
        this.traces.push({ x, y, len: 24 + Math.floor(this.rng() * 44), dir, road: false });
      }
    }

    // --- DENSE block fill: pack every block (between lattice roads) with a row/
    //     column of buildings, parking lots and greenery. -----------------------
    this.fillBlocks();

    // --- Landmark feature buildings / chips layered over the fill. ------------
    for (let i = 0; i < COMP_COUNT; i++) {
      const chip = this.rng() < 0.5;
      const w = chip ? 16 + Math.floor(this.rng() * 22) : 8 + Math.floor(this.rng() * 10);
      const h = chip ? 14 + Math.floor(this.rng() * 20) : 6 + Math.floor(this.rng() * 9);
      this.comps.push({
        x: 6 + Math.floor(this.rng() * (TEX_W - w - 12)),
        y: 6 + Math.floor(this.rng() * (TEX_H - h - 12)),
        w,
        h,
        chip,
        pins: 3 + Math.floor(this.rng() * 5),
        hue: this.rng(),
        blink: this.rng() * Math.PI * 2,
        blinkRate: 1.2 + this.rng() * 3.5,
      });
    }

    // --- Pads -> plazas. ------------------------------------------------------
    for (let i = 0; i < PAD_COUNT; i++) {
      this.pads.push({
        x: 10 + Math.floor(this.rng() * (TEX_W - 20)),
        y: 10 + Math.floor(this.rng() * (TEX_H - 20)),
        r: 3 + Math.floor(this.rng() * 4),
        blink: this.rng() * Math.PI * 2,
        blinkRate: 1.5 + this.rng() * 4,
      });
    }

    // --- Data pulses bound to traces (circuit era). ---------------------------
    for (let i = 0; i < PULSE_COUNT; i++) {
      this.pulses.push({
        trace: Math.floor(this.rng() * this.traces.length),
        pos: this.rng(),
        speed: 0.25 + this.rng() * 0.55,
      });
    }

    // --- Cars bound to LATTICE roads only (so they ride real streets). --------
    const roadIdx = this.traces.map((t, i) => (t.road ? i : -1)).filter((i) => i >= 0);
    for (let i = 0; i < CAR_COUNT; i++) {
      const p = this.rng();
      this.cars.push({
        trace: roadIdx[Math.floor(this.rng() * roadIdx.length)],
        pos: p,
        step: p,
        speed: 0.04 + this.rng() * 0.06,
        fwd: this.rng() < 0.5 ? 1 : -1,
        color: Math.floor(this.rng() * CAR_COLORS.length),
        lane: this.rng() < 0.5 ? -1 : 1,
      });
    }

    // --- Pixel people on lattice roads (sidewalks). --------------------------
    for (let i = 0; i < PED_COUNT; i++) {
      const p = this.rng();
      this.peds.push({
        trace: roadIdx[Math.floor(this.rng() * roadIdx.length)],
        pos: p,
        step: p,
        fwd: this.rng() < 0.5 ? 1 : -1,
        off: (this.rng() < 0.5 ? -1 : 1) * (4 + Math.floor(this.rng() * 3)),
        hue: this.rng(),
        frame: Math.floor(this.rng() * 2),
      });
    }

    for (let i = 0; i < 12; i++) {
      this.arcs.push({ ax: 0, ay: 0, bx: 0, by: 0, life: 1, t: 0, active: false });
    }
  }

  /** Pack each city block (rectangle bounded by adjacent lattice roads + edges)
   *  with a small grid of buildings / parking lots / greenery, leaving a margin
   *  for the road so streets read as corridors. */
  private fillBlocks(): void {
    const half = Math.ceil(this.roadW / 2) + 1; // clearance from road centre
    const xs = [0, ...this.colX, TEX_W];
    const ys = [0, ...this.rowY, TEX_H];
    for (let cx = 0; cx < xs.length - 1; cx++) {
      for (let cy = 0; cy < ys.length - 1; cy++) {
        const bx0 = xs[cx] + (cx === 0 ? 2 : half);
        const bx1 = xs[cx + 1] - (cx === xs.length - 2 ? 2 : half);
        const by0 = ys[cy] + (cy === 0 ? 2 : half);
        const by1 = ys[cy + 1] - (cy === ys.length - 2 ? 2 : half);
        const bw = bx1 - bx0;
        const bh = by1 - by0;
        if (bw < 6 || bh < 6) continue;

        // Subdivide the block into lots; pack each with a building (or a
        // parking/greenery lot). Lot size varies so footprints differ.
        const cols = Math.max(1, Math.round(bw / (10 + this.rng() * 8)));
        const rows = Math.max(1, Math.round(bh / (10 + this.rng() * 8)));
        const lw = bw / cols;
        const lh = bh / rows;
        for (let lx = 0; lx < cols; lx++) {
          for (let ly = 0; ly < rows; ly++) {
            const ox0 = Math.round(bx0 + lx * lw) + 1;
            const oy0 = Math.round(by0 + ly * lh) + 1;
            const ow = Math.round(lw) - 2;
            const oh = Math.round(lh) - 2;
            if (ow < 3 || oh < 3) continue;
            const roll = this.rng();
            const lot = roll < 0.12 ? 2 : roll < 0.24 ? 1 : 0; // greenery / parking / building
            // Inset buildings a touch so neighbours read as distinct.
            const inset = lot === 0 ? 1 : 0;
            this.buildings.push({
              x: ox0 + inset,
              y: oy0 + inset,
              w: Math.max(3, ow - inset * 2),
              h: Math.max(3, oh - inset * 2),
              body: Math.floor(this.rng() * BUILDING_BODY.length),
              roof: Math.floor(this.rng() * ROOF_ACCENT.length),
              roofStyle: Math.floor(this.rng() * 3),
              height: this.rng(),
              lot,
            });
          }
        }
      }
    }
  }

  private stepAgents(downbeat: boolean): void {
    const stride = (downbeat ? 0.1 : 0.06) * (0.25 + this.morph);
    for (const car of this.cars) {
      car.pos += car.fwd * (stride + car.speed);
      if (car.pos > 1) car.pos -= 1;
      else if (car.pos < 0) car.pos += 1;
    }
    for (const ped of this.peds) {
      ped.pos += ped.fwd * stride * 0.6;
      if (ped.pos > 1) ped.pos -= 1;
      else if (ped.pos < 0) ped.pos += 1;
      ped.frame ^= 1;
      if (this.morph > 0.6 && this.rng() < 0.06) {
        ped.fwd = ped.fwd === 1 ? -1 : 1;
      }
    }
  }

  private spawnArc(): void {
    const a = this.arcs.find((x) => !x.active);
    if (!a) return;
    const p1 = this.pads[Math.floor(this.rng() * this.pads.length)];
    const p2 = this.pads[Math.floor(this.rng() * this.pads.length)];
    if (!p1 || !p2) return;
    a.ax = p1.x;
    a.ay = p1.y;
    a.bx = p2.x;
    a.by = p2.y;
    a.t = 0;
    a.life = 0.08 + this.rng() * 0.12;
    a.active = true;
  }

  private lerp(a: number, b: number, k: number): number {
    return a + (b - a) * k;
  }

  private posOnTrace(tr: Trace, pos: number): { x: number; y: number } {
    if (tr.dir === 0) return { x: tr.x + pos * tr.len, y: tr.y };
    return { x: tr.x, y: tr.y + pos * tr.len };
  }

  private paint(): void {
    const ctx = this.ctx2d;
    const m = this.morph;
    const beat = this.beat;
    const city = m;

    // ---- Ground: green PCB substrate -> dark asphalt-blue city ground. -------
    const subR = Math.floor(this.lerp(8, 13, city));
    const subG = Math.floor(this.lerp(30, 15, city));
    const subB = Math.floor(this.lerp(16, 22, city));
    ctx.fillStyle = `rgb(${subR},${subG},${subB})`;
    ctx.fillRect(0, 0, TEX_W, TEX_H);

    // Draw order: blocks (buildings) UNDER the roads so streets cut clean
    // corridors over the built-up land.
    if (city > 0.2) this.paintBlocks(ctx, city, beat);
    this.paintRoads(ctx, m, beat);
    this.paintArcs(ctx);
    this.paintComponents(ctx, m, beat);
    this.paintPads(ctx, m, beat);
    if (city < 0.7) this.paintPulses(ctx, m, city);
    if (city > 0.25) this.paintAgents(ctx, city, beat);

    this.tex.needsUpdate = true;
  }

  /** Dense city blocks: buildings (body + drop shadow + roof accent + windows),
   *  parking lots (striped) and greenery (dithered green). Fades in with morph. */
  private paintBlocks(ctx: CanvasRenderingContext2D, city: number, beat: number): void {
    const a = Math.min(1, (city - 0.2) / 0.4);
    ctx.globalAlpha = a;
    for (const b of this.buildings) {
      if (b.lot === 2) {
        // Greenery / park: dithered HGR-green checker.
        ctx.fillStyle = "#15431f";
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.fillStyle = "rgba(30,140,46,0.9)";
        for (let yy = b.y; yy < b.y + b.h; yy += 2) {
          for (let xx = b.x + (yy & 1); xx < b.x + b.w; xx += 2) ctx.fillRect(xx, yy, 1, 1);
        }
        continue;
      }
      if (b.lot === 1) {
        // Parking lot: dark tarmac with white stall stripes + a parked car dot.
        ctx.fillStyle = "#23252c";
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.fillStyle = "rgba(200,200,205,0.6)";
        for (let xx = b.x + 1; xx < b.x + b.w; xx += 3) ctx.fillRect(xx, b.y + 1, 1, b.h - 2);
        if (b.w >= 6 && b.h >= 5) {
          ctx.fillStyle = CAR_COLORS[b.body % CAR_COLORS.length];
          ctx.fillRect(b.x + 1, b.y + 1, 3, 2);
        }
        continue;
      }
      // Building: drop shadow (S/E), body, roof accent trim, lit windows.
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(b.x + 1, b.y + 1, b.w, b.h);
      ctx.fillStyle = BUILDING_BODY[b.body];
      ctx.fillRect(b.x, b.y, b.w, b.h);
      // Roof accent trim (HGR colour), style varies.
      ctx.fillStyle = ROOF_ACCENT[b.roof];
      if (b.roofStyle === 0) ctx.fillRect(b.x, b.y, b.w, 1);
      else if (b.roofStyle === 1) {
        ctx.fillRect(b.x, b.y, 1, b.h);
        ctx.fillRect(b.x + b.w - 1, b.y, 1, b.h);
      } else {
        ctx.fillRect(b.x, b.y, b.w, 1);
        ctx.fillRect(b.x, b.y, 1, b.h);
      }
      // Rooftop unit.
      if (b.w >= 5 && b.h >= 5) {
        ctx.fillStyle = "rgba(150,150,160,0.9)";
        ctx.fillRect(b.x + 2, b.y + 2, 2, 2);
      }
      // Lit windows: density scales with "height"; twinkles with beat.
      const lit = 0.4 + b.height * 0.5 + beat * 0.25;
      ctx.fillStyle = `rgba(255,224,150,${0.85})`;
      for (let wy = b.y + 2; wy < b.y + b.h - 1; wy += 2) {
        for (let wx = b.x + 2; wx < b.x + b.w - 1; wx += 2) {
          if (((wx * 7 + wy * 13) % 11) / 11 < lit - 0.4) ctx.fillRect(wx, wy, 1, 1);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Traces -> Spy-Hunter asphalt roads (asphalt bed, shoulders, dashed line). */
  private paintRoads(ctx: CanvasRenderingContext2D, m: number, beat: number): void {
    const city = m;
    const tr = Math.floor(this.lerp(40, 70, city));
    const tg = Math.floor(this.lerp(220, 80, city) + beat * 25);
    const tb = Math.floor(this.lerp(200, 90, city));
    const wireCol = `rgb(${tr},${Math.max(0, Math.min(255, tg))},${tb})`;

    for (const t of this.traces) {
      // Non-lattice "alley" traces stay thin wires/paths.
      const maxW = t.road ? this.roadW : 2;
      const width = Math.max(1, Math.round(this.lerp(1, maxW, city)));
      const half = width >> 1;

      if (city > 0.15 && t.road) {
        const sh = Math.floor(78 + beat * 18);
        ctx.fillStyle = `rgb(${sh},${sh},${sh + 6})`;
        if (t.dir === 0) ctx.fillRect(t.x, t.y - half - 1, t.len, width + 2);
        else ctx.fillRect(t.x - half - 1, t.y, width + 2, t.len);
        const as = Math.floor(38 + beat * 14);
        ctx.fillStyle = `rgb(${as},${as},${as + 6})`;
        if (t.dir === 0) ctx.fillRect(t.x, t.y - half, t.len, width);
        else ctx.fillRect(t.x - half, t.y, width, t.len);
      } else if (city > 0.15) {
        const pv = Math.floor(60 + beat * 12);
        ctx.fillStyle = `rgb(${pv},${pv},${pv + 8})`;
        if (t.dir === 0) ctx.fillRect(t.x, t.y - half, t.len, width);
        else ctx.fillRect(t.x - half, t.y, width, t.len);
      } else {
        ctx.fillStyle = wireCol;
        if (t.dir === 0) ctx.fillRect(t.x, t.y, t.len, 1);
        else ctx.fillRect(t.x, t.y, 1, t.len);
      }

      if (city < 0.85) {
        ctx.fillStyle = `rgba(${tr},${Math.max(0, Math.min(255, tg))},${tb},${1 - city * 0.9})`;
        if (t.dir === 0) ctx.fillRect(t.x, t.y, t.len, 1);
        else ctx.fillRect(t.x, t.y, 1, t.len);
      }

      if (city > 0.4 && t.road && width >= 5) {
        ctx.fillStyle = `rgba(235,205,70,${(city - 0.4) * 1.5})`;
        const step = 8;
        for (let d = 3; d < t.len - 2; d += step) {
          if (t.dir === 0) ctx.fillRect(t.x + d, t.y, 4, 1);
          else ctx.fillRect(t.x, t.y + d, 1, 4);
        }
      }
    }

    if (this.surge >= 0) {
      const sx = this.surge * TEX_W;
      const band = 14 + m * 20;
      ctx.fillStyle = `rgba(255,255,255,${(0.45 + 0.45 * beat) * (1 - city * 0.5)})`;
      for (const t of this.traces) {
        const tx = t.dir === 0 ? t.x + t.len / 2 : t.x;
        if (Math.abs(tx - sx) < band) {
          if (t.dir === 0) ctx.fillRect(t.x, t.y, t.len, 1);
          else ctx.fillRect(t.x, t.y, 1, t.len);
        }
      }
    }
  }

  /** Landmark feature buildings / chips layered over the dense fill. */
  private paintComponents(ctx: CanvasRenderingContext2D, m: number, beat: number): void {
    const city = m;
    const hgr = [HGR_BLUE, HGR_PURPLE, HGR_ORANGE, HGR_GREEN];
    for (const c of this.comps) {
      const bl = 0.5 + 0.5 * Math.sin(c.blink);
      const baseR = this.lerp(c.chip ? 18 : 60, 70 + c.hue * 50, city);
      const baseG = this.lerp(c.chip ? 40 : 120, 76 + c.hue * 40, city);
      const baseB = this.lerp(c.chip ? 30 : 70, 96 + c.hue * 50, city);
      // Drop shadow for landmarks in city form so they pop above the fill.
      if (city > 0.4) {
        ctx.fillStyle = `rgba(0,0,0,${0.4 * (city - 0.4) * 2})`;
        ctx.fillRect(c.x + 2, c.y + 2, c.w, c.h);
      }
      ctx.fillStyle = `rgb(${Math.floor(baseR)},${Math.floor(baseG)},${Math.floor(baseB)})`;
      ctx.fillRect(c.x, c.y, c.w, c.h);

      if (city < 0.7 && c.chip) {
        ctx.fillStyle = `rgba(190,190,150,${(0.7 - city) * 1.4})`;
        const gap = Math.max(2, Math.floor(c.w / (c.pins + 1)));
        for (let p = 1; p <= c.pins; p++) {
          const px = c.x + p * gap;
          if (px < c.x + c.w) {
            ctx.fillRect(px, c.y - 1, 1, 1);
            ctx.fillRect(px, c.y + c.h, 1, 1);
          }
        }
      }
      if (city > 0.35) {
        const wa = Math.min(1, (city - 0.35) * 1.5);
        ctx.globalAlpha = wa;
        ctx.fillStyle = hgr[(Math.floor(c.hue * 4)) % hgr.length];
        ctx.fillRect(c.x, c.y, c.w, 1);
        ctx.fillStyle = "rgba(150,150,160,1)";
        ctx.fillRect(c.x + 2, c.y + 2, 2, 2);
        ctx.fillStyle = `rgba(255,225,150,1)`;
        for (let wy = c.y + 2; wy < c.y + c.h - 1; wy += 2) {
          for (let wx = c.x + 2; wx < c.x + c.w - 1; wx += 2) {
            const v = ((wx * 7 + wy * 13) % 5) / 5 + bl * 0.4 + beat * 0.3;
            if (v > 0.85) ctx.fillRect(wx, wy, 1, 1);
          }
        }
        ctx.globalAlpha = 1;
      }
      if (city < 0.5 && c.chip) {
        ctx.fillStyle = `rgba(220,220,220,${(0.5 - city) * 2})`;
        ctx.fillRect(c.x + 1, c.y + 1, 1, 1);
      }
    }
  }

  private paintPads(ctx: CanvasRenderingContext2D, m: number, beat: number): void {
    const city = m;
    for (const pad of this.pads) {
      const bl = 0.5 + 0.5 * Math.sin(pad.blink);
      const r = Math.round(this.lerp(pad.r, pad.r + 2, city));
      const cr = Math.floor(this.lerp(90, 130, city) * (0.6 + bl * 0.4) + beat * 30);
      const cg = Math.floor(this.lerp(200, 130, city) * (0.6 + bl * 0.4) + beat * 20);
      const cb = Math.floor(this.lerp(120, 120, city) * (0.6 + bl * 0.4));
      ctx.fillStyle = `rgb(${Math.min(255, cr)},${Math.min(255, cg)},${Math.max(0, cb)})`;
      ctx.fillRect(pad.x - r, pad.y - r, r * 2, r * 2);
      if (city > 0.5) {
        // Plaza paving + fountain (HGR blue).
        ctx.fillStyle = `rgba(180,180,190,${(city - 0.5) * 1.2})`;
        ctx.fillRect(pad.x - r, pad.y - r, r * 2, 1);
        ctx.fillStyle = `rgba(59,107,255,${(city - 0.5) * 1.5 * (0.5 + beat)})`;
        ctx.fillRect(pad.x, pad.y, 1, 1);
      }
    }
  }

  private paintPulses(ctx: CanvasRenderingContext2D, m: number, city: number): void {
    const fade = 1 - city / 0.7;
    for (const p of this.pulses) {
      const t = this.traces[p.trace];
      if (!t) continue;
      const { x, y } = this.posOnTrace(t, p.pos);
      const r = Math.floor(this.lerp(120, 255, m));
      const g = Math.floor(this.lerp(255, 90, m));
      const b = Math.floor(this.lerp(255, 70, m));
      ctx.fillStyle = `rgba(${r},${Math.max(0, g)},${Math.max(0, b)},${fade})`;
      ctx.fillRect(Math.floor(x), Math.floor(y) - 1, 2, 3);
    }
  }

  /** Cars (Spy-Hunter sprites) + 2-frame pixel people (city era). */
  private paintAgents(ctx: CanvasRenderingContext2D, city: number, beat: number): void {
    const alpha = Math.min(1, (city - 0.25) / 0.45);

    for (const car of this.cars) {
      const t = this.traces[car.trace];
      if (!t) continue;
      let dp = car.pos - car.step;
      if (dp > 0.5) dp -= 1;
      else if (dp < -0.5) dp += 1;
      car.step += dp * 0.35;
      if (car.step > 1) car.step -= 1;
      else if (car.step < 0) car.step += 1;

      const { x, y } = this.posOnTrace(t, car.step);
      const ox = t.dir === 0 ? 0 : car.lane * 2;
      const oy = t.dir === 0 ? car.lane * 2 : 0;
      const cx = Math.floor(x + ox);
      const cy = Math.floor(y + oy);
      const body = CAR_COLORS[car.color];

      ctx.globalAlpha = alpha;
      if (t.dir === 0) {
        // Horizontal car: 7 long x 4 wide with a roof/windshield + cabin.
        ctx.fillStyle = body;
        ctx.fillRect(cx - 3, cy - 2, 7, 4);
        // Cabin roof (darker) toward the rear, windshield bright line at front.
        ctx.fillStyle = "rgba(15,22,40,1)";
        ctx.fillRect(cx + (car.fwd > 0 ? -2 : 0), cy - 1, 2, 2);
        ctx.fillStyle = "rgba(120,180,230,0.9)";
        ctx.fillRect(cx + (car.fwd > 0 ? 1 : -1), cy - 1, 1, 2);
        // Headlights at nose (brighter on beat).
        ctx.fillStyle = `rgba(255,250,200,${0.6 + beat * 0.4})`;
        ctx.fillRect(cx + (car.fwd > 0 ? 4 : -4), cy - 2, 1, 1);
        ctx.fillRect(cx + (car.fwd > 0 ? 4 : -4), cy + 1, 1, 1);
      } else {
        ctx.fillStyle = body;
        ctx.fillRect(cx - 2, cy - 3, 4, 7);
        ctx.fillStyle = "rgba(15,22,40,1)";
        ctx.fillRect(cx - 1, cy + (car.fwd > 0 ? -2 : 0), 2, 2);
        ctx.fillStyle = "rgba(120,180,230,0.9)";
        ctx.fillRect(cx - 1, cy + (car.fwd > 0 ? 1 : -1), 2, 1);
        ctx.fillStyle = `rgba(255,250,200,${0.6 + beat * 0.4})`;
        ctx.fillRect(cx - 2, cy + (car.fwd > 0 ? 4 : -4), 1, 1);
        ctx.fillRect(cx + 1, cy + (car.fwd > 0 ? 4 : -4), 1, 1);
      }
      ctx.globalAlpha = 1;
    }

    // People: a 3px figure (head + torso + legs) with a 2-frame stride.
    for (const ped of this.peds) {
      const t = this.traces[ped.trace];
      if (!t) continue;
      let dp = ped.pos - ped.step;
      if (dp > 0.5) dp -= 1;
      else if (dp < -0.5) dp += 1;
      ped.step += dp * 0.3;
      if (ped.step > 1) ped.step -= 1;
      else if (ped.step < 0) ped.step += 1;

      const { x, y } = this.posOnTrace(t, ped.step);
      const px = Math.floor(t.dir === 0 ? x : x + ped.off);
      const py = Math.floor(t.dir === 0 ? y + ped.off : y);
      const shirt =
        ped.hue < 0.33 ? HGR_ORANGE : ped.hue < 0.66 ? HGR_BLUE : HGR_PURPLE;
      ctx.globalAlpha = alpha * 0.95;
      ctx.fillStyle = "rgba(245,210,170,1)"; // head
      ctx.fillRect(px, py - 1, 1, 1);
      ctx.fillStyle = shirt; // torso
      ctx.fillRect(px, py, 1, 1);
      ctx.fillStyle = "rgba(40,40,55,1)"; // stepping foot
      ctx.fillRect(px + (ped.frame ? 1 : -1), py + 1, 1, 1);
      ctx.globalAlpha = 1;
    }
  }

  private paintArcs(ctx: CanvasRenderingContext2D): void {
    for (const a of this.arcs) {
      if (!a.active) continue;
      const k = a.t / a.life;
      const alpha = Math.sin(Math.min(1, k) * Math.PI);
      ctx.strokeStyle = `rgba(180,230,255,${alpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(a.ax, a.ay);
      const segs = 4;
      for (let s = 1; s <= segs; s++) {
        const f = s / segs;
        const jx = (this.rng() - 0.5) * 8 * (1 - Math.abs(f - 0.5) * 2);
        const jy = (this.rng() - 0.5) * 8 * (1 - Math.abs(f - 0.5) * 2);
        ctx.lineTo(a.ax + (a.bx - a.ax) * f + jx, a.ay + (a.by - a.ay) * f + jy);
      }
      ctx.stroke();
    }
  }

  update(dt: number, _audioTime: number): void {
    this.t += dt;

    this.morph += (this.morphTarget - this.morph) * dt * 1.5;
    const m = this.morph;

    if (this.beat > 0) this.beat = Math.max(0, this.beat - dt * this.beatDecay);

    if (this.surge >= 0) {
      this.surge += dt * (2.2 + m * 2.0);
      if (this.surge > 1.1) this.surge = -1;
    }

    for (const p of this.pulses) {
      p.pos += dt * p.speed * (1 + this.beat * 1.5) * (1 - m * 0.6);
      if (p.pos > 1) {
        p.pos -= 1;
        if (this.rng() < 0.3) p.trace = Math.floor(this.rng() * this.traces.length);
      }
    }

    const crawl = dt * (0.05 + m * 0.12);
    for (const car of this.cars) {
      car.pos += car.fwd * crawl * (car.speed * 8);
      if (car.pos > 1) car.pos -= 1;
      else if (car.pos < 0) car.pos += 1;
    }

    for (const c of this.comps) c.blink += dt * c.blinkRate * (1 + m);
    for (const pad of this.pads) pad.blink += dt * pad.blinkRate * (1 + m);

    for (const a of this.arcs) {
      if (!a.active) continue;
      a.t += dt;
      if (a.t >= a.life) a.active = false;
    }

    this.paint();

    this.mat.color.setScalar(1 + this.beat * 0.3 + m * 0.12);

    if (this.scene && this.scene.background instanceof THREE.Color) {
      this.scene.background.setRGB(
        0.016 + m * 0.02,
        Math.max(0, 0.074 - m * 0.045),
        0.04 + m * 0.05,
      );
    }

    if (this.camera) {
      const pushIn = this.beat * 4 + m * 3;
      let px = 0;
      let py = this.camBaseY - pushIn;
      let pz = -40;
      if (this.shake > 0) {
        this.shake = Math.max(0, this.shake - dt * 6);
        const a = this.shake;
        px += (Math.random() - 0.5) * a * 2.2;
        py += (Math.random() - 0.5) * a * 1.2;
        pz += (Math.random() - 0.5) * a * 2.2;
      }
      this.camera.position.set(px, py, pz);
      this.camera.lookAt(0, -10, -40);
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

    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.tex.dispose();
    this.traces = [];
    this.pulses = [];
    this.buildings = [];
    this.comps = [];
    this.pads = [];
    this.cars = [];
    this.peds = [];
    this.arcs = [];
    this.colX = [];
    this.rowY = [];
    this.camera = null;
  }
}

const def: EddieBackgroundDef = {
  id: "bg07",
  label: "Circuit Board -> Spy Hunter City",
  blurb:
    "A richly detailed top-down PCB — neon traces with data pulses, ICs with pins, caps, resistors and pads — that morphs with rising intensity into a DENSE 80s-arcade top-down pixel city: every block between the Spy-Hunter streets packed with HGR-palette buildings (varied footprints/rooftops), parking lots and greenery, with shoulders and dashed centre lines, sprite cars driving the corridors and 2-frame pixel people on the sidewalks — all stepping forward on every beat.",
  create: () => new Bg07(),
};

export default def;
