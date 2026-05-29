# Infinite Eddie — QA Sign-off

- **Verdict:** PASS-WITH-OPEN-ITEMS
- **Date:** 2026-05-29
- **QA:** QA agent (infinite-eddie team)
- **Integration branch:** `infinite-eddie` @ `de40eed`
- **Authority:** verified against `docs/GDD.md` §9 (acceptance), §11, §12.

The feature is **mergeable and ships green** on every automated gate. The only
reason this is not an unconditional PASS is that **live in-browser
visual/audio review could not be performed in this environment** (browser
navigation is denied — see Open Items). Those items need a human or a
browser-capable run; nothing is failing.

---

## 1. Summary table

| Check (GDD §9 QA) | Result |
|---|---|
| `npx tsc --noEmit` on `infinite-eddie` | **PASS** (exit 0) |
| `npm test` (vitest) on `infinite-eddie` | **PASS** — 7 files, **77/77** tests |
| 21 variant branches exist, exact names | **PASS** |
| 14 option-2/3 branches `tsc --noEmit` clean | **PASS** (14/14) |
| 7 option-1 branches == `de40eed` | **PASS** (all point at `de40eed`) |
| Scorer unit tests encode §9 invariants | **PASS** (assertions read & confirmed present + passing) |
| Conductor additive options / combat unaffected | **PASS** (default-construction tests green) |
| `main.ts` debug routes wired | **PASS** (`?eddie`, `?eddieart`, `?eddiesound`) |
| LevelSelect "INFINITE EDDIE" entry | **PASS** |
| Dev server boots + serves Eddie module graph | **PASS** (18/18 modules HTTP 200, no transform errors) |
| `exit()` teardown (clocks/DOM/Three/listeners) | **PASS** (code-reviewed; see §5) |
| Playwright e2e spec authored | **PASS (authored)** / **NOT EXECUTED** (no browser) |
| Live visual review (art variants, juice, 80s direction) | **UNVERIFIED** — needs human/browser |
| Live audio review (beat/bass, no orphan oscillators) | **UNVERIFIED** — needs human/browser |
| 5× enter/exit leak check at runtime | **UNVERIFIED at runtime** — static review only |

---

## 2. Automated gates (main tree, `infinite-eddie`)

Run in the main working tree (kept on `infinite-eddie` throughout — branch never
switched there, per the git rule).

- `npx tsc --noEmit` → **exit 0**, no diagnostics.
- `npm test` → **Test Files 7 passed (7) / Tests 77 passed (77)**, ~262ms.

---

## 3. 21-branch audit

All 21 branches exist with **exact** GDD §12.3 names. The 7 `option-1` branches
point at the integrated default `de40eed`. Each `option-2/3` branch = `de40eed`
+ that single variant's scoped change, and each compiles clean.

| Branch | SHA | tsc | Scope of diff vs `de40eed` |
|---|---|---|---|
| `art/grid/option-1` | de40eed | == default | (integrated default) |
| `art/grid/option-2` | 187d7fb | **PASS** | EddieGrid.ts + eddie.css |
| `art/grid/option-3` | c53591d | **PASS** | EddieGrid.ts + eddie.css |
| `art/background/option-1` | de40eed | == default | (integrated default) |
| `art/background/option-2` | 5cb3e40 | **PASS** | EddieBackground.ts |
| `art/background/option-3` | d9cfb80 | **PASS** | EddieBackground.ts |
| `art/fire/option-1` | de40eed | == default | (integrated default) |
| `art/fire/option-2` | ed71a2e | **PASS** | EddieFire.ts |
| `art/fire/option-3` | d055471 | **PASS** | EddieFire.ts |
| `art/particles/option-1` | de40eed | == default | (integrated default) |
| `art/particles/option-2` | d9e6c79 | **PASS** | EddieParticles.ts + eddie.css |
| `art/particles/option-3` | d1928bc | **PASS** | EddieParticles.ts + eddie.css |
| `art/play-button/option-1` | de40eed | == default | (integrated default) |
| `art/play-button/option-2` | 6b8d3a6 | **PASS** | EddiePlayButton.ts + eddie.css |
| `art/play-button/option-3` | e7ae52c | **PASS** | EddiePlayButton.ts + eddie.css |
| `sound/beat/option-1` | de40eed | == default | (integrated default) |
| `sound/beat/option-2` | 10d96cb | **PASS** | eddieAudioFactory.ts (ACTIVE_BEAT_VARIANT → option-2) |
| `sound/beat/option-3` | b8918a9 | **PASS** | eddieAudioFactory.ts (ACTIVE_BEAT_VARIANT → option-3) |
| `sound/bass/option-1` | de40eed | == default | (integrated default) |
| `sound/bass/option-2` | 8cfb96f | **PASS** | eddieAudioFactory.ts (ACTIVE_BASS_VARIANT → option-2) |
| `sound/bass/option-3` | ec33037 | **PASS** | eddieAudioFactory.ts (ACTIVE_BASS_VARIANT → option-3) |

