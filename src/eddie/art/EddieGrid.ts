// EddieGrid — the 5-row x 4-measure timeline grid (GDD §8, §13).
//
// 20 cells: row 0 = 4 intro/warm-up measures (visually DEPRIORITIZED), rows 1-4
// = the 16 scored measures (scored measure index = (row-1)*4 + col). The active
// (currently-recording) cell is highlighted unmistakably. The 8th- and 16th-note
// tag badges are rendered from config.eighthTagMeasure / sixteenthTagMeasure; the
// 16th tag is an obvious visual UPGRADE over the 8th tag. Bass-note labels sit
// above the measure where each chord starts (config.bassline).
//
// HARD RULE (AGENTS.md Infinite Eddie #1): each cell is a NOTE TIMELINE, not a
// label. The notes the player plays are plotted INSIDE the cell (x = position in
// the measure, y = pitch) via the eddieNote juice event. Each cell now contains
// 13 horizontal pitch-class lanes (the key's octave, folded by semitone class).
// Chord tones (root, 3rd, 5th) get subtle background darkening.
//
// VARIANT option-1: "chunky neon-bordered cells" — solid DOM cells with thick
// neon borders, the active cell lifting + glowing magenta. Pure DOM/CSS so
// dispose() simply removes the root (zero Three.js resources).

import type { EventBus } from "../../engine/EventBus";
import type { EddieConfig, EddieJuiceEvents } from "../../music/eddie/eddieTypes";
import { NOTE_NAMES } from "../../audio/midi";

const ROWS = 5;
const COLS = 4;
const PITCH_LANES = 13; // 0..12: key root to octave+1

// Color palette
const COLOR_ROOT = "#FFC837"; // Bright gold
const COLOR_STRONG = "#FF6B9D"; // Hot pink (3rd/5th)
const COLOR_WEAK = "#FFB84D"; // Warm orange
const COLOR_BOGUS = "#ff5a6e"; // Red/pink (out-of-key)
const COLOR_CHORD_TINT_DARK = "#2D1B3D"; // Deep purple (bass row)
const COLOR_CHORD_TINT_MEDIUM = "#4A2E5A"; // Lighter purple (3rd/5th rows)

// Chord tone row background tints
const CHORD_ROW_ALPHA = 0.25;
const CHORD_3RD_5TH_ALPHA = 0.12;

export class EddieGrid {
  private root: HTMLDivElement | null = null;
  private cells: HTMLDivElement[] = []; // 20 cells, row-major (row*COLS + col)
  private noteLayers: HTMLDivElement[] = []; // per-cell note-plot layer
  private activeScored = -1;
  private offBeat?: () => void;
  private offNote?: () => void;
  private offNoteEnd?: () => void;
  private offScored?: () => void;
  /** onset id → its plotted note bar, so a later eddieNoteEnd can grow it. */
  private noteBars = new Map<number, { el: HTMLDivElement; startFrac: number }>();
  // Pulse phase for a subtle per-beat breathing of the active cell border.
  private pulse = 0;
  /** Birth shimmer particles for notes. */
  private birthParticles: Array<{ el: HTMLDivElement; age: number; lifetime: number }> = [];

  // Configuration
  private keyRoot: string = "C";
  private pitchClassToLane = new Map<string, number>();
  // Per-measure chord tones: measure index → [root lane, 3rd lane, 5th lane]
  private chordTonesByMeasure = new Map<number, number[]>();

