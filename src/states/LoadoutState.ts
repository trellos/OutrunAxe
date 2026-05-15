import * as THREE from "three";
import type { Game, GameState } from "../engine/Game";
import { Avatar } from "../world/Avatar";
import {
  GUITARS,
  OUTFITS,
  loadLoadout,
  saveLoadout,
  type GuitarId,
  type Loadout,
  type OutfitId,
} from "../state/Loadout";

export class LoadoutState implements GameState {
  readonly name = "loadout";
  private hudParent: HTMLElement;
  private onConfirm: () => void;
  private overlay: HTMLDivElement | null = null;
  private avatar: Avatar | null = null;
  private lights: THREE.Object3D[] = [];
  private loadout: Loadout = loadLoadout();
  private game!: Game;

  constructor(hudParent: HTMLElement, onConfirm: () => void) {
    this.hudParent = hudParent;
    this.onConfirm = onConfirm;
  }

  enter(game: Game) {
    this.game = game;
    const { worldScene, worldCamera } = game.renderer;
    worldScene.background = new THREE.Color(0x0a0612);

    worldCamera.position.set(0, 0, 3.2);
    worldCamera.lookAt(0, 0, 0);

    this.loadout = loadLoadout();
    this.buildAvatar();

    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(4, 6, 6);
    worldScene.add(dir);
    this.lights.push(dir);

    const ambient = new THREE.AmbientLight(0x6622aa, 0.5);
    worldScene.add(ambient);
    this.lights.push(ambient);

    const hemi = new THREE.HemisphereLight(0xff2bd6, 0x00f0ff, 0.5);
    worldScene.add(hemi);
    this.lights.push(hemi);

    this.overlay = document.createElement("div");
    this.overlay.className = "outrun-loadout";
    this.overlay.innerHTML = this.renderOverlay();
    this.hudParent.appendChild(this.overlay);

    this.wireOverlay();
  }

  exit() {
    if (this.avatar) {
      this.game.renderer.worldScene.remove(this.avatar);
      this.avatar = null;
    }
    for (const l of this.lights) {
      this.game.renderer.worldScene.remove(l);
    }
    this.lights = [];
    this.overlay?.remove();
    this.overlay = null;
  }

  update(dt: number) {
    if (this.avatar) {
      this.avatar.rotation.y += dt * 0.4;
    }
  }

  private buildAvatar() {
    if (this.avatar) {
      this.game.renderer.worldScene.remove(this.avatar);
      this.avatar = null;
    }
    const av = new Avatar(this.loadout);
    av.rotation.y = Math.PI;
    this.game.renderer.worldScene.add(av);
    this.avatar = av;
  }

  private renderOverlay(): string {
    const outfitButtons = OUTFITS.map((o) => {
      const sel = o.id === this.loadout.outfit ? " selected" : "";
      return `<button class="loadout-pick outfit-pick${sel}" data-outfit="${o.id}">
        <span class="loadout-label">${o.label}</span>
        <span class="loadout-tag">${o.tag}</span>
      </button>`;
    }).join("");

    const guitarButtons = GUITARS.map((g) => {
      const sel = g.id === this.loadout.guitar ? " selected" : "";
      return `<button class="loadout-pick guitar-pick${sel}" data-guitar="${g.id}">
        <span class="loadout-label">${g.label}</span>
        <span class="loadout-tag">${g.tag}</span>
      </button>`;
    }).join("");

    return `
      <div class="loadout-card">
        <div class="loadout-title">LOADOUT</div>
        <div class="loadout-section-label">OUTFIT</div>
        <div class="loadout-row">${outfitButtons}</div>
        <div class="loadout-section-label">GUITAR</div>
        <div class="loadout-row">${guitarButtons}</div>
        <div class="loadout-actions">
          <button class="loadout-confirm">CONFIRM</button>
        </div>
      </div>
    `;
  }

  private wireOverlay() {
    if (!this.overlay) return;
    const outfitBtns = this.overlay.querySelectorAll<HTMLButtonElement>(".outfit-pick");
    outfitBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.outfit as OutfitId | undefined;
        if (!id) return;
        this.loadout = { ...this.loadout, outfit: id };
        saveLoadout(this.loadout);
        outfitBtns.forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        this.buildAvatar();
      });
    });

    const guitarBtns = this.overlay.querySelectorAll<HTMLButtonElement>(".guitar-pick");
    guitarBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.guitar as GuitarId | undefined;
        if (!id) return;
        this.loadout = { ...this.loadout, guitar: id };
        saveLoadout(this.loadout);
        guitarBtns.forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        this.buildAvatar();
      });
    });

    const confirm = this.overlay.querySelector<HTMLButtonElement>(".loadout-confirm");
    confirm?.addEventListener("click", () => this.onConfirm());
  }
}
