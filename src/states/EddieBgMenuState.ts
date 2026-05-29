// EddieBgMenuState — background picker / debug menu (route ?eddiebg=1, wired in
// main.ts). Lists every background in the registry; selecting one launches the
// REAL Infinite Eddie play screen (InfiniteEddieState) in demo mode with that
// background, so all variants live in one tree (no separate branches). Demo mode
// auto-ramps eddieIntensity so the full calm->chaos morph is visible, with manual
// intensity keys ([ ]) and Esc to return here.
//
// Self-contained: depends only on the registry, InfiniteEddieState, eddieTypes,
// and engine modules. Mirrors the CharacterDebugState/EddieArtDebugState pattern.

import type { Game, GameState } from "../engine/Game";
import type { EddieConfig } from "../music/eddie/eddieTypes";
import { BACKGROUNDS } from "../eddie/art/backgrounds/registry";
import { InfiniteEddieState } from "./InfiniteEddieState";
import "../eddie/art/eddie.css";

/** A representative config so the play screen renders bass labels + both tags. */
function demoConfig(): EddieConfig {
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

export class EddieBgMenuState implements GameState {
  readonly name = "eddieBgMenu";
  private hudParent: HTMLElement;
  private game!: Game;
  private root: HTMLDivElement | null = null;

  constructor(hudParent: HTMLElement) {
    this.hudParent = hudParent;
  }

  enter(game: Game) {
    this.game = game;

    const root = document.createElement("div");
    root.className = "eddie-bgmenu";
    root.innerHTML = `
      <h1 class="eddie-bgmenu-title">SELECT BACKGROUND</h1>
      <p class="eddie-bgmenu-sub">Launches the play screen in demo mode &middot;
        intensity auto-ramps &middot; <b>[</b>/<b>]</b> adjust &middot; <b>Esc</b> back</p>
      <div class="eddie-bgmenu-grid"></div>`;
    const grid = root.querySelector<HTMLDivElement>(".eddie-bgmenu-grid")!;

    BACKGROUNDS.forEach((bg, i) => {
      const card = document.createElement("button");
      card.className = "eddie-bgmenu-card";
      card.innerHTML =
        `<span class="eddie-bgmenu-num">${i + 1}</span>` +
        `<span class="eddie-bgmenu-name">${bg.label}</span>` +
        `<span class="eddie-bgmenu-blurb">${bg.blurb}</span>`;
      card.addEventListener("click", () => this.launch(i));
      grid.appendChild(card);
    });

    this.hudParent.appendChild(root);
    this.root = root;

    window.addEventListener("keydown", this.onKey);
  }

  private launch(bgIndex: number) {
    this.game.setState(
      new InfiniteEddieState(
        this.hudParent,
        demoConfig(),
        () => this.game.setState(new EddieBgMenuState(this.hudParent)),
        { bgIndex, demo: true },
      ),
    );
  }

  private onKey = (e: KeyboardEvent) => {
    // Number keys 1..9 quick-launch the matching background.
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= BACKGROUNDS.length) this.launch(n - 1);
  };

  update(_dt: number) {
    // Static DOM menu — nothing to animate per frame.
  }

  exit() {
    window.removeEventListener("keydown", this.onKey);
    this.root?.remove();
    this.root = null;
  }
}
