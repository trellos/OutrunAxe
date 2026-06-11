# Handoff — Cliff Dive mode

The third Eddie-family mode, after **Score Run** (`InfiniteEddieState`) and
**Battle** (`BattleState`). This file is the self-contained brief for it: what it
is, how it's wired, every gameplay rule, the tuning knobs, the visual-iteration
history, and what's still open. For the shared engine rules see `AGENTS.md`
("Infinite Eddie mode — hard rules"); for the running session log see
`HANDOFF.md`.

> **Branch / commit state:** all of this lives on branch **`CliffDiveMode`**. The
> orchestrator's initial build is commit **`564b784`**; **everything since
> (the entire visual-iteration pass below) is UNCOMMITTED** in the working tree.
> Commit it before doing anything destructive. `tsc --noEmit` clean, `vite build`
> clean, **145 tests pass** (`npx vitest run`).

---

## What it is

An ocean cliff-dive set piece. Your played notes spawn **muscular climbers** who
scale the vertical edges of the four measure-timeline boxes. **Dolphins breach**
out of the sea and spit at climbers to knock them off; **lobsters** block the
dolphins; **healing orbs** recharge hurt climbers. Survive the 16 measures and
the survivors line up and **swan-dive off the cliff**, surfacing gold. Score is
`Dolphins: X` (men knocked into the water) vs `Dudes: Y` (men who cliff-dived,
counted live).

Fixed run: **1 measure count-in + 16 measures**, then a results screen (NOT
endless — unlike Battle's loop framing, though both use a 4-measure rolling
grid).

---

## Architecture — reuse the chain, new crowd

`src/states/CliffDiveState.ts` is a near-clone of `BattleState`: same
`Conductor({countInBeats:4, playMeasures:16, maxBpm:200}) → PitchTracker →
KeyResolver → EddieScorer → createEddieAudio` chain and the same `juice → Art`
rig, mounted with the ocean background (bg02 "Neon Sea → Storm") and
`crowdMode: "cliffdive"`. It keeps the `eddieIntensity` performance meter (drives
the storm morph + dolphin→mermaid swap), schedules a dolphin wave each
playing-measure boundary (`art.cliffDiveMeasureWave`), ticks the crowd each beat
(`art.cliffDiveBeat`), and on `done` emits `eddieFinale` then polls
`art.cliffDiveFinaleResolved()` to know when to show results.

**Settings reuse (no duplication):** `EddieSettingsState` takes an optional
`createPlay?: (hudParent, config, onExit) => GameState` (defaults to Score Run).
`BootState`'s **CLIFF DIVE** button opens the shared settings screen with a
factory that builds `CliffDiveState`. `main.ts` has a `?cliffdive` dev route.

