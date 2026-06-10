# OutrunAxe — Agent Guide

## What this is

A **3D on-rails rhythm-combat game** played with a real guitar (or voice, or
keyboard) through the microphone. You walk a fixed rail through a neon city
holding a guitar. Note-tagged enemies fly in; you destroy them by playing
notes that fit the key they live in. Sticking to a key and landing melodic
combos multiplies damage. Survive four measures per level.

Reference vibe: **Sin & Punishment / Time Crisis** (on-rails shooter) ×
**Jet Set Radio** (cel-shaded, saturated, graffiti) × **GTA III** (gritty
textured night city).

Tech: **Three.js** (rendering, scene graph, post-FX), **Web Audio API**
(timing, synthesis, mic capture), **pitchfinder/Macleod** (monophonic pitch
detection), **Vite + TypeScript** (build). Characters are built procedurally
via `src/world/characters/Killer7Style.ts` (hard 2-tone cel ramp, thick ink
outlines, `HumanoidRig` with idle/play/walk/taunt/hit/die animations) rather
than using pre-baked GLBs.

> History: this project began as a 2D Phaser pitch-visualiser. It was
> rebuilt into the current 3D game in commit `a2c57d2`. The **audio /
> pitch-detection subsystem (`src/audio/`) was carried over unchanged** —
> it is still the hardest and most carefully tuned part of the codebase.

## Design priorities

In order. When two priorities conflict, the higher one wins.

1. **The audio engine is sacred.** `src/audio/PitchEngine.ts` is the single
   source of truth for pitch detection and must not be forked. Speed over
   robustness on dirty input; onset timing > pitch-label accuracy. (See the
   "Audio engine" section — these rules are unchanged from the original
   project and still govern any work in `src/audio/`.)
2. **Music timing comes from the AudioContext clock, never rAF.** The
   Conductor schedules beats at exact `AudioContext.currentTime` offsets.
   Gameplay reads `audioTime`; visuals interpolate against it. Never drive
   combat or scoring off frame count.
3. **Look like the references.** Cel-shaded materials + inverse-hull
   outlines + controlled neon bloom. A screenshot should be defensible
   beside a Jet Set Radio / GTA III still. No bare geometric primitives for
   the player or enemies.
4. **One engine, many states.** `Game` owns a single state machine
   (`Boot → Loadout → LevelSelect → Level → Results`). Each state owns its
   own scene contents and cleans them up in `exit()`.

## Architecture

```
engine/      Game (state machine + rAF loop), Renderer (WebGL + Composer +
             cameras), Clock (audioNow() — the only AudioContext reader),
             EventBus (typed pub/sub), AssetLoader (GLTF + SkeletonUtils
             clone + promise cache)
   |  states pushed/popped by Game.setState
   v
states/      Boot -> Loadout -> LevelSelect -> Level -> Results.
             LevelState wires Conductor + PitchTracker + KeyResolver +
             ComboScorer + EnemyDirector + BulletSystem + Avatar.
   |  shared AudioContext clock
   v
audio/       UNCHANGED from the original project: Conductor (lookahead beat
             scheduler + phase machine), PitchEngine (*** the algorithm,
             single source ***), PitchTracker (live mic wrapper),
             DrumSynth / BeepSynth / AudioRecorder, plus BackingTrack (new,
             per-level bass/pad/arp synth).
```

### Gameplay data flow

```
PitchTracker (mic)  -> PitchEngine readings
   |
   v
KeyResolver  - narrows the candidate major-key set as notes arrive;
               publishes pitchFired { pitchClass, confidence, ... }
   |
   |-> EnemyDirector / BulletSystem - any live enemy whose key contains
   |     the fired pitch class takes damage proportional to confidence
   |
   `-> ComboScorer - watches the per-measure note stream, detects 5
         melodic patterns, emits combo { multiplier } which BulletSystem
         applies as a retroactive damage burst
