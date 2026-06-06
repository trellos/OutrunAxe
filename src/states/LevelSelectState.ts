import * as THREE from "three";
import type { Game, GameState } from "../engine/Game";
import type { LevelConfig } from "../levels/level1";
import { level1 } from "../levels/level1";
import { level2 } from "../levels/level2";
import { level3 } from "../levels/level3";
import { MenuPulse } from "../hud/MenuPulse";
import { EddieSettingsState } from "./EddieSettingsState";

interface LevelEntry {
  level: LevelConfig;
  color: number;
  number: string;
}

export class LevelSelectState implements GameState {
  readonly name = "levelSelect";
  private hudParent: HTMLElement;
  private onPick: (level: LevelConfig) => void;
  private overlay: HTMLDivElement | null = null;
  private game!: Game;
  private icos: THREE.Mesh[] = [];
  private lights: THREE.Light[] = [];
  private entries: LevelEntry[];
  private pulse: MenuPulse | null = null;

  constructor(hudParent: HTMLElement, onPick: (level: LevelConfig) => void) {
    this.hudParent = hudParent;
    this.onPick = onPick;
    this.entries = [
      { level: level1, color: 0xff2bd6, number: "01" },
      { level: level2, color: 0x00f0ff, number: "02" },
      { level: level3, color: 0xffd02b, number: "03" },
    ];
  }

  enter(game: Game) {
    this.game = game;
    const { worldScene, worldCamera } = game.renderer;
    worldScene.background = new THREE.Color(0x0a0612);

    worldCamera.position.set(0, 0, 8);
    worldCamera.lookAt(0, 0, 0);

    const xs = [-3, 0, 3];
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      const geom = new THREE.IcosahedronGeometry(1, 0);
      const mat = new THREE.MeshStandardMaterial({
        color: entry.color,
        emissive: entry.color,
        emissiveIntensity: 0.9,
        roughness: 0.3,
        metalness: 0.6,
        wireframe: true,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(xs[i], 0, 0);
      worldScene.add(mesh);
      this.icos.push(mesh);
    }

    const ambient = new THREE.AmbientLight(0x6622aa, 0.6);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(5, 10, 5);
    worldScene.add(ambient);
    worldScene.add(dir);
    this.lights.push(ambient, dir);

    this.overlay = document.createElement("div");
    this.overlay.className = "outrun-levelselect";

    const cardsHtml = this.entries
      .map((entry) => {
        const bestRaw = localStorage.getItem(
          "outrunaxe.best." + entry.level.name,
        );
        const best = bestRaw !== null && bestRaw !== "" ? bestRaw : "—";
        const colorHex = "#" + entry.color.toString(16).padStart(6, "0");
        return (
          '<div class="levelselect-card" style="border-color:' +
          colorHex +
          '; box-shadow:0 0 40px ' +
          colorHex +
          '55;">' +
          '<div class="levelselect-num" style="color:' +
          colorHex +
          ';">' +
          entry.number +
          "</div>" +
          '<div class="levelselect-name">' +
          escapeHtml(entry.level.name) +
          "</div>" +
          '<div class="levelselect-bpm">' +
          entry.level.bpm +
          " BPM</div>" +
          '<div class="levelselect-best">BEST: ' +
          escapeHtml(String(best)) +
          "</div>" +
          '<button class="levelselect-play" data-level="' +
          entry.number +
          '" style="background:' +
          colorHex +
          ';">PLAY</button>' +
          "</div>"
        );
      })
      .join("");

    this.overlay.innerHTML =
      '<div class="levelselect-inner">' +
      '<div class="levelselect-title">SELECT LEVEL</div>' +
      '<div class="levelselect-cards">' +
      cardsHtml +
      "</div>" +
      '<button class="levelselect-eddie" data-eddie="1">SCORE RUN</button>' +
      "</div>";

    this.hudParent.appendChild(this.overlay);

    const buttons = this.overlay.querySelectorAll(
      ".levelselect-play",
    ) as NodeListOf<HTMLButtonElement>;
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const num = btn.getAttribute("data-level");
        const entry = this.entries.find((e) => e.number === num);
        if (entry) this.onPick(entry.level);
      });
    });

    const eddieBtn = this.overlay.querySelector(
      ".levelselect-eddie",
    ) as HTMLButtonElement | null;
    eddieBtn?.addEventListener("click", () => {
      this.game.setState(new EddieSettingsState(this.hudParent));
    });

    this.pulse = new MenuPulse(this.hudParent);
    void this.pulse.start();
  }

  exit() {
    this.pulse?.stop();
    this.pulse = null;
    const { worldScene } = this.game.renderer;
    for (const m of this.icos) {
      worldScene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.icos = [];
    for (const l of this.lights) {
      worldScene.remove(l);
    }
    this.lights = [];
    this.overlay?.remove();
    this.overlay = null;
  }

  update(dt: number) {
    for (const m of this.icos) {
      m.rotation.y += dt * 0.5;
    }
    this.pulse?.tick();
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
