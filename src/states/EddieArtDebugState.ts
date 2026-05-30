// EddieArtDebugState — Art's debug gallery (route ?eddieart=1, wired by Gameplay
// in main.ts). Mounts the active branch's variant of every asset (grid,
// background, fire, particles, play button) and drives them with a SYNTHETIC
// juice bus firing fake eddieScore-style juice (beat pulse, particles, fire,
// shake, score pop) on a timer so each animates for review. Self-contained: it
// depends ONLY on eddieTypes, three, engine modules, and the art factory — never
// Gameplay's play state (GDD §12.5). Clock is parked synthetically (no Conductor
// required), mirroring how MenuPulse parks without the full play state.
//
// Structure copied from CharacterDebugState: on-screen HUD + key handling.

import type { Game, GameState } from "../engine/Game";
import { EventBus } from "../engine/EventBus";
import type { EddieConfig, EddieJuiceEvents, PitchClass } from "../music/eddie/eddieTypes";
import { createEddieArt, type EddieArtRig } from "../eddie/art/eddieArtFactory";
import { createEddiePlayButton, type EddiePlayButton } from "../eddie/art/EddiePlayButton";
import { BACKGROUNDS } from "../eddie/art/backgrounds/registry";
import { PARTICLES } from "../eddie/art/particles/registry";

// A representative synthetic config so the grid renders bass labels + both tags.
function makeDebugConfig(): EddieConfig {
  // E major, a simple I-IV-V-ish loop (E, A, B, A) so the grid renders bass
  // labels and both tag badges for review.
  const bassline: EddieConfig["bassline"] = [
    { measure: 0, beat: 0, pitchClass: "E", chordTones: ["E", "G#", "B"] },
    { measure: 1, beat: 0, pitchClass: "A", chordTones: ["A", "C#", "E"] },
    { measure: 2, beat: 0, pitchClass: "B", chordTones: ["B", "D#", "F#"] },
    { measure: 3, beat: 0, pitchClass: "A", chordTones: ["A", "C#", "E"] },
  ];
  return {
    bpm: 120,
    keyRoot: "E",
    keyMode: "major",
    bassline,
    eighthTagMeasure: 6,
    sixteenthTagMeasure: 11,
  };
}

export class EddieArtDebugState implements GameState {
  readonly name = "eddieArtDebug";
  private hudParent: HTMLElement;
  private rig: EddieArtRig | null = null;
  private playBtn: EddiePlayButton | null = null;
  private juice = new EventBus<EddieJuiceEvents>();
  private overlay: HTMLDivElement | null = null;
  private settingsRoot: HTMLDivElement | null = null;

  private t = 0;
  private beatTimer = 0;
  private eventTimer = 0;
  private beatInMeasure = 0;
  private fakeMeasure = 0;
  private fakeTotal = 0;
  private paused = false;
  private bpm = 120;
  /** Active scored measure (>=0) for synthetic note plotting; <0 during intro. */
  private activeScoredDbg = 0;
  /** Selected variant indices (0-based), from ?bg=N / ?fx=N (1-based in the URL). */
  private bgIndex = 0;
  private fxIndex = 0;
  private glitchHold = false;
  /** Fixed eddieIntensity for review (?intensity=0..1); -1 = not set. */
  private fixedIntensity = -1;

  constructor(hudParent: HTMLElement) {
    this.hudParent = hudParent;
  }

