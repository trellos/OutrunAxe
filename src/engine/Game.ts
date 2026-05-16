import { Renderer } from "./Renderer";
import { audioNow } from "./Clock";

export interface GameState {
  readonly name: string;
  enter(game: Game): void;
  exit(): void;
  update(dt: number, audioTime: number): void;
}

export class Game {
  readonly renderer: Renderer;
  private state: GameState | null = null;
  private rafId: number | null = null;
  private lastTime = 0;

  constructor(parent: HTMLElement) {
    this.renderer = new Renderer(parent);
  }

  setState(next: GameState) {
    if (this.state) this.state.exit();
    this.state = next;
    next.enter(this);
  }

  start() {
    if (this.rafId !== null) return;
    this.lastTime = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(0.1, (t - this.lastTime) / 1000);
      this.lastTime = t;
      const aTime = audioNow();
      this.state?.update(dt, aTime);
      this.renderer.render(dt);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop() {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }
}
