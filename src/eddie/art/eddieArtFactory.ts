// eddieArtFactory — the stable integration surface (GDD §8). Gameplay imports
// ONLY this. createEddieArt(variant) returns one EddieArtRig that composes the
// five art assets (grid, background, fire, particles, score readout + play button
// lives separately on the settings screen). The `variant` arg is the stable type
// surface; the live variant is selected by the checked-out branch (one variant
// per branch, GDD §12) which swaps the asset implementations wired below.
//
// This file owns the rig-level score readout DOM and wires the cross-asset
// callbacks: fire resolves a measure's cell rect from the grid; particles resolve
// the score readout position. Visuals only — the rig NEVER decides scoring or
// reads note timing; everything arrives through the juice bus + update(dt).

import type * as THREE from "three";
import type { EventBus } from "../../engine/EventBus";
import type { EddieConfig, EddieJuiceEvents } from "../../music/eddie/eddieTypes";
import "./eddie.css";
import { EddieGrid } from "./EddieGrid";
import { EddieFire } from "./EddieFire";
import { backgroundByIndex } from "./backgrounds/registry";
import { particlesByIndex } from "./particles/registry";
import type { EddieBackgroundVariant } from "./backgrounds/types";
import type { EddieParticlesVariant } from "./particles/types";
import { CharacterManager } from "../characters/CharacterManager";

export interface EddieArtRig {
  /** Build DOM/scene objects. `hudParent` is the HUD div; `scene` is the
   *  worldScene for the 3D background. Reads config for grid layout + tags. */
  mount(ctx: {
    hudParent: HTMLElement;
    scene: THREE.Scene;
    config: EddieConfig;
    juice: EventBus<EddieJuiceEvents>;
    /** Optional camera for the background to park/shake. The play state may
     *  pass renderer.worldCamera; the debug gallery passes its own. */
    camera?: THREE.PerspectiveCamera;
    /** 0-based registry index for the background variant (default 0). The debug
     *  gallery sets this from ?bg=N; the play state uses the production default. */
    bgIndex?: number;
    /** 0-based registry index for the particles variant (default 0; ?fx=N). */
    fxIndex?: number;
  }): void;
  update(dt: number, audioTime: number): void;
  setActiveMeasure(scoredMeasure: number): void;
  /** Screen-space origin for score particles: the centre of the just-played note
   *  bars in the scored quarter (measure 0..15, beat 0..3), so particles fly out
   *  of the notes that earned the points. Null if it can't be resolved (the play
   *  state then falls back to a default). */
  resolveNoteOrigin(measure: number, beat: number): { x: number; y: number } | null;
  dispose(): void;
}

export type EddieArtVariant = "option-1" | "option-2" | "option-3";

class EddieArtRigImpl implements EddieArtRig {
  private grid = new EddieGrid();
  private fire = new EddieFire();
  private background: EddieBackgroundVariant | null = null;
  private particles: EddieParticlesVariant | null = null;
  private characters: CharacterManager | null = null;

  private hudRoot: HTMLDivElement | null = null;
  private scoreValueEl: HTMLDivElement | null = null;
  private offScorePop?: () => void;

  mount(ctx: {
    hudParent: HTMLElement;
    scene: THREE.Scene;
    config: EddieConfig;
    juice: EventBus<EddieJuiceEvents>;
    camera?: THREE.PerspectiveCamera;
    bgIndex?: number;
    fxIndex?: number;
  }): void {
    // A single scoped root so dispose() can guarantee zero leaked DOM and the
    // CSS custom properties (--eddie-*) cascade to every child.
    const root = document.createElement("div");
    root.className = "eddie-root";
    ctx.hudParent.appendChild(root);
    this.hudRoot = root;

    // Score readout (owned by the rig; particles fly to it).
    const score = document.createElement("div");
    score.className = "eddie-score";
    const label = document.createElement("div");
    label.className = "eddie-score-label";
    label.textContent = "SCORE";
    const value = document.createElement("div");
    value.className = "eddie-score-value";
    value.textContent = "0";
    score.append(label, value);
    root.appendChild(score);
    this.scoreValueEl = value;

    this.background = backgroundByIndex(ctx.bgIndex ?? 0).create();
    this.background.mount({ scene: ctx.scene, camera: ctx.camera, juice: ctx.juice });
    this.grid.mount({
      hudParent: root,
      config: ctx.config,
      juice: ctx.juice,
      onQuarterDiamonds: (info) => this.characters?.onQuarterDiamonds(info),
    });
    this.fire.mount({
      hudParent: root,
      juice: ctx.juice,
      resolveCell: (measure) => this.resolveCell(measure),
    });
    this.characters = new CharacterManager({
      juice: ctx.juice,
      hudParent: root,
      resolveCell: (measure) => this.resolveCell(measure),
      beatDuration: 60 / ctx.config.bpm,
    });
    this.characters.mount();
    this.particles = particlesByIndex(ctx.fxIndex ?? 0).create();
    this.particles.mount({
      hudParent: root,
      juice: ctx.juice,
      resolveScore: () => this.resolveScore(),
    });

    this.offScorePop = ctx.juice.on("eddieScorePop", (e) => this.onScorePop(e.total));
  }

