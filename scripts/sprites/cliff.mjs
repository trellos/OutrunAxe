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

// Three distinct climber tier shades. Each tier: body, dark (shadow side),
// and a lighter "lit" highlight for top/left readability.
const TIER = {
  strong: { body: "#3df0a0", dark: "#1c9c63", lit: "#8effc9" }, // green
  medium: { body: "#3da0f0", dark: "#1c6bb0", lit: "#9fd0ff" }, // blue
  weak: { body: "#b06bf0", dark: "#7a3fb0", lit: "#d8b3ff" }, // purple
};
const GOLD = { body: "#ffd84d", dark: "#c79a16", lit: "#fff0a8" };

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
// CLIMBER  design 22x30, 6 pose rows.
//   A chunky climbing man with a near-black outline, a skin head, a coloured
//   torso (tier shade with a lit highlight + dark shadow), and 2px limbs. Body
//   silhouette stays consistent; limb angles animate per frame + per pose.
//   pose 0 hang / 1 shimmy / 2 climb / 3 top-idle / 4 falling / 5 water.
// ---------------------------------------------------------------------------
function drawClimber(cv, frame, pose, pal) {
  const cx = 11; // centre column

  // ---- a small outlined limb helper (2px-ish with a black edge) ----
  const arm = (x, y, w, h) => {
    blk(cv, x, y, w, h, pal.dark);
    blk(cv, x, y, 1, h, OUTLINE); // crisp outer edge
  };
  const leg = (x, y, w, h) => {
    blk(cv, x, y, w, h, pal.dark);
    cv.set(x, y + h - 1, OUTLINE); // foot tip
  };

  // ---- head (skin, outlined) — drawn for every pose except deep water ----
  function head(hx, hy) {
    blk(cv, hx, hy, 4, 4, SKIN);
    blk(cv, hx + 3, hy, 1, 4, SKIN_D); // shaded side
    // outline ring
    cv.set(hx, hy, OUTLINE);
    cv.set(hx + 3, hy, OUTLINE);
    cv.set(hx, hy + 3, OUTLINE);
    cv.set(hx + 3, hy + 3, OUTLINE);
    // hair cap
    blk(cv, hx, hy - 1, 4, 1, OUTLINE);
  }

  // ---- torso (tier-coloured, lit + shadow + outline) ----
  function torso(ty, h) {
    blk(cv, cx - 3, ty, 6, h, pal.body);
    blk(cv, cx - 3, ty, 1, h, pal.lit); // lit left edge
    blk(cv, cx + 2, ty, 1, h, pal.dark); // shadow right edge
    // outline the torso block
    blk(cv, cx - 4, ty, 1, h, OUTLINE);
    blk(cv, cx + 3, ty, 1, h, OUTLINE);
    cv.set(cx - 3, ty + h - 1, OUTLINE);
    cv.set(cx + 2, ty + h - 1, OUTLINE);
    // a belt accent
    blk(cv, cx - 3, ty + h - 2, 6, 1, pal.dark);
  }

  const wig = [0, 1, 2, 1][frame]; // limb travel across the 4 frames

  if (pose === 0) {
    // HANG: dead-hang by both hands overhead, legs dangling. Subtle sway.
    const sway = [-1, 0, 1, 0][frame];
    head(cx - 2 + sway, 6);
    torso(10, 10); // torso top at y=10
    // overhead arms straight up to handholds
    arm(cx - 4 + sway, 1, 2, 8);
    arm(cx + 2 + sway, 1, 2, 8);
    // dangling legs (slightly parted, swaying)
    leg(cx - 2 + sway, 20, 2, 8);
    leg(cx + 1 + sway, 20, 2, 7);
    // hand-hold knobs
    cv.set(cx - 4 + sway, 0, OUTLINE);
    cv.set(cx + 3 + sway, 0, OUTLINE);
  } else if (pose === 1) {
    // SHIMMY: arms out sideways, mid side-step toward a cliff edge.
    head(cx - 2, 5);
  } else if (pose === 2) {
    // CLIMB: alternating reach-up handholds / footholds hauling up.
    head(cx - 2, 5);
  } else if (pose === 3) {
    // TOP-IDLE: safe on top — alternating flex / jumping-jacks / sky-gaze.
    head(cx - 2, 4);
  } else if (pose === 4) {
    // FALLING: limbs splayed, tumbling.
    head(cx - 2, 8);
  } else {
    // WATER: only head + arms above a wavy waterline, swimming. SAFE.
    head(cx - 2, 6);
  }

  // The poses 1..5 share the same torso anchor; draw it + their limbs here so
  // the silhouette reads consistently. (Pose 0 handled fully above.)
  if (pose === 1) {
    torso(8, 9);
    // arms reaching sideways toward the edge (lead arm extends by frame)
    arm(cx - 6 - (frame % 2), 9, 3, 2);
    arm(cx + 3, 9, 3 + (frame % 2), 2);
    // side-stepping legs
    leg(cx - 2, 18, 2, 7 + (frame % 2));
    leg(cx + 1, 18, 2, 7 - (frame % 2));
  } else if (pose === 2) {
    torso(8, 9);
    // alternating climbing limbs: one arm high, one mid; legs stagger
    const up = frame % 2;
    arm(cx - 5, 2 + up * 2, 2, 6); // left arm reaching up
    arm(cx + 3, 4 - up * 2, 2, 6); // right arm (opposite)
    leg(cx - 2, 18, 2, 6 + up); // left foothold
    leg(cx + 1, 18, 2, 7 - up); // right foothold
    // a knee bend cue
    cv.set(cx - 2, 17 + up, OUTLINE);
  } else if (pose === 3) {
    torso(7, 9);
    if (frame === 0 || frame === 2) {
      // flexing biceps: arms up + bent to the head
      arm(cx - 6, 3, 2, 3);
      blk(cv, cx - 6, 6, 3, 2, pal.dark);
      arm(cx + 4, 3, 2, 3);
      blk(cv, cx + 3, 6, 3, 2, pal.dark);
    } else {
      // jumping-jacks: arms flung up-out, legs apart
      arm(cx - 7, 2, 2, 5);
      arm(cx + 5, 2, 2, 5);
    }
    const spread = (frame % 2) + 1;
    leg(cx - 2 - spread, 16, 2, 9);
    leg(cx + 1 + spread, 16, 2, 9);
  } else if (pose === 4) {
    torso(11, 8);
    // splayed limbs, rotated tumble feel
    arm(cx - 7, 9 + wig, 3, 2);
    arm(cx + 4, 9 - wig, 3, 2);
    leg(cx - 5, 19, 3, 2 + wig);
    leg(cx + 2, 19, 3, 2 - wig);
    // a couple of motion specks
    cv.set(cx - 8, 6, pal.lit);
    cv.set(cx + 8, 14, pal.lit);
  } else if (pose === 5) {
    // swimmer: head + shoulders above water, arms sculling, body submerged.
    torso(10, 4); // only upper torso shows above the line
    arm(cx - 6, 11 + wig, 3, 2); // sculling arms
    arm(cx + 3, 11 - wig, 3, 2);
    // wavy waterline cutting across the chest
    waterline(cv, 22, 14, WATER.dark);
    waterline(cv, 22, 15, WATER.mid);
  }
}