**Art-rig seam (additive, Score Run/Battle untouched):** `eddieArtFactory`
`mount` gained `crowdMode:"cliffdive"` (mounts `CliffDiveCrowd` instead of
`CharacterManager`) + `onDolphinKnockdown`/`onDudeDive` callbacks, plus rig
methods `cliffDiveMeasureWave`/`cliffDiveBeat`/`cliffDiveFinaleResolved`.
`EddieGrid` gained `centeredWide` (Cliff Dive class `eddie-grid-cliff`: the
4-measure grid centered in mid-screen at ~66vw, not Battle's top strip) and
cliff-scoped note/diamond juice (below).

### Files
- `src/states/CliffDiveState.ts` — the play state (+ `createCliffDiveConfig()`).
- `src/eddie/characters/cliff/` — `CliffDiveCrowd.ts` (manager), `Climber.ts`,
  `Dolphin.ts`, `Lobster.ts`, `Orb.ts`, + `CliffDiveCrowd.test.ts` /
  `CliffDiveCrowd.verify.test.ts`.
- `src/eddie/characters/effects.ts` — added `Splash` (blue + gold).
- `src/eddie/art/eddieArtFactory.ts`, `EddieGrid.ts`, `eddie.css` — the seam +
  cliff-scoped grid look.
- `src/states/EddieSettingsState.ts`, `BootState.ts`, `main.ts` — wiring.
- `scripts/sprites/cliff.mjs` — pixel-art generator (`node scripts/sprites/cliff.mjs`).
- `public/assets/{climber-strong,climber-medium,climber-weak,climber-gold,
  dolphin,mermaid,lobster,orb,splash,splash-gold}.png` — generated sheets.

---

## Gameplay rules

**Spawn map** — the grid calls `onQuarterDiamonds({measure, beat, subdiv,
notes:[{strong, quality}]})` per scored quarter; `subdiv` = note count in the
quarter (1 quarter / 2 eighth / 3 triplet / 4 sixteenth):
- **quarter → 2 men**, splitting to the box's **left and right edges**.
- **eighth → 1 man**, to the **nearer** box edge.
- **triplet → 3 healing orbs.**
- **sixteenth → 4 lobsters.**

Men climb the box **EDGES**, never the note bars inside. They dead-hang on the
note lane, **shimmy with hands overhead** to the assigned edge, then climb.

**Climbers** (`Climber.ts`): HP from timing tightness — perfect (≥0.8) = 3hp
STRONG, normal (≥0.45) = 2hp MEDIUM, loose = 1hp WEAK (3 distinct shades).
Climb speed: 3hp = 4 beats / 2hp = 8 / 1hp = 12 (linear in remaining height).
A dolphin hit = −1hp + knocked down ¼ box. At 0hp or falling off the bottom →
graceful fall → splash → swim (SAFE). Reaching the top → idle. Rendered at
`SCALE = 1.8` with a hand-over-hand climb bob/lean.

**Top idle** (sprite rows 3/6/7/8): mostly relaxed (easy stand, sun-gaze,
hands-on-hips); the **double-biceps flex is OCCASIONAL** (row 6, ~15% on the
idle timer); they **stroll** (row 7) and occasionally give a **buddy butt-pat**
(row 8) when two top men pass close (crowd detects pairs; cosmetic, uses
`Math.random` so it never perturbs the seeded gameplay rng).

**Dolphins** (`Dolphin.ts`): **BREACH** beside a box edge — launch from the
waterline, leap up to the foot of the edge (`peakY = box.bottom`), tilt the nose
along the arc (head leads the velocity), spit at the apex, fall back. They do
NOT cross the screen. `measureWave` fires 4 per measure (one per box in the
rolling 4-window). At intensity ≥0.6 they render as **mermaids** (sprite swap,
identical gameplay). Rendered at 1.8×.

**Lobsters** (`Lobster.ts`): fan outward along the waterline; a live lobster
near a dolphin OR guarding its target edge **cancels** it. Tuning intent: 1
measure of 16ths thins a wave; 4 measures stop dolphins for ~2 measures.

**Orbs** (`Orb.ts`): fly to climbing men with `hp < max` and heal on arrival.
Policy: prefer distinct needy men; the 3rd orb slow-seeks a still-needy man; with
no needy man they pulse around the spawn bar. Rendered at **26px** (bumped up so
they're not lost on the busy scene).

**Finale** (the important fix): on `done` the conductor stops firing beats, so
dives are driven by **`CliffDiveCrowd.update`'s own beat timer** (one man dives
per beat) — NOT `cliffDiveBeat`. `CliffDiveState` holds the results screen until
`cliffDiveFinaleResolved()` (no man still climbing/at top) or `MAX_FINALE_SEC`
(26s). A diver **leaps up and arcs head-first** (`Climber.dive()` sets an upward
`vy` + outward `diveVx`, gravity in the falling case; render rotates the head
along the velocity vector). Gold divers use the **gold sheet**
(line-dance/swan-dive/surface-swim). The **splash fires on water entry** (slip OR
dive), detected in `update` (was firing early — that read as "vanishing").

---

## Cliff-scoped grid juice (EddieGrid, gated on `this.cliff`)
- **Note bars fill the lane + jiggle:** `height:7%` (fills the pitch lane) and an
  `eddie-note-pop` scale-bounce animation lasting half a beat on spawn.
- **Diamonds at 50% opacity** so the ocean reads through.
- Score Run / Battle keep the original thin bars + full-opacity diamonds.

## Background finer pass (bg02)
`SEA_SS = 3` supersample: the sea canvas renders at 3× (still NearestFilter →
still pixel-art, but a finer upscale). The sky gradient is drawn in fine sub-rows
and the neon sea-crest "swell lines" at 1 device px so they read as crisp lines
matching the climbers. Tunable via the one `SEA_SS` constant (`1` reverts).
**Still chunky:** the background's own pixel-art dolphins and the sea colour
bands — making those match the sprites needs a redraw at higher detail and an
in-person visual pass (see Open work).

---

## Sprites (`scripts/sprites/cliff.mjs`)
Thin white **stick figures** were rejected for **muscular strongmen** matching
`.art-ref/reference.jpg`: small head, BROAD 9-wide shoulders, big 2px arms, a
strong V-taper to a 3-wide waist. Tier colour = HP (white/cyan/violet); gold =
finale. Climber sheet is **9 rows**: 0 hang / 1 shimmy(arms-up) / 2 climb /
3 top-idle(relaxed) / 4 falling / 5 water / 6 flex / 7 walk / 8 pat. Run
`node scripts/sprites/cliff.mjs` to regenerate all 10 sheets.

---

## Tests & verification
`src/eddie/characters/cliff/CliffDiveCrowd{.test,.verify.test}.ts` — 25 headless
tests (seeded RNG, stub `resolveCell`, no browser/audio/WebGL), including the two
**required scenarios** (16 men all drown under relentless dolphins with no input;
16 men + constant 16ths all reach the top behind a lobster wall) and a **finale
regression** (every top man dives via `update`, no external `beat()` — this was a
real shipped bug: dives never fired because they were tied to conductor beats
that stop at `done`).

`npx tsc --noEmit` clean · `npx vitest run` = 145 tests · `npx vite build` clean.

---

## Open work / known limitations
- **Screenshot tooling is dead this session.** The preview capture wedges on the
  WebGL scene every time (timeouts), so the whole visual pass was verified via
  black-on-gray **QC renders** (`.art-tmp/qc.mjs <sheetId>` → reads the PNG via
  the Read tool) + the 145 tests, NOT live screenshots. Kapture (real Chrome)
  bypasses this if a tab is connected. Verify live at `localhost:5173/?cliffdive`.
- **Background water/sun + bg dolphins still chunky** vs the crisp sprites — the
  `SEA_SS` pass made the sky + swell lines finer but the colour bands and the
  background's pixel-art dolphins need a redraw at higher detail (do it with eyes
  on the result).
