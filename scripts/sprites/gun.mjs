#!/usr/bin/env node
/**
 * gun.mjs — placeholder sprite generator for the "Infinite Eddie" laser pistol.
 *
 * Emits a SINGLE-FRAME image of a laser pistol lying FLAT on the ground
 * (horizontal, side profile), barrel pointing right, grip angled down.
 *
 *   gun-floor.svg   viewBox 0 0 32 16  (~2:1, wider than tall)
 *
 * Design notes for small-size readability (must read at ~14x7 px):
 *   - Chunky, high-contrast silhouette with a single dark outline drawn UNDER
 *     a metallic gunmetal body, so it reads on any background.
 *   - A glowing red/orange muzzle tip signals "laser".
 *   - A small cyan energy-cell glow accent in the body.
 *   - Fully deterministic (no randomness).
 *
 * Run directly to write into <repoRoot>/public/assets:
 *   node scripts/sprites/gun.mjs
 * Or import { generate } and call generate(assetsDir).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ---- palette -------------------------------------------------------------
const OUTLINE = "#05060a"; // near-black silhouette
const METAL_DARK = "#3a4150"; // gunmetal shadow
const METAL = "#7d8696"; // gunmetal mid
const METAL_LITE = "#c3cad6"; // gunmetal highlight
const ACCENT = "#19e0ff"; // cyan energy cell
const MUZZLE_CORE = "#fff2c2"; // hot white-yellow core
const MUZZLE_MID = "#ff8a1e"; // orange
const MUZZLE_GLOW = "#ff3b2f"; // red glow halo

/**
 * Build the laser-pistol SVG. The drawing strategy is the project convention:
 * draw a fat dark outline path first, then the lighter body on top, then
 * highlights and the glowing muzzle. Coordinates are tuned for viewBox 32x16
 * with the gun lying along the bottom-ish centerline.
 */
function gunFloorSvg() {
  // Outline body = receiver block + barrel + grip, fattened. We render the
  // body as a single chunky polygon (the outline version is the same polygon
  // expanded via a thick stroke), keeping the silhouette solid at tiny sizes.
  //
  // Body polygon (the receiver + barrel), pointing right:
  const body =
    "M6 6 L23 5 L26 5.4 L26 7.2 L23 7.6 L15 7.6 L15 9 L13 9 L12.5 7.6 L6 7.8 Z";
  // Grip polygon, angled down-left from the receiver:
  const grip = "M7 7.2 L13 7.2 L11.5 13.5 L7.5 13.8 L6 8 Z";
  // Trigger guard: an arc-ish loop hinted as a stroked path under the receiver.
  const guard = "M12.8 8 Q12.4 11.2 9.4 11";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16" viewBox="0 0 32 16">
  <defs>
    <linearGradient id="metal" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${METAL_LITE}"/>
      <stop offset="0.55" stop-color="${METAL}"/>
      <stop offset="1" stop-color="${METAL_DARK}"/>
    </linearGradient>
    <radialGradient id="muzzle" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${MUZZLE_CORE}"/>
      <stop offset="0.45" stop-color="${MUZZLE_MID}"/>
      <stop offset="1" stop-color="${MUZZLE_GLOW}" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <!-- soft muzzle glow halo (behind everything, signals laser) -->
  <circle cx="26.5" cy="6.1" r="5.2" fill="url(#muzzle)" opacity="0.85"/>

  <!-- DARK OUTLINE pass: same shapes, drawn fat first so a chunky black edge
       wraps the whole gun and it reads on any background. -->
  <g fill="none" stroke="${OUTLINE}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
    <path d="${grip}"/>
    <path d="${body}"/>
  </g>
  <path d="${guard}" fill="none" stroke="${OUTLINE}" stroke-width="2.6" stroke-linecap="round"/>

  <!-- BODY pass: metallic fill on top of the outline. -->
  <path d="${grip}" fill="${METAL_DARK}"/>
  <path d="${body}" fill="url(#metal)"/>
  <!-- trigger-guard inner fill (re-stroke thinner in metal so it stays a loop) -->
  <path d="${guard}" fill="none" stroke="${METAL}" stroke-width="1.1" stroke-linecap="round"/>

  <!-- top highlight strip along the barrel/receiver -->
  <path d="M7 5.6 L24 4.9 L26 5.3" fill="none" stroke="${METAL_LITE}" stroke-width="1" stroke-linecap="round" opacity="0.9"/>

  <!-- grip checkering hint: two short dark ribs -->
  <path d="M9 9 L8.4 12.2 M11 9 L10.4 12.4" stroke="${OUTLINE}" stroke-width="0.8" stroke-linecap="round" opacity="0.7"/>

  <!-- cyan energy cell accent on the receiver -->
  <rect x="16.2" y="5.4" width="3.2" height="1.7" rx="0.5" fill="${ACCENT}"/>
  <rect x="16.2" y="5.4" width="3.2" height="1.7" rx="0.5" fill="none" stroke="${OUTLINE}" stroke-width="0.5"/>

  <!-- glowing muzzle tip core -->
  <circle cx="26" cy="6.1" r="1.9" fill="${MUZZLE_GLOW}"/>
  <circle cx="26" cy="6.1" r="1.25" fill="${MUZZLE_MID}"/>
  <circle cx="26" cy="6.1" r="0.6" fill="${MUZZLE_CORE}"/>
</svg>
`;
}

/**
 * Write the gun sprite(s) into assetsDir. Creates the directory if needed.
 * @param {string} assetsDir absolute path to the assets output directory
 * @returns {string[]} paths written
 */
export function generate(assetsDir) {
  fs.mkdirSync(assetsDir, { recursive: true });
  const out = path.join(assetsDir, "gun-floor.svg");
  fs.writeFileSync(out, gunFloorSvg());
  return [out];
}

// Run directly: node scripts/sprites/gun.mjs
// This file lives at <repoRoot>/scripts/sprites/gun.mjs, so repo root is two
// levels up from here.
const __filename = fileURLToPath(import.meta.url);
const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) {
  const repoRoot = path.resolve(path.dirname(__filename), "..", "..");
  const assetsDir = path.join(repoRoot, "public/assets");
  const written = generate(assetsDir);
  for (const f of written) console.log("wrote", f);
}
