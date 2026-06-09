#!/usr/bin/env node
/**
 * Infinite Eddie — character ("dude") spritesheet generator.
 *
 * Produces BASIC PIXEL-ART spritesheets of a little front-facing humanoid,
 * styled after the reference: tiny chunky MONOCHROME black pixel-people built
 * from a handful of big square "design pixels". The reference figures are LEAN
 * stick-humanoids — a small square head, a narrow 1px torso, splayed stick arms,
 * and splayed stick legs — drawn in a SINGLE black ink on a transparent ground.
 * No colour, no fill mass, no shading tones, no anti-aliasing, no gradients.
 *
 * Each sheet is a GRID:
 *   - COLUMNS = 4 animation frames (a looping cycle), index 0..3
 *   - ROWS    = 4 poses, top->bottom: idle, walk, jump, interact
 * So a sheet is (4*cell) wide by (4*cell) tall. The renderer shows ONE cell at
 * native scale via backgroundPosition `-(col*cell)px -(row*cell)px`, with the
 * element sized to a single cell — so dimensions must be EXACT.
 *
 * Filename contract (renderer depends on it — do not deviate):
 *   ${sizeName}-${tierName}${gunVariant}.png   (PNG; SpriteLoader tries .png first)
 *   sizes:   big=64, medium=48, small=32  (square cells)
 *            => sheets: big 256x256, medium 192x192, small 128x128
 *   tiers:   loose, normal, perfect
 *   guns:    ""  |  -gunL (viewer-left hand)  |  -gunR (viewer-right)  |  -gunLR
 *   => 3 sizes × 3 tiers × 4 gun variants = 36 files.
 *
 * Deterministic — no random at generation time; all motion is a closed-form
 * function of the frame index.
 *
 * Usage:
 *   import { generate } from "./dude.mjs"; generate(assetsDir);
 *   node scripts/sprites/dude.mjs           // writes into <repoRoot>/public/assets
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { PixelCanvas, encodePNG, writePNG } from "./png.mjs";

// ---------------------------------------------------------------------------
// Contract tables
// ---------------------------------------------------------------------------

const SIZES = [
  { name: "big", cell: 64 },
  { name: "medium", cell: 48 },
  { name: "small", cell: 32 },
];

// Tiers are kept monochrome to match the reference (zero colour). The ink is a
// single near-black for every tier; tiers are distinguished elsewhere in the
// game (size, glow), not by a coloured pixel on the figure.
const TIERS = [
  { name: "loose" },
  { name: "normal" },
  { name: "perfect" },
];

const GUN_VARIANTS = [
  { suffix: "", guns: { left: false, right: false } },
  { suffix: "-gunL", guns: { left: true, right: false } },  // viewer's LEFT
  { suffix: "-gunR", guns: { left: false, right: true } },  // viewer's RIGHT
  { suffix: "-gunLR", guns: { left: true, right: true } },
];

// Row order MUST match Character.getSpriteFrame()'s pose index order.
const POSES = ["idle", "walk", "jump", "interact"];
const FRAMES = 4;

// Design grid: every cell is drawn on a small DESIGN x DESIGN logical canvas,
// then nearest-neighbour upscaled to the real cell size so each design pixel is
// a clean square block. DESIGN must divide every cell (64/48/32) evenly: 16 does.
const DESIGN = 16;

// Single-ink monochrome palette — the whole point of this iteration. A warm
// bone-white reads with high contrast on the dark ocean background (near-black
// vanished into the water) without colliding with the cyan/gold/magenta UI.
const INK = "#F2ECDC";   // one warm-white ink for the entire figure + gun

// ---------------------------------------------------------------------------
// Figure model — a LEAN stick-humanoid, like the reference.
//
// On the 16x16 design grid (x,y both 0..15), the body is symmetric about the
// vertical line between x=7 and x=8. The figure is built from thin 1px strokes:
//
//   head     : a 2x2 block at the top (rows 1..2)
//   neck     : a single pixel (row 3)
//   shoulders : a short 2px horizontal bar that splays out to the arms (row 4)
//   torso    : a 2px-wide thin column (rows 4..8)  — narrow, hollow look
//   arms     : 1px strokes angling DOWN and OUT from the shoulders to the hands
//   pelvis   : a 2px bar where the legs split (row 9)
//   legs     : 1px strokes angling DOWN and OUT from the pelvis to the feet
//   feet     : a single pixel turned out at each leg bottom (the baseline)
//
// All motion offsets are integer design pixels so the result stays crisp.
// ---------------------------------------------------------------------------

const CX_L = 7;            // left-of-centre column
const CX_R = 8;            // right-of-centre column
const HEAD_Y = 1;          // head top row (before bob)
const SHOULDER_Y = 4;      // shoulder bar row
const PELVIS_Y = 9;        // hips split here
const FOOT_Y = 13;         // feet baseline row

// Shoulder/hand and hip/foot anchor X positions (the splay).
const SHOULDER_L = 6, SHOULDER_R = 9;   // outer shoulder pixels
const HAND_L = 5, HAND_R = 10;          // resting hand columns (arms splay out)
const HIP_L = 6, HIP_R = 9;             // hip columns
const FOOT_L = 5, FOOT_R = 10;          // resting foot columns (legs splay out)

/**
 * Pose parameters for a (pose, frame). Everything is integer design pixels.
 * Returns small offsets the drawer applies to keep the figure lean & animated.
 */
