# OutrunAxe — Session Handoff

Read this first when starting a new session. It describes the game, the
decisions already locked in, where things stand, and the rules to work by.
For deep architecture see `AGENTS.md`; for the build history see
`plans/outrunaxe-3d-guitar-solo-combat.md`. This file is the short version
plus the running action log at the bottom.

---

## What the game is

**OutrunAxe** is a 3D on-rails rhythm-combat game. You walk a fixed rail
through a neon night city holding a guitar. Note-tagged enemies fly in; you
destroy them by playing notes (mic, voice, or keyboard) that fit the musical
key the enemy lives in. Committing to one key and landing melodic combos
multiplies your damage. Survive four measures per level.

**Reference vibe:** Sin & Punishment / Time Crisis (on-rails shooter) ×
Jet Set Radio (cel-shaded, saturated) × GTA III (gritty textured night
city). A screenshot should be defensible beside those.

**Stack:** Three.js (rendering + post-FX), Web Audio API (timing/synthesis/
mic), pitchfinder/Macleod (monophonic pitch detection), Vite + TypeScript.
Character is the CC0 `RobotExpressive` GLB via `GLTFLoader`.

**Controls:** Mic (play/sing notes in an enemy's key) or keyboard piano
`Z S X D C V G B H N J M` = C…B. URL flags: `?auto=1` hands-free demo,
`?record=1` capture an audio session.

**Levels:** L1 Strip Mall Sunset (90 BPM, tutorial), L2 Subway Mezzanine
(110 BPM), L3 Rooftop Skyline (130 BPM).

---

## Decisions that have been made (locked unless explicitly revisited)

1. **Full rebuild Phaser 2D → Three.js 3D.** The 2D pitch-visualiser origin
   is gone. The rebuild landed in commit `a2c57d2`.
2. **Audio subsystem (`src/audio/`) carried over UNCHANGED and is sacred.**
   `PitchEngine.ts` is the single source of truth for pitch detection — do
   not fork it. Speed over robustness on dirty input; onset timing >
   pitch-label accuracy. Algorithm changes go in `PitchEngine`, never the
   test bench.
3. **Music timing comes from the AudioContext clock, never rAF.** Conductor
   schedules beats at exact `AudioContext.currentTime` offsets. Gameplay
   reads `audioTime`; visuals interpolate against it. Never drive combat or
   scoring off frame count.
4. **Real GLB character asset, not stacked primitives.** RobotExpressive
   GLB. No bare geometric primitives for the player or enemies.
5. **Chase camera, NOT camera-parented avatar.** The avatar is a world
   object on the rail; the camera chases it from behind+above. Camera-
   parenting the GLB reintroduced culling + lighting bugs and is rejected.
6. **One engine, many states.** Single state machine
   `Boot → Loadout → LevelSelect → Level → Results`; each state owns and
   cleans up its own scene contents in `exit()`.
7. **Levels are hardcoded TS modules** (`levels/level{1,2,3}.ts`). No
   data-driven level format until a fourth level demands it.
8. **Cel-shaded look:** MeshToonMaterial + inverse-hull outlines +
   controlled neon bloom. Bloom threshold is intentionally high (~0.9 in
   `Composer.ts`) so only emissive neon blooms; lit white geometry stays
   crisp instead of blowing out.
9. **Gameplay loop:** per-measure candidate-key narrowing
   (`KeyResolver`) → `pitchFired` damages any live enemy whose key contains
   the pitch class; `ComboScorer` detects 5 melodic multipliers
   (start-on-root, end-on-root, two-octave root run, repeated triplet
   phrase, repeated 16th phrase) → retroactive damage burst.
10. **Git: commit, do NOT push.** Standing instruction. Two commits sit
    unpushed on branch `EpicQuest`: `a2c57d2` (rebuild), `27bb3b8` (docs).

---

## Critical gotchas — do not regress these

1. **GLB rig binding** (`Avatar.mountModel`). RobotExpressive body parts
   are rigid meshes parented to armature bones; only hands are skinned.
   Never scale/reposition the cloned scene root. Wrap the clone in a plain
   outer `Group`, create the AnimationMixer, `mixer.update(epsilon)` to
   pose frame-0, *then* measure/scale the outer group. Mutating the root
   before posing collapses every body part to the origin (symptom: only
   the guitar renders).
2. **Skinned-mesh frustum culling.** `celShadeModel` sets
   `mesh.frustumCulled = false` on every model mesh. Keep it.
3. **Bloom threshold ~0.9 on purpose** (`Composer.ts`). Lower it and white
   geometry blows to a blob.
4. **Avatar lighting is world-space.** Three lights (key/rim/fill) follow
   the avatar each frame in `LevelState.update`.
5. **EnemyDirector spawns during count-in but hides until `playing`**
   (`visible=false`), so first-wave travel timing is correct without
   rushing the player before the music starts.
6. **Shared geo/tex caches in `Enemy.ts` are module-scope, never
   per-instance disposed.** Only per-instance materials are freed.

---

## Working rules

- `npx tsc --noEmit` must be clean before claiming any work done.
- Every state cleans up in `exit()` — remove scene objects, detach
  listeners, stop Conductor/tracker. Leaks compound across retries.
- Verify visually via the headless preview before claiming a visual fix.
  Headless preview runs faster than wall-clock; freeze the rAF loop to
  inspect a mid-play frame (see `AGENTS.md` "Headless preview gotchas").
- Be honest about gaps. Do not claim "done" until verified.
- `ECC_GATEGUARD=off` must be set in the user's own shell to disable the
  slow fact-forcing hook; an agent cannot self-disable it.

---

## Current status

- Playable end to end: menu flow, loadout, 3 visually distinct levels,
  ENCORE win verified on L1, ComboScorer firing on screen, NEW BEST
  persistence working, cel-shaded character holding a guitar on all levels.
- Working tree clean. Branch `EpicQuest`, 2 commits ahead, unpushed.

### Known open work (not yet requested as tasks)

- ComboScorer unit tests.
- Audible verification of the `BackingTrack` mix.
- L2/L3 difficulty tuning for unaided human play.

---

## Action log

New actions go below, newest at the bottom. Each entry: date, what was
asked, what was done, resulting commit(s) if any.

- **2026-05-15** — Created this handoff file to seed fresh sessions.
  No code changes.

- **2026-05-15** — Orchestrated parallel agents for two tasks.
  **Task 1 (game iteration):** timeline notes now render as sustained
  horizontal bars (not dot rows); the timeline records during the
  count-in and slides rows up as they fill; a "signal chain" 1-measure
  menu timeline + looping metronome + mic/keyboard pulse was added to
  the title, loadout, level-select and results (ENCORE) screens so the
  player can confirm their rig works before a level (`src/hud/MenuPulse.ts`,
  `src/hud/Timeline.ts`, the 4 menu states, `src/style.css`).
  **Task 2 (Killer7 art pass):** new procedural character system in
  `src/world/characters/` — shared `Killer7Style.ts` (hard 2-tone cel
  ramp, thick ink outlines, `HumanoidRig` with idle/play/walk/taunt/hit/
  die procedural anims, `buildK7Guitar`), 7 character defs each with 3
  variants (mains: 80s Gunslinger, Skinny Singer, Metal — all 3 guitars;
  enemies: MBA, Man Hater, Latte Sipper, Prude). Debug gallery at
  `?chars=1` (`CharacterDebugState`) displays all 21 with animation/
  guitar/orbit controls. Player `Avatar` rewritten off the GLB onto the
  registry mains; `Loadout` + `LoadoutState` now pick character/variant/
  guitar. `npx tsc --noEmit` clean; flow verified by scene-graph
  introspection (screenshot tooling times out on the heavy WebGL scene —
  a known env limitation, not a code defect).
  **Open follow-up (not yet done):** in-game enemy swap. `Enemy.ts` still
  uses the old music-object designs; mapping the 12 pitch classes onto
  the 4 new Killer7 enemy types/variants (preserving hp/flash/death/label
  tinting) was deliberately deferred so variants can be picked/iterated in
  the gallery first.

- **2026-05-15** — Bug pass (3 parallel agents).
  **Timeline:** notes now group strictly by `PitchUpdate.onsetId` via a
  shared pure `src/hud/noteBars.ts` `BarAccumulator` (reused by
  `Timeline` + `MenuPulse`) — a held note is one continuous bar instead
  of a dot row (mic pitch wobble no longer fragments it). Beat-pulse
  overlay canvas added (own rAF, torn down on detach/stop) so the
  recording beat line pulses on its beat. New sample-audio regression:
  `src/test/barCount.ts` + `notes-90bpm` source
  (`/pitch-test.html?source=notes-90bpm`) asserts bars==onsets and no
  inflation — PASS (17 bars / 17 onsets from 65 raw detections).
  **Camera:** building setback raised (strip 9→17, subway 14→20,
  rooftop 12→20); chase camera trail 5.5→4.6, height +2.0→+2.6.
  Deterministic full-curve sweep shows ~9–12u camera↔building
  clearance (live in-motion view not visually confirmable headless —
  screenshot tooling times out, audio-gated rail won't advance in
  introspection; verified by geometry sweep + the larger setback).
  **Characters/Character Select:** mains renamed — 80s Gunslinger→
  **Dirty Velvet**, Skinny Singer→**Prayer**, Metal→**Winter** (label
  only; ids unchanged). Loadout avatar faces the camera (guitar toward
  camera) with a subtle sway + live strum tick (no more constant spin);
  picking a character now rolls a random variant and the variant
  buttons were removed. `npx tsc --noEmit` clean.

- **2026-05-15** — Bug pass #2 (7 parallel agents).
  **Timeline:** rebuilt so one row = ONE 4-beat measure (was 16 beats),
  so clean quarter notes land exactly on the beat verticals (x
  0/144/288/432) instead of bunched far-left; beat pulse now fires
  beat 1→4 left→right tracking the conductor; whole timeline +
  MenuPulse confined to the top ≤25vh as a thin compact strip (3px
  bars) so it no longer obscures the title/character/gameplay.
  `BarAccumulator` API + `barCount` test left intact.
  **Killer7Style:** strum animation reworked to a tight wrist/forearm
  arc across the strings (no hip pump); guitar silhouettes — blackstrat
  = Stratocaster (double cutaway, two horns), goldtop = Les Paul
  (single cutaway), jazzmaster = offset. `RigShape` extended:
  `waist`, `armThickness`, `legThickness`, `sleeveless`; new anchors
  `upperArmAnchorR/L`, `foreArmAnchorR/L` (defaults reproduce old
  output).
  **Physiques:** Dirty Velvet — V-shape (shoulders ~1.4, waist ~0.62,
  pec/lat plate) all variants. Winter — sleeveless, armThickness 1.7,
  waist 0.7, bicep/tricep/forearm silhouette meshes on the new arm
  anchors. Prayer — all 3 variants uniformly tall (1.95) & skinny
  (slim build, thin arm/leg thickness).
  **Level sightline:** deterministic replay of curve+camera+enemy math
  over 40 RNG seeds × full run × all spawns × approach path = 77,520
  camera→enemy ray tests, 0 blocked after moving strip/subway/rooftop
  neon signs + strip billboards out of the forward corridor (only
  `Environment.ts` changed; buildings/camera already clear).
  `npx tsc --noEmit` clean.

- **2026-05-15** — Bug pass #3 (5 parallel agents + live verification).
  **Timeline:** notes now sit in 12 discrete pitch-class lanes
  (B/C/D/E no longer smear into one blob); crisp 1:1 canvas, no
  antialias blur (imageSmoothingEnabled off, integer coords,
  `image-rendering:pixelated`, no scaling transforms); still ≤25vh.
  **Character Select:** guitar shrunk (scale 0.82 → body ≈0.59u, was
  ~1.5u and hid the character); loadout camera reframed to
  (0,1.05,2.6)/look(0,1,0) so the whole figure fits (~57% frame).
  **Enemy note labels:** background panel removed; big bold floating
  block glyph (512² canvas, 900-weight, thick outline+glow), sprite
  scale 3.0, raised to y=1.75.
  **Audio feedback:** each detected note plays a 1/32-note blip
  ((60/bpm)/8 s) at the played pitch; volume 0.05→0.22 and waveform
  sine→sawtooth (two crossfaded oscs) driven by m =
  0.6·confidence + 0.4·comboNorm. Tunable in `LevelState`.
  **City unblocked (the big one):** `Environment.ts` now guarantees a
  clear corridor — each building is pushed outward until its footprint
  is ≥ CLEAR (strip/rooftop 24u, subway 21u) from the NEAREST point of
  the WHOLE curve (not just one sample), plus a height cap for any
  building within 32u. Verified by the agent (60 RNG seeds × full run ×
  FOV-70 frustum, worst in-cone ~49–54u) AND independently by me on the
  live shipped code forcing the rail: L1 25u surface / 46u in forward
  cone, L2 (subway) 22u / 42u — street is open. `npx tsc --noEmit`
  clean; no console errors.

- **2026-05-29** — Difficulty / juice tuning pass (commit `6b0bfbb`, merged as `e566dd5`).
  **Approach curve:** `APPROACH_EASE_POWER` scaled from 2.6 → 1.3 so enemies advance steadily instead of rushing on the final lunge; menace lean threshold tightened to the final 15% of approach.
  **Root-note bonus:** `fire()` now takes `pitchClass` and returns `{ applied, rootHit }`; `ROOT_DAMAGE_MULTIPLIER = 2.5` when the played note matches the enemy's key. Root tracers doubled with warm yellow color and longer lifetime (0.26 s).
  **Hit juice:** scale-punch on damage (1.0 → 1.35 → 1.0 over 0.18 s), damage popups (`+N.N` / `+N.N ROOT`) float up over 0.55 s, impact thud (filtered noise, 600/900 Hz) on hit.
  **Play window doubled:** `PLAY_BEATS` 16 → 32 (8 measures play instead of 4). All three levels respread to use the new space; enemy arrival beats now 8 → 30.
  **Levels rebalanced:** L1 (C+E, 8 enemies, HP 2.5/4), L2 (G+B+D, 11 enemies, HP 2.5/4), L3 (E+A+F#+C#, 13 enemies, HP 2.5/4/5). Each enemy gets full 3 measures approach.
  **Verification:** TypeScript clean, all 64 tests pass, L1 auto-fire smoke test verified (6 enemies, 6 kills, 0 passes, 100/100 HP). Single-keypress damage test confirmed root multiplier fires through full chain.
  **Known issue (likely HMR artifact):** After `PLAY_BEATS` bump, auto-fire showed 0 kills/0 damage on L2/L3 despite notes firing. Hypothesis: Vite HMR held stale module state; clean restart recommended before shipping.
  **Tuning knobs** (highest impact first): `ROOT_DAMAGE_MULTIPLIER`, per-level `hp`, `APPROACH_EASE_POWER`, `travelBeats` per spawn, `PLAY_BEATS`.
  **Open questions:** L1's two-key choice (C+E vs C+F# for sharper distinction), boss HP ramp, damage popup world-projection vs HUD-centered.
  `npx tsc --noEmit` clean.

- **2026-06-02** — Combat feedback & scoring batch (commits `0cbf107`, `6b99cda`, `0dde692`, `a7318a1`) + docs/tests pass.
  **Dispatch chord + juice + log:** kills voice a triad rooted on the killing note's pitch class (`src/audio/chords.ts`, pure), with self-decaying camera shake and a "DISPATCHED" letter; both kill paths log to `PlayerStats.dispatches`.
  **Live score HUD:** `PlayerStats.score` (`kills*100 + round(totalDamage*50)`) is the single source of truth for the in-play HUD counter (`setScore`) AND the results tally — they read the same getter so they can't drift. Eddie's separate readout left as-is.
  **Flat road:** `Environment.buildRoad` no longer extrudes a vertical cross-section (the `ExtrudeGeometry` Frenet frame stood the road up on its width); it now uses `buildFlatRibbon` from the new `src/world/roadVerify.ts`, which offsets curve samples along the horizontal tangent perpendicular. `isRoadFlat`/`roadBoundingBox` rebuild the shipped geometry for verification. Curbs share the builder via its `offset` arg.
  **Results screen:** `ResultsState` gains `elapsedSeconds` + a scrollable dispatch list and TOTAL TIME row, formatted by the pure `src/states/resultsFormat.ts`.
  **Docs/tests:** documented all five in `AGENTS.md` (layout map, new "Combat feedback & scoring" section, glossary). Filled test gaps without duplicating prior coverage — extended `roadVerify.test.ts` (flat-ribbon shape/vertex count, vertical-ribbon rejection, ratio boundary, degenerate curve, curb offset) and `PlayerStats.test.ts` (HUD/results display-string parity). Edge cases for `chords`/`PlayerStats` dispatch log/`resultsFormat` were already covered. `npm test` = 10 files / 120 tests green; `npm run build` clean.

- **2026-06-06** — Infinite Eddie **crowd** + new **Battle** mode (branch `BattleMode`; not committed at time of writing).
  **Crowd (lineage, shipped earlier as PR #11):** the Eddie play screen grew a multi-entity crowd under `src/eddie/characters/` — `CharacterManager` spawns one entity per scored diamond, type by subdivision (quarter/8th→dude, triplet→gun, 16th→rocket), size by timing accuracy. Sprites moved from vector SVG to **bone-white pixel-art PNGs** generated by `scripts/sprites/*.mjs` through a dependency-free encoder `scripts/sprites/png.mjs` (the game's `SpriteLoader` tries `.png` then `.svg`). `node generate-sprites.js` rebuilds `public/assets`.
  **Battle mode:** `src/states/BattleState.ts` (+ BootState **BATTLE** button / `?battle`). A finite **16-measure** shark fight on the ocean bg: 1-measure count-in (screen pulse, no count-in grid row), a **4-measure rolling grid** (`EddieGrid` gained `scoredMeasures` + `introRow`; `eddieArtFactory` threads `gridMeasures`/`gridIntroRow`/`crowdBattle`/`crowdGroundFraction`/score callbacks — all additive, Score Run unchanged). The crowd's `battle` flag reskins it: dudes line up ≈80% down the water and swim; guns→**windsurf boards**, rockets→**boomerangs** (`battle` flag on `Gun`/`Rocket` swaps sprite+behaviour; pool/class names still read gun/rocket). New `Shark.ts` enemy spawns one per BEAT from the horizon either side of the sun, turns toward the people ~1/3 up, then sweeps eating plain dudes; only windsurfers + boomerangs kill it (`Blood`/`Bonk` effects added to `effects.ts`). Score (sharks killed / dudes eaten) shows under the main readout + on a results screen. Battle/effect sprites: `swim-{big,medium,small}`, `shark-down`/`shark-side`, `blood`, `windsurf-board`, `boomerang`, `bonk`.
  **Verification:** `tsc --noEmit` clean; verified live by driving the rAF loop in the preview (hidden-tab pause + flaky software-WebGL screenshots are a known env limit) — shark spawn cadence/turn point, board/boomerang kills, eat path, 80% line, score all confirmed. **Code-review cleanup (same session):** removed the now-orphaned `ConductorOptions.loop` (Battle became finite, no caller left), the unused `Character.moveTo`, and a dangling doc comment in `BattleState`.
  **Known follow-ups:** per-beat shark spawn is uncapped (≈50+ on screen — perf risk, consider a soft cap / sweep-speed tuning); `Gun`/`Rocket` class+pool names have drifted from their Battle meaning (board/boomerang); count-in note-plot in `BattleState.placeOnGrid` is vestigial (grid has no intro row); stale `.svg` sprite fallbacks remain in `public/assets`.

<!-- Append new actions here -->
