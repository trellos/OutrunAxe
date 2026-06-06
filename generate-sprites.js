#!/usr/bin/env node
/**
 * Generate ALL placeholder spritesheets for the Infinite Eddie crowd.
 *
 * The art is split into one builder module per entity family under
 * scripts/sprites/ — each exports `generate(assetsDir)` and is also runnable
 * standalone. This file just runs all of them so `node generate-sprites.js`
 * regenerates everything into public/assets/.
 *
 *   - scripts/sprites/dude.mjs   : 36 dude sheets (size × tier × gun-variant)
 *   - scripts/sprites/gun.mjs    : gun-floor.svg
 *   - scripts/sprites/rocket.mjs : rocket-{1,2,3}.svg, explosion.svg, rocket-flame.svg
 *
 * Renderer contracts (do not break in the builders):
 *   - dudes: (4*cell) x (4*cell), cols = frames, rows = poses idle/walk/jump/interact
 *   - rockets: 4-frame row, nose UP, ~20:36 per frame
 *   - explosion: 6-frame row, square frames
 *   - rocket-flame: 4-frame row, flame points DOWN, ~16:22 per frame
 *   - gun-floor: single frame, ~2:1
 */

import path from "path";
import { fileURLToPath } from "url";
import { generate as generateDudes } from "./scripts/sprites/dude.mjs";
import { generate as generateGun } from "./scripts/sprites/gun.mjs";
import { generate as generateRocket } from "./scripts/sprites/rocket.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, "public/assets");

console.log("Generating placeholder spritesheets into public/assets ...\n");
generateDudes(ASSETS_DIR);
generateGun(ASSETS_DIR);
generateRocket(ASSETS_DIR);
console.log("\nDone.");
