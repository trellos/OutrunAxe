import type { Game, GameState } from "../engine/Game";
import type { PlayerStats } from "../combat/PlayerStats";
import { MenuPulse } from "../hud/MenuPulse";

export class ResultsState implements GameState {
  readonly name = "results";
  private overlay: HTMLDivElement | null = null;
  private pulse: MenuPulse | null = null;

  constructor(
    private hudParent: HTMLElement,
    private stats: PlayerStats,
    private outcome: "win" | "fail",
    private levelName: string,
    private onRetry: () => void,
    private onLevelSelect: () => void,
  ) {}

  enter(_game: Game) {
    const score =
      this.stats.kills * 100 + Math.round(this.stats.totalDamage * 50);

    const key = "outrunaxe.best." + this.levelName;
    const prevRaw = localStorage.getItem(key);
    const prevBest = prevRaw !== null && prevRaw !== "" ? Number(prevRaw) : 0;
    const isNewBest = score > prevBest;
    const newBest = Math.max(prevBest, score);
    localStorage.setItem(key, String(newBest));

    this.overlay = document.createElement("div");
    this.overlay.className = `outrun-results outrun-results-${this.outcome}`;
    this.overlay.innerHTML = `
      <div class="results-card">
        <div class="results-headline">${this.outcome === "win" ? "ENCORE" : "WIPEOUT"}</div>
        ${isNewBest ? '<div class="results-new-best">NEW BEST!</div>' : ""}
        <table class="results-stats">
          <tr><td>kills</td><td>${this.stats.kills}</td></tr>
          <tr><td>passes</td><td>${this.stats.passes}</td></tr>
          <tr><td>notes fired</td><td>${this.stats.notesFired}</td></tr>
          <tr><td>damage dealt</td><td>${this.stats.totalDamage.toFixed(1)}</td></tr>
          <tr><td>hp remaining</td><td>${this.stats.hp}/${this.stats.maxHp}</td></tr>
          <tr><td>score</td><td>${score}</td></tr>
        </table>
        <div class="results-actions">
          <button class="results-retry">RETRY</button>
          <button class="results-levelselect">LEVEL SELECT</button>
        </div>
      </div>
    `;
    this.hudParent.appendChild(this.overlay);
    this.overlay
      .querySelector(".results-retry")!
      .addEventListener("click", () => this.onRetry());
    this.overlay
      .querySelector(".results-levelselect")!
      .addEventListener("click", () => this.onLevelSelect());

    this.pulse = new MenuPulse(this.hudParent);
    void this.pulse.start();
  }

  exit() {
    this.pulse?.stop();
    this.pulse = null;
    this.overlay?.remove();
  }

  update() {
    this.pulse?.tick();
  }
}