```

Keyboard fallback (`Z S X D C V G B H N J M` = C…B) routes through
`PitchTracker.emitSyntheticNote()` so the Timeline and KeyResolver see the
same event stream as the mic, and plays an audible oscillator tone.

## Project layout

```
src/
  engine/
    Game.ts            state machine + rAF; calls state.update(dt, audioTime)
    Renderer.ts        WebGLRenderer + Composer + cams. Perf flags (URL): ?nofx
                       (skip bloom), ?dpr1 (pixelRatio 1), ?norender, ?noaa,
                       ?grab (preserveDrawingBuffer, for toDataURL — OFF by default)
    Clock.ts           audioNow() — the ONLY place that reads currentTime
    EventBus.ts        tiny typed pub/sub
    AssetLoader.ts     GLTFLoader + SkeletonUtils.clone + promise cache
  states/
    BootState.ts       title, best scores, PLAY
    LoadoutState.ts    pick character, variant, guitar (live avatar preview)
    LevelSelectState.ts 3 level cards + spinning icosahedra
    LevelState.ts      *** the game *** — wires every subsystem, chase cam,
                       live score HUD, dispatch chord + juice
    ResultsState.ts    ENCORE/WIPEOUT, stats, NEW BEST, persistence,
                       scrollable dispatch log + total time
    resultsFormat.ts   pure formatters for the results dispatch list / total time
  world/
    RailRunner.ts      advances t along a CatmullRomCurve3; pos + forward
    Avatar.ts          procedural character from registry; cel-shaded; strum anim
    PlayerAnchor.ts    transform the avatar/bullets hang off
    Environment.ts     per-theme procedural canvas-textured city; lays the
                       road + curbs FLAT via buildFlatRibbon (roadVerify.ts)
    roadVerify.ts      pure flat-ribbon builder + bounding-box / isRoadFlat checks
    Props.ts           cars, lamps, hydrants, dumpsters, signs, benches…
    characters/
      Killer7Style.ts    shared cel-shading (2-tone ramp, ink outline), HumanoidRig
      [character defs]   Dirty Velvet, Prayer, Winter (mains); MBA, Man Hater,
                         Latte Sipper, Prude (enemy variants)
  combat/
    Enemy.ts           12 designs (boombox/cassette/…/robots), faces, pop
    EnemyDirector.ts   spawn schedule, approach easing, contact damage
    BulletSystem.ts    tracer lines + instant damage on pitchFired
    PlayerStats.ts     hp, kills, passes, score getter, dispatch log
  audio/
    chords.ts          pure triad helper for the enemy-dispatch chord (no WebAudio)
  music/
    keys.ts            major-key pitch-class tables, narrowing math
    KeyResolver.ts     candidate-key narrowing -> pitchFired events
    ComboScorer.ts     5 melodic multipliers -> combo events
  render/
    Composer.ts        EffectComposer: Render -> Bloom -> Grade -> Output
    ToonRamp.ts        shared 3-step gradient map for MeshToonMaterial
    Outline.ts         inverse-hull (back-face, scaled) black outline
  hud/
    Overlay.ts         HP bar, status, key readout, combo flash, live SCORE (DOM)
    Timeline.ts        3 lines x 4 measures, scrolls up; plots played notes
  levels/
    level1.ts          Strip Mall Sunset (90 BPM) + LevelConfig type
    level2.ts          Subway Mezzanine (110 BPM)
    level3.ts          Rooftop Skyline (130 BPM)
  state/
    Loadout.ts         outfit/guitar enum + localStorage persistence
  audio/               UNCHANGED — see "Audio engine" below
  main.ts              builds Game, mounts canvas, starts on click
public/assets/
  character.glb        CC0 RobotExpressive (Idle/… clips), ~456 KB
plans/
  outrunaxe-3d-guitar-solo-combat.md   the build plan (now executed)
