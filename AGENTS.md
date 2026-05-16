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
detection), **Vite + TypeScript** (build). The character model is the CC0
`RobotExpressive` GLB loaded via `GLTFLoader`.

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
    Renderer.ts        WebGLRenderer (preserveDrawingBuffer), Composer, cams
    Clock.ts           audioNow() — the ONLY place that reads currentTime
    EventBus.ts        tiny typed pub/sub
    AssetLoader.ts     GLTFLoader + SkeletonUtils.clone + promise cache
  states/
    BootState.ts       title, best scores, PLAY
    LoadoutState.ts    pick 1 of 3 outfits x 3 guitars (live avatar preview)
    LevelSelectState.ts 3 level cards + spinning icosahedra
    LevelState.ts      *** the game *** — wires every subsystem, chase cam
    ResultsState.ts    ENCORE/WIPEOUT, stats, NEW BEST, persistence
  world/
    RailRunner.ts      advances t along a CatmullRomCurve3; pos + forward
    Avatar.ts          GLB rig + procedural guitar; cel-shaded; strum anim
    PlayerAnchor.ts    transform the avatar/bullets hang off
    Environment.ts     per-theme procedural canvas-textured city
    Props.ts           cars, lamps, hydrants, dumpsters, signs, benches…
  combat/
    Enemy.ts           12 designs (boombox/cassette/…/robots), faces, pop
    EnemyDirector.ts   spawn schedule, approach easing, contact damage
    BulletSystem.ts    tracer lines + instant damage on pitchFired
    PlayerStats.ts     hp, kills, passes, score
  music/
    keys.ts            major-key pitch-class tables, narrowing math
    KeyResolver.ts     candidate-key narrowing -> pitchFired events
    ComboScorer.ts     5 melodic multipliers -> combo events
  render/
    Composer.ts        EffectComposer: Render -> Bloom -> Grade -> Output
    ToonRamp.ts        shared 3-step gradient map for MeshToonMaterial
    Outline.ts         inverse-hull (back-face, scaled) black outline
  hud/
    Overlay.ts         HP bar, status, key readout, combo flash (DOM)
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
  `renderer.domElement.toDataURL()` works because `preserveDrawingBuffer`
  is enabled in `Renderer.ts`.
- If `gl.drawingBufferWidth` reads 1, the headless window collapsed — force
  `renderer.setSize(w,h)` + `composer.setSize(w,h)` via eval.

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
- **Preroll / count-in / playing / done** — Conductor phases (unchanged).
  Enemies spawn during count-in but are hidden until `playing`.
