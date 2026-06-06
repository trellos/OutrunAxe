// Sprite-art generator for "Infinite Eddie".
// Produces readable placeholder SVG spritesheets for rockets + effects.
//
//   generate(assetsDir)  -> writes rocket-1.svg, rocket-2.svg, rocket-3.svg,
//                           explosion.svg, rocket-flame.svg into assetsDir.
//
// Run directly:  node scripts/sprites/rocket.mjs   (writes into public/assets)
//
// Fully deterministic: no Math.random. A tiny seeded PRNG drives the spark
// scatter in the explosion so frames look organic but are reproducible.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// tiny helpers
// ---------------------------------------------------------------------------

/** Deterministic mulberry32 PRNG. */
function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r2 = (n) => Math.round(n * 100) / 100; // trim float noise in output

// ---------------------------------------------------------------------------
// ROCKETS
// ---------------------------------------------------------------------------

const ROCKET_FW = 20;
const ROCKET_FH = 36;
const ROCKET_FRAMES = 4;

/**
 * One rocket frame. Nose cone at TOP (small y), fins + exhaust flame at BOTTOM.
 * @param {number} ox  x offset of this frame's left edge
 * @param {number} flick  0..3 flame flicker phase
 * @param {object} p  palette / proportion config for the variant
 */
function rocketFrame(ox, flick, p) {
  const cx = ox + ROCKET_FW / 2; // frame horizontal centre
  const noseTopY = 2;
  const bodyTopY = 9; // where the cone meets the tube
  const bodyBotY = 27; // bottom of the tube / start of fins
  const bw = p.bodyW; // body half-width measured from centre
  const left = cx - bw;
  const right = cx + bw;

  // Tail flame flicker: length + width cycle through the 4 frames.
  const flickLen = [5, 8, 4, 7][flick];
  const flickW = [3.2, 4.2, 2.6, 3.8][flick];
  const fTopY = bodyBotY + 1.5;
  const fBotY = fTopY + flickLen;

  const parts = [];

  // --- engine tail flame (very bottom, behind fins) ---
  parts.push(
    `<path d="M ${r2(cx - flickW)} ${r2(fTopY)} Q ${r2(cx)} ${r2(fBotY + 2)} ${r2(cx + flickW)} ${r2(fTopY)} Z" fill="${p.flameOuter}"/>`
  );
  parts.push(
    `<path d="M ${r2(cx - flickW * 0.55)} ${r2(fTopY)} Q ${r2(cx)} ${r2(fBotY)} ${r2(cx + flickW * 0.55)} ${r2(fTopY)} Z" fill="${p.flameCore}"/>`
  );

  // --- fins (left + right) at the bottom of the body ---
  const finOut = p.finOut; // how far fins flare past the body
  const finBot = bodyBotY + 5;
  parts.push(
    `<path d="M ${r2(left)} ${r2(bodyBotY - 4)} L ${r2(left - finOut)} ${r2(finBot)} L ${r2(left)} ${r2(bodyBotY)} Z" fill="${p.fin}" stroke="${p.outline}" stroke-width="0.8" stroke-linejoin="round"/>`
  );
  parts.push(
    `<path d="M ${r2(right)} ${r2(bodyBotY - 4)} L ${r2(right + finOut)} ${r2(finBot)} L ${r2(right)} ${r2(bodyBotY)} Z" fill="${p.fin}" stroke="${p.outline}" stroke-width="0.8" stroke-linejoin="round"/>`
  );

  // --- body tube + nose cone as a single outlined silhouette ---
  parts.push(
    `<path d="M ${r2(cx)} ${r2(noseTopY)} ` +
      `Q ${r2(right + 0.5)} ${r2(bodyTopY - 1)} ${r2(right)} ${r2(bodyTopY)} ` +
      `L ${r2(right)} ${r2(bodyBotY)} ` +
      `Q ${r2(cx)} ${r2(bodyBotY + 3)} ${r2(left)} ${r2(bodyBotY)} ` +
      `L ${r2(left)} ${r2(bodyTopY)} ` +
      `Q ${r2(left - 0.5)} ${r2(bodyTopY - 1)} ${r2(cx)} ${r2(noseTopY)} Z" ` +
      `fill="${p.body}" stroke="${p.outline}" stroke-width="1" stroke-linejoin="round"/>`
  );

  // --- nose cone accent (top section in accent colour) ---
  parts.push(
    `<path d="M ${r2(cx)} ${r2(noseTopY)} ` +
      `Q ${r2(right + 0.5)} ${r2(bodyTopY - 1)} ${r2(right)} ${r2(bodyTopY)} ` +
      `L ${r2(left)} ${r2(bodyTopY)} ` +
      `Q ${r2(left - 0.5)} ${r2(bodyTopY - 1)} ${r2(cx)} ${r2(noseTopY)} Z" ` +
      `fill="${p.nose}"/>`
  );

  // --- vertical highlight stripe on the body for a glossy read ---
  parts.push(
    `<rect x="${r2(cx - bw * 0.45)} " y="${r2(bodyTopY + 1)}" width="${r2(bw * 0.35)}" height="${r2(bodyBotY - bodyTopY - 2)}" rx="0.8" fill="${p.highlight}" opacity="0.5"/>`
  );

  // --- porthole window ---
  const portY = bodyTopY + (bodyBotY - bodyTopY) * 0.4;
  parts.push(
    `<circle cx="${r2(cx)}" cy="${r2(portY)}" r="${r2(p.portR + 0.7)}" fill="${p.outline}"/>`
  );
  parts.push(
    `<circle cx="${r2(cx)}" cy="${r2(portY)}" r="${r2(p.portR)}" fill="${p.window}"/>`
  );
  parts.push(
    `<circle cx="${r2(cx - p.portR * 0.3)}" cy="${r2(portY - p.portR * 0.3)}" r="${r2(p.portR * 0.35)}" fill="#ffffff" opacity="0.85"/>`
  );

  return parts.join("\n      ");
}

