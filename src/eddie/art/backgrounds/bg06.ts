// bg06 — "Desert Drive -> Rainstorm" — driving along a winding desert road at
// dusk through wide-open desert that builds into an intense RAINSTORM as
// performance intensity climbs. Three.js scene decoration (visuals only, GDD §8).
//
// A winding pixel road curves left/right into the distance; the camera follows
// the road's curve (its X tracks the road centerline just ahead, and it looks
// further down the road). The foreground is mostly OPEN desert — only the
// occasional saguaro cactus or small rock sits beside the road and streams past
// (recycling front->back so the drive is endless). The big ROCK MONUMENTS
// (mesas / buttes / arches) live FAR on the horizon as a sparse silhouette band,
// not lining the road. A gradient desert sky sits behind the horizon.
//
// Roadside treat: every several "blocks" of travel a VIGNETTE streams past — a
// huge boulder with a GUITAR leaning against it and a pair of COWBOY BOOTS beside
// it (one chunky pixel billboard). It's gated by travelled distance so it stays
// rare, not a fixture.
//
// An eased `morph` (0..1) drives the transformation:
//   morph 0  -> calm dusk desert drive: warm sky, dry road + sand, open vistas,
//               distant monument silhouettes, no rain.
//   morph ~  -> storm clouds darken the sky, rain begins (sparse pixel streaks),
//               the road turns wet/reflective, wind tilts the rain + sways props,
//               occasional lightning on the beat.
//   morph 1  -> torrential chaotic downpour: dense slanted rain, near-black sky,
//               frequent lightning, camera buffeting.
//
// Juice (all three required):
//   eddieBeatPulse  -> rain surge + lightning (downbeat stronger; strike chance
//                      scales with morph).
//   eddieShake      -> camera jolt that decays.
//   eddieIntensity  -> stored as target; `morph` eases toward it every frame.
//
// dispose() restores scene.background/fog, disposes every geometry/material/
// texture and unsubscribes all listeners. Bloom-safe (no post-process touched);
// near meshes are frustumCulled=false.

import * as THREE from "three";
import type { EventBus } from "../../../engine/EventBus";
import type { EddieJuiceEvents } from "../../../music/eddie/eddieTypes";
import type { EddieBackgroundDef, EddieBackgroundVariant } from "./types";

const SKY_H = 96; // sky gradient canvas resolution (vertical)
const RAIN_COUNT = 700; // max rain streaks (scaled visible by morph)
const PROP_COUNT = 12; // sparse near props beside the road
const FAR_Z = -300; // recycle horizon (props spawn here)
const NEAR_Z = 30; // props recycle once they pass this (behind camera)
const ROAD_HALF_W = 11; // road half-width in world units (at the surface)
// Lift roadside billboards' base clear of the ground plane so their vertical
// quad never intersects (and z-fights) the horizontal ground/road planes.
const PROP_BASE_LIFT = 0.5;
// Rare roadside vignette (guitar + cowboy boots leaning on a huge boulder):
// re-appears only after this much travelled distance, so it's a treat not a fixture.
const VIGNETTE_GAP = 900;

type PropKind = "cactus" | "smallrock";

interface Prop {
  mesh: THREE.Mesh;
  side: number; // -1 left, +1 right of the road
  offset: number; // lateral distance from road edge
  baseScale: number;
  kind: PropKind;
}

class Bg06 implements EddieBackgroundVariant {
  private scene: THREE.Scene | null = null;
  private group = new THREE.Group();
  private prevBackground: THREE.Scene["background"] = null;
  private prevFog: THREE.Scene["fog"] = null;

  // Sky gradient.
  private skyCanvas!: HTMLCanvasElement;
  private skyCtx!: CanvasRenderingContext2D;
  private skyTex!: THREE.CanvasTexture;
  private skyMat!: THREE.MeshBasicMaterial;
  private skyMesh!: THREE.Mesh;

  // Distant monument silhouette band (sparse, on the horizon).
  private monTex!: THREE.CanvasTexture;
  private monMat!: THREE.MeshBasicMaterial;
  private monMesh!: THREE.Mesh;

  // Ground plane (dry sand -> wet).
  private groundMat!: THREE.MeshBasicMaterial;
  private groundMesh!: THREE.Mesh;
  private groundCanvas!: HTMLCanvasElement;
  private groundCtx!: CanvasRenderingContext2D;
  private groundTex!: THREE.CanvasTexture;
  private groundScroll = 0;

  // Winding road: a ribbon strip mesh whose vertices follow roadCurve(z).
  private roadMesh!: THREE.Mesh;
  private roadGeo!: THREE.PlaneGeometry;
  private roadMat!: THREE.MeshBasicMaterial;
  private roadCanvas!: HTMLCanvasElement;
  private roadCtx!: CanvasRenderingContext2D;
  private roadTex!: THREE.CanvasTexture;
  private roadScroll = 0;
  private roadSegZ: number[] = []; // z of each road cross-row (camera->far)

