import * as THREE from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { sharedToonRamp } from "../render/ToonRamp";
import { addOutline } from "../render/Outline";
import { loadCharacter, cloneScene } from "../engine/AssetLoader";
import {
  GUITAR_PALETTE,
  OUTFIT_PALETTE,
  type GuitarId,
  type Loadout,
  type OutfitId,
} from "../state/Loadout";

type GuitarPalette = (typeof GUITAR_PALETTE)[GuitarId];

function hex(c: number): string {
  return "#" + c.toString(16).padStart(6, "0");
}

function shade(c: number, factor: number): string {
  const r = Math.min(255, Math.max(0, Math.round(((c >> 16) & 0xff) * factor)));
  const g = Math.min(255, Math.max(0, Math.round(((c >> 8) & 0xff) * factor)));
  const b = Math.min(255, Math.max(0, Math.round((c & 0xff) * factor)));
  return "rgb(" + r + "," + g + "," + b + ")";
}

function makeCanvas(w: number, h: number): {
  cv: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d") as CanvasRenderingContext2D;
  return { cv, ctx };
}

function canvasTex(cv: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipMapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function toonMap(color: number, map?: THREE.Texture): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({
    color,
    gradientMap: sharedToonRamp(),
  });
  if (map) mat.map = map;
  return mat;
}

function toon(color: number): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: sharedToonRamp() });
}

function basic(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color });
}

// ---------------------------------------------------------------------------
// Guitar canvas texture generators (kept: the guitar stays procedural)
// ---------------------------------------------------------------------------