  mount(ctx: {
    hudParent: HTMLElement;
    config: EddieConfig;
    juice: EventBus<EddieJuiceEvents>;
  }): void {
    const root = document.createElement("div");
    root.className = "eddie-grid";

    // Initialize key and pitch-class → lane mapping
    this.keyRoot = ctx.config.keyRoot;
    this.initializePitchClassLanes();

    // Pre-compute chord tone lanes for each measure (used for darkening)
    // The bassline loops every 4 measures, so pattern measure m % 4 applies to measure m
    const chordRootByPatternMeasure = new Map<number, string>();
    for (const n of ctx.config.bassline) {
      if (n.beat === 0 && !chordRootByPatternMeasure.has(n.measure)) {
        chordRootByPatternMeasure.set(n.measure, n.pitchClass);
        // Store the chord tones (root, 3rd, 5th) as lane numbers
        const rootLane = this.pitchClassToLane.get(n.pitchClass) ?? 0;
        const chordToneLanes = [rootLane];
        for (const pc of n.chordTones) {
          const lane = this.pitchClassToLane.get(pc) ?? 0;
          if (!chordToneLanes.includes(lane)) {
            chordToneLanes.push(lane);
          }
        }
        // Store for measures 0..15 and also loop back to 16..19 (intro would not use this)
        for (let m = n.measure; m < 20; m += 4) {
          this.chordTonesByMeasure.set(m, chordToneLanes);
        }
      }
    }

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const cell = document.createElement("div");
        cell.className = "eddie-cell";
        // The cell body hosts the note plot, so it must be a positioning context.
        cell.style.position = "relative";
        const isIntro = row === 0;
        if (isIntro) cell.classList.add("eddie-cell-intro");

        // Subdivision level for this cell's gridlines: quarters everywhere, plus
        // eighths in the 8th-tagged measure and sixteenths in the 16th-tagged one.
        let subdivision: 4 | 8 | 16 = 4;
        if (!isIntro) {
          const scored = (row - 1) * COLS + col;

          // Bass label above measures that start a chord span.
          const rootPc = chordRootByPatternMeasure.get(scored % 4);
          if (rootPc) {
            const bass = document.createElement("div");
            bass.className = "eddie-cell-bass";
            bass.textContent = rootPc;
            cell.appendChild(bass);
          }

          // Tag badges.
          if (scored === ctx.config.eighthTagMeasure) {
            subdivision = 8;
            const tag = document.createElement("div");
            tag.className = "eddie-tag eddie-tag-eighth";
            tag.textContent = "8TH";
            cell.appendChild(tag);
          }
          if (scored === ctx.config.sixteenthTagMeasure) {
            subdivision = 16;
            const tag = document.createElement("div");
            tag.className = "eddie-tag eddie-tag-sixteenth";
            tag.textContent = "16TH!";
            cell.appendChild(tag);
          }
        }

        // The note-plot layer: where played notes are drawn (see plotNote).
        const notes = document.createElement("div");
        notes.className = "eddie-cell-notes";
        notes.style.cssText =
          "position:absolute;inset:0;overflow:hidden;pointer-events:none;";

        // Add chord-tone row background tints (if not intro)
        if (!isIntro) {
          const scored = (row - 1) * COLS + col;
          this.addChordRowTints(notes, scored);
        }

        this.buildGridlines(notes, subdivision);
        cell.appendChild(notes);
        this.noteLayers.push(notes);

        root.appendChild(cell);
        this.cells.push(cell);
      }
    }

    ctx.hudParent.appendChild(root);
    this.root = root;

    // Beat pulse drives the active-cell breathing.
    this.offBeat = ctx.juice.on("eddieBeatPulse", () => {
      this.pulse = 1;
    });

    // Played notes are plotted into their measure cell — the whole point of the
    // grid is to visualize what the player played across the timeline.
    this.offNote = ctx.juice.on("eddieNote", (n) => this.plotNote(n));
    this.offNoteEnd = ctx.juice.on("eddieNoteEnd", (e) => this.endNote(e));
    this.offScored = ctx.juice.on("eddieNoteScored", (s) => this.greenQuarter(s.measure, s.beat));
  }

  /** Add chord-tone row background tints to a cell: darkened backgrounds for
   *  root, 3rd, and 5th rows so the harmonic context is always visible. */
  private addChordRowTints(layer: HTMLDivElement, measure: number): void {
    const chordTones = this.chordTonesByMeasure.get(measure);
    if (!chordTones || chordTones.length === 0) return;

    // Root is the first lane, 3rd/5th are any additional lanes
    const rootLane = chordTones[0];
    const strongLanes = chordTones.slice(1);

    // Draw a tint bar for the root (darkest)
    const rootBar = document.createElement("div");
    const rootY = 1 - (rootLane / (PITCH_LANES - 1)); // 0 = top, 1 = bottom
    const rootTop = rootY * 84 + 8; // same y-calculation as notes
    rootBar.style.cssText =
      `position:absolute;left:0;right:0;top:${rootTop.toFixed(1)}%;` +
      `height:8%;background:${COLOR_CHORD_TINT_DARK};opacity:${CHORD_ROW_ALPHA};` +
      `pointer-events:none;z-index:0;`;
    layer.appendChild(rootBar);

    // Draw tint bars for 3rd/5th (medium dark)
    for (const lane of strongLanes) {
      const y = 1 - (lane / (PITCH_LANES - 1));
      const top = y * 84 + 8;
      const bar = document.createElement("div");
      bar.style.cssText =
        `position:absolute;left:0;right:0;top:${top.toFixed(1)}%;` +
        `height:8%;background:${COLOR_CHORD_TINT_MEDIUM};opacity:${CHORD_3RD_5TH_ALPHA};` +
        `pointer-events:none;z-index:0;`;
      layer.appendChild(bar);
    }
  }

  /** Draw the beat/subdivision gridlines for a cell. Quarter lines are bold;
   *  eighth/sixteenth lines (in the tagged measures) are progressively fainter
   *  so the quarter grid still reads clearly underneath the finer divisions. */
  private buildGridlines(layer: HTMLDivElement, subdivision: 4 | 8 | 16): void {
    for (let i = 1; i < subdivision; i++) {
      const isQuarter = (i * 4) % subdivision === 0;
      const isEighth = !isQuarter && (i * 8) % subdivision === 0;
      const line = document.createElement("div");
      const color = isQuarter
        ? "rgba(120,230,255,0.55)" // bold quarter divisions
        : isEighth
          ? "rgba(255,255,255,0.26)" // eighth subdivisions
          : "rgba(255,255,255,0.14)"; // sixteenth subdivisions
      const width = isQuarter ? 2 : 1;
      line.style.cssText =
        `position:absolute;top:6%;bottom:6%;left:${((i / subdivision) * 100).toFixed(2)}%;` +
        `width:${width}px;margin-left:${-width / 2}px;background:${color};z-index:2;`;
      layer.appendChild(line);
    }
  }

  /** Initialize pitch-class → lane mapping for the current key. */
  private initializePitchClassLanes(): void {
    const keyRootIndex = NOTE_NAMES.indexOf(this.keyRoot as any);
    this.pitchClassToLane.clear();
    for (let i = 0; i < 12; i++) {
      const pitchClass = NOTE_NAMES[(keyRootIndex + i) % 12];
      // Lane 0 = root, lanes 1..11 = next 11 semitones, lane 12 = octave+1
      // But display as 0..12 where 12 is the top (key root again)
      this.pitchClassToLane.set(pitchClass, i);
    }
    // Add octave+1 mapping (same pitch class as root)
    this.pitchClassToLane.set(this.keyRoot, PITCH_LANES - 1);
  }

  /** Plot OR update a note bar. Called first at the onset (provisional pitch, so
   *  every played note shows immediately — fast notes that never settle a pitch
   *  still appear), then again as the pitch resolves to set the lane + color.
   *  Idempotent per onsetId so the second call updates rather than duplicates. */
  private plotNote(n: EddieJuiceEvents["eddieNote"]): void {
    const idx = this.indexFor(n.measure);
    const layer = idx >= 0 ? this.noteLayers[idx] : null;
    if (!layer) return;

    const x = Math.max(0, Math.min(1, n.beatFraction));
    // Map MIDI to pitch-class lane (fold into 0..12)
    const pitchClass = NOTE_NAMES[((n.midi % 12) + 12) % 12];
    const lane = this.pitchClassToLane.get(pitchClass) ?? 0;
    const y = 1 - (lane / (PITCH_LANES - 1)); // 0 = top (lane 0), 1 = bottom (lane 12)
    const color = this.getNoteColor(n);

    const existing = n.onsetId >= 0 ? this.noteBars.get(n.onsetId) : undefined;
    if (existing) {
      // Pitch resolved/changed — move to the right lane + recolor. Don't touch a
      // bar that already scored green.
      const bar = existing.el;
      if (!bar.classList.contains("eddie-note-scored")) {
        bar.style.top = `${(y * 84 + 8).toFixed(1)}%`;
        bar.style.background = color;
        bar.style.boxShadow = `0 0 7px ${color},0 0 2px #fff`;
        bar.classList.toggle("eddie-note-off", !n.inKey);
      }
      return;
    }

    // A note is a horizontal duration BAR (onset → detected end via endNote).
    const bar = document.createElement("div");
    bar.className = "eddie-note" + (n.inKey ? "" : " eddie-note-off");
    bar.style.cssText =
      `position:absolute;left:${(x * 100).toFixed(2)}%;top:${(y * 84 + 8).toFixed(1)}%;` +
      "height:5px;margin-top:-2.5px;min-width:4px;width:4px;border-radius:3px;z-index:3;" +
      `background:${color};box-shadow:0 0 7px ${color},0 0 2px #fff;` +
      "opacity:0;transition:opacity .12s ease,width .08s linear;";
    // Tag the quarter (0..3) this note lands in, so a later score event can turn
    // the scoring quarter's bars green. Also store the in-measure position so the
    // scoring overlay can grade this note's timing against the subdivision grid.
    bar.dataset.beat = String(Math.min(3, Math.floor(x * 4)));
    bar.dataset.bf = String(x);
    layer.appendChild(bar);
    if (n.onsetId >= 0) this.noteBars.set(n.onsetId, { el: bar, startFrac: x });

    // Spawn birth shimmer particles before the bar solidifies
    this.spawnBirthParticles(layer, x * 100, y * 84 + 8);

    // Fade in on next frame for a soft pop as each note lands.
    requestAnimationFrame(() => {
      bar.style.opacity = "1";
    });
  }

  /** Grow a plotted note's bar to its detected end (within the start cell). The
   *  bar entry is KEPT (not deleted) so a late pitch update can still find it
   *  instead of spawning a duplicate. */
  private endNote(e: EddieJuiceEvents["eddieNoteEnd"]): void {
    const entry = this.noteBars.get(e.onsetId);
    if (!entry) return;
    const endFrac = Math.max(0, Math.min(1, e.endBeatFraction));
    const widthPct = Math.max(0, (endFrac - entry.startFrac) * 100);
    // Keep the 4px min-width stub for very short notes; otherwise size to span.
    if (widthPct > 0) entry.el.style.width = `${widthPct.toFixed(2)}%`;
  }

  /** Determine note bar color based on pitch class chord role. */
  private getNoteColor(n: EddieJuiceEvents["eddieNote"]): string {
    if (!n.inKey) return COLOR_BOGUS;

    const pitchClass = NOTE_NAMES[((n.midi % 12) + 12) % 12];

    // Check if it's a root note
    if (pitchClass === this.keyRoot) return COLOR_ROOT;

    // Check if it's a chord tone (3rd or 5th) from the current measure's bassline
    const measureChordTones = this.chordTonesByMeasure.get(n.measure);
    if (measureChordTones) {
      const lane = this.pitchClassToLane.get(pitchClass) ?? 0;
      // First element is root (handled above), check if lane matches 3rd or 5th
      if (measureChordTones.length > 1 && measureChordTones.slice(1).includes(lane)) {
        return COLOR_STRONG;
      }
    }

    return COLOR_WEAK;
  }

  /** Spawn 3 white shimmer particles at a note's birth position, fading over time. */
  private spawnBirthParticles(layer: HTMLDivElement, leftPct: number, topPct: number): void {
    const count = 3;
    for (let i = 0; i < count; i++) {
      const particle = document.createElement("div");
      const jx = (Math.random() - 0.5) * 20;
      const jy = (Math.random() - 0.5) * 20;
      particle.style.cssText =
        `position:absolute;left:${leftPct + jx}%;top:${topPct + jy}%;` +
        `width:3px;height:3px;border-radius:50%;background:#fff;` +
        `opacity:0.8;pointer-events:none;box-shadow:0 0 4px #fff;`;
      layer.appendChild(particle);
      this.birthParticles.push({
        el: particle,
        age: 0,
        lifetime: 0.25 + Math.random() * 0.1,
      });
    }
  }

  /** A quarter scored — turn its IN-KEY note bars green (out-of-key bars, which
   *  earned nothing, stay red) and lay a DIAMOND background across the whole
   *  quarter-note region (one of the cell's four columns). The number of diamonds
   *  spanning the region reflects the subdivision the player hit (1 = quarter,
   *  2 = eighths, 3 = triplets, 4 = sixteenths) and the colour reflects how
   *  tightly the notes landed on the grid. Works off the DOM so it catches bars
   *  whose eddieNoteEnd already fired (and were removed from noteBars). */
  private greenQuarter(measure: number, beat: number): void {
    const idx = this.indexFor(measure);
    const layer = idx >= 0 ? this.noteLayers[idx] : null;
    if (!layer) return;
    const want = String(beat);

    // Collect the in-key bars that landed in this quarter — they both drive the
    // subdivision count and the average timing quality.
    const bars: HTMLElement[] = [];
    for (const child of Array.from(layer.children)) {
      const el = child as HTMLElement;
      if (el.dataset.beat !== want) continue;
      if (el.classList.contains("eddie-note-off")) continue; // out-of-key: no score
      bars.push(el);
    }
    if (bars.length === 0) return;

    // Recolour the scored bars green (existing feedback).
    for (const el of bars) {
      el.classList.add("eddie-note-scored");
      el.style.background = "#39ff7a";
      el.style.boxShadow = "0 0 8px #39ff7a,0 0 2px #fff";
    }

    // One diamond region per quarter — skip if this quarter was already decorated.
    if (layer.querySelector(`.eddie-quarter-diamond[data-beat="${beat}"]`)) return;

    // Subdivision = how many notes were played in the quarter (clamped to the
    // sixteenth ceiling). Average timing quality drives the colour saturation.
    const subdiv = Math.max(1, Math.min(4, bars.length));
    let q = 0;
    for (const el of bars) q += this.timingQuality(parseFloat(el.dataset.bf ?? "0"));
    q /= bars.length;

    this.addQuarterDiamonds(layer, beat, subdiv, q);
  }

  /** Grade a note's timing: how close its in-measure position lands to the
   *  nearest musical subdivision point (eighth, sixteenth, or triplet) WITHIN its
   *  quarter. Returns 0 (loose) .. 1 (dead on the grid). */
  private timingQuality(beatFraction: number): number {
    // Position inside the quarter the note belongs to (0..1).
    const inQuarter = ((beatFraction * 4) % 1 + 1) % 1;
    // Ideal subdivision points a player might be aiming for, within one quarter.
    const targets = [
      0, 1, // quarter boundaries
      0.5, // eighth
      0.25, 0.75, // sixteenths
      1 / 3, 2 / 3, // triplets
    ];
    let best = 1;
    for (const t of targets) best = Math.min(best, Math.abs(inQuarter - t));
    // Worst-case nearest distance between the densest grid points is ~0.125.
    const maxErr = 0.125;
    return Math.max(0, Math.min(1, 1 - best / maxErr));
  }

  /** Fill a quarter-note region with a tall argyle diamond pattern. `subdiv`
   *  diamonds span the region's width; the colour interpolates from muted (loose
   *  timing) to vibrant gold (tight timing). Each tile is a single rhombus, so
   *  tiling yields touching diamonds alternating the success colour with the
   *  cell showing through between them (Bavarian argyle). */
  private addQuarterDiamonds(
    layer: HTMLDivElement,
    beat: number,
    subdiv: number,
    quality: number,
  ): void {
    // Interpolate the success colour from muted (loose) to vibrant gold (tight).
    const r = Math.round(150 + (255 - 150) * quality);
    const g = Math.round(135 + (215 - 135) * quality);
    const b = Math.round(70 + (0 - 70) * quality);
    const a = 0.5 + 0.4 * quality;
    const color = `rgba(${r},${g},${b},${a})`;

    // Geometry in pixels: the quarter is one of the cell's four columns.
    const cellW = layer.clientWidth;
    const cellH = layer.clientHeight;
    const quarterW = cellW / 4;
    const left = beat * quarterW;
    const insetY = cellH * 0.06;
    const regionH = cellH - insetY * 2;

    // `subdiv` diamonds across the quarter; tall (taller than wide) like argyle.
    const tileW = quarterW / subdiv;
    const tileH = Math.max(tileW * 1.7, 16);

    // One rhombus per tile, drawn as an inline SVG so tall diamonds tile exactly
    // (CSS-gradient diamonds only tile cleanly when square). The negative space
    // between rhombi forms the alternating transparent diamonds.
    const svg =
      `<svg xmlns='http://www.w3.org/2000/svg' width='${tileW.toFixed(2)}' height='${tileH.toFixed(2)}'>` +
      `<polygon points='${(tileW / 2).toFixed(2)},0 ${tileW.toFixed(2)},${(tileH / 2).toFixed(2)} ` +
      `${(tileW / 2).toFixed(2)},${tileH.toFixed(2)} 0,${(tileH / 2).toFixed(2)}' fill='${color}'/></svg>`;
    const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

    const diamond = document.createElement("div");
    diamond.className = "eddie-quarter-diamond";
    diamond.dataset.beat = String(beat);
    diamond.style.cssText =
      `position:absolute;left:${left}px;width:${quarterW}px;` +
      `top:${insetY}px;height:${regionH}px;` +
      `z-index:1;pointer-events:none;overflow:hidden;` +
      `opacity:0;transition:opacity .12s ease;` +
      `background-image:${url};background-repeat:repeat;` +
      `background-size:${tileW.toFixed(2)}px ${tileH.toFixed(2)}px;background-position:center top;`;
    // Insert at the front so it renders behind the note bars (z-index also
    // enforces this), but above the chord-tone tints (z-index 0).
    layer.insertBefore(diamond, layer.firstChild);
    requestAnimationFrame(() => {
      diamond.style.opacity = "1";
    });
  }

  /** scoredMeasure: 0..15 = a scored cell (rows 1-4); negative = intro row 0,
   *  where -1..-4 picks intro column 0..3. */
  setActiveMeasure(scoredMeasure: number): void {
    this.activeScored = scoredMeasure;
    const activeIdx = this.indexFor(scoredMeasure);
    for (let i = 0; i < this.cells.length; i++) {
      this.cells[i].classList.toggle("eddie-cell-active", i === activeIdx);
    }
  }

  private indexFor(scoredMeasure: number): number {
    if (scoredMeasure < 0) {
      const col = (-scoredMeasure - 1) % COLS; // -1 -> col 0
      return col; // row 0
    }
    if (scoredMeasure > 15) return -1;
    const row = Math.floor(scoredMeasure / COLS) + 1;
    const col = scoredMeasure % COLS;
    return row * COLS + col;
  }

  update(dt: number): void {
    if (this.pulse > 0) {
      this.pulse = Math.max(0, this.pulse - dt * 4);
      const idx = this.indexFor(this.activeScored);
      const cell = idx >= 0 ? this.cells[idx] : null;
      if (cell) {
        const glow = 28 + this.pulse * 22;
        cell.style.boxShadow =
          `0 0 ${glow}px rgba(255,43,214,${0.7 + this.pulse * 0.3}),` +
          `inset 0 0 26px rgba(255,43,214,0.28)`;
      }
    }

    // Update birth shimmer particles
    for (let i = this.birthParticles.length - 1; i >= 0; i--) {
      const p = this.birthParticles[i];
      p.age += dt;
      const progress = p.age / p.lifetime;
      if (progress >= 1) {
        p.el.remove();
        this.birthParticles.splice(i, 1);
      } else {
        // Fade out and float upward
        const opacity = (1 - progress) * 0.8;
        const yOffset = progress * -15;
        p.el.style.opacity = String(opacity);
        p.el.style.transform = `translateY(${yOffset}px)`;
      }
    }
  }

  dispose(): void {
    this.offBeat?.();
    this.offNote?.();
    this.offNoteEnd?.();
    this.offScored?.();
    this.offBeat = undefined;
    this.offNote = undefined;
    this.offNoteEnd = undefined;
    this.root?.remove();
    this.root = null;
    this.cells = [];
    this.noteLayers = [];
    this.noteBars.clear();
    // Clean up birth particles
    for (const p of this.birthParticles) p.el.remove();
    this.birthParticles = [];
  }
}
