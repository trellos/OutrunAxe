// Sprite-art generator for "Infinite Eddie" — rockets + effects.
//
//   generate(assetsDir)  -> writes rocket-1.png, rocket-2.png, rocket-3.png,
//                           explosion.png, rocket-flame.png into assetsDir.
//
// Run directly:  node scripts/sprites/rocket.mjs   (writes into public/assets)
//
// Style: chunky monochrome pixel-art matching .art-ref/reference.jpg — crisp
// square blocks, near-black figures on a transparent background, a thin lighter
// rim for readability on the dark ocean, and a single tier-colored accent pixel.
// Fully DETERMINISTIC: every bit of motion is derived from the frame index.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { PixelCanvas, encodePNG, writePNG } from "./png.mjs";

// ---------------------------------------------------------------------------
// shared palette — monochrome pixel-art
// ---------------------------------------------------------------------------

const DARK = "#1a1a22"; // near-black figure body
const RIM = "#6b6b7a"; // lighter rim/outline for readability on dark bg

// Tier accent (one cockpit pixel). Rocket variants don't carry tier, so we use
// a per-variant accent instead; tiers differ in-game via element scale. We map
// the three rocket variants to the three tier accent colors for subtle variety.
const ACCENTS = {
  1: "#7ee0ff", // perfect cyan
  2: "#b6ff5a", // normal lime
  3: "#9aa0b0", // loose grey
};

// Flame colors (kept monochrome-ish dark with a hot core so it still reads as
// fire but stays blocky / un-smoothed).
const FLAME_OUTER = "#1a1a22";
const FLAME_MID = "#4a4a55";
const FLAME_HOT = "#cfcfe0";

// ---------------------------------------------------------------------------
// ROCKETS  — 4 frames in a row, nose UP, 20x36 per frame (sheet 80x36)
// ---------------------------------------------------------------------------

const ROCKET_FW = 20;
const ROCKET_FH = 36;
const ROCKET_FRAMES = 4;

// Design grid: 10 wide x 18 tall, upscaled x2 -> 20x36 chunky pixels.
const RK_DW = 10;
const RK_DH = 18;
const RK_SCALE = ROCKET_FW / RK_DW; // = 2

/**
 * Draw one rocket frame on a small design canvas. Nose at top (small y),
 * exhaust flame flickers at the bottom. `flick` (0..3) drives the flame shape.
 * `variant` (1..3) tweaks the body width / fin style + accent color.
 */
function drawRocketCell(c, flick, variant) {
  const accent = ACCENTS[variant];
  const cx = 4; // left column of the 2-wide body core (cols 4,5)

  // Body silhouette varies a touch per variant for distinct shapes.
  // Columns used by the body core: cx..cx+1 (2 wide) plus shoulders.
  // Rows: nose 1, body 2..12, fins 12..14.

  // --- nose cone (rows 1-3) ---
  c.rect(4, 1, 2, 1, DARK); // tip
  c.rect(4, 2, 2, 1, DARK);
  c.set(3, 3, DARK);
  c.rect(4, 3, 2, 1, DARK);
  c.set(6, 3, DARK);

  // --- body tube (rows 4-11) 4 wide (cols 3..6) ---
  for (let y = 4; y <= 11; y++) c.rect(3, y, 4, 1, DARK);

  // variant 1: straight tube. variant 2: slimmer waist. variant 3: chunkier.
  if (variant === 2) {
    // carve a slimmer waist (rows 6-9 -> 2 wide centered)
    for (let y = 6; y <= 9; y++) {
      c.set(3, y, "#00000000");
      c.set(6, y, "#00000000");
    }
  } else if (variant === 3) {
    // bulge shoulders (rows 5-8 widen to cols 2..7)
    for (let y = 5; y <= 8; y++) {
      c.set(2, y, DARK);
      c.set(7, y, DARK);
    }
  }

  // --- cockpit accent window (single chunky pixel-ish block) ---
  c.set(4, 6, accent);
  c.set(5, 6, accent);

  // --- fins at the bottom (rows 12-14) ---
  c.rect(3, 12, 4, 1, DARK);
  if (variant === 1) {
    // wide swept fins
    c.set(2, 13, DARK);
    c.set(7, 13, DARK);
    c.set(2, 14, DARK);
    c.set(7, 14, DARK);
    c.rect(3, 13, 4, 1, DARK);
    c.rect(4, 14, 2, 1, DARK);
  } else if (variant === 2) {
    // tall narrow fins
    c.set(2, 13, DARK);
    c.set(7, 13, DARK);
    c.rect(3, 13, 4, 1, DARK);
    c.set(2, 14, DARK);
    c.set(7, 14, DARK);
  } else {
    // stubby chunky fins
    c.set(1, 13, DARK);
    c.set(8, 13, DARK);
    c.rect(2, 13, 6, 1, DARK);
    c.rect(4, 14, 2, 1, DARK);
  }

  // --- exhaust flame flicker (rows 15-17) — derived from frame index ---
  // Four flicker patterns: vary length + which side pokes out.
  const flame = [
    { len: 2, jag: 0 },
    { len: 3, jag: 1 },
    { len: 2, jag: -1 },
    { len: 3, jag: 0 },
  ][flick];

  let fy = 15;
  // core flame column (cols 4,5)
  c.rect(4, fy, 2, 1, FLAME_HOT);
  if (flame.len >= 2) {
    c.rect(4, fy + 1, 2, 1, FLAME_MID);
    // jagged side flicker
    if (flame.jag < 0) c.set(3, fy + 1, FLAME_MID);
    if (flame.jag > 0) c.set(6, fy + 1, FLAME_MID);
  }
  if (flame.len >= 3) {
    c.set(4 + (flame.jag > 0 ? 1 : 0), fy + 2, FLAME_OUTER);
    c.set(5 - (flame.jag < 0 ? 1 : 0), fy + 2, FLAME_OUTER);
  }

  // --- rim/outline pass: put a lighter pixel where a DARK pixel borders empty
  addRim(c, DARK, RIM);
}

