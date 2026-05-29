// bg05 — "Geometric Bloom → Fractal Overload" — slow-rotating neon wireframe
// polyhedra drifting calmly that multiply, subdivide, spin faster and explode
// into a kaleidoscopic fractal as performance intensity rises.
//
// Real Three.js (not a canvas quad): a pool of wireframe polyhedra (icosahedron,
// dodecahedron, octahedron) built ONCE and reused. At morph 0 only a few drift
// and turn slowly in the foreground. As `morph` rises the pool reveals more
// shapes arranged in recursive shells around the origin, their spin and emissive
// glow ramp up, and near morph 1 the whole field strobes and swarms — a fractal
// overload filling the view. Only emissive neon wireframes (bloom-safe).
//
// MORPH (eddieIntensity, eased toward target each frame; never snaps): drives how
// many shapes are visible, their spin rate, scale pulse, and glow.
// Beat (eddieBeatPulse, downbeat stronger, scaled by morph): a bloom pulse —
// shapes punch outward + brighten for a beat, and a fresh shell pops in.
// Shake (eddieShake): camera jolt that decays.
//
// Visuals only (GDD §8). dispose() restores scene.background/fog, disposes every
// geometry/material, and unsubscribes every listener.

import * as THREE from "three";
import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";
import type { EddieBackgroundDef, EddieBackgroundVariant } from "./types";

// Neon palette (emissive-bright so bloom catches only these).
const NEON = [0xff2bd6, 0x00f0ff, 0xffd02b, 0xc7ff2b, 0xff5a8a, 0x8a5aff];

const MAX_SHAPES = 90; // pool ceiling — recursive shells fill in as morph rises
const SHELLS = 5; // concentric recursion shells

interface Shape {
  mesh: THREE.LineSegments;
  mat: THREE.LineBasicMaterial; // owned per-mesh for independent glow/opacity
  shell: number; // 0..SHELLS-1 — outer shells appear at higher morph
  // Orbit parameters (stable per shape).
  orbitR: number;
  orbitAxis: THREE.Vector3;
  orbitPhase: number;
  orbitSpeed: number;
  spinAxis: THREE.Vector3;
  spinSpeed: number;
  baseScale: number;
  hue: number; // index into NEON
  // Per-shape activation eased toward visible (so shells fade in, not pop).
  vis: number;
}

class Bg05 implements EddieBackgroundVariant {
  private scene: THREE.Scene | null = null;
  private group = new THREE.Group();
  private prevBackground: THREE.Scene["background"] = null;
  private prevFog: THREE.Scene["fog"] = null;

  // Shared wireframe geometries (one per polyhedron type), disposed once.
  private geos: THREE.BufferGeometry[] = [];
  private shapes: Shape[] = [];

  private camera: THREE.PerspectiveCamera | null = null;
  private camBaseZ = 90;

  private offBeat?: () => void;
  private offShake?: () => void;
  private offIntensity?: () => void;

  private morph = 0;
  private morphTarget = 0;
  private beat = 0; // one-shot bloom pulse 0..1, decays
  private beatDecay = 5;
  private shake = 0;
  private t = 0;

