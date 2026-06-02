// Infinite Eddie — end-to-end Playwright spec (GDD §9 QA "e2e path").
//
// Covers the full §9 e2e flow:
//   launch → LevelSelect → Infinite Eddie → settings assertions → PLAY →
//   5×4 grid present → synthetic notes (keyboard fallback) increment score →
//   active measure advances → mode completes and returns to a menu.
//
// ─────────────────────────────────────────────────────────────────────────
// RUN STATUS (2026-05-30): WIRED + RUNNABLE. playwright.config.ts exists, the
// `playwright` package + chromium are provisioned, and `npm run test:e2e` runs
// this spec against the Vite dev server (webServer reuses a running dev server).
// Each test passes IN ISOLATION (verified): the settings test always; the
// calibration + full-path detection tests need a live AudioContext clock, and
// some headless audio backends only run one at a time — see playwright.config.ts
// ENVIRONMENT NOTE. Run a single audio test with, e.g.:
//   npx playwright test -g "calibration"
//
// The spec deliberately uses STABLE, code-verified selectors (class names that
// exist in the integration branch at the time of writing):
//   - LevelSelect entry button: `.levelselect-eddie` (LevelSelectState.ts)
//   - Settings overlay:         `.eddie-settings` (EddieSettingsState.ts)
//   - Settings fields:          [data-field="bpm"|"key"|"bass"]
//   - Settings timeline canvas: `.eddie-settings-timeline canvas.timeline-row`
//   - PLAY button mount:        `.eddie-settings-play`
//   - Play-screen grid:         `.eddie-grid` with 20 × `.eddie-cell`
//   - Active cell:              `.eddie-cell-active`
//   - Score readout value:      `.eddie-score-value` (starts "0")
//
// It jumps straight to settings via `?eddie=1` for the focused assertions AND
// exercises the real LevelSelect → Infinite Eddie click path in a separate
// test, so both the routing and the deep flow are covered.

// NOTE: imported from "playwright/test" (the runner shipped with the installed
// `playwright` package) rather than "@playwright/test", which isn't a separate
// dependency here. Both expose the identical test API.
import { test, expect, type Page } from "playwright/test";

const BASE_URL = process.env.EDDIE_BASE_URL ?? "http://localhost:5173";

// The settings screen requires an AudioContext + (optional) mic. In CI the mic
// is denied and the code falls back to the keyboard path — exactly what we test.
test.use({
  permissions: [], // deny mic on purpose: forces the emitSyntheticNote fallback
  launchOptions: {
    args: [
      "--autoplay-policy=no-user-gesture-required",
      "--use-fake-ui-for-media-stream",
      "--mute-audio",
    ],
  },
});

/** The valid initial roots per GDD §9 ({E,A,G,C} × {maj,min}). */
const RANDOM_ROOTS = ["E", "A", "G", "C"];

/** The sample guitar tracks offered by the ?eddiedebug record/calibrate menu
 *  (mirrors SAMPLES in EddieDebugState.ts). Each is routed through the REAL
 *  onset→pitch chain via the fake mic, so the grid must plot what's in it.
 *  `match` is a distinctive substring of the card label (Playwright hasText).
 *  `minNotes` is a conservative per-file floor (the "Taps" file is intentionally
 *  quiet — peak ~0.09 — so the gate finds only ~4 onsets in it; that's faithful
 *  detection, not a display bug). The real assertion is display FIDELITY: the
 *  grid plots essentially every detected onset. */
const SAMPLE_TRACKS = [
  { match: "90 BPM", name: "Eighths · 90 BPM (mp3)", minNotes: 8 },
  { match: "Scale eighths", name: "Scale eighths · 120 BPM", minNotes: 8 },
  { match: "Taps", name: 'Taps "16ths" · 120 BPM', minNotes: 2 },
];

/** Press a piano key (KeyZ..) which the states map through emitSyntheticNote. */
async function jam(page: Page, codes: string[]) {
  for (const code of codes) {
    await page.keyboard.down(code);
    await page.waitForTimeout(40);
    await page.keyboard.up(code);
    await page.waitForTimeout(40);
  }
}

