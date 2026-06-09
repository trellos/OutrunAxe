#!/usr/bin/env node
/**
 * Shark spritesheets + the blood splash, for Battle mode.
 *
 *   shark-down.png  160x60  — 4 frames of 40x60, nose DOWN (swimming toward the
 *                             people line). Tail sways across the frames.
 *   shark-side.png  256x32  — 4 frames of 64x32, side profile facing LEFT (the
 *                             engine flips it for rightward sweeps).
 *   blood.png       288x48  — 6 frames of 48x48, a red splash growing then fading
 *                             (a shark eating a person, or a shark dying).
 *
 * Chunky pixel-art, no AA — crisp single-design-pixel blocks like the reference
 * sheet of tiny monochrome figures. Every shape is built from filled rects /
 * single cells on a small logical grid, then nearest-neighbour upscaled.
 *
 *   node scripts/sprites/shark.mjs
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { PixelCanvas, encodePNG, writePNG } from "./png.mjs";

const DARK = "#26303b";   // shark back / outline (dark grey-blue)
const BODY = "#516274";   // shark mid tone
const BELLY = "#d6e6f2";  // pale underside (contrasts the bone-white dudes/water)
const EYE = "#0a0e16";
const TEETH = "#ffffff";
const BLOOD1 = "#ff4459"; // bright
const BLOOD2 = "#d11e38"; // mid
const BLOOD3 = "#8a1226"; // dark / fading

// ---------------------------------------------------------------------------
// shark, nose-DOWN (descending toward the people)   design 20x30, scale 2 -> 40x60
//   Top-down silhouette: tail at the TOP, nose at the BOTTOM. Tail sways L/R.
//   cx = 10 (centre column). Body is a vertical teardrop: narrow tail -> wide
//   midriff -> tapered nose. Pectoral fins jut out at the widest point.
// ---------------------------------------------------------------------------
function drawDown(cv, fr) {
  const sway = [-2, 0, 2, 0][fr]; // tail swings across frames
  const cx = 10;

  // --- tail fin (top), swayed sideways ---
  const tx = cx + sway;
  cv.rect(tx - 2, 0, 4, 1, DARK);     // top flukes
  cv.rect(tx - 1, 1, 2, 2, DARK);
  // tail stalk connecting the swayed fin back to the body centreline
  for (let y = 3; y < 6; y++) {
    const sx = Math.round(tx + (cx - tx) * ((y - 3) / 3));
    cv.rect(sx - 1, y, 2, 1, DARK);
  }

  // --- body: torpedo. Narrow at the tail (y=6), widest mid-upper (y=12),
  //     then a long smooth taper to the pointed nose at the bottom (y=27). ---
  function halfW(y) {
    let w;
    if (y <= 12) w = 1.5 + (y - 6) * 0.9;        // grow tail -> shoulders
    else w = 6 - (y - 12) * 0.32;                // long taper to the snout
    return Math.max(1, Math.min(6, Math.round(w)));
  }
  for (let y = 6; y <= 27; y++) {
    const w = halfW(y);
    const back = y <= 11; // shoulders/back darker
    cv.rect(cx - w, y, w * 2, 1, back ? DARK : BODY);
    cv.set(cx - w, y, DARK);       // crisp left edge
    cv.set(cx + w - 1, y, DARK);   // crisp right edge
  }

  // --- pale belly stripe down the centre ---
  cv.rect(cx - 1, 10, 3, 14, BELLY);

  // --- pectoral fins jutting out at the widest point (the shoulders) ---
  cv.rect(cx - 8, 12, 2, 2, DARK);
  cv.set(cx - 8, 14, DARK);
  cv.rect(cx + 6, 12, 2, 2, DARK);
  cv.set(cx + 7, 14, DARK);

  // --- pointed snout + a hint of a toothy grin at the very bottom ---
  cv.set(cx - 1, 28, DARK);
  cv.set(cx, 28, DARK);
  cv.set(cx - 1, 26, TEETH);
  cv.set(cx, 26, TEETH);

  // --- two dark eyes near the head ---
  cv.set(cx - 2, 23, EYE);
  cv.set(cx + 1, 23, EYE);
}

// ---------------------------------------------------------------------------
// shark, SIDE profile facing LEFT   design 32x16, scale 2 -> 64x32
//   Classic shark: pointed snout at left, fat midbody, crescent tail at right.
//   dorsal fin on top, pectoral fin below, mouth + eye at the head. Tail beats.
// ---------------------------------------------------------------------------
function drawSide(cv, fr) {
  const tail = [-2, 0, 2, 0][fr]; // tail fin beats up/down
  const cy = 9; // body centreline (lower so dorsal fin has room above)

  // body half-height profile: pointed snout (x=2), fattest ~x=13, slim tail
  // base (x=24). A torpedo, not a ball.
  function half(x) {
    let h;
    if (x <= 13) h = 1 + (x - 2) * 0.36;       // grow from snout
    else h = 4 - (x - 13) * 0.27;              // taper toward the tail base
    return Math.max(1, Math.min(4, Math.round(h)));
  }

  // --- main body ---
  for (let x = 2; x <= 24; x++) {
    const h = half(x);
    cv.rect(x, cy - h, 1, h, DARK);     // back (upper) dark
    cv.rect(x, cy, 1, h, BODY);         // flank (lower) mid
    cv.set(x, cy - h, DARK);            // crisp top outline
    cv.set(x, cy + h - 1, DARK);        // crisp bottom outline
  }

  // --- pale belly band along the underside ---
  for (let x = 5; x <= 21; x++) {
    const h = half(x);
    cv.set(x, cy + h - 1, BELLY);
    if (h >= 3) cv.set(x, cy + h - 2, BELLY);
  }

  // --- crescent caudal (tail) fin at the right, beats with frame ---
  // narrow peduncle then a forked fin: long upper lobe, short lower lobe.
  cv.rect(24, cy - 1, 1, 2, DARK);          // peduncle
  cv.rect(25, cy - 4 + tail, 2, 4, DARK);   // upper lobe (swings)
  cv.set(26, cy - 5 + tail, DARK);          // upper lobe tip
  cv.rect(25, cy + 1, 2, 3, DARK);          // lower lobe (shorter)

  // --- dorsal fin: a clear triangle rising from the back, mid-body ---
  cv.rect(11, cy - 5, 5, 1, DARK);   // base
  cv.rect(12, cy - 6, 3, 1, DARK);
  cv.rect(13, cy - 7, 1, 1, DARK);   // peak

  // --- pectoral fin angling down-back from behind the head ---
  cv.rect(8, cy + 3, 1, 1, DARK);
  cv.rect(8, cy + 4, 2, 1, DARK);
  cv.rect(9, cy + 5, 2, 1, DARK);

  // --- head: pointed snout, mouth line, gills, eye (facing LEFT) ---
  cv.set(1, cy, DARK);               // snout tip
  cv.set(2, cy - 1, DARK);
  // mouth: pale toothy line tucked just under the snout
  cv.set(2, cy + 1, TEETH);
  cv.set(3, cy + 1, TEETH);
  cv.set(4, cy + 1, TEETH);
  cv.set(5, cy + 2, TEETH);
  // gill slits
  cv.set(8, cy - 1, "#1b232c");
  cv.set(8, cy, "#1b232c");
  // eye
  cv.set(4, cy - 1, EYE);
}

// ---------------------------------------------------------------------------
// blood splash   design 24x24, scale 2 -> 48x48, 6 frames
//   frame0 small -> frame3 biggest -> frame5 fading. A chunky blobby disc with
//   radiating droplets, all deterministic (derived from frame + angle index).
// ---------------------------------------------------------------------------
function drawBlood(cv, fr) {
  const cx = 12, cy = 12;
  const core = [2, 4, 6, 7, 5, 3][fr];     // central blob half-size
  const reach = [3, 6, 9, 11, 10, 8][fr];  // droplet reach
  const col = [BLOOD1, BLOOD1, BLOOD2, BLOOD2, BLOOD3, BLOOD3][fr];
  const hot = [BLOOD1, BLOOD1, BLOOD1, BLOOD1, BLOOD2, BLOOD2][fr]; // bright centre

  // --- blobby central disc (octagon-ish: trim the corners) ---
  for (let dy = -core; dy <= core; dy++) {
    for (let dx = -core; dx <= core; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > core + Math.floor(core / 2)) continue;
      cv.set(cx + dx, cy + dy, col);
    }
  }
  // bright hot core
  const hc = Math.max(1, core - 2);
  cv.rect(cx - hc, cy - hc, hc * 2, hc * 2, hot);

  // --- radiating droplets at 8 angles, length jittered deterministically ---
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2 + 0.2;
    const rr = reach * (0.7 + ((a * 53) % 7) / 20);
    const x = Math.round(cx + Math.cos(ang) * rr);
    const y = Math.round(cy + Math.sin(ang) * rr);
    cv.set(x, y, col);
    // a small 2px streak pointing outward, on the bigger frames
    if (fr >= 1) {
      const mx = Math.round(cx + Math.cos(ang) * rr * 0.7);
      const my = Math.round(cy + Math.sin(ang) * rr * 0.7);
      cv.set(mx, my, col);
    }
    // a couple of tiny far specks on the peak frames
    if (fr >= 2 && fr <= 4 && a % 2 === 0) {
      const fx = Math.round(cx + Math.cos(ang) * (rr + 2));
      const fy = Math.round(cy + Math.sin(ang) * (rr + 2));
      cv.set(fx, fy, col);
    }
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
  written.push(writePNG(path.join(assetsDir, "shark-down.png"), buildSheet(4, 20, 30, 2, drawDown)));
  written.push(writePNG(path.join(assetsDir, "shark-side.png"), buildSheet(4, 32, 16, 2, drawSide)));
  written.push(writePNG(path.join(assetsDir, "blood.png"), buildSheet(6, 24, 24, 2, drawBlood)));
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
  console.log(`Wrote ${files.length} shark/blood sheets`);
}
