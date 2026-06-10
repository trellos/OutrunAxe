#!/usr/bin/env node
/**
 * Battle-mode dude spritesheets — the swimmers (separate from the land Score
 * Run dudes so each game keeps its own look).
 *
 * Files: swim-big.png (256x256), swim-medium.png (192x192), swim-small.png
 * (128x128). Each is a 4x4 grid: COLUMNS = 4 animation frames, ROWS = poses in
 * the order the renderer (Character.getSpriteFrame) expects:
 *   row 0 = swim-idle  (treading water)
 *   row 1 = swim-move  (stroking sideways — flipped by the engine for facing)
 *   row 2 = windsurf   (standing wide on a board)
 *   row 3 = flail      (arms up — used when eaten; red tint on later frames)
 *
 * Reference style (.art-ref/reference.jpg): strictly 1-bit. Hard square pixels,
 * ZERO anti-aliasing, ZERO gradients. Each figure is a SOLID single-colour
 * silhouette: a clear 2x2 head, square shoulders, a 2-wide torso, and 2-px-wide
 * limbs that read at any size. We author on a true 16x16 native grid and the
 * encoder nearest-neighbour upscales by an INTEGER (4/3/2) so every design pixel
 * is one clean block. No interior outline, no kitchen-sink props — just clean
 * swimmer frames, with minimal flat single-colour water accents.
 *
 * Deterministic: all variation derives from the frame index.
 *
 *   node scripts/sprites/battle-dude.mjs   // writes into public/assets
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { PixelCanvas, encodePNG, writePNG } from "./png.mjs";

const SIZES = [
  { name: "big", cell: 64 },
  { name: "medium", cell: 48 },
  { name: "small", cell: 32 },
];
const DESIGN = 16;
const FRAMES = 4;
const POSES = ["swim", "stroke", "windsurf", "flail"];

// Tiny FLAT palette — one body colour, one water colour, one eaten colour.
// No gradients, no semi-transparent edges. Every pixel is exactly one of these.
const BODY = "#F2ECDC";   // bone-white solid silhouette (the reference figure)
const WATER = "#5fb8e8";  // single flat blue for wake (chunky blocks only)
const EATEN = "#e23b3b";  // single flat red when the dude is being eaten (flail)

// --- helpers -----------------------------------------------------------------

/** Paint a solid filled rectangle of body pixels (clamped to the grid). */
function blk(cv, x, y, w, h, color) {
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) cv.set(xx, yy, color);
}

/** One flat 2x2 water block (chunky, never 1px noise, never a gradient). */
function wake(cv, x, y) {
  blk(cv, x, y, 2, 2, WATER);
}

// --- poses -------------------------------------------------------------------
// Every pose draws a SOLID body silhouette in a single colour. Limbs are 2px
// wide, the head is a 2x2 block, shoulders are square — chunky like the
// reference. Only the limb angles change frame-to-frame; the body scale and
// baseline stay constant across the 4 columns.

function drawSwim(cv, fr, color) {
  // Treading water, front view: a clear standing person. Arms scull out to the
  // sides, alternating up/down by frame; a gentle 1px vertical bob.
  const bob = fr % 2 === 0 ? 0 : 1;
  const cx = 7;                 // left edge of the 2-wide spine
  const top = 3 + bob;

  blk(cv, cx, top, 2, 2, color);           // head (2x2)
  blk(cv, cx - 1, top + 2, 4, 2, color);   // square shoulders (4 wide, 2 tall)
  blk(cv, cx, top + 4, 2, 3, color);       // torso (2 wide)

  // sculling arms: 2px wide, opposite vertical phase so two distinct arms read
  const a = fr % 2 === 0 ? 0 : 1;
  blk(cv, cx - 3, top + 3 + a, 2, 2, color);          // left arm
  blk(cv, cx + 3, top + 3 + (1 - a), 2, 2, color);    // right arm (opp phase)

  // two legs (2px each), a small kick split on alternating frames
  blk(cv, cx, top + 7, 2, 3, color);       // legs block
  if (fr % 2 === 0) cv.set(cx - 1, top + 9, color);   // left foot kick
  else cv.set(cx + 2, top + 9, color);                // right foot kick

  // flat water accents hugging the waterline
  const wl = top + 8;
  wake(cv, cx - 5, wl);
  wake(cv, cx + 5, wl);
}

function drawStroke(cv, fr, color) {
  // Freestyle swimming sideways (facing right): a horizontal body, one lead arm
  // windmilling overhead, the trailing arm in opposite phase, legs fluttering.
  const baseY = 6;

  blk(cv, 4, baseY + 1, 7, 3, color);      // horizontal torso (chunky, 3 tall)
  blk(cv, 11, baseY, 3, 3, color);         // head leading at the right

  // lead arm windmill: forward-entry (0-1) then lifted recovery (2-3)
  if (fr === 0)      blk(cv, 13, baseY + 1, 3, 2, color);   // reach far forward
  else if (fr === 1) blk(cv, 13, baseY - 1, 2, 3, color);   // catching
  else if (fr === 2) blk(cv, 11, baseY - 3, 2, 4, color);   // recovery up
  else               blk(cv, 9, baseY - 3, 2, 4, color);    // over the shoulder

  // trailing arm — opposite phase, always a second visible limb
  if (fr === 0 || fr === 1) blk(cv, 2, baseY + 3, 3, 2, color);  // down/back
  else                      blk(cv, 3, baseY - 1, 2, 3, color);  // lifting

  // fluttering legs trailing left (2px tall), kicking by frame
  const k = fr % 2;
  blk(cv, 0, baseY + 4 + k, 4, 2, color);

  // bow wake in front of the head
  wake(cv, 14, baseY + 4);
  if (fr % 2 === 0) wake(cv, 1, baseY + 7);
}