// ---------------------------------------------------------------------------
// GOLD finale diver  design 22x30, 3 pose rows.
//   0 line-dance (rhythmic side-to-side bop at the top), 1 swan-dive (arcing
//   dive, arms spread -> streamlined), 2 surface-swim (gleaming gold swimmer).
//   Gold body + sparkle accents so it reads as "gleaming, trailing gold".
// ---------------------------------------------------------------------------
function drawGold(cv, frame, pose) {
  const pal = GOLD;
  const cx = 11;
  const arm = (x, y, w, h) => {
    blk(cv, x, y, w, h, pal.dark);
    blk(cv, x, y, 1, h, OUTLINE);
  };
  const head = (hx, hy) => {
    blk(cv, hx, hy, 4, 4, SKIN);
    blk(cv, hx + 3, hy, 1, 4, SKIN_D);
    cv.set(hx, hy, OUTLINE);
    cv.set(hx + 3, hy, OUTLINE);
    blk(cv, hx, hy - 1, 4, 1, pal.dark); // gold hair cap
  };
  const torso = (ty, h) => {
    blk(cv, cx - 3, ty, 6, h, pal.body);
    blk(cv, cx - 3, ty, 1, h, pal.lit);
    blk(cv, cx + 2, ty, 1, h, pal.dark);
    blk(cv, cx - 4, ty, 1, h, OUTLINE);
    blk(cv, cx + 3, ty, 1, h, OUTLINE);
  };
  // sparkle specks (deterministic) so it gleams
  const sparkle = (x, y) => {
    cv.set(x, y, pal.lit);
    cv.set(x, y - 1, pal.body);
    cv.set(x, y + 1, pal.body);
    cv.set(x - 1, y, pal.body);
    cv.set(x + 1, y, pal.body);
  };

  if (pose === 0) {
    // LINE-DANCE: a side-to-side bop. Shift the whole figure + kick a leg out.
    const bop = [-1, 1, -1, 1][frame];
    head(cx - 2 + bop, 4);
    torso(8, 9);
    // arms swinging with the bop
    arm(cx - 6 + bop, 8, 3, 2);
    arm(cx + 3 + bop, 8, 3, 2);
    // dancing legs: one plants, one kicks out toward the bop direction
    leg2(cv, cx - 2, 17, 2, 8, pal);
    leg2(cv, cx + 1 + bop * 2, 17, 2, 7, pal);
    sparkle(cx + 7, 3);
    sparkle(cx - 7, 11);
  } else if (pose === 1) {
    // SWAN-DIVE: an arcing dive. frame 0-1 arms spread (swan), 2-3 streamlined.
    const spread = frame < 2;
    head(cx, 2);
    // a diagonal, streamlined torso
    blk(cv, cx - 2, 6, 5, 8, pal.body);
    blk(cv, cx - 2, 6, 1, 8, pal.lit);
    blk(cv, cx + 2, 6, 1, 8, pal.dark);
    blk(cv, cx - 3, 6, 1, 8, OUTLINE);
    blk(cv, cx + 3, 6, 1, 8, OUTLINE);
    if (spread) {
      // arms wide like wings
      arm(cx - 7, 6, 4, 2);
      arm(cx + 4, 6, 4, 2);
    } else {
      // arms streamlined overhead
      arm(cx - 1, 0, 2, 4);
      arm(cx + 1, 0, 2, 4);
    }
    // legs together, pointed
    blk(cv, cx - 1, 14, 2, 8, pal.dark);
    blk(cv, cx + 1, 14, 2, 8, pal.dark);
    cv.set(cx, 22, OUTLINE);
    // a gold motion trail
    sparkle(cx + 6, 16);
    sparkle(cx - 5, 4);
  } else {
    // SURFACE-SWIM: head + arms above a wavy waterline, gleaming, trailing gold.
    head(cx - 2, 6);
    torso(10, 4);
    arm(cx - 6, 11 + (frame % 2), 3, 2);
    arm(cx + 3, 11 - (frame % 2), 3, 2);
    waterline(cv, 22, 14, WATERG.dark);
    waterline(cv, 22, 15, WATERG.mid);
    // gold gleam trail behind the swimmer
    sparkle(cx + 7, 9);
    cv.set(cx + 9, 12, pal.lit);
    cv.set(cx - 8, 11, pal.lit);
  }
}
// a small leg helper for the gold dancer
function leg2(cv, x, y, w, h, pal) {
  blk(cv, x, y, w, h, pal.dark);
  cv.set(x, y + h - 1, OUTLINE);
}

