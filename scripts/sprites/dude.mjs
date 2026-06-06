#!/usr/bin/env node
/**
 * Infinite Eddie — character ("dude") spritesheet generator.
 *
 * Produces good-looking, readable placeholder spritesheets of a little
 * front-facing character as SVG. Each sheet is a GRID:
 *   - COLUMNS = 4 animation frames (a looping cycle), index 0..3
 *   - ROWS    = 4 poses, top->bottom: idle, walk, jump, interact
 * So a sheet is (4*cell) wide by (4*cell) tall. The renderer shows ONE cell at
 * native scale via backgroundPosition `-(col*cell)px -(row*cell)px`, with the
 * element sized to a single cell — so dimensions must be exact and the figure
 * must fit inside its cell.
 *
 * Filename contract (renderer depends on it — do not deviate):
 *   ${sizeName}-${tierName}${gunVariant}.svg
 *   sizes:   big=32, medium=24, small=16  (square cells)
 *   tiers:   loose=#cfd2da, normal=#7CFF4F, perfect=#33F0FF
 *   guns:    ""  |  -gunL (viewer-left hand)  |  -gunR (viewer-right)  |  -gunLR
 *   => 3 sizes × 3 tiers × 4 gun variants = 36 files.
 *
 * Art: transparent background, a dark outline/silhouette under a bright fill in
 * the tier color, feet on a consistent baseline near the bottom of the cell,
 * head near the top, a little face for personality. Deterministic — no random
 * at generation time; all motion is a closed-form function of the frame index.
 *
 * Usage:
 *   import { generate } from "./dude.mjs"; generate(assetsDir);
 *   node scripts/sprites/dude.mjs           // writes into <repoRoot>/public/assets
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Contract tables
// ---------------------------------------------------------------------------

const SIZES = [
  { name: "big", cell: 64 },
  { name: "medium", cell: 48 },
  { name: "small", cell: 32 },
];

const TIERS = [
  { name: "loose", color: "#cfd2da" },   // dim grey-white
  { name: "normal", color: "#7CFF4F" },  // lime
  { name: "perfect", color: "#33F0FF" }, // cyan
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

// Palette
const OUTLINE = "#0c0e16";   // near-black, reads on light backgrounds
const SHADOW = "#00000033";  // soft ground shadow

// ---------------------------------------------------------------------------
// Small SVG helpers. All coords are in CELL space; a unit-scale `s` converts
// design units (defined for a 16px cell) into the actual cell pixels.
// ---------------------------------------------------------------------------

const f1 = (n) => (Math.round(n * 100) / 100).toString();

function limb(x1, y1, x2, y2, stroke, w) {
  return `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" stroke="${stroke}" stroke-width="${f1(w)}" stroke-linecap="round"/>`;
}
function circle(cx, cy, r, fill, extra = "") {
  return `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r)}" fill="${fill}"${extra ? " " + extra : ""}/>`;
}
function ellipse(cx, cy, rx, ry, fill, extra = "") {
  return `<ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="${f1(rx)}" ry="${f1(ry)}" fill="${fill}"${extra ? " " + extra : ""}/>`;
}

/**
 * Lighten/darken a #rrggbb hex by amount in [-1,1].
 */
function shade(hex, amt) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const t = amt < 0 ? 0 : 255;
  const a = Math.abs(amt);
  r = Math.round((t - r) * a + r);
  g = Math.round((t - g) * a + g);
  b = Math.round((t - b) * a + b);
  return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

// ---------------------------------------------------------------------------
// Pose model. The skeleton is defined in ABSOLUTE design units inside a 16-unit
// cell (origin = cell top-left), tuned so the whole figure fits with ~1u
// margins: head outline near the top, shoe bottoms on a fixed baseline near the
// bottom. The FEET rest on `D.footY` for every pose except the intended jump
// lift. Everything scales linearly to the real cell size.
//
// Layout (absolute Y, 16-unit cell):
//   head center  ~4.5   shoulders ~7.2   hips ~10.8   feet baseline 14.0
// hands are given relative to the shoulder line; feet relative to the hip line.
// ---------------------------------------------------------------------------