  // Scenery props (occasional cactus + small rock beside the road).
  private props: Prop[] = [];
  private cactusTex!: THREE.CanvasTexture;
  private smallRockTex!: THREE.CanvasTexture;
  private cactusMat!: THREE.MeshBasicMaterial;
  private smallRockMat!: THREE.MeshBasicMaterial;
  private cactusGeo!: THREE.PlaneGeometry;
  private rockGeo!: THREE.PlaneGeometry;

  // Rare roadside vignette: huge boulder + guitar + cowboy boots (one billboard).
  private vignetteTex!: THREE.CanvasTexture;
  private vignetteMat!: THREE.MeshBasicMaterial;
  private vignetteGeo!: THREE.PlaneGeometry;
  private vignetteMesh!: THREE.Mesh;
  private vignetteSide = 1;
  private vignetteActive = false;
  private distSinceVignette = 0;

  // Rain.
  private rain!: THREE.LineSegments;
  private rainGeo!: THREE.BufferGeometry;
  private rainMat!: THREE.LineBasicMaterial;
  private rainPos!: Float32Array;
  private rainVel!: Float32Array;

  // Lightning.
  private flashMat!: THREE.MeshBasicMaterial;
  private flashMesh!: THREE.Mesh;
  private flash = 0;
  private boltGeo!: THREE.BufferGeometry;
  private boltMat!: THREE.LineBasicMaterial;
  private bolt!: THREE.LineSegments;
  private boltLife = 0;

  private camera: THREE.PerspectiveCamera | null = null;
  private camBaseY = 13;
  private camBaseZ = 34;

  private offBeat?: () => void;
  private offShake?: () => void;
  private offIntensity?: () => void;

  private morph = 0;
  private morphTarget = 0;
  private beat = 0;
  private beatDecay = 4;
  private shake = 0;
  private t = 0;
  private flySpeed = 56; // forward travel; advances roadPhase + prop streaming
  private roadPhase = 0; // travelled distance, drives the winding curve scroll
  private rngState = 0x1234abcd >>> 0;

