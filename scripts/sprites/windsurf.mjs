#!/usr/bin/env node
/**
 * Windsurf board (Battle) — `windsurf-board.png`, a single 48x24 frame of a
 * board floating on the water with a raised triangular sail, waiting for a dude
 * to mount it. Chunky pixel-art in the reference style: crisp square blocks, no
 * anti-aliasing, no gradients, FLAT single-ink black (like the reference's
 * stark black-on-white figures).
 *
 * Design grid is 24x12, nearest-neighbour upscaled x2 -> 48x24 (the cell size
 * the game's Gun.ts expects for a "perfect" floor footprint; smaller qualities
 * just CSS-scale this same sheet). Keep the 48x24 output or the game breaks.
 *
 *   node scripts/sprites/windsurf.mjs
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { PixelCanvas, encodePNG, writePNG } from "./png.mjs";

// Stark monochrome — a single ink color, no shading, no gradient. Matches the
// reference's solid-black figures. Drawn on transparent so it sits on the dark
// water; the ink is near-black with a hint of warmth so it stays crisp but not
// pure #000 (which can disappear on a black backdrop). Reference style = flat.
const INK = "#101418"; // the single fill/ink color

// 24x12 design grid. Board lies flat along the bottom; a tall triangular sail
// rises from the deck so the silhouette unmistakably reads as a windsurf.
function draw(cv) {
  // ---- Board hull: a long, FLAT, slightly pointed plank ------------------
  // Two solid rows so it reads as a board (deck + rail), pointed at both ends.
  // Keep it thin and elongated — NOT a bulging saucer.
  const deckY = 9;   // deck top row
  const railY = 10;  // near rail row (board is 2px thick in the middle)
  const left = 2, right = 21;
  // Main body: full 2px thickness across the middle.
  for (let x = left + 2; x <= right - 2; x++) {
    cv.set(x, deckY, INK);
    cv.set(x, railY, INK);
  }
  // Tapered tips: single-row points so nose/tail read as a board, not a blob.
  cv.set(left, railY, INK);
  cv.set(left + 1, railY, INK);
  cv.set(left + 1, deckY, INK);
  cv.set(right, railY, INK);
  cv.set(right - 1, railY, INK);
  cv.set(right - 1, deckY, INK);

  // ---- Mast: a vertical pole rising from the deck to the sail top ---------
  const mastX = 11;
  const mastTop = 0;
  for (let y = mastTop; y < deckY; y++) cv.set(mastX, y, INK);

  // ---- Triangular sail: tall, filling the space behind the mast ----------
  // Apex at the mast top; the sail widens downward toward the boom near the
  // deck, forming a clear right-triangle whose vertical edge IS the mast and
  // whose hypotenuse is the diagonal leech. ~9px tall — the defining feature.
  // For each row below the apex, the sail extends from the mast out to the
  // right by an amount that grows with depth.
  const sailTop = 1;     // one row under the very tip of the mast
  const sailBot = deckY - 1; // boom just above the deck (y = 8)
  const sailHeight = sailBot - sailTop; // 7 rows of sail
  for (let y = sailTop; y <= sailBot; y++) {
    const t = (y - sailTop) / sailHeight; // 0 at apex .. 1 at boom
    const reach = Math.round(1 + t * 7);  // 1px wide at apex .. 8px at boom
    for (let dx = 1; dx <= reach; dx++) cv.set(mastX + dx, y, INK);
  }

  // ---- Boom: a short horizontal bar along the bottom of the sail ----------
  // Reinforces "rig" reading; sits one row above the deck spanning the foot.
  for (let dx = 0; dx <= 8; dx++) cv.set(mastX + dx, sailBot, INK);
}

export function generate(assetsDir) {
  const cv = new PixelCanvas(24, 12);
  draw(cv);
  return [writePNG(path.join(assetsDir, "windsurf-board.png"), cv.toPNG(2))];
}

const isMain = (() => {
  try { return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] || ""); }
  catch { return false; }
})();
if (isMain) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = path.join(path.resolve(here, "..", ".."), "public", "assets");
  generate(dir);
  console.log("Wrote windsurf-board.png");
}
