// bg07 — "Circuit Board -> Power Surge" — a calm glowing PCB that overloads into
// an electric power surge as performance intensity climbs. Three.js scene
// decoration (visuals only, GDD §8).
//
// The board is one big low-res CanvasTexture (NearestFilter, pixely): green
// substrate, neon traces, solder pads and chunky components. Little data pulses
// travel along the traces. An eased `morph` (0..1) drives the transformation:
//   morph 0  -> calm board: cool cyan/green traces, soft data pulses, components
//               blinking gently.
//   morph ~  -> current builds: traces brighten toward white-hot, pulses speed up
//               and multiply, components flicker harder.
//   morph 1  -> POWER SURGE OVERLOAD: traces glow red-hot, electric arcs jump
//               between pads, components spark and "explode", the whole board
//               strobes chaotically.
//
// Juice (all three required):
//   eddieBeatPulse  -> current surge: a bright wavefront sweeps the traces; at
//                      high morph it triggers arc flashes (downbeat stronger).
//   eddieShake      -> camera jolt that decays.
//   eddieIntensity  -> stored as target; `morph` eases toward it every frame.
//
// dispose() restores scene.background/fog, disposes every geometry/material/
// texture and unsubscribes all listeners. Bloom-safe; the board quad is
// frustumCulled=false.

import * as THREE from "three";
import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";
import type { EddieBackgroundDef, EddieBackgroundVariant } from "./types";

const TEX_W = 192;
const TEX_H = 120;
const PAD_COUNT = 26;
const PULSE_COUNT = 36;
const ARC_COUNT = 10;

type Dir = 0 | 1; // 0 = horizontal, 1 = vertical

interface Trace {
  x: number; // start (in tex px)
  y: number;
  len: number;
  dir: Dir;
}

interface Pulse {
  trace: number; // index into traces
  pos: number; // 0..1 along the trace
  speed: number;
  hue: number; // 0 cyan .. 1 red, follows morph + variance
}

interface Pad {
  x: number;
  y: number;
  r: number;
  blink: number; // phase
  blinkRate: number;
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
  private pads: Pad[] = [];
  private arcs: Arc[] = [];

  private camera: THREE.PerspectiveCamera | null = null;
  private camBaseZ = 70;

  private offBeat?: () => void;
  private offShake?: () => void;
  private offIntensity?: () => void;

