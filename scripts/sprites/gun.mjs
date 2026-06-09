#!/usr/bin/env node
/**
 * gun.mjs — pixel-art sprite generator for the "Infinite Eddie" laser pistol.
 *
 * Emits a SINGLE-FRAME PNG of a laser pistol lying FLAT on the ground
 * (horizontal side profile, barrel pointing right), drawn as chunky blocky
 * pixel-art in the spirit of the monochrome pixel-humanoid reference art:
 * a near-black silhouette built from big square pixels, no gradients, no
 * anti-aliasing. One glowing muzzle pixel signals "laser".
 *
 *   gun-floor.png   32x16  (~2:1, wider than tall)
 *
 * The sheet keeps the SAME 32x16 intrinsic dimensions the game expects
 * (Gun.ts sizes the DOM box at a 2:1 aspect and SpriteLoader loads
 * /assets/gun-floor.png). We draw on a 16x8 logical "design" grid and
 * nearest-neighbour upscale by 2 so each design pixel becomes a clean
 * 2x2 block — the chunky pixel-art read.
 *
 * Fully deterministic (no randomness).
 *
 * Run directly to write into <repoRoot>/public/assets:
 *   node scripts/sprites/gun.mjs
 * Or import { generate } and call generate(assetsDir).
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { PixelCanvas, encodePNG, writePNG } from "./png.mjs";

// ---- sheet geometry ------------------------------------------------------
const DESIGN_W = 16; // logical design grid width
const DESIGN_H = 8; // logical design grid height
const SCALE = 2; // nearest-neighbour upscale -> 32x16 output
const SHEET_W = DESIGN_W * SCALE; // 32
const SHEET_H = DESIGN_H * SCALE; // 16

// ---- palette (monochrome silhouette + one glowing muzzle pixel) ----------
const BODY = "#0a0c12"; // near-black gun silhouette (matches reference)
const RIM = "#39414f"; // faint lighter rim for readability on dark ocean
const MUZZLE_GLOW = "#ff6a1e"; // outer hot muzzle pixel
const MUZZLE_CORE = "#fff0b0"; // white-hot muzzle core pixel

/**
 * Paint the laser pistol onto a 16x8 PixelCanvas in design pixels.
 *
 * Silhouette map (design coords, x→ right, y→ down), barrel along the top
 * band, grip dropping down-left, single trigger nub:
 *
 *   y0:  . . . . . . . . . . . . . . . .
 *   y1:  . . # # # . . . . . . . . . . .   <- top of receiver / rear sight
 *   y2:  . . # # # # # # # # # # # # M .   <- slide / barrel, muzzle (M) at tip
 *   y3:  . . # # # # # # # # # # # # # .   <- barrel underside (thin band)
 *   y4:  . . # # # # . . . . . . . . . .   <- receiver base + trigger guard top
 *   y5:  . . # # # . . . . . . . . . . .   <- grip top
 *   y6:  . # # # # . . . . . . . . . . .   <- grip (flares forward slightly)
 *   y7:  . # # # . . . . . . . . . . . .   <- grip heel
 */
function paintGun(c) {
  // Solid silhouette, row by row [x0, x1] inclusive on the design grid.
  // Barrel/slide is a THIN band so the pistol reads (not a brick); the
  // receiver block sits at the rear with the grip dropping below it.
  const rows = [
    [2, 4], // y1  rear sight / receiver top
    [2, 13], // y2  slide + barrel (muzzle pixel at x14 added separately)
    [2, 13], // y3  barrel underside
    [2, 5], // y4  receiver base
    [2, 4], // y5  grip top
    [1, 4], // y6  grip
    [1, 3], // y7  grip heel
  ];
  rows.forEach(([x0, x1], i) => {
    const y = i + 1;
    for (let x = x0; x <= x1; x++) c.set(x, y, BODY);
  });

  // Trigger nub poking down just ahead of the grip.
  c.set(5, 5, BODY);

  // ----- faint 1px lighter rim around the silhouette for dark-bg read -----
  // Compute rim only where a transparent design pixel touches a BODY pixel
  // (4-neighbour), so the outline stays crisp and blocky.
  const isBody = (x, y) => {
    if (x < 0 || y < 0 || x >= DESIGN_W || y >= DESIGN_H) return false;
    const i = (y * DESIGN_W + x) * 4;
    return c.data[i + 3] !== 0;
  };
  const rimPixels = [];
  for (let y = 0; y < DESIGN_H; y++) {
    for (let x = 0; x < DESIGN_W; x++) {
      if (isBody(x, y)) continue;
      if (isBody(x - 1, y) || isBody(x + 1, y) || isBody(x, y - 1) || isBody(x, y + 1)) {
        rimPixels.push([x, y]);
      }
    }
  }
  for (const [x, y] of rimPixels) c.set(x, y, RIM);

  // ----- glowing muzzle: signals "laser" at the barrel tip (right edge) ---
  c.set(14, 2, MUZZLE_GLOW); // outer glow pixel beyond the barrel
  c.set(13, 2, MUZZLE_CORE); // hot core at the very mouth of the barrel
}

/**
 * Render the 32x16 gun-floor sheet as a PNG buffer.
 * @returns {Buffer}
 */
function gunFloorPng() {
  const target = new Uint8Array(SHEET_W * SHEET_H * 4); // transparent
  const cell = new PixelCanvas(DESIGN_W, DESIGN_H);
  paintGun(cell);
  cell.blitInto(target, SHEET_W, 0, 0, SCALE);
  return encodePNG(SHEET_W, SHEET_H, target);
}

/**
 * Write the gun sprite into assetsDir. Creates the directory if needed.
 * @param {string} assetsDir absolute path to the assets output directory
 * @returns {string[]} paths written
 */
export function generate(assetsDir) {
  const out = path.join(assetsDir, "gun-floor.png");
  writePNG(out, gunFloorPng());
  return [out];
}

// Run directly: node scripts/sprites/gun.mjs
const __filename = fileURLToPath(import.meta.url);
const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) {
  const repoRoot = path.resolve(path.dirname(__filename), "..", "..");
  const assetsDir = path.join(repoRoot, "public/assets");
  const written = generate(assetsDir);
  for (const f of written) console.log("wrote", f);
}
