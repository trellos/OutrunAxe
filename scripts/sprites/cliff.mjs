#!/usr/bin/env node
/**
 * Cliff Dive spritesheets — REAL chunky pixel-art (no longer placeholders).
 *
 * Same pipeline as shark.mjs / battle-dude.mjs: every shape is built from filled
 * rects / single cells on a small logical design grid, then nearest-neighbour
 * upscaled by an integer factor so each design pixel is one clean block. Strictly
 * 1-bit-ish: hard square pixels, a near-black outline, flat fills, ZERO
 * anti-aliasing, ZERO gradients. Style reference: .art-ref/reference.jpg (the
 * chunky monochrome climbing figures) and the existing battle dudes / sharks.
 *
 * Sheets (columns = animation frames, rows = poses) — dimensions/ids are LOCKED
 * by the runtime (Climber/Dolphin/Lobster/Orb read fixed cell strides):
 *   climber-strong.png / climber-medium.png / climber-weak.png
 *       88x180 — 4 frames of 22x30, 6 pose rows:
 *       0 hang / 1 shimmy / 2 climb / 3 top-idle / 4 falling / 5 water.
 *       Three DISTINCT body shades (strong=green, medium=blue, weak=purple).
 *   climber-gold.png   88x90 — 4 frames x 3 rows:
 *       0 line-dance / 1 swan-dive / 2 surface-swim. Gleaming gold finale diver.
 *   dolphin.png  120x24 — 3 frames of 40x24: jump-arc / spit / dive-cancel.
 *   mermaid.png  120x24 — same layout, pink — high-intensity dolphin swap.
 *   lobster.png  36x14  — 2 frames of 18x14: skitter.
 *   orb.png      42x14  — 3 frames of 14x14: pulse / fly / consume.
 *   splash.png   384x64 — 6 frames of 64x64 (design 32x32 scale 2): grow->fade.
 *   splash-gold.png same, gold — finale diver surfacing.
 *
 *   node scripts/sprites/cliff.mjs
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { PixelCanvas, encodePNG, writePNG } from "./png.mjs";

const OUTLINE = "#10131c"; // near-black crisp outline (matches catalog)
const SKIN = "#f0c9a0"; // climber head
const SKIN_D = "#c79870"; // skin shadow side

// Three DISTINCT light tier shades. The men are thin WHITE-ish pixel STICK
// FIGURES (match .art-ref/reference.jpg) — a single light colour per tier so
// they read on the dark ocean. Shade encodes HP.
const TIER = {
  strong: "#ffffff", // bright white = STRONG (3hp)
  medium: "#7fd8ff", // cyan       = MEDIUM (2hp)
  weak: "#c79bff", // violet     = WEAK   (1hp)
};
const GOLD_C = "#ffd84d"; // gleaming gold finale diver

const DOLPHIN = { body: "#1f93c4", dark: "#10597a", belly: "#cfeefc", lit: "#5cc3ec" };
const MERMAID = { body: "#ff66cc", dark: "#b3247f", belly: "#ffd9f0", lit: "#ffa6e0", hair: "#ffd24d", tail: "#41e0c8", tailD: "#1f9c8c" };
const LOBSTER = { body: "#ff5630", dark: "#b3300f", lit: "#ff9070" };
const ORB = { hot: "#eafff0", mid: "#52ffa8", glow: "#1f8f5e" };
const WATER = { hot: "#ffffff", mid: "#bfe9ff", dark: "#5ab6ff" };
const WATERG = { hot: "#ffffff", mid: "#ffe98a", dark: "#ffb24d" };

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
/** Filled rect of one colour. */
function blk(cv, x, y, w, h, c) {
  cv.rect(x, y, w, h, c);
}
/** A small wavy waterline across the cell at row y. */
function waterline(cv, w, y, c) {
  for (let x = 0; x < w; x++) cv.set(x, y + ((Math.floor(x / 2) % 2)), c);
}