/**
 * Add a 1-design-pixel lighter rim around every DARK pixel that borders a
 * transparent cell. Keeps the silhouette readable on a dark background while
 * staying perfectly blocky.
 */
function addRim(c, fillHex, rimHex) {
  const [fr, fg, fb] = hexRGB(fillHex);
  const isFill = (x, y) => {
    if (x < 0 || y < 0 || x >= c.w || y >= c.h) return false;
    const i = (y * c.w + x) * 4;
    return c.data[i] === fr && c.data[i + 1] === fg && c.data[i + 2] === fb && c.data[i + 3] === 255;
  };
  const isEmpty = (x, y) => {
    if (x < 0 || y < 0 || x >= c.w || y >= c.h) return true;
    const i = (y * c.w + x) * 4;
    return c.data[i + 3] === 0;
  };
  const toPaint = [];
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      if (!isEmpty(x, y)) continue;
      if (isFill(x - 1, y) || isFill(x + 1, y) || isFill(x, y - 1) || isFill(x, y + 1)) {
        toPaint.push([x, y]);
      }
    }
  }
  for (const [x, y] of toPaint) c.set(x, y, rimHex);
}

function hexRGB(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function buildRocketSheet(variant) {
  const W = ROCKET_FW * ROCKET_FRAMES;
  const H = ROCKET_FH;
  const target = new Uint8Array(W * H * 4);
  for (let f = 0; f < ROCKET_FRAMES; f++) {
    const cell = new PixelCanvas(RK_DW, RK_DH);
    drawRocketCell(cell, f, variant);
    cell.blitInto(target, W, f * ROCKET_FW, 0, RK_SCALE);
  }
  return encodePNG(W, H, target);
}

// ---------------------------------------------------------------------------
// EXPLOSION  — 6 frames in a row, square 48x48 (sheet 288x48)
// ---------------------------------------------------------------------------

const EXP_FS = 48;
const EXP_FRAMES = 6;
const EX_D = 12; // design grid 12x12
const EX_SCALE = EXP_FS / EX_D; // = 4

// A blocky starburst that grows then fades. Deterministic per frame: each frame
// is a hand-authored ring radius + a fixed jagged spark mask, so it animates
// without randomness.
function drawExplosionCell(c, frame) {
  const cx = 5.5; // center between cols 5,6 of a 12-wide grid
  const cy = 5.5;

  // Per-frame look: [coreR, ringR, spikes(on/off), color]
  // 0 spark, 1-2 grow, 3 peak, 4-5 fade
  const radius = [1.5, 3, 4.5, 5.5, 5, 4][frame];
  const coreR = [1.5, 2.5, 3, 2, 1, 0][frame];
  const hot = [FLAME_HOT, FLAME_HOT, FLAME_HOT, FLAME_HOT, FLAME_MID, FLAME_OUTER][frame];
  const ring = [FLAME_MID, DARK, DARK, DARK, FLAME_OUTER, FLAME_OUTER][frame];

  // filled blocky disc for the fireball body
  for (let y = 0; y < EX_D; y++) {
    for (let x = 0; x < EX_D; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= radius) c.set(x, y, ring);
    }
  }
  // hot core
  for (let y = 0; y < EX_D; y++) {
    for (let x = 0; x < EX_D; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (coreR > 0 && d <= coreR) c.set(x, y, hot);
    }
  }

  // jagged spikes radiating out (8 directions), length scales with frame.
  const spikeLen = [0, 1, 2, 3, 2, 1][frame];
  const dirs = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [-1, 1], [1, -1], [-1, -1],
  ];
  for (const [dx, dy] of dirs) {
    for (let s = 1; s <= spikeLen; s++) {
      const px = Math.round(cx + dx * (radius + s) * (dx && dy ? 0.7 : 1));
      const py = Math.round(cy + dy * (radius + s) * (dx && dy ? 0.7 : 1));
      const col = s === spikeLen ? FLAME_OUTER : frame >= 4 ? FLAME_OUTER : FLAME_MID;
      c.set(px, py, col);
    }
  }
}

