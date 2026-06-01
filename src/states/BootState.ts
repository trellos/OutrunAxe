import * as THREE from "three";
import type { Game, GameState } from "../engine/Game";
import { LevelState } from "./LevelState";
import { LoadoutState } from "./LoadoutState";
import { LevelSelectState } from "./LevelSelectState";
import { EddieSettingsState } from "./EddieSettingsState";
import { level1 } from "../levels/level1";
import { level2 } from "../levels/level2";
import { level3 } from "../levels/level3";
import { MenuPulse } from "../hud/MenuPulse";

export class BootState implements GameState {
  readonly name = "boot";
  private overlay: HTMLDivElement | null = null;
  private hudParent: HTMLElement;
  private rotor: THREE.Object3D | null = null;
  private game!: Game;
  private pulse: MenuPulse | null = null;

  constructor(hudParent: HTMLElement) {
    this.hudParent = hudParent;
  }

  enter(game: Game) {
    this.game = game;
    const { worldScene } = game.renderer;
    worldScene.background = new THREE.Color(0x0a0612);

    this.rotor = new THREE.Group();
    const geom = new THREE.IcosahedronGeometry(2, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xff2bd6,
      emissive: 0xff2bd6,
      emissiveIntensity: 0.8,
      roughness: 0.3,
      metalness: 0.6,
      wireframe: true,
    });
    const mesh = new THREE.Mesh(geom, mat);
    this.rotor.add(mesh);
    worldScene.add(this.rotor);

    const dir = new THREE.DirectionalLight(0xff2bd6, 0.8);
    dir.position.set(5, 10, 5);
    worldScene.add(dir);
    worldScene.add(new THREE.AmbientLight(0x6622aa, 0.6));

    game.renderer.worldCamera.position.set(0, 0, 8);
    game.renderer.worldCamera.lookAt(0, 0, 0);

    const levels = [level1, level2, level3];
    const bestRows = levels
      .map((lvl) => {
        const raw = localStorage.getItem("outrunaxe.best." + lvl.name);
        const best = raw !== null && raw !== "" ? raw : "—";
        return (
          '<div class="boot-best-row">' +
          '<span class="boot-best-name">' +
          escapeHtml(lvl.name) +
          "</span>" +
          '<span class="boot-best-score">' +
          escapeHtml(String(best)) +
          "</span>" +
          "</div>"
        );
      })
      .join("");

    this.overlay = document.createElement("div");
    this.overlay.className = "outrun-boot";
    this.overlay.innerHTML = `
      <div class="boot-card">
        <div class="boot-title">OUTRUN AXE</div>
        <div class="boot-tag">guitar solo &middot; for your life</div>
        <ul class="boot-help">
          <li>Allow the mic when prompted &mdash; or use keyboard piano (Z S X D C V G B H N J M)</li>
          <li>Pick your outfit and guitar in the next screen.</li>
          <li>Enemies fly in tagged with notes. Play the note to fire.</li>
          <li>Narrow the key with in-scale notes for stronger hits.</li>
        </ul>
        <div class="boot-best">
          <div class="boot-best-title">BEST SCORES</div>
          ${bestRows}
        </div>
        <div class="boot-modes">
          <button class="boot-play boot-play-eddie" data-mode="eddie">INFINITE EDDIE</button>
          <button class="boot-play boot-play-outrun" data-mode="outrun">OUTRUN</button>
        </div>
      </div>
    `;
    this.hudParent.appendChild(this.overlay);

    this.overlay
      .querySelector(".boot-play-eddie")
      ?.addEventListener("click", () => this.startEddie());
    this.overlay
      .querySelector(".boot-play-outrun")
      ?.addEventListener("click", () => this.startLevel());

    this.pulse = new MenuPulse(this.hudParent);
    void this.pulse.start();
  }

  exit() {
    if (this.rotor) this.game.renderer.worldScene.remove(this.rotor);
    this.pulse?.stop();
    this.pulse = null;
    this.overlay?.remove();
  }

  update(dt: number) {
    if (this.rotor) {
      this.rotor.rotation.y += dt * 0.6;
      this.rotor.rotation.x += dt * 0.3;
    }
    this.pulse?.tick();
  }

  private startLevel() {
    this.game.setState(
      new LoadoutState(this.hudParent, () =>
        this.game.setState(
          new LevelSelectState(this.hudParent, (lvl) =>
            this.game.setState(new LevelState(this.hudParent, lvl)),
          ),
        ),
      ),
    );
  }

  private startEddie() {
    this.game.setState(new EddieSettingsState(this.hudParent));
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