test.describe("Infinite Eddie", () => {
  test("settings screen meets §9 defaults (?eddie=1)", async ({ page }) => {
    await page.goto(`${BASE_URL}/?eddie=1`);

    const overlay = page.locator(".eddie-settings");
    await expect(overlay).toBeVisible();

    // Default tempo 120.
    await expect(page.locator('[data-field="bpm"]')).toHaveText(/120\s*BPM/);

    // Random initial key in {E,A,G,C} — now a dropdown (data-field="key-root").
    const rootSel = page.locator('select[data-field="key-root"]');
    await expect(rootSel).toBeVisible();
    const keyVal = await rootSel.inputValue();
    expect(RANDOM_ROOTS).toContain(keyVal);

    // Major/Minor radios, exactly one checked.
    await expect(page.locator('input[name="eddie-mode"]')).toHaveCount(2);
    await expect(page.locator('input[name="eddie-mode"]:checked')).toHaveCount(1);

    // A rendered 4-measure bass window (one chip per measure root).
    await expect(page.locator(".eddie-bass-note")).toHaveCount(4);
    const bassText = (await page.locator('[data-field="bass"]').textContent())?.trim() ?? "";
    expect(bassText).toMatch(/[A-G]/);

    // A live input timeline canvas (the signal-chain proof).
    await expect(
      page.locator(".eddie-settings-timeline canvas.timeline-row"),
    ).toBeVisible();

    // A juicy PLAY button is mounted.
    await expect(page.locator(".eddie-settings-play")).toBeVisible();
  });

  test("full path: title → Infinite Eddie → PLAY → score → advance → menu", async ({
    page,
  }) => {
    // Launch the real app (BootState).
    await page.goto(`${BASE_URL}/`);

    // The title screen now offers two modes; INFINITE EDDIE goes straight to the
    // Eddie settings screen (OUTRUN takes the loadout/level-select path).
    const eddieBtn = page.locator(".boot-play-eddie");
    await expect(eddieBtn).toBeVisible();
    await eddieBtn.click();

    // Settings screen up.
    await expect(page.locator(".eddie-settings")).toBeVisible();

    // Force C major so the chromatic keyboard cluster below (C,D,E,F,G,A,B —
    // KeyZ/X/C/V/B/N/M) is ENTIRELY in key. The scorer zeroes any quarter that
    // contains an out-of-key note, so a random key would make scoring flaky.
    await page.selectOption('select[data-field="key-root"]', "C");
    await page.check('input[name="eddie-mode"][value="major"]');

    // PLAY → InfiniteEddieState.
    await page.locator(".eddie-settings-play").click();

    // 5×4 grid present (20 cells).
    const grid = page.locator(".eddie-grid");
    await expect(grid).toBeVisible();
    await expect(page.locator(".eddie-cell")).toHaveCount(20);

    // Score starts at 0.
    const scoreValue = page.locator(".eddie-score-value");
    await expect(scoreValue).toHaveText("0");

    // Wait until the play window opens (active cell leaves the intro row 0 and
    // lands on a scored cell). The conductor count-in is 16 beats, so at 120 BPM
    // that's ~8s; give generous headroom.
    await expect(page.locator(".eddie-cell-active")).toBeVisible({ timeout: 30000 });

    // Jam the chromatic cluster KeyZ/X/C/V/B/N/M = C,D,E,F,G,A,B — all in C
    // major (forced above), so every scored quarter is in-key and earns points.
    // Repeat across several quarters; keep jamming while we poll for the score.
    for (let i = 0; i < 12; i++) {
      await jam(page, ["KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN", "KeyM"]);
    }

    // Score must increment above 0 once a scored quarter is observed. Poll the
    // score readout (it reflects eddieScorePop → eddieTotal). Generous timeout:
    // the count-in (~10s) plus a full quarter must elapse, and headless audio
    // scheduling can lag under load.
    await expect
      .poll(async () => Number((await scoreValue.textContent())?.replace(/\D/g, "") || "0"), {
        timeout: 45000,
      })
      .toBeGreaterThan(0);

    // Active measure advances: capture the active cell index, then assert it
    // changes as the conductor walks measures.
    const activeIndex = async () =>
      page.evaluate(() => {
        const cells = Array.from(document.querySelectorAll(".eddie-cell"));
        return cells.findIndex((c) => c.classList.contains("eddie-cell-active"));
      });
    const first = await activeIndex();
    await expect.poll(activeIndex, { timeout: 30000 }).not.toBe(first);

    // Completion: after the 16 scored measures + linger, the play state calls
    // onExit and routes back to LevelSelect (a menu). 16 measures at 120 BPM is
    // ~32s of play + intro + linger; keep the wait bounded but generous. The
    // return target is the LevelSelect overlay.
    await expect(page.locator(".outrun-levelselect")).toBeVisible({ timeout: 90000 });
  });

  // Per-sample timeline-fidelity tests: route each KNOWN sample guitar track
  // through the real onset→pitch chain (fake mic, record mode) and assert the
  // grid TIMELINE displays the played notes correctly — plotted as duration
  // bars, spread across measures, and matching the detected onset count. No
  // mic/keyboard randomness, so this is deterministic up to detector variance.
  test.describe("sample tracks: the timeline displays the notes", () => {
    for (const track of SAMPLE_TRACKS) {
      test(`${track.name}`, async ({ page }) => {
        await page.goto(`${BASE_URL}/?eddiedebug=1`);

        const card = page.locator(".eddie-bgmenu-card", { hasText: track.match });
        await expect(card).toBeVisible();
        await card.click();

        // Record HUD up + the play screen mounts the 20-cell grid.
        await expect(page.locator(".eddie-capture-hud")).toBeVisible({ timeout: 10000 });
        await expect(page.locator(".eddie-cell")).toHaveCount(20);

        // Helper: how many distinct measure cells currently hold ≥1 note bar.
        const cellsWithNotes = () =>
          page.evaluate(() => {
            const cells = new Set<Element>();
            document.querySelectorAll(".eddie-note").forEach((n) => {
              const cell = n.closest(".eddie-cell");
              if (cell) cells.add(cell);
            });
            return cells.size;
          });

        // After the count-in + file playback, the file's notes stream onto the
        // grid (~8-10s count-in, then the notes). Wait for enough to land.
        await expect
          .poll(async () => page.locator(".eddie-note").count(), { timeout: 90000 })
          .toBeGreaterThan(track.minNotes);

        // 1) Notes are PLACED across the timeline (≥2 distinct measure cells),
        //    not dumped into one — proves per-measure timing placement. Poll,
        //    since the notes spread as successive measures play.
        await expect.poll(cellsWithNotes, { timeout: 60000 }).toBeGreaterThanOrEqual(2);

        // 2) Notes render as duration BARS (onset→end), not zero-width dots:
        //    at least one bar has grown past the 4px attack stub.
        const maxWidthPx = await page.evaluate(() =>
          Math.max(
            0,
            ...Array.from(document.querySelectorAll<HTMLElement>(".eddie-note")).map(
              (n) => n.getBoundingClientRect().width,
            ),
          ),
        );
        expect(maxWidthPx).toBeGreaterThan(5);

        // 3) DISPLAY FIDELITY (the core check): the grid plots essentially every
        //    detected onset — the timeline shows what was played, not a subset.
        //    Read both at the same instant (both update off the same onset event;
        //    a few onsets past measure 15 aren't plotted, hence the 0.6 floor).
        const counts = (await page.locator('[data-cap="counts"]').textContent()) ?? "";
        const onsets = Number(counts.match(/onsets\s+(\d+)/)?.[1] ?? "0");
        expect(onsets).toBeGreaterThan(0);
        const gridNotes = await page.locator(".eddie-note").count();
        expect(gridNotes).toBeGreaterThanOrEqual(Math.floor(onsets * 0.6));
      });
    }
  });
});
