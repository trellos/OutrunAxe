# Blueprint — OutrunAxe → 3D Guitar-Solo Combat Game

**Created:** 2026-05-15
**Branch policy:** branch + PR per step (gh CLI is installed but not authenticated; agents must `gh auth login` before opening PRs, or push and open manually)
**Default branch:** master
**Starting branch:** EpicQuest (clean working tree)

## Objective (verbatim)

> Turn OutrunAxe into a 3D game where the player guitar solos to fight baddies. Look: GTA IV × Jet Set Radio, cel-shaded over realism. Gameplay: on-rails forward walk through an urban landscape, character in front of camera holding a guitar; enemies labeled with notes appear and the player fires by playing notes that fit a key. Per measure: a sequence starts; as the player plays, the candidate key narrows, and each played note fires at all enemies tagged with that pitch class (broad targeting early in the measure, narrowing as the key locks). Rhythm grid: quarter / eighth / sixteenth / triplet. Damage multipliers: start-on-root, end-on-root, two-octave root-to-root run, repeated-triplet-per-beat measure, repeated-sixteenth-per-beat measure. Timeline UI: three lines × four measures, oldest scrolls up. Three starter levels in a gritty urban world.

## Current State (anchors)

- Stack: **Vite + TypeScript + Phaser 3.80 + pitchfinder** ([package.json](package.json:1)).
- Audio engine is solid and renderer-agnostic — **keep it**:
  - [src/audio/Conductor.ts](src/audio/Conductor.ts) — lookahead beat scheduler, phase machine, 90 BPM, count-in + 4-measure play.
  - [src/audio/PitchEngine.ts](src/audio/PitchEngine.ts) — single source of truth for monophonic pitch (YIN/AMDF/Macleod/ACF2PLUS).
  - [src/audio/PitchTracker.ts](src/audio/PitchTracker.ts) — live rAF + AnalyserNode wrapper.
  - [src/audio/onsetGate.ts](src/audio/onsetGate.ts), [src/audio/onsetWorklet.ts](src/audio/onsetWorklet.ts) — attack detection.
  - [src/audio/midi.ts](src/audio/midi.ts) — `midiToName`, `midiToPitchClass`, `freqToMidi`.
  - Fixture-driven tests in [src/test](src/test) — preserve harness so we don't regress detection.
- Rendering is **2D Phaser** ([src/scenes/PlayScene.ts](src/scenes/PlayScene.ts)) — this is what we replace.
- Existing colors at [src/ui/style.ts](src/ui/style.ts) (purple/cyan/magenta) — a useful seed for the art palette.

## Architecture Decisions

1. **Render engine: Three.js** layered on top of the existing audio engine. Phaser is removed; the audio modules under `src/audio/**` keep their public APIs.
2. **App shell:** a single `Game` orchestrator owns Three.js renderer, camera, scene graph, and a thin scene-state machine (`Boot` → `MainMenu` → `Loadout` → `Level` → `Results`). The Conductor + PitchTracker are wired in at `Level` start.
3. **Combat is driven by the existing event stream** (`OnsetEvent`, `PitchUpdate`, `NoteEnd`). New `KeyResolver`, `EnemyDirector`, `BulletSystem`, and `ComboScorer` subscribe; nothing in `src/audio/**` needs to know they exist.
4. **Art direction is a separate concern from gameplay** — gameplay steps render with placeholder primitives; art passes (cel shader, post-FX, character + environment models) come later and don't gate gameplay.
5. **Rails, not free movement:** Sin & Punishment / Time Crisis style. The player position is a `t ∈ [0,1]` along a `CatmullRomCurve3` per level; aim and music are the inputs the player actually controls.

## Risks & Anti-patterns

- **Don't reimplement Conductor or PitchEngine.** They're already validated by fixtures. Subscribe; never fork.
- **Don't bind gameplay logic to render frames.** Music timing comes from `audioContext.currentTime` via the Conductor's beat events, not `requestAnimationFrame`. Visuals interpolate against audio time.
- **Don't ship a "framework" for levels before there is one level.** Level 1 is a hardcoded TypeScript module; the level data type emerges from levels 2 and 3.
- **Don't gate visuals on art.** Use boxes-and-spheres until combat feels correct. Cel-shading is a polish pass.
- **Don't break the offline test bench** ([src/test](src/test)). Each step that touches audio must keep `npm run dev` and the fixture-driven analyze tools running.
- **Don't introduce a physics engine.** On-rails movement + hand-rolled hit detection (capsule/sphere) is enough. Cannon/Rapier is over-budget for this game.