function rocketSvg(p) {
  const W = ROCKET_FW * ROCKET_FRAMES;
  const H = ROCKET_FH;
  let frames = "";
  for (let i = 0; i < ROCKET_FRAMES; i++) {
    frames += `\n    <g>\n      ${rocketFrame(i * ROCKET_FW, i, p)}\n    </g>`;
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" ` +
    `viewBox="0 0 ${W} ${H}" shape-rendering="geometricPrecision">` +
    `${frames}\n</svg>\n`
  );
}

// Three clearly-distinct variants.
const ROCKET_VARIANTS = {
  "rocket-1.svg": {
    // white body, red nose, amber fins/flame — classic
    body: "#f3f4f6",
    nose: "#e3342f",
    fin: "#f6ad2b",
    outline: "#27184a",
    window: "#3bc9ff",
    flameCore: "#fff3b0",
    flameOuter: "#ff9326",
    highlight: "#ffffff",
    bodyW: 5.2,
    finOut: 3.2,
    portR: 2.1,
  },
  "rocket-2.svg": {
    // slim cyan body, lime nose + swept fins
    body: "#27c7d6",
    nose: "#a6f43a",
    fin: "#7be000",
    outline: "#0b2a3a",
    window: "#fff7c4",
    flameCore: "#eafff0",
    flameOuter: "#36e0b0",
    highlight: "#bdfffb",
    bodyW: 4.3,
    finOut: 4.0,
    portR: 1.9,
  },
  "rocket-3.svg": {
    // chunky magenta body, gold nose + stubby fins
    body: "#e23ca8",
    nose: "#ffcf3a",
    fin: "#ffb000",
    outline: "#2a0a33",
    window: "#9be8ff",
    flameCore: "#fff0fb",
    flameOuter: "#ff5ad2",
    highlight: "#ffd6f3",
    bodyW: 6.0,
    finOut: 2.6,
    portR: 2.4,
  },
};

// ---------------------------------------------------------------------------
// EXPLOSION  — 6 frames, 48x48 square
// ---------------------------------------------------------------------------

const EXP_FS = 48;
const EXP_FRAMES = 6;

function explosionFrame(ox, frame) {
  const cx = ox + EXP_FS / 2;
  const cy = EXP_FS / 2;
  const rng = makeRng(0x51c0 + frame * 977); // deterministic per frame

  // Evolution curve over 6 frames:
  // 0 tiny bright core, 1-2 expanding fireball, 3 peak orange blast +shards,
  // 4-5 fading smoke.
  const radius = [4, 11, 17, 21, 20, 18][frame];
  const coreR = [3.5, 7, 8, 5, 2.5, 0][frame];
  const opacity = [1, 1, 1, 0.95, 0.7, 0.35][frame];
  const sparkCount = [0, 6, 10, 12, 8, 5][frame];
  const sparkSpread = [0, 14, 20, 26, 30, 33][frame];

  const parts = [`<g opacity="${opacity}">`];

  // outer fireball / smoke ring
  if (frame >= 4) {
    // fading smoke puffs
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2 + frame;
      const d = radius * 0.6;
      const px = cx + Math.cos(ang) * d;
      const py = cy + Math.sin(ang) * d;
      const pr = radius * (0.45 + rng() * 0.2);
      parts.push(
        `<circle cx="${r2(px)}" cy="${r2(py)}" r="${r2(pr)}" fill="#6b5240" opacity="0.5"/>`
      );
    }
  } else {
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${r2(radius)}" fill="#d6361a"/>`);
    parts.push(
      `<circle cx="${cx}" cy="${cy}" r="${r2(radius * 0.78)}" fill="#ff7a18"/>`
    );
    parts.push(
      `<circle cx="${cx}" cy="${cy}" r="${r2(radius * 0.52)}" fill="#ffd23f"/>`
    );
  }

  // bright white-hot core
  if (coreR > 0) {
    parts.push(
      `<circle cx="${cx}" cy="${cy}" r="${r2(coreR)}" fill="#fffbe6"/>`
    );
  }

  // spark shards radiating outward
  for (let i = 0; i < sparkCount; i++) {
    const ang = rng() * Math.PI * 2;
    const dist = sparkSpread * (0.5 + rng() * 0.5);
    const px = cx + Math.cos(ang) * dist;
    const py = cy + Math.sin(ang) * dist;
    const sr = 0.8 + rng() * 1.8;
    const col = frame >= 4 ? "#ffae5c" : i % 2 === 0 ? "#fff2a8" : "#ff7a18";
    parts.push(`<circle cx="${r2(px)}" cy="${r2(py)}" r="${r2(sr)}" fill="${col}"/>`);
  }

  parts.push("</g>");
  return parts.join("\n      ");
}

