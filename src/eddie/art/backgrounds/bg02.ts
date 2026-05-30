// bg02 — "Neon Sea → Storm" — a morphing synthwave ocean.
//
// At morph 0: a calm neon ocean of gentle parallax waves under a big banded moon
// in a deep-purple sky, stars overhead. As the performance-driven `morph` (0..1)
// rises the sea turns violent — swell height and chop grow, the sky darkens and
// reddens, whitecaps/spray appear, lightning cracks ON THE BEAT (frequency +
// brightness scale with morph), and the camera begins to pitch and roll like a
// boat in a tempest. At morph 1 it is a raging storm: towering chaotic waves,
// near-constant lightning, blood-red sky, waterspouts.
//
// Sea creatures key off the weather with a CLEAN SEPARATION — calm = dolphins
// only, rain = mermaids only. In the CALM / SUNNY state, pixely neon DOLPHINS
// leap out of the swell in joyful parabolic arcs (chunky silhouettes with a neon
// rim + a splash) — frequent, in big pods at max sun (morph 0), tapering off as
// the sky greys and dropping to ZERO once it starts to rain (morph >= RAIN_ONSET,
// ~0.2). In the STORM (rising morph), chaotic neon MERMAIDS surface and thrash —
// whipping hair, flailing arms, a lashing tail flicking up spray (a "hot mess") —
// appearing progressively: ONE, then TWO, then THREE, and SCHOOLS at max storm.
// Both are pooled/recycled (no per-event allocation).
//
// Juice contract (all three events handled):
//  - eddieBeatPulse  -> wave surge + lightning strike + either a dolphin pod
//    leap (CALM-ONLY: chance/pod grow as morph falls, ZERO once raining) OR a
//    mermaid surfacing (STORM-ONLY: chance/count grow as morph rises). Never
//    both — the two are cleanly separated by RAIN_ONSET. Downbeats stronger.
//  - eddieShake      -> camera jolt that decays.
//  - eddieIntensity  -> target morph; eased each frame (never snapped).
//
// Visuals only (GDD §8). dispose() restores scene.background/fog, disposes every
// geometry/material/texture, and unsubscribes all listeners. The sea+sky is one
// low-res CanvasTexture (NearestFilter => chunky pixels) redrawn each frame.

import * as THREE from "three";
import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";
import type { EddieBackgroundDef, EddieBackgroundVariant } from "./types";

const SEA_W = 200; // sea/sky canvas px (low-res, NearestFilter => chunky)
const SEA_H = 140;

// Morph at which rain begins. Dolphins are CALM-ONLY: their activity ramps to
// zero by here and is fully cut off above it (storm => mermaids only).
const RAIN_ONSET = 0.2;

// Calm and storm palettes; we lerp between them by morph.
const CALM = {
  skyTop: [10, 6, 24] as const,
  skyHorizon: [90, 24, 120] as const,
  seaFar: [40, 16, 90] as const,
  seaNear: [10, 8, 36] as const,
  neon: [0, 240, 255] as const, // cyan crests
  moon: [255, 224, 150] as const,
};
const STORM = {
  skyTop: [12, 2, 8] as const,
  skyHorizon: [120, 10, 26] as const,
  seaFar: [70, 8, 20] as const,
  seaNear: [18, 2, 8] as const,
  neon: [255, 70, 60] as const, // angry red-orange crests
  moon: [200, 120, 110] as const,
};

interface Lightning {
  life: number; // seconds remaining
  x: number; // strike column (0..SEA_W)
  segs: number[]; // jagged x offsets down the bolt
  branchAt: number; // row index where a branch forks
}

// A pixely neon dolphin doing a parabolic leap out of the swell. Pooled: when
// `active` is false the slot is free for reuse (no per-leap allocation).
interface Dolphin {
  active: boolean;
  x: number; // canvas-x of the arc center (entry/exit point)
  surfaceY: number; // canvas-y of the water surface it leaps from
  t: number; // 0..1 progress through the arc
  dur: number; // seconds for the full leap
  span: number; // horizontal travel across the arc (px)
  height: number; // peak leap height (px)
  dir: number; // +1 leaping right, -1 leaping left
  hue: number; // 0..1 neon hue mix (cyan..magenta)
  splash: number; // splash flash on entry, decays
}