## Step Dependency Graph

```
Step 1 (Three.js foundation, strip Phaser)
   ├─ Step 2 (rail spline + camera + walking) ─┐
   ├─ Step 3 (key resolver + pitch-class bus) ─┼─ Step 4 (enemy system + bullets)
   │                                           │       │
   │                                           │       └─ Step 6 (damage multipliers, combo scorer)
   ├─ Step 5 (timeline HUD: 3 lines × 4 bars)──┘
   │
   ├─ Step 7 (art direction pass: cel shader, palette, post-FX)
   │       │
   │       └─ Step 8 (player avatar + guitar + loadout: outfits/guitars)
   │                  │
   │                  └─ Step 9 (3 levels: environments + enemy choreography)
   │                            │
   └─ Step 10 (meta loop: health, lose, win, level select, results) ─────────┘
```

**Parallelizable pairs:** (2,3,5,7), (8 after 7), (9 after 8), (6 after 4).

## Invariants (verified after every step)

- `npm run build` (i.e. `tsc && vite build`) is clean.
- `npm run dev` boots and a level is playable end-to-end (count-in → measures → results).
- No new dependency on Phaser. No new dependency on a physics engine.
- The fixture analyzer still runs and pitch detection still passes against fixtures in [src/test/fixtures](src/test/fixtures).
- `audioContext.currentTime` is the authority for any music timing. `requestAnimationFrame` is for visuals only.

---

## Step 1 — Three.js foundation; strip Phaser; preserve audio engine

**Goal:** Replace Phaser with Three.js, keep audio pipeline byte-identical, render a placeholder level (ground plane + sky + a few cubes) with the existing count-in / play / done phase machine driving an on-screen status text.

**Model tier:** strongest. This is the load-bearing architectural step.

**Branch:** `step-1-threejs-foundation`

**Context brief (cold-start):**
- Project: a TypeScript+Vite browser game called OutrunAxe; the existing build uses Phaser 3 to render a 2D bar grid where the player's sung/played pitches appear as dots and bends. We're pivoting to a 3D on-rails rhythm shooter.
- Audio modules under [src/audio](src/audio) are renderer-agnostic and must not be modified beyond importing what we need. Their public API is `Conductor` (emits `beat`, `phase` events with absolute `audioContext` times), `PitchTracker` (emits `onset`, `pitchUpdate`, `noteEnd`), and helpers in [src/audio/midi.ts](src/audio/midi.ts).
- Phaser's `Phaser.Game`, `Phaser.Scene`, all sprite/text/graphics APIs go away. We standardize on Three.js (r170+).
- Tests in [src/test](src/test) drive `PitchEngine` directly via decoded buffers — they don't depend on the renderer and must keep passing.

**Tasks:**
1. `npm rm phaser` and `npm i three @types/three`.
2. Delete [src/scenes/StartScene.ts](src/scenes/StartScene.ts) and [src/scenes/PlayScene.ts](src/scenes/PlayScene.ts) after porting the audio-wiring snippets to the new orchestrator. Keep [src/ui/style.ts](src/ui/style.ts) as a palette source.
3. New `src/engine/Renderer.ts`: owns `WebGLRenderer`, resize handling, `OrthographicCamera` for HUD overlay, `PerspectiveCamera` for world.
4. New `src/engine/Game.ts`: owns the scene-state machine (`Boot`, `MainMenu` stub, `Level`, `Results` stub). `init(canvas)` and a `start()` that runs an rAF loop calling `update(audioTime, dt)` and `render()` on the active state.
5. New `src/engine/Clock.ts`: thin facade reading `getAudioContext().currentTime` so gameplay code never touches the AudioContext directly.
6. New `src/states/LevelState.ts`: instantiates `Conductor` + `PitchTracker`, subscribes to phase events, draws a placeholder ground + skybox color + 3 cubes that move toward the camera with `t` along time. Displays current `Phase` and `measureInPlay` via a DOM overlay (cheap HUD).
7. Replace `src/main.ts` so it constructs `Renderer` + `Game`, mounts the canvas inside `#game`, and starts on user click (AudioContext gesture requirement).
8. Update [index.html](index.html) — keep `#game`; remove anything Phaser-specific.

