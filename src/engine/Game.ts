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
    // Per-frame profile exposed for the diagnostics overlay (?perf=1): how long
    // update() vs render() take, so a low framerate can be pinned to game logic,
    // rendering, or (if both are tiny) browser compositing / GC outside our JS.
    const profile = { updateMs: 0, renderMs: 0 };
    (window as unknown as { __frameProfile?: typeof profile }).__frameProfile = profile;
    const tick = (t: number) => {
      const dt = Math.min(0.1, (t - this.lastTime) / 1000);
      this.lastTime = t;
      const aTime = audioNow();
      const u0 = performance.now();
      this.state?.update(dt, aTime);
      const u1 = performance.now();
      this.renderer.render(dt);
      profile.updateMs = u1 - u0;
      profile.renderMs = performance.now() - u1;
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop() {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }
}