const D = {
  headR: 2.3,        // head radius
  headCy: 4.5,       // head center Y
  neckY: 7.2,        // shoulder/neck line Y
  hipY: 10.8,        // hip line Y
  footY: 14.0,       // baseline feet Y (shoe centers)
  shoulderX: 2.0,    // half shoulder width
  hipX: 1.4,         // half hip width
};
const ARM_DOWN = D.footY - D.neckY - 3.0;   // hand-at-side dy from shoulder (~3.8)
const LEG_DOWN = D.footY - D.hipY;          // foot dy from hip (~3.2)

function pose(name, fr) {
  const t = fr / FRAMES;             // 0..1 around the loop
  const swing = Math.sin(t * TAU);   // -1..1

  let lift = 0;                       // whole-body vertical lift (negative = up)
  let breath = 0;                     // tiny torso stretch
  let blink = false;
  let headTilt = 0;

  // hands relative to shoulder; feet relative to hip.
  let handL = { dx: -2.1, dy: ARM_DOWN };
  let handR = { dx: 2.1, dy: ARM_DOWN };
  let footL = { dx: -1.4, dy: LEG_DOWN };
  let footR = { dx: 1.4, dy: LEG_DOWN };
  let kneeBendL = 0, kneeBendR = 0;

  if (name === "idle") {
    breath = (1 + Math.sin(t * TAU)) * 0.12;       // gentle chest rise
    const sway = Math.sin(t * TAU) * 0.22;
    handL = { dx: -2.1 + sway, dy: ARM_DOWN - 0.1 };
    handR = { dx: 2.1 + sway, dy: ARM_DOWN - 0.1 };
    headTilt = sway * 0.5;
    blink = fr === 2;                               // blink on one frame
  } else if (name === "walk") {
    lift = -Math.abs(swing) * 0.3;                 // subtle bob
    const a = swing * 1.8;                          // arm swing amplitude
    handL = { dx: -2.4, dy: ARM_DOWN - a };
    handR = { dx: 2.4, dy: ARM_DOWN + a };
    const legSpread = 1.8;
    footL = { dx: -0.6 - swing * legSpread, dy: LEG_DOWN - Math.max(0, swing) * 1.1 };
    footR = { dx: 0.6 + swing * legSpread, dy: LEG_DOWN - Math.max(0, -swing) * 1.1 };
    kneeBendL = Math.max(0, swing) * 0.7;
    kneeBendR = Math.max(0, -swing) * 0.7;
    headTilt = swing * 0.3;
  } else if (name === "jump") {
    // 4-frame arc: crouch -> launch -> apex -> land.
    if (fr === 0) {            // crouch (hips drop, knees bend, feet stay planted)
      lift = 0.9;
      handL = { dx: -2.5, dy: ARM_DOWN - 0.7 };
      handR = { dx: 2.5, dy: ARM_DOWN - 0.7 };
      footL = { dx: -1.9, dy: LEG_DOWN - 0.9 };   // cancel lift so feet stay on baseline
      footR = { dx: 1.9, dy: LEG_DOWN - 0.9 };
      kneeBendL = 1.1; kneeBendR = 1.1;
    } else if (fr === 1) {     // launch (rising, arms swinging up)
      lift = -1.6;
      handL = { dx: -2.7, dy: -1.6 };
      handR = { dx: 2.7, dy: -1.6 };
      footL = { dx: -1.3, dy: LEG_DOWN - 0.4 };
      footR = { dx: 1.3, dy: LEG_DOWN - 0.4 };
      kneeBendL = 0.4; kneeBendR = 0.4;
    } else if (fr === 2) {     // apex / airborne, arms up, legs tucked
      lift = -1.7;
      handL = { dx: -2.7, dy: -1.8 };
      handR = { dx: 2.7, dy: -1.8 };
      footL = { dx: -1.5, dy: LEG_DOWN - 1.8 };
      footR = { dx: 1.5, dy: LEG_DOWN - 1.8 };
      kneeBendL = 1.4; kneeBendR = 1.4;
    } else {                   // land (slight crouch, arms out for balance)
      lift = 0.5;
      handL = { dx: -2.3, dy: ARM_DOWN - 0.6 };
      handR = { dx: 2.3, dy: ARM_DOWN - 0.6 };
      footL = { dx: -1.9, dy: LEG_DOWN };
      footR = { dx: 1.9, dy: LEG_DOWN };
      kneeBendL = 0.8; kneeBendR = 0.8;
    }
  } else { // interact — sociable wave / cheer with the right (viewer) arm
    const wave = Math.sin(t * TAU);
    lift = -Math.abs(Math.sin(t * TAU)) * 0.35;    // little hop of excitement
    handL = { dx: -2.2, dy: ARM_DOWN - 0.2 };      // left arm relaxed-ish
    handR = { dx: 2.0 + wave * 0.5, dy: -2.4 };    // right arm up, waving
    headTilt = wave * 0.6;
  }

  return { lift, breath, blink, headTilt, handL, handR, footL, footR, kneeBendL, kneeBendR };
}

