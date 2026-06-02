// One AudioContext for the whole app. Created lazily on first user gesture so
// the browser doesn't block it under autoplay policy.

let ctx: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!ctx) {
    // "interactive" requests the lowest output latency the browser offers. On
    // Windows that's shared-mode WASAPI (~20-40ms floor); the web has no
    // lower-level (ASIO/exclusive) path, so the residual is handled by latency
    // COMPENSATION in PitchTracker, not by trying to reach zero here.
    ctx = new AudioContext({ latencyHint: "interactive" });
  }
  if (ctx.state === "suspended") {
    // resume() can reject when called outside a user gesture (notably iOS);
    // surface it rather than swallowing so a dead-audio state is diagnosable.
    ctx.resume().catch((err) => console.warn("[audio] resume failed", err));
  }
  return ctx;
}