function buildExplosionSheet() {
  const W = EXP_FS * EXP_FRAMES;
  const H = EXP_FS;
  const target = new Uint8Array(W * H * 4);
  for (let f = 0; f < EXP_FRAMES; f++) {
    const cell = new PixelCanvas(EX_D, EX_D);
    drawExplosionCell(cell, f);
    cell.blitInto(target, W, f * EXP_FS, 0, EX_SCALE);
  }
  return encodePNG(W, H, target);
}

// ---------------------------------------------------------------------------
// ENGINE FLAME  — 4 frames in a row, points DOWN, 16x22 per frame (sheet 64x22)
// ---------------------------------------------------------------------------

const FLAME_FW = 16;
const FLAME_FH = 22;
const FLAME_FRAMES = 4;
const FL_DW = 8; // design 8x11
const FL_DH = 11;
const FL_SCALE = FLAME_FW / FL_DW; // = 2

// Teardrop of fire pointing DOWN, built from chunky blocks. Wide flat top
// (attaches to the rocket tail), tapering to a jagged tip at the bottom.
function drawFlameCell(c, flick) {
  const cx = 3; // body occupies cols 3,4 (2 wide center)
  // flicker length + tip wiggle from frame index
  const len = [8, 10, 7, 9][flick];
  const wiggle = [0, 1, -1, 0][flick];

  // Build the flame from concentric "shells" widest at the top.
  // top rows wide, tapering down.
  for (let y = 0; y < len; y++) {
    const t = y / len; // 0 top -> 1 tip
    // half-width shrinks from 2 to 0 as we go down
    const halfW = Math.max(0, Math.round((1 - t) * 2.4));
    const center = cx + (y > len * 0.6 ? wiggle : 0);
    // outer shell
    for (let dx = -halfW; dx <= halfW; dx++) {
      let col = FLAME_OUTER;
      if (Math.abs(dx) <= halfW - 1) col = FLAME_MID;
      if (dx === 0 && y < len * 0.55) col = FLAME_HOT;
      c.set(center + dx, y, col);
    }
  }
}

function buildFlameSheet() {
  const W = FLAME_FW * FLAME_FRAMES;
  const H = FLAME_FH;
  const target = new Uint8Array(W * H * 4);
  for (let f = 0; f < FLAME_FRAMES; f++) {
    const cell = new PixelCanvas(FL_DW, FL_DH);
    drawFlameCell(cell, f);
    cell.blitInto(target, W, f * FLAME_FW, 0, FL_SCALE);
  }
  return encodePNG(W, H, target);
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

export function generate(assetsDir) {
  const written = [];

  for (const variant of [1, 2, 3]) {
    const file = path.join(assetsDir, `rocket-${variant}.png`);
    writePNG(file, buildRocketSheet(variant));
    written.push(file);
  }

  const expFile = path.join(assetsDir, "explosion.png");
  writePNG(expFile, buildExplosionSheet());
  written.push(expFile);

  const flameFile = path.join(assetsDir, "rocket-flame.png");
  writePNG(flameFile, buildFlameSheet());
  written.push(flameFile);

  return written;
}

// Run when invoked directly.
const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, "..", "..");
  const assetsDir = path.join(repoRoot, "public", "assets");
  const files = generate(assetsDir);
  console.log(`Wrote ${files.length} sprite files to ${assetsDir}:`);
  for (const f of files) console.log("  " + path.basename(f));
}
