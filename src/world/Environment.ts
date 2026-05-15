import * as THREE from "three";
import type { LevelConfig } from "../levels/level1";
import { sharedToonRamp } from "../render/ToonRamp";
import { addOutline } from "../render/Outline";
import {
  makeCar,
  makeLamppost,
  makeFireHydrant,
  makeDumpster,
  makeMailbox,
  makePayphone,
  makeNeonSign,
  makeBillboard,
  makeTrashBag,
  makeVendingMachine,
  makeManhole,
  makeBench,
} from "./Props";

type CarVariant = "sedan" | "van" | "muscle" | "hatchback";
const CAR_VARIANTS: CarVariant[] = ["sedan", "van", "muscle", "hatchback"];

const STRIP_SIGN_WORDS = ["PIZZA", "LIQUOR", "TACOS", "BAR", "OPEN", "ATM", "VHS"];
const STRIP_SIGN_COLORS = [0xff2bd6, 0xff7a2b, 0xffd02b, 0x00f0ff, 0xc7ff2b, 0xff5a6b];
const SUBWAY_SIGN_WORDS = ["MEZZANINE", "EXIT", "TRAINS", "STREET"];
const SUBWAY_SIGN_COLORS = [0x00f0ff, 0xeefcff, 0xeac247];
const ROOFTOP_SIGN_WORDS = ["CLUB", "NEON", "AFTER HOURS", "24/7", "ROOFTOP"];
const ROOFTOP_SIGN_COLORS = [0xff2bd6, 0x00f0ff, 0xc7ff2b, 0xff5a6b];

const GROUND_Y = -1.55;
const BUILDING_CAP = 45;

type Theme = "strip" | "subway" | "rooftop";

// ---------------------------------------------------------------------------
// Canvas texture utilities
// ---------------------------------------------------------------------------

