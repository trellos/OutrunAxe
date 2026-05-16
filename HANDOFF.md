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
- Mic-latency calibration screen.

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

<!-- Append new actions here -->