// ---------------------------------------------------------------------------
// CLIMBER  design 22x30, 9 pose rows.
//   A MUSCULAR strongman in the style of .art-ref/reference.jpg: a small head,
//   BROAD 9-wide shoulders, big 2px arms with bicep bulges, a strong V-taper to a
//   narrow 3-wide waist, wide stance. Single tier colour (white/cyan/violet).
//   pose 0 hang / 1 shimmy / 2 climb / 3 top-idle(relaxed) / 4 falling / 5 water
//   / 6 flex(occasional) / 7 walk(stroll) / 8 pat(buddy butt-pat).
// ---------------------------------------------------------------------------
function drawClimber(cv, frame, pose, C) {
  const cx = 11; // centre column

  // 1px Bresenham limb.
  const line = (x0, y0, x1, y1) => {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      cv.set(x0, y0, C);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  };
  // 2px BEEFY limb (a muscle arm/leg).
  const arm = (x0, y0, x1, y1) => { line(x0, y0, x1, y1); line(x0 + 1, y0, x1 + 1, y1); };
  const head = () => blk(cv, cx - 1, 2, 3, 2, C); // small head
  // Strong V-taper: BROAD 9-wide shoulders/delts down to a narrow 3-wide waist.
  const shoulders = (y) => blk(cv, cx - 4, y, 9, 2, C);
  const torso = () => {
    head();
    shoulders(5); // broad delts
    blk(cv, cx - 2, 7, 5, 2, C); // chest
    blk(cv, cx - 1, 9, 3, 3, C); // narrow waist (y9-11)
  };
  // Strong wide-stance legs from the hips.
  const stance = (spread) => {
    arm(cx - 1, 11, cx - 1 - spread, 24); // left leg
    arm(cx + 1, 11, cx + 1 + spread, 24); // right leg
  };

  if (pose === 0) {
    // HANG: both big arms straight up to grips, body hangs, legs together.
    const sway = [-1, 0, 1, 0][frame];
    torso();
    arm(cx - 4, 5, cx - 3, 1); cv.set(cx - 3, 0, C); // left arm up + grip
    arm(cx + 3, 5, cx + 2, 1); cv.set(cx + 3, 0, C); // right arm up + grip
    arm(cx - 1, 11, cx - 1 + sway, 24); arm(cx + 1, 11, cx + 1 + sway, 24);
  } else if (pose === 1) {
    // SHIMMY: still HANGING overhead; legs swing as he traverses sideways.
    const swing = [1, 2, 1, 2][frame];
    torso();
    arm(cx - 4, 5, cx - 3, 1); cv.set(cx - 3, 0, C);
    arm(cx + 3, 5, cx + 2, 1); cv.set(cx + 3, 0, C);
    arm(cx - 1, 11, cx - 1 + swing, 23); arm(cx + 1, 11, cx + 1 + swing, 23);
  } else if (pose === 2) {
    // CLIMB: hand-over-hand. Frames 0-1 LEFT power stroke, 2-3 RIGHT.
    const leftUp = frame < 2;
    torso();
    if (leftUp) {
      arm(cx - 4, 5, cx - 4, 1); cv.set(cx - 4, 0, C); // left arm reaches high + grip
      arm(cx + 3, 6, cx + 2, 10); // right arm pulling at the hip
      arm(cx + 1, 11, cx + 3, 15); arm(cx + 3, 15, cx + 2, 19); // right knee up
      arm(cx - 1, 11, cx - 2, 24); // left leg pushing down
    } else {
      arm(cx + 3, 5, cx + 3, 1); cv.set(cx + 4, 0, C);
      arm(cx - 4, 6, cx - 3, 10);
      arm(cx - 1, 11, cx - 3, 15); arm(cx - 3, 15, cx - 2, 19);
      arm(cx + 1, 11, cx + 2, 24);
    }
  } else if (pose === 3) {
    // TOP-IDLE (relaxed): mostly just standing easy — arms down, a gentle weight
    // shift, an occasional look up at the sun / hands on hips. NO flexing here;
    // the flex is a separate, OCCASIONAL action (row 6).
    torso();
    if (frame === 1) {
      arm(cx - 4, 6, cx - 4, 12); // left arm down
      arm(cx + 3, 6, cx + 4, 4); cv.set(cx + 5, 3, C); // right hand to brow, gazing up
      stance(1);
    } else if (frame === 3) {
      arm(cx - 4, 6, cx - 2, 9); arm(cx + 3, 6, cx + 1, 9); // hands on hips
      stance(1);
    } else {
      arm(cx - 4, 6, cx - 4, 12); arm(cx + 3, 6, cx + 3, 12); // easy stand, arms down
      stance(frame === 0 ? 1 : 2);
    }
  } else if (pose === 4) {
    // FALLING: splayed muscular limbs, tumbling.
    const wig = [0, 1, 2, 1][frame];
    head(); shoulders(6); blk(cv, cx - 1, 8, 3, 3, C);
    arm(cx - 4, 7, cx - 7, 4 + wig); arm(cx + 3, 7, cx + 6, 4 - wig);
    arm(cx - 1, 11, cx - 4, 21 + wig); arm(cx + 1, 11, cx + 4, 21 - wig);
  } else if (pose === 5) {
    // WATER: muscular swimmer, head + big arms above the waterline. SAFE.
    const wig = [0, 1, 0, -1][frame];
    head(); blk(cv, cx - 4, 11, 9, 2, C); // shoulders at the surface
    arm(cx - 4, 11, cx - 6, 13 + wig); arm(cx + 3, 11, cx + 6, 13 - wig);
    waterline(cv, 22, 15, WATER.dark);
    waterline(cv, 22, 16, WATER.mid);
  } else if (pose === 6) {
    // FLEX (occasional): proud double-biceps with a little pump.
    const pump = [0, 1, 0, 1][frame];
    torso();
    arm(cx - 4, 5, cx - 7, 4); arm(cx - 7, 4, cx - 5, 1 - pump); cv.set(cx - 7, 3, C);
    arm(cx + 3, 5, cx + 6, 4); arm(cx + 6, 4, cx + 4, 1 - pump); cv.set(cx + 7, 3, C);
    stance(2);
  } else if (pose === 7) {
    // WALK (stroll along the top): alternating stride, arms swinging.
    const fwd = frame % 2 === 0 ? -2 : 2;
    torso();
    arm(cx - 4, 6, cx - 5, 12);
    arm(cx + 3, 6, cx + 4, 12);
    arm(cx - 1, 11, cx - 1 + fwd, 24); // one leg forward
    arm(cx + 1, 11, cx + 1 - fwd, 24); // the other back
  } else {
    // PAT (occasional, when two strollers pass): a buddy butt-pat — one arm
    // reaches out to the side at hip height.
    torso();
    arm(cx + 3, 8, cx + 7, 10); cv.set(cx + 8, 10, C); // reaching pat hand
    arm(cx - 4, 6, cx - 4, 12); // other arm down
    stance(1);
  }
}