  private morph = 0;
  private morphTarget = 0;
  private beat = 0; // beat pump, decays
  private beatDecay = 4;
  private surge = -1; // wavefront position 0..1 sweeping the board; <0 = idle
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
    this.ctx2d = this.canvas.getContext("2d")!;
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
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(320, 200), this.mat);
    this.mesh.position.set(0, 30, -150);
    this.mesh.renderOrder = -20;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);

    ctx.scene.add(this.group);

    if (ctx.camera) {
      this.camera = ctx.camera;
      this.camera.position.set(0, 30, this.camBaseZ);
      this.camera.lookAt(0, 30, -150);
    }

    this.paint();

    this.offBeat = ctx.juice.on("eddieBeatPulse", (e) => {
      this.beat = Math.max(this.beat, e.downbeat ? 1 : 0.55);
      this.beatDecay = e.downbeat ? 1 / 0.26 : 1 / 0.16;
      this.surge = 0; // launch a current wavefront across the board
      // Arc flashes scale with morph (only when overloading).
      if (this.morph > 0.4) {
        const flashes = e.downbeat ? 2 + Math.floor(this.morph * 5) : 1 + Math.floor(this.morph * 2);
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

  /** Deterministic xorshift so the board layout is stable per mount. */
  private rng(): number {
    let s = this.rngState;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.rngState = s >>> 0;
    return (this.rngState % 100000) / 100000;
  }

  private buildBoard(): void {
    // Traces: a grid-ish set of orthogonal runs.
    const TRACE_COUNT = 22;
    for (let i = 0; i < TRACE_COUNT; i++) {
      const dir: Dir = this.rng() < 0.5 ? 0 : 1;
      if (dir === 0) {
        const y = 6 + Math.floor(this.rng() * (TEX_H - 12));
        const x = Math.floor(this.rng() * (TEX_W - 40));
        const len = 24 + Math.floor(this.rng() * (TEX_W - x - 4 - 24));
        this.traces.push({ x, y, len: Math.max(20, len), dir });
      } else {
        const x = 6 + Math.floor(this.rng() * (TEX_W - 12));
        const y = Math.floor(this.rng() * (TEX_H - 40));
        const len = 18 + Math.floor(this.rng() * (TEX_H - y - 4 - 18));
        this.traces.push({ x, y, len: Math.max(16, len), dir });
      }
    }
    // Pads (solder points / component anchors).
    for (let i = 0; i < PAD_COUNT; i++) {
      this.pads.push({
        x: 8 + Math.floor(this.rng() * (TEX_W - 16)),
        y: 8 + Math.floor(this.rng() * (TEX_H - 16)),
        r: 2 + Math.floor(this.rng() * 3),
        blink: this.rng() * Math.PI * 2,
        blinkRate: 1.5 + this.rng() * 4,
      });
    }
    // Data pulses bound to traces.
    for (let i = 0; i < PULSE_COUNT; i++) {
      this.pulses.push({
        trace: Math.floor(this.rng() * this.traces.length),
        pos: this.rng(),
        speed: 0.25 + this.rng() * 0.5,
        hue: this.rng() * 0.2,
      });
    }
    // Arc pool (inactive).
    for (let i = 0; i < ARC_COUNT; i++) {
      this.arcs.push({ ax: 0, ay: 0, bx: 0, by: 0, life: 1, t: 0, active: false });
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

  private paint(): void {
    const ctx = this.ctx2d;
    const m = this.morph;
    const beat = this.beat;

    // Substrate: cool green -> scorched dark red as it overloads.
    const subR = Math.floor(8 + m * 40);
    const subG = Math.floor(28 - m * 18);
    const subB = Math.floor(14 - m * 8);
    ctx.fillStyle = `rgb(${subR},${Math.max(0, subG)},${Math.max(0, subB)})`;
    ctx.fillRect(0, 0, TEX_W, TEX_H);

    // Trace base color: cyan/green (calm) -> white-hot -> red (overload).
    // Build an RGB by morph.
    const tr = Math.floor(40 + m * 215);
    const tg = Math.floor(220 - m * 150 + beat * 30);
    const tb = Math.floor(200 - m * 190);
    const traceColor = `rgb(${Math.min(255, tr)},${Math.max(0, Math.min(255, tg))},${Math.max(0, tb)})`;

    // Draw traces.
    ctx.fillStyle = traceColor;
    for (const tr2 of this.traces) {
      if (tr2.dir === 0) ctx.fillRect(tr2.x, tr2.y, tr2.len, 1);
      else ctx.fillRect(tr2.x, tr2.y, 1, tr2.len);
    }

    // Surge wavefront: a bright band sweeping across X brightens nearby traces.
    if (this.surge >= 0) {
      const sx = this.surge * TEX_W;
      const band = 10 + m * 14;
      ctx.fillStyle = `rgba(255,255,255,${0.5 + 0.5 * beat})`;
      for (const tr2 of this.traces) {
        const tx = tr2.dir === 0 ? tr2.x + tr2.len / 2 : tr2.x;
        if (Math.abs(tx - sx) < band) {
          if (tr2.dir === 0) ctx.fillRect(tr2.x, tr2.y, tr2.len, 1);
          else ctx.fillRect(tr2.x, tr2.y, 1, tr2.len);
        }
      }
    }

    // Data pulses: bright dots gliding along traces.
    for (const p of this.pulses) {
      const tr2 = this.traces[p.trace];
      if (!tr2) continue;
      let px: number;
      let py: number;
      if (tr2.dir === 0) {
        px = tr2.x + p.pos * tr2.len;
        py = tr2.y;
      } else {
        px = tr2.x;
        py = tr2.y + p.pos * tr2.len;
      }
      const hue = Math.min(1, p.hue + m);
      const pr = Math.floor(120 + hue * 135);
      const pg = Math.floor(255 - hue * 180);
      const pb = Math.floor(255 - hue * 200);
      ctx.fillStyle = `rgb(${pr},${Math.max(0, pg)},${Math.max(0, pb)})`;
      ctx.fillRect(Math.floor(px), Math.floor(py) - 1, 2, 3);
    }

    // Pads / components: blink softly, flicker hard + "spark" at high morph.
    for (const pad of this.pads) {
      const bl = 0.5 + 0.5 * Math.sin(pad.blink);
      const flick = m > 0.5 ? (this.rng() < m * 0.5 ? 1 : 0.3) : 1;
      const lvl = bl * flick;
      const cr = Math.floor((90 + m * 165) * lvl);
      const cg = Math.floor((200 - m * 120) * lvl + beat * 40);
      const cb = Math.floor((120 - m * 90) * lvl);
      ctx.fillStyle = `rgb(${Math.min(255, cr)},${Math.max(0, Math.min(255, cg))},${Math.max(0, cb)})`;
      ctx.fillRect(pad.x - pad.r, pad.y - pad.r, pad.r * 2, pad.r * 2);

      // Spark/explosion bloom on overload beats.
      if (m > 0.65 && this.rng() < m * 0.15 + beat * 0.2) {
        ctx.fillStyle = `rgba(255,${Math.floor(180 * this.rng())},40,0.9)`;
        const s = pad.r + Math.floor(this.rng() * 4);
        ctx.fillRect(pad.x - s, pad.y - s, s * 2, s * 2);
      }
    }

    // Electric arcs: jagged bright lines between pads (high morph).
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

    this.tex.needsUpdate = true;
  }

  update(dt: number, _audioTime: number): void {
    this.t += dt;

    // Ease morph toward target (never snap).
    this.morph += (this.morphTarget - this.morph) * dt * 1.5;
    const m = this.morph;

    if (this.beat > 0) this.beat = Math.max(0, this.beat - dt * this.beatDecay);

    // Advance the surge wavefront across the board; retire when it exits.
    if (this.surge >= 0) {
      this.surge += dt * (2.2 + m * 2.0);
      if (this.surge > 1.1) this.surge = -1;
    }

    // Pulses glide; speed climbs with morph + beat.
    for (const p of this.pulses) {
      p.pos += dt * p.speed * (1 + m * 2 + this.beat * 1.5);
      if (p.pos > 1) {
        p.pos -= 1;
        // Occasionally hop to a different trace so flow stays lively.
        if (this.rng() < 0.3) p.trace = Math.floor(this.rng() * this.traces.length);
      }
    }

    // Pad blink phases advance; faster as it overloads.
    for (const pad of this.pads) {
      pad.blink += dt * pad.blinkRate * (1 + m * 2);
    }

    // Arcs age out.
    for (const a of this.arcs) {
      if (!a.active) continue;
      a.t += dt;
      if (a.t >= a.life) a.active = false;
    }

    this.paint();

    // Overall brightness pumps with the beat + morph (bloom-safe scalar).
    this.mat.color.setScalar(1 + this.beat * 0.35 + m * 0.15);

    // Scene background tracks the board mood (green -> scorched).
    if (this.scene && this.scene.background instanceof THREE.Color) {
      this.scene.background.setRGB(0.016 + m * 0.12, 0.074 - m * 0.05, 0.04 - m * 0.02);
      if (this.scene.background.g < 0) this.scene.background.g = 0;
      if (this.scene.background.b < 0) this.scene.background.b = 0;
    }

    // Camera: parked, slight beat push-in + decaying shake.
    if (this.camera) {
      const pushIn = this.beat * 3 + m * 4;
      let px = 0;
      let py = 30;
      let pz = this.camBaseZ - pushIn;
      if (this.shake > 0) {
        this.shake = Math.max(0, this.shake - dt * 6);
        const a = this.shake;
        px += (Math.random() - 0.5) * a * 2.2;
        py += (Math.random() - 0.5) * a * 1.8;
        pz += (Math.random() - 0.5) * a;
      }
      this.camera.position.set(px, py, pz);
      this.camera.lookAt(0, 30, -150);
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
    this.pads = [];
    this.arcs = [];
    this.camera = null;
  }
}

const def: EddieBackgroundDef = {
  id: "bg07",
  label: "Circuit Board -> Power Surge",
  blurb: "A calm glowing PCB with data pulses drifting along neon traces; rising intensity overloads it into a power surge where traces glow red-hot, components spark and explode, and electric arcs jump between pads on the beat.",
  create: () => new Bg07(),
};

export default def;
