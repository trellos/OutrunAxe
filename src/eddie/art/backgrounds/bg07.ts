// bg07 — "Circuit Board -> Spy Hunter Pixel City" — a richly detailed top-down
// PCB that transforms into a bustling top-down 80s-arcade pixel city as
// performance intensity climbs. Three.js scene decoration (visuals only, §8).
//
// VISUAL TARGET (researched references):
//   * SPY HUNTER (Bally Midway, 1983) — top-down vertically-scrolling roads with
//     shoulders + dashed centre line, and chunky readable top-down CAR sprites
//     (distinct body + windshield, a few colours).
//       https://en.wikipedia.org/wiki/Spy_Hunter
//       https://www.mobygames.com/game/7668/spy-hunter/screenshots/arcade/
//   * 720 DEGREES (Atari, 1986) — top-down neighbourhood/Skate-City with little
//     recognisable walking FIGURES, cars, streets, lots and parks.
//       https://en.wikipedia.org/wiki/720%C2%B0
//       https://www.arcade-history.com/game/23/720_degrees
//   * APPLE //e HGR hi-res — the 6-colour artifact palette: black, white, GREEN,
//     PURPLE/VIOLET, ORANGE, BLUE — chunky 140-wide pixels, "clashy" bright look.
//       https://en.wikipedia.org/wiki/Apple_II_graphics
//       https://www.xtof.info/hires-graphics-apple-ii.html
//
// The whole board is one low-res CanvasTexture (NearestFilter, pixely) on a FLAT
// quad with the camera looking straight down. An eased `morph` (0..1) cross-fades
// every element between circuit and city — it NEVER snaps
// (morph += (target-morph)*dt*1.5):
//   morph 0 -> CIRCUIT: green substrate, dense neon traces with DATA PULSES, and
//              many components — ICs/chips with pins, caps, resistors, LEDs, pads.
//   mid     -> dissolve: traces widen into roads, chip pins fade into building
//              windows, electric arcs jump between pads, a city block grid fades in.
//   morph 1 -> SPY-HUNTER PIXEL CITY: asphalt roads with shoulders + dashed
//              centre lines, HGR-palette buildings with rooftops/parking/greenery,
//              plazas, sprite CARS (body+windshield, several types) driving the
//              roads, and little 2-frame PEOPLE walking sidewalks. Cars + people
//              STEP forward on every beat; the city pulses with traffic on-beat.
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

// Low-res texture = crisp pixels under NearestFilter. HGR-ish chunky aspect.
const TEX_W = 224;
const TEX_H = 144;

const TRACE_COUNT = 30; // roads
const COMP_COUNT = 22; // chips/buildings + caps/resistors
const PAD_COUNT = 14; // solder pads / plazas
const PULSE_COUNT = 48; // data pulses (circuit era)
const CAR_COUNT = 26; // cars (city era) — bound to roads
const PED_COUNT = 40; // pixel people (city era)

// Apple //e HGR 6-colour artifact palette (the authentic clashy set).
const HGR_GREEN = "#1efe1e";
const HGR_PURPLE = "#a93bff";
const HGR_ORANGE = "#ff7e1e";
const HGR_BLUE = "#3b6bff";
const HGR_WHITE = "#f6f6f6";
// Car body colours drawn from that palette (+ a couple of mixes) so the traffic
// reads as Spy-Hunter-era sprites.
const CAR_COLORS = [HGR_BLUE, HGR_ORANGE, HGR_GREEN, HGR_PURPLE, HGR_WHITE, "#e23b3b"];

type Dir = 0 | 1; // 0 = horizontal road, 1 = vertical road

interface Trace {
  x: number; // start (tex px)
  y: number;
  len: number;
  dir: Dir;
}

interface Pulse {
  trace: number;
  pos: number; // 0..1 along the trace
  speed: number;
}

// Component: an IC/chip (big, pins) OR a small two-pin part (cap/resistor).
// In city form it becomes a building (chip) or a low structure/lot (small).
interface Comp {
  x: number;
  y: number;
  w: number;
  h: number;
  chip: boolean;
  pins: number;
  hue: number; // building palette pick / tint variance
  roof: number; // rooftop style 0..2
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
  pos: number; // 0..1 along road
  step: number; // animated position (eases toward pos)
  speed: number;
  fwd: 1 | -1;
  color: number; // index into CAR_COLORS
  lane: number; // -1 / +1 side of the centreline
}