  private resolveCell(measure: number): DOMRect | null {
    // Grid renders one DOM cell per measure; find it by the scored index. The
    // grid's cells are row-major; scored measure m lives at row floor(m/4)+1.
    if (!this.hudRoot) return null;
    const cells = this.hudRoot.querySelectorAll<HTMLDivElement>(".eddie-cell");
    if (cells.length < 20) return null;
    if (measure < 0 || measure > 15) return null;
    const row = Math.floor(measure / 4) + 1;
    const col = measure % 4;
    const idx = row * 4 + col;
    return cells[idx]?.getBoundingClientRect() ?? null;
  }

  resolveNoteOrigin(measure: number, beat: number): { x: number; y: number } | null {
    if (!this.hudRoot || measure < 0 || measure > 15) return null;
    const cells = this.hudRoot.querySelectorAll<HTMLDivElement>(".eddie-cell");
    if (cells.length < 20) return null;
    const row = Math.floor(measure / 4) + 1;
    const col = measure % 4;
    const cell = cells[row * 4 + col];
    if (!cell) return null;
    // Average the centres of the in-key note bars the player played in this
    // quarter (out-of-key bars earned nothing, so they don't emit particles).
    let sx = 0, sy = 0, n = 0;
    cell.querySelectorAll<HTMLElement>(`.eddie-note[data-beat="${beat}"]`).forEach((bar) => {
      if (bar.classList.contains("eddie-note-off")) return;
      const r = bar.getBoundingClientRect();
      sx += r.left + r.width / 2;
      sy += r.top + r.height / 2;
      n++;
    });
    if (n > 0) return { x: sx / n, y: sy / n };
    // Fallback: the centre of the scored quarter's column within the cell.
    const cr = cell.getBoundingClientRect();
    return { x: cr.left + cr.width * ((beat + 0.5) / 4), y: cr.top + cr.height / 2 };
  }

  private resolveScore(): { x: number; y: number } {
    if (!this.scoreValueEl) return { x: window.innerWidth - 60, y: 40 };
    const r = this.scoreValueEl.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  private onScorePop(total: number): void {
    if (!this.scoreValueEl) return;
    this.scoreValueEl.textContent = `${Math.round(total)}`;
    this.scoreValueEl.classList.remove("eddie-score-pop");
    void this.scoreValueEl.offsetWidth; // restart the animation
    this.scoreValueEl.classList.add("eddie-score-pop");
  }

  update(dt: number, audioTime: number): void {
    this.background?.update(dt, audioTime);
    this.grid.update(dt);
    this.fire.update(dt);
    this.characters?.update(dt);
    this.particles?.update(dt);
  }

  setActiveMeasure(scoredMeasure: number): void {
    this.grid.setActiveMeasure(scoredMeasure);
    this.characters?.setActiveMeasure(scoredMeasure);
  }

  dispose(): void {
    this.offScorePop?.();
    this.offScorePop = undefined;
    this.particles?.dispose();
    this.characters?.dispose();
    this.fire.dispose();
    this.grid.dispose();
    this.background?.dispose();
    this.particles = null;
    this.characters = null;
    this.background = null;
    this.scoreValueEl = null;
    this.hudRoot?.remove();
    this.hudRoot = null;
  }
}

export function createEddieArt(_variant: EddieArtVariant): EddieArtRig {
  // option-1 baseline. option-2 / option-3 branches swap the composed asset
  // implementations (the live variant is selected by the checked-out branch).
  return new EddieArtRigImpl();
}