  mount(ctx: { scene: THREE.Scene; camera?: THREE.PerspectiveCamera; juice: EventBus<EddieJuiceEvents> }): void {
    this.scene = ctx.scene;
    this.prevBackground = ctx.scene.background;
    this.prevFog = ctx.scene.fog;
    ctx.scene.background = new THREE.Color(0x05010f);
    ctx.scene.fog = new THREE.FogExp2(0x05010f, 0.0035);

    // Build the three wireframe geometries once (edges-only so they're true
    // wireframes, not triangle soup).
    const ico = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1, 0));
    const dod = new THREE.EdgesGeometry(new THREE.DodecahedronGeometry(1, 0));
    const oct = new THREE.EdgesGeometry(new THREE.OctahedronGeometry(1, 0));
    this.geos = [ico, dod, oct];

    // Populate the pool. Shapes are assigned to recursion shells: inner shells
    // are small/close, outer shells large radius — revealed as morph rises.
    for (let i = 0; i < MAX_SHAPES; i++) {
      const shell = Math.min(SHELLS - 1, Math.floor((i / MAX_SHAPES) * SHELLS));
      const geo = this.geos[i % this.geos.length];
      const hue = i % NEON.length;
      const mat = new THREE.LineBasicMaterial({
        color: NEON[hue],
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: true,
      });
      const mesh = new THREE.LineSegments(geo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;

      // Stable orbit + spin per shape.
      const orbitR = 8 + shell * 14 + Math.random() * 8;
      const orbitAxis = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5,
      ).normalize();
      const spinAxis = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5,
      ).normalize();
      const baseScale = 5 - shell * 0.6 + Math.random() * 2;

      const shape: Shape = {
        mesh,
        mat,
        shell,
        orbitR,
        orbitAxis,
        orbitPhase: Math.random() * Math.PI * 2,
        orbitSpeed: (0.1 + Math.random() * 0.25) * (Math.random() < 0.5 ? -1 : 1),
        spinAxis,
        spinSpeed: 0.3 + Math.random() * 0.6,
        baseScale: Math.max(1.2, baseScale),
        hue,
        vis: 0,
      };
      this.shapes.push(shape);
      this.group.add(mesh);
    }

    this.scene.add(this.group);

    if (ctx.camera) {
      this.camera = ctx.camera;
      this.camera.position.set(0, 0, this.camBaseZ);
      this.camera.lookAt(0, 0, 0);
    }

    this.offBeat = ctx.juice.on("eddieBeatPulse", (e) => {
      const base = e.downbeat ? 1 : 0.5;
      this.beat = Math.max(this.beat, base);
      this.beatDecay = e.downbeat ? 1 / 0.28 : 1 / 0.18;
    });
    this.offShake = ctx.juice.on("eddieShake", (e) => {
      this.shake = Math.max(this.shake, e.magnitude);
    });
    this.offIntensity = ctx.juice.on("eddieIntensity", (e) => {
      this.morphTarget = Math.min(1, Math.max(0, e.value));
    });
  }

  /** How many shells are "active" at the current morph. Shell 0 always on; each
   *  further shell unlocks across the morph range. */
  private activeShellLevel(): number {
    // Beat nudges an extra shell in on the pulse (the "shape burst").
    return this.morph * SHELLS + this.beat * this.morph * 1.2;
  }

  update(dt: number, _audioTime: number): void {
    this.t += dt;

    // Ease morph toward target (never snap).
    this.morph += (this.morphTarget - this.morph) * dt * 1.5;
    if (this.beat > 0) this.beat = Math.max(0, this.beat - dt * this.beatDecay);

    const m = this.morph;
    const shellLevel = this.activeShellLevel();
    // Global spin/scale ramps with morph; beat punches an extra burst.
    const spinMul = 0.4 + m * 3.5 + this.beat * 2;
    const glowBase = 0.18 + m * 0.5;
    const burst = this.beat * (0.3 + m * 0.7);
    // Beat pushes shapes outward; morph adds a continuous breathing pulse.
    const outPush = 1 + burst * 0.35 + Math.sin(this.t * 2) * m * 0.08;
    // Kaleidoscopic strobe near full overload.
    const strobe = m > 0.7 ? 0.5 + 0.5 * Math.sin(this.t * 28) : 1;

    for (const s of this.shapes) {
      // Target visibility: this shape is "on" once morph has unlocked its shell.
      // Shell 0 is on whenever morph > ~0 so something is always present.
      const target = shellLevel >= s.shell + (s.shell === 0 ? -0.5 : 0) ? 1 : 0;
      s.vis += (target - s.vis) * dt * 2.2;
      if (s.vis < 0.01 && target === 0) {
        if (s.mesh.visible) {
          s.mesh.visible = false;
          s.mat.opacity = 0;
        }
        continue;
      }
      s.mesh.visible = true;

      // Orbit around the origin on the shape's stable axis (recursive shell look).
      const ang = s.orbitPhase + this.t * s.orbitSpeed * (1 + m * 2);
      // Build an orbit position: rotate a base radius vector around orbitAxis.
      const base = new THREE.Vector3(s.orbitR * outPush, 0, 0);
      const q = new THREE.Quaternion().setFromAxisAngle(s.orbitAxis, ang);
      base.applyQuaternion(q);
      // Outer shells also swing in Z so the field has depth.
      base.z += Math.sin(ang * 1.3 + s.shell) * s.orbitR * 0.3;
      s.mesh.position.copy(base);

      // Spin.
      s.mesh.rotateOnAxis(s.spinAxis, s.spinSpeed * spinMul * dt);

      // Scale: shells subdivide visually by shrinking outer copies; beat pops scale.
      const sc = s.baseScale * s.vis * (1 + burst * 0.25);
      s.mesh.scale.setScalar(Math.max(0.001, sc));

      // Emissive glow (opacity stands in for brightness on additive lines).
      const glow = (glowBase + burst) * s.vis * strobe;
      s.mat.opacity = Math.min(1, glow);
      // Hue cycles faster at high morph for the kaleidoscope shimmer.
      if (m > 0.5) {
        const hi = (s.hue + Math.floor(this.t * (1 + m * 4))) % NEON.length;
        s.mat.color.setHex(NEON[hi]);
      } else {
        s.mat.color.setHex(NEON[s.hue]);
      }
    }

    // Group slow auto-rotate; faster with morph for the swirling-overload feel.
    this.group.rotation.y += dt * (0.05 + m * 0.4);
    this.group.rotation.x += dt * (0.02 + m * 0.15);

    // Camera: parked, pulled slightly inward as morph rises so the swarm engulfs
    // the view; shake + morph-driven idle jitter jolt it.
    if (this.camera) {
      const baseZ = this.camBaseZ - m * 25;
      if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 6);
      const j = this.shake + m * 0.8 + this.beat * m * 1.5;
      this.camera.position.set(
        (Math.random() - 0.5) * j * 1.6,
        (Math.random() - 0.5) * j * 1.4,
        baseZ + (Math.random() - 0.5) * j,
      );
      this.camera.lookAt(0, 0, 0);
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

    for (const s of this.shapes) {
      this.group.remove(s.mesh);
      s.mat.dispose();
    }
    this.shapes = [];
    for (const g of this.geos) g.dispose();
    this.geos = [];
    this.camera = null;
  }
}

const def: EddieBackgroundDef = {
  id: "bg05",
  label: "Geometric Bloom → Fractal Overload",
  blurb: "Calm neon wireframe polyhedra that multiply into recursive shells, spin up and strobe into a kaleidoscopic fractal explosion as intensity peaks.",
  create: () => new Bg05(),
};

export default def;