// ---------------------------------------------------------------------------
// DOLPHIN  design 40x24, 3 frames: 0 jump-arc / 1 spit / 2 dive-cancel.
//   Side profile facing LEFT (engine flips for rightward travel). Torpedo body,
//   dark back, mid flank, pale belly, dorsal + forked tail, eye. shark.mjs feel.
// ---------------------------------------------------------------------------
function drawDolphin(cv, fr, pal) {
  const cy = 12;
  // body half-height profile: pointed snout (left), fat mid, slim tail base.
  const half = (x) => {
    let h;
    if (x <= 16) h = 2 + (x - 4) * 0.42; // grow from snout
    else h = 7 - (x - 16) * 0.26; // taper to tail
    return Math.max(2, Math.min(7, Math.round(h)));
  };
  for (let x = 4; x <= 32; x++) {
    const h = half(x);
    blk(cv, x, cy - h, 1, h, pal.dark); // back (dark)
    blk(cv, x, cy, 1, h, pal.body); // flank (mid)
    cv.set(x, cy - h, OUTLINE); // crisp top
    cv.set(x, cy + h - 1, pal.belly); // pale underside
  }
  // a light "lit" band along the upper flank
  for (let x = 10; x <= 26; x++) cv.set(x, cy - 1, pal.lit);
  // snout (left), slightly upturned for the leap
  cv.set(3, cy, pal.dark);
  cv.set(2, cy - 1, pal.dark);
  cv.set(1, cy - 1, OUTLINE);
  // smile line
  cv.set(4, cy + 1, pal.belly);
  cv.set(5, cy + 1, pal.belly);
  // dorsal fin (clear triangle on the back)
  blk(cv, 18, cy - 9, 5, 1, pal.dark);
  blk(cv, 19, cy - 10, 3, 1, pal.dark);
  cv.set(20, cy - 11, OUTLINE);
  // pectoral fin angling down-forward
  blk(cv, 12, cy + 4, 1, 2, pal.dark);
  blk(cv, 11, cy + 5, 2, 1, pal.dark);
  // forked tail (right): upper + lower lobe
  blk(cv, 32, cy - 1, 2, 2, pal.dark); // peduncle
  blk(cv, 34, cy - 5, 3, 4, pal.dark); // upper lobe
  cv.set(36, cy - 6, OUTLINE);
  blk(cv, 34, cy + 1, 3, 4, pal.dark); // lower lobe
  cv.set(36, cy + 4, OUTLINE);
  // eye
  cv.set(7, cy - 1, OUTLINE);

  if (fr === 1) {
    // SPIT: a water jet shooting from the snout (shown the instant it spits).
    cv.set(2, cy, WATER.mid);
    cv.set(1, cy - 1, WATER.hot);
    cv.set(0, cy, WATER.mid);
    cv.set(0, cy - 2, WATER.hot);
    cv.set(2, cy - 2, WATER.mid);
  } else if (fr === 2) {
    // DIVE-CANCEL: nose-down plunge — add a downward splash hint under the snout.
    cv.set(2, cy + 2, WATER.mid);
    cv.set(1, cy + 3, WATER.dark);
    cv.set(3, cy + 3, WATER.mid);
    // tuck the tail up to read as "plunging"
    cv.set(36, cy - 6, pal.dark);
  }
}

