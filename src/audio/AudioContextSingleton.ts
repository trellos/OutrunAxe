// One AudioContext for the whole app. Created lazily on first user gesture so
// the browser doesn't block it under autoplay policy.

let ctx: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
  }
  if (ctx.state === "suspended") {
    void ctx.resume();
  }
  return ctx;
}
