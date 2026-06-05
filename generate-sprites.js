#!/usr/bin/env node
/**
 * Generate placeholder pixel-art stick-figure spritesheets.
 *
 * Layout (so animation actually plays):
 *   - Columns = animation FRAMES (4 per pose)
 *   - Rows    = POSES (idle, walk, jump, interact)
 * So a sheet is (4*w) wide by (4*h) tall. The renderer picks a cell by
 * (frameNum, poseIndex).
 *
 * The figures are drawn on a TRANSPARENT background with a dark outline under a
 * bright body so they read on any background — no grid, no text labels (those
 * were what made the old sheets look like white boxes).
 *
 * Files: {big,medium,small}-{loose,normal,perfect}.svg
 * Paint over these, export to PNG (same name), and the loader prefers the PNG.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, "public/assets");

const SIZES = [
  { name: "big", w: 32, h: 32 },
  { name: "medium", w: 24, h: 24 },
  { name: "small", w: 16, h: 16 },
];

const TIERS = [
  { name: "loose", color: "#cfd2da" },   // dim grey-white
  { name: "normal", color: "#7CFF4F" },  // lime
  { name: "perfect", color: "#33F0FF" }, // cyan
];

// Row order MUST match Character.getSpriteFrame()'s pose index order.
const POSES = ["idle", "walk", "jump", "interact"];
const FRAMES = 4;

const TAU = Math.PI * 2;

/**
 * Limb endpoints for a pose at frame f (0..FRAMES-1), in unit space centered
 * on (0,0), scaled later. Returns body/head/arm/leg offsets.
 */
function pose(poseName, f) {
  const t = f / FRAMES;            // 0..1 around the loop
  const swing = Math.sin(t * TAU); // -1..1

  let bob = 0;                     // vertical body offset
  let headY = -4.5;
  let armL, armR, legL, legR;

  if (poseName === "idle") {
    bob = Math.abs(swing) * 0.4;   // gentle breathing
    armL = { dx: -3, dy: 1 + swing * 0.3 };
    armR = { dx: 3, dy: 1 - swing * 0.3 };
    legL = { dx: -1.6, dy: 4 };
    legR = { dx: 1.6, dy: 4 };
  } else if (poseName === "walk") {
    armL = { dx: -2.5, dy: 0.5 + swing * 1.6 };
    armR = { dx: 2.5, dy: 0.5 - swing * 1.6 };
    legL = { dx: -1.4 - swing * 1.4, dy: 4 };
    legR = { dx: 1.4 + swing * 1.4, dy: 4 };
  } else if (poseName === "jump") {
    bob = -Math.abs(swing) * 0.8;  // little lift
    armL = { dx: -3, dy: -3.2 };   // both arms up
    armR = { dx: 3, dy: -3.2 };
    legL = { dx: -2 - Math.abs(swing) * 0.6, dy: 3.4 };
    legR = { dx: 2 + Math.abs(swing) * 0.6, dy: 3.4 };
  } else {
    // interact: one arm raised, waving
    const wave = Math.sin(t * TAU);
    armL = { dx: -2.5, dy: 1 };
    armR = { dx: 3 + wave * 0.6, dy: -3.5 }; // waving arm up
    legL = { dx: -1.6, dy: 4 };
    legR = { dx: 1.6, dy: 4 };
  }

  return { bob, headY: headY + bob, armL, armR, legL, legR };
}

/** Draw one figure into a cell at (ox, oy) of size (w,h). */
function drawFigure(ox, oy, w, h, color, poseName, f) {
  const s = w / 16;                 // unit -> px scale
  const cx = ox + w / 2;
  const cy = oy + h / 2;
  const p = pose(poseName, f);

  const bodyTopY = cy + (-2.5 + p.bob) * s;
  const bodyBotY = cy + (2 + p.bob) * s;
  const shoulderY = cy + (-1.5 + p.bob) * s;
  const hipY = cy + (2 + p.bob) * s;

  const head = { x: cx, y: cy + p.headY * s, r: 2.3 * s };

  const seg = (x1, y1, x2, y2) => ({ x1, y1, x2, y2 });
  const limbs = [
    seg(cx, bodyTopY, cx, bodyBotY),                                   // spine
    seg(cx, shoulderY, cx + p.armL.dx * s, shoulderY + p.armL.dy * s), // L arm
    seg(cx, shoulderY, cx + p.armR.dx * s, shoulderY + p.armR.dy * s), // R arm
    seg(cx, hipY, cx + p.legL.dx * s, hipY + p.legL.dy * s),           // L leg
    seg(cx, hipY, cx + p.legR.dx * s, hipY + p.legR.dy * s),           // R leg
  ];

  const outlineW = 2.4 * s;
  const bodyW = 1.3 * s;
  let svg = `<g>`;
  // dark outline pass (readable on light backgrounds)
  svg += `<circle cx="${head.x.toFixed(1)}" cy="${head.y.toFixed(1)}" r="${(head.r + 0.6 * s).toFixed(1)}" fill="#101018"/>`;
  for (const l of limbs) {
    svg += `<line x1="${l.x1.toFixed(1)}" y1="${l.y1.toFixed(1)}" x2="${l.x2.toFixed(1)}" y2="${l.y2.toFixed(1)}" stroke="#101018" stroke-width="${outlineW.toFixed(2)}" stroke-linecap="round"/>`;
  }
  // bright body pass
  svg += `<circle cx="${head.x.toFixed(1)}" cy="${head.y.toFixed(1)}" r="${head.r.toFixed(1)}" fill="${color}"/>`;
  for (const l of limbs) {
    svg += `<line x1="${l.x1.toFixed(1)}" y1="${l.y1.toFixed(1)}" x2="${l.x2.toFixed(1)}" y2="${l.y2.toFixed(1)}" stroke="${color}" stroke-width="${bodyW.toFixed(2)}" stroke-linecap="round"/>`;
  }
  svg += `</g>`;
  return svg;
}

function generateSheet(w, h, color) {
  const sheetW = FRAMES * w;
  const sheetH = POSES.length * h;
  let svg = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sheetW}" height="${sheetH}" viewBox="0 0 ${sheetW} ${sheetH}">\n`;
  for (let row = 0; row < POSES.length; row++) {
    for (let col = 0; col < FRAMES; col++) {
      svg += drawFigure(col * w, row * h, w, h, color, POSES[row], col);
    }
  }
  svg += `\n</svg>\n`;
  return svg;
}

if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });

console.log("Generating placeholder stick-figure spritesheets...\n");
for (const size of SIZES) {
  for (const tier of TIERS) {
    const file = `${size.name}-${tier.name}.svg`;
    fs.writeFileSync(path.join(ASSETS_DIR, file), generateSheet(size.w, size.h, tier.color), "utf-8");
    console.log(`  ${file}  (${FRAMES * size.w}x${POSES.length * size.h})`);
  }
}
console.log("\nDone. Rows = poses (idle/walk/jump/interact), cols = 4 frames.");
