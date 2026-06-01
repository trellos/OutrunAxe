// PerfHud — a tiny, self-contained realtime diagnostics overlay for the Eddie
// screens (enable with ?perf=1). It exists because the dev preview browser
// software-renders WebGL (no real FPS) and has no audio device, so the symptoms
// that matter — dropped beats and true framerate — can only be measured on the
// player's real machine. This turns their screen into the test rig.
//
// It runs its OWN requestAnimationFrame loop so it measures the true display
// rate and the worst main-thread frame gap (a gap > ~100ms is what starves the
// Conductor's look-ahead scheduler and drops the beat). Feed it beats and onsets
// from the host state via noteBeat()/noteOnset().

import { getAudioContext } from "../audio/AudioContextSingleton";

export class PerfHud {
  private el: HTMLDivElement | null = null;
  private rafId: number | null = null;

  private lastFrame = 0;
  private frames = 0;
  private worstGapMs = 0;
  private worstUpdateMs = 0;
  private worstRenderMs = 0;
  private windowStart = 0;

  private onsetsInWindow = 0;
  private beatsInWindow = 0;
  private lastBeatAt = 0; // performance.now() of the last beat fed in
  private playing = false;

  // Rolling display values (updated ~4×/sec).
  private fps = 0;
  private worstShown = 0;
  private updShown = 0;
  private rndShown = 0;
  private onsetsPerSec = 0;
  private beatsPerSec = 0;

  /** GPU/driver string — reveals whether Chrome is HARDWARE-accelerating WebGL
   *  or falling back to a software rasterizer (SwiftShader), which would cap the
   *  whole game at single-digit fps no matter what the code does. */
  private glInfo = "?";

  private probeGl(): void {
    try {
      const c = document.createElement("canvas");
      const gl = (c.getContext("webgl2") ||
        c.getContext("webgl")) as WebGLRenderingContext | null;
      if (!gl) {
        this.glInfo = "no webgl";
        return;
      }
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      const r = dbg
        ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL))
        : String(gl.getParameter(gl.RENDERER));
      // Flag the tell-tale software rasterizers.
      const soft = /swiftshader|software|llvmpipe|basic render/i.test(r);
      this.glInfo = (soft ? "⚠ SOFTWARE — " : "") + r.slice(0, 60);
    } catch {
      this.glInfo = "probe failed";
    }
  }

  mount(parent: HTMLElement): void {
    this.probeGl();
    const el = document.createElement("div");
    el.className = "eddie-perf-hud";
    el.style.cssText =
      "position:absolute;left:12px;top:12px;z-index:80;pointer-events:none;" +
      "font:11px/1.45 ui-monospace,Menlo,Consolas,monospace;color:#9effa0;" +
      "background:rgba(6,4,16,0.82);border:1px solid #00f0ff;border-radius:6px;" +
      "padding:8px 10px;white-space:pre;min-width:190px;" +
      "box-shadow:0 0 14px rgba(0,240,255,0.35);";
    el.textContent = "perf: warming up…";
    parent.appendChild(el);
    this.el = el;

    const now = performance.now();
    this.lastFrame = now;
    this.windowStart = now;
    this.lastBeatAt = now;
    this.rafId = requestAnimationFrame(this.tick);
  }

  /** Host calls this on every Conductor beat (any phase). */
  noteBeat(): void {
    this.beatsInWindow++;
    this.lastBeatAt = performance.now();
  }

  /** Host calls this on every detected onset. */
  noteOnset(): void {
    this.onsetsInWindow++;
  }

  /** Host marks whether the transport should currently be producing beats, so
   *  a "BEAT DROPPED" warning only fires when beats are actually expected. */
  setPlaying(playing: boolean): void {
    this.playing = playing;
  }

  private tick = (t: number): void => {
    const gap = t - this.lastFrame;
    this.lastFrame = t;
    this.frames++;
    if (gap > this.worstGapMs) this.worstGapMs = gap;
    const prof = (window as unknown as {
      __frameProfile?: { updateMs: number; renderMs: number };
    }).__frameProfile;
    if (prof) {
      if (prof.updateMs > this.worstUpdateMs) this.worstUpdateMs = prof.updateMs;
      if (prof.renderMs > this.worstRenderMs) this.worstRenderMs = prof.renderMs;
    }

    const elapsed = t - this.windowStart;
    if (elapsed >= 250) {
      const sec = elapsed / 1000;
      this.fps = Math.round(this.frames / sec);
      this.worstShown = Math.round(this.worstGapMs);
      this.updShown = Math.round(this.worstUpdateMs);
      this.rndShown = Math.round(this.worstRenderMs);
      this.onsetsPerSec = +(this.onsetsInWindow / sec).toFixed(1);
      this.beatsPerSec = +(this.beatsInWindow / sec).toFixed(1);
      this.frames = 0;
      this.worstGapMs = 0;
      this.worstUpdateMs = 0;
      this.worstRenderMs = 0;
      this.onsetsInWindow = 0;
      this.beatsInWindow = 0;
      this.windowStart = t;
      this.render(t);
    }

    this.rafId = requestAnimationFrame(this.tick);
  };

  private render(t: number): void {
    if (!this.el) return;
    const ctx = getAudioContext();
    const outLatMs = Math.round((ctx.outputLatency || 0) * 1000);
    const baseLatMs = Math.round((ctx.baseLatency || 0) * 1000);
    const sinceBeat = t - this.lastBeatAt;
    const beatDropped = this.playing && sinceBeat > 1200;

    const fpsFlag = this.fps >= 58 ? "" : this.fps >= 45 ? "  ⚠" : "  ✗";
    const gapFlag = this.worstShown <= 20 ? "" : this.worstShown <= 50 ? "  ⚠" : "  ✗ (beat-drop risk)";
    // "other" = the slice of the worst frame NOT spent in our update()/render().
    // If this dominates, the cost is browser compositing/CSS/GC, not our code.
    const otherMs = Math.max(0, this.worstShown - this.updShown - this.rndShown);

    this.el.textContent =
      `FPS        ${this.fps}${fpsFlag}\n` +
      `worst frame ${this.worstShown}ms${gapFlag}\n` +
      `  update   ${this.updShown}ms\n` +
      `  render   ${this.rndShown}ms\n` +
      `  other    ${otherMs}ms${otherMs > this.updShown + this.rndShown ? "  ← compositing/GC" : ""}\n` +
      `onsets/s   ${this.onsetsPerSec}\n` +
      `beats/s    ${this.beatsPerSec}${beatDropped ? "  ✗ BEAT DROPPED" : ""}\n` +
      `audio      ${Math.round(ctx.sampleRate / 1000)}k · out ${outLatMs}ms · buf ${baseLatMs}ms · ${ctx.state}\n` +
      `gpu        ${this.glInfo}`;
    this.el.style.borderColor = beatDropped || this.fps < 45 ? "#ff5252" : "#00f0ff";

    // Also log so the numbers can be read from the console history (e.g. via a
    // remote driver) — including visibilityState, since a hidden tab throttles
    // rAF and must be excluded when judging real foreground fps.
    // eslint-disable-next-line no-console
    console.log(
      `[perf] fps=${this.fps} worst=${this.worstShown}ms upd=${this.updShown} ` +
        `rnd=${this.rndShown} other=${otherMs} vis=${document.visibilityState}`,
    );
  }

  dispose(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.el?.remove();
    this.el = null;
  }
}