  enter(game: Game) {
    const { worldScene, worldCamera } = game.renderer;

    const config = makeDebugConfig();

    const params = new URLSearchParams(location.search);
    this.bgIndex = Math.max(0, (parseInt(params.get("bg") ?? "1", 10) || 1) - 1) % BACKGROUNDS.length;
    this.fxIndex = Math.max(0, (parseInt(params.get("fx") ?? "1", 10) || 1) - 1) % PARTICLES.length;
    // ?glitch=1 holds the beat-glitch saturated (continuous downbeat pulses) so a
    // still screenshot reliably captures the on-beat glitch for review.
    this.glitchHold = params.get("glitch") === "1";
    // ?intensity=0..1 holds the background morph at a fixed level for review.
    const intp = params.get("intensity");
    this.fixedIntensity = intp !== null ? Math.max(0, Math.min(1, parseFloat(intp))) : -1;

    this.rig = createEddieArt("option-1");
    this.rig.mount({
      hudParent: this.hudParent,
      scene: worldScene,
      config,
      juice: this.juice,
      camera: worldCamera,
      bgIndex: this.bgIndex,
      fxIndex: this.fxIndex,
    });
    this.rig.setActiveMeasure(0);

    // A small settings-style panel hosting the PLAY button so its variant is
    // reviewable alongside the play-screen assets.
    const sRoot = document.createElement("div");
    sRoot.style.cssText =
      "position:absolute;left:50%;bottom:24px;transform:translateX(-50%);" +
      "display:flex;justify-content:center;pointer-events:none;";
    this.hudParent.appendChild(sRoot);
    this.settingsRoot = sRoot;
    this.playBtn = createEddiePlayButton("option-1");
    this.playBtn.mount(sRoot, () => {
      // In the gallery, PLAY just fires a celebratory burst.
      this.fireBurst(true);
    });

    this.overlay = document.createElement("div");
    this.overlay.className = "eddie-debug-hud";
    this.overlay.innerHTML = this.hudText();
    this.hudParent.appendChild(this.overlay);

    // ?nohud=1 hides the DOM HUD (grid/fire/particles/score/play + caption) so the
    // Three.js background can be reviewed unobstructed.
    if (params.get("nohud") === "1") {
      const root = this.hudParent.querySelector<HTMLElement>(".eddie-root");
      if (root) root.style.display = "none";
      if (this.settingsRoot) this.settingsRoot.style.display = "none";
      this.overlay.style.display = "none";
    }

    window.addEventListener("keydown", this.onKey);
  }

  exit() {
    window.removeEventListener("keydown", this.onKey);
    this.playBtn?.dispose();
    this.playBtn = null;
    this.settingsRoot?.remove();
    this.settingsRoot = null;
    this.rig?.dispose();
    this.rig = null;
    this.juice.clear();
    this.overlay?.remove();
    this.overlay = null;
  }

  update(dt: number) {
    if (this.paused) {
      this.rig?.update(0, this.t);
      this.playBtn?.update(0);
      return;
    }
    this.t += dt;
    if (this.fixedIntensity >= 0) {
      this.juice.emit("eddieIntensity", { value: this.fixedIntensity, audioTime: this.t });
    }
    if (this.glitchHold) {
      // Saturate the beat-glitch every frame so a still captures it (review only).
      this.juice.emit("eddieBeatPulse", { beatInMeasure: 0, downbeat: true, audioTime: this.t });
    }
    const beatDur = 60 / this.bpm;

    // Synthetic beat clock: fire eddieBeatPulse every quarter, advance the
    // active measure every 4 beats, cycle through all 5 rows incl. intro.
    this.beatTimer += dt;
    if (this.beatTimer >= beatDur) {
      this.beatTimer -= beatDur;
      const downbeat = this.beatInMeasure === 0;
      this.juice.emit("eddieBeatPulse", {
        beatInMeasure: this.beatInMeasure,
        downbeat,
        audioTime: this.t,
      });
      // Synthetic played notes plotted into the active scored cell so the grid's
      // note timeline is visible in review. The 8th-tag measure gets 2 notes/beat,
      // the 16th-tag measure 4, others 1.
      if (this.activeScoredDbg >= 0) {
        const beat = (this.beatInMeasure + 3) % 4; // the beat just pulsed
        let sub = 1;
        if (this.activeScoredDbg === 6) sub = 2;
        else if (this.activeScoredDbg === 11) sub = 4;
        for (let s = 0; s < sub; s++) {
          this.emitNote(this.activeScoredDbg, (beat + s / sub) / 4);
        }
      }

      this.beatInMeasure = (this.beatInMeasure + 1) % 4;
      if (this.beatInMeasure === 0) {
        // Advance the active measure: walk intro (-1..-4) then scored 0..15.
        this.fakeMeasure++;
        const cycle = 20;
        const m = this.fakeMeasure % cycle;
        const scored = m < 4 ? -(m + 1) : m - 4; // -1..-4 intro, then 0..15
        this.activeScoredDbg = scored;
        this.rig?.setActiveMeasure(scored);
      }
    }

    // Synthetic scoring juice: particles + score pop on a steady cadence, with
    // periodic fire bursts so both tiers are demoed.
    this.eventTimer += dt;
    if (this.eventTimer >= 0.5) {
      this.eventTimer -= 0.5;
      this.scorePop();
      if (Math.random() < 0.25) this.fireBurst(Math.random() < 0.5);
    }

    this.rig?.update(dt, this.t);
    this.playBtn?.update(dt);
  }