function poseParams(pose, fr) {
  let lift = 0;          // whole-figure vertical lift (negative = up)
  let armLΔ = 0;         // viewer-left hand row delta (negative = raised)
  let armRΔ = 0;         // viewer-right hand row delta
  let handLx = HAND_L;   // viewer-left hand column
  let handRx = HAND_R;   // viewer-right hand column
  let footLy = FOOT_Y;   // viewer-left foot row
  let footRy = FOOT_Y;   // viewer-right foot row
  let footLx = FOOT_L;   // viewer-left foot column
  let footRx = FOOT_R;   // viewer-right foot column
  let headBob = 0;       // head vertical jitter

  if (pose === "idle") {
    // Gentle breathing sway: hands bob a hair, alternating; tiny head bob.
    const s = [0, 1, 0, -1][fr];
    armLΔ = s > 0 ? 1 : 0;
    armRΔ = s < 0 ? 1 : 0;
    headBob = fr === 2 ? 1 : 0;
  } else if (pose === "walk") {
    // 4-frame walk: contact / passing / contact / passing. Legs scissor along
    // x; arms counter-swing. Feet stay on/near the baseline (stride reads via x).
    const cyc = [0, 1, 0, -1][fr];
    footLx = FOOT_L + cyc;          // left foot forward/back
    footRx = FOOT_R - cyc;          // right foot opposite
    footLy = FOOT_Y - (cyc > 0 ? 1 : 0);
    footRy = FOOT_Y - (cyc < 0 ? 1 : 0);
    handLx = HAND_L + cyc;          // arms counter-swing the legs
    handRx = HAND_R + cyc;
    armLΔ = cyc > 0 ? -1 : 0;
    armRΔ = cyc < 0 ? -1 : 0;
    lift = fr % 2 === 1 ? -1 : 0;   // little bob on passing frames
  } else if (pose === "jump") {
    // crouch -> launch -> apex -> land. Arms throw up, legs tuck/splay.
    if (fr === 0) { lift = 1; armLΔ = 1; armRΔ = 1; }                 // crouch
    else if (fr === 1) { lift = -2; armLΔ = -4; armRΔ = -4; }         // launch
    else if (fr === 2) {                                              // apex
      lift = -3; armLΔ = -5; armRΔ = -5;
      footLx = FOOT_L + 1; footRx = FOOT_R - 1; footLy = FOOT_Y - 2; footRy = FOOT_Y - 2;
    } else {                                                          // land
      lift = 1; footLx = FOOT_L - 1; footRx = FOOT_R + 1;
    }
  } else { // interact — wave the viewer-right arm overhead, little excited hop.
    lift = fr === 1 || fr === 2 ? -1 : 0;
    armRΔ = -5;                     // right arm thrown up
    handRx = HAND_R - 1;            // hand swings inward/up
    armLΔ = fr % 2 === 0 ? 0 : 1;   // left arm small bob
    headBob = fr === 2 ? 1 : 0;
  }
  return { lift, armLΔ, armRΔ, handLx, handRx, footLy, footRy, footLx, footRx, headBob };
}

/** Draw a 1px-thick line between two points (Bresenham) in INK. */
function line(set, x0, y0, x1, y1) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    set(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
}

/**
 * Draw a single LEAN stick figure into a PixelCanvas (DESIGN x DESIGN), single
 * INK, no fill mass, no shading, no accent colour.
 */
