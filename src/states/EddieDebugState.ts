// EddieDebugState — record/calibration menu (route ?eddiedebug=1, wired in
// main.ts). Feeds a known audio file (or the live mic) through the REAL Infinite
// Eddie play screen so detection can be diagnosed end-to-end, then downloaded:
// the input audio (.wav for files), the full detection stream + scoring +
// intensity (.json), all captured by InfiniteEddieState's record mode.
//
// This is the calibration harness the headless vitest path can't be: it exercises
// the live worklet onset path + PitchTracker + KeyResolver + EddieScorer exactly
// as a real play session does. Pick a sample, watch the timeline, download to
// compare detected notes against what the file actually contains.

import type { Game, GameState } from "../engine/Game";
import type { EddieConfig, PitchClass, KeyMode } from "../music/eddie/eddieTypes";
import { generateBassline } from "../music/eddie/basslineGen";
import { getAudioContext } from "../audio/AudioContextSingleton";
import { InfiniteEddieState } from "./InfiniteEddieState";
import "../eddie/art/eddie.css";

interface SampleFile {
  file: string; // under public/samples/
  bpm: number;
  label: string;
}

// The three calibration files (see memory: the "sixteenth" file is really
// eighth-rate at 120 BPM — useful precisely because we know what's in it).
const SAMPLES: SampleFile[] = [
  { file: "0510_Eighth_Notes_90bpm.mp3", bpm: 90, label: "Eighths · 90 BPM (mp3)" },
  { file: "test-scale-eighth_notes_120bpm.webm", bpm: 120, label: "Scale eighths · 120 BPM" },
  { file: "test-taps-clean_sixteenthnotes_120bpm.webm", bpm: 120, label: 'Taps "16ths" · 120 BPM' },
];

function configFor(bpm: number, keyRoot: PitchClass, keyMode: KeyMode): EddieConfig {
  return {
    bpm,
    keyRoot,
    keyMode,
    bassline: generateBassline(keyRoot, keyMode, () => 0.1),
    eighthTagMeasure: 6,
    sixteenthTagMeasure: 11,
  };
}

export class EddieDebugState implements GameState {
  readonly name = "eddieDebug";
  private hudParent: HTMLElement;
  private game!: Game;
  private root: HTMLDivElement | null = null;
  private status: HTMLDivElement | null = null;

  constructor(hudParent: HTMLElement) {
    this.hudParent = hudParent;
  }

  enter(game: Game) {
    this.game = game;

    const root = document.createElement("div");
    root.className = "eddie-bgmenu";
    root.innerHTML = `
      <h1 class="eddie-bgmenu-title">EDDIE RECORD / CALIBRATE</h1>
      <p class="eddie-bgmenu-sub">Routes a file (or the mic) through the REAL detection chain &middot;
        download the input audio + detected notes JSON to debug &middot; <b>Esc</b> back</p>
      <div class="eddie-bgmenu-grid"></div>
      <div class="eddie-debug-status" style="margin-top:14px;color:#9fd;min-height:1.4em"></div>`;
    const grid = root.querySelector<HTMLDivElement>(".eddie-bgmenu-grid")!;
    this.status = root.querySelector<HTMLDivElement>(".eddie-debug-status")!;

    for (const s of SAMPLES) {
      const card = document.createElement("button");
      card.className = "eddie-bgmenu-card";
      card.innerHTML =
        `<span class="eddie-bgmenu-name">${s.label}</span>` +
        `<span class="eddie-bgmenu-blurb">${s.file}</span>`;
      card.addEventListener("click", () => void this.launchFile(s));
      grid.appendChild(card);
    }

    // Upload-your-own file.
    const upload = document.createElement("label");
    upload.className = "eddie-bgmenu-card";
    upload.innerHTML =
      `<span class="eddie-bgmenu-name">Upload a file…</span>` +
      `<span class="eddie-bgmenu-blurb">play any audio at 120 BPM</span>`;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/*";
    input.style.display = "none";
    input.addEventListener("change", () => {
      const f = input.files?.[0];
      if (f) void this.launchUpload(f);
    });
    upload.appendChild(input);
    grid.appendChild(upload);

    // Live mic.
    const mic = document.createElement("button");
    mic.className = "eddie-bgmenu-card";
    mic.innerHTML =
      `<span class="eddie-bgmenu-name">● Live mic</span>` +
      `<span class="eddie-bgmenu-blurb">record your playing at 120 BPM</span>`;
    mic.addEventListener("click", () => this.launchMic());
    grid.appendChild(mic);

    this.hudParent.appendChild(root);
    this.root = root;
    window.addEventListener("keydown", this.onKey);
  }

  private setStatus(msg: string) {
    if (this.status) this.status.textContent = msg;
  }

  private async decode(arr: ArrayBuffer): Promise<AudioBuffer> {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") await ctx.resume();
    // decodeAudioData detaches the ArrayBuffer; pass a copy so retries are safe.
    return ctx.decodeAudioData(arr.slice(0));
  }

  private async launchFile(s: SampleFile) {
    this.setStatus(`decoding ${s.file}…`);
    try {
      const resp = await fetch(`/samples/${s.file}`);
      if (!resp.ok) throw new Error(`fetch ${s.file}: ${resp.status}`);
      const buffer = await this.decode(await resp.arrayBuffer());
      this.launch(buffer, s.bpm, s.file);
    } catch (err) {
      this.setStatus(`failed: ${(err as Error).message}`);
    }
  }

  private async launchUpload(f: File) {
    this.setStatus(`decoding ${f.name}…`);
    try {
      const buffer = await this.decode(await f.arrayBuffer());
      this.launch(buffer, 120, f.name);
    } catch (err) {
      this.setStatus(`failed: ${(err as Error).message}`);
    }
  }

  private launchMic() {
    this.game.setState(
      new InfiniteEddieState(this.hudParent, configFor(120, "E", "major"), this.backToMenu, {
        capture: true,
        fileName: "live-mic",
      }),
    );
  }

  private launch(buffer: AudioBuffer, bpm: number, fileName: string) {
    this.game.setState(
      new InfiniteEddieState(this.hudParent, configFor(bpm, "E", "major"), this.backToMenu, {
        fakeMicBuffer: buffer,
        capture: true,
        fileName,
      }),
    );
  }

  private backToMenu = () => {
    this.game.setState(new EddieDebugState(this.hudParent));
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") this.game.setState(new EddieDebugState(this.hudParent));
  };

  update(_dt: number) {
    // Static DOM menu.
  }

  exit() {
    window.removeEventListener("keydown", this.onKey);
    this.root?.remove();
    this.root = null;
    this.status = null;
  }
}