Method: dedicated scratch worktree `C:/dev/OutrunAxe-qa` (detached), `node_modules`
junction-linked (not copied), `git checkout -f <branch>` + `npx tsc --noEmit`
per branch. Worktree and junction removed cleanly afterward; the main tree
stayed on `infinite-eddie` the whole time (`git worktree list` confirms a single
worktree at HEAD).

Each art variant carries a substantive rewrite of its one asset file (50–290 line
diffs), consistent with "distinct in style/approach, not color swaps." Sound
variants are single-line `ACTIVE_*` constant flips against `eddieAudioFactory.ts`,
exactly as the integration model intends (the variant implementations live on the
spine; the branch selects which is active). **Note:** the *stylistic distinctness*
of art variants and the *timbral distinctness* of sound variants are code-present
but **not visually/audibly reviewed** (Open Item).

---

## 4. Scorer invariants (§9) — assertions confirmed, not just counted

`src/music/eddie/EddieScorer.test.ts` was read in full. It encodes every §9
invariant with real assertions (all passing in the 77/77 run):

- **all-roots = low**: E E E E ×16 → every event excludes `eighth`/`sixteenth`/
  tag-clear kinds; baseline-only quarters present. ✔
- **8ths > quarters**: same notes as `["E","G#"]` per quarter total higher than
  single-note quarters. ✔
- **16ths > 8ths**: 4-note quarters total higher than 2-note quarters. ✔
- **chord-tone bonus**: ending on `B` (I-chord triad tone) adds `chordTone`;
  ending on in-key non-chord `F#` does not. ✔
- **out-of-key = 0 + outOfKey**: `C` in E-major → `points === 0`,
  `kinds === ["outOfKey"]`, total 0. ✔
- **8th tag clear / 16th tag clear**: all-8ths in `eighthTagMeasure` emits
  `eighthTagClear`; all-16ths in `sixteenthTagMeasure` emits `sixteenthTagClear`.
  ✔ Plus a guard test: a partial-8th measure does **not** clear the tag. ✔
- **variation rewarded**: alternating chord tones out-score a repeated tone with
  subdivision/chord-tone held constant. ✔

`basslineGen.test.ts` exists and is part of the green suite (key membership +
deterministic-RNG coverage per §9 Gameplay criteria).

---

## 5. Leak / teardown review (§3 constraint) — static

Both states were read in full. Teardown is thorough:

**`InfiniteEddieState.exit()`** (src/states/InfiniteEddieState.ts:192):
removes the `keydown` listener; unsubscribes `offBeat`/`offPhase`/`offScore`/
`offTotal`; `scorer.detach()`, `resolver.detach()`, `tracker.stop()`,
`audio.stop()` (+ nulls it), `conductor.stop()`; `art.dispose()` (+ nulls it);
`juice.clear()`. `update()` early-returns once `exited` so no post-teardown
frames touch disposed objects. **No second clock is created** — timing rides the
single `Conductor` (constructed with `{countInBeats:16, playMeasures:16,
maxBpm:200}`, GDD §3) and beat/measure decisions read `conductor.onBeat`/
`audioTime`, never rAF.

**`EddieSettingsState.exit()`** (src/states/EddieSettingsState.ts:164):
removes `keydown`; `offBeat?.()`; `playButton.dispose()`; `tracker.stop()`,
`audio.stop()`, `conductor.stop()` (all nulled); removes the rotor from the
scene and disposes its geometry/material via `traverse`; removes all lights;
removes both canvases and the overlay DOM. A single `Conductor` parked in
preroll drives both the audio audition and the input timeline (one clock).

This satisfies the §3 menu→settings→play→settings retry-loop requirement **by
construction**. The **runtime** "no stacked clocks after 5 enter/exit cycles"
check is an Open Item (could not drive the live app).

---

## 6. Live verification — what was and was NOT possible