// A chaotic neon storm mermaid: surfaces and THRASHES — whipping hair + tail,
// splashing — to read as a "hot mess". Pooled like the dolphins. Unlike the
// dolphin arc, a mermaid bobs at the surface for a while then submerges.
interface Mermaid {
  active: boolean;
  x: number; // canvas-x
  surfaceY: number; // water surface y it bobs around
  t: number; // 0..1 life progress (rise -> thrash -> submerge)
  dur: number; // seconds of the whole appearance
  rise: number; // how high above the surface the torso lifts (px)
  phase: number; // per-mermaid thrash phase offset
  hue: number; // 0..1 neon hue (magenta..cyan)
  splash: number; // splashing flash, decays
}

class Bg02 implements EddieBackgroundVariant {
  private scene: THREE.Scene | null = null;
  private group = new THREE.Group();
  private prevBackground: THREE.Scene["background"] = null;
  private prevFog: THREE.Scene["fog"] = null;

  private canvas!: HTMLCanvasElement;
  private c2d!: CanvasRenderingContext2D;
  private tex!: THREE.CanvasTexture;
  private quad!: THREE.Mesh;
  private quadMat!: THREE.MeshBasicMaterial;

  private camera: THREE.PerspectiveCamera | null = null;
  private camBaseY = 0;
  private camBaseZ = 0;

  private offBeat?: () => void;
  private offShake?: () => void;
  private offIntensity?: () => void;

  private morph = 0; // eased calm->chaos
  private morphTarget = 0;
  private pulse = 0; // beat surge, decays
  private shake = 0;
  private t = 0;
  private bolts: Lightning[] = [];
  private flash = 0; // full-screen lightning flash, decays

  // Dolphin pool (fixed-size, recycled). `dolphinTimer` gates ambient leaps;
  // beats can also trigger leaps directly (a pod at high energy).
  private dolphins: Dolphin[] = [];
  private dolphinTimer = 0; // counts down to the next ambient leap

  // Mermaid pool (fixed-size, recycled), surfacing during the storm.
  private mermaids: Mermaid[] = [];
  private mermaidTimer = 0; // counts down to the next ambient surfacing

  mount(ctx: { scene: THREE.Scene; camera?: THREE.PerspectiveCamera; juice: EventBus<EddieJuiceEvents> }): void {
    this.scene = ctx.scene;
    this.prevBackground = ctx.scene.background;
    this.prevFog = ctx.scene.fog;
    ctx.scene.background = new THREE.Color(0x0a0618);
    ctx.scene.fog = null;

    this.canvas = document.createElement("canvas");
    this.canvas.width = SEA_W;
    this.canvas.height = SEA_H;
    this.c2d = this.canvas.getContext("2d")!;
    this.c2d.imageSmoothingEnabled = false;

    // Pre-allocate the dolphin pool once (max simultaneous leapers).
    for (let i = 0; i < 8; i++) {
      this.dolphins.push({
        active: false,
        x: 0,
        surfaceY: 0,
        t: 0,
        dur: 1,
        span: 0,
        height: 0,
        dir: 1,
        hue: 0,
        splash: 0,
      });
    }
    this.dolphinTimer = 1.5 + Math.random() * 2;

    // Pre-allocate the mermaid pool once (max simultaneous = a small school).
    for (let i = 0; i < 8; i++) {
      this.mermaids.push({
        active: false,
        x: 0,
        surfaceY: 0,
        t: 0,
        dur: 1,
        rise: 0,
        phase: 0,
        hue: 0,
        splash: 0,
      });
    }
    this.mermaidTimer = 2 + Math.random() * 2;

    this.paint();
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;

    this.quadMat = new THREE.MeshBasicMaterial({ map: this.tex, depthWrite: false, depthTest: false, fog: false });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(360, 240), this.quadMat);
    this.quad.position.set(0, 30, -160);
    this.quad.renderOrder = -20;
    this.quad.frustumCulled = false;
    this.group.add(this.quad);

    ctx.scene.add(this.group);

    if (ctx.camera) {
      this.camera = ctx.camera;
      this.camBaseY = 30;
      this.camBaseZ = 70;
      this.camera.position.set(0, this.camBaseY, this.camBaseZ);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(0, 30, -160);
    }

