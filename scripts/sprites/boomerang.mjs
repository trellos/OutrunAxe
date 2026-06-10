#!/usr/bin/env node
/**
 * Boomerang (Battle) + the bonk hit effect.
 *
 *   boomerang.png  64x16  — 4 frames of 16x16, a bent-V wooden boomerang shown at
 *                           a few rotation angles (the engine ALSO spins it, so
 *                           the frames just need to read clearly as a boomerang).
 *   bonk.png       96x24  — 4 frames of 24x24, a comic starburst impact that pops
 *                           bigger then fades (frame 0 small -> frame 2 biggest ->
 *                           frame 3 fading). Shown when the boomerang strikes a shark.
 *
 * Chunky pixel-art, no AA / gradients — crisp square blocks like .art-ref/reference.jpg.
 *
 *   node scripts/sprites/boomerang.mjs
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { PixelCanvas, encodePNG, writePNG } from "./png.mjs";

// --- palette (flat blocks, hi/lo for a little chunky shading, no gradients) ---
// Muted wood/tan — readable on the dark water but LOW-contrast with the rest of
// the scene (the bright-orange version popped far too hard; pure black vanished).
const WOOD = "#c2a06a";   // muted tan face
const WOOD_HI = "#ddc596"; // soft highlight
const WOOD_D = "#8a6f44";  // mid-brown outline (not black, not neon)
const STAR = "#fff2a8";    // starburst core
const STAR_M = "#ffd23c";  // mid
const STAR_D = "#ff8a1e";  // hot edge
const STAR_R = "#ff4d1e";  // outer flare

// ---------------------------------------------------------------------------
// BOOMERANG — a thick bent V. We draw one canonical shape (a 3-px-thick V with
// a hi-light on the inner face and a dark outline on the outer) and rotate the
// design-pixel coordinates by fr*22.5deg so the four frames read as distinct
// angles. Rotation is computed at GENERATION time (deterministic) and snapped to
// the integer grid so every pixel stays a crisp block — no AA.
// ---------------------------------------------------------------------------
function drawBoomerang(cv, fr) {
  const cx = 7.5, cy = 7.5;
  // FIXED orientation across all frames — the boomerang flies flat, it does not
  // spin. (`fr` is unused; the four cells are identical.)
  void fr;
  const ang = -Math.PI / 10; // a slight, constant lean so the V reads in flight
  const cos = Math.cos(ang), sin = Math.sin(ang);

  // Stamp a design pixel after rotating its local (lx,ly) about the centre.
  const put = (lx, ly, c) => {
    const x = Math.round(cx + lx * cos - ly * sin);
    const y = Math.round(cy + lx * sin + ly * cos);
    cv.set(x, y, c);
  };

  // Local geometry: a wide V opening to the right. Two arms meet at an elbow on
  // the left. Each arm is 3 px thick. Layer order: dark outline first, then the
  // wood body, then a hi-light so later writes win on overlaps.

  // Centreline points of the two arms (elbow at the left, tips up-right/down-right).
  const armPts = [];
  for (let i = 0; i <= 6; i++) armPts.push([-6 + i, -i]);      // upper arm: elbow -> up-right
  for (let i = 1; i <= 6; i++) armPts.push([-6 + i, i]);       // lower arm: elbow -> down-right

  // 1) dark outline: a fat 3-wide stroke underneath.
  for (const [px, py] of armPts) {
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) put(px + ox, py + oy, WOOD_D);
  }
  // 2) wood body: 2-wide stroke (the visible face).
  for (const [px, py] of armPts) {
    put(px, py, WOOD);
    put(px, py - 1, WOOD);
  }
  // 3) hi-light: a single lit pixel along the inner/top edge of each arm.
  for (const [px, py] of armPts) {
    put(px, py - 1, WOOD_HI);
  }
}

// ---------------------------------------------------------------------------
// BONK — a comic starburst. Design grid 24x24, scale 1. An 8-point spiky star
// with a bright core. Grows frame 0->2 then frame 3 fades to a thinner ring of
// the hottest colour. Spokes are drawn as solid blocky lines (no AA).
// ---------------------------------------------------------------------------
function drawBonk(cv, fr) {
  const cx = 12, cy = 12;
  // outer reach of the long spokes per frame; frame 3 fades (smaller, hot only).
  const reach = [6, 10, 11, 8][fr];
  const fade = fr === 3;

  const line = (toLx, toLy, len, c) => {
    // step along a unit direction, stamping a 2x2 block (chunky spoke).
    const m = Math.hypot(toLx, toLy) || 1;
    const ux = toLx / m, uy = toLy / m;
    for (let r = 1; r <= len; r++) {
      const x = Math.round(cx + ux * r);
      const y = Math.round(cy + uy * r);
      const thin = r > len * 0.6; // taper the tip to a single pixel
      cv.set(x, y, c);
      if (!thin) {
        cv.set(x + (ux >= 0 ? 1 : -1), y, c);
        cv.set(x, y + (uy >= 0 ? 1 : -1), c);
      }
    }
  };

  // 8 spokes: 4 long (axis) + 4 short (diagonal) for a classic POW star.
  const longC = fade ? STAR_R : STAR_D;
  const shortC = fade ? STAR_D : STAR_M;
  line(0, -1, reach, longC);
  line(0, 1, reach, longC);
  line(-1, 0, reach, longC);
  line(1, 0, reach, longC);
  const sShort = Math.max(2, Math.round(reach * 0.6));
  line(-1, -1, sShort, shortC);
  line(1, -1, sShort, shortC);
  line(-1, 1, sShort, shortC);
  line(1, 1, sShort, shortC);

  // Bright blocky core (a chunky diamond), smaller + cooler on the fade frame.
  const coreR = fade ? 2 : [2, 3, 4, 0][fr];
  for (let dy = -coreR; dy <= coreR; dy++) {
    for (let dx = -coreR; dx <= coreR; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > coreR) continue;
      const edge = Math.abs(dx) + Math.abs(dy) >= coreR;
      cv.set(cx + dx, cy + dy, fade ? STAR_D : edge ? STAR_M : STAR);
    }
  }
  // white-hot centre pip (not on the fade frame, which is cooling).
  if (!fade) {
    cv.set(cx, cy, STAR);
    cv.set(cx - 1, cy, STAR);
    cv.set(cx, cy - 1, STAR);
  }
}

function buildSheet(frames, fw, fh, scale, draw) {
  const W = fw * scale * frames, H = fh * scale;
  const target = new Uint8Array(W * H * 4);
  for (let i = 0; i < frames; i++) {
    const cv = new PixelCanvas(fw, fh);
    draw(cv, i);
    cv.blitInto(target, W, i * fw * scale, 0, scale);
  }
  return encodePNG(W, H, target);
}

export function generate(assetsDir) {
  const written = [];
  // 64x16 = 4 frames of 16x16 (design 16x16, scale 1).
  written.push(writePNG(path.join(assetsDir, "boomerang.png"), buildSheet(4, 16, 16, 1, drawBoomerang)));
  // 96x24 = 4 frames of 24x24 (design 24x24, scale 1).
  written.push(writePNG(path.join(assetsDir, "bonk.png"), buildSheet(4, 24, 24, 1, drawBonk)));
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
  console.log(`Wrote ${files.length} boomerang/bonk sheets`);
}