  private scorePop() {
    const delta = 10 + Math.floor(Math.random() * 90);
    this.fakeTotal += delta;
    const multiplier = 1 + Math.floor(Math.random() * 4);
    // Particles fly from a point over the grid toward the score readout.
    const from = {
      x: window.innerWidth * (0.35 + Math.random() * 0.3),
      y: window.innerHeight * (0.4 + Math.random() * 0.2),
    };
    const colors = ["#00f0ff", "#ff2bd6", "#ffd02b", "#c7ff2b"];
    this.juice.emit("eddieParticles", {
      from,
      count: 6 + multiplier * 4,
      color: colors[multiplier % colors.length],
      audioTime: this.t,
    });
    this.juice.emit("eddieShake", { magnitude: multiplier * 0.5, audioTime: this.t });
    this.juice.emit("eddieScorePop", { total: this.fakeTotal, delta, audioTime: this.t });
  }

  // E-major scale pitch classes (the debug config key) for synthetic in-key
  // notes, paired with a representative MIDI in the grid's plot range.
  private static readonly IN_KEY: Array<[PitchClass, number]> = [
    ["E", 52], ["F#", 54], ["G#", 56], ["A", 57], ["B", 59], ["C#", 61], ["D#", 63],
    ["E", 64], ["F#", 66], ["A", 69], ["B", 71],
  ];
  private static readonly OFF_KEY: Array<[PitchClass, number]> = [
    ["F", 53], ["G", 55], ["C", 60], ["D", 62],
  ];

  private emitNote(measure: number, beatFraction: number) {
    const off = Math.random() < 0.18;
    const pool = off ? EddieArtDebugState.OFF_KEY : EddieArtDebugState.IN_KEY;
    const [pitchClass, midi] = pool[Math.floor(Math.random() * pool.length)];
    this.juice.emit("eddieNote", {
      measure,
      beatFraction,
      pitchClass,
      midi,
      inKey: !off,
      audioTime: this.t,
    });
  }

  private fireBurst(big: boolean) {
    const measure = big ? 11 : 6; // the tagged measures in the debug config
    this.juice.emit("eddieFire", { measure, tier: big ? 2 : 1, audioTime: this.t });
    this.juice.emit("eddieShake", { magnitude: big ? 2.4 : 1.2, audioTime: this.t });
  }

  private hudText(): string {
    const bg = BACKGROUNDS[this.bgIndex];
    const fx = PARTICLES[this.fxIndex];
    return (
      `EDDIE ART GALLERY — driven by a synthetic juice bus<br>` +
      `BG ${this.bgIndex + 1}/${BACKGROUNDS.length}: <b>${bg.label}</b> &middot; ` +
      `FX ${this.fxIndex + 1}/${PARTICLES.length}: <b>${fx.label}</b><br>` +
      `<b>SPACE</b> pause &middot; <b>F</b> 8th fire &middot; <b>G</b> 16th fire &middot; ` +
      `<b>P</b> particles &middot; <b>S</b> shake &middot; &minus;/&plus; tempo (${this.bpm})<br>` +
      `Review others via <b>?eddieart=1&amp;bg=N&amp;fx=N</b> (N=1..6).`
    );
  }

  private onKey = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (k === " ") {
      this.paused = !this.paused;
      e.preventDefault();
    } else if (k === "f") {
      this.fireBurst(false);
    } else if (k === "g") {
      this.fireBurst(true);
    } else if (k === "p") {
      this.scorePop();
    } else if (k === "s") {
      this.juice.emit("eddieShake", { magnitude: 3, audioTime: this.t });
    } else if (e.key === "+" || e.key === "=") {
      this.bpm = Math.min(200, this.bpm + 10);
    } else if (e.key === "-" || e.key === "_") {
      this.bpm = Math.max(60, this.bpm - 10);
    }
    if (this.overlay) this.overlay.innerHTML = this.hudText();
  };
}