// ---------------------------------------------------------------------------
// Gun. A short gunmetal laser pistol with a glowing muzzle, held at (hx,hy)
// and pointing outward (dir +1 = viewer-right, -1 = viewer-left), drawn ON TOP.
// ---------------------------------------------------------------------------
function drawGun(hx, hy, dir, s, perfect) {
  const bx = hx + dir * 2.6 * s;     // barrel tip (kept short so it stays in-cell)
  const by = hy - 0.9 * s;
  const gx = hx - dir * 0.7 * s;     // grip base
  const gy = hy + 1.7 * s;
  const muzzle = perfect ? "#ff8a3d" : "#ff4d4d";
  let g = "";
  // dark outline pass
  g += limb(hx, hy, bx, by, OUTLINE, 2.5 * s);
  g += limb(hx, hy, gx, gy, OUTLINE, 2.5 * s);
  // gunmetal body
  g += limb(hx, hy, bx, by, "#b9c2d0", 1.5 * s);
  g += limb(hx, hy, gx, gy, "#828c9c", 1.4 * s);
  // glow + hot muzzle tip
  g += circle(bx, by, 1.0 * s, muzzle, `opacity="0.35"`);
  g += circle(bx, by, 0.8 * s, muzzle);
  g += circle(bx, by, 0.38 * s, "#fff6e6");
  return g;
}