**Verification:**
- `npm run build` clean.
- `npm run dev` → click → count-in plays → 4 measures of metronome → "done" overlay appears. Cubes visible the whole time.
- `grep -ri "phaser" src/` returns nothing.
- Fixture-driven analyzer (`tsx src/test/main.ts` or however it currently invokes) still runs and reports pass.

**Exit criteria:** A clickable build that boots a 3D scene driven by the existing Conductor. No Phaser in the source. Audio module APIs unchanged.

**Rollback:** This step is large enough to be its own PR. If reverted, the previous Phaser-based main returns; nothing else depends on the old scenes.

---

## Step 2 — Rail movement, camera-on-rails, player anchor

**Goal:** Replace placeholder cubes with a curved level path. The world streams past as `t` advances; the camera and a player anchor sit on the path. Player anchor is what gameplay later mounts the avatar onto. Free aim (mouse / right stick) is added now since combat needs it next step.

**Model tier:** default

**Branch:** `step-2-rail-and-aim`

**Context brief:**
- After Step 1, the engine has a `LevelState` with a placeholder world and the Conductor running. We need a real path the camera walks along.
- Movement is **not** physics-driven. A `RailRunner` advances `t` along a `THREE.CatmullRomCurve3` at a configurable speed. Camera position is `curve.getPointAt(t)`; camera look-at is `curve.getPointAt(t + lookAhead)`. The player anchor sits at the camera position + a small forward offset so the avatar (added later) appears in front of the camera.
- Aim is independent of rail position: pointer-locked mouse drives a `yaw`/`pitch` for an `aimRay` originating at the player anchor.

**Tasks:**
1. `src/world/RailRunner.ts` — owns the curve, `t`, `speed` (units/sec), `lookAhead` distance, `update(dt)`.
2. `src/world/Aim.ts` — pointer-lock manager + yaw/pitch, exposes `getAimRay(): THREE.Ray` and `getAimWorldPoint(distance)`. Renders a reticle on the HUD orthographic camera.
3. `src/world/PlayerAnchor.ts` — `Object3D` that the avatar later parents to. Holds a slot for "guitar mount transform" (used in step 8).
4. Add a level-1 placeholder curve: ~400 units of S-shaped path through a corridor of cubes representing buildings.
5. Wire `LevelState` to construct `RailRunner`, `Aim`, `PlayerAnchor`; advance during `phase === 'playing'` only.
6. Pause `t` advancement during `preroll` and `countIn`. Resume on `playing`. Stop on `done`.

**Verification:** Click → count-in → camera glides forward along the curve while measures play. Mouse moves a reticle. Cubes (buildings) pass by on both sides.

**Exit criteria:** Camera + player anchor + aim are first-class objects gameplay can attach to.

**Rollback:** Revert this PR; Step 1's static cubes return.

---

## Step 3 — Key resolver: candidate-key narrowing from played pitch classes

**Goal:** Subscribe to `PitchTracker` events, reduce the per-measure stream of played notes into the set of major keys consistent with what's been played so far, and publish "fired pitch class" events that downstream systems consume to apply damage.

**Model tier:** strongest. This is the music-theory core of the game.

**Branch:** `step-3-key-resolver`

**Context brief:**
- A "key candidate set" starts the measure as all 12 major keys (and optionally their natural minors — decide and document). On each `PitchUpdate` (settled) inside the measure, the candidate set is filtered to keys that contain that pitch class. The pitch class is then *fired* — every enemy tagged with that pitch class takes damage proportional to how narrow the candidate set is at the moment of firing (broad set = chip damage, narrow set = full damage). The candidate set resets at the start of each measure on the Conductor's `measure` event.
- Use `midiToPitchClass` from [src/audio/midi.ts](src/audio/midi.ts). Don't introduce a music-theory library — write a tiny `MAJOR_SCALE_PITCH_CLASSES[12]` table and minor equivalent.
- This step has **zero rendering**. It's pure logic + a typed event bus. Step 4 wires the bus to gameplay.

