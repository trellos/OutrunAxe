// EddiePlayButton — the PLAY button on the Infinite Eddie settings screen
// (GDD §8). Standalone factory the settings state mounts: createEddiePlayButton
// (variant).mount(parent, onPlay) / update(dt) / dispose(). dispose() removes
// all DOM and the one injected <style> (zero Three.js resources, no canvas).
//
// VARIANT option-1: "Mac System 7 / Apple IIgs DEFAULT button" — a platinum
// rounded-rect with a chunky pixel bevel (light top-left, dark bottom-right),
// a bold Chicago-style "PLAY" label, and the classic heavy black rounded
// DEFAULT-button outline ring. Juice: a subtle RGB-split glitch flicker on
// hover and a press-invert on :active. It mounts inside the themed
// `.eddie-settings-play`, so it also inherits the parent's `.eddie-beat` /
// `.eddie-beat-down` glitch pulse for free. Clicking calls onPlay.

import type { EddieArtVariant } from "./eddieArtFactory";

export interface EddiePlayButton {
  mount(parent: HTMLElement, onPlay: () => void): void;
  update(dt: number): void;
  dispose(): void;
}

// One shared <style> for all instances, ref-counted so the last dispose()
// removes it. Scoped entirely under `.eddie-sysbtn`.
const STYLE_ID = "eddie-sysbtn-style";
let styleRefs = 0;

const STYLE_CSS = `
.eddie-sysbtn {
  position: relative;
  display: inline-block;
  pointer-events: auto;
  cursor: pointer;
  margin: 6px;
  padding: 12px 46px;
  font-family: "Geneva", "Chicago", "Lucida Console", ui-monospace, monospace;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 4px;
  color: #111;
  -webkit-font-smoothing: none;
  image-rendering: pixelated;
  /* Platinum fill with a hard pixel bevel: light TL, dark BR. */
  background:
    linear-gradient(180deg, #fdfdfd 0%, #e4e4e4 45%, #cfcfcf 100%);
  border: 2px solid #000;
  border-radius: 8px;
  /* The classic DEFAULT-button heavy outline ring + inner pixel bevel. */
  box-shadow:
    0 0 0 2px #d9d9d9,
    0 0 0 5px #000,
    inset 2px 2px 0 #ffffff,
    inset -2px -2px 0 #8a8a8a;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.8);
  transition: filter 0.05s steps(2), transform 0.04s steps(1),
    box-shadow 0.04s steps(1), background 0.04s steps(1);
}

/* Hover: a subtle RGB-split glitch flicker (cyan/magenta fringe) that the
   beat pulse from the parent theme can layer onto. */
.eddie-sysbtn:hover {
  filter: drop-shadow(-1px 0 0 rgba(255, 0, 200, 0.7))
    drop-shadow(1px 0 0 rgba(0, 220, 255, 0.7));
  animation: eddie-sysbtn-glitch 0.5s steps(2) infinite;
}

@keyframes eddie-sysbtn-glitch {
  0%, 100% { transform: translate(0, 0); }
  20% { transform: translate(-0.5px, 0); }
  40% { transform: translate(0.5px, 0); }
  60% { transform: translate(0, -0.5px); }
  80% { transform: translate(0.5px, 0.5px); }
}

/* Press: invert to the classic "selected"/depressed black fill. */
.eddie-sysbtn:active,
.eddie-sysbtn.eddie-sysbtn-down {
  color: #fff;
  background: linear-gradient(180deg, #000, #1a1a1a);
  box-shadow:
    0 0 0 2px #d9d9d9,
    0 0 0 5px #000,
    inset 2px 2px 0 #000,
    inset -2px -2px 0 #444;
  text-shadow: none;
  transform: translateY(1px);
  filter: none;
  animation: none;
}

/* When the parent theme flags a downbeat, give the button a quick 1px RGB
   tear so it pops in time with the music. */
.eddie-beat-down .eddie-sysbtn {
  filter: drop-shadow(-1.5px 0 0 rgba(255, 0, 200, 0.85))
    drop-shadow(1.5px 0 0 rgba(0, 220, 255, 0.85));
}
.eddie-beat .eddie-sysbtn {
  filter: drop-shadow(-0.5px 0 0 rgba(255, 0, 200, 0.5))
    drop-shadow(0.5px 0 0 rgba(0, 220, 255, 0.5));
}
`;

function acquireStyle(): void {
  if (styleRefs === 0 && !document.getElementById(STYLE_ID)) {
    const el = document.createElement("style");
    el.id = STYLE_ID;
    el.textContent = STYLE_CSS;
    document.head.appendChild(el);
  }
  styleRefs++;
}

function releaseStyle(): void {
  styleRefs = Math.max(0, styleRefs - 1);
  if (styleRefs === 0) {
    document.getElementById(STYLE_ID)?.remove();
  }
}

class PlayButtonOption1 implements EddiePlayButton {
  private btn: HTMLButtonElement | null = null;
  private onClick?: () => void;
  private styled = false;

  mount(parent: HTMLElement, onPlay: () => void): void {
    acquireStyle();
    this.styled = true;

    const btn = document.createElement("button");
    btn.className = "eddie-sysbtn";
    btn.type = "button";
    btn.textContent = "PLAY";

    this.onClick = onPlay;
    btn.addEventListener("click", this.handleClick);

    parent.appendChild(btn);
    this.btn = btn;
  }

  private handleClick = () => this.onClick?.();

  // No per-frame animation needed — the glitch/beat juice is pure CSS. Kept to
  // satisfy the EddiePlayButton interface and the settings/debug update loops.
  update(_dt: number): void {}

  dispose(): void {
    if (this.btn) {
      this.btn.removeEventListener("click", this.handleClick);
      this.btn.remove();
    }
    this.btn = null;
    this.onClick = undefined;
    if (this.styled) {
      releaseStyle();
      this.styled = false;
    }
  }
}

export function createEddiePlayButton(_variant: EddieArtVariant): EddiePlayButton {
  // option-1 baseline. option-2 / option-3 branches swap this implementation.
  return new PlayButtonOption1();
}