// ---------------------------------------------------------------------------
// GOLD finale diver  design 22x30, 3 pose rows.
//   0 line-dance (rhythmic side-to-side bop at the top), 1 swan-dive (arcing
//   dive, arms spread -> streamlined), 2 surface-swim (gleaming gold swimmer).
//   Gold body + sparkle accents so it reads as "gleaming, trailing gold".
// ---------------------------------------------------------------------------
function drawGold(cv, frame, pose) {
  const C = GOLD_C;
  const cx = 11;
  const line = (x0, y0, x1, y1) => {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      cv.set(x0, y0, C);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  };
  const arm = (x0, y0, x1, y1) => { line(x0, y0, x1, y1); line(x0 + 1, y0, x1 + 1, y1); };
  const head = () => blk(cv, cx - 1, 2, 3, 2, C);
  const torso = () => {
    head();
    blk(cv, cx - 3, 5, 7, 2, C); // broad shoulders
    blk(cv, cx - 2, 7, 5, 2, C); // chest
    blk(cv, cx - 1, 9, 3, 3, C); // waist
  };
  const sparkle = (x, y) => cv.set(x, y, "#fff0a8"); // gleam speck

  if (pose === 0) {
    // LINE-DANCE: a side-to-side bop at the top, big arms swinging, legs dancing.
    const bop = [-1, 1, -1, 1][frame];
    torso();
    arm(cx - 3, 6, cx - 5 + bop, 10); arm(cx + 2, 6, cx + 4 + bop, 10); // swinging arms
    arm(cx - 1, 11, cx - 2, 24); arm(cx + 1, 11, cx + 2 + bop * 2, 24); // dancing legs
    sparkle(cx + 6, 4); sparkle(cx - 6, 12);
  } else if (pose === 1) {
    // SWAN-DIVE: a proud swan held throughout — head up, chest arched forward,
    // big arms OUTSTRETCHED wide like wings, legs together and pointed. (The
    // diver rotates from upright to head-down as he falls; this is the arch.)
    const flu = [0, -1, 0, 1][frame]; // gentle wing flutter
    blk(cv, cx - 1, 1, 3, 2, C); // head, held up
    blk(cv, cx - 3, 4, 7, 2, C); // broad shoulders
    blk(cv, cx - 2, 6, 5, 2, C); // proud, arched chest
    blk(cv, cx - 1, 8, 3, 3, C); // waist
    arm(cx - 3, 4, cx - 8, 3 + flu); // left wing outstretched wide
    arm(cx + 2, 4, cx + 7, 3 - flu); // right wing outstretched wide
    arm(cx - 1, 11, cx - 1, 23); arm(cx + 1, 11, cx + 1, 23); // legs together, pointed
    sparkle(cx + 7, 2); sparkle(cx - 7, 13);
  } else {
    // SURFACE-SWIM: gleaming gold muscular swimmer above a wavy waterline.
    const wig = [0, 1, 0, -1][frame];
    head();
    blk(cv, cx - 3, 11, 7, 2, C); // shoulders at the surface
    arm(cx - 3, 11, cx - 5, 13 + wig); arm(cx + 2, 11, cx + 5, 13 - wig);
    waterline(cv, 22, 15, WATERG.dark);
    waterline(cv, 22, 16, WATERG.mid);
    sparkle(cx + 7, 10); sparkle(cx + 9, 12);
  }
}