**Tasks:**
1. `src/music/keys.ts`: `MAJOR_KEYS: Record<PitchClass, Set<PitchClass>>` (and minors). `narrowKeys(candidates, pitchClass): KeySet`. `keyConfidence(set): number` returning `1 - (size-1)/11`.
2. `src/music/KeyResolver.ts`: subscribes to Conductor `measure` (resets) and PitchTracker settled `PitchUpdate` (narrows + fires). Publishes `pitchFired { pitchClass, confidence, audioTime, beatPosition }` and `keysNarrowed { remaining: PitchClass[] }`.
3. `src/music/__tests__/KeyResolver.spec.ts` (or extend [src/test](src/test) harness): replay a synthetic event stream `C D E F G A B C` → assert candidate set ends as `{C major}` with confidence 1, and that each step's `pitchFired` confidence matches the math.
4. Wire `KeyResolver` into `LevelState`; surface narrowed-keys count in the HUD overlay for debugging.

**Verification:** Sing or play a C-major scale into the mic — overlay shows candidate set shrinking to `{C}` by the 7th note. Switching to playing `Eb` mid-measure expands or invalidates the set as the math dictates.

**Exit criteria:** Deterministic, tested key narrowing. A typed event consumers can subscribe to.

**Rollback:** Pure-logic module; revert is local.

---

## Step 4 — Enemies, note tagging, bullets, hit resolution

**Goal:** Spawn enemies on the rail ahead of the camera, each labeled with a pitch class (`C`, `F#`, ...). When `pitchFired` for class `X` arrives, every visible enemy tagged `X` takes damage = `baseDamage * confidence`. Bullets are visual only (no physics); the hit is computed instantly off the event.

**Depends on:** Steps 2 + 3.

**Model tier:** default

**Branch:** `step-4-enemies-and-bullets`

**Context brief:**
- Enemies are floating placeholders at this stage — labeled cubes/billboards. The label is a Sprite or HTML overlay showing the pitch class (e.g. `D#`). Each has `hp`.
- Spawn pattern: an `EnemyDirector` reads a `LevelScript` (declarative for now: array of `{ atBeat, pitchClass, lanePos, hp }`). Level 1's script is hardcoded in `src/levels/level1.ts`.
- On `pitchFired`, the `BulletSystem` finds tagged enemies, spawns visual tracer lines from `PlayerAnchor` to each enemy, and subtracts hp.
- Dead enemies emit a particle pop and unsubscribe.
- Enemies that pass the camera unkilled deal contact damage to the player (player health goes to a value tracked in Step 10; for now log it to console).

**Tasks:**
1. `src/combat/Enemy.ts` — `Object3D` + `pitchClass`, `hp`, `onHit(damage)`, `update(dt)`.
2. `src/combat/EnemyDirector.ts` — consumes a `LevelScript` + the Conductor's `beat`/`measure` events. Spawns enemies in world coordinates ahead of the rail.
3. `src/combat/BulletSystem.ts` — subscribes to `pitchFired`. Draws tracer line segments with a short lifetime. Applies damage immediately.
4. `src/levels/level1.ts` — first concrete level: declarative spawn script for ~2 minutes of play covering all 12 pitch classes.
5. HUD: show enemy count remaining, player hp (placeholder integer).

**Verification:** Boot level 1 → count-in → during play, enemies stream in labeled with notes; singing/playing a note kills the labeled ones. Console logs "player hit" if an enemy passes.

**Exit criteria:** A playable feedback loop: see note, play note, enemy dies. End-to-end through Conductor → PitchTracker → KeyResolver → BulletSystem.

**Rollback:** Revert PR. Steps 2+3 still function.

---

## Step 5 — Timeline HUD: 3 lines × 4 measures, scroll up

**Goal:** The on-screen rhythm timeline the user spec'd. Three rows, each row is 4 measures (16 beats) with subdivision marks. As play advances past a row, the row scrolls up and a fresh row appears below. Player-played notes appear as dots/segments on the timeline at the audio-clock time they happened.

**Depends on:** Steps 1 + 3 (audio events available).

**Model tier:** default

**Branch:** `step-5-timeline-hud`

**Context brief:**
- This is essentially the **scrolling version of the old PlayScene bars** ([src/scenes/PlayScene.ts](src/scenes/PlayScene.ts) had a 4-row static layout — port the visual sensibility, but the data semantics are now "completed measures scroll up, current measure is bottom row").
- Render as an HTML/CSS overlay or as a Three.js orthographic-camera layer. HTML/CSS is simpler for text labels; Canvas is sharper for dot trails. Pick one and document.
- Each played note is plotted at `(time mod measureLength)` on x-axis, `midi` on y-axis. Bend polylines (already supported in `PitchUpdate` stream) render as in the old PlayScene.

