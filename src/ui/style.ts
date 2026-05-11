// Single source of truth for visual style. Swap STYLE to "A" / "B" / "C" to try
// the three art directions from the plan. v0 ships with B (synthwave) by default.

export type StyleName = "A" | "B" | "C";

export const STYLE: StyleName = "B";

export const palette = {
  A: {
    bg: 0x161616,
    barFill: 0x1f1f1f,
    barStroke: 0x3a3a3a,
    activeStroke: 0x00d9ff,
    activeFill: 0x0f2a33,
    beatLine: 0x2a2a2a,
    note: 0xffffff,
    text: "#e8e8e8",
    accent: "#00d9ff",
  },
  B: {
    bg: 0x0a0612,
    barFill: 0x1a0f2e,
    barStroke: 0x4a2a7a,
    activeStroke: 0xff2bd6,
    activeFill: 0x2a1145,
    beatLine: 0x3a1f5e,
    note: 0x00f0ff,
    text: "#f0e6ff",
    accent: "#ff2bd6",
  },
  C: {
    bg: 0xf4ecd8,
    barFill: 0xfaf5e4,
    barStroke: 0x2a2418,
    activeStroke: 0x8a3a2a,
    activeFill: 0xfff8e2,
    beatLine: 0xc8b890,
    note: 0x1a1410,
    text: "#2a2418",
    accent: "#8a3a2a",
  },
} as const;

export const colors = palette[STYLE];
