// bg07 — "Circuit Board -> Pixel City" — a richly detailed top-down PCB that
// transforms into a bustling top-down pixel SimCity as performance intensity
// climbs. Three.js scene decoration (visuals only, GDD §8).
//
// The whole board is one low-res CanvasTexture (NearestFilter, pixely) rendered
// straight down (camera looks -Y at the quad laid flat) for a crisp top-down
// pixel-city look. An eased `morph` (0..1) cross-fades every element between its
// circuit form and its city form — it NEVER snaps (morph += (target-morph)*dt*k):
//   morph 0  -> CIRCUIT: green substrate, a dense network of neon traces with
//               DATA PULSES travelling along them, plus many components — ICs/
//               chips with pins, capacitors, resistors, LEDs and solder pads.
//   morph ~  -> the board cross-dissolves: traces widen into ROADS, components
//               fill in as BUILDINGS / city blocks, pads open into PLAZAS.
//   morph 1  -> PIXEL CITY: top-down SimCity — asphalt roads with lane dashes,
//               lit buildings, plazas, CARS driving the roads and PEOPLE (pixel
//               dots) milling about. Cars + people STEP TO THE BEAT (advance on
//               each beat pulse); the city pulses with traffic on the beat.
//
// Juice (all three required):
//   eddieBeatPulse  -> circuit: a bright wavefront sweeps the traces / data
//                      surge. city: every car + person STEPS forward one stride
//                      and the city flashes (downbeat stronger). Stored as a
//                      decaying `beat` pump for continuous glow.
//   eddieShake      -> decaying camera jolt.
//   eddieIntensity  -> stored as `morphTarget`; `morph` eases toward it/frame.
//
// dispose() restores scene.background/fog, disposes every geometry/material/
// texture and unsubscribes all listeners. Bloom-safe; the board quad is
// frustumCulled=false.

import * as THREE from "three";
import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";
import type { EddieBackgroundDef, EddieBackgroundVariant } from "./types";

// Low-res texture = crisp pixels under NearestFilter. Tall-ish 4:3-ish board.
const TEX_W = 224;
const TEX_H = 144;

const TRACE_COUNT = 30; // roads
const COMP_COUNT = 22; // chips/buildings + caps/resistors
const PAD_COUNT = 14; // solder pads / plazas
const PULSE_COUNT = 48; // data pulses (circuit) — reused as nothing in city
const CAR_COUNT = 28; // cars (city) — bound to roads
const PED_COUNT = 40; // pixel people (city)

type Dir = 0 | 1; // 0 = horizontal road, 1 = vertical road

interface Trace {
  x: number; // start (tex px)
  y: number;
  len: number;
  dir: Dir;
}

interface Pulse {
  trace: number; // index into traces
  pos: number; // 0..1 along the trace
  speed: number;
}

// Component: an IC/chip (big, with pins) OR a small two-pin part (cap/resistor).
// In city form it becomes a building (chip) or a small structure (small part).
interface Comp {
  x: number; // top-left (tex px)
  y: number;
  w: number;
  h: number;
  chip: boolean; // true = IC/chip/tall building, false = small part/low building
  pins: number; // pin count per long side (chips only)
  hue: number; // building tint variance 0..1
  blink: number; // LED/window blink phase
  blinkRate: number;
}

interface Pad {
  x: number;
  y: number;
  r: number;
  blink: number;
  blinkRate: number;
}

// City agents. Cars ride a trace/road; people drift on a road then wander.
interface Car {
  trace: number;
  pos: number; // 0..1 along road
  step: number; // current animated position (eases toward pos for smoothness)
  speed: number; // base crawl between beats
  fwd: 1 | -1; // direction of travel
  hue: number; // tail/head light + body tint
  lane: number; // -1 / +1 side of the road centerline
}

