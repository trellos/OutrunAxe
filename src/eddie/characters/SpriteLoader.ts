// SpriteLoader — load and cache character spritesheets.
//
// Loads SVG or PNG spritesheets. Attempts PNG first (production),
// falls back to SVG (dev/placeholder). Caches loaded images.

const CACHE = new Map<string, Promise<HTMLImageElement | SVGImageElement>>();

/** Sprite sheet ID. Dudes are `${size}-${quality}` with an optional gun-variant
 *  suffix (`-gunL`/`-gunR`/`-gunLR`); props/FX are named directly
 *  (`gun-floor`, `rocket-1..3`, `rocket-flame`, `explosion`). Kept as a string
 *  so the dude × gun-variant matrix doesn't need an exhaustive union. */
export type SpriteSheetId = string;

/**
 * Load a spritesheet. Returns a promise resolving to an image element
 * (either SVG or PNG). Cached per ID.
 */
export function loadSpriteSheet(id: SpriteSheetId): Promise<HTMLImageElement | SVGImageElement> {
  let pending = CACHE.get(id);
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      // Try PNG first
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => {
        // Fallback to SVG
        const svg = new Image();
        svg.onload = () => resolve(svg);
        svg.onerror = () => reject(new Error(`Failed to load sprite sheet: ${id}`));
        svg.src = `/assets/${id}.svg`;
      };
      img.src = `/assets/${id}.png`;
    });
    CACHE.set(id, pending);
  }
  return pending;
}

/** Clear the sprite sheet cache. */
export function clearSpriteCache(): void {
  CACHE.clear();
}