- **`.art-ref/reference.jpg` is stale** — the user pasted a new muscular-figure
  reference but I can't write the pasted image bytes to disk; the sprites already
  match it. Drop the new image at `.art-ref/reference.jpg` if you want it on disk.
- The `Climber` "mid" edge value is now unused (eighths pick a real left/right
  edge); harmless dead branch in `climberOnEdge`.

## Tuning knobs
- Climb beats / HP: `CLIMB_BEATS_BY_HP`, `HANG_BEATS` (`Climber.ts`).
- Dive arc: `DIVE_JUMP` / `DIVE_GRAVITY` / `DIVE_DRIFT` (`Climber.ts`).
- Dolphin wave: `DOLPHINS_PER_WAVE`, the `span`/`dur` in `measureWave`
  (`CliffDiveCrowd.ts`).
- Lobster: `LOBSTER_RADIUS`, `LOBSTER_LIFETIME` (`Lobster.ts`).
- Orb: `ORB_SPEED`, `SIZE` (`Orb.ts`).
- Finale pacing: `MAX_FINALE_SEC`, `DONE_LINGER_SEC` (`CliffDiveState.ts`).
- Background fineness: `SEA_SS` (`bg02.ts`).
- Render scale: `SCALE` (`Climber.ts`, `Dolphin.ts`).