function explosionSvg() {
  const W = EXP_FS * EXP_FRAMES;
  const H = EXP_FS;
  let frames = "";
  for (let i = 0; i < EXP_FRAMES; i++) {
    frames += `\n    <g>\n      ${explosionFrame(i * EXP_FS, i)}\n    </g>`;
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" ` +
    `viewBox="0 0 ${W} ${H}" shape-rendering="geometricPrecision">` +
    `${frames}\n</svg>\n`
  );
}

// ---------------------------------------------------------------------------
// ENGINE FLAME  — 4 frames, 16x22, points DOWN
// ---------------------------------------------------------------------------

const FLAME_FW = 16;
const FLAME_FH = 22;
const FLAME_FRAMES = 4;

function flameFrame(ox, flick) {
  const cx = ox + FLAME_FW / 2;
  const topY = 1; // attaches to rocket tail at the TOP
  // flicker the trail length + width
  const len = [18, 21, 16, 20][flick];
  const w = [5.4, 6.2, 4.6, 5.8][flick];
  const tipY = topY + len;

  // teardrop: wide flat top at the tail, tapering to a point at the bottom.
  const teardrop = (halfW, bottomY) =>
    `M ${r2(cx - halfW)} ${r2(topY)} ` +
    `C ${r2(cx - halfW)} ${r2(topY + len * 0.5)} ${r2(cx - halfW * 0.4)} ${r2(bottomY - 1)} ${r2(cx)} ${r2(bottomY)} ` +
    `C ${r2(cx + halfW * 0.4)} ${r2(bottomY - 1)} ${r2(cx + halfW)} ${r2(topY + len * 0.5)} ${r2(cx + halfW)} ${r2(topY)} Z`;

  return [
    `<path d="${teardrop(w, tipY)}" fill="#ff3b1f"/>`,
    `<path d="${teardrop(w * 0.72, topY + len * 0.82)}" fill="#ff8a1e"/>`,
    `<path d="${teardrop(w * 0.46, topY + len * 0.62)}" fill="#ffcf3a"/>`,
    `<path d="${teardrop(w * 0.22, topY + len * 0.42)}" fill="#fffbe6"/>`,
  ].join("\n      ");
}

function flameSvg() {
  const W = FLAME_FW * FLAME_FRAMES;
  const H = FLAME_FH;
  let frames = "";
  for (let i = 0; i < FLAME_FRAMES; i++) {
    frames += `\n    <g>\n      ${flameFrame(i * FLAME_FW, i)}\n    </g>`;
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" ` +
    `viewBox="0 0 ${W} ${H}" shape-rendering="geometricPrecision">` +
    `${frames}\n</svg>\n`
  );
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

export function generate(assetsDir) {
  fs.mkdirSync(assetsDir, { recursive: true });
  const written = [];

  for (const [name, palette] of Object.entries(ROCKET_VARIANTS)) {
    const file = path.join(assetsDir, name);
    fs.writeFileSync(file, rocketSvg(palette));
    written.push(file);
  }

  const expFile = path.join(assetsDir, "explosion.svg");
  fs.writeFileSync(expFile, explosionSvg());
  written.push(expFile);

  const flameFile = path.join(assetsDir, "rocket-flame.svg");
  fs.writeFileSync(flameFile, flameSvg());
  written.push(flameFile);

  return written;
}

// Run when invoked directly.
const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, "..", ".."); // scripts/sprites -> repo root
  const assetsDir = path.join(repoRoot, "public", "assets");
  const files = generate(assetsDir);
  console.log(`Wrote ${files.length} sprite files to ${assetsDir}:`);
  for (const f of files) console.log("  " + path.basename(f));
}
