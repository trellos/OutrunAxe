// Debug character gallery. Reach it with ?chars=1 (wired in main.ts).
//
// Lays every CharacterDef out as a grid (one row per character, one column
// per variant), labels each, and plays a shared animation across all of
// them so the new Killer7 art can be reviewed and picked from. Number keys
// switch animation, G cycles guitars on mains, arrows orbit the camera.

import * as THREE from "three";
import type { Game, GameState } from "../engine/Game";
import { CHARACTERS } from "../world/characters/registry";
import type { BuiltCharacter, AnimName } from "../world/characters/types";
import type { GuitarId } from "../state/Loadout";

const ANIMS: AnimName[] = ["idle", "play", "walk", "taunt", "hit", "die"];
const GUITARS: GuitarId[] = ["goldtop", "blackstrat", "jazzmaster"];
const COL_GAP = 2.4;
const ROW_GAP = 3.2;

interface Slot {
  built: BuiltCharacter;
  holder: THREE.Group;
  isMain: boolean;
}

function makeLabel(text: string, color = "#ffffff"): THREE.Sprite {
  const cv = document.createElement("canvas");
  cv.width = 512;
  cv.height = 96;
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = "rgba(6,6,10,0.72)";
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.font = "bold 44px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(text, cv.width / 2, cv.height / 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(2.4, 0.45, 1);
  sp.renderOrder = 999;
  return sp;
}

export class CharacterDebugState implements GameState {
  readonly name = "characterDebug";
  private game!: Game;
  private root = new THREE.Group();
  private slots: Slot[] = [];
  private lights: THREE.Object3D[] = [];
  private sprites: THREE.Sprite[] = [];
  private overlay: HTMLDivElement | null = null;
  private hudParent: HTMLElement;
  private anim: AnimName = "play";
  private guitarIdx = 0;
  private t = 0;
  private dieClock = 0;
  private camAngle = 0;
  private camDist = 9;
  private camHeight = 1.6;

  constructor(hudParent: HTMLElement) {
    this.hudParent = hudParent;
  }

  enter(game: Game) {
    this.game = game;
    const { worldScene, worldCamera } = game.renderer;
    worldScene.background = new THREE.Color(0x0a0612);
    worldScene.fog = null;

    const rows = CHARACTERS.length;
    for (let r = 0; r < rows; r++) {
      const def = CHARACTERS[r];
      const z = (r - (rows - 1) / 2) * ROW_GAP;
      const rowLabel = makeLabel(`${def.label}`, def.kind === "main" ? "#ffd34a" : "#ff6ab0");
      rowLabel.position.set(-(COL_GAP * 2.1), 1.0, z);
      rowLabel.scale.set(3.0, 0.55, 1);
      this.root.add(rowLabel);
      this.sprites.push(rowLabel);

      def.variants.forEach((variant, ci) => {
        const x = (ci - 1) * COL_GAP;
        const holder = new THREE.Group();
        holder.position.set(x, 0, z);
        let built: BuiltCharacter;
        try {
          built = def.build(variant.id, { guitar: GUITARS[this.guitarIdx] });
        } catch (err) {
          console.warn(`[chars] build failed for ${def.id}/${variant.id}`, err);
          return;
        }
        holder.add(built.group);
        this.root.add(holder);
        this.slots.push({ built, holder, isMain: def.kind === "main" });

        const lbl = makeLabel(variant.label);
        lbl.position.set(x, -0.35, z + 0.6);
        this.root.add(lbl);
        this.sprites.push(lbl);
      });
    }

    game.renderer.worldScene.add(this.root);

    const key = new THREE.DirectionalLight(0xfff2e0, 2.2);
    key.position.set(5, 9, 6);
    const rim = new THREE.DirectionalLight(0x6cf0ff, 1.0);
    rim.position.set(-6, 4, -5);
    const amb = new THREE.AmbientLight(0x404a66, 0.6);
    worldScene.add(key, rim, amb);
    this.lights.push(key, rim, amb);

    worldCamera.position.set(0, this.camHeight + 1.2, this.camDist);
    worldCamera.lookAt(0, 0.9, 0);

    this.overlay = document.createElement("div");
    this.overlay.style.cssText =
      "position:absolute;left:16px;bottom:16px;color:#e8e8f0;font:13px/1.5 monospace;" +
      "background:rgba(8,8,14,0.7);padding:10px 14px;border:1px solid #4a2a7a;pointer-events:none;";
    this.overlay.innerHTML = this.hudText();
    this.hudParent.appendChild(this.overlay);

    window.addEventListener("keydown", this.onKey);
  }

  exit() {
    window.removeEventListener("keydown", this.onKey);
    for (const s of this.slots) s.built.dispose();
    this.slots = [];
    for (const sp of this.sprites) {
      (sp.material as THREE.SpriteMaterial).map?.dispose();
      (sp.material as THREE.SpriteMaterial).dispose();
    }
    this.sprites = [];
    const { worldScene } = this.game.renderer;
    worldScene.remove(this.root);
    for (const l of this.lights) worldScene.remove(l);
    this.lights = [];
    this.overlay?.remove();
    this.overlay = null;
  }

  update(dt: number) {
    this.t += dt;
    let dieK = 0;
    if (this.anim === "die") {
      this.dieClock += dt;
      const cycle = 2.0;
      dieK = Math.min(1, (this.dieClock % cycle) / 1.2);
    }
    for (const s of this.slots) {
      s.holder.rotation.y += dt * 0.35;
      if (this.anim === "die") s.built.update(dieK, dt, "die");
      else s.built.update(this.t, dt, this.anim);
    }
    const cam = this.game.renderer.worldCamera;
    cam.position.set(
      Math.sin(this.camAngle) * this.camDist,
      this.camHeight + 1.2,
      Math.cos(this.camAngle) * this.camDist,
    );
    cam.lookAt(0, 0.9, 0);
  }

  private hudText(): string {
    return (
      `CHARACTER GALLERY — anim: <b>${this.anim}</b><br>` +
      `1 idle &middot; 2 play &middot; 3 walk &middot; 4 taunt &middot; 5 hit &middot; 6 die<br>` +
      `G guitar (${GUITARS[this.guitarIdx]}) &middot; &larr;/&rarr; orbit &middot; &uarr;/&darr; zoom`
    );
  }

  private onKey = (e: KeyboardEvent) => {
    const n = Number(e.key);
    if (n >= 1 && n <= ANIMS.length) {
      this.anim = ANIMS[n - 1];
      this.dieClock = 0;
    } else if (e.key.toLowerCase() === "g") {
      this.guitarIdx = (this.guitarIdx + 1) % GUITARS.length;
      for (const s of this.slots) {
        if (s.isMain && s.built.setGuitar) s.built.setGuitar(GUITARS[this.guitarIdx]);
      }
    } else if (e.key === "ArrowLeft") {
      this.camAngle -= 0.12;
    } else if (e.key === "ArrowRight") {
      this.camAngle += 0.12;
    } else if (e.key === "ArrowUp") {
      this.camDist = Math.max(4, this.camDist - 0.6);
    } else if (e.key === "ArrowDown") {
      this.camDist = Math.min(20, this.camDist + 0.6);
    }
    if (this.overlay) this.overlay.innerHTML = this.hudText();
  };
}
