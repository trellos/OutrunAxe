// Short-lived visual effects: laser beams, rocket-trail sparks, explosions.
//
// All effects share one tiny contract so the manager can hold them in a single
// pool: `update(dt)` returns true when the effect is finished (and has cleaned
// itself up).

import { loadSpriteSheet } from "./SpriteLoader";

export interface Effect {
  /** Advance the effect; return true once it is finished. */
  update(dt: number): boolean;
  /** Force-remove (manager dispose). */
  dispose(): void;
}

/** A laser beam: a bright line from a gun muzzle to its target that lingers
 *  just long enough to be seen, then fades. */
export class Beam implements Effect {
  private el: HTMLDivElement;
  private life = 0;
  private readonly maxLife = 0.14;

  constructor(
    container: HTMLElement,
    from: { x: number; y: number },
    to: { x: number; y: number },
    color = "#ff4d4d",
  ) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

    this.el = document.createElement("div");
    this.el.className = "eddie-beam";
    this.el.style.cssText =
      `position:absolute;left:${from.x}px;top:${from.y}px;` +
      `width:${len}px;height:3px;` +
      `background:linear-gradient(90deg,#fff,${color});` +
      `box-shadow:0 0 6px ${color},0 0 12px ${color};` +
      `transform-origin:0 50%;transform:rotate(${angle}deg);` +
      `pointer-events:none;border-radius:2px;`;
    container.appendChild(this.el);
  }

  update(dt: number): boolean {
    this.life += dt;
    const k = this.life / this.maxLife;
    if (k >= 1) {
      this.dispose();
      return true;
    }
    // Bright flash that thins + fades.
    this.el.style.opacity = String(1 - k);
    this.el.style.height = `${(3 * (1 - k * 0.6)).toFixed(2)}px`;
    return false;
  }

  dispose(): void {
    this.el.remove();
  }
}

/** A fire-trail spark: a little glowing blob that drifts, shrinks, and fades.
 *  Spewed behind a flying rocket. */
export class Spark implements Effect {
  private el: HTMLDivElement;
  private life = 0;
  private maxLife: number;
  private x: number;
  private y: number;
  private vx: number;
  private vy: number;
  private size: number;

  constructor(
    container: HTMLElement,
    x: number,
    y: number,
    vx = (Math.random() - 0.5) * 40,
    vy = (Math.random() - 0.5) * 40,
  ) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.size = 4 + Math.random() * 6;
    this.maxLife = 0.35 + Math.random() * 0.3;

    const hue = 20 + Math.random() * 35; // orange→yellow
    this.el = document.createElement("div");
    this.el.className = "eddie-spark";
    this.el.style.cssText =
      `position:absolute;width:${this.size}px;height:${this.size}px;` +
      `border-radius:50%;pointer-events:none;` +
      `background:radial-gradient(circle,#fff 0%,hsl(${hue},100%,60%) 45%,hsla(${hue},100%,45%,0) 75%);`;
    container.appendChild(this.el);
    this.render();
  }

  update(dt: number): boolean {
    this.life += dt;
    const k = this.life / this.maxLife;
    if (k >= 1) {
      this.dispose();
      return true;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vy += 60 * dt; // gentle gravity so sparks rain down
    this.el.style.opacity = String(1 - k);
    this.el.style.transform = `scale(${(1 - k * 0.7).toFixed(2)})`;
    this.render();
    return false;
  }

  private render(): void {
    this.el.style.left = `${this.x - this.size / 2}px`;
    this.el.style.top = `${this.y - this.size / 2}px`;
  }

  dispose(): void {
    this.el.remove();
  }
}

/** A big boom: plays the 6-frame explosion sheet over its lifetime, scaling up
 *  as it goes. Falls back to a CSS flash until/if the sheet fails to load. */
export class Explosion implements Effect {
  private el: HTMLDivElement;
  private life = 0;
  private readonly maxLife = 0.55;
  private readonly frames = 6;
  private readonly displaySize: number;
  private sheet: HTMLImageElement | SVGImageElement | null = null;

  constructor(container: HTMLElement, x: number, y: number, scale = 1) {
    this.displaySize = 90 * scale;
    this.el = document.createElement("div");
    this.el.className = "eddie-explosion";
    this.el.style.cssText =
      `position:absolute;left:${x - this.displaySize / 2}px;top:${y - this.displaySize / 2}px;` +
      `width:${this.displaySize}px;height:${this.displaySize}px;` +
      `pointer-events:none;background-repeat:no-repeat;`;
    // CSS fallback flash (shows immediately, replaced once the sheet loads).
    this.el.style.background =
      "radial-gradient(circle,#fff 0%,#ffd34d 30%,#ff6a1e 55%,rgba(255,106,30,0) 75%)";
    container.appendChild(this.el);

    loadSpriteSheet("explosion")
      .then((img) => {
        this.sheet = img;
        this.el.style.background = "none";
        this.el.style.backgroundImage = `url(${(img as HTMLImageElement).src})`;
        // Sheet is 6 frames wide, 1 tall → scale to (6*size) x size.
        this.el.style.backgroundSize = `${this.displaySize * this.frames}px ${this.displaySize}px`;
      })
      .catch(() => {
        /* keep the CSS flash */
      });
  }

  update(dt: number): boolean {
    this.life += dt;
    const k = this.life / this.maxLife;
    if (k >= 1) {
      this.dispose();
      return true;
    }
    if (this.sheet) {
      const frame = Math.min(this.frames - 1, Math.floor(k * this.frames));
      this.el.style.backgroundPosition = `-${frame * this.displaySize}px 0`;
    } else {
      // Fallback flash: expand + fade.
      this.el.style.transform = `scale(${(0.5 + k).toFixed(2)})`;
      this.el.style.opacity = String(1 - k);
    }
    return false;
  }

  dispose(): void {
    this.el.remove();
  }
}