**Browser navigation is DENIED in this environment** (confirmed, not assumed):
`mcp__plugin_ecc_playwright__browser_navigate` returned a permission-denied
error. This matches what Gameplay/Art/Sound reported. Both Playwright MCP and
Preview MCP navigation are unavailable.

**Fallback performed (and PASSED):**
- Booted the Vite dev server (`npm run dev`) — came up clean: `VITE v5.4.21
  ready in 705ms`, serving on `http://127.0.0.1:5173`, **no errors** in the
  startup log.
- `GET /` → HTTP 200.
- Fetched the full Eddie module graph through Vite's transform pipeline — **18/18
  modules HTTP 200 with no `Transform failed` / `Internal server error` /
  `[plugin:` errors**: `main.ts`, `EddieSettingsState`, `InfiniteEddieState`,
  `EddieArtDebugState`, `EddieSoundDebugState`, `eddieTypes`, `EddieScorer`,
  `basslineGen`, `Conductor`, `eddieArtFactory`, `EddieGrid`, `EddieBackground`,
  `EddieFire`, `EddieParticles`, `EddiePlayButton`, `eddieAudioFactory`,
  `EddieBeat`, `EddieBass`. This proves the whole graph compiles and resolves
  at runtime under the real bundler, including all three `?…=1` debug routes.

**Could NOT verify (no browser execution) — OPEN ITEMS for human review:**
- That `?eddie=1` renders the settings UI with a live beat, live timeline,
  rendered bassline, and a juicy PLAY button **on screen**.
- That `?eddieart=1` gallery actually **animates** every art variant.
- That `?eddiesound=1` bench **loads, loops, and cycles** variants audibly.
- The 80s Memphis/synthwave/VHS **art direction quality** and that variants are
  genuinely distinct (not recolors) — code diffs are substantive but unjudged.
- **Audio**: beat reads as 80s drum-machine; bass has the "slight bite"; drums
  play in both count-in and playing phases; `stop()` leaves **no orphan
  oscillators / no clicks** after exit.
- **Runtime leak check**: 5× enter/exit produces no stacked audio clocks or
  leaked canvases (static review says it won't; not runtime-confirmed).
- Live score-increment + active-measure-advance + completion-to-menu (the e2e
  spec encodes these but was not executed here).

---

## 7. Playwright e2e spec

`tests/e2e/infinite-eddie.spec.ts` authored (QA-owned). It covers the §9 e2e
path: launch → boot CTA → LevelSelect → INFINITE EDDIE → settings assertions
(default 120 BPM, random key ∈ {E,A,G,C}, rendered bassline, live timeline
canvas, PLAY button) → PLAY → 5×4 grid (20 `.eddie-cell`) → keyboard-fallback
jam increments `.eddie-score-value` above 0 → active cell advances → completion
returns to `.outrun-levelselect`. Selectors were verified against current source.

**Run status: NOT EXECUTED here.** `@playwright/test` is not installed, there is
no `playwright.config`, no `test:e2e` script, and browsers are not provisioned —
and live navigation is denied regardless. The spec header documents the exact
steps to run it in a browser-capable environment (install Playwright + chromium,
add a `webServer` config, `npx playwright test`). It is written to pass as-is
there.

---

## 8. Defects filed

**None.** No tsc or test failure on any of the 21 branches; no contract or
teardown defect found in review. Nothing was filed back to Art/Sound/Gameplay.

---

## 9. Open questions for human review

1. Run `tests/e2e/infinite-eddie.spec.ts` in a browser-capable environment to
   confirm the live e2e path (score increment, measure advance, completion).
2. Eyeball `?eddie=1`, `?eddieart=1`, `?eddiesound=1` for visual/audio quality
   and 80s direction; judge variant distinctness across the art/sound branches.
3. Confirm no audible artifacts (orphan oscillators/clicks) after exiting the
   play and settings screens, and run a 5× enter/exit cycle watching for
   stacked clocks / leaked canvases (e.g. count `AudioContext`s or live
   `<canvas>` nodes via devtools).
4. Lead to pick variant winners (defaults are `option-1` everywhere, per §12.3).

---

## 10. Method notes (reproducibility)

- Main tree never branch-switched; all per-branch tsc ran in scratch worktree
  `C:/dev/OutrunAxe-qa` with a `node_modules` **junction** (link removed with
  `rmdir`, never recursive-deleted), then `git worktree remove --force`.
- Final `git worktree list` shows a single worktree at `infinite-eddie de40eed`.
- Working tree dirty only with QA-owned new files (`tests/`, this sign-off).
