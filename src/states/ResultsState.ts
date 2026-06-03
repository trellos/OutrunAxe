import type { Game, GameState } from "../engine/Game";
import type { PlayerStats } from "../combat/PlayerStats";
import { MenuPulse } from "../hud/MenuPulse";
import { formatDispatchRows, formatDuration } from "./resultsFormat";

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
    /** Elapsed play time in seconds (play-start to finish). Defaults to 0;
     *  falls back to the dispatch-log span when not provided. */
    private elapsedSeconds = 0,
  ) {}

  /** Best total-time source: the explicit elapsed value, else the span of the
   *  dispatch log (last - first), else 0. Guards against NaN/negative. */
  private totalSeconds(): number {
    if (Number.isFinite(this.elapsedSeconds) && this.elapsedSeconds > 0) {
      return this.elapsedSeconds;
    }
    const d = this.stats.dispatches;
    if (d.length >= 2) {
      const span = d[d.length - 1].time - d[0].time;
      if (Number.isFinite(span) && span > 0) return span;
    }
    return 0;
  }

  private escape(s: string): string {
    return s.replace(/[&<>"']/g, (c) =>
      c === "&"
        ? "&amp;"
        : c === "<"
          ? "&lt;"
          : c === ">"
            ? "&gt;"
            : c === '"'
              ? "&quot;"
              : "&#39;",
    );
  }

  private dispatchListHtml(): string {
    const rows = formatDispatchRows(this.stats.dispatches);
    if (rows.length === 0) {
      return `
        <div class="results-dispatch">
          <div class="results-dispatch-title">enemies dispatched</div>
          <div class="results-dispatch-empty">no enemies dispatched</div>
        </div>`;
    }
    const body = rows
      .map(
        (r) => `
          <tr>
            <td class="results-dispatch-pitch">${this.escape(r.pitchClass)}</td>
            <td class="results-dispatch-dmg">${this.escape(r.damage)}</td>
            <td class="results-dispatch-time">${this.escape(r.timeLabel)}</td>
          </tr>`,
      )
      .join("");
    return `
      <div class="results-dispatch">
        <div class="results-dispatch-title">enemies dispatched (${rows.length})</div>
        <div class="results-dispatch-scroll">
          <table class="results-dispatch-table">
            <thead>
              <tr><th>pitch</th><th>dmg</th><th>time</th></tr>
            </thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      </div>`;
  }

  enter(_game: Game) {
    const score = this.stats.score;

    const key = "outrunaxe.best." + this.levelName;
    const prevRaw = localStorage.getItem(key);
    const prevBest = prevRaw !== null && prevRaw !== "" ? Number(prevRaw) : 0;
    const isNewBest = score > prevBest;
    const newBest = Math.max(prevBest, score);
    localStorage.setItem(key, String(newBest));

    const totalTime = formatDuration(this.totalSeconds());

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
          <tr><td>total time</td><td>${totalTime}</td></tr>
          <tr><td>score</td><td>${score}</td></tr>
        </table>
        ${this.dispatchListHtml()}
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