**Tasks:**
1. `src/hud/Timeline.ts` — owns three "rows" of measure data. On `measure` event, shift rows up; allocate a fresh bottom row.
2. Draw beat lines (4/measure) and subdivision marks (8ths, 16ths, triplets) faintly.
3. Subscribe to `pitchUpdate` and `noteEnd`; draw the dot/bend trace just like [src/scenes/PlayScene.ts:33](src/scenes/PlayScene.ts:33) did, but on the new substrate.
4. Position the timeline at the top of the screen, leaving the bottom ~70% for the 3D world.

**Verification:** Play a 3-measure phrase → first measure scrolls up, second measure scrolls up under it, third measure is at the bottom-most row. Dots match what the player played.

**Exit criteria:** Timeline is legible and accurate against `audioContext.currentTime`.

**Rollback:** Revert — combat still works without the timeline.

---

## Step 6 — Damage multipliers (melodic/difficulty combos)

**Goal:** Implement the five listed multipliers, score them per measure, and apply them as damage multipliers on `pitchFired` events for that measure.

**Depends on:** Step 4 (so the multiplier has something to multiply).

**Model tier:** strongest. Detecting "two-octave run from root to root" and "repeated triplet phrase per beat" is the spicy bit.

**Branch:** `step-6-combo-scorer`

**Context brief:**
- A `ComboScorer` watches the per-measure note stream and emits `combosApplied { multipliers: ComboTag[], totalMultiplier: number }` at measure end (or as soon as a combo is provably locked in).
- The five rules:
  - **Start-on-root:** first played note in the measure has pitch class equal to the resolved key's root (must wait for key to be at least 50% narrowed by end of measure to attribute, else treat the *most likely* root).
  - **End-on-root:** last played note in the measure has pitch class equal to root.
  - **Two-octave run:** within the measure, an ascending or descending sequence of >=15 in-key notes spanning at least 24 semitones, starting and ending on root pitch class.
  - **Repeated triplet phrase per beat:** in a 4-beat measure with triplet subdivision, the same 3-note pitch sequence appears on every beat.
  - **Repeated sixteenth phrase per beat:** same as above but 4-note sixteenth pattern on every beat.
- Multipliers compose additively (e.g. `1 + 0.5 + 0.5 = 2.0x`) or multiplicatively — pick one and document. Default proposal: additive, capped at 4x.
- Score is attributed to *all* `pitchFired` events for that measure retroactively if the combo is only detectable post-hoc (which they all are). For real-time satisfaction: re-apply combo damage as a "judgement burst" at measure end so the player sees the reward.

**Tasks:**
1. `src/music/ComboScorer.ts` — pure logic, fed by `pitchFired` + Conductor `measure`. Unit-tested.
2. Tests covering: each rule individually, combinations, ambiguous-key scenarios (root unknown at start of measure).
3. Wire into `BulletSystem` so post-measure judgement burst deals retroactive damage to enemies still alive that were tagged with played pitch classes — and to a particle/sfx feedback so the player feels the combo.
4. HUD: show this measure's combo tags as they latch on.

**Verification:** A scripted fixture (synthetic event stream) → assert each rule fires when expected and doesn't fire when not. Live playtest: play a sixteenth-note pentatonic lick that repeats per beat → combo HUD lights up "SIXTEENTHSx" and lingering enemies take a burst.

**Exit criteria:** All five rules unit-tested; in-game HUD reflects them; damage actually scales.

**Rollback:** Pure additive module, safe to revert.

---

## Step 7 — Art direction pass: cel shader, palette, post-FX

**Goal:** Take the placeholder world from steps 1-6 and make it look like GTA IV x Jet Set Radio. This is the first art pass — the goal is a **direction** that's iterable, not a final art bible.

**Depends on:** Step 1.

**Model tier:** default for shader plumbing; strongest if asked to make explicit art-direction calls.

**Branch:** `step-7-art-direction`

