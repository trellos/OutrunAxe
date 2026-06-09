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
    /** Scored measures the grid shows. Default 16 (Score Run); Battle passes 4
     *  for a single rolling row. Drives the grid layout AND the measure→cell
     *  resolution used for fire/particle/crowd placement. */
    gridMeasures?: number;
    /** Draw the count-in/warm-up intro row? Default true (Score Run); Battle
     *  passes false. Affects cell-index math here too. */
    gridIntroRow?: boolean;
    /** Battle mode for the crowd: sharks spawn and the dudes fight in the water. */
    crowdBattle?: boolean;
    /** Battle: the people line as a fraction of viewport height (≈0.8). */
    crowdGroundFraction?: number;
    /** Battle scorekeeping. */
    onSharkKilled?: () => void;
    onDudeEaten?: () => void;
  }): void;
  update(dt: number, audioTime: number): void;
  setActiveMeasure(scoredMeasure: number): void;
  /** Battle: advance one beat (spawns a shark). No-op outside battle. */
  battleBeat(): void;
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
  /** Scored measures shown (16 Score Run; 4 Battle). Used to fold absolute
   *  measures into the rolling cell window in resolveCell/resolveNoteOrigin. */
  private gridMeasures = 16;
  /** Whether the grid has a top intro row (shifts scored cells down one row). */
  private gridIntroRow = true;

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
    gridMeasures?: number;
    gridIntroRow?: boolean;
    crowdBattle?: boolean;
    crowdGroundFraction?: number;
    onSharkKilled?: () => void;
    onDudeEaten?: () => void;
  }): void {
    this.gridMeasures = Math.max(4, ctx.gridMeasures ?? 16);
    this.gridIntroRow = ctx.gridIntroRow ?? true;
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
      scoredMeasures: this.gridMeasures,
      introRow: this.gridIntroRow,
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
      battle: ctx.crowdBattle,
      groundFraction: ctx.crowdGroundFraction,
      onSharkKilled: ctx.onSharkKilled,
      onDudeEaten: ctx.onDudeEaten,
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

  /** Cell count for the configured grid: (intro row?) + ceil(gridMeasures/4). */
  private cellCount(): number {
    return (Math.ceil(this.gridMeasures / 4) + (this.gridIntroRow ? 1 : 0)) * 4;
  }

  /** Row-major cell index for an ABSOLUTE measure, folded into the rolling
   *  window (identity for Score Run). Scored measure s lives at row
   *  floor(s/4)+introOffset. */
  private cellIndexFor(measure: number): number {
    const s = ((measure % this.gridMeasures) + this.gridMeasures) % this.gridMeasures;
    return (Math.floor(s / 4) + (this.gridIntroRow ? 1 : 0)) * 4 + (s % 4);
  }

  private resolveCell(measure: number): DOMRect | null {
    if (!this.hudRoot || measure < 0) return null;
    const cells = this.hudRoot.querySelectorAll<HTMLDivElement>(".eddie-cell");
    if (cells.length < this.cellCount()) return null;
    return cells[this.cellIndexFor(measure)]?.getBoundingClientRect() ?? null;
  }

  resolveNoteOrigin(measure: number, beat: number): { x: number; y: number } | null {
    if (!this.hudRoot || measure < 0) return null;
    const cells = this.hudRoot.querySelectorAll<HTMLDivElement>(".eddie-cell");
    if (cells.length < this.cellCount()) return null;
    const cell = cells[this.cellIndexFor(measure)];
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

  battleBeat(): void {
    this.characters?.battleBeat();
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