function drawWindsurf(cv, fr, color) {
  // Standing braced on a board (facing right): wide athletic stance, both arms
  // reaching up/forward as if gripping a sail, a small lean by frame. The board
  // is a flat single-colour body block (no separate sail/mast clutter, no
  // gradient sail). This keeps the sheet a clean set of DUDE frames.
  const lean = fr % 2;
  const cx = 6;
  const top = 2 + lean;

  blk(cv, cx, top, 2, 2, color);            // head (2x2)
  blk(cv, cx - 1, top + 2, 4, 2, color);    // square shoulders
  blk(cv, cx, top + 4, 2, 3, color);        // torso

  // both arms reaching up-forward (to the right) — two stacked 2px limbs
  blk(cv, cx + 2, top + 1 - lean, 3, 2, color);   // upper arm to grip
  blk(cv, cx + 2, top + 4, 3, 2, color);          // lower arm to grip

  // wide braced legs (athletic stance): front leg forward-right, back leg left
  blk(cv, cx + 1, top + 7, 2, 2, color);    // hips
  blk(cv, cx + 2, top + 9, 2, 2, color);    // front leg (toward bow)
  blk(cv, cx - 1, top + 9, 2, 2, color);    // back leg (braced)

  // the board: one flat solid block the figure stands on (NOT a separate prop)
  blk(cv, 1, 14, 13, 2, color);

  // flat spray off the planing bow
  wake(cv, 0, 13);
  if (fr % 2 === 1) wake(cv, 13, 13);
}

function drawFlail(cv, fr, color) {
  // Panicked / eaten: both arms thrown straight UP, legs kicking. The body turns
  // flat RED on the later frames (when actually being eaten). Solid silhouette.
  const tint = fr >= 2 ? EATEN : color;
  const cx = 7;
  const top = 4;

  blk(cv, cx, top, 2, 2, tint);             // head (2x2)
  blk(cv, cx - 1, top + 2, 4, 2, tint);     // square shoulders
  blk(cv, cx, top + 4, 2, 3, tint);         // torso

  // both arms straight up off the shoulders, 2px wide, waving by frame
  const wave = fr % 2;
  blk(cv, cx - 2, top - 1 - wave, 2, 3 + wave, tint);              // left arm up
  blk(cv, cx + 2, top - 1 - (1 - wave), 2, 3 + (1 - wave), tint);  // right arm up

  // legs near-vertical with a small kick out by frame
  blk(cv, cx, top + 7, 2, 3, tint);         // legs block
  if (fr % 2 === 0) cv.set(cx - 1, top + 9, tint);
  else cv.set(cx + 2, top + 9, tint);

  // panic splash: red foam when eaten, blue otherwise — flat blocks
  const fc = fr >= 2 ? EATEN : WATER;
  wake(cv, cx - 5, top + 8);
  wake(cv, cx + 5, top + 8);
  cv.set(cx + 6, top + 7, fc);
  cv.set(cx - 6, top + 7, fc);
}

function drawPose(cv, poseIdx, fr) {
  if (poseIdx === 0) drawSwim(cv, fr, BODY);
  else if (poseIdx === 1) drawStroke(cv, fr, BODY);
  else if (poseIdx === 2) drawWindsurf(cv, fr, BODY);
  else drawFlail(cv, fr, BODY);
}

function sheet(cell) {
  const W = FRAMES * cell, H = POSES.length * cell;
  const target = new Uint8Array(W * H * 4);
  const scale = cell / DESIGN; // 4 (big) / 3 (medium) / 2 (small) — all integers
  for (let row = 0; row < POSES.length; row++) {
    for (let col = 0; col < FRAMES; col++) {
      const cv = new PixelCanvas(DESIGN, DESIGN);
      drawPose(cv, row, col);
      cv.blitInto(target, W, col * cell, row * cell, scale);
    }
  }
  return encodePNG(W, H, target);
}

export function generate(assetsDir) {
  const written = [];
  for (const s of SIZES) {
    const file = path.join(assetsDir, `swim-${s.name}.png`);
    writePNG(file, sheet(s.cell));
    written.push(file);
  }
  return written;
}

const isMain = (() => {
  try { return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] || ""); }
  catch { return false; }
})();
if (isMain) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = path.join(path.resolve(here, "..", ".."), "public", "assets");
  const files = generate(dir);
  console.log(`Wrote ${files.length} battle-dude sheets`);
}