function drawFigure(cv, pose, fr, guns) {
  const p = poseParams(pose, fr);
  const dy = p.lift;
  const set = (x, y) => cv.set(x, y + dy, INK);

  // --- HEAD: small 2x2 block near the top ---
  const headY = HEAD_Y + p.headBob;
  set(CX_L, headY); set(CX_R, headY);
  set(CX_L, headY + 1); set(CX_R, headY + 1);
  // neck
  set(CX_L, headY + 2 < SHOULDER_Y ? headY + 2 : SHOULDER_Y - 1);

  // --- SHOULDER BAR: short horizontal splay where arms attach ---
  set(SHOULDER_L, SHOULDER_Y); set(CX_L, SHOULDER_Y);
  set(CX_R, SHOULDER_Y); set(SHOULDER_R, SHOULDER_Y);

  // --- TORSO: narrow 2px-wide thin column from shoulders to pelvis ---
  for (let y = SHOULDER_Y + 1; y <= PELVIS_Y; y++) { set(CX_L, y); set(CX_R, y); }

  // --- ARMS: 1px strokes angling DOWN & OUT from shoulders to hands ---
  const handLy = SHOULDER_Y + 4 + p.armLΔ;   // resting hand near row 8
  const handRy = SHOULDER_Y + 4 + p.armRΔ;
  line(set, SHOULDER_L, SHOULDER_Y, p.handLx, handLy);
  line(set, SHOULDER_R, SHOULDER_Y, p.handRx, handRy);

  // --- PELVIS BAR + LEGS: 1px strokes angling DOWN & OUT to the feet ---
  set(HIP_L, PELVIS_Y); set(HIP_R, PELVIS_Y);
  line(set, HIP_L, PELVIS_Y, p.footLx, p.footLy);
  line(set, HIP_R, PELVIS_Y, p.footRx, p.footRy);
  // feet: a single pixel turned outward at each leg bottom
  set(p.footLx - 1 >= 0 ? p.footLx - 1 : 0, p.footLy);
  set(p.footRx + 1 <= DESIGN - 1 ? p.footRx + 1 : DESIGN - 1, p.footRy);

  // --- GUNS: a tiny pixel pistol in the matching hand(s) ---
  if (guns.left) drawGun(set, p.handLx, handLy, -1);
  if (guns.right) drawGun(set, p.handRx, handRy, +1);
}

/** Tiny pixel pistol at a hand. dir = -1 points left, +1 points right. */
function drawGun(set, handX, handY, dir) {
  // 2-pixel barrel poking outward from the hand, plus a 1px grip below — all INK.
  set(handX + dir, handY);
  set(handX + dir * 2, handY);
  set(handX, handY + 1);
}

// ---------------------------------------------------------------------------
// Sheet assembly. Build one RGBA target buffer for the whole sheet and blit each
// cell's small design canvas into it (nearest-neighbour upscaled).
// ---------------------------------------------------------------------------
function generateDudeSheet(cell, guns) {
  const sheetW = FRAMES * cell;
  const sheetH = POSES.length * cell;
  const target = new Uint8Array(sheetW * sheetH * 4); // transparent
  const scale = cell / DESIGN;                        // integer (4, 3, 2)

  for (let row = 0; row < POSES.length; row++) {
    for (let col = 0; col < FRAMES; col++) {
      const cv = new PixelCanvas(DESIGN, DESIGN);
      drawFigure(cv, POSES[row], col, guns);
      cv.blitInto(target, sheetW, col * cell, row * cell, scale);
    }
  }
  return encodePNG(sheetW, sheetH, target);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate all 36 dude spritesheets into `assetsDir`.
 * @param {string} assetsDir absolute path to the assets directory.
 * @returns {string[]} list of filenames written.
 */
export function generate(assetsDir) {
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
  const written = [];
  for (const size of SIZES) {
    for (const tier of TIERS) {
      for (const v of GUN_VARIANTS) {
        const file = `${size.name}-${tier.name}${v.suffix}.png`;
        const buf = generateDudeSheet(size.cell, v.guns);
        writePNG(path.join(assetsDir, file), buf);
        written.push(file);
      }
    }
  }
  return written;
}

// Run standalone: write into <repoRoot>/public/assets. This file lives at
// scripts/sprites/dude.mjs, so repo root is two directories up.
const isMain = (() => {
  try {
    return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] || "");
  } catch {
    return false;
  }
})();

if (isMain) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, "..", "..");
  const assetsDir = path.join(repoRoot, "public", "assets");
  const files = generate(assetsDir);
  console.log(`Wrote ${files.length} dude spritesheets to ${assetsDir}`);
  for (const f of files) console.log("  " + f);
}