**Context brief:**
- Pick a direction concretely and document it in `docs/art-direction.md`. A starting proposal:
  - **Cel-shaded base materials** (`MeshToonMaterial` with a 4-step gradient ramp) + **inked outlines** (post-process edge detection via `OutlinePass` or a custom Sobel pass).
  - **Palette:** anchor on the existing magenta/cyan/deep-purple from [src/ui/style.ts](src/ui/style.ts) ([line 1](src/ui/style.ts:1)); add muted sodium-vapor orange for street lights and a desaturated dirty-grey for buildings. The Jet Set Radio half wants saturated character pops; the GTA IV half wants washed-out environments. Resolve that tension by saturating characters/enemies and desaturating the environment.
  - **Post:** chromatic aberration low, film grain low, bloom on emissives only, dithered shadows.
  - **Skybox:** time-of-day per level (steps 9 picks the times).
- Provide a "look toggle" in the HUD (key `L`) that cycles flat -> toon -> toon+outline+post so iteration is fast.

**Tasks:**
1. Add `three/examples/jsm/postprocessing/*` for `EffectComposer`, `OutlinePass`, `UnrealBloomPass`.
2. `src/render/ArtDirector.ts` — owns the composer pipeline, palette constants, and the toggle.
3. Replace placeholder cube materials with `MeshToonMaterial` + gradient map.
4. Light setup: directional sun + low ambient + per-level fog color.
5. `docs/art-direction.md` — the iteration brief.

**Verification:** Visually compare placeholder vs. art-pass screenshots side-by-side. Toggle works. Build is still <2 MB main bundle ungzipped if feasible.

**Exit criteria:** A look you can defend in one screenshot. Room for steps 9 and beyond to refine.

**Rollback:** Revert; gameplay is unaffected.

---

## Step 8 — Player avatar, guitar mount, loadout selector (outfits + guitars)

**Goal:** A character model parented to the player anchor, holding a guitar. A loadout screen before each level lets the player pick from three outfits and three guitars spanning the eras the user described.

**Depends on:** Steps 1 + 7.

**Model tier:** default

**Branch:** `step-8-avatar-and-loadout`

**Context brief:**
- Avatar can start as a simple rigged GLB (or even a stylized hand+guitar with no full body, since the camera is behind the character — only back/arms/guitar are visible). Source: a placeholder GLB you author or pull from a free pack; document the source.
- Mount the guitar via the `PlayerAnchor`'s `guitarMount` transform from Step 2. Animate a strum on each `pitchFired` (simple rotation tween on a "strum hand" bone or pivot).
- Loadout state lives in `src/state/Loadout.ts` and is read at `LevelState` construction.
- Three outfits, three guitars (proposal):
  - Outfits: "Sunset Strip '78" (denim + bandana), "Basement Tape '94" (black hoodie + eyeliner), "Bedroom Pop '24" (oversized cardigan + beanie).
  - Guitars: "Goldtop LP", "Black Strat", "Pastel Jazzmaster".
- The loadout doesn't change stats in v1 — it's cosmetic. Document this so we don't sneak balance changes in.

**Tasks:**
1. `src/state/Loadout.ts` — typed loadout + persistence to `localStorage`.
2. `src/states/LoadoutState.ts` — DOM-based menu (cheap and fine for v1) that previews avatar + guitar in a small 3D viewport.
3. Asset pipeline: drop GLBs in `public/assets/avatars/*` and `public/assets/guitars/*`. Load with `GLTFLoader`.
4. Strum animation tied to `pitchFired`.

**Verification:** Cycle outfits + guitars in the loadout screen; pick one; the level shows that avatar/guitar in the camera-front position. Strumming visibly animates when notes fire.

**Exit criteria:** All 3 x 3 = 9 combinations render. Loadout persists across reloads.

**Rollback:** Revert — combat continues to work with no avatar.

---

## Step 9 — Three starter levels: environments + enemy choreography

**Goal:** Ship three distinct on-rails levels in a gritty urban world (Appetite-For-Destruction-meets-GTA energy), each with its own rail path, scripted enemy stream, time-of-day, and music tempo.

**Depends on:** Steps 4 + 7 + 8.

**Model tier:** strongest for choreography; default for environment assembly.

**Branch:** `step-9-three-levels`

**Context brief:**
- Levels are still hardcoded TypeScript modules under `src/levels/level{1,2,3}.ts`. Don't build a data-driven level format yet — wait for level 4.
- Proposal:
  - **Level 1 — "Strip Mall Sunset"** (sunset / dusty orange sky / strip-mall corridor / 90 BPM). Tutorial difficulty: single-key passages.
  - **Level 2 — "Subway Mezzanine"** (fluorescents / tile reflections / 110 BPM). Pitch sets force the player through key changes mid-measure.
  - **Level 3 — "Rooftop Skyline"** (night, neon signage, distant skyscrapers / 130 BPM). Dense enemy choreography that rewards sixteenth-note combos.