// ---------------------------------------------------------------------------
// MERMAID  design 40x24, 3 frames — high-intensity sprite swap for dolphin.
//   Same footprint/frames; glam 80s-neon mermaid facing LEFT: human top with
//   flowing hair, a fish tail at the right. spit = water from a hand.
// ---------------------------------------------------------------------------
function drawMermaid(cv, fr, pal) {
  const cy = 12;
  // ---- fish tail (right half) — torpedo that ends in a fluke ----
  const half = (x) => {
    let h;
    if (x <= 20) h = 3 + (x - 14) * 0.5;
    else h = 6 - (x - 20) * 0.3;
    return Math.max(2, Math.min(6, Math.round(h)));
  };
  for (let x = 14; x <= 30; x++) {
    const h = half(x);
    blk(cv, x, cy - h, 1, h, pal.tail);
    blk(cv, x, cy, 1, h, pal.tailD);
    cv.set(x, cy - h, OUTLINE);
    cv.set(x, cy + h - 1, OUTLINE);
  }
  // scales sparkle along the tail
  for (let x = 16; x <= 28; x += 3) cv.set(x, cy, pal.belly);
  // tail fluke (right)
  blk(cv, 30, cy - 5, 4, 4, pal.tail);
  blk(cv, 30, cy + 1, 4, 4, pal.tail);
  cv.set(33, cy - 6, OUTLINE);
  cv.set(33, cy + 4, OUTLINE);

  // ---- human upper body (left), facing LEFT ----
  // torso (pink)
  blk(cv, 9, cy - 4, 6, 7, pal.body);
  blk(cv, 9, cy - 4, 1, 7, pal.lit);
  blk(cv, 8, cy - 4, 1, 7, OUTLINE);
  cv.set(14, cy + 2, pal.dark);
  // a shell / highlight on the chest
  cv.set(11, cy - 1, pal.belly);
  cv.set(12, cy, pal.belly);
  // head
  blk(cv, 7, cy - 9, 4, 4, SKIN);
  cv.set(7, cy - 9, OUTLINE);
  cv.set(10, cy - 9, OUTLINE);
  // flowing golden hair streaming back (to the right)
  blk(cv, 9, cy - 10, 5, 1, pal.hair);
  blk(cv, 11, cy - 9, 4, 2, pal.hair);
  blk(cv, 13, cy - 7, 3, 2, pal.hair);
  cv.set(16, cy - 6, pal.hair);
  // face eye
  cv.set(8, cy - 7, OUTLINE);
  // arm reaching forward-left
  blk(cv, 4, cy - 3, 4, 2, pal.body);
  cv.set(3, cy - 3, OUTLINE);

  if (fr === 1) {
    // SPIT: flick water from the forward hand
    cv.set(2, cy - 3, WATER.hot);
    cv.set(1, cy - 4, WATER.mid);
    cv.set(2, cy - 5, WATER.hot);
    cv.set(0, cy - 3, WATER.mid);
  } else if (fr === 2) {
    // DIVE-CANCEL: dive back under — drop the head/arm, splash below
    cv.set(2, cy + 1, WATER.mid);
    cv.set(1, cy + 2, WATER.dark);
    cv.set(3, cy + 2, WATER.mid);
    cv.set(33, cy - 7, pal.tail); // fluke flicks up
  }
}