// ---------------------------------------------------------------------------
// DOLPHIN  design 40x24, 3 frames: 0 jump-arc / 1 spit / 2 dive-cancel.
//   Side profile facing LEFT (engine flips for rightward travel). Reads clearly
//   as a DOLPHIN, not a fish: a pointed BEAK (rostrum), a rounded melon
//   forehead, a smooth curved back with a swept-back HOOKED dorsal fin, a sleek
//   tapering body, a pectoral fin, and forked tail flukes.
// ---------------------------------------------------------------------------
function drawDolphin(cv, fr) {
  const cy = 12;
  const BODY = "#cdeefe", OUT = "#3f8fc0", BELLY = "#ffffff", EYE = "#16374a";
  // Back (top) and belly (bottom) edges along the body, x = 2 (beak) .. 32 (tail
  // base). Beak is thin; the melon swells the forehead; the back arches then
  // tapers to the tail.
  // Sleek: a thin protruding beak, a melon forehead, then a slim tapering body.
  const top = (x) => {
    if (x <= 5) return cy - 1;                        // thin beak
    if (x <= 10) return cy - 1 - (x - 5);             // melon rises 11 -> 6
    if (x <= 22) return cy - 5;                       // slim back
    return cy - 5 + Math.round((x - 22) * 0.7);       // taper to tail
  };
  const bot = (x) => {
    if (x <= 5) return cy;                            // thin beak
    if (x <= 10) return cy + Math.round((x - 5) * 0.6);// chin/jaw
    if (x <= 22) return cy + 3;                       // slim belly
    return cy + 3 - Math.round((x - 22) * 0.6);       // taper to tail
  };
  for (let x = 2; x <= 32; x++) {
    const t = top(x), b = bot(x);
    for (let y = t; y <= b; y++) cv.set(x, y, BODY);
    cv.set(x, t, OUT);     // back outline
    cv.set(x, b, BELLY);   // pale belly
  }
  // beak tip + mouth line
  cv.set(1, cy, OUT);
  cv.set(3, cy + 1, OUT); cv.set(4, cy + 1, OUT); // mouth crease
  // tall swept-back HOOKED dorsal fin on the mid back (the dolphin giveaway)
  cv.set(14, cy - 6, OUT); cv.set(15, cy - 8, OUT); cv.set(16, cy - 10, OUT);
  cv.set(17, cy - 10, OUT); cv.set(18, cy - 9, OUT); cv.set(19, cy - 7, OUT);
  cv.set(15, cy - 6, BODY); cv.set(16, cy - 8, BODY); cv.set(16, cy - 7, BODY);
  cv.set(17, cy - 9, BODY); cv.set(17, cy - 8, BODY); cv.set(18, cy - 8, BODY);
  // pectoral fin angling down-back
  cv.set(13, cy + 3, OUT); cv.set(12, cy + 5, OUT); cv.set(14, cy + 5, OUT);
  cv.set(13, cy + 4, BODY);
  // forked tail flukes (right)
  cv.set(33, cy - 1, BODY); cv.set(33, cy, BODY); cv.set(33, cy + 1, BODY);
  cv.set(34, cy - 3, OUT); cv.set(35, cy - 4, OUT); cv.set(36, cy - 5, OUT);
  cv.set(34, cy - 2, BODY); cv.set(35, cy - 3, BODY);
  cv.set(34, cy + 3, OUT); cv.set(35, cy + 4, OUT); cv.set(36, cy + 5, OUT);
  cv.set(34, cy + 2, BODY); cv.set(35, cy + 3, BODY);
  // eye on the melon
  cv.set(6, cy - 1, EYE);

  if (fr === 1) {
    // SPIT: a water jet shooting from the beak (shown the instant it spits).
    cv.set(1, cy - 1, "#ffffff");
    cv.set(0, cy - 1, "#bfe9ff");
    cv.set(0, cy - 3, "#ffffff");
    cv.set(1, cy - 3, "#bfe9ff");
  } else if (fr === 2) {
    // DIVE-CANCEL: nose-down plunge — a downward splash hint under the beak.
    cv.set(1, cy + 2, "#bfe9ff");
    cv.set(0, cy + 3, "#9fd0ff");
    cv.set(2, cy + 3, "#bfe9ff");
  }
}