- Each level is its own rail (`CatmullRomCurve3`), environment dressing (instanced building meshes + decals), and lighting rig.
- Use [src/audio/Conductor.ts:40](src/audio/Conductor.ts:40) `bpm` field — pass it from the level config; ensure tempo changes are clean across levels.

**Tasks:**
1. Three level modules with curve + environment factory + spawn script.
2. Per-level: skybox/fog color, sun angle, ambient color from Step 7's palette.
3. Per-level enemy script targeting the documented difficulty progression.
4. Asset loader caches per-level GLBs and disposes between levels.

**Verification:** Play through each level start to finish. No mid-level frame hitches >100 ms. Each level visually distinct.

**Exit criteria:** Three playable, visually distinct levels.

**Rollback:** Per-level revert is cheap — each is its own module.

---

## Step 10 — Meta loop: health, fail, win, level select, results

**Goal:** Glue it together. Player has hp, takes damage from enemies that reach them, dies if hp <= 0, wins if they survive a level, sees a results screen with score/combo stats, and chooses the next level.

**Depends on:** Steps 4 + 6 + 8 + 9.

**Model tier:** default

**Branch:** `step-10-meta-loop`

**Context brief:**
- Player hp is a single integer (e.g. 100). Each enemy that passes deals damage based on enemy type (default 10). hp <= 0 -> `Results` state with `outcome: 'fail'`.
- Win condition: reach `t === 1` on the level rail with hp > 0.
- `MainMenuState` -> `LoadoutState` -> `LevelState` -> `ResultsState`. Results shows: enemies killed, accuracy (in-key vs out-of-key fired notes), combos triggered, final score = `kills * 100 + comboBonus`.
- Persist best score per level in `localStorage`.

**Tasks:**
1. `src/state/PlayerStats.ts` — hp + score accumulators.
2. `src/states/MainMenuState.ts`, `src/states/ResultsState.ts` — DOM overlays + a slowly rotating 3D backdrop.
3. Wire the state machine in `Game.ts` to transition cleanly (dispose listeners, stop Conductor, free GPU resources).
4. Level select with Level 2 and 3 gated behind clearing the previous.

**Verification:** Full playthrough: menu -> loadout -> level 1 -> win -> results -> level select -> level 2 -> fail -> results -> retry. Refresh page; best scores persist.

**Exit criteria:** A complete game loop with three levels.

**Rollback:** Revert to the loadout-less playable single level from Step 9.

---

## Plan Mutation Protocol

If a future agent needs to split, insert, skip, reorder, or abandon a step:

1. Edit this file under a `## Mutations` section appended at the bottom, dated and signed (agent name + commit SHA).
2. Each mutation entry states: which step, what change, why, what downstream steps must update.
3. Never delete a completed step — mark it `~~Step N (superseded by Step Na/Nb on YYYY-MM-DD)~~`.

## Open Questions (to resolve before Step 4 or earlier)

- **Minor keys:** are they in v1 or v2? Recommendation: v1 includes natural minors; modes are v2.
- **Multiplier composition:** additive (capped) vs. multiplicative. Recommendation: additive cap at 4x — easier to communicate visually.
- **Input modality:** mic-only, or also keyboard fallback for testing? Recommendation: keyboard piano (rows `Z-M`) as a dev cheat behind a `?debug=1` flag; mic is canonical.
- **Asset sourcing:** GLBs/textures from a specific free pack vs. authored. Recommendation: kenney.nl + ambientCG for v1; commission later.

---

## Adversarial Review Summary

Reviewed against the Blueprint anti-pattern catalog before finalizing:

- Steps are PR-sized (1-3 days each, not "build whole game").
- Cold-start briefs included.
- Dependency graph is explicit.
- Existing audio engine is preserved, not reinvented.
- Art is gated behind gameplay, not vice versa.
- Each step has rollback notes.
- Step 1 is the largest and load-bearing. If it slips, everything slips — flagged as strongest-model.
- Step 6 (combo detection) is the trickiest algorithmically — flagged as strongest-model and demands unit tests.
- No physics engine introduced. Hit detection is event-driven off pitch-fired, not collider-based — documented as an explicit anti-pattern guard.
