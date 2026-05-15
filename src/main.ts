import "./style.css";
import { Game } from "./engine/Game";
import { BootState } from "./states/BootState";

const root = document.getElementById("game");
if (!root) throw new Error("missing #game");

const hud = document.createElement("div");
hud.id = "hud";
document.body.appendChild(hud);

const game = new Game(root);
(window as unknown as { __game: Game }).__game = game;
game.setState(new BootState(hud));
game.start();