// ---------------------------------------------------------------------------
// MERMAID  design 40x24, 3 frames — high-intensity sprite swap for dolphin.
//   Same footprint/frames; glam 80s-neon mermaid facing LEFT: human top with
//   flowing hair, a fish tail at the right. spit = water from a hand.
// ---------------------------------------------------------------------------
function drawMermaid(cv, fr) {
  const cy = 12;
  const SKIN = "#ffd9b0", BODY = "#ff9ed6", OUT = "#b3247f", TAIL = "#ff7ec8",
    FIN = "#ffd9f0", HAIR = "#ffd24d", EYE = "#5a1340";
  // ---- fish tail (right half) — clean spindle ending in a fluke ----
  const half = (x) => {
    let h;
    if (x <= 20) h = 3 + (x - 14) * 0.5;
    else h = 6 - (x - 20) * 0.3;
    return Math.max(2, Math.min(6, Math.round(h)));
  };
  for (let x = 14; x <= 30; x++) {
    const h = half(x);
    for (let y = cy - h; y <= cy + h - 1; y++) cv.set(x, y, TAIL);
    cv.set(x, cy - h, OUT);
    cv.set(x, cy + h - 1, OUT);
  }
  // scales along the tail
  for (let x = 16; x <= 28; x += 3) cv.set(x, cy, FIN);
  // tail fluke (right)
  blk(cv, 30, cy - 5, 4, 4, TAIL);
  blk(cv, 30, cy + 1, 4, 4, TAIL);
  cv.set(33, cy - 6, OUT);
  cv.set(33, cy + 4, OUT);

  // ---- human upper body (left), facing LEFT ----
  blk(cv, 9, cy - 4, 6, 7, BODY);
  blk(cv, 8, cy - 4, 1, 7, OUT);
  cv.set(11, cy - 1, FIN); // chest highlight
  cv.set(12, cy, FIN);
  // head
  blk(cv, 7, cy - 9, 4, 4, SKIN);
  cv.set(7, cy - 9, OUT);
  cv.set(10, cy - 9, OUT);
  // flowing golden hair streaming back (to the right)
  blk(cv, 9, cy - 10, 5, 1, HAIR);
  blk(cv, 11, cy - 9, 4, 2, HAIR);
  blk(cv, 13, cy - 7, 3, 2, HAIR);
  cv.set(16, cy - 6, HAIR);
  cv.set(8, cy - 7, EYE); // eye
  // arm reaching forward-left
  blk(cv, 4, cy - 3, 4, 2, BODY);
  cv.set(3, cy - 3, OUT);

  if (fr === 1) {
    // SPIT: flick water from the forward hand
    cv.set(2, cy - 3, "#ffffff");
    cv.set(1, cy - 4, "#ffd9f0");
    cv.set(2, cy - 5, "#ffffff");
    cv.set(0, cy - 3, "#ffd9f0");
  } else if (fr === 2) {
    // DIVE-CANCEL: dive back under — drop the head/arm, splash below
    cv.set(2, cy + 1, "#ffd9f0");
    cv.set(1, cy + 2, "#ff7ec8");
    cv.set(3, cy + 2, "#ffd9f0");
    cv.set(33, cy - 7, TAIL); // fluke flicks up
  }
}