function makeCanvasTexture(
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  w = 512,
  h = 512,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx) draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number, dark = true) {
  for (let i = 0; i < w * h * 0.02; i++) {
    const x = Math.floor(Math.random() * w);
    const y = Math.floor(Math.random() * h);
    ctx.fillStyle = dark
      ? `rgba(0,0,0,${alpha * Math.random()})`
      : `rgba(255,255,255,${alpha * Math.random()})`;
    ctx.fillRect(x, y, 3, 3);
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Bold JSR-style graffiti throw-up: overlapping rounded blobs + thick outline.
function graffitiTag(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number,
  fill: string,
  outline: string,
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((Math.random() - 0.5) * 0.3);
  const blobs = 3 + Math.floor(Math.random() * 3);
  ctx.lineJoin = "round";
  ctx.lineWidth = 10 * scale;
  ctx.strokeStyle = outline;
  ctx.fillStyle = fill;
  for (let i = 0; i < blobs; i++) {
    const bx = (i - blobs / 2) * 46 * scale + (Math.random() - 0.5) * 14 * scale;
    const by = (Math.random() - 0.5) * 26 * scale;
    const bw = (44 + Math.random() * 26) * scale;
    const bh = (54 + Math.random() * 22) * scale;
    roundRect(ctx, bx - bw / 2, by - bh / 2, bw, bh, 18 * scale);
    ctx.fill();
    ctx.stroke();
  }
  // Highlight drips
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  for (let i = 0; i < 3; i++) {
    ctx.fillRect((Math.random() - 0.5) * 90 * scale, -40 * scale, 5 * scale, 70 * scale);
  }
  ctx.restore();
}

function wheatpastePoster(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  bg: string,
  text: string,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((Math.random() - 0.5) * 0.12);
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(4, 4, w, h);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(6, h * 0.12, w - 12, h * 0.5);
  ctx.fillStyle = "#fefefe";
  ctx.font = `bold ${Math.floor(h * 0.2)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, h * 0.78);
  ctx.restore();
}

function paintArrow(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 12;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + len, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + len, y - 16);
  ctx.lineTo(x + len + 26, y);
  ctx.lineTo(x + len, y + 16);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Per-theme saturated palettes
// ---------------------------------------------------------------------------

interface ThemePalette {
  walls: string[];
  trim: string;
  windowLit: string;
  windowDark: string;
  graffiti: [string, string][]; // [fill, outline]
  poster: string[];
  accent: string;
  roof: string;
  ground: string;
}

function themePalette(theme: Theme): ThemePalette {
  if (theme === "strip") {
    return {
      walls: ["#7a4a32", "#9a5a3a", "#6a3a4a", "#a85a48", "#7c5a3e", "#8a4658"],
      trim: "#2a1810",
      windowLit: "#ffd47a",
      windowDark: "#241620",
      graffiti: [
        ["#ff2bd6", "#10001a"],
        ["#00f0ff", "#001016"],
        ["#c7ff2b", "#101600"],
        ["#ff7a2b", "#160600"],
      ],
      poster: ["#ffd02b", "#ff5a6b", "#00f0ff"],
      accent: "#ff7a2b",
      roof: "#3a2820",
      ground: "#1a0e22",
    };
  }
  if (theme === "subway") {
    return {
      walls: ["#cfcab2", "#bdb8a2", "#a8c0c4", "#8aa6ac", "#c4c0aa", "#9ab0a8"],
      trim: "#33424a",
      windowLit: "#eefcff",
      windowDark: "#1c2830",
      graffiti: [
        ["#00f0ff", "#001016"],
        ["#ff2bd6", "#10001a"],
        ["#eac247", "#161000"],
        ["#7affc7", "#001610"],
      ],
      poster: ["#eefcff", "#00f0ff", "#eac247"],
      accent: "#00f0ff",
      roof: "#2a323a",
      ground: "#222a32",
    };
  }
  return {
    walls: ["#1c1430", "#120c1e", "#1a1228", "#0e0a18", "#241838", "#160e26"],
    trim: "#3a2a5a",
    windowLit: "#ffe89a",
    windowDark: "#0a0814",
    graffiti: [
      ["#ff2bd6", "#10001a"],
      ["#00f0ff", "#001016"],
      ["#c7ff2b", "#101600"],
      ["#ff5a6b", "#160006"],
    ],
    poster: ["#ff2bd6", "#00f0ff", "#c7ff2b"],
    accent: "#ff2bd6",
    roof: "#0a0814",
    ground: "#06050d",
  };
}

// ---------------------------------------------------------------------------
// Shared facade texture atlas (generated once per theme at first use)
// ---------------------------------------------------------------------------

type FacadeKind =
  | "brick"
  | "graffiti"
  | "neon"
  | "shutter"
  | "billboard"
  | "subwayTile"
  | "officeGlass";

const FACADE_KINDS: FacadeKind[] = [
  "brick",
  "graffiti",
  "neon",
  "shutter",
  "billboard",
  "subwayTile",
  "officeGlass",
];

function windowGrid(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cols: number,
  rows: number,
  lit: string,
  dark: string,
  trim: string,
  litChance: number,
) {
  const cellW = (x1 - x0) / cols;
  const cellH = (y1 - y0) / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.fillStyle = Math.random() < litChance ? lit : dark;
      const wx = x0 + c * cellW + 6;
      const wy = y0 + r * cellH + 6;
      const ww = cellW - 12;
      const wh = cellH - 12;
      if (ww > 0 && wh > 0) {
        ctx.fillRect(wx, wy, ww, wh);
        ctx.fillStyle = trim;
        ctx.fillRect(wx + ww / 2 - 1, wy, 2, wh);
        ctx.fillRect(wx, wy + wh / 2 - 1, ww, 2);
      }
    }
  }
}

function drawFacade(
  kind: FacadeKind,
  pal: ThemePalette,
  wall: string,
): (ctx: CanvasRenderingContext2D, w: number, h: number) => void {
  return (ctx, w, h) => {
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, w, h);

    if (kind === "brick") {
      ctx.strokeStyle = "rgba(0,0,0,0.22)";
      ctx.lineWidth = 2;
      for (let y = 0; y < h; y += 26) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += 52) {
        for (let x = 0; x < w; x += 52) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + 26);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(x + 26, y + 26);
          ctx.lineTo(x + 26, y + 52);
          ctx.stroke();
        }
      }
      windowGrid(ctx, 40, 40, w - 40, h - 60, 4, 6, pal.windowLit, pal.windowDark, pal.trim, 0.5);
      const g = pal.graffiti[0];
      graffitiTag(ctx, w * 0.5, h * 0.82, 1.0, g[0], g[1]);
    } else if (kind === "graffiti") {
      // Concrete + heavy tag wall
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      for (let i = 0; i < 30; i++) {
        ctx.fillRect(Math.random() * w, Math.random() * h, 40 + Math.random() * 80, 3);
      }
      const g0 = pal.graffiti[1];
      const g1 = pal.graffiti[2];
      graffitiTag(ctx, w * 0.42, h * 0.4, 1.5, g0[0], g0[1]);
      graffitiTag(ctx, w * 0.62, h * 0.7, 1.1, g1[0], g1[1]);
      paintArrow(ctx, w * 0.1, h * 0.2, 90, pal.accent);
      wheatpastePoster(ctx, w * 0.06, h * 0.55, 110, 150, pal.poster[0], "SHOW");
    } else if (kind === "neon") {
      // Neon storefront: dark glass + bright sign band
      ctx.fillStyle = "#120a18";
      ctx.fillRect(20, h * 0.34, w - 40, h * 0.5);
      windowGrid(ctx, 24, h * 0.34, w - 24, h * 0.84, 3, 2, pal.windowLit, "#0a0612", pal.trim, 0.8);
      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(0, h * 0.08, w, h * 0.2);
      ctx.shadowColor = pal.accent;
      ctx.shadowBlur = 28;
      ctx.fillStyle = pal.accent;
      ctx.font = "bold 72px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("NEON", w / 2, h * 0.18);
      ctx.shadowBlur = 0;
      const g = pal.graffiti[3];
      graffitiTag(ctx, w * 0.78, h * 0.92, 0.7, g[0], g[1]);
    } else if (kind === "shutter") {
      // Shuttered shop: rolling door corrugation + tags
      ctx.fillStyle = "#0a0a0c";
      ctx.fillRect(0, h * 0.08, w, h * 0.16);
      ctx.fillStyle = pal.accent;
      ctx.font = "bold 48px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("CLOSED", w / 2, h * 0.16);
      ctx.fillStyle = "#2c2c30";
      ctx.fillRect(20, h * 0.3, w - 40, h * 0.62);
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      for (let y = h * 0.3; y < h * 0.92; y += 14) ctx.fillRect(20, y, w - 40, 4);
      const g0 = pal.graffiti[0];
      const g1 = pal.graffiti[2];
      graffitiTag(ctx, w * 0.45, h * 0.6, 1.3, g0[0], g0[1]);
      graffitiTag(ctx, w * 0.7, h * 0.78, 0.8, g1[0], g1[1]);
    } else if (kind === "billboard") {
      // Billboard wall: big poster + frame
      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(0, 0, w, h);
      wheatpastePoster(ctx, w * 0.08, h * 0.1, w * 0.84, h * 0.6, pal.poster[1], "RADIO");
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 8;
      ctx.strokeRect(w * 0.08, h * 0.1, w * 0.84, h * 0.6);
      windowGrid(ctx, 30, h * 0.74, w - 30, h - 30, 5, 1, pal.windowLit, pal.windowDark, pal.trim, 0.4);
      const g = pal.graffiti[1];
      graffitiTag(ctx, w * 0.5, h * 0.86, 0.7, g[0], g[1]);
    } else if (kind === "subwayTile") {
      // Glossy tile wall
      ctx.fillStyle = "#e8e4d2";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.lineWidth = 3;
      for (let y = 0; y <= h; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      for (let x = 0; x <= w; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      for (let y = 0; y < h; y += 40) ctx.fillRect(0, y + 2, w, 6);
      const g0 = pal.graffiti[0];
      graffitiTag(ctx, w * 0.5, h * 0.55, 1.6, g0[0], g0[1]);
      wheatpastePoster(ctx, w * 0.7, h * 0.12, 120, 160, pal.poster[2], "LINE 6");
    } else {
      // officeGlass: curtain-wall glass grid
      ctx.fillStyle = "#0c1424";
      ctx.fillRect(0, 0, w, h);
      windowGrid(ctx, 12, 12, w - 12, h - 12, 6, 10, pal.windowLit, "#0a1020", "#1a2a44", 0.6);
      ctx.fillStyle = "rgba(120,180,255,0.06)";
      for (let x = 0; x < w; x += 30) ctx.fillRect(x, 0, 14, h);
    }

    noise(ctx, w, h, 0.16, true);
  };
}

// Lazily-built atlas of shared facade textures, keyed per theme.
const facadeCache = new Map<string, THREE.CanvasTexture[]>();

function facadeTextures(theme: Theme): THREE.CanvasTexture[] {
  const cached = facadeCache.get(theme);
  if (cached) return cached;
  const pal = themePalette(theme);
  const texes = FACADE_KINDS.map((kind, i) =>
    makeCanvasTexture(drawFacade(kind, pal, pal.walls[i % pal.walls.length]), 512, 512),
  );
  facadeCache.set(theme, texes);
  return texes;
}

// Shared roof texture per theme.
const roofCache = new Map<string, THREE.CanvasTexture>();
function roofTexture(theme: Theme): THREE.CanvasTexture {
  const cached = roofCache.get(theme);
  if (cached) return cached;
  const pal = themePalette(theme);
  const tex = makeCanvasTexture((ctx, w, h) => {
    ctx.fillStyle = pal.roof;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    for (let i = 0; i < 16; i++) {
      ctx.fillRect(Math.random() * w, Math.random() * h, 50 + Math.random() * 90, 6);
    }
    ctx.fillStyle = "#6a6a72";
    ctx.fillRect(w * 0.18, h * 0.22, w * 0.22, h * 0.2);
    ctx.fillStyle = "#3a3a40";
    ctx.fillRect(w * 0.21, h * 0.25, w * 0.16, h * 0.13);
    ctx.fillStyle = "#5a5a60";
    ctx.fillRect(w * 0.6, h * 0.16, 40, 40);
    noise(ctx, w, h, 0.22, true);
  }, 256, 256);
  roofCache.set(theme, tex);
  return tex;
}

// ---------------------------------------------------------------------------
// Shared materials & geometry
// ---------------------------------------------------------------------------

function toonMat(tex: THREE.Texture): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ map: tex, gradientMap: sharedToonRamp() });
}

function basicMat(color: number, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity });
}

// One material array reused by every building of a given theme. BoxGeometry
// face order: +x, -x, +y, -y, +z, -z. Sides/front share the facade atlas;
// the per-building facade index is chosen by swapping the +z material via
// material groups would be costly, so instead we build a small pool of
// material arrays (one per facade index) and reuse those.
const buildingMatPool = new Map<string, THREE.MeshToonMaterial[][]>();

function buildingMaterials(theme: Theme): THREE.MeshToonMaterial[][] {
  const cached = buildingMatPool.get(theme);
  if (cached) return cached;
  const facades = facadeTextures(theme);
  const roof = toonMat(roofTexture(theme));
  const pool = facades.map((front, i) => {
    const side = toonMat(facades[(i + 2) % facades.length]);
    return [side, side, roof, roof, toonMat(front), side];
  });
  buildingMatPool.set(theme, pool);
  return pool;
}

// Shared box geometries keyed by size class so three can batch draw calls.
const geomCache = new Map<string, THREE.BoxGeometry>();
function sharedBox(w: number, h: number, d: number): THREE.BoxGeometry {
  // Quantize dimensions into a small number of size classes.
  const qw = Math.round(w / 2) * 2;
  const qh = Math.round(h / 4) * 4;
  const qd = Math.round(d / 2) * 2;
  const key = `${qw}x${qh}x${qd}`;
  let g = geomCache.get(key);
  if (!g) {
    g = new THREE.BoxGeometry(qw, qh, qd);
    geomCache.set(key, g);
  }
  return g;
}

type BuildingKind = "shop" | "apartment" | "warehouse" | "office";

function pickKind(theme: Theme): BuildingKind {
  const r = Math.random();
  if (theme === "rooftop") return r < 0.5 ? "office" : r < 0.8 ? "apartment" : "shop";
  if (theme === "subway") return r < 0.5 ? "warehouse" : "apartment";
  return r < 0.5 ? "shop" : r < 0.75 ? "apartment" : r < 0.9 ? "warehouse" : "office";
}

function sizeFor(kind: BuildingKind): { w: number; h: number; d: number } {
  if (kind === "shop") return { w: 6 + Math.random() * 4, h: 6 + Math.random() * 6, d: 8 + Math.random() * 4 };
  if (kind === "apartment") return { w: 4 + Math.random() * 4, h: 14 + Math.random() * 12, d: 6 + Math.random() * 4 };
  if (kind === "warehouse") return { w: 12 + Math.random() * 4, h: 8 + Math.random() * 2, d: 10 + Math.random() * 4 };
  return { w: 5 + Math.random() * 4, h: 18 + Math.random() * 14, d: 6 + Math.random() * 4 };
}

// ---------------------------------------------------------------------------
// Prop placement helpers
// ---------------------------------------------------------------------------

function placeProp(
  parent: THREE.Object3D,
  prop: THREE.Object3D,
  onRail: THREE.Vector3,
  left: THREE.Vector3,
  side: number,
  dist: number,
  y: number = GROUND_Y,
): THREE.Object3D {
  prop.position.copy(onRail).add(left.clone().multiplyScalar(side * dist));
  prop.position.y = y;
  parent.add(prop);
  return prop;
}

function faceAlong(prop: THREE.Object3D, tangent: THREE.Vector3): void {
  prop.rotation.y = Math.atan2(tangent.x, tangent.z);
}

function faceTowardRail(prop: THREE.Object3D, onRail: THREE.Vector3): void {
  prop.lookAt(onRail.x, prop.position.y, onRail.z);
}

// Reduced-density prop pass shared across themes (every 8-12 samples).
function buildStripMallProps(parent: THREE.Object3D, level: LevelConfig): void {
  const samples = level.decorCount;
  for (let i = 0; i < samples; i++) {
    const t = Math.min(0.999, (i + 0.5) / samples);
    const onRail = level.curve.getPointAt(t);
    const tangent = level.curve.getTangentAt(t).normalize();
    const left = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

    if (i % 10 === 0) {
      const manhole = makeManhole();
      const lateral = i % 20 === 0 ? -1.2 : 1.2;
      manhole.position.copy(onRail).add(left.clone().multiplyScalar(lateral));
      manhole.position.y = GROUND_Y + 0.001;
      parent.add(manhole);
    }

    for (const side of [-1, 1]) {
      if ((i + (side > 0 ? 4 : 0)) % 9 === 0) {
        const variant = CAR_VARIANTS[(i + (side > 0 ? 1 : 0)) % CAR_VARIANTS.length];
        const car = makeCar(variant);
        placeProp(parent, car, onRail, left, side, 5.2);
        faceAlong(car, tangent);
        if (side < 0) car.rotation.y += Math.PI;
      }
      if (i % 9 === (side > 0 ? 0 : 4)) {
        placeProp(parent, makeLamppost(), onRail, left, side, 4.5);
      }
      if (i % 11 === (side > 0 ? 0 : 5)) {
        placeProp(parent, makeFireHydrant(), onRail, left, side, 4.4);
      }
      if (i % 12 === (side > 0 ? 0 : 6)) {
        const dump = makeDumpster(i % 4);
        placeProp(parent, dump, onRail, left, side, 7.5);
        faceTowardRail(dump, onRail);
        const bag = makeTrashBag();
        bag.position.copy(dump.position);
        bag.position.x += (Math.random() - 0.5) * 0.8;
        bag.position.z += (Math.random() - 0.5) * 0.8;
        parent.add(bag);
      }
      if (i % 12 === (side > 0 ? 3 : 9)) {
        const mb = makeMailbox();
        placeProp(parent, mb, onRail, left, side, 4.6);
        faceTowardRail(mb, onRail);
      }
      if (i % 16 === (side > 0 ? 0 : 8)) {
        const pp = makePayphone();
        placeProp(parent, pp, onRail, left, side, 4.8);
        faceTowardRail(pp, onRail);
      }
      if (i % 14 === (side > 0 ? 0 : 7)) {
        const bench = makeBench();
        placeProp(parent, bench, onRail, left, side, 4.7);
        faceTowardRail(bench, onRail);
      }
      if (i % 8 === (side > 0 ? 0 : 4)) {
        const text = STRIP_SIGN_WORDS[Math.floor(Math.random() * STRIP_SIGN_WORDS.length)];
        const color = STRIP_SIGN_COLORS[Math.floor(Math.random() * STRIP_SIGN_COLORS.length)];
        const sign = makeNeonSign(text, color);
        placeProp(parent, sign, onRail, left, side, 6.5, GROUND_Y + 3.5);
        faceTowardRail(sign, onRail);
      }
    }
  }

  for (let b = 0; b < 2; b++) {
    const t = 0.25 + b * 0.5;
    const onRail = level.curve.getPointAt(t);
    const tangent = level.curve.getTangentAt(t).normalize();
    const left = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const billboard = makeBillboard("strip");
    placeProp(parent, billboard, onRail, left, b === 0 ? 1 : -1, 14);
    faceTowardRail(billboard, onRail);
  }
}

function buildSubwayProps(parent: THREE.Object3D, level: LevelConfig): void {
  const samples = level.decorCount;
  for (let i = 0; i < samples; i++) {
    const t = Math.min(0.999, (i + 0.5) / samples);
    const onRail = level.curve.getPointAt(t);
    const tangent = level.curve.getTangentAt(t).normalize();
    const left = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

    for (const side of [-1, 1]) {
      if (i % 10 === (side > 0 ? 0 : 5)) {
        const bench = makeBench();
        placeProp(parent, bench, onRail, left, side, 6.0);
        faceTowardRail(bench, onRail);
      }
      if (i % 14 === (side > 0 ? 0 : 7)) {
        const kind: "drinks" | "snacks" = (i % 28 === 0) === (side > 0) ? "drinks" : "snacks";
        const vm = makeVendingMachine(kind);
        placeProp(parent, vm, onRail, left, side, 6.2);
        faceTowardRail(vm, onRail);
      }
      if (i % 12 === (side > 0 ? 0 : 6)) {
        const bag = makeTrashBag();
        placeProp(parent, bag, onRail, left, side, 6.3);
      }
      if (i % 12 === (side > 0 ? 3 : 9)) {
        const text = SUBWAY_SIGN_WORDS[Math.floor(Math.random() * SUBWAY_SIGN_WORDS.length)];
        const color = SUBWAY_SIGN_COLORS[Math.floor(Math.random() * SUBWAY_SIGN_COLORS.length)];
        const sign = makeNeonSign(text, color);
        placeProp(parent, sign, onRail, left, side, 6.5, GROUND_Y + 4.2);
        faceTowardRail(sign, onRail);
      }
    }
  }
}

function buildRooftopProps(
  parent: THREE.Object3D,
  level: LevelConfig,
  buildings: Array<{ mesh: THREE.Mesh; h: number; w: number; d: number }>,
): void {
  for (let bi = 0; bi < buildings.length; bi += 4) {
    const b = buildings[bi];
    const billboard = makeBillboard("rooftop");
    billboard.position.copy(b.mesh.position);
    billboard.position.y = b.mesh.position.y + b.h / 2;
    billboard.lookAt(0, billboard.position.y, 0);
    parent.add(billboard);
  }

  const samples = level.decorCount;
  for (let i = 0; i < samples; i += 8) {
    const t = Math.min(0.999, (i + 0.5) / samples);
    const onRail = level.curve.getPointAt(t);
    const tangent = level.curve.getTangentAt(t).normalize();
    const left = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const side = (i / 8) % 2 === 0 ? -1 : 1;
    const text = ROOFTOP_SIGN_WORDS[Math.floor(Math.random() * ROOFTOP_SIGN_WORDS.length)];
    const color = ROOFTOP_SIGN_COLORS[Math.floor(Math.random() * ROOFTOP_SIGN_COLORS.length)];
    const sign = makeNeonSign(text, color);
    placeProp(parent, sign, onRail, left, side, 9, GROUND_Y + 8 + Math.random() * 10);
    faceTowardRail(sign, onRail);
  }

  for (let c = 0; c < 2; c++) {
    const t = 0.02 + c * 0.04;
    const onRail = level.curve.getPointAt(t);
    const tangent = level.curve.getTangentAt(t).normalize();
    const left = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const variant: CarVariant = c === 0 ? "muscle" : "sedan";
    const car = makeCar(variant);
    const side = c === 0 ? -1 : 1;
    placeProp(parent, car, onRail, left, side, 5.2);
    faceAlong(car, tangent);
    if (side < 0) car.rotation.y += Math.PI;
  }
}

// ---------------------------------------------------------------------------
// Road / curbs / tunnel / skyline
// ---------------------------------------------------------------------------

function buildRoad(group: THREE.Group, level: LevelConfig, theme: Theme) {
  const stripeColor = theme === "subway" ? 0xeae6d2 : theme === "rooftop" ? 0xff2bd6 : 0xffd02b;
  const railWidth = 8;
  const roadColor = theme === "subway" ? 0x222a32 : theme === "rooftop" ? 0x0a0814 : 0x1a0e22;
  const roadMat = new THREE.MeshToonMaterial({ color: roadColor, gradientMap: sharedToonRamp() });

  const roadShape = new THREE.Shape();
  roadShape.moveTo(-railWidth / 2, 0);
  roadShape.lineTo(railWidth / 2, 0);
  roadShape.lineTo(railWidth / 2, 0.02);
  roadShape.lineTo(-railWidth / 2, 0.02);
  roadShape.closePath();

  const roadGeom = new THREE.ExtrudeGeometry(roadShape, {
    extrudePath: level.curve,
    steps: 160,
    bevelEnabled: false,
  });
  const road = new THREE.Mesh(roadGeom, roadMat);
  road.position.y = GROUND_Y;
  group.add(road);

  // Center stripe via a single InstancedMesh of dashes.
  const dashLen = 1.6;
  const gap = 1.0;
  const total = 80;
  const positions: THREE.Matrix4[] = [];
  const tmp = new THREE.Object3D();
  let along = 0;
  while (along < 1) {
    const t1 = Math.min(1, along);
    const t2 = Math.min(1, along + dashLen / total);
    const p1 = level.curve.getPointAt(t1);
    const p2 = level.curve.getPointAt(t2);
    const mid = p1.clone().add(p2).multiplyScalar(0.5);
    mid.y = -1.53;
    tmp.position.copy(mid);
    tmp.lookAt(p2.x, mid.y, p2.z);
    tmp.scale.set(1, 1, Math.max(0.01, p1.distanceTo(p2)));
    tmp.updateMatrix();
    positions.push(tmp.matrix.clone());
    along += (dashLen + gap) / total;
  }
  const dashMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.35, 0.01, 1),
    basicMat(stripeColor),
    positions.length,
  );
  positions.forEach((m, i) => dashMesh.setMatrixAt(i, m));
  dashMesh.instanceMatrix.needsUpdate = true;
  group.add(dashMesh);

  const sideColor = theme === "subway" ? 0x4a3a32 : theme === "rooftop" ? 0x4a2a7a : 0x3a1f5e;
  const curbMat = new THREE.MeshToonMaterial({ color: sideColor, gradientMap: sharedToonRamp() });
  for (const side of [-1, 1]) {
    const shape = new THREE.Shape();
    shape.moveTo(side * 4.0, 0);
    shape.lineTo(side * 4.3, 0);
    shape.lineTo(side * 4.3, 0.18);
    shape.lineTo(side * 4.0, 0.18);
    shape.closePath();
    const geom = new THREE.ExtrudeGeometry(shape, {
      extrudePath: level.curve,
      steps: 160,
      bevelEnabled: false,
    });
    const curb = new THREE.Mesh(geom, curbMat);
    curb.position.y = GROUND_Y;
    group.add(curb);
  }
}

function buildSubwayTunnel(group: THREE.Group, level: LevelConfig) {
  const tileTex = facadeTextures("subway")[5]; // shared subwayTile facade
  const wallTex = tileTex.clone();
  wallTex.wrapS = THREE.RepeatWrapping;
  wallTex.wrapT = THREE.RepeatWrapping;
  wallTex.repeat.set(40, 4);
  wallTex.colorSpace = THREE.SRGBColorSpace;
  wallTex.needsUpdate = true;
  const wallMat = new THREE.MeshToonMaterial({ map: wallTex, gradientMap: sharedToonRamp() });

  for (const side of [-1, 1]) {
    const shape = new THREE.Shape();
    shape.moveTo(side * 7, 0);
    shape.lineTo(side * 7, 7);
    shape.lineTo(side * 7.6, 7);
    shape.lineTo(side * 7.6, -1);
    shape.lineTo(side * 7, -1);
    shape.closePath();
    const geom = new THREE.ExtrudeGeometry(shape, {
      extrudePath: level.curve,
      steps: 200,
      bevelEnabled: false,
    });
    const wall = new THREE.Mesh(geom, wallMat);
    wall.position.y = GROUND_Y;
    group.add(wall);
  }

  const ceilShape = new THREE.Shape();
  ceilShape.moveTo(-7, 7);
  ceilShape.lineTo(7, 7);
  ceilShape.lineTo(7, 7.4);
  ceilShape.lineTo(-7, 7.4);
  ceilShape.closePath();
  const ceil = new THREE.Mesh(
    new THREE.ExtrudeGeometry(ceilShape, { extrudePath: level.curve, steps: 200, bevelEnabled: false }),
    new THREE.MeshToonMaterial({ color: 0x1a2028, gradientMap: sharedToonRamp() }),
  );
  ceil.position.y = GROUND_Y;
  group.add(ceil);

  // Fluorescent strips as one InstancedMesh.
  const samples = level.decorCount;
  const tmp = new THREE.Object3D();
  const mats: THREE.Matrix4[] = [];
  for (let i = 0; i < samples; i += 2) {
    const onRail = level.curve.getPointAt(Math.min(0.999, (i + 0.5) / samples));
    tmp.position.copy(onRail);
    tmp.position.y = 5.4;
    tmp.updateMatrix();
    mats.push(tmp.matrix.clone());
  }
  const strips = new THREE.InstancedMesh(
    new THREE.BoxGeometry(2.4, 0.06, 0.18),
    basicMat(0xeefcff),
    mats.length,
  );
  mats.forEach((m, i) => strips.setMatrixAt(i, m));
  strips.instanceMatrix.needsUpdate = true;
  group.add(strips);
}

// ~18 instanced rooftop-ring boxes for the distant skyline.
function buildSkyline(group: THREE.Group): void {
  const tex = facadeTextures("rooftop")[6]; // officeGlass
  const count = 18;
  const geo = new THREE.BoxGeometry(8, 1, 6); // unit height; scaled per instance
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const tmp = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2;
    const r = 150 + Math.random() * 20;
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    const h = 18 + Math.random() * 40;
    tmp.position.set(x, h / 2 - 1.55, z);
    tmp.scale.set(1, h, 1);
    tmp.lookAt(0, tmp.position.y, 0);
    tmp.updateMatrix();
    mesh.setMatrixAt(i, tmp.matrix.clone());
  }
  mesh.instanceMatrix.needsUpdate = true;
  group.add(mesh);
}

// ---------------------------------------------------------------------------
// Lighting rigs
// ---------------------------------------------------------------------------

function setupLights(group: THREE.Group, theme: Theme) {
  if (theme === "strip") {
    // Strip Mall Sunset: warm low sun, cool fill, magenta hemisphere.
    const sun = new THREE.DirectionalLight(0xff9a55, 1.1);
    sun.position.set(40, 14, -70);
    group.add(sun);
    group.add(new THREE.AmbientLight(0x3a2a6a, 0.5));
    group.add(new THREE.HemisphereLight(0xff2bd6, 0x180a28, 0.45));
  } else if (theme === "subway") {
    // Subway Mezzanine: greenish fluorescent overhead, cyan ambient.
    const overhead = new THREE.DirectionalLight(0xcfeede, 1.0);
    overhead.position.set(0, 30, 0);
    group.add(overhead);
    group.add(new THREE.AmbientLight(0x1a3a4a, 0.55));
    group.add(new THREE.HemisphereLight(0xcfeede, 0x101820, 0.3));
  } else {
    // Rooftop Skyline: night, magenta + cyan opposing rims, moon.
    group.add(new THREE.AmbientLight(0x101a3a, 0.45));
    const moon = new THREE.DirectionalLight(0x6c7cff, 0.5);
    moon.position.set(-30, 60, -40);
    group.add(moon);
    const magenta = new THREE.DirectionalLight(0xff2bd6, 0.8);
    magenta.position.set(60, 20, 30);
    group.add(magenta);
    const cyan = new THREE.DirectionalLight(0x00f0ff, 0.8);
    cyan.position.set(-60, 20, -30);
    group.add(cyan);
    group.add(new THREE.HemisphereLight(0xff2bd6, 0x05020f, 0.3));
  }
}

function pickTheme(name: string): Theme {
  if (name.toLowerCase().includes("subway")) return "subway";
  if (name.toLowerCase().includes("rooftop")) return "rooftop";
  return "strip";
}

// ---------------------------------------------------------------------------
// Ground texture (one per theme)
// ---------------------------------------------------------------------------

const groundCache = new Map<string, THREE.CanvasTexture>();
function groundTexture(theme: Theme): THREE.CanvasTexture {
  const cached = groundCache.get(theme);
  if (cached) return cached;
  const base = theme === "subway" ? "#1a2028" : theme === "rooftop" ? "#08060f" : "#1a0e22";
  const tex = makeCanvasTexture((ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 24; i++) {
      ctx.beginPath();
      const x = Math.random() * w;
      const y = Math.random() * h;
      ctx.moveTo(x, y);
      ctx.lineTo(x + (Math.random() - 0.5) * 40, y + (Math.random() - 0.5) * 40);
      ctx.stroke();
    }
    noise(ctx, w, h, 0.15, false);
    noise(ctx, w, h, 0.22, true);
  }, 256, 256);
  groundCache.set(theme, tex);
  return tex;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function buildEnvironment(scene: THREE.Scene, level: LevelConfig): THREE.Object3D[] {
  const group = new THREE.Group();
  scene.add(group);

  const theme: Theme = pickTheme(level.name);

  // Ground (single shared toon material).
  const gTex = groundTexture(theme);
  gTex.wrapS = THREE.RepeatWrapping;
  gTex.wrapT = THREE.RepeatWrapping;
  gTex.repeat.set(20, 40);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 1200),
    new THREE.MeshToonMaterial({ map: gTex, gradientMap: sharedToonRamp() }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.56;
  group.add(ground);

  buildRoad(group, level, theme);

  const buildingsGroup = new THREE.Group();
  group.add(buildingsGroup);

  if (theme === "subway") buildSubwayTunnel(buildingsGroup, level);

  // Buildings flanking the curve, capped at BUILDING_CAP. Two per sample, so
  // stride the samples to spread the capped count along the whole curve.
  const matPool = buildingMaterials(theme);
  const facadeCount = facadeTextures(theme).length;
  const sampleSlots = Math.max(1, Math.ceil(BUILDING_CAP / 2));
  const buildings: Array<{ mesh: THREE.Mesh; h: number; w: number; d: number }> = [];
  let placed = 0;
  for (let s = 0; s < sampleSlots && placed < BUILDING_CAP; s++) {
    const t = (s + 0.5) / sampleSlots;
    const onRail = level.curve.getPointAt(Math.min(0.999, t));
    const tangent = level.curve.getTangentAt(Math.min(0.999, t)).normalize();
    const left = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

    for (const side of [-1, 1]) {
      if (placed >= BUILDING_CAP) break;
      const kind = pickKind(theme);
      const { w, h, d } = sizeFor(kind);
      const baseDist = theme === "subway" ? 14 : theme === "rooftop" ? 12 : 9;
      const dist = baseDist + Math.random() * 4;
      const offset = left.clone().multiplyScalar(side * dist);
      const facadeIdx = Math.floor(Math.random() * facadeCount);
      const mesh = new THREE.Mesh(sharedBox(w, h, d), matPool[facadeIdx]);
      mesh.position.copy(onRail).add(offset);
      mesh.position.y = h / 2 - 1.55;
      mesh.lookAt(onRail.x, mesh.position.y, onRail.z);
      buildingsGroup.add(mesh);
      buildings.push({ mesh, h, w, d });
      placed++;

      // JSR ink-line: bold inverse-hull outline on building silhouettes only.
      addOutline(mesh, 1.02);
    }
  }

  if (theme === "strip") buildStripMallProps(buildingsGroup, level);
  else if (theme === "subway") buildSubwayProps(buildingsGroup, level);
  else if (theme === "rooftop") buildRooftopProps(buildingsGroup, level, buildings);

  if (theme === "rooftop") buildSkyline(buildingsGroup);

  setupLights(group, theme);

  // Fog from level config.
  scene.fog = new THREE.Fog(level.fogColor, level.fogNear, level.fogFar);

  // Sky dome.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(280, 16, 12),
    new THREE.MeshBasicMaterial({ color: level.skyColor, side: THREE.BackSide, fog: false }),
  );
  group.add(sky);

  return [group];
}
