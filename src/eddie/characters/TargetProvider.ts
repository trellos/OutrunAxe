// TargetProvider — where guns and rockets aim.
//
// Today this returns a random point in the "sky": pinned to the left or right
// screen edge, at a random height between the top of the screen and the top of
// the third measure-row (measures 8-11). This is the seam for enemies — when
// they arrive, swap `random()` to return live enemy positions and every gun /
// rocket starts targeting them with no other changes.

export interface Target {
  x: number;
  y: number;
}

export class TargetProvider {
  constructor(
    private resolveCell: (measure: number) => DOMRect | null,
    private edgeInset = 8,
  ) {}

  /** Top of the 3rd measure-row (measures 8-11) in viewport coords. Falls back
   *  to the upper third of the screen before the grid is measurable. */
  ceilingY(): number {
    for (const m of [8, 9, 10, 11]) {
      const r = this.resolveCell(m);
      if (r) return r.top;
    }
    return window.innerHeight * 0.3;
  }

  /** A random aim point on a randomly chosen side, above the ceiling line. */
  random(): Target {
    const x = Math.random() < 0.5 ? this.edgeInset : window.innerWidth - this.edgeInset;
    const ceil = this.ceilingY();
    const y = Math.random() * Math.max(0, ceil);
    return { x, y };
  }
}