// ---------------------------------------------------------------------------
// LOBSTER  design 18x14, 2 frames (skitter cycle).
//   Top-ish view, bright red-orange, two big claws, segmented tail, little legs.
// ---------------------------------------------------------------------------
function drawLobster(cv, fr) {
  const cy = 7;
  const BODY = "#ff7a4d", OUT = "#a8331a", LIT = "#ffc4a0", EYE = "#2a0f08";
  // carapace / body
  blk(cv, 6, cy - 2, 6, 5, BODY);
  blk(cv, 6, cy - 2, 6, 1, LIT); // lit top
  blk(cv, 5, cy - 2, 1, 5, OUT);
  blk(cv, 12, cy - 2, 1, 5, OUT);
  cv.set(6, cy + 2, OUT);
  cv.set(11, cy + 2, OUT);
  // segmented tail (right), curling
  blk(cv, 12, cy - 1, 3, 3, BODY);
  cv.set(14, cy, LIT); // tail fan
  cv.set(15, cy - 1, OUT);
  cv.set(15, cy + 1, OUT);
  cv.set(14, cy - 2, OUT);
  cv.set(14, cy + 2, OUT);
  // claws (left), open/close by frame
  const c = fr === 0 ? 0 : 1;
  blk(cv, 1 + c, cy - 3, 4, 2, BODY);
  cv.set(0 + c, cy - 4, OUT); // upper claw pincer
  cv.set(1 + c, cy - 4, BODY);
  blk(cv, 1 + c, cy + 2, 4, 2, BODY);
  cv.set(0 + c, cy + 3, OUT); // lower claw pincer
  cv.set(1 + c, cy + 3, BODY);
  cv.set(4, cy - 1, BODY);
  cv.set(4, cy + 1, BODY);
  // little legs alternating with the skitter frame
  for (let i = 0; i < 3; i++) {
    const off = (i + fr) % 2;
    cv.set(7 + i * 2, cy + 3 + off, OUT);
    cv.set(7 + i * 2, cy - 3 - off, OUT);
  }
  // antennae
  cv.set(4, cy - 4, OUT);
  cv.set(3, cy - 5, OUT);
  // two dark dot eyes
  cv.set(7, cy - 3, EYE);
  cv.set(9, cy - 3, EYE);
}

// ---------------------------------------------------------------------------
// ORB  design 14x14, 3 frames (gentle pulse small->med->large).
//   White-hot core bleeding into a mint glow on transparent bg. Soft round disc.
// ---------------------------------------------------------------------------
function drawOrb(cv, fr, pal) {
  const cx = 7, cy = 7;
  const r = [3, 4, 5][fr];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > r * r) continue;
      let col;
      if (d2 <= 1) col = pal.hot; // white-hot core
      else if (d2 <= (r - 1) * (r - 1)) col = pal.mid; // mint body
      else col = pal.glow; // dim glow rim
      cv.set(cx + dx, cy + dy, col);
    }
  }
  // a 4-point twinkle on the larger frames
  if (fr >= 1) {
    cv.set(cx, cy - r - 1, pal.mid);
    cv.set(cx, cy + r + 1, pal.mid);
    cv.set(cx - r - 1, cy, pal.mid);
    cv.set(cx + r + 1, cy, pal.mid);
  }
  // bright specular highlight up-left
  cv.set(cx - 2, cy - 2, pal.hot);
}

