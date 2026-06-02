import "./style.css";
import { Game } from "./engine/Game";
import { BootState } from "./states/BootState";
import { CharacterDebugState } from "./states/CharacterDebugState";
import { EddieSettingsState } from "./states/EddieSettingsState";
import { EddieArtDebugState } from "./states/EddieArtDebugState";
import { EddieSoundDebugState } from "./states/EddieSoundDebugState";
import { EddieBgMenuState } from "./states/EddieBgMenuState";
import { EddieDebugState } from "./states/EddieDebugState";

const root = document.getElementById("game");
if (!root) throw new Error("missing #game");

const hud = document.createElement("div");
hud.id = "hud";
document.body.appendChild(hud);

const game = new Game(root);
(window as unknown as { __game: Game }).__game = game;
const params = new URLSearchParams(location.search);
if (params.has("chars")) {
  game.setState(new CharacterDebugState(hud));
} else if (params.has("eddieart")) {
  // Art's debug gallery: every art variant animating off a synthetic juice bus.
  game.setState(new EddieArtDebugState(hud));
} else if (params.has("eddiesound")) {
  // Sound's debug bench: cycle/loop every beat + bass variant.
  game.setState(new EddieSoundDebugState(hud));
} else if (params.has("eddiebg")) {
  // Background picker: launch the play screen (demo mode) with any background.
  game.setState(new EddieBgMenuState(hud));
} else if (params.has("eddiedebug")) {
  // Record/calibrate: feed a known file (or the mic) through the real detection
  // chain and download the input audio + detected-note JSON for diagnosis.
  game.setState(new EddieDebugState(hud));
} else if (params.has("eddie")) {
  // Jump straight to the Infinite Eddie settings screen.
  game.setState(new EddieSettingsState(hud));
} else {
  game.setState(new BootState(hud));
}
game.start();
