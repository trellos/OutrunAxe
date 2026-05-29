// bg03 — "Memphis Blizzard". A flat bold-color void with drifting, tumbling 3D
// Memphis-design primitives — confetti triangles, squiggles, zigzag bars, and
// checkerboard tiles — that surge outward on the beat.
//
// Visuals only (GDD §8): subscribes to the juice bus — eddieBeatPulse surges the
// shapes' tumble + a void flash, eddieShake jolts the parked camera. Sets
// scene.background/fog in mount and RESTORES them in dispose, disposing every
// geometry/material/texture and unsubscribing.

import * as THREE from "three";
import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";
import type { EddieBackgroundDef, EddieBackgroundVariant } from "./types";

// Bold flat Memphis palette (anchored on the Eddie neon, plus playful brights).
const VOID_BASE = 0x150a2e;
const MEMPHIS = [0xff2bd6, 0x00f0ff, 0xffd02b, 0xff5a3c, 0x36e07a, 0xffffff, 0x7a3cff];

const SHAPE_COUNT = 64;
const FIELD_X = 120;
const FIELD_Y = 80;
const FIELD_Z_NEAR = 30;
const FIELD_Z_FAR = -120;

interface Shape {
  mesh: THREE.Mesh;
  spin: THREE.Vector3; // per-axis angular velocity
  drift: number; // downward drift speed
  swayPhase: number;
  baseScale: number; // resting uniform scale (beat pop multiplies this)
}

class Bg03 implements EddieBackgroundVariant {
  private scene: THREE.Scene | null = null;
  private group = new THREE.Group();
  private prevBackground: THREE.Scene["background"] = null;
  private prevFog: THREE.Scene["fog"] = null;

  private bgColor = new THREE.Color(VOID_BASE);

  // Shared geometries (one per shape kind), disposed once at the end.
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  private checkerTex: THREE.CanvasTexture | null = null;
  private shapes: Shape[] = [];

  private camera: THREE.PerspectiveCamera | null = null;
  private camBaseY = 0;
  private camBaseZ = 90;

  private offBeat?: () => void;
  private offShake?: () => void;

  private pulse = 0;
  private surge = 0;
  private shake = 0;
  private t = 0;

  mount(ctx: { scene: THREE.Scene; camera?: THREE.PerspectiveCamera; juice: EventBus<EddieJuiceEvents> }): void {
    this.scene = ctx.scene;
    this.prevBackground = ctx.scene.background;
    this.prevFog = ctx.scene.fog;
    ctx.scene.background = this.bgColor;
    ctx.scene.fog = null;

    // --- Shared shape geometries.
    const triGeo = this.buildTriangleGeo(); // flat confetti triangle
    const zigGeo = new THREE.TorusGeometry(3.2, 0.7, 6, 16, Math.PI * 1.4); // arc squiggle
    const barGeo = new THREE.BoxGeometry(7, 1.6, 1.6); // zigzag bar
    const checkGeo = new THREE.PlaneGeometry(6, 6); // checkerboard tile
    const dotGeo = new THREE.SphereGeometry(2.0, 12, 10); // bouncy dot
    this.geos.push(triGeo, zigGeo, barGeo, checkGeo, dotGeo);

    // Checkerboard texture for the tile shapes.
    this.checkerTex = this.buildCheckerTexture();

    const kinds: { geo: THREE.BufferGeometry; checker: boolean }[] = [
      { geo: triGeo, checker: false },
      { geo: zigGeo, checker: false },
      { geo: barGeo, checker: false },
      { geo: checkGeo, checker: true },
      { geo: dotGeo, checker: false },
    ];

    for (let i = 0; i < SHAPE_COUNT; i++) {
      const kind = kinds[i % kinds.length];
      const color = new THREE.Color(MEMPHIS[i % MEMPHIS.length]);
      const mat = kind.checker
        ? new THREE.MeshBasicMaterial({
            map: this.checkerTex!,
            color,
            side: THREE.DoubleSide,
            fog: false,
          })
        : new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, fog: false });
      this.mats.push(mat);

      const mesh = new THREE.Mesh(kind.geo, mat);
      mesh.position.set(
        (Math.random() - 0.5) * FIELD_X * 2,
        (Math.random() - 0.5) * FIELD_Y * 2,
        FIELD_Z_FAR + Math.random() * (FIELD_Z_NEAR - FIELD_Z_FAR),
      );
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      const sc = 0.7 + Math.random() * 1.1;
      mesh.scale.setScalar(sc);
      mesh.frustumCulled = false;
      this.group.add(mesh);

