import "./style.css";
import { Game } from "./engine/Game";
import { BootState } from "./states/BootState";
import { CharacterDebugState } from "./states/CharacterDebugState";

const root = document.getElementById("game");
if (!root) throw new Error("missing #game");

const hud = document.createElement("div");
hud.id = "hud";
document.body.appendChild(hud);

const game = new Game(root);
(window as unknown as { __game: Game }).__game = game;
if (new URLSearchParams(location.search).has("chars")) {
  game.setState(new CharacterDebugState(hud));
} else {
  game.setState(new BootState(hud));
}
game.start();