interface Ped {
  trace: number;
  pos: number;
  step: number;
  fwd: 1 | -1;
  off: number; // perpendicular sidewalk offset
  hue: number;
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
  private beat = 0; // beat pump, decays
  private beatDecay = 4;
  private surge = -1; // data wavefront 0..1 sweeping the board; <0 = idle
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
    // The board lies FLAT (rotated to face up); camera looks straight down.
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
      this.surge = 0; // launch a data wavefront (reads as a city flash too)
      this.stepAgents(e.downbeat); // cars + people advance ON the beat
      // Circuit-era arc flashes during the mid-morph dissolve.
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
      const w = chip ? 12 + Math.floor(this.rng() * 18) : 5 + Math.floor(this.rng() * 7);
      const h = chip ? 10 + Math.floor(this.rng() * 16) : 4 + Math.floor(this.rng() * 6);
      this.comps.push({
        x: 6 + Math.floor(this.rng() * (TEX_W - w - 12)),
        y: 6 + Math.floor(this.rng() * (TEX_H - h - 12)),
        w,
        h,
        chip,
        pins: 3 + Math.floor(this.rng() * 4),
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
        hue: this.rng(),
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
        off: (this.rng() < 0.5 ? -1 : 1) * (2 + Math.floor(this.rng() * 2)),
        hue: this.rng(),
      });
    }

    // --- Arc pool (inactive), used during the dissolve. -----------------------
    for (let i = 0; i < 10; i++) {
      this.arcs.push({ ax: 0, ay: 0, bx: 0, by: 0, life: 1, t: 0, active: false });
    }
  }

  /** A beat: advance every car + person one stride along its road (city step).
   *  Strength scales with morph so it only really "walks" once the city forms. */
  private stepAgents(downbeat: boolean): void {
    const stride = (downbeat ? 0.10 : 0.06) * (0.25 + this.morph);
    for (const car of this.cars) {
      car.pos += car.fwd * (stride + car.speed);
      if (car.pos > 1) car.pos -= 1;
      else if (car.pos < 0) car.pos += 1;
    }
    for (const ped of this.peds) {
      ped.pos += ped.fwd * stride * 0.6;
      if (ped.pos > 1) ped.pos -= 1;
      else if (ped.pos < 0) ped.pos += 1;
      // Occasionally a pedestrian turns around or hops streets at high morph.
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

  /** Linear blend helper. */
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
    const city = m; // 0 circuit .. 1 city

    // ---- Substrate / ground: green PCB -> dark asphalt-blue city ground. -----
    const subR = Math.floor(this.lerp(8, 16, city));
    const subG = Math.floor(this.lerp(30, 18, city));
    const subB = Math.floor(this.lerp(16, 26, city));
    ctx.fillStyle = `rgb(${subR},${subG},${subB})`;
    ctx.fillRect(0, 0, TEX_W, TEX_H);

    // Faint city block grid fades IN with morph (parcels between roads).
    if (city > 0.2) {
      ctx.fillStyle = `rgba(40,60,80,${0.25 * city})`;
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

  /** Traces (neon wires) cross-fade into asphalt roads with lane dashes. */
  private paintRoads(ctx: CanvasRenderingContext2D, m: number, beat: number): void {
    const city = m;
    // Trace neon color: cyan/green, brightened by the beat.
    const tr = Math.floor(this.lerp(40, 70, city));
    const tg = Math.floor(this.lerp(220, 80, city) + beat * 25);
    const tb = Math.floor(this.lerp(200, 90, city));
    const wireCol = `rgb(${tr},${Math.max(0, Math.min(255, tg))},${tb})`;
    const roadCol = `rgb(${Math.floor(48 + beat * 18)},${Math.floor(50 + beat * 18)},${Math.floor(58 + beat * 20)})`;

    for (const t of this.traces) {
      const width = Math.max(1, Math.round(this.lerp(1, 5, city)));
      // Road bed (widens with morph).
      ctx.fillStyle = city > 0.15 ? roadCol : wireCol;
      if (t.dir === 0) ctx.fillRect(t.x, t.y - (width >> 1), t.len, width);
      else ctx.fillRect(t.x - (width >> 1), t.y, width, t.len);

      // Neon wire core stays visible while circuit-y; fades as roads take over.
      if (city < 0.85) {
        ctx.fillStyle = `rgba(${tr},${Math.max(0, Math.min(255, tg))},${tb},${1 - city * 0.9})`;
        if (t.dir === 0) ctx.fillRect(t.x, t.y, t.len, 1);
        else ctx.fillRect(t.x, t.y, 1, t.len);
      }

      // Lane dashes fade IN as the road forms (centerline markings).
      if (city > 0.4 && width >= 3) {
        ctx.fillStyle = `rgba(220,200,90,${(city - 0.4) * 1.4})`;
        const step = 6;
        for (let d = 2; d < t.len - 1; d += step) {
          if (t.dir === 0) ctx.fillRect(t.x + d, t.y, 3, 1);
          else ctx.fillRect(t.x, t.y + d, 1, 3);
        }
      }
    }

    // Data surge wavefront across X: bright band over wires (circuit), reads as
    // a traffic/power flash sweep in the city too.
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

  /** Components: ICs/chips (with pins) + small parts -> lit buildings/blocks. */
  private paintComponents(ctx: CanvasRenderingContext2D, m: number, beat: number): void {
    const city = m;
    for (const c of this.comps) {
      const bl = 0.5 + 0.5 * Math.sin(c.blink);

      // Body color: chip-black/green (circuit) -> tinted concrete (city).
      const baseR = this.lerp(c.chip ? 18 : 60, 70 + c.hue * 60, city);
      const baseG = this.lerp(c.chip ? 40 : 120, 74 + c.hue * 40, city);
      const baseB = this.lerp(c.chip ? 30 : 70, 92 + c.hue * 50, city);
      ctx.fillStyle = `rgb(${Math.floor(baseR)},${Math.floor(baseG)},${Math.floor(baseB)})`;
      ctx.fillRect(c.x, c.y, c.w, c.h);

      // Chip pins (circuit) fade out; building windows (city) fade in.
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
        // Lit windows: a little grid of warm dots, twinkling with blink+beat.
        const wa = (city - 0.35) * 1.5;
        for (let wy = c.y + 1; wy < c.y + c.h - 1; wy += 3) {
          for (let wx = c.x + 1; wx < c.x + c.w - 1; wx += 3) {
            const lit = ((wx * 7 + wy * 13) % 5) / 5 + bl * 0.4 + beat * 0.3;
            if (lit > 0.8) {
              ctx.fillStyle = `rgba(255,225,150,${Math.min(1, wa)})`;
              ctx.fillRect(wx, wy, 1, 1);
            }
          }
        }
      }

      // Chip notch marker (circuit) — a tiny dot, the IC orientation pip.
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
      // Solder silver/green -> plaza stone with a warm center.
      const cr = Math.floor(this.lerp(90, 120, city) * (0.6 + bl * 0.4) + beat * 30);
      const cg = Math.floor(this.lerp(200, 120, city) * (0.6 + bl * 0.4) + beat * 20);
      const cb = Math.floor(this.lerp(120, 110, city) * (0.6 + bl * 0.4));
      ctx.fillStyle = `rgb(${Math.min(255, cr)},${Math.min(255, cg)},${Math.max(0, cb)})`;
      ctx.fillRect(pad.x - r, pad.y - r, r * 2, r * 2);
      // Plaza fountain/centerpiece pixel in city form.
      if (city > 0.5) {
        ctx.fillStyle = `rgba(120,220,255,${(city - 0.5) * 1.5 * (0.5 + beat)})`;
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

  /** Cars + pixel people moving on the roads (city era; fades in). */
  private paintAgents(ctx: CanvasRenderingContext2D, city: number, beat: number): void {
    const alpha = Math.min(1, (city - 0.25) / 0.45);

    // --- Cars: 2px bodies on the road, with bright head/tail lights. ---------
    for (const car of this.cars) {
      const t = this.traces[car.trace];
      if (!t) continue;
      // Smoothly ease the rendered position toward the beat-advanced target so
      // the "step on the beat" reads as a snap-then-glide, not a teleport.
      let dp = car.pos - car.step;
      if (dp > 0.5) dp -= 1;
      else if (dp < -0.5) dp += 1;
      car.step += dp * 0.35;
      if (car.step > 1) car.step -= 1;
      else if (car.step < 0) car.step += 1;

      const { x, y } = this.posOnTrace(t, car.step);
      // Lane offset perpendicular to the road.
      const ox = t.dir === 0 ? 0 : car.lane * 2;
      const oy = t.dir === 0 ? car.lane * 2 : 0;
      const cx = Math.floor(x + ox);
      const cy = Math.floor(y + oy);
      // Body.
      const r = Math.floor(120 + car.hue * 135);
      const g = Math.floor(120 + (1 - car.hue) * 120);
      const b = Math.floor(160 + car.hue * 80);
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
      if (t.dir === 0) ctx.fillRect(cx - 1, cy, 3, 2);
      else ctx.fillRect(cx, cy - 1, 2, 3);
      // Headlight in the direction of travel (brighter on the beat).
      ctx.fillStyle = `rgba(255,250,200,${alpha * (0.6 + beat * 0.4)})`;
      if (t.dir === 0) ctx.fillRect(cx + (car.fwd > 0 ? 2 : -2), cy, 1, 1);
      else ctx.fillRect(cx, cy + (car.fwd > 0 ? 2 : -2), 1, 1);
    }

    // --- People: 1px dots on sidewalks, twinkling. ---------------------------
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
      const r = Math.floor(200 + ped.hue * 55);
      const g = Math.floor(120 + ped.hue * 80);
      const b = Math.floor(160 + (1 - ped.hue) * 80);
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha * 0.9})`;
      ctx.fillRect(px, py, 1, 1);
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

    // Advance the surge wavefront; retire when it exits.
    if (this.surge >= 0) {
      this.surge += dt * (2.2 + m * 2.0);
      if (this.surge > 1.1) this.surge = -1;
    }

    // Data pulses glide between beats (circuit liveliness).
    for (const p of this.pulses) {
      p.pos += dt * p.speed * (1 + this.beat * 1.5) * (1 - m * 0.6);
      if (p.pos > 1) {
        p.pos -= 1;
        if (this.rng() < 0.3) p.trace = Math.floor(this.rng() * this.traces.length);
      }
    }

    // Cars/people drift slightly between beats so motion isn't strictly stepped.
    const crawl = dt * (0.05 + m * 0.12);
    for (const car of this.cars) {
      car.pos += car.fwd * crawl * (car.speed * 8);
      if (car.pos > 1) car.pos -= 1;
      else if (car.pos < 0) car.pos += 1;
    }

    // Component/pad blink phases advance; livelier as the city wakes up.
    for (const c of this.comps) c.blink += dt * c.blinkRate * (1 + m);
    for (const pad of this.pads) pad.blink += dt * pad.blinkRate * (1 + m);

    // Arcs age out.
    for (const a of this.arcs) {
      if (!a.active) continue;
      a.t += dt;
      if (a.t >= a.life) a.active = false;
    }

    this.paint();

    // Overall brightness pumps with the beat + morph (bloom-safe scalar).
    this.mat.color.setScalar(1 + this.beat * 0.3 + m * 0.12);

    // Scene background tracks the mood: green PCB -> deep night-city blue.
    if (this.scene && this.scene.background instanceof THREE.Color) {
      this.scene.background.setRGB(
        0.016 + m * 0.02,
        Math.max(0, 0.074 - m * 0.045),
        0.04 + m * 0.05,
      );
    }

    // Camera: top-down, slight beat push-down + decaying shake.
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
  label: "Circuit Board -> Pixel City",
  blurb:
    "A richly detailed top-down PCB — neon traces with data pulses, ICs/chips with pins, caps, resistors, LEDs and pads — that morphs with rising intensity into a top-down pixel SimCity: traces widen into roads with lane dashes, components light up as buildings, pads open into plazas, and cars + pixel people drive and walk the streets, stepping forward on every beat.",
  create: () => new Bg07(),
};

export default def;