// ---------------------------------------------------------------------------
// SPLASH  design 32x32, scale 2 -> 64x64, 6 frames grow->fade.
//   A water plume rising as a rough upper-half dome above the waterline, with
//   droplets flying up. blood.png pacing; blue (or gold) palette.
// ---------------------------------------------------------------------------
function drawSplash(cv, fr, pal) {
  const cx = 16, cy = 22; // waterline near the bottom
  const core = [3, 6, 9, 11, 8, 5][fr]; // central plume half-size
  const reach = [4, 8, 12, 14, 13, 10][fr]; // droplet reach
  // colour ramps hot -> mid -> dark as it expands/fades
  const fill = [pal.hot, pal.hot, pal.mid, pal.mid, pal.dark, pal.dark][fr];
  const hot = [pal.hot, pal.hot, pal.hot, pal.mid, pal.mid, pal.dark][fr];

  // rising dome above the waterline (upper half only)
  for (let dy = -core; dy <= 1; dy++) {
    for (let dx = -core; dx <= core; dx++) {
      if (dx * dx + dy * dy > core * core) continue;
      cv.set(cx + dx, cy + dy, fill);
    }
  }
  // bright hot column up the middle
  const hc = Math.max(1, core - 3);
  blk(cv, cx - hc, cy - core, hc * 2, core, hot);

  // a thin foam crest sitting on the waterline
  for (let dx = -core - 1; dx <= core + 1; dx++) cv.set(cx + dx, cy + 1, fill);

  // droplets flying UP (upper half arc), deterministic spread
  for (let a = 0; a < 7; a++) {
    const ang = -Math.PI + (a / 6) * Math.PI; // -180..0 (upper half)
    const rr = reach * (0.7 + ((a * 53) % 7) / 18);
    const x = Math.round(cx + Math.cos(ang) * rr);
    const y = Math.round(cy + Math.sin(ang) * rr);
    cv.set(x, y, fill);
    // a small streak toward the centre
    const mx = Math.round(cx + Math.cos(ang) * rr * 0.65);
    const my = Math.round(cy + Math.sin(ang) * rr * 0.65);
    cv.set(mx, my, hot);
    // far specks / sparkle on the peak frames
    if (fr >= 1 && fr <= 4 && a % 2 === 0) {
      const fx = Math.round(cx + Math.cos(ang) * (rr + 3));
      const fy = Math.round(cy + Math.sin(ang) * (rr + 3));
      cv.set(fx, fy, hot);
    }
  }
}

// ---------------------------------------------------------------------------
// sheet builder (rows x cols)
// ---------------------------------------------------------------------------
function buildSheetGrid(cols, rows, fw, fh, scale, draw) {
  const W = fw * scale * cols, H = fh * scale * rows;
  const target = new Uint8Array(W * H * 4);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cv = new PixelCanvas(fw, fh);
      draw(cv, c, r);
      cv.blitInto(target, W, c * fw * scale, r * fh * scale, scale);
    }
  }
  return encodePNG(W, H, target);
}

export function generate(assetsDir) {
  const written = [];
  // climbers: 4 frames x 6 poses, 22x30, scale 1.
  for (const tier of ["strong", "medium", "weak"]) {
    written.push(
      writePNG(
        path.join(assetsDir, `climber-${tier}.png`),
        buildSheetGrid(4, 9, 22, 30, 1, (cv, c, r) => drawClimber(cv, c, r, TIER[tier])),
      ),
    );
  }
  // gold finale diver: 4 frames x 3 rows (line-dance / swan-dive / surface-swim).
  written.push(
    writePNG(
      path.join(assetsDir, "climber-gold.png"),
      buildSheetGrid(4, 3, 22, 30, 1, (cv, c, r) => drawGold(cv, c, r)),
    ),
  );
  // dolphin + mermaid: 3 frames x 1 row, 40x24.
  written.push(
    writePNG(path.join(assetsDir, "dolphin.png"), buildSheetGrid(3, 1, 40, 24, 1, (cv, c) => drawDolphin(cv, c))),
  );
  written.push(
    writePNG(path.join(assetsDir, "mermaid.png"), buildSheetGrid(3, 1, 40, 24, 1, (cv, c) => drawMermaid(cv, c))),
  );
  // lobster: 2 frames, 18x14.
  written.push(
    writePNG(path.join(assetsDir, "lobster.png"), buildSheetGrid(2, 1, 18, 14, 1, (cv, c) => drawLobster(cv, c))),
  );
  // orb: 3 frames, 14x14.
  written.push(
    writePNG(path.join(assetsDir, "orb.png"), buildSheetGrid(3, 1, 14, 14, 1, (cv, c) => drawOrb(cv, c, ORB))),
  );
  // splash + gold splash: 6 frames, 32x32, scale 2 -> 64x64.
  written.push(
    writePNG(path.join(assetsDir, "splash.png"), buildSheetGrid(6, 1, 32, 32, 2, (cv, c) => drawSplash(cv, c, WATER))),
  );
  written.push(
    writePNG(path.join(assetsDir, "splash-gold.png"), buildSheetGrid(6, 1, 32, 32, 2, (cv, c) => drawSplash(cv, c, WATERG))),
  );
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
  console.log(`Wrote ${files.length} cliff-dive sheets`);
}
