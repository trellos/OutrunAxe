// png.mjs — tiny dependency-free PNG encoder for the pixel-art sprite generators.
//
// Node's `zlib` is the only dependency (built in), so the sprite builders can
// emit real raster PNGs — which both the game's SpriteLoader (tries .png first)
// and an image-reading reviewer can consume — without pulling in sharp/canvas.
//
// Two entry points:
//   encodePNG(width, height, rgba)         -> Buffer   (8-bit RGBA, filter 0)
//   writePixelGrid(file, opts)             -> writes a crisp, scaled pixel-art
//                                             PNG from a low-res cell of "pixels"
//
// The pixel-art helper draws on a SMALL logical grid (e.g. 16×16 "design pixels")
// then nearest-neighbour upscales to the target cell size, so every design pixel
// becomes a clean square block — the chunky look of the reference art. No
// anti-aliasing, ever.

import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";

// --- CRC32 (PNG chunk checksums) -------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "latin1");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/**
 * Encode an 8-bit RGBA image to a PNG Buffer.
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array|Buffer} rgba  width*height*4 bytes, row-major, top-to-bottom
 * @returns {Buffer}
 */
export function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Raw scanlines, each prefixed with filter byte 0 (none).
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer ?? rgba, rgba.byteOffset ?? 0, rgba.length).copy(
      raw,
      y * (stride + 1) + 1,
      y * stride,
      y * stride + stride,
    );
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Parse "#rgb", "#rrggbb", "#rrggbbaa", or "transparent"/"" → [r,g,b,a]. */
export function parseColor(c) {
  if (!c || c === "transparent" || c === "none") return [0, 0, 0, 0];
  if (Array.isArray(c)) return [c[0], c[1], c[2], c[3] ?? 255];
  let h = c.replace("#", "");
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255;
  return [r, g, b, a];
}

/**
 * A small mutable logical pixel canvas. Set "design pixels" then `toPNG` /
 * `blitInto` upscales each by an integer factor (nearest-neighbour) so the
 * output is crisp blocky pixel-art.
 */
export class PixelCanvas {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h * 4); // all transparent
  }
  /** Set one design pixel (no-op if out of bounds). color = hex or [r,g,b,a]. */
  set(x, y, color) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const [r, g, b, a] = parseColor(color);
    const i = (y * this.w + x) * 4;
    this.data[i] = r; this.data[i + 1] = g; this.data[i + 2] = b; this.data[i + 3] = a;
  }
  /** Filled rectangle in design pixels. */
  rect(x, y, w, h, color) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, color);
  }
  /** Upscale by `scale` into a fresh RGBA buffer (nearest-neighbour). */
  toRGBA(scale) {
    const W = this.w * scale, H = this.h * scale;
    const out = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      const sy = Math.floor(y / scale);
      for (let x = 0; x < W; x++) {
        const sx = Math.floor(x / scale);
        const si = (sy * this.w + sx) * 4;
        const di = (y * W + x) * 4;
        out[di] = this.data[si];
        out[di + 1] = this.data[si + 1];
        out[di + 2] = this.data[si + 2];
        out[di + 3] = this.data[si + 3];
      }
    }
    return { W, H, rgba: out };
  }
  /** Blit this canvas (scaled) into a larger RGBA target at pixel (ox,oy). */
  blitInto(target, targetW, ox, oy, scale) {
    const { W, H, rgba } = this.toRGBA(scale);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const si = (y * W + x) * 4;
        if (rgba[si + 3] === 0) continue; // keep transparency
        const di = ((oy + y) * targetW + (ox + x)) * 4;
        target[di] = rgba[si];
        target[di + 1] = rgba[si + 1];
        target[di + 2] = rgba[si + 2];
        target[di + 3] = rgba[si + 3];
      }
    }
  }
  /** Encode this canvas (scaled) straight to a PNG buffer. */
  toPNG(scale) {
    const { W, H, rgba } = this.toRGBA(scale);
    return encodePNG(W, H, rgba);
  }
}

/** Write a PNG buffer to disk, creating parent dirs. */
export function writePNG(file, buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buffer);
  return file;
}