function generateGuitarBodyTexture(g: GuitarPalette): THREE.CanvasTexture {
  const { cv, ctx } = makeCanvas(256, 128);
  ctx.fillStyle = hex(g.body);
  ctx.fillRect(0, 0, 256, 128);

  const grad = ctx.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, shade(g.body, 1.18));
  grad.addColorStop(0.5, hex(g.body));
  grad.addColorStop(1, shade(g.body, 0.7));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 128);

  // Pickguard
  ctx.fillStyle = hex(g.pickguard);
  ctx.beginPath();
  ctx.moveTo(40, 24);
  ctx.lineTo(180, 30);
  ctx.lineTo(190, 100);
  ctx.lineTo(50, 104);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Pickups
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(64, 50, 36, 28);
  ctx.fillRect(124, 50, 36, 28);
  ctx.fillStyle = "#8a8a90";
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.arc(70 + i * 5, 64, 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(130 + i * 5, 64, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Control plate + knobs
  ctx.fillStyle = "#2a2a30";
  ctx.fillRect(190, 56, 50, 30);
  ctx.fillStyle = "#d4c89a";
  ctx.beginPath();
  ctx.arc(200, 70, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(216, 70, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(232, 70, 5, 0, Math.PI * 2);
  ctx.fill();

  // Output jack
  ctx.fillStyle = "#aaa";
  ctx.beginPath();
  ctx.arc(230, 102, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.arc(230, 102, 1.6, 0, Math.PI * 2);
  ctx.fill();

  // Edge highlight
  ctx.strokeStyle = shade(g.body, 0.4);
  ctx.lineWidth = 2;
  ctx.strokeRect(2, 2, 252, 124);

  return canvasTex(cv);
}

function generateFretboardTexture(g: GuitarPalette): THREE.CanvasTexture {
  const { cv, ctx } = makeCanvas(512, 64);
  ctx.fillStyle = hex(g.neck);
  ctx.fillRect(0, 0, 512, 64);
  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = shade(g.neck, 0.5);
  ctx.lineWidth = 1;
  for (let i = 0; i < 12; i++) {
    ctx.beginPath();
    ctx.moveTo(0, 6 + i * 5);
    ctx.lineTo(512, 4 + i * 5 + Math.sin(i) * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Frets
  ctx.fillStyle = "#dcd6c0";
  for (let i = 1; i <= 18; i++) {
    const x = i * 26;
    ctx.fillRect(x, 0, 2, 64);
  }

  // Inlay dots
  ctx.fillStyle = "#f4ecd0";
  const inlays = [3, 5, 7, 9, 15];
  for (const fr of inlays) {
    const x = fr * 26 + 13;
    ctx.beginPath();
    ctx.arc(x, 32, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(12 * 26 + 13, 20, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(12 * 26 + 13, 44, 4, 0, Math.PI * 2);
  ctx.fill();

  return canvasTex(cv);
}

function generateHeadstockTexture(g: GuitarPalette): THREE.CanvasTexture {
  const { cv, ctx } = makeCanvas(128, 64);
  ctx.fillStyle = hex(g.headstock);
  ctx.fillRect(0, 0, 128, 64);
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = shade(g.headstock, 0.55);
  for (let i = 0; i < 6; i++) {
    ctx.fillRect(0, i * 11, 128, 1);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#cfcfcf";
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(24 + i * 26, 14, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(24 + i * 26, 50, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#1a1a1a";
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(20 + i * 26, 12, 8, 4);
    ctx.fillRect(20 + i * 26, 48, 8, 4);
  }
  ctx.fillStyle = "#f4ecd0";
  ctx.font = "bold 10px serif";
  ctx.fillText("AXE", 56, 36);
  return canvasTex(cv);
}

// ---------------------------------------------------------------------------
// Helpers: cel-shade a GLB, tint by outfit
// ---------------------------------------------------------------------------

const TINT = new THREE.Color();

/**
 * Converts the GLB's PBR materials to MeshToonMaterial that matches the
 * world's cel-shaded look, preserving any base map/vertex colors, and
 * multiplies the base color by the outfit accent so the 3 outfits read
 * distinctly. Adds inverse-hull outlines to body meshes.
 */
function celShadeModel(root: THREE.Object3D, outfit: OutfitId): void {
  const o = OUTFIT_PALETTE[outfit];
  // Blend toward the outfit jacket/accent so each loadout is recognizable.
  const jacket = new THREE.Color(o.jacket);
  const accent = new THREE.Color(o.accent);

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;

    // CRITICAL: camera-parented skinned meshes get incorrectly frustum-culled
    // because their bind-pose bounding sphere doesn't match the on-screen
    // (skinned + camera-attached) position. Disabling culling keeps the body
    // visible — without this only the (non-skinned) guitar renders.
    mesh.frustumCulled = false;

    const src = mesh.material;
    const srcMats = Array.isArray(src) ? src : [src];
    const newMats = srcMats.map((m) => {
      const std = m as THREE.MeshStandardMaterial;
      const base = std && std.color ? std.color.clone() : new THREE.Color(0xb8b8c0);
      // Keep the robot bright and readable — only a light wash toward the
      // outfit jacket so the loadout is recognizable, NOT a dark overpaint.
      // Lift overall value so it never reads as a black blob in night levels.
      TINT.copy(base).lerp(jacket, 0.3);
      const hsl = { h: 0, s: 0, l: 0 };
      TINT.getHSL(hsl);
      TINT.setHSL(hsl.h, Math.min(1, hsl.s + 0.1), Math.max(0.45, hsl.l));
      const toonMat = new THREE.MeshToonMaterial({
        color: TINT.clone(),
        gradientMap: sharedToonRamp(),
        map: std && std.map ? std.map : null,
        transparent: std ? std.transparent : false,
        opacity: std ? std.opacity : 1,
      });
      // Faint accent glow only — dedicated character lights now do the work,
      // so keep emissive subtle or the bloom pass blows it to a white blob.
      toonMat.emissive = accent.clone();
      toonMat.emissiveIntensity = 0.12;
      return toonMat;
    });
    mesh.material = Array.isArray(src) ? newMats : newMats[0];

    // Outline only reasonably sized solid static body meshes. Skinned meshes
    // deform per-frame so a static inverse hull would tear; skip those.
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) return;
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    const radius = mesh.geometry.boundingSphere?.radius ?? 0;
    if (radius > 0.15) {
      addOutline(mesh, 1.04);
    }
  });
}

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

export class Avatar extends THREE.Object3D {
  readonly strumPivot: THREE.Object3D;
  private outfit: OutfitId;
  private guitarId: GuitarId;
  private strumAt = -999;
  private mixer: THREE.AnimationMixer | null = null;
  private lastUpdateTime = -1;
  private disposed = false;

  constructor(loadout: Loadout) {
    super();
    this.outfit = loadout.outfit;
    this.guitarId = loadout.guitar;

    // ---- Guitar (procedural, parented to strumPivot) ----
    this.strumPivot = new THREE.Object3D();
    // Held in front of the chest, angled like a slung electric guitar.
    this.strumPivot.position.set(-0.05, 0.78, 0.42);
    this.strumPivot.rotation.z = 0.28;
    this.strumPivot.rotation.x = -0.18;
    this.add(this.strumPivot);
    this.buildGuitar();

    // ---- Real rigged model (async) ----
    void this.loadModel();
  }

  private buildGuitar(): void {
    const g = GUITAR_PALETTE[this.guitarId];
    const bodyTex = generateGuitarBodyTexture(g);
    const fretboardTex = generateFretboardTexture(g);
    const headstockTex = generateHeadstockTexture(g);

    // Compact electric body
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.66, 0.34, 0.1),
      toonMap(0xffffff, bodyTex),
    );
    addOutline(body, 1.05);
    this.strumPivot.add(body);

    const bodyBevel = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.3, 0.06),
      toon(g.body),
    );
    this.strumPivot.add(bodyBevel);

    // Neck
    const neck = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.78, 0.05),
      toon(g.neck),
    );
    neck.position.set(0.4, 0.0, 0.0);
    neck.rotation.z = -Math.PI / 2;
    addOutline(neck, 1.04);
    this.strumPivot.add(neck);

    // Fretboard face
    const fretboard = new THREE.Mesh(
      new THREE.PlaneGeometry(0.78, 0.1),
      new THREE.MeshToonMaterial({
        color: 0xffffff,
        gradientMap: sharedToonRamp(),
        map: fretboardTex,
      }),
    );
    fretboard.position.set(0.4, 0, 0.027);
    this.strumPivot.add(fretboard);

    // Headstock
    const headstock = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.14, 0.04),
      toonMap(0xffffff, headstockTex),
    );
    headstock.position.set(0.84, 0.04, 0);
    headstock.rotation.z = -Math.PI / 2 + 0.18;
    addOutline(headstock, 1.05);
    this.strumPivot.add(headstock);

    // 6 strings
    const stringMat = basic(0xe6e2c8);
    for (let s = 0; s < 6; s++) {
      const yoff = -0.03 + s * 0.012;
      const str = new THREE.Mesh(
        new THREE.BoxGeometry(0.005, 0.86, 0.003),
        stringMat,
      );
      str.position.set(0.4, yoff, 0.05);
      str.rotation.z = -Math.PI / 2;
      this.strumPivot.add(str);
    }
  }

  private async loadModel(): Promise<void> {
    try {
      const gltf: GLTF = await loadCharacter();
      if (this.disposed) return;
      this.mountModel(gltf);
    } catch (err) {
      console.warn("[avatar] GLB load failed, using placeholder", err);
      if (!this.disposed) this.buildPlaceholder();
    }
  }

  private mountModel(gltf: GLTF): void {
    const model = cloneScene(gltf);

    // CRITICAL: never scale/reposition the cloned scene root directly — it
    // owns the armature, and mutating it before the rig is posed corrupts the
    // skinned-mesh bind (the bug that left only the guitar visible). Instead
    // wrap it in a plain outer group and normalize THAT. A parent group's
    // transform uniformly moves the whole posed rig without touching any
    // bind matrices (which are relative to the skeleton root inside `model`).
    const rig = new THREE.Group();
    rig.add(model);
    celShadeModel(model, this.outfit);
    this.add(rig);

    // Build the mixer on the cloned scene and step it ONCE so the armature
    // adopts the clip's frame-0 pose immediately. Without this the bones sit
    // at identity and every body part collapses to the origin.
    const clips = gltf.animations ?? [];
    if (clips.length > 0) {
      this.mixer = new THREE.AnimationMixer(model);
      const pick =
        THREE.AnimationClip.findByName(clips, "Idle") ??
        THREE.AnimationClip.findByName(clips, "Walking") ??
        THREE.AnimationClip.findByName(clips, "Dance") ??
        clips[0];
      const action = this.mixer.clipAction(pick);
      action.reset();
      action.play();
      this.mixer.update(0.0001);
    }

    // Now that the rig is posed, measure it in world space and normalize the
    // OUTER group so the model is ~1.7u tall with feet at the group origin.
    rig.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(rig);
    const size = new THREE.Vector3();
    box.getSize(size);
    const targetHeight = 1.7;
    const s = size.y > 0.01 ? targetHeight / size.y : 1;
    rig.scale.setScalar(s);

    rig.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(rig);
    const center = new THREE.Vector3();
    box2.getCenter(center);
    rig.position.x -= center.x;
    rig.position.z -= center.z;
    rig.position.y -= box2.min.y;
  }

  /**
   * Fallback when the GLB cannot be fetched: a clean capsule-body figure
   * (NOT the old stacked-primitive avatar) so the game still runs.
   */
  private buildPlaceholder(): void {
    const o = OUTFIT_PALETTE[this.outfit];
    const group = new THREE.Object3D();

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.34, 0.95, 6, 12),
      toon(o.jacket),
    );
    body.position.y = 1.0;
    addOutline(body, 1.04);
    group.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 16, 12),
      toon(o.skin),
    );
    head.position.y = 1.72;
    addOutline(head, 1.04);
    group.add(head);

    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(
        0.28,
        16,
        10,
        0,
        Math.PI * 2,
        0,
        Math.PI * 0.6,
      ),
      toon(o.hair),
    );
    hair.position.y = 1.78;
    addOutline(hair, 1.04);
    group.add(hair);

    const legMat = toon(o.pants);
    for (const sx of [-0.16, 0.16]) {
      const leg = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.13, 0.5, 6, 10),
        legMat,
      );
      leg.position.set(sx, 0.36, 0);
      addOutline(leg, 1.04);
      group.add(leg);
    }
    const armMat = toon(o.jacket);
    for (const sx of [-0.42, 0.42]) {
      const arm = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.1, 0.5, 6, 10),
        armMat,
      );
      arm.position.set(sx, 1.05, 0.1);
      arm.rotation.z = sx < 0 ? 0.35 : -0.35;
      addOutline(arm, 1.04);
      group.add(arm);
    }

    this.add(group);
  }

  triggerStrum(audioTime: number) {
    this.strumAt = audioTime;
  }

  update(audioTime: number) {
    // Derive a positive delta from the (monotonic) audio clock.
    if (this.lastUpdateTime < 0) this.lastUpdateTime = audioTime;
    let dt = audioTime - this.lastUpdateTime;
    this.lastUpdateTime = audioTime;
    if (!(dt > 0) || dt > 0.5) dt = 1 / 60;

    if (this.mixer) this.mixer.update(dt);

    // Strum: quick guitar tilt that decays back to rest.
    const since = audioTime - this.strumAt;
    const rest = -0.18;
    const peak = -0.55;
    const dur = 0.25;
    if (since >= 0 && since < dur) {
      const t = since / dur;
      const eased = 1 - t * t;
      this.strumPivot.rotation.x = rest + (peak - rest) * eased;
    } else {
      this.strumPivot.rotation.x = rest;
    }
  }
}