```

## Run / verify

- `npm run dev` — Vite dev server (port auto-picks if 5173 busy).
- `/` — the game. `?auto=1` — debug auto-fire (clears levels hands-free,
  used for headless verification). `?record=1` — capture an audio session.
- `npx tsc --noEmit` — typecheck. Run before considering work done.

### Headless preview gotchas (learned the hard way)

- The dev preview runs level logic faster than wall-clock; a level can
  finish in ~5 s of real time. To inspect a mid-play frame, cancel the rAF
  loop: `const g=window.__game; cancelAnimationFrame(g.rafId); g.__frozen=true;`
  then `g.renderer.composer.render(0.016)` and screenshot.
- The MCP screenshot tool intermittently stalls on the heavy frozen scene.
  Restarting the preview server gives a fresh window that captures fine.
  `renderer.domElement.toDataURL()` needs `preserveDrawingBuffer`, which is now
  OFF by default (it forced a per-frame framebuffer copy — a real perf cost).
  Add `?grab` to the URL to re-enable it for an in-page canvas grab.
- If `gl.drawingBufferWidth` reads 1, the headless window collapsed — force
  `renderer.setSize(w,h)` + `composer.setSize(w,h)` via eval.

## Character system

The procedural character system (`src/world/characters/Killer7Style.ts`) builds
all player and enemy characters from scratch — no GLBs. `HumanoidRig` defines
seven base character archetypes (Dirty Velvet, Prayer, Winter for player;
MBA, Man Hater, Latte Sipper, Prude for enemies) with three variants each,
all sharing the same cel-shading (hard 2-tone ramp, thick ink outline). Each
archetype defines physique (shoulder/waist width, arm/leg thickness, sleeveless),
and six animations (idle, play, walk, taunt, hit, die) are procedurally
generated as morphed skeletal shapes.

**Current limitation:** Enemy.ts still assigns enemies to the old music-object
designs (boombox/cassette/etc.). Mapping those 12 pitch classes onto the 4
Killer7 enemy archetypes (preserving HP/flash/death/label tinting) is pending.

## Critical gotchas (do not regress these)

1. **GLB rig binding** (`Avatar.mountModel`). RobotExpressive's body parts
   are rigid meshes parented to armature bones; only the hands are skinned.
   *Never scale or reposition the cloned scene root* — it owns the armature
   and mutating it before the rig is posed corrupts the skinned bind, which
   collapses every body part to the origin (symptom: only the guitar
   renders). Instead: wrap the clone in a plain outer `Group`, create the
   AnimationMixer, `mixer.update(epsilon)` to pose frame-0, *then*
   measure/scale the outer group.
2. **Skinned-mesh frustum culling.** Camera-adjacent skinned/bone-driven
   meshes get wrongly culled because their bind-pose bounding sphere
   doesn't match the posed/animated position. `celShadeModel` sets
   `mesh.frustumCulled = false` on every model mesh. Keep it.
3. **Bloom threshold is high on purpose** (`Composer.ts`, ~0.9). Lower and
   lit white geometry (subway tiles, the avatar's legs, road dashes) blows
   out to a white blob. Only genuinely emissive neon should bloom.
4. **Avatar lighting is world-space, not camera-parented.** Three dedicated
   lights (key/rim/fill) follow the avatar each frame in
   `LevelState.update`. The avatar is a world object on the rail; the
   camera *chases* it from behind+above. Camera-parenting the GLB
   reintroduces culling + lighting bugs.
5. **EnemyDirector spawns during count-in but hides until `playing`.** This
   keeps first-wave travel timing correct without visually rushing the
   player before the music starts. The approach curve is eased
   (`APPROACH_EASE_POWER`) so enemies hang back then lunge.
6. **Shared geo/tex caches in `Enemy.ts` are module-scope and never
   per-instance disposed.** Only per-instance materials are freed. Disposing
   shared resources corrupts other live enemies.

## Combat feedback & scoring

Five features layer feedback and score onto the core combat loop. All the
math/formatting lives in small **pure modules** (no WebAudio/WebGL/DOM) so it
is unit-tested headlessly; the stateful `LevelState`/`ResultsState`/
`Environment` wiring consumes those helpers.

1. **Enemy-dispatch chord + juice + log.** When a shot (or an `applyMeasureCombo`
   burst) kills an enemy, `LevelState.playDispatchChord` voices a triad whose
   ROOT is the killing note's pitch class, so the burst is musically tied to
   the shot. The voicing is pure: `src/audio/chords.ts` exports
   `TRIAD_INTERVALS` (`major:[0,4,7]`, `minor:[0,3,7]`), `CHORD_ROOT_MIDI_BASE`
   (48 = C3, keeping the chord in a low-ish C3..C4 register under the per-note
   blips), and `chordForPitchClass(pc, mode="major") → [root, third, fifth]`
   absolute MIDI; an unknown pitch class falls back to a C root so the
   oscillator never gets a NaN frequency. The kill also fires self-decaying
   camera shake and a "DISPATCHED" juice letter. Both kill paths (`pitchFired`
   and `applyMeasureCombo`) call `PlayerStats.recordDispatch(pitchClass,
   damage, time)`, appending to `stats.dispatches` in dispatch order for the
   results screen.
2. **Real-time score HUD.** `PlayerStats.score` is the single source of truth:
   `kills*100 + round(totalDamage*50)`. `LevelState` pushes it to the HUD each
   frame via `setScore` (`src/hud/Overlay.ts`, `.hud-score*`), and
   `ResultsState` reads the same getter — so the live counter and the final
   tally can never diverge. Infinite Eddie keeps its own readout
   (`eddieTotal → eddieScorePop → onScorePop` in `eddieArtFactory.ts`); it is
   unrelated to combat scoring and was left as-is.
3. **Flat road.** `Environment.buildRoad` previously extruded a vertical
   cross-section along the level curve with `THREE.ExtrudeGeometry`, whose
   Frenet frame mapped the road's WIDTH onto the vertical axis — the road
   "stood up" as a tall ribbon facing the camera. It now uses
   `buildFlatRibbon` (`src/world/roadVerify.ts`), which samples the curve and
   offsets each sample left/right along the *horizontal* (XZ) perpendicular of
   the tangent, so the strip is wide across the ground and only `thickness`
   tall regardless of the curve's frame. `roadBoundingBox` / `isRoadFlat`
   (sizeY / max(sizeX,sizeZ) ≤ ratio, default 0.2) rebuild the exact shipped
   geometry so a test and the renderer can never disagree. The same builder
   lays the curbs (via its `offset` arg).
4. **Enhanced results screen.** `ResultsState` takes an `elapsedSeconds` ctor
   param (computed and passed by `LevelState`) and renders a scrollable list of
   every dispatched enemy plus a TOTAL TIME row (`.results-dispatch*`). The row
   strings come from pure formatters in `src/states/resultsFormat.ts`:
   `formatDuration(s)→"m:ss"`, `formatDispatchTime(offset)→"+s.ss"` under a
   minute / `"mm:ss.mmm"` beyond, and `formatDispatchRows(dispatches, opts?)`
   which normalizes each time against the first dispatch (or an explicit
   `reference`) and formats damage to one decimal.

**Tests** (co-located `*.test.ts`, all headless under the `node` vitest env):
`src/audio/chords.test.ts`, `src/combat/PlayerStats.test.ts`,
`src/world/roadVerify.test.ts`, `src/states/resultsFormat.test.ts`.

## Audio engine (unchanged — original project rules still apply)

`src/audio/` was carried over verbatim from the pre-3D project. Its design
rules are unchanged and still binding:

- **One algorithm, two callers.** `PitchEngine.ts` is the single source of
  truth. `PitchTracker` (live mic) and the offline test bench are thin
  wrappers. Algorithm changes go in `PitchEngine`. Do not reintroduce
  parallel implementations — they drift.
- **Speed over robustness on dirty input.** Respond fast to clean attacks;
  don't add heuristics that improve muted-strum/noise handling at the cost
  of clean-input latency.
- **Onset timing > pitch-label accuracy.** Visual position is anchored to
  the detected onset; the label is added once the detector locks.
- **Exploit rhythmic priors.** `PitchTracker` passes
  `Conductor.proximityToExpectedAttack()` into the engine to raise
  sensitivity near expected note positions. Plumbing is live; the window/
  threshold range is uncalibrated.
- The engine is `reset()` at the count-in->playing boundary to discard
  beep-bleed state.

`BackingTrack.ts` is the only new audio module: a per-level
bass/pad/arpeggio synth scheduled off the Conductor clock. It does not
touch PitchEngine.

## Conventions

- **Algorithm changes go in `PitchEngine.ts`.** Editing the test bench to
  change detection behaviour is the bug pattern that caused the historical
  live/offline divergence.
- **Music timing reads `audioNow()` / Conductor events. Visuals read rAF
  `dt`.** Never cross these.
- **Every state cleans up in `exit()`** — remove scene objects, detach
  event listeners, stop the Conductor/tracker. Leaks compound across
  retries.
- **`npx tsc --noEmit` must be clean** before claiming work done.
- **Levels are hardcoded TS modules** (`levels/level{1,2,3}.ts`). Do not
  build a data-driven level format until there's a fourth level asking for
  it.

## Persisted state (localStorage)

- `outrunaxe.loadout` — JSON `{ outfit, guitar }` (enum string ids).
- `outrunaxe.best.<levelName>` — integer best score per level; drives the
  Boot/LevelSelect "BEST" rows and the Results "NEW BEST!" badge.

## Infinite Eddie mode — hard rules (learned corrections, do NOT regress)

1. **Grid cells are note timelines, not labels.** Each measure cell in the
   Infinite Eddie grid plots the *notes the player actually played* in that
   measure, positioned by beat across the cell width. NEVER fill a cell with text
   like "INTRO 1" or measure numbers ("1".."16") as its body — the played notes
   go there. The only text on the grid is the bass-chord label *above* a cell and
   the 8th/16th tag badges; the cell body is a note plot. (A new `eddieNote` juice
   event carries played notes to the grid.)
2. **No PLAY button on the play screen.** `InfiniteEddieState` is already
   recording the moment it loads — it must NOT show a PLAY/record button. The PLAY
   button belongs ONLY to the settings screen (`EddieSettingsState`), which starts
   the run. The art debug gallery (`?eddieart=1`) mounts the button only to review
   that asset; that is not the game screen.
3. **Background & particles are registries** under `src/eddie/art/backgrounds/`
   and `src/eddie/art/particles/` (6 options each), reviewable via
   `?eddieart=1&bg=N` / `&fx=N`. Settings themes via `?eddie=1&theme=N`.
4. **Latency calibration is ONE measured value — never the browser's reported
   latency.** The player runs a guided gate on the settings screen (play 8
   quarter notes); the median onset-vs-beat offset is persisted as
   `localStorage["eddie.latencyMs"]` (see `audio/latencyStore.ts`) and applied
   once in `PitchTracker` (subtracted from every emitted time). Do NOT reintroduce
   `outputLatency`/`baseLatency`-based compensation — it's inaccurate on Windows
   and was removed. The offset can be negative (players land ahead of the click).
5. **The grid plots on the ONSET, not on settled pitch.** Each played note gets a
   bar at its attack time (lane filled in when the pitch resolves); the
   `DUPLICATE_ONSET_WINDOW` in `PitchEngine` is 90ms — anything larger eats fast
   notes (triplets/16ths). Bars are duration bars (onset→note end); scored
   quarters turn green.
6. **Recording for diagnosis:** `?eddie=1&rec` records a play session; the
   settings RECORD button records there. The capture JSON includes the beat grid
   so bar timing can be checked offline.
7. **The crowd is a multi-entity rig** under `src/eddie/characters/`
   (`CharacterManager` owns the pools). A scored quarter's diamonds spawn ONE
   entity per diamond; the quarter's rhythmic **subdivision** picks the type and
   each note's **timing accuracy** picks the size: quarter/8th → dudes
   (`Character`), triplet → guns (`Gun`), 16th → rockets (`Rocket`). Visuals are
   DOM elements over the grid, sprite sheets loaded by `SpriteLoader` (tries
   `.png` then `.svg`). Sprites are generated by `scripts/sprites/*.mjs` via the
   dependency-free `png.mjs` encoder; `node generate-sprites.js` rebuilds all of
   `public/assets`. Land-mode sprites are bone-white pixel-art figures.
8. **Battle mode** (`src/states/BattleState.ts`, BootState **BATTLE** button /
   `?battle`) is Score Run's sibling: a finite **16-measure** shark fight on the
   ocean bg with a 1-measure count-in (no count-in grid row — the screen pulses)
   and a **4-measure rolling grid** (`gridMeasures: 4`, folds the absolute
   measure `% 4`, whole-row clear at each loop boundary). The same diamonds spawn
   your army, but `CharacterManager`'s `battle` flag reskins it: dudes line up at
   `groundFraction` (≈0.8 down the water) and swim; guns → **windsurf boards**,
   rockets → **boomerangs** (a `battle` flag on `Gun`/`Rocket` swaps sprite +
   behaviour — note the class/pool names still say gun/rocket). **Sharks**
   (`Shark.ts`) spawn one per BEAT from the horizon, turn toward the people ~1/3
   up, and eat plain dudes; only windsurfers + boomerangs kill them. Score
   (sharks killed / dudes eaten) shows under the main readout and on the results
   screen. The shared grid/feedback changes (`scoredMeasures`/`introRow` in
   `EddieGrid`, `gridMeasures`/`crowdBattle` in `eddieArtFactory`) are additive —
   Score Run is unchanged by default. **No on-screen instructional/help text in
   Battle** — it's a video game, not an app; players don't read UI copy. Convey
   things through art and feel (e.g. the count-in is a screen pulse), not a HUD
   paragraph. The only Battle HUD text is the score (sharks killed / dudes eaten,
   under the main readout, with sprite icons) and the results screen.

## Glossary

- **pitchFired** — `KeyResolver` event: a played pitch class plus a
  confidence that rises as the candidate key set narrows.
- **Combo** — one of 5 melodic patterns (start/end on root, two-octave
  run, repeated triplet, repeated 16th) detected per measure by
  `ComboScorer`; applied as a retroactive damage multiplier burst.
- **Approach easing** — `Enemy.update` moves enemies along a `pow(u, p)`
  curve so they stay distant early and rush in near their scheduled
  arrival beat.
- **Chase cam** — `LevelState` places the avatar on the rail and positions
  the camera behind+above it, looking down the rail. Not camera-parented.
- **Dispatch** — an enemy kill. Logged to `PlayerStats.dispatches`
  (`{pitchClass, damage, time}`) and surfaced as the dispatch chord + juice in
  play and the scrollable dispatch list on the results screen.
- **Dispatch chord** — a `chordForPitchClass`-voiced triad rooted on the
  killing note's pitch class, played on each kill so the burst is tied to the
  shot that landed it.
- **Preroll / count-in / playing / done** — Conductor phases (unchanged).
  Enemies spawn during count-in but are hidden until `playing`.