interface Ped {
  trace: number;
  pos: number;
  step: number;
  fwd: 1 | -1;
  off: number; // perpendicular sidewalk offset
  hue: number;
  frame: number; // walk-cycle phase (advanced on the beat)
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
  private comps: Comp[] = [];
  private pads: Pad[] = [];
  private cars: Car[] = [];
  private peds: Ped[] = [];
  private arcs: Arc[] = [];

  private camera: THREE.PerspectiveCamera | null = null;
  private camBaseY = 120; // camera height above the flat board (top-down)

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
    // --- Roads / traces: a grid-ish set of orthogonal runs (the street net). --
    for (let i = 0; i < TRACE_COUNT; i++) {
      const dir: Dir = this.rng() < 0.5 ? 0 : 1;
      if (dir === 0) {
        const y = 8 + Math.floor(this.rng() * (TEX_H - 16));
        const x = Math.floor(this.rng() * (TEX_W - 56));
        const len = 32 + Math.floor(this.rng() * (TEX_W - x - 6 - 32));
        this.traces.push({ x, y, len: Math.max(28, len), dir });
      } else {
        const x = 8 + Math.floor(this.rng() * (TEX_W - 16));
        const y = Math.floor(this.rng() * (TEX_H - 48));
        const len = 26 + Math.floor(this.rng() * (TEX_H - y - 6 - 26));
        this.traces.push({ x, y, len: Math.max(22, len), dir });
      }
    }

    // --- Components -> buildings. Mix of big chips and small two-pin parts. ---
    for (let i = 0; i < COMP_COUNT; i++) {
      const chip = this.rng() < 0.55;
      const w = chip ? 14 + Math.floor(this.rng() * 18) : 6 + Math.floor(this.rng() * 8);
      const h = chip ? 12 + Math.floor(this.rng() * 16) : 5 + Math.floor(this.rng() * 7);
      this.comps.push({
        x: 6 + Math.floor(this.rng() * (TEX_W - w - 12)),
        y: 6 + Math.floor(this.rng() * (TEX_H - h - 12)),
        w,
        h,
        chip,
        pins: 3 + Math.floor(this.rng() * 4),
        hue: this.rng(),
        roof: Math.floor(this.rng() * 3),
        blink: this.rng() * Math.PI * 2,
        blinkRate: 1.2 + this.rng() * 3.5,
      });
    }