// ---------------------------------------------------------------------------
// LOBSTER  design 18x14, 2 frames (skitter cycle).
//   Top-ish view, bright red-orange, two big claws, segmented tail, little legs.
// ---------------------------------------------------------------------------
function drawLobster(cv, fr, pal) {
  const cy = 7;
  // carapace / body
  blk(cv, 6, cy - 2, 6, 5, pal.body);
  blk(cv, 6, cy - 2, 6, 1, pal.lit); // lit top
  blk(cv, 6, cy + 2, 6, 1, pal.dark); // shadow bottom
  blk(cv, 5, cy - 2, 1, 5, OUTLINE);
  blk(cv, 12, cy - 2, 1, 5, OUTLINE);
  // segmented tail (right), curling
  blk(cv, 12, cy - 1, 3, 3, pal.body);
  cv.set(12, cy, pal.dark);
  cv.set(14, cy - 1, pal.dark);
  blk(cv, 15, cy - 1, 1, 3, pal.lit); // tail fan
  cv.set(15, cy - 2, pal.body);
  cv.set(15, cy + 2, pal.body);
  // claws (left), open/close by frame
  const c = fr === 0 ? 0 : 1;
  blk(cv, 1 + c, cy - 3, 4, 2, pal.body);
  blk(cv, 0 + c, cy - 4, 2, 2, pal.dark); // upper claw pincer
  blk(cv, 0 + c, cy + 1, 2, 2, pal.dark); // lower claw pincer
  cv.set(0 + c, cy - 4, OUTLINE);
  cv.set(0 + c, cy + 2, OUTLINE);
  // little legs alternating with the skitter frame
  for (let i = 0; i < 3; i++) {
    const off = (i + fr) % 2;
    cv.set(7 + i * 2, cy + 3 + off, pal.dark);
    cv.set(7 + i * 2, cy - 3 - off, pal.dark);
  }
  // antennae
  cv.set(4, cy - 4, pal.dark);
  cv.set(3, cy - 5, pal.dark);
  // two dark dot eyes
  cv.set(6, cy - 3, OUTLINE);
  cv.set(8, cy - 3, OUTLINE);
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
        buildSheetGrid(4, 6, 22, 30, 1, (cv, c, r) => drawClimber(cv, c, r, TIER[tier])),
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
    writePNG(path.join(assetsDir, "dolphin.png"), buildSheetGrid(3, 1, 40, 24, 1, (cv, c) => drawDolphin(cv, c, DOLPHIN))),
  );
  written.push(
    writePNG(path.join(assetsDir, "mermaid.png"), buildSheetGrid(3, 1, 40, 24, 1, (cv, c) => drawMermaid(cv, c, MERMAID))),
  );
  // lobster: 2 frames, 18x14.
  written.push(
    writePNG(path.join(assetsDir, "lobster.png"), buildSheetGrid(2, 1, 18, 14, 1, (cv, c) => drawLobster(cv, c, LOBSTER))),
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
