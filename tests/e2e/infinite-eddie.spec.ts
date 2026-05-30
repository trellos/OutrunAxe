// Infinite Eddie — end-to-end Playwright spec (GDD §9 QA "e2e path").
//
// Covers the full §9 e2e flow:
//   launch → LevelSelect → Infinite Eddie → settings assertions → PLAY →
//   5×4 grid present → synthetic notes (keyboard fallback) increment score →
//   active measure advances → mode completes and returns to a menu.
//
// ─────────────────────────────────────────────────────────────────────────
// RUN STATUS (recorded by QA, 2026-05-29): NOT EXECUTED in the build
// environment. `browser_navigate` (Playwright MCP and Preview MCP) is DENIED
// here, Playwright is NOT installed (no `@playwright/test` in devDependencies,
// no playwright.config, no `test:e2e` script), and the browsers are not
// provisioned. This spec is authored to be runnable AS-IS in a browser-capable
// environment. To run it there:
//
//   1. npm i -D @playwright/test && npx playwright install chromium
//   2. Add a playwright.config.ts with a webServer that runs `npm run dev`
//      on port 5173 (or start `npm run dev` manually and point BASE_URL at it).
//   3. npx playwright test tests/e2e/infinite-eddie.spec.ts
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

import { test, expect, type Page } from "@playwright/test";

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

    // Random initial key in {E,A,G,C}.
    const keyText = (await page.locator('[data-field="key"]').textContent())?.trim() ?? "";
    expect(RANDOM_ROOTS).toContain(keyText);

    // A rendered 4-measure bassline (downbeat roots joined with "·").
    const bassText = (await page.locator('[data-field="bass"]').textContent())?.trim() ?? "";
    expect(bassText.length).toBeGreaterThan(0);
    expect(bassText).toMatch(/[A-G]/);

    // A live input timeline canvas (the signal-chain proof).
    await expect(
      page.locator(".eddie-settings-timeline canvas.timeline-row"),
    ).toBeVisible();

    // A juicy PLAY button is mounted.
    await expect(page.locator(".eddie-settings-play")).toBeVisible();
  });

  test("full path: LevelSelect → Infinite Eddie → PLAY → score → advance → menu", async ({
    page,
  }) => {
    // Launch the real app (BootState), then drive to LevelSelect.
    await page.goto(`${BASE_URL}/`);

    // Boot screen has a start button; click whatever the boot CTA is, then the
    // Infinite Eddie entry on LevelSelect. We reach LevelSelect via the boot CTA.
    // (BootState mounts an .outrun-* start button; click the first visible button.)
    const bootBtn = page.locator("#hud button").first();
    await bootBtn.click();

    // LevelSelect → Infinite Eddie.
    const eddieEntry = page.locator(".levelselect-eddie");
    await expect(eddieEntry).toBeVisible();
    await eddieEntry.click();

    // Settings screen up.
    await expect(page.locator(".eddie-settings")).toBeVisible();

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
    await expect(page.locator(".eddie-cell-active")).toBeVisible({ timeout: 20000 });

    // Jam in-key notes via the keyboard fallback to drive the scorer. We can't
    // know the random key here, so spread a chromatic cluster — at least some
    // notes land in key and score. Repeat to span at least one scored quarter.
    for (let i = 0; i < 6; i++) {
      await jam(page, ["KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN", "KeyM"]);
    }

    // Score must increment above 0 once an in-key quarter is observed. Poll the
    // score readout (it reflects eddieScorePop → eddieTotal).
    await expect
      .poll(async () => Number((await scoreValue.textContent())?.replace(/\D/g, "") || "0"), {
        timeout: 20000,
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
    await expect.poll(activeIndex, { timeout: 20000 }).not.toBe(first);

    // Completion: after the 16 scored measures + linger, the play state calls
    // onExit and routes back to LevelSelect (a menu). 16 measures at 120 BPM is
    // ~32s of play + intro + linger; keep the wait bounded but generous. The
    // return target is the LevelSelect overlay.
    await expect(page.locator(".outrun-levelselect")).toBeVisible({ timeout: 90000 });
  });
});