  mount(ctx: {
    scene: THREE.Scene;
    camera?: THREE.PerspectiveCamera;
    juice: EventBus<EddieJuiceEvents>;
  }): void {
    this.scene = ctx.scene;
    this.prevBackground = ctx.scene.background;
    this.prevFog = ctx.scene.fog;
    ctx.scene.background = new THREE.Color(0x3a2436);
    ctx.scene.fog = new THREE.Fog(0x3a2436, 70, 260);

    // --- Sky --------------------------------------------------------------
    this.skyCanvas = document.createElement("canvas");
    this.skyCanvas.width = 8;
    this.skyCanvas.height = SKY_H;
    this.skyCtx = this.skyCanvas.getContext("2d")!;
    this.skyTex = new THREE.CanvasTexture(this.skyCanvas);
    this.skyTex.colorSpace = THREE.SRGBColorSpace;
    this.skyTex.magFilter = THREE.LinearFilter;
    this.skyTex.minFilter = THREE.LinearFilter;
    this.skyTex.generateMipmaps = false;
    // Pin the gradient to a fixed world band and CLAMP beyond it. The sky plane
    // is oversized (below) so its edges never sit inside the frustum; clamping
    // makes the area above the gradient read as flat sky-top colour and below as
    // flat horizon colour, instead of revealing scene.background at the edges.
    // repeat/offset map gradient texCoord 0..1 onto world y -78..242 for a plane
    // of height 1000 centred at y=82: v' = uv.v*3.125 - 1.0625.
    this.skyTex.wrapS = THREE.ClampToEdgeWrapping;
    this.skyTex.wrapT = THREE.ClampToEdgeWrapping;
    this.skyTex.repeat.set(1, 3.125);
    this.skyTex.offset.set(0, -1.0625);
    this.skyMat = new THREE.MeshBasicMaterial({
      map: this.skyTex,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    // Oversized so the plane's edges always fall outside the camera frustum.
    // The gradient still occupies world y -78..242 (via the texture clamp above);
    // everything beyond is flat sky/horizon colour, so no background shows.
    this.skyMesh = new THREE.Mesh(new THREE.PlaneGeometry(2600, 1000), this.skyMat);
    this.skyMesh.position.set(0, 82, -300);
    this.skyMesh.renderOrder = -30;
    this.skyMesh.frustumCulled = false;
    this.group.add(this.skyMesh);

    // --- Distant monuments (sparse horizon silhouette) --------------------
    this.monTex = this.buildMonumentTexture();
    this.monMat = new THREE.MeshBasicMaterial({
      map: this.monTex,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.monMesh = new THREE.Mesh(new THREE.PlaneGeometry(720, 70), this.monMat);
    this.monMesh.position.set(0, 18, -296);
    this.monMesh.renderOrder = -28;
    this.monMesh.frustumCulled = false;
    this.group.add(this.monMesh);

    // --- Ground -----------------------------------------------------------
    this.groundCanvas = document.createElement("canvas");
    this.groundCanvas.width = 64;
    this.groundCanvas.height = 64;
    this.groundCtx = this.groundCanvas.getContext("2d")!;
    this.groundCtx.imageSmoothingEnabled = false;
    this.groundTex = new THREE.CanvasTexture(this.groundCanvas);
    this.groundTex.colorSpace = THREE.SRGBColorSpace;
    this.groundTex.magFilter = THREE.NearestFilter;
    this.groundTex.minFilter = THREE.NearestFilter;
    this.groundTex.generateMipmaps = false;
    this.groundTex.wrapS = THREE.RepeatWrapping;
    this.groundTex.wrapT = THREE.RepeatWrapping;
    this.groundTex.repeat.set(10, 14);
    this.groundMat = new THREE.MeshBasicMaterial({
      map: this.groundTex,
      depthWrite: true,
      fog: true,
    });
    this.groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(600, 520), this.groundMat);
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.position.set(0, -0.05, -160);
    this.groundMesh.renderOrder = -25;
    this.groundMesh.frustumCulled = false;
    this.group.add(this.groundMesh);

    // --- Winding road -----------------------------------------------------
    this.roadCanvas = document.createElement("canvas");
    this.roadCanvas.width = 32;
    this.roadCanvas.height = 128;
    this.roadCtx = this.roadCanvas.getContext("2d")!;
    this.roadCtx.imageSmoothingEnabled = false;
    this.roadTex = new THREE.CanvasTexture(this.roadCanvas);
    this.roadTex.colorSpace = THREE.SRGBColorSpace;
    this.roadTex.magFilter = THREE.NearestFilter;
    this.roadTex.minFilter = THREE.NearestFilter;
    this.roadTex.generateMipmaps = false;
    this.roadTex.wrapS = THREE.ClampToEdgeWrapping;
    this.roadTex.wrapT = THREE.RepeatWrapping;
    // depthWrite ON + polygonOffset pulls the road toward the camera in depth so
    // it draws cleanly on top of the coplanar ground with no z-fighting; the
    // mesh also sits at a small +y lift (see ROAD_Y below) as a second guard.
    this.roadMat = new THREE.MeshBasicMaterial({
      map: this.roadTex,
      transparent: true,
      depthWrite: true,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    const ROAD_ROWS = 64;
    const ROAD_Y = 0.35; // lift above the ground plane (which sits at y=-0.05)
    this.roadGeo = new THREE.PlaneGeometry(1, 1, 1, ROAD_ROWS);
    this.roadMesh = new THREE.Mesh(this.roadGeo, this.roadMat);
    this.roadMesh.rotation.x = -Math.PI / 2;
    this.roadMesh.position.set(0, ROAD_Y, 0);
    this.roadMesh.renderOrder = -24;
    this.roadMesh.frustumCulled = false;
    this.group.add(this.roadMesh);
    for (let r = 0; r <= ROAD_ROWS; r++) {
      const f = r / ROAD_ROWS;
      this.roadSegZ.push(NEAR_Z - f * (NEAR_Z - FAR_Z));
    }
    this.paintRoad();

    // --- Props (sparse, beside the road) ----------------------------------
    this.cactusTex = this.buildCactusTexture();
    this.smallRockTex = this.buildSmallRockTexture();
    // alphaTest cutout (NOT blended transparency) so the billboards are opaque
    // where drawn and write depth cleanly — no transparent sort flicker. They are
    // also lifted clear of the ground (see PROP_BASE_LIFT) and polygon-offset so
    // the vertical billboard never z-fights the horizontal ground/road planes.
    this.cactusMat = new THREE.MeshBasicMaterial({
      map: this.cactusTex,
      transparent: false,
      alphaTest: 0.5,
      depthWrite: true,
      side: THREE.DoubleSide,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    });
    this.smallRockMat = new THREE.MeshBasicMaterial({
      map: this.smallRockTex,
      transparent: false,
      alphaTest: 0.5,
      depthWrite: true,
      side: THREE.DoubleSide,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    });
    this.cactusGeo = new THREE.PlaneGeometry(13, 26);
    this.rockGeo = new THREE.PlaneGeometry(16, 11);
    for (let i = 0; i < PROP_COUNT; i++) {
      const kind: PropKind = this.rng() < 0.6 ? "cactus" : "smallrock";
      const mesh = new THREE.Mesh(
        kind === "cactus" ? this.cactusGeo : this.rockGeo,
        kind === "cactus" ? this.cactusMat : this.smallRockMat,
      );
      mesh.frustumCulled = false;
      const p: Prop = {
        mesh,
        side: this.rng() < 0.5 ? -1 : 1,
        offset: 8 + this.rng() * 40,
        baseScale: 0.7 + this.rng() * 0.9,
        kind,
      };
      this.placeProp(p, FAR_Z + this.rng() * (NEAR_Z - FAR_Z));
      this.group.add(mesh);
      this.props.push(p);
    }

    // --- Rare vignette: boulder + guitar + cowboy boots -------------------
    this.vignetteTex = this.buildVignetteTexture();
    this.vignetteMat = new THREE.MeshBasicMaterial({
      map: this.vignetteTex,
      transparent: false,
      alphaTest: 0.5,
      depthWrite: true,
      side: THREE.DoubleSide,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    });
    this.vignetteGeo = new THREE.PlaneGeometry(34, 28);
    this.vignetteMesh = new THREE.Mesh(this.vignetteGeo, this.vignetteMat);
    this.vignetteMesh.frustumCulled = false;
    this.vignetteMesh.visible = false;
    this.group.add(this.vignetteMesh);

    // --- Rain -------------------------------------------------------------
    this.rainGeo = new THREE.BufferGeometry();
    this.rainPos = new Float32Array(RAIN_COUNT * 2 * 3);
    this.rainVel = new Float32Array(RAIN_COUNT * 3);
    for (let i = 0; i < RAIN_COUNT; i++) this.respawnRain(i, true);
    this.rainGeo.setAttribute("position", new THREE.BufferAttribute(this.rainPos, 3));
    this.rainGeo.setDrawRange(0, 0);
    this.rainMat = new THREE.LineBasicMaterial({
      color: 0xaecbe6,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: true,
      blending: THREE.AdditiveBlending,
    });
    this.rain = new THREE.LineSegments(this.rainGeo, this.rainMat);
    this.rain.frustumCulled = false;
    this.group.add(this.rain);

    // --- Lightning --------------------------------------------------------
    this.flashMat = new THREE.MeshBasicMaterial({
      color: 0xdfe8ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      fog: false,
      blending: THREE.AdditiveBlending,
    });
    this.flashMesh = new THREE.Mesh(new THREE.PlaneGeometry(900, 460), this.flashMat);
    this.flashMesh.position.set(0, 60, -130);
    this.flashMesh.renderOrder = -5;
    this.flashMesh.frustumCulled = false;
    this.group.add(this.flashMesh);

    this.boltGeo = new THREE.BufferGeometry();
    this.boltGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(16 * 2 * 3), 3));
    this.boltGeo.setDrawRange(0, 0);
    this.boltMat = new THREE.LineBasicMaterial({
      color: 0xf2f6ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending,
    });
    this.bolt = new THREE.LineSegments(this.boltGeo, this.boltMat);
    this.bolt.frustumCulled = false;
    this.group.add(this.bolt);

    this.scene.add(this.group);

    if (ctx.camera) {
      this.camera = ctx.camera;
      this.camera.position.set(0, this.camBaseY, this.camBaseZ);
      this.camera.lookAt(0, 8, -120);
    }

    this.paintSky();
    this.paintGround();

    this.offBeat = ctx.juice.on("eddieBeatPulse", (e) => {
      this.beat = Math.max(this.beat, e.downbeat ? 1 : 0.55);
      this.beatDecay = e.downbeat ? 1 / 0.3 : 1 / 0.18;
      const chance = this.morph * (e.downbeat ? 1.1 : 0.6);
      if (this.morph > 0.25 && this.rng() < chance) this.strikeLightning(e.downbeat);
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

  /** Lateral X (world units) of the road centerline at world depth z. */
  private roadCurve(z: number): number {
    const d = this.roadPhase - z;
    return (
      Math.sin(d * 0.012) * 22 +
      Math.sin(d * 0.027 + 1.3) * 11 +
      Math.sin(d * 0.006 + 0.5) * 30
    );
  }

  private placeProp(p: Prop, z: number): void {
    const cx = this.roadCurve(z);
    const geo = p.mesh.geometry as THREE.PlaneGeometry;
    const h = (geo.parameters.height ?? 26) * p.baseScale;
    p.mesh.scale.setScalar(p.baseScale);
    // Base lifted clear of the ground so the standing billboard doesn't cross it.
    p.mesh.position.set(cx + p.side * (ROAD_HALF_W + p.offset), PROP_BASE_LIFT + h / 2, z);
    p.mesh.rotation.set(0, 0, 0);
  }

  /** Position the vignette billboard beside the road at depth z, on the ground. */
  private placeVignette(z: number): void {
    const cx = this.roadCurve(z);
    const h = this.vignetteGeo.parameters.height ?? 28;
    // Sits a bit further off the road than ordinary props (it's big), base lifted
    // clear of the ground so the standing billboard doesn't z-fight it.
    this.vignetteMesh.position.set(cx + this.vignetteSide * (ROAD_HALF_W + 20), PROP_BASE_LIFT + h / 2, z);
    this.vignetteMesh.rotation.set(0, 0, 0);
  }

  private respawnRain(i: number, scatter: boolean): void {
    const o = i * 2 * 3;
    const x = (this.rng() - 0.5) * 240;
    const y = scatter ? this.rng() * 140 : 90 + this.rng() * 50;
    const z = -10 - this.rng() * 240;
    const len = 6 + this.rng() * 6;
    this.rainPos[o] = x;
    this.rainPos[o + 1] = y;
    this.rainPos[o + 2] = z;
    this.rainPos[o + 3] = x;
    this.rainPos[o + 4] = y + len;
    this.rainPos[o + 5] = z;
    this.rainVel[i * 3] = 0;
    this.rainVel[i * 3 + 1] = -(160 + this.rng() * 120);
    this.rainVel[i * 3 + 2] = 0;
  }

  private strikeLightning(strong: boolean): void {
    this.flash = strong ? 1 : 0.6;
    this.boltLife = 0.14;
    const pos = this.boltGeo.getAttribute("position") as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const segs = 10 + Math.floor(this.rng() * 6);
    let x = (this.rng() - 0.5) * 180;
    let y = 130;
    const z = -160 - this.rng() * 60;
    const stepY = 130 / segs;
    let v = 0;
    for (let s = 0; s < segs; s++) {
      const nx = x + (this.rng() - 0.5) * 24;
      const ny = y - stepY;
      arr[v++] = x;
      arr[v++] = y;
      arr[v++] = z;
      arr[v++] = nx;
      arr[v++] = ny;
      arr[v++] = z;
      x = nx;
      y = ny;
    }
    pos.needsUpdate = true;
    this.boltGeo.setDrawRange(0, segs * 2);
    this.boltMat.opacity = 1;
  }

  /** Vertical gradient sky: warm dusk -> dark storm as morph rises. */
  private paintSky(): void {
    const ctx = this.skyCtx;
    const m = this.morph;
    const grad = ctx.createLinearGradient(0, 0, 0, SKY_H);
    const topR = Math.floor(58 - m * 40);
    const topG = Math.floor(30 - m * 22);
    const topB = Math.floor(78 - m * 58);
    const midR = Math.floor(150 - m * 100);
    const midG = Math.floor(60 - m * 20);
    const midB = Math.floor(110 - m * 60);
    const horR = Math.floor(255 - m * 180);
    const horG = Math.floor(150 - m * 90);
    const horB = Math.floor(70 + m * 30);
    grad.addColorStop(0, `rgb(${Math.max(0, topR)},${Math.max(0, topG)},${Math.max(0, topB)})`);
    grad.addColorStop(0.55, `rgb(${Math.max(0, midR)},${Math.max(0, midG)},${Math.max(0, midB)})`);
    grad.addColorStop(1, `rgb(${Math.max(0, horR)},${Math.max(0, horG)},${Math.max(0, horB)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 8, SKY_H);
    if (m > 0.12) {
      const bands = Math.floor(m * 6);
      for (let b = 0; b < bands; b++) {
        const cy = (b * 11 + (this.t * 6) % 11) % (SKY_H * 0.5);
        const shade = Math.floor(30 + b * 6);
        ctx.fillStyle = `rgba(${shade},${shade + 4},${shade + 10},${0.25 + m * 0.5})`;
        ctx.fillRect(0, cy, 8, 3 + Math.floor(m * 3));
      }
    }
    this.skyTex.needsUpdate = true;
  }

  /** Desert floor: dry sand (calm) -> dark wet/reflective (storm). */
  private paintGround(): void {
    const ctx = this.groundCtx;
    const m = this.morph;
    const baseR = Math.floor(150 - m * 110);
    const baseG = Math.floor(110 - m * 80);
    const baseB = Math.floor(70 - m * 30);
    ctx.fillStyle = `rgb(${Math.max(0, baseR)},${Math.max(0, baseG)},${Math.max(0, baseB)})`;
    ctx.fillRect(0, 0, 64, 64);
    const grit = Math.max(0, 1 - m);
    for (let i = 0; i < 120; i++) {
      const gx = Math.floor(this.rng() * 64);
      const gy = Math.floor(this.rng() * 64);
      const d = this.rng() < 0.5 ? 30 : -25;
      ctx.fillStyle = `rgba(${Math.max(0, baseR + d)},${Math.max(0, baseG + d)},${Math.max(0, baseB + d)},${grit})`;
      ctx.fillRect(gx, gy, 1, 1);
    }
    if (m > 0.3) {
      const wet = (m - 0.3) / 0.7;
      for (let i = 0; i < 70; i++) {
        const gx = Math.floor(this.rng() * 64);
        const gy = Math.floor(this.rng() * 64);
        ctx.fillStyle = `rgba(140,170,200,${0.15 + wet * 0.5})`;
        ctx.fillRect(gx, gy, 1, 1);
      }
    }
    this.groundTex.needsUpdate = true;
  }

  /** Road surface stripe texture: asphalt + dashed centerline + edge lines. */
  private paintRoad(): void {
    const ctx = this.roadCtx;
    const m = this.morph;
    const W = 32;
    const H = 128;
    const aR = Math.floor(70 - m * 40);
    const aG = Math.floor(60 - m * 36);
    const aB = Math.floor(58 - m * 30);
    ctx.fillStyle = `rgb(${Math.max(8, aR)},${Math.max(8, aG)},${Math.max(8, aB)})`;
    ctx.fillRect(0, 0, W, H);
    const edge = Math.max(0.25, 1 - m * 0.5);
    ctx.fillStyle = `rgba(210,200,170,${edge})`;
    ctx.fillRect(2, 0, 2, H);
    ctx.fillRect(W - 4, 0, 2, H);
    ctx.fillStyle = `rgba(240,225,150,${edge})`;
    for (let y = 0; y < H; y += 18) ctx.fillRect(W / 2 - 1, y, 2, 9);
    if (m > 0.3) {
      const wet = (m - 0.3) / 0.7;
      for (let i = 0; i < 40; i++) {
        const gx = Math.floor(this.rng() * W);
        const gy = Math.floor(this.rng() * H);
        ctx.fillStyle = `rgba(150,180,210,${0.1 + wet * 0.45})`;
        ctx.fillRect(gx, gy, 1, 2);
      }
    }
    this.roadTex.needsUpdate = true;
  }

  private buildMonumentTexture(): THREE.CanvasTexture {
    const W = 360;
    const H = 64;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, W, H);
    g.fillStyle = "#3a2230";
    let x = 6;
    while (x < W) {
      if (this.rng() < 0.45) {
        const kind = this.rng();
        const w = 18 + Math.floor(this.rng() * 40);
        const h = 14 + Math.floor(this.rng() * 34);
        if (kind < 0.5) {
          g.fillRect(x, H - h, w, h);
        } else if (kind < 0.8) {
          const bw = Math.floor(w * 0.5);
          g.fillRect(x, H - h, bw, h);
        } else {
          g.fillRect(x, H - h, w, h);
          g.clearRect(x + Math.floor(w * 0.35), H - Math.floor(h * 0.5), Math.floor(w * 0.3), Math.floor(h * 0.5));
        }
        x += w + 20 + Math.floor(this.rng() * 60);
      } else {
        x += 24 + Math.floor(this.rng() * 70);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    return tex;
  }

  private buildCactusTexture(): THREE.CanvasTexture {
    const c = document.createElement("canvas");
    c.width = 16;
    c.height = 32;
    const g = c.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, 16, 32);
    g.fillStyle = "#2f7a3a";
    g.fillRect(6, 4, 4, 28);
    g.fillRect(2, 14, 2, 8);
    g.fillRect(2, 12, 4, 2);
    g.fillRect(12, 18, 2, 8);
    g.fillRect(10, 16, 4, 2);
    g.fillStyle = "#236030";
    g.fillRect(8, 4, 2, 28);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    return tex;
  }

  private buildSmallRockTexture(): THREE.CanvasTexture {
    const c = document.createElement("canvas");
    c.width = 16;
    c.height = 12;
    const g = c.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, 16, 12);
    g.fillStyle = "#9a5238";
    g.fillRect(2, 5, 12, 7);
    g.fillRect(4, 3, 8, 3);
    g.fillStyle = "#7c3f2c";
    g.fillRect(2, 9, 12, 3);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    return tex;
  }

  /** Composite billboard: a HUGE boulder with a guitar leaning on it and a pair
   *  of cowboy boots beside it. Chunky pixels (NearestFilter). 48x40 canvas. */
  private buildVignetteTexture(): THREE.CanvasTexture {
    const W = 48;
    const H = 40;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, W, H);

    // --- Boulder (big rounded sandstone mass filling the right ~2/3). ------
    g.fillStyle = "#8a6a4a";
    g.fillRect(16, 8, 28, 30);
    g.fillRect(20, 4, 20, 6); // rounded top
    g.fillRect(14, 14, 4, 22); // left bulge
    g.fillStyle = "#6e5238";
    g.fillRect(16, 30, 28, 8); // shadowed base
    g.fillRect(30, 8, 2, 24); // crack
    g.fillRect(24, 16, 6, 2);
    g.fillStyle = "#a07e58";
    g.fillRect(20, 8, 8, 3); // highlight

    // --- Guitar leaning against the boulder (tilted, on the left face). ----
    g.fillStyle = "#c0392b"; // red guitar body
    g.fillRect(6, 26, 9, 10); // body
    g.fillRect(8, 24, 6, 2); // upper bout
    g.fillStyle = "#7a2018";
    g.fillRect(9, 29, 3, 3); // sound hole (dark)
    // Neck: a tan diagonal staircase from the body up toward the boulder.
    g.fillStyle = "#d8b070";
    g.fillRect(13, 22, 3, 3);
    g.fillRect(15, 19, 3, 3);
    g.fillRect(17, 16, 3, 3);
    g.fillRect(19, 13, 3, 3);
    g.fillStyle = "#4a2f1a";
    g.fillRect(20, 10, 4, 3); // headstock
    g.fillStyle = "#efe6c8";
    g.fillRect(8, 27, 1, 8); // strings hint

    // --- Cowboy boots beside the guitar (a pair, on the ground). ----------
    g.fillStyle = "#8b5a2b";
    g.fillRect(1, 31, 4, 7); // shaft
    g.fillRect(1, 36, 7, 2); // foot
    g.fillStyle = "#5e3a18";
    g.fillRect(1, 38, 7, 1); // sole
    g.fillStyle = "#caa46a";
    g.fillRect(2, 32, 2, 1); // stitch detail
    g.fillStyle = "#7a4d24";
    g.fillRect(5, 30, 4, 8); // boot 2 shaft
    g.fillRect(5, 36, 7, 2);
    g.fillStyle = "#553314";
    g.fillRect(5, 38, 7, 1);
    g.fillStyle = "#b8945c";
    g.fillRect(6, 31, 2, 1);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    return tex;
  }

  /** Bend the road strip so each cross-row follows roadCurve(z). */
  private bendRoad(): void {
    const pos = this.roadGeo.getAttribute("position") as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const rows = this.roadSegZ.length;
    for (let r = 0; r < rows; r++) {
      const zIndex = rows - 1 - r;
      const z = this.roadSegZ[zIndex];
      const cx = this.roadCurve(z);
      const f = zIndex / (rows - 1);
      const halfW = ROAD_HALF_W * (1 - f * 0.15);
      const li = (r * 2) * 3;
      const ri = (r * 2 + 1) * 3;
      arr[li] = cx - halfW;
      arr[li + 1] = -z;
      arr[ri] = cx + halfW;
      arr[ri + 1] = -z;
    }
    pos.needsUpdate = true;
    this.roadGeo.computeVertexNormals();
  }

  update(dt: number, _audioTime: number): void {
    this.t += dt;

    this.morph += (this.morphTarget - this.morph) * dt * 1.5;
    const m = this.morph;

    if (this.beat > 0) this.beat = Math.max(0, this.beat - dt * this.beatDecay);

    const speed = this.flySpeed * (1 + m * 0.5) + this.beat * 26;
    const travel = speed * dt;
    this.roadPhase += travel;

    this.bendRoad();
    this.roadScroll = (this.roadScroll + dt * speed * 0.05) % 1;
    this.roadTex.offset.y = -this.roadScroll;

    // Ordinary props stream toward the camera; recycle to the far horizon.
    for (const p of this.props) {
      p.mesh.position.z += travel;
      if (p.mesh.position.z > NEAR_Z) {
        p.baseScale = 0.7 + this.rng() * 0.9;
        p.side = this.rng() < 0.5 ? -1 : 1;
        p.offset = 8 + this.rng() * 40;
        this.placeProp(p, FAR_Z - this.rng() * 50);
      } else {
        const cx = this.roadCurve(p.mesh.position.z);
        p.mesh.position.x = cx + p.side * (ROAD_HALF_W + p.offset);
      }
      const sway = Math.sin(this.t * 3 + p.mesh.position.z * 0.05) * m * 0.12;
      p.mesh.rotation.z = sway * (p.kind === "cactus" ? 1 : 0.2);
    }

    // Rare vignette: spawn once enough distance has passed; it streams in from
    // the far horizon, then recycles (hidden) once past the camera.
    if (this.vignetteActive) {
      this.vignetteMesh.position.z += travel;
      if (this.vignetteMesh.position.z > NEAR_Z) {
        this.vignetteActive = false;
        this.vignetteMesh.visible = false;
        this.distSinceVignette = 0;
      } else {
        const cx = this.roadCurve(this.vignetteMesh.position.z);
        this.vignetteMesh.position.x = cx + this.vignetteSide * (ROAD_HALF_W + 20);
      }
    } else {
      this.distSinceVignette += travel;
      if (this.distSinceVignette >= VIGNETTE_GAP) {
        this.vignetteActive = true;
        this.vignetteMesh.visible = true;
        this.vignetteSide = this.rng() < 0.5 ? -1 : 1;
        this.placeVignette(FAR_Z - this.rng() * 30);
      }
    }

    this.groundScroll = (this.groundScroll + dt * speed * 0.02) % 1;
    this.groundTex.offset.y = -this.groundScroll;

    this.paintSky();
    this.paintGround();
    this.paintRoad();
    this.groundMat.color.setRGB(1 - m * 0.2, 1 - m * 0.2, 1 - m * 0.1);
    this.monMat.color.setRGB(1 - m * 0.4, 1 - m * 0.45, 1 - m * 0.4);
    // Vignette darkens under the storm like the rest of the scenery.
    this.vignetteMat.color.setRGB(1 - m * 0.3, 1 - m * 0.32, 1 - m * 0.3);

    // --- Rain ----------------------------------------------------------------
    const rainAmt = Math.max(0, (m - 0.18) / 0.82);
    const visible = Math.floor(rainAmt * RAIN_COUNT);
    this.rainGeo.setDrawRange(0, visible * 2);
    this.rainMat.opacity = 0.15 + rainAmt * 0.6;
    if (visible > 0) {
      const windX = m * 90 + this.beat * 40;
      for (let i = 0; i < visible; i++) {
        const o = i * 2 * 3;
        const vy = this.rainVel[i * 3 + 1] * (1 + this.beat * 0.5);
        this.rainPos[o] += windX * dt;
        this.rainPos[o + 1] += vy * dt;
        this.rainPos[o + 3] += windX * dt;
        this.rainPos[o + 4] += vy * dt;
        if (this.rainPos[o + 1] < 0) this.respawnRain(i, false);
      }
      (this.rainGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    }

    // --- Lightning -----------------------------------------------------------
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 5);
    this.flashMat.opacity = this.flash * 0.55;
    if (this.boltLife > 0) {
      this.boltLife = Math.max(0, this.boltLife - dt);
      this.boltMat.opacity = this.boltLife > 0 ? Math.min(1, this.boltLife / 0.14) : 0;
      if (this.boltLife === 0) this.boltGeo.setDrawRange(0, 0);
    }

    // Scene background + fog track the sky mood.
    const bg = this.scene && this.scene.background instanceof THREE.Color ? this.scene.background : null;
    if (bg) {
      bg.setRGB(
        0.23 - m * 0.17 + this.flash * 0.4,
        0.14 - m * 0.09 + this.flash * 0.42,
        0.21 - m * 0.12 + this.flash * 0.45,
      );
      if (bg.r < 0) bg.r = 0;
      if (bg.g < 0) bg.g = 0;
      if (bg.b < 0) bg.b = 0;
    }
    if (this.scene && this.scene.fog instanceof THREE.Fog) {
      const fc = this.scene.fog.color;
      fc.setRGB(0.23 - m * 0.17, 0.14 - m * 0.09, 0.21 - m * 0.1);
      if (fc.r < 0) fc.r = 0;
      if (fc.g < 0) fc.g = 0;
      if (fc.b < 0) fc.b = 0;
      this.scene.fog.near = 70 - m * 34;
      this.scene.fog.far = 260 - m * 90;
    }

    // Camera: FOLLOW the winding road.
    if (this.camera) {
      const followZ = this.camBaseZ - 18;
      const roadX = this.roadCurve(followZ);
      const lookX = this.roadCurve(-120);
      const bob = Math.sin(this.t * 5) * (0.3 + m * 0.5) + this.beat * 1.0;
      const buffet = m * (Math.sin(this.t * 13.0) + Math.sin(this.t * 7.3)) * 1.3;
      let px = roadX + buffet;
      let py = this.camBaseY + bob;
      let pz = this.camBaseZ;
      if (this.shake > 0) {
        this.shake = Math.max(0, this.shake - dt * 6);
        const a = this.shake;
        px += (Math.random() - 0.5) * a * 2.2;
        py += (Math.random() - 0.5) * a * 1.8;
        pz += (Math.random() - 0.5) * a;
      }
      this.camera.position.set(px, py, pz);
      this.camera.lookAt(lookX, 8, -120);
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

    this.skyMesh.geometry.dispose();
    this.skyMat.dispose();
    this.skyTex.dispose();

    this.monMesh.geometry.dispose();
    this.monMat.dispose();
    this.monTex.dispose();

    this.groundMesh.geometry.dispose();
    this.groundMat.dispose();
    this.groundTex.dispose();

    this.roadGeo.dispose();
    this.roadMat.dispose();
    this.roadTex.dispose();

    this.cactusGeo.dispose();
    this.rockGeo.dispose();
    this.cactusMat.dispose();
    this.smallRockMat.dispose();
    this.cactusTex.dispose();
    this.smallRockTex.dispose();
    this.props = [];

    this.vignetteGeo.dispose();
    this.vignetteMat.dispose();
    this.vignetteTex.dispose();

    this.rainGeo.dispose();
    this.rainMat.dispose();

    this.flashMesh.geometry.dispose();
    this.flashMat.dispose();
    this.boltGeo.dispose();
    this.boltMat.dispose();

    this.camera = null;
  }
}

const def: EddieBackgroundDef = {
  id: "bg06",
  label: "Desert Drive -> Rainstorm",
  blurb: "Driving a winding desert road through wide-open desert at dusk, distant rock monuments on the horizon and the occasional roadside guitar-and-boots-on-a-boulder; rising intensity rolls in storm clouds, slants rain onto the wet reflective road, and cracks lightning on the beat into a torrential downpour.",
  create: () => new Bg06(),
};

export default def;
