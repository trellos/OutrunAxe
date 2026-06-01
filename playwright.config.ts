import { defineConfig } from "playwright/test";

// E2E config for the Infinite Eddie specs. Runs against the Vite dev server on
// 5173; reuses an already-running dev server if present (so it composes with the
// live preview during development). Audio/mic flags let the mic-denied keyboard
// fallback and fake-mic file playback run headless.
export default defineConfig({
  testDir: "./tests/e2e",
  // Eddie is entirely AudioContext-clock-driven (the Conductor's beat scheduler
  // reads audioContext.currentTime; scoring is gated on the "playing" phase). So
  // every detection/scoring test needs a LIVE audio clock.
  //
  // ENVIRONMENT NOTE: some headless/CI audio backends only keep ONE AudioContext
  // running at a time, so a second Eddie test (serial OR parallel) can find its
  // clock frozen and detect nothing. Each test passes reliably IN ISOLATION:
  //   npx playwright test -g "calibration"
  //   npx playwright test -g "full path"
  // On a CI with a normal audio stack the serial run below is green; where the
  // backend is single-context, shard the audio tests one-per-job (or use -g).
  timeout: 180_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 2,
  reporter: [["list"]],
  use: {
    baseURL: process.env.EDDIE_BASE_URL ?? "http://localhost:5173",
    trace: "retain-on-failure",
    launchOptions: {
      args: [
        "--autoplay-policy=no-user-gesture-required",
        "--use-fake-ui-for-media-stream",
        "--mute-audio",
      ],
    },
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