      this.shapes.push({
        mesh,
        spin: new THREE.Vector3(
          (Math.random() - 0.5) * 1.6,
          (Math.random() - 0.5) * 1.6,
          (Math.random() - 0.5) * 1.6,
        ),
        drift: 3 + Math.random() * 6,
        swayPhase: Math.random() * Math.PI * 2,
        baseScale: sc,
      });
    }

    ctx.scene.add(this.group);

    if (ctx.camera) {
      this.camera = ctx.camera;
      this.camera.position.set(0, this.camBaseY, this.camBaseZ);
      this.camera.lookAt(0, 0, 0);
    }

    this.offBeat = ctx.juice.on("eddieBeatPulse", (e) => {
      this.pulse = e.downbeat ? 1 : 0.55;
      this.surge = Math.max(this.surge, e.downbeat ? 1 : 0.6);
    });
    this.offShake = ctx.juice.on("eddieShake", (e) => {
      this.shake = Math.max(this.shake, e.magnitude);
    });
  }

  private buildTriangleGeo(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    const verts = new Float32Array([0, 4, 0, -3.6, -3, 0, 3.6, -3, 0]);
    geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    geo.setAttribute(
      "uv",
      new THREE.BufferAttribute(new Float32Array([0.5, 1, 0, 0, 1, 0]), 2),
    );
    geo.computeVertexNormals();
    return geo;
  }

  private buildCheckerTexture(): THREE.CanvasTexture {
    const cv = document.createElement("canvas");
    cv.width = 64;
    cv.height = 64;
    const g = cv.getContext("2d")!;
    const n = 4;
    const s = cv.width / n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        g.fillStyle = (x + y) % 2 === 0 ? "#ffffff" : "#150a2e";
        g.fillRect(x * s, y * s, s, s);
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    return tex;
  }

  update(dt: number, _audioTime: number): void {
    this.t += dt;

    if (this.pulse > 0) this.pulse = Math.max(0, this.pulse - dt * 3.0);
    if (this.surge > 0) this.surge = Math.max(0, this.surge - dt * 2.2);

    // Void flashes a touch brighter on the beat (stays flat + bold, never white-out).
    const flash = this.pulse * 0.12;
    this.bgColor.setRGB(
      0.082 + flash,
      0.039 + flash * 0.6,
      0.18 + flash,
    );

    const spinBoost = 1 + this.surge * 2.2;
    for (const s of this.shapes) {
      const m = s.mesh;
      m.rotation.x += s.spin.x * dt * spinBoost;
      m.rotation.y += s.spin.y * dt * spinBoost;
      m.rotation.z += s.spin.z * dt * spinBoost;

      // Drift downward + a lateral sway; surge nudges everything outward from center.
      m.position.y -= s.drift * dt * (1 + this.surge * 0.8);
      m.position.x += Math.sin(this.t * 0.7 + s.swayPhase) * dt * 4;
      if (this.surge > 0.01) {
        const r = Math.hypot(m.position.x, m.position.y) || 1;
        m.position.x += (m.position.x / r) * this.surge * dt * 20;
        m.position.y += (m.position.y / r) * this.surge * dt * 20;
      }
      // Recycle: when a shape drifts off the bottom, respawn at the top.
      if (m.position.y < -FIELD_Y) {
        m.position.y = FIELD_Y;
        m.position.x = (Math.random() - 0.5) * FIELD_X * 2;
        m.position.z = FIELD_Z_FAR + Math.random() * (FIELD_Z_NEAR - FIELD_Z_FAR);
      }
      // Keep horizontal drift bounded.
      if (m.position.x > FIELD_X) m.position.x = -FIELD_X;
      else if (m.position.x < -FIELD_X) m.position.x = FIELD_X;
    }

    // Beat pop on scale for a little punch.
    const popped = 1 + this.pulse * 0.18;
    for (const s of this.shapes) s.mesh.scale.setScalar(s.baseScale * popped);

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 6);
      if (this.camera) {
        const m = this.shake;
        this.camera.position.set(
          (Math.random() - 0.5) * m * 2.4,
          this.camBaseY + (Math.random() - 0.5) * m * 2.0,
          this.camBaseZ + (Math.random() - 0.5) * m,
        );
        this.camera.lookAt(0, 0, 0);
      }
    } else if (this.camera) {
      this.camera.position.set(0, this.camBaseY, this.camBaseZ);
      this.camera.lookAt(0, 0, 0);
    }
  }

  dispose(): void {
    this.offBeat?.();
    this.offShake?.();
    this.offBeat = undefined;
    this.offShake = undefined;

    if (this.scene) {
      this.scene.remove(this.group);
      this.scene.background = this.prevBackground;
      this.scene.fog = this.prevFog;
    }
    this.scene = null;

    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.checkerTex?.dispose();
    this.geos = [];
    this.mats = [];
    this.checkerTex = null;
    this.shapes = [];
    this.camera = null;
  }
}

const def: EddieBackgroundDef = {
  id: "bg03",
  label: "Memphis Blizzard",
  blurb: "Flat bold-color void with tumbling 3D Memphis primitives — triangles, squiggles, zigzags, checker tiles surge on the beat.",
  create: () => new Bg03(),
};

export default def;