    this.offBeat = ctx.juice.on("eddieBeatPulse", (e) => {
      this.pulse = e.downbeat ? 1 : 0.55;
      // Lightning chance scales with morph; downbeats strike reliably past mid morph.
      const chance = this.morph * (e.downbeat ? 1.1 : 0.6);
      if (Math.random() < chance) this.strike(e.downbeat);

      // Dolphins are a CALM/SUNNY-ONLY thing: they go to ZERO once it starts to
      // rain. `calm` ramps 1 -> 0 across morph 0 .. RAIN_ONSET and is clamped to
      // 0 above it, so no dolphins ever appear in the rain/storm. Full joyful
      // pods only happen near morph 0.
      const calm = this.calmFactor();
      if (calm > 0) {
        const dolphinChance = calm * (e.downbeat ? 0.95 : 0.6);
        if (Math.random() < dolphinChance) {
          const pod = 1 + Math.floor(calm * 3) + (e.downbeat ? 1 : 0);
          this.launchPod(pod, e.downbeat);
        }
      }

      // Mermaids are a STORM thing: a chaotic hot mess that surfaces during the
      // storm, more numerous as morph rises — 1 -> 2 -> 3 -> schools at max.
      const mermChance = (e.downbeat ? 0.5 : 0.2) * this.morph;
      if (Math.random() < mermChance) {
        this.launchMermaids(this.mermaidCount(), e.downbeat);
      }
    });
    this.offShake = ctx.juice.on("eddieShake", (e) => {
      this.shake = Math.max(this.shake, e.magnitude);
    });
    this.offIntensity = ctx.juice.on("eddieIntensity", (e) => {
      this.morphTarget = Math.min(1, Math.max(0, e.value));
    });
  }

  private strike(downbeat: boolean): void {
    const segs: number[] = [];
    let x = 0;
    const rows = 14;
    for (let i = 0; i < rows; i++) {
      x += (Math.random() - 0.5) * 10;
      segs.push(x);
    }
    this.bolts.push({
      life: 0.16 + Math.random() * 0.12,
      x: 20 + Math.random() * (SEA_W - 40),
      segs,
      branchAt: 4 + Math.floor(Math.random() * 6),
    });
    this.flash = Math.max(this.flash, downbeat ? 1 : 0.7);
    if (this.bolts.length > 6) this.bolts.shift();
  }

  /** Canvas-y of the water surface at canvas-x `x`, near the camera (where the
   *  dolphins play). Mirrors the near-row swell amplitude used in paint() so the
   *  leaps enter/exit on the actual moving surface. */
  private surfaceYAt(x: number): number {
    const horizon = Math.floor(SEA_H * 0.42);
    const playRow = SEA_H - horizon - 12; // a near-ish band, not the very bottom
    const y = horizon + playRow;
    const depth = playRow / (SEA_H - horizon);
    const amp = this.lerp(2.5, 16, this.morph) * (1 + this.pulse * 0.6);
    const chop = this.lerp(0.6, 2.4, this.morph);
    const phase = this.t * (1.2 + depth * 2) + playRow * 0.5;
    const w =
      Math.sin(x * 0.06 * chop + phase) * amp * (0.4 + depth) +
      Math.sin(x * 0.17 * chop + phase * 1.7) * amp * 0.4 * depth;
    return y + w * 0.15;
  }

  /** Launch up to `n` dolphins as a clustered pod from free pool slots. */
  private launchPod(n: number, big: boolean): void {
    const cx = 20 + Math.random() * (SEA_W - 40);
    const dir = Math.random() < 0.5 ? 1 : -1;
    let launched = 0;
    for (const d of this.dolphins) {
      if (d.active) continue;
      // Cluster pod members near cx with slight stagger so they arc together.
      const jitterX = (launched - (n - 1) / 2) * (6 + Math.random() * 4);
      this.spawnDolphin(d, cx + jitterX, dir, big, launched * 0.04);
      if (++launched >= n) break;
    }
  }

  /** Configure a pooled dolphin slot for a leap. Bigger/faster with morph. */
  private spawnDolphin(d: Dolphin, x: number, dir: number, big: boolean, delay: number): void {
    d.active = true;
    d.x = x;
    d.surfaceY = this.surfaceYAt(x);
    d.t = -delay; // start slightly before 0 so pod members lag/stagger their arcs
    d.dir = dir;
    d.span = (10 + Math.random() * 10 + this.morph * 10) * dir;
    d.height = (10 + Math.random() * 6 + this.morph * 14) * (big ? 1.25 : 1);
    d.dur = 0.7 + Math.random() * 0.25 - this.morph * 0.15; // snappier at high energy
    d.hue = Math.random();
    d.splash = 0;
  }

  /** Dolphin "calm" factor: 1 at max sun (morph 0), ramping linearly to 0 by
   *  RAIN_ONSET, and HARD ZERO at/above it. Dolphins appear only when calm > 0,
   *  so they stop entirely once it starts to rain. */
  private calmFactor(): number {
    if (this.morph >= RAIN_ONSET) return 0;
    return 1 - this.morph / RAIN_ONSET; // 1 -> 0 across [0, RAIN_ONSET)
  }

  /** Progressive mermaid count: storm onset shows ONE, then TWO, then THREE,
   *  and at max storm a SCHOOL. Gated by morph; returns 0 below the threshold. */
  private mermaidCount(): number {
    const m = this.morph;
    if (m < 0.25) return 0;
    if (m < 0.5) return 1;
    if (m < 0.72) return 2;
    if (m < 0.9) return 3;
    return 4 + Math.floor((m - 0.9) * 30); // schools at max storm
  }

  /** Surface up to `n` mermaids from free pool slots, clustered into a school. */
  private launchMermaids(n: number, big: boolean): void {
    if (n <= 0) return;
    const cx = 16 + Math.random() * (SEA_W - 32);
    let launched = 0;
    for (const mm of this.mermaids) {
      if (mm.active) continue;
      const jitterX = (launched - (n - 1) / 2) * (10 + Math.random() * 8);
      this.spawnMermaid(mm, cx + jitterX, big);
      if (++launched >= n) break;
    }
  }

  /** Configure a pooled mermaid slot. Wilder/taller toward max storm. */
  private spawnMermaid(mm: Mermaid, x: number, big: boolean): void {
    const px = Math.max(8, Math.min(SEA_W - 8, x));
    mm.active = true;
    mm.x = px;
    mm.surfaceY = this.surfaceYAt(px);
    mm.t = 0;
    mm.dur = 1.4 + Math.random() * 1.0; // lingers, thrashing, longer than a leap
    mm.rise = (10 + Math.random() * 6 + this.morph * 12) * (big ? 1.2 : 1);
    mm.phase = Math.random() * Math.PI * 2;
    mm.hue = Math.random();
    mm.splash = 1; // surfacing splash
  }

  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  /** Lerp two RGB triples by t and return a css rgb() string. */
  private mix(a: readonly number[], b: readonly number[], t: number): string {
    const r = Math.round(this.lerp(a[0], b[0], t));
    const g = Math.round(this.lerp(a[1], b[1], t));
    const bl = Math.round(this.lerp(a[2], b[2], t));
    return `rgb(${r},${g},${bl})`;
  }

  /** Per-channel double-lerp helper: between (calmA->stormA) and (calmB->stormB)
   *  by morph m, then between the two by f. Returns a css rgb() string. */
  private bandColor(
    calmA: readonly number[],
    stormA: readonly number[],
    calmB: readonly number[],
    stormB: readonly number[],
    m: number,
    f: number,
  ): string {
    const ch = (i: number) =>
      Math.round(this.lerp(this.lerp(calmA[i], stormA[i], m), this.lerp(calmB[i], stormB[i], m), f));
    return `rgb(${ch(0)},${ch(1)},${ch(2)})`;
  }

  /** Redraw the whole sea+sky for this frame. */
  private paint(): void {
    const ctx = this.c2d;
    const m = this.morph;
    const horizon = Math.floor(SEA_H * 0.42);

    // --- Sky gradient (top->horizon, calm->storm), banded for the pixely look.
    for (let y = 0; y < horizon; y++) {
      const f = y / horizon;
      ctx.fillStyle = this.bandColor(CALM.skyTop, STORM.skyTop, CALM.skyHorizon, STORM.skyHorizon, m, f);
      ctx.fillRect(0, y, SEA_W, 1);
    }
    const skyHor = this.mix(CALM.skyHorizon, STORM.skyHorizon, m);

    // --- Stars (fade out as the storm clouds roll in).
    if (m < 0.85) {
      ctx.globalAlpha = (1 - m / 0.85) * 0.9;
      ctx.fillStyle = "#dfe6ff";
      for (let i = 0; i < 40; i++) {
        const sx = (i * 53 + 7) % SEA_W;
        const sy = (i * 29) % horizon;
        if ((Math.sin(this.t * 2 + i) + 1) * 0.5 > 0.4) ctx.fillRect(sx, sy, 1, 1);
      }
      ctx.globalAlpha = 1;
    }

    // --- Moon: big banded disc on the horizon, dimming + reddening with storm.
    const moonX = SEA_W * 0.5;
    const moonY = horizon - 14;
    const moonR = 16;
    ctx.fillStyle = this.mix(CALM.moon, STORM.moon, m);
    ctx.beginPath();
    ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
    ctx.fill();
    // Venetian bands cut from the lower moon (filled with the horizon sky color).
    ctx.fillStyle = skyHor;
    for (let i = 0; i < 5; i++) ctx.fillRect(moonX - moonR, moonY + 2 + i * 3, moonR * 2, 1 + Math.floor(i / 2));

    // --- Sea: rows from horizon down. Swell amplitude + chop grow with morph.
    const neon = this.mix(CALM.neon, STORM.neon, m);
    const amp = this.lerp(2.5, 16, m) * (1 + this.pulse * 0.6);
    const chop = this.lerp(0.6, 2.4, m);
    const seaRows = SEA_H - horizon;
    for (let row = 0; row < seaRows; row++) {
      const y = horizon + row;
      const depth = row / seaRows; // 0 far .. 1 near
      ctx.fillStyle = this.bandColor(CALM.seaFar, STORM.seaFar, CALM.seaNear, STORM.seaNear, m, depth);
      ctx.fillRect(0, y, SEA_W, 1);

      // Neon crest every few rows so the sea reads as horizontal swells.
      if (row % 3 === 0) {
        const phase = this.t * (1.2 + depth * 2) + row * 0.5;
        ctx.fillStyle = neon;
        for (let x = 0; x < SEA_W; x += 1) {
          const w =
            Math.sin(x * 0.06 * chop + phase) * amp * (0.4 + depth) +
            Math.sin(x * 0.17 * chop + phase * 1.7) * amp * 0.4 * depth;
          const cy = Math.round(y + w * 0.15);
          if (cy >= horizon && cy < SEA_H) {
            ctx.globalAlpha = 0.5 + depth * 0.5;
            ctx.fillRect(x, cy, 1, 1);
          }
        }
        ctx.globalAlpha = 1;
      }
    }

    // --- Whitecaps / spray: bright pixels, count grows with morph + pulse.
    const sprayCount = Math.floor((m * 80 + this.pulse * 40) * (0.5 + m));
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < sprayCount; i++) {
      const sx = Math.floor(Math.random() * SEA_W);
      const sy = horizon + Math.floor(Math.random() * seaRows);
      ctx.globalAlpha = 0.4 + Math.random() * 0.5;
      ctx.fillRect(sx, sy, 1, 1);
    }
    ctx.globalAlpha = 1;

    // --- Waterspouts at high morph: faint vertical funnels.
    if (m > 0.6) {
      const spouts = 1 + Math.floor((m - 0.6) * 5);
      ctx.fillStyle = "rgba(200,200,210,0.5)";
      for (let s = 0; s < spouts; s++) {
        const sx = ((s * 71 + Math.floor(this.t * 8)) % (SEA_W - 20)) + 10;
        ctx.globalAlpha = (m - 0.6) * 0.8;
        for (let y = horizon; y < SEA_H; y += 1) {
          const wob = Math.sin(y * 0.3 + this.t * 6 + s) * 3;
          ctx.fillRect(Math.round(sx + wob), y, 1 + Math.floor((y - horizon) / 30), 1);
        }
      }
      ctx.globalAlpha = 1;
    }

    // --- Dolphins (sunny) + mermaids (stormy): pixely neon sea creatures.
    this.drawDolphins();
    this.drawMermaids();

    // --- Lightning bolts (drawn over the sky).
    for (const bolt of this.bolts) {
      const a = Math.min(1, bolt.life * 6);
      ctx.globalAlpha = a;
      ctx.fillStyle = "#eaf2ff";
      const rowH = Math.ceil((horizon + 6) / bolt.segs.length) + 1;
      let bx = bolt.x;
      for (let i = 0; i < bolt.segs.length; i++) {
        const y = (i / bolt.segs.length) * (horizon + 6);
        bx = bolt.x + bolt.segs[i];
        ctx.fillRect(Math.round(bx), Math.round(y), 2, rowH);
        if (i === bolt.branchAt) {
          let fx = bx;
          for (let j = 0; j < 5; j++) {
            fx += (Math.random() - 0.3) * 8;
            ctx.fillRect(Math.round(fx), Math.round(y + j * 3), 1, 3);
          }
        }
      }
      ctx.globalAlpha = 1;
    }

    // --- Full-frame lightning flash.
    if (this.flash > 0.01) {
      ctx.globalAlpha = this.flash * 0.5;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, SEA_W, SEA_H);
      ctx.globalAlpha = 1;
    }
  }

  /** Advance dolphin arcs, fire ambient leaps on a timer, decay splashes, and
   *  recycle finished slots. Splash pops fire as a dolphin crosses the surface
   *  on the way up (exit) and back down (entry). */
  private updateDolphins(dt: number): void {
    // Ambient leaps are CALM/SUNNY-ONLY: frequent + joyful at max sun (morph 0),
    // and ZERO once it rains. `calm` ramps 1 -> 0 across [0, RAIN_ONSET) and is
    // hard-zero above it, so no ambient leaps ever fire in the rain/storm.
    const calm = this.calmFactor();
    this.dolphinTimer -= dt;
    if (this.dolphinTimer <= 0) {
      if (calm > 0) {
        const pod = 1 + Math.floor(calm * 2);
        this.launchPod(pod, false);
      }
      // Interval shrinks with calm (near-rain ~3.2s rare, full sun ~0.8s) + jitter.
      this.dolphinTimer = this.lerp(3.2, 0.8, calm) * (0.6 + Math.random() * 0.8);
    }

    for (const d of this.dolphins) {
      if (!d.active) continue;
      if (d.splash > 0) d.splash = Math.max(0, d.splash - dt * 4);

      const prev = d.t;
      d.t += dt / d.dur;

      // Splash on exit (crossing 0 upward) and on entry (crossing 1).
      if (prev < 0 && d.t >= 0) d.splash = Math.max(d.splash, 1);
      if (prev < 1 && d.t >= 1) {
        d.splash = Math.max(d.splash, 1);
        d.surfaceY = this.surfaceYAt(d.x + d.span * 0.5); // splash at the entry point
      }

      // Retire once the arc is done AND its splash has faded.
      if (d.t > 1 && d.splash <= 0.01) d.active = false;
    }
  }

  /** Advance mermaid appearances, fire ambient surfacings during the storm,
   *  decay splashes, recycle finished slots. */
  private updateMermaids(dt: number): void {
    // Ambient surfacings only happen in the storm; more often as morph rises.
    if (this.morph > 0.25) {
      this.mermaidTimer -= dt;
      if (this.mermaidTimer <= 0) {
        this.launchMermaids(this.mermaidCount(), false);
        // Interval shrinks as the storm intensifies (~3.5s onset -> ~1.0s max).
        this.mermaidTimer = this.lerp(3.5, 1.0, this.morph) * (0.6 + Math.random() * 0.8);
      }
    }

    for (const mm of this.mermaids) {
      if (!mm.active) continue;
      if (mm.splash > 0) mm.splash = Math.max(0, mm.splash - dt * 3.5);
      mm.t += dt / mm.dur;
      // A fresh splash whenever the thrash whips hard (periodic, chaotic).
      if (Math.sin(this.t * 14 + mm.phase) > 0.92) mm.splash = Math.max(mm.splash, 0.7);
      if (mm.t > 1 && mm.splash <= 0.01) mm.active = false;
    }
  }

  /** Draw all active dolphins for this frame (called from paint()). Each is a
   *  chunky pixel silhouette with a neon rim, following its parabolic arc; a
   *  little splash pops at entry/exit. */
  private drawDolphins(): void {
    const ctx = this.c2d;
    for (const d of this.dolphins) {
      if (!d.active) continue;

      // Splash bursts (entry + exit) draw even outside the airborne window.
      if (d.splash > 0.01) {
        ctx.globalAlpha = Math.min(1, d.splash);
        ctx.fillStyle = "#ffffff";
        const sn = 3 + Math.floor(d.splash * 6);
        for (let i = 0; i < sn; i++) {
          const ax = d.x + (Math.random() - 0.5) * 12;
          const ay = d.surfaceY - Math.random() * 6 * d.splash;
          ctx.fillRect(Math.round(ax), Math.round(ay), 1, 1);
        }
        ctx.globalAlpha = 1;
      }

      // Only draw the body while airborne (t in 0..1).
      if (d.t < 0 || d.t > 1) continue;
      const p = d.t;
      // Parabolic height: peaks at p=0.5.
      const arc = 4 * p * (1 - p); // 0..1..0
      const cx = d.x + d.span * (p - 0.5);
      const cy = d.surfaceY - arc * d.height;
      // Body tilts with the arc velocity (up on the way out, down on entry).
      const tilt = (0.5 - p) * 1.4; // + nose-up early, - nose-down late
      // Neon rim color: cyan..magenta by hue, brightened toward storm-red.
      const r = Math.round(this.lerp(0, 255, d.hue) + this.morph * 120);
      const g = Math.round(this.lerp(220, 60, d.hue) * (1 - this.morph * 0.3));
      const b = Math.round(this.lerp(255, 214, d.hue));
      const rim = `rgb(${Math.min(255, r)},${Math.max(0, g)},${b})`;

      // A compact pixel dolphin: a curved body + dorsal fin + tail fluke. We
      // sample a short spine and stamp 2px-thick segments, with a 1px brighter
      // rim on the upper edge.
      const len = 9 + Math.floor(d.height * 0.18);
      const dir = Math.sign(d.span) || 1;
      ctx.save();
      for (let s = 0; s < len; s++) {
        const u = s / (len - 1); // 0 tail .. 1 nose
        // Body centerline: a gentle banana curve, oriented by dir + tilt.
        const along = (u - 0.5) * len;
        const bend = Math.sin(u * Math.PI) * 2.2; // belly curve
        const bx = cx + dir * along * Math.cos(tilt) - bend * Math.sin(tilt);
        const by = cy + along * Math.sin(tilt) - bend * Math.cos(tilt) * 0.6;
        // Body thickness tapers toward nose + tail.
        const thick = Math.max(1, Math.round(Math.sin(u * Math.PI) * 2.4));
        ctx.fillStyle = "#0b0a18"; // dark silhouette
        ctx.fillRect(Math.round(bx), Math.round(by), 2, thick + 1);
        // Neon rim along the top edge.
        ctx.fillStyle = rim;
        ctx.globalAlpha = 0.9;
        ctx.fillRect(Math.round(bx), Math.round(by), 2, 1);
        ctx.globalAlpha = 1;
        // Dorsal fin near mid-body (u ~ 0.55).
        if (s === Math.floor(len * 0.55)) {
          ctx.fillStyle = rim;
          ctx.fillRect(Math.round(bx), Math.round(by - 3), 1, 3);
        }
        // Tail fluke at the tail end (u ~ 0).
        if (s === 0) {
          ctx.fillStyle = rim;
          ctx.fillRect(Math.round(bx - dir), Math.round(by - 2), 1, 5);
        }
      }
      ctx.restore();
    }
  }

  /** Draw all active mermaids (called from paint()). A chaotic pixel "hot mess":
   *  a small torso bobbing above the surface with whipping neon hair and a
   *  thrashing tail flicking up sheets of spray. */
  private drawMermaids(): void {
    const ctx = this.c2d;
    for (const mm of this.mermaids) {
      if (!mm.active) continue;

      // Vertical envelope: rise out (0..0.25), thrash (0.25..0.8), sink (0.8..1).
      let lift: number;
      if (mm.t < 0.25) lift = mm.t / 0.25;
      else if (mm.t < 0.8) lift = 1;
      else lift = Math.max(0, 1 - (mm.t - 0.8) / 0.2);
      const bobY = mm.surfaceY - lift * mm.rise + Math.sin(this.t * 6 + mm.phase) * 1.5;

      // Splashing spray around her — chaotic, scales with the thrash + splash.
      if (mm.splash > 0.01 || lift > 0.3) {
        ctx.fillStyle = "#ffffff";
        const sn = 3 + Math.floor((mm.splash + lift) * 6);
        for (let i = 0; i < sn; i++) {
          const ax = mm.x + (Math.random() - 0.5) * 16;
          const ay = mm.surfaceY - Math.random() * 8 * (mm.splash + lift * 0.4);
          ctx.globalAlpha = 0.4 + Math.random() * 0.5;
          ctx.fillRect(Math.round(ax), Math.round(ay), 1, 1);
        }
        ctx.globalAlpha = 1;
      }
      if (lift <= 0.02) continue;

      // Neon palette: magenta..cyan by hue, hot-pink rim.
      const r = Math.round(this.lerp(255, 0, mm.hue));
      const g = Math.round(this.lerp(43, 240, mm.hue));
      const b = Math.round(this.lerp(214, 255, mm.hue));
      const skin = `rgb(${r},${g},${b})`;
      const hair = `rgb(255,${Math.round(60 + mm.hue * 100)},200)`;

      // Tail under the surface, thrashing side to side.
      const thrash = Math.sin(this.t * 12 + mm.phase);
      const tailX = mm.x + thrash * 4 * lift;
      ctx.fillStyle = skin;
      for (let s = 0; s < 6; s++) {
        const ty = mm.surfaceY + s; // below the surface
        const bend = Math.sin(this.t * 12 + mm.phase + s * 0.5) * (s * 0.6) * lift;
        ctx.fillRect(Math.round(mm.x + bend), Math.round(ty), 2, 1);
      }
      // Tail fluke flicking up spray at the bottom.
      ctx.fillRect(Math.round(tailX - 2), Math.round(mm.surfaceY + 6), 5, 1);

      // Torso (a couple of stacked pixels) above the surface.
      ctx.fillStyle = skin;
      ctx.fillRect(Math.round(mm.x), Math.round(bobY + 2), 2, 4);
      // Head.
      ctx.fillRect(Math.round(mm.x), Math.round(bobY), 2, 2);
      // Whipping hair: a few neon strands flailing off the head.
      ctx.fillStyle = hair;
      for (let h = 0; h < 4; h++) {
        const hwhip = Math.sin(this.t * 16 + mm.phase + h * 1.3) * (3 + h);
        ctx.fillRect(Math.round(mm.x + hwhip), Math.round(bobY - 1 - h), 1, 2);
      }
      // Flailing arms (the "hot mess" flourish).
      ctx.fillStyle = skin;
      const armL = Math.sin(this.t * 13 + mm.phase) * 4;
      const armR = Math.sin(this.t * 13 + mm.phase + Math.PI) * 4;
      ctx.fillRect(Math.round(mm.x - 2), Math.round(bobY + 2 + armL * 0.3), 2, 1);
      ctx.fillRect(Math.round(mm.x + 2), Math.round(bobY + 2 + armR * 0.3), 2, 1);
    }
  }

  update(dt: number, _audioTime: number): void {
    this.t += dt;

    // EASE morph toward target (never snap).
    this.morph += (this.morphTarget - this.morph) * dt * 1.5;

    if (this.pulse > 0) this.pulse = Math.max(0, this.pulse - dt * 3.0);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 5.0);
    if (this.bolts.length > 0) {
      for (const b of this.bolts) b.life -= dt;
      this.bolts = this.bolts.filter((b) => b.life > 0);
    }

    this.updateDolphins(dt);
    this.updateMermaids(dt);

    this.paint();
    this.tex.needsUpdate = true;

    // Material brightens on lightning flash so it blooms.
    this.quadMat.color.setScalar(1 + this.flash * 0.4 + this.pulse * 0.1);

    // Camera: parked when calm; pitches/rolls like a boat as the storm builds,
    // jolts on shake. Pitch/roll amplitude scales with morph.
    if (this.camera) {
      const sp = this.morph;
      const roll = Math.sin(this.t * (0.8 + this.morph * 1.5)) * 0.04 * sp;
      const bobY = Math.sin(this.t * (1.1 + this.morph * 2)) * (1 + sp * 6);
      let px = 0;
      let py = this.camBaseY + bobY;
      let pz = this.camBaseZ;
      if (this.shake > 0) {
        this.shake = Math.max(0, this.shake - dt * 6);
        const sMag = this.shake;
        px += (Math.random() - 0.5) * sMag * 2.2;
        py += (Math.random() - 0.5) * sMag * 1.8;
        pz += (Math.random() - 0.5) * sMag;
      }
      this.camera.position.set(px, py, pz);
      this.camera.up.set(Math.sin(roll), Math.cos(roll), 0);
      // The look target dips with the swell so the horizon tilts in the storm.
      this.camera.lookAt(0, 30 - sp * 8 + Math.sin(this.t * 1.3) * sp * 5, -160);
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

    if (this.camera) this.camera.up.set(0, 1, 0);

    this.quad.geometry.dispose();
    this.quadMat.dispose();
    this.tex.dispose();
    this.bolts = [];
    this.dolphins = [];
    this.mermaids = [];
    this.camera = null;
  }
}

const def: EddieBackgroundDef = {
  id: "bg02",
  label: "Neon Sea → Storm",
  blurb: "A calm neon synthwave ocean under a banded moon — sunny skies full of leaping neon dolphins — that morphs into a raging tempest as you heat up, with swelling waves, whitecaps, waterspouts, beat-timed lightning and a hot mess of thrashing neon mermaids (1 → 2 → 3 → schools), the camera pitching like a boat.",
  create: () => new Bg02(),
};

export default def;