    // --- Pads -> plazas. ------------------------------------------------------
    for (let i = 0; i < PAD_COUNT; i++) {
      this.pads.push({
        x: 10 + Math.floor(this.rng() * (TEX_W - 20)),
        y: 10 + Math.floor(this.rng() * (TEX_H - 20)),
        r: 2 + Math.floor(this.rng() * 3),
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

    // --- Cars bound to roads (city era). --------------------------------------
    for (let i = 0; i < CAR_COUNT; i++) {
      const p = this.rng();
      this.cars.push({
        trace: Math.floor(this.rng() * this.traces.length),
        pos: p,
        step: p,
        speed: 0.04 + this.rng() * 0.06,
        fwd: this.rng() < 0.5 ? 1 : -1,
        color: Math.floor(this.rng() * CAR_COLORS.length),
        lane: this.rng() < 0.5 ? -1 : 1,
      });
    }

    // --- Pixel people (city era). ---------------------------------------------
    for (let i = 0; i < PED_COUNT; i++) {
      const p = this.rng();
      this.peds.push({
        trace: Math.floor(this.rng() * this.traces.length),
        pos: p,
        step: p,
        fwd: this.rng() < 0.5 ? 1 : -1,
        off: (this.rng() < 0.5 ? -1 : 1) * (3 + Math.floor(this.rng() * 2)),
        hue: this.rng(),
        frame: Math.floor(this.rng() * 2),
      });
    }

    // --- Arc pool (inactive), used during the dissolve. -----------------------
    for (let i = 0; i < 10; i++) {
      this.arcs.push({ ax: 0, ay: 0, bx: 0, by: 0, life: 1, t: 0, active: false });
    }
  }

  /** A beat: advance every car + person one stride; people also flip walk frame. */
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
      ped.frame ^= 1; // toggle walk frame each beat (720°-style stride)
      if (this.morph > 0.6 && this.rng() < 0.08) {
        ped.fwd = ped.fwd === 1 ? -1 : 1;
        if (this.rng() < 0.4) ped.trace = Math.floor(this.rng() * this.traces.length);
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
    const subR = Math.floor(this.lerp(8, 14, city));
    const subG = Math.floor(this.lerp(30, 16, city));
    const subB = Math.floor(this.lerp(16, 24, city));
    ctx.fillStyle = `rgb(${subR},${subG},${subB})`;
    ctx.fillRect(0, 0, TEX_W, TEX_H);

    // Faint city block parcels fade in (greenery + lots between roads).
    if (city > 0.25) {
      const a = (city - 0.25) * 0.5;
      // Grass/greenery patches (HGR green, dimmed).
      ctx.fillStyle = `rgba(20,90,30,${a})`;
      for (let gy = 0; gy < TEX_H; gy += 32) {
        for (let gx = 0; gx < TEX_W; gx += 32) {
          if (((gx * 3 + gy * 5) % 7) < 3) ctx.fillRect(gx + 2, gy + 2, 12, 10);
        }
      }
      ctx.fillStyle = `rgba(40,55,72,${a})`;
      for (let gx = 0; gx < TEX_W; gx += 16) ctx.fillRect(gx, 0, 1, TEX_H);
      for (let gy = 0; gy < TEX_H; gy += 16) ctx.fillRect(0, gy, TEX_W, 1);
    }

    this.paintRoads(ctx, m, beat);
    this.paintArcs(ctx);
    this.paintComponents(ctx, m, beat);
    this.paintPads(ctx, m, beat);
    if (city < 0.7) this.paintPulses(ctx, m, city);
    if (city > 0.25) this.paintAgents(ctx, city, beat);

    this.tex.needsUpdate = true;
  }

  /** Traces (neon wires) cross-fade into Spy-Hunter asphalt roads: a dark road
   *  bed, lighter shoulders, and a dashed yellow centre line. */
  private paintRoads(ctx: CanvasRenderingContext2D, m: number, beat: number): void {
    const city = m;
    const tr = Math.floor(this.lerp(40, 70, city));
    const tg = Math.floor(this.lerp(220, 80, city) + beat * 25);
    const tb = Math.floor(this.lerp(200, 90, city));
    const wireCol = `rgb(${tr},${Math.max(0, Math.min(255, tg))},${tb})`;

    for (const t of this.traces) {
      const width = Math.max(1, Math.round(this.lerp(1, 7, city)));
      const half = width >> 1;

      if (city > 0.15) {
        // Shoulders (lighter grey kerbs) flanking the asphalt.
        const sh = Math.floor(72 + beat * 18);
        ctx.fillStyle = `rgb(${sh},${sh},${sh + 6})`;
        if (t.dir === 0) ctx.fillRect(t.x, t.y - half - 1, t.len, width + 2);
        else ctx.fillRect(t.x - half - 1, t.y, width + 2, t.len);
        // Asphalt bed.
        const as = Math.floor(40 + beat * 14);
        ctx.fillStyle = `rgb(${as},${as},${as + 6})`;
        if (t.dir === 0) ctx.fillRect(t.x, t.y - half, t.len, width);
        else ctx.fillRect(t.x - half, t.y, width, t.len);
      } else {
        ctx.fillStyle = wireCol;
        if (t.dir === 0) ctx.fillRect(t.x, t.y, t.len, 1);
        else ctx.fillRect(t.x, t.y, 1, t.len);
      }

      // Neon wire core lingers while circuit-y, fades as the road takes over.
      if (city < 0.85) {
        ctx.fillStyle = `rgba(${tr},${Math.max(0, Math.min(255, tg))},${tb},${1 - city * 0.9})`;
        if (t.dir === 0) ctx.fillRect(t.x, t.y, t.len, 1);
        else ctx.fillRect(t.x, t.y, 1, t.len);
      }

      // Dashed yellow centre line fades in as the road forms.
      if (city > 0.4 && width >= 4) {
        ctx.fillStyle = `rgba(235,205,70,${(city - 0.4) * 1.5})`;
        const step = 6;
        for (let d = 2; d < t.len - 1; d += step) {
          if (t.dir === 0) ctx.fillRect(t.x + d, t.y, 3, 1);
          else ctx.fillRect(t.x, t.y + d, 1, 3);
        }
      }
    }

    // Data/traffic surge wavefront across X (bright sweep; reads as a flash).
    if (this.surge >= 0) {
      const sx = this.surge * TEX_W;
      const band = 10 + m * 16;
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

  /** Components: ICs/chips (pins) -> HGR-palette buildings (rooftops + windows). */
  private paintComponents(ctx: CanvasRenderingContext2D, m: number, beat: number): void {
    const city = m;
    const hgr = [HGR_BLUE, HGR_PURPLE, HGR_ORANGE, HGR_GREEN];
    for (const c of this.comps) {
      const bl = 0.5 + 0.5 * Math.sin(c.blink);

      // Body: chip black/green (circuit) -> tinted HGR concrete (city).
      const baseR = this.lerp(c.chip ? 18 : 60, 64 + c.hue * 40, city);
      const baseG = this.lerp(c.chip ? 40 : 120, 70 + c.hue * 36, city);
      const baseB = this.lerp(c.chip ? 30 : 70, 88 + c.hue * 44, city);
      ctx.fillStyle = `rgb(${Math.floor(baseR)},${Math.floor(baseG)},${Math.floor(baseB)})`;
      ctx.fillRect(c.x, c.y, c.w, c.h);

      // Chip pins (circuit) fade out.
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

      // City building details fade in: an HGR-coloured rooftop edge + windows.
      if (city > 0.35) {
        const wa = Math.min(1, (city - 0.35) * 1.5);
        // Rooftop trim (HGR accent) — distinct per building.
        ctx.fillStyle = hgr[((c.roof + Math.floor(c.hue * 4)) % hgr.length)];
        ctx.globalAlpha = wa;
        if (c.roof === 0) ctx.fillRect(c.x, c.y, c.w, 1); // flat parapet
        else if (c.roof === 1) {
          ctx.fillRect(c.x, c.y, 1, c.h); // ridge down one side
          ctx.fillRect(c.x + c.w - 1, c.y, 1, c.h);
        } else {
          ctx.fillRect(c.x + (c.w >> 1) - 1, c.y, 2, c.h); // central ridge
        }
        // Rooftop HVAC/water-tank dot.
        ctx.fillStyle = "rgba(150,150,160,1)";
        ctx.fillRect(c.x + 2, c.y + 2, 2, 2);
        ctx.globalAlpha = 1;

        // Lit windows: warm grid, twinkling with blink + beat.
        for (let wy = c.y + 2; wy < c.y + c.h - 1; wy += 3) {
          for (let wx = c.x + 2; wx < c.x + c.w - 1; wx += 3) {
            const lit = ((wx * 7 + wy * 13) % 5) / 5 + bl * 0.4 + beat * 0.3;
            if (lit > 0.8) {
              ctx.fillStyle = `rgba(255,225,150,${wa})`;
              ctx.fillRect(wx, wy, 1, 1);
            }
          }
        }
      }

      // IC orientation pip (circuit only).
      if (city < 0.5 && c.chip) {
        ctx.fillStyle = `rgba(220,220,220,${(0.5 - city) * 2})`;
        ctx.fillRect(c.x + 1, c.y + 1, 1, 1);
      }
    }
  }

  /** Pads (solder points) -> plazas (open lit squares). */
  private paintPads(ctx: CanvasRenderingContext2D, m: number, beat: number): void {
    const city = m;
    for (const pad of this.pads) {
      const bl = 0.5 + 0.5 * Math.sin(pad.blink);
      const r = Math.round(this.lerp(pad.r, pad.r + 2, city));
      const cr = Math.floor(this.lerp(90, 120, city) * (0.6 + bl * 0.4) + beat * 30);
      const cg = Math.floor(this.lerp(200, 120, city) * (0.6 + bl * 0.4) + beat * 20);
      const cb = Math.floor(this.lerp(120, 110, city) * (0.6 + bl * 0.4));
      ctx.fillStyle = `rgb(${Math.min(255, cr)},${Math.min(255, cg)},${Math.max(0, cb)})`;
      ctx.fillRect(pad.x - r, pad.y - r, r * 2, r * 2);
      if (city > 0.5) {
        // Plaza centrepiece (HGR-blue fountain pixel).
        ctx.fillStyle = `rgba(59,107,255,${(city - 0.5) * 1.5 * (0.5 + beat)})`;
        ctx.fillRect(pad.x, pad.y, 1, 1);
      }
    }
  }

  /** Data pulses gliding along traces (circuit era; fades out as city forms). */
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

  /** Cars (Spy-Hunter sprites) + 2-frame pixel people on the roads (city era). */
  private paintAgents(ctx: CanvasRenderingContext2D, city: number, beat: number): void {
    const alpha = Math.min(1, (city - 0.25) / 0.45);

    // --- Cars: a top-down body with a windshield band + headlights. ----------
    for (const car of this.cars) {
      const t = this.traces[car.trace];
      if (!t) continue;
      // Ease render position toward the beat-advanced target (snap-then-glide).
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
        // Horizontal road: car is 5 long x 3 wide, nose in travel direction.
        ctx.fillStyle = body;
        ctx.fillRect(cx - 2, cy - 1, 5, 3);
        // Windshield (dark band, slightly toward the rear).
        ctx.fillStyle = "rgba(20,30,50,1)";
        ctx.fillRect(cx + (car.fwd > 0 ? -1 : 0), cy - 1, 1, 3);
        // Headlights at the nose (brighter on the beat).
        ctx.fillStyle = `rgba(255,250,200,${0.6 + beat * 0.4})`;
        ctx.fillRect(cx + (car.fwd > 0 ? 3 : -3), cy - 1, 1, 1);
        ctx.fillRect(cx + (car.fwd > 0 ? 3 : -3), cy + 1, 1, 1);
      } else {
        // Vertical road: car is 3 wide x 5 long.
        ctx.fillStyle = body;
        ctx.fillRect(cx - 1, cy - 2, 3, 5);
        ctx.fillStyle = "rgba(20,30,50,1)";
        ctx.fillRect(cx - 1, cy + (car.fwd > 0 ? -1 : 0), 3, 1);
        ctx.fillStyle = `rgba(255,250,200,${0.6 + beat * 0.4})`;
        ctx.fillRect(cx - 1, cy + (car.fwd > 0 ? 3 : -3), 1, 1);
        ctx.fillRect(cx + 1, cy + (car.fwd > 0 ? 3 : -3), 1, 1);
      }
      ctx.globalAlpha = 1;
    }

    // --- People: a 2px figure (head over body), 2-frame walk via leg pixel. ---
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
      // Shirt colour from the HGR-ish palette; head a skin pixel.
      const shirt =
        ped.hue < 0.33 ? HGR_ORANGE : ped.hue < 0.66 ? HGR_BLUE : HGR_PURPLE;
      ctx.globalAlpha = alpha * 0.95;
      ctx.fillStyle = "rgba(245,210,170,1)"; // head
      ctx.fillRect(px, py - 1, 1, 1);
      ctx.fillStyle = shirt; // body
      ctx.fillRect(px, py, 1, 1);
      // Walk cycle: a foot pixel steps side-to-side with the 2-frame stride.
      ctx.fillStyle = "rgba(40,40,55,1)";
      ctx.fillRect(px + (ped.frame ? 1 : -1), py + 1, 1, 1);
      ctx.globalAlpha = 1;
    }
  }

  /** Electric arcs jumping between pads during the dissolve. */
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

    // Ease morph toward target (never snap).
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

    // Cars drift slightly between beats so motion isn't strictly stepped.
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
    this.comps = [];
    this.pads = [];
    this.cars = [];
    this.peds = [];
    this.arcs = [];
    this.camera = null;
  }
}

const def: EddieBackgroundDef = {
  id: "bg07",
  label: "Circuit Board -> Spy Hunter City",
  blurb:
    "A richly detailed top-down PCB — neon traces with data pulses, ICs with pins, caps, resistors and pads — that morphs with rising intensity into an 80s-arcade top-down pixel city: Spy-Hunter asphalt roads with shoulders and dashed centre lines, HGR-palette buildings with rooftops and lit windows, plazas and greenery, sprite cars (body + windshield, several colours) driving the streets and little 2-frame pixel people walking the sidewalks — all stepping forward on every beat.",
  create: () => new Bg07(),
};

export default def;
