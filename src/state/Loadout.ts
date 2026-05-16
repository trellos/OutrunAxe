export type OutfitId = "rocker70s" | "emo90s" | "genz20s";
export type GuitarId = "goldtop" | "blackstrat" | "jazzmaster";
export type MainId = "main-gunslinger" | "main-silva" | "main-metal";

export interface Loadout {
  /** Selected Killer7 main character (registry id). */
  character: MainId;
  /** Variant id within that character (v1/v2/v3). */
  variant: string;
  guitar: GuitarId;
  /** Legacy palette key — kept for the cel-shade fallback path only. */
  outfit: OutfitId;
}

export const MAINS: { id: MainId; label: string; tag: string }[] = [
  { id: "main-gunslinger", label: "80s Gunslinger", tag: "shirt open, big hair" },
  { id: "main-silva", label: "Skinny Singer", tag: "crop tee, long legs" },
  { id: "main-metal", label: "Metal", tag: "biceps, all black" },
];

export const VARIANTS: { id: string; label: string }[] = [
  { id: "v1", label: "Variant 1" },
  { id: "v2", label: "Variant 2" },
  { id: "v3", label: "Variant 3" },
];

export const OUTFITS: { id: OutfitId; label: string; tag: string }[] = [
  { id: "rocker70s", label: "Sunset Strip '78", tag: "denim & bandana" },
  { id: "emo90s", label: "Basement Tape '94", tag: "black hoodie, eyeliner" },
  { id: "genz20s", label: "Bedroom Pop '24", tag: "oversized cardigan" },
];

export const GUITARS: { id: GuitarId; label: string; tag: string }[] = [
  { id: "goldtop", label: "Goldtop LP", tag: "warm humbuckers" },
  { id: "blackstrat", label: "Black Strat", tag: "biting single-coil" },
  { id: "jazzmaster", label: "Pastel Jazzmaster", tag: "shimmer reverb" },
];

const KEY = "outrunaxe.loadout";

const DEFAULT_LOADOUT: Loadout = {
  character: "main-gunslinger",
  variant: "v1",
  guitar: "goldtop",
  outfit: "rocker70s",
};

export function loadLoadout(): Loadout {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Loadout>;
      return {
        character: parsed.character ?? DEFAULT_LOADOUT.character,
        variant: parsed.variant ?? DEFAULT_LOADOUT.variant,
        guitar: parsed.guitar ?? DEFAULT_LOADOUT.guitar,
        outfit: parsed.outfit ?? DEFAULT_LOADOUT.outfit,
      };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_LOADOUT };
}

export function saveLoadout(l: Loadout) {
  try {
    localStorage.setItem(KEY, JSON.stringify(l));
  } catch {
    // ignore
  }
}

export const OUTFIT_PALETTE: Record<OutfitId, {
  jacket: number; shirt: number; pants: number; hair: number; skin: number;
  accent: number;
}> = {
  rocker70s: {
    jacket: 0x2b3a8a,
    shirt: 0xc62121,
    pants: 0x18203f,
    hair: 0x6b3a18,
    skin: 0xd9a884,
    accent: 0xeac247,
  },
  emo90s: {
    jacket: 0x141414,
    shirt: 0x222033,
    pants: 0x1a1620,
    hair: 0x080608,
    skin: 0xc7a7ab,
    accent: 0xa72bff,
  },
  genz20s: {
    jacket: 0xd6c1a8,
    shirt: 0xf5d1e0,
    pants: 0x6b6f78,
    hair: 0xff7eb6,
    skin: 0xddb6a0,
    accent: 0x9ad8e6,
  },
};

export const GUITAR_PALETTE: Record<GuitarId, {
  body: number; neck: number; headstock: number; pickguard: number;
}> = {
  goldtop: {
    body: 0xc99a3a,
    neck: 0x5a341a,
    headstock: 0x3a2010,
    pickguard: 0x080604,
  },
  blackstrat: {
    body: 0x0c0c10,
    neck: 0xd9a766,
    headstock: 0xa97c44,
    pickguard: 0xeae8d8,
  },
  jazzmaster: {
    body: 0xb9d4e8,
    neck: 0xd9a766,
    headstock: 0xa97c44,
    pickguard: 0xf9eed0,
  },
};
