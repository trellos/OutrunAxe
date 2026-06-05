#!/usr/bin/env node
/**
 * Generate placeholder pixel-art stick-figure spritesheets.
 * Creates SVG files (easy to edit/paint over, then export to PNG).
 *
 * Structure:
 * - big-{tier}.svg   (8th notes) — 4 columns × 4 rows (idle, walk, jump, interact)
 * - medium-{tier}.svg (triplets) — 4 columns × 4 rows
 * - small-{tier}.svg (16th notes) — 4 columns × 4 rows
 *
 * Tiers: loose, normal, perfect
 * Animations: idle, walk, jump, high-five
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ASSETS_DIR = path.join(__dirname, "public/assets");
const SIZES = [
  { name: "big", w: 32, h: 32, scale: 4 },      // 8th notes
  { name: "medium", w: 24, h: 24, scale: 3 },   // triplets
  { name: "small", w: 16, h: 16, scale: 2 },    // 16th notes
];

const TIERS = [
  { name: "loose", color: "#888", desc: "Loose timing" },
  { name: "normal", color: "#0f0", desc: "Normal timing" },
  { name: "perfect", color: "#0ff", desc: "Perfect timing" },
];

const ANIMATIONS = [
  { name: "idle", desc: "Standing still" },
  { name: "walk", desc: "Walking/moving" },
  { name: "jump", desc: "Jumping/celebrating" },
  { name: "interact", desc: "High-five/interaction" },
];

/**
 * Draw a simple stick figure at (x, y) in a (w, h) cell.
 * Returns SVG group element as string.
 */
function drawStickFigure(x, y, w, h, color, pose) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const scale = w / 16; // Normalize to 16-unit grid

  let svg = `<g data-pose="${pose}">`;

  // Head: circle at top
  svg += `<circle cx="${cx}" cy="${cy - 4 * scale}" r="${2 * scale}" fill="${color}" stroke="${color}" stroke-width="${0.5 * scale}"/>`;

  // Body: vertical line
  svg += `<line x1="${cx}" y1="${cy - 2 * scale}" x2="${cx}" y2="${cy + 2 * scale}" stroke="${color}" stroke-width="${1 * scale}" stroke-linecap="round"/>`;

  // Arms: horizontal line (vary by pose)
  const armY = cy - 0.5 * scale;
  if (pose === "idle") {
    svg += `<line x1="${cx - 3 * scale}" y1="${armY}" x2="${cx + 3 * scale}" y2="${armY}" stroke="${color}" stroke-width="${1 * scale}" stroke-linecap="round"/>`;
  } else if (pose === "walk") {
    // One arm up, one down (walking pose)
    svg += `<line x1="${cx - 3 * scale}" y1="${armY - 2 * scale}" x2="${cx}" y2="${armY}" stroke="${color}" stroke-width="${1 * scale}" stroke-linecap="round"/>`;
    svg += `<line x1="${cx + 3 * scale}" y1="${armY + 2 * scale}" x2="${cx}" y2="${armY}" stroke="${color}" stroke-width="${1 * scale}" stroke-linecap="round"/>`;
  } else if (pose === "jump") {
    // Both arms up
    svg += `<line x1="${cx - 3 * scale}" y1="${armY - 3 * scale}" x2="${cx}" y2="${armY}" stroke="${color}" stroke-width="${1 * scale}" stroke-linecap="round"/>`;
    svg += `<line x1="${cx + 3 * scale}" y1="${armY - 3 * scale}" x2="${cx}" y2="${armY}" stroke="${color}" stroke-width="${1 * scale}" stroke-linecap="round"/>`;
  } else if (pose === "interact") {
    // One arm up (high-five), one down
    svg += `<line x1="${cx - 3 * scale}" y1="${armY - 2 * scale}" x2="${cx}" y2="${armY}" stroke="${color}" stroke-width="${1 * scale}" stroke-linecap="round"/>`;
    svg += `<line x1="${cx + 3 * scale}" y1="${armY + 1 * scale}" x2="${cx}" y2="${armY}" stroke="${color}" stroke-width="${1 * scale}" stroke-linecap="round"/>`;
  }

  // Legs: two short lines from base
  const legY = cy + 2 * scale;
  svg += `<line x1="${cx - 1.5 * scale}" y1="${legY}" x2="${cx - 1.5 * scale}" y2="${legY + 2 * scale}" stroke="${color}" stroke-width="${1 * scale}" stroke-linecap="round"/>`;
  svg += `<line x1="${cx + 1.5 * scale}" y1="${legY}" x2="${cx + 1.5 * scale}" y2="${legY + 2 * scale}" stroke="${color}" stroke-width="${1 * scale}" stroke-linecap="round"/>`;

  svg += `</g>`;
  return svg;
}

/**
 * Generate a spritesheet: 4 columns × 4 rows (4 animations × various counts).
 * Returns SVG string.
 */
function generateSpritesheet(sizeName, w, h, color, tierId) {
  const cols = ANIMATIONS.length; // 4 animations
  const rows = 1; // 1 row per tier (can expand for variations)

  const sheetW = cols * w;
  const sheetH = rows * h;

  let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${sheetW}" height="${sheetH}" viewBox="0 0 ${sheetW} ${sheetH}">
  <defs>
    <style>
      text { font-family: monospace; font-size: 10px; fill: #666; }
      .grid-line { stroke: #ddd; stroke-width: 0.5; }
    </style>
  </defs>
  <!-- Background grid -->
  <rect width="${sheetW}" height="${sheetH}" fill="#f5f5f5"/>`;

  // Draw grid lines
  for (let x = 0; x <= cols; x++) {
    svg += `<line class="grid-line" x1="${x * w}" y1="0" x2="${x * w}" y2="${sheetH}"/>`;
  }
  for (let y = 0; y <= rows; y++) {
    svg += `<line class="grid-line" x1="0" y1="${y * h}" x2="${sheetW}" y2="${y * h}"/>`;
  }

  // Draw cells
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      const x = col * w;
      const y = row * h;
      const anim = ANIMATIONS[col];

      // Cell background
      svg += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="white" stroke="#ccc" stroke-width="0.5"/>`;

      // Draw stick figure
      svg += drawStickFigure(x, y, w, h, color, anim.name);

      // Label
      svg += `<text x="${x + 2}" y="${y + h - 2}">${anim.name}</text>`;
    }
  }

  svg += `\n</svg>`;
  return svg;
}

// Create public/assets directory if needed
if (!fs.existsSync(ASSETS_DIR)) {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

// Generate all spritesheets
console.log("Generating placeholder pixel-art spritesheets...\n");

for (const size of SIZES) {
  for (const tier of TIERS) {
    const filename = `${size.name}-${tier.name}.svg`;
    const filepath = path.join(ASSETS_DIR, filename);
    const svg = generateSpritesheet(size.name, size.w, size.h, tier.color, tier.name);

    fs.writeFileSync(filepath, svg, "utf-8");
    console.log(`✓ ${filename} (${size.w}×${size.h}px, ${tier.desc})`);
  }
}

console.log("\n✅ Spritesheets generated in public/assets/");
console.log("\nNext steps:");
console.log("1. Open each .svg file in Inkscape, Illustrator, or a browser");
console.log("2. Paint over the stick figures with your character art");
console.log("3. Export each as PNG (same filename, .png extension)");
console.log("4. Code will load the PNG versions automatically\n");