// ---------------------------------------------------------------------------
// Figure. Draws a single character centered in the cell at (ox,oy) of size
// `cell`, for the given pose/frame, in `color` (tier accent). `quality` is the
// tier name so we can add crisp/sparkle vs dim/rough touches.
// ---------------------------------------------------------------------------
function drawFigure(ox, oy, cell, color, quality, name, fr, guns) {
  const s = cell / 16;                       // design-unit -> px
  const cx = ox + cell / 2;                  // horizontal center of the cell
  // Map a design-Y (0..16, cell top-left origin) to an absolute px Y.
  const Y = (dy) => oy + dy * s;
  const p = pose(name, fr);

  const isPerfect = quality === "perfect";
  const isLoose = quality === "loose";

  // tier-flavored body fills
  const bodyFill = isLoose ? shade(color, -0.06) : color;
  const bodyLight = shade(bodyFill, isPerfect ? 0.45 : 0.3);  // highlight
  const bodyDark = shade(bodyFill, -0.4);                     // shaded side
  const skin = "#f1c79a";

  const lift = p.lift;                        // design-unit vertical offset

  // Key skeleton points (px), placed by absolute design-Y + lift.
  const neckY = Y(D.neckY + lift);
  const hipY = Y(D.hipY + lift - p.breath);
  const headCx = cx + p.headTilt * s;
  const headCy = Y(D.headCy + lift);
  const headR = D.headR * s;

  const shL = { x: cx - D.shoulderX * s, y: neckY };
  const shR = { x: cx + D.shoulderX * s, y: neckY };
  const hipL = { x: cx - D.hipX * s, y: hipY };
  const hipR = { x: cx + D.hipX * s, y: hipY };

  const handL = { x: shL.x + p.handL.dx * s, y: shL.y + p.handL.dy * s };
  const handR = { x: shR.x + p.handR.dx * s, y: shR.y + p.handR.dy * s };
  const footL = { x: hipL.x + p.footL.dx * s, y: hipL.y + p.footL.dy * s };
  const footR = { x: hipR.x + p.footR.dx * s, y: hipR.y + p.footR.dy * s };

  // Knees: midpoint hip->foot, pushed slightly outward for a bent look.
  const kneeL = {
    x: (hipL.x + footL.x) / 2 - p.kneeBendL * 1.2 * s,
    y: (hipL.y + footL.y) / 2,
  };
  const kneeR = {
    x: (hipR.x + footR.x) / 2 + p.kneeBendR * 1.2 * s,
    y: (hipR.y + footR.y) / 2,
  };
  // Elbows: midpoint shoulder->hand, slight outward bow.
  const elbL = { x: (shL.x + handL.x) / 2 - 0.6 * s, y: (shL.y + handL.y) / 2 };
  const elbR = { x: (shR.x + handR.x) / 2 + 0.6 * s, y: (shR.y + handR.y) / 2 };

  const limbW = 2.0 * s;       // bright limb width
  const limbOut = limbW + 1.5 * s;  // outline width
  const torsoW = 4.6 * s;      // torso half handled via rounded rect-ish body

  let svg = "<g>";

  // --- soft ground shadow (stays on the ground baseline; shrinks as the
  // figure lifts off during a jump) ---
  const shadowY = Y(D.footY + 1.0);
  const shadowSquash = name === "jump" ? Math.max(0.35, 1 + p.lift * 0.18) : 1;
  svg += ellipse(cx, shadowY, 3.2 * s * shadowSquash, 0.85 * s * shadowSquash, SHADOW);

  // --- OUTLINE PASS (draw fat dark shapes first) ---
  // legs
  svg += limb(hipL.x, hipL.y, kneeL.x, kneeL.y, OUTLINE, limbOut);
  svg += limb(kneeL.x, kneeL.y, footL.x, footL.y, OUTLINE, limbOut);
  svg += limb(hipR.x, hipR.y, kneeR.x, kneeR.y, OUTLINE, limbOut);
  svg += limb(kneeR.x, kneeR.y, footR.x, footR.y, OUTLINE, limbOut);
  // feet (little shoes)
  svg += ellipse(footL.x - 0.3 * s, footL.y + 0.3 * s, 1.9 * s, 1.2 * s, OUTLINE);
  svg += ellipse(footR.x + 0.3 * s, footR.y + 0.3 * s, 1.9 * s, 1.2 * s, OUTLINE);
  // arms
  svg += limb(shL.x, shL.y, elbL.x, elbL.y, OUTLINE, limbOut);
  svg += limb(elbL.x, elbL.y, handL.x, handL.y, OUTLINE, limbOut);
  svg += limb(shR.x, shR.y, elbR.x, elbR.y, OUTLINE, limbOut);
  svg += limb(elbR.x, elbR.y, handR.x, handR.y, OUTLINE, limbOut);
  // torso (rounded body) outline
  const bodyTopY = neckY - 0.2 * s;
  const bodyH = hipY - bodyTopY + 1.2 * s;
  svg += `<rect x="${f1(cx - torsoW / 2 - 0.9 * s)}" y="${f1(bodyTopY - 0.9 * s)}" width="${f1(torsoW + 1.8 * s)}" height="${f1(bodyH + 1.8 * s)}" rx="${f1(2.4 * s)}" fill="${OUTLINE}"/>`;
  // head outline
  svg += circle(headCx, headCy, headR + 1.0 * s, OUTLINE);

  // --- BODY PASS (bright tier color over the outline) ---
  // legs (slightly darker than torso to separate)
  svg += limb(hipL.x, hipL.y, kneeL.x, kneeL.y, bodyDark, limbW);
  svg += limb(kneeL.x, kneeL.y, footL.x, footL.y, bodyDark, limbW);
  svg += limb(hipR.x, hipR.y, kneeR.x, kneeR.y, bodyDark, limbW);
  svg += limb(kneeR.x, kneeR.y, footR.x, footR.y, bodyDark, limbW);
  // shoes
  svg += ellipse(footL.x - 0.3 * s, footL.y + 0.3 * s, 1.4 * s, 0.8 * s, shade(color, -0.55));
  svg += ellipse(footR.x + 0.3 * s, footR.y + 0.3 * s, 1.4 * s, 0.8 * s, shade(color, -0.55));
  // arms
  svg += limb(shL.x, shL.y, elbL.x, elbL.y, bodyFill, limbW);
  svg += limb(elbL.x, elbL.y, handL.x, handL.y, bodyFill, limbW);
  svg += limb(shR.x, shR.y, elbR.x, elbR.y, bodyFill, limbW);
  svg += limb(elbR.x, elbR.y, handR.x, handR.y, bodyFill, limbW);
  // hands
  svg += circle(handL.x, handL.y, 1.15 * s, skin);
  svg += circle(handR.x, handR.y, 1.15 * s, skin);
  // torso
  svg += `<rect x="${f1(cx - torsoW / 2)}" y="${f1(bodyTopY)}" width="${f1(torsoW)}" height="${f1(bodyH)}" rx="${f1(2.0 * s)}" fill="${bodyFill}"/>`;
  // torso highlight (left third) + shaded right edge for volume
  svg += `<rect x="${f1(cx - torsoW / 2 + 0.4 * s)}" y="${f1(bodyTopY + 0.5 * s)}" width="${f1(torsoW * 0.32)}" height="${f1(bodyH - 1.2 * s)}" rx="${f1(1.2 * s)}" fill="${bodyLight}" opacity="0.7"/>`;
  svg += `<rect x="${f1(cx + torsoW / 2 - 1.0 * s)}" y="${f1(bodyTopY + 0.5 * s)}" width="${f1(0.9 * s)}" height="${f1(bodyH - 1.0 * s)}" rx="${f1(0.6 * s)}" fill="${bodyDark}" opacity="0.6"/>`;
  // little chest emblem dot for character
  svg += circle(cx, bodyTopY + bodyH * 0.42, 0.7 * s, shade(color, -0.5), `opacity="0.8"`);

  // --- HEAD ---
  svg += circle(headCx, headCy, headR, skin);
  // hair cap
  svg += `<path d="M ${f1(headCx - headR)} ${f1(headCy - 0.1 * s)} A ${f1(headR)} ${f1(headR)} 0 0 1 ${f1(headCx + headR)} ${f1(headCy - 0.1 * s)} L ${f1(headCx + headR * 0.7)} ${f1(headCy - headR * 0.55)} L ${f1(headCx - headR * 0.7)} ${f1(headCy - headR * 0.55)} Z" fill="${shade(color, -0.55)}"/>`;
  svg += `<path d="M ${f1(headCx - headR)} ${f1(headCy - 0.1 * s)} A ${f1(headR)} ${f1(headR)} 0 0 1 ${f1(headCx + headR)} ${f1(headCy - 0.1 * s)} Z" fill="${shade(color, -0.5)}" opacity="0.0"/>`;
  // face — eyes (blink closes them to a line)
  const eyeDx = 0.95 * s, eyeY = headCy + 0.1 * s, eyeR = 0.42 * s;
  if (p.blink) {
    svg += limb(headCx - eyeDx - 0.3 * s, eyeY, headCx - eyeDx + 0.3 * s, eyeY, OUTLINE, 0.5 * s);
    svg += limb(headCx + eyeDx - 0.3 * s, eyeY, headCx + eyeDx + 0.3 * s, eyeY, OUTLINE, 0.5 * s);
  } else {
    svg += circle(headCx - eyeDx, eyeY, eyeR, OUTLINE);
    svg += circle(headCx + eyeDx, eyeY, eyeR, OUTLINE);
    // tiny catchlights for life (skip on small to avoid mush)
    if (cell >= 24) {
      svg += circle(headCx - eyeDx + 0.18 * s, eyeY - 0.18 * s, 0.16 * s, "#ffffff");
      svg += circle(headCx + eyeDx + 0.18 * s, eyeY - 0.18 * s, 0.16 * s, "#ffffff");
    }
  }
  // smile (a happy little curve; cheer = bigger). Only on big/medium to stay clean.
  if (cell >= 24) {
    const mY = headCy + headR * 0.5;
    const mW = (name === "interact" ? 1.0 : 0.75) * s;
    svg += `<path d="M ${f1(headCx - mW)} ${f1(mY)} Q ${f1(headCx)} ${f1(mY + 0.9 * s)} ${f1(headCx + mW)} ${f1(mY)}" stroke="${OUTLINE}" stroke-width="${f1(0.5 * s)}" fill="none" stroke-linecap="round"/>`;
  }

  // perfect tier: a tiny sparkle near the head, frame-varied for life.
  if (isPerfect) {
    const sp = [
      { x: headCx + headR + 1.2 * s, y: headCy - 1.0 * s },
      { x: headCx - headR - 1.0 * s, y: headCy + 0.6 * s },
      { x: headCx + headR + 0.8 * s, y: headCy + 1.2 * s },
      { x: headCx - headR - 1.2 * s, y: headCy - 0.8 * s },
    ][fr % 4];
    const r = 0.85 * s;
    svg += `<path d="M ${f1(sp.x)} ${f1(sp.y - r)} L ${f1(sp.x + r * 0.32)} ${f1(sp.y - r * 0.32)} L ${f1(sp.x + r)} ${f1(sp.y)} L ${f1(sp.x + r * 0.32)} ${f1(sp.y + r * 0.32)} L ${f1(sp.x)} ${f1(sp.y + r)} L ${f1(sp.x - r * 0.32)} ${f1(sp.y + r * 0.32)} L ${f1(sp.x - r)} ${f1(sp.y)} L ${f1(sp.x - r * 0.32)} ${f1(sp.y - r * 0.32)} Z" fill="#ffffff" opacity="0.9"/>`;
  }

  // --- GUNS last, on top of hands ---
  if (guns.left) svg += drawGun(handL.x, handL.y, -1, s, isPerfect);
  if (guns.right) svg += drawGun(handR.x, handR.y, 1, s, isPerfect);

  svg += "</g>";
  return svg;
}

// ---------------------------------------------------------------------------
// Sheet assembly
// ---------------------------------------------------------------------------
function generateDudeSheet(cell, color, quality, guns) {
  const sheetW = FRAMES * cell;
  const sheetH = POSES.length * cell;
  let svg =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sheetW}" height="${sheetH}" ` +
    `viewBox="0 0 ${sheetW} ${sheetH}" shape-rendering="geometricPrecision">\n`;
  for (let row = 0; row < POSES.length; row++) {
    for (let col = 0; col < FRAMES; col++) {
      svg += drawFigure(col * cell, row * cell, cell, color, quality, POSES[row], col, guns) + "\n";
    }
  }
  svg += "</svg>\n";
  return svg;
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
        const file = `${size.name}-${tier.name}${v.suffix}.svg`;
        fs.writeFileSync(
          path.join(assetsDir, file),
          generateDudeSheet(size.cell, tier.color, tier.name, v.guns),
          "utf-8",
        );
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
