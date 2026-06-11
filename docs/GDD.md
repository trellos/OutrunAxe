# Infinite Eddie — Game Design & Implementation Doc

> **Status:** Authoritative. This is the single source of truth for the
> "Infinite Eddie" feature. If scope is unclear, ask the **Architect** (not the
> team lead). Do not write feature code until the team lead has approved this
> doc.

---

## 1. What we are building

A **jam-for-16-bars score-run mode** bolted onto OutrunAxe as a fourth option on
the Level Select screen. The player picks a tempo and key on a settings screen,
hears a generated 80s drum-machine beat with a randomly generated bass line, then
plays 20 measures (4 unscored intro + 16 scored). They improvise melody on the
mic/keyboard. Scoring rewards staying in key, rhythmic complexity (8ths/16ths),
and landing on chord tones. Two measures are "tagged" as 8th- and 16th-note
challenges. The whole thing is dripping with 1980s Memphis/synthwave/VHS juice:
fire, particles, screen shake, neon.

This mode is **score-only**. There is **no combat, no enemies, no avatar, no
rail, no HP.** It is a HUD-and-audio experience layered over a simple animated
80s background. That keeps it fully parallelizable from the existing 3D combat
code.

> **This doc covers SCORE RUN (the original Infinite Eddie) only.** Two sibling
> modes were later built on the same `Conductor → scorer → juice/Art` chain and
> spawn map: **BATTLE** (ocean shark fight) and **CLIFF DIVE** (climbers +
> breaching dolphins + swan-dive finale). Their rules live in `AGENTS.md`
> ("Infinite Eddie mode — hard rules") and, for Cliff Dive, `HANDOFF-cliff-dive.md`.
> The contracts below (scoring, juice events, art/sound interfaces) are shared and
> still authoritative for all three.

### The two screens

1. **Settings screen** (`EddieSettingsState`): tempo picker (default 120, 4/4
   fixed), key picker (12 tones + Major/Minor toggle; initial random from
   {E, A, G, C} × {major, minor}), a live generated beat, a 4-measure live-input
   timeline (proves the signal chain), a randomly generated bass line, and a
   juicy PLAY button.
2. **Play screen** (`InfiniteEddieState`): a 5-row × 4-measure grid (20 measures),
   the current recording measure highlighted, beat-pulsing background, a running
   score number, particles flying to the score on each scored note, screen shake
   on scoring events, and measures lighting ON FIRE when 8th/16th challenges are
   nailed.

---

## 2. Non-negotiable constraints (from `AGENTS.md`)

These bind every teammate. Violating one is grounds for QA to reject the work.

1. **Do NOT fork `src/audio/PitchEngine.ts`.** It is the single source of truth
   for pitch detection. Input comes through `PitchTracker` exactly as
   `LevelState` and `MenuPulse` use it (mic + `emitSyntheticNote` keyboard
   fallback).
2. **Music timing comes from the `AudioContext` clock via `Conductor`, never
   rAF.** Scoring, measure boundaries, and quarter-note evaluation read
   `Conductor` beat events / `audioTime`. Visual interpolation (pulse phase,
   particle motion, shake decay) may read rAF `dt`, but must never decide *when*
   a note is scored.
3. **Every state cleans up in `exit()`** — remove DOM, detach EventBus/Conductor
   listeners, stop the `Conductor` + `PitchTracker`, dispose Three.js
   geometry/material/textures. The menu→settings→play→settings retry loop must
   never stack audio clocks or leak canvases. Model teardown on `MenuPulse.stop()`
   and `LevelState.exit()`.
4. **`npx tsc --noEmit` and `npm test` (vitest) must stay green** before any
   teammate marks work complete.
5. **No bare geometric primitives as the "look."** The brief's art direction is
   explicit (Memphis/synthwave/VHS). Wireframe icosahedra are acceptable only as
   incidental background motifs, not the headline visual.

---

## 3. The timing model (read this before touching the Conductor)

The brief's timing does **not** match the existing combat Conductor:

| | Combat (`LevelState`) | Infinite Eddie |
|---|---|---|
| Count-in | 4 beats (`COUNT_IN_BEATS`) | 4 **measures** = 16 beats (the "intro") |
| Play window | 32 measures (`PLAY_MEASURES`) | 16 scored measures |
| Default tempo | per-level (90/110/130) | 120, player-pickable |
| Scoring granularity | per-measure combo | per-quarter-note (4×/measure) |

`Conductor`'s `PLAY_MEASURES`, `COUNT_IN_BEATS`, and `MAX_BPM=120` are module
constants. We **extend** the Conductor minimally and additively — we do **not**
fork it and do **not** drive timing off rAF.

### Decision: additive Conductor config (owned by Gameplay)

Gameplay adds an **optional** options object to the `Conductor` constructor so
the phase machine can be reconfigured per use without changing default combat
behavior. Default values reproduce today's behavior exactly.

```ts
// src/audio/Conductor.ts — ADDITIVE. Existing callers pass nothing and are
// unaffected. This is the ONE allowed edit to a sacred-audio file; it adds
// configurability without changing the algorithm or default constants.
export interface ConductorOptions {
  /** Beats of count-in before the play window. Default 4 (combat). */
  countInBeats?: number;
  /** Measures in the scored/play window. Default 32 (combat). */
  playMeasures?: number;
  /** Upper BPM clamp. Default 120. Eddie passes 200 so fast jams are allowed. */
  maxBpm?: number;
}
export class Conductor {
  constructor(opts?: ConductorOptions) { /* fall back to existing constants */ }
}
```

For Infinite Eddie, Gameplay constructs:

```ts
new Conductor({ countInBeats: 16, playMeasures: 16, maxBpm: 200 });
```

- `countInBeats: 16` → the 4-measure intro. During count-in the Conductor emits
  the **count-in beep**. The brief wants the *generated beat* (drums) during the
  intro, not metronome beeps. Therefore Gameplay does **not** rely on the
  Conductor's `countIn` beep path; instead Eddie's own beat/bass scheduler (owned
  by **Sound**, see §7) plays drums on every beat from the very first intro beat.
  Practically: Gameplay still uses the Conductor for the phase machine and beat
  timestamps, and **Sound's `EddieBeat` subscribes to `onBeat` and plays drums in
  both `countIn` and `playing` phases** (unlike combat, which beeps the count-in).
- `playMeasures: 16` → the 16 scored measures.
- The **5-row grid** = 4 intro measures (row 0, "warm-up", visually
  deprioritized) + 16 scored measures (rows 1–4). Rows 1–4 are the only scored
  rows. Row 0 maps to count-in; rows 1–4 map to play measures 0–15.

### Helper Gameplay will need

`Conductor` already exposes `measureStartTime(playMeasureIdx)`,
`currentPlayMeasure()`, `measureForTime()`, `measureDuration()`, and `onBeat`.
With `playMeasures: 16` these all work for the 16 scored measures. The intro (4
measures) is handled like `Timeline`'s count-in row: capture the count-in
downbeat time as an origin. Gameplay should add a tiny pure helper if needed but
**must not** add a parallel clock.

> **Why not a brand-new clock?** Re-deriving beat timing off rAF or
> `performance.now()` violates constraint #2 and would drift against the audio.
> The Conductor is the lookahead scheduler; reuse it.

---

## 4. Ownership map (NO OVERLAPS)

Every file below is owned by **exactly one** teammate. The only shared edit point
is `LevelSelectState.ts`, owned by **Gameplay**; others request changes via
message to Gameplay.

| File / path | Owner | New or Modified |
|---|---|---|
| `src/states/EddieSettingsState.ts` | Gameplay | New |
| `src/states/InfiniteEddieState.ts` | Gameplay | New |
| `src/music/eddie/EddieScorer.ts` | Gameplay | New |
| `src/music/eddie/basslineGen.ts` | Gameplay | New |
| `src/music/eddie/eddieTypes.ts` (shared contracts, §6) | Gameplay | New |
| `src/music/eddie/EddieScorer.test.ts` | Gameplay | New |
| `src/music/eddie/basslineGen.test.ts` | Gameplay | New |
| `src/audio/Conductor.ts` (additive options only, §3) | Gameplay | Modified |
| `src/states/LevelSelectState.ts` (add mode entry only) | Gameplay | Modified |
| `src/eddie/art/EddieGrid.ts` (timeline grid renderer) | Art | New |
| `src/eddie/art/EddieBackground.ts` (pulse/shake bg) | Art | New |
| `src/eddie/art/EddieFire.ts` (fire effect) | Art | New |
| `src/eddie/art/EddieParticles.ts` (score particles) | Art | New |
| `src/eddie/art/EddiePlayButton.ts` (juicy play button) | Art | New |
| `src/eddie/art/eddieArtFactory.ts` (variant selector, §8) | Art | New |
| `src/states/EddieArtDebugState.ts` (debug gallery, `?eddieart=1`) | Art | New |
| `src/eddie/art/eddie.css` (80s styling) | Art | New |
| `src/audio/eddie/EddieBeat.ts` (drum-machine beat scheduler) | Sound | New |
| `src/audio/eddie/EddieBass.ts` (bass voice w/ bite) | Sound | New |
| `src/audio/eddie/eddieAudioFactory.ts` (variant selector, §8) | Sound | New |
| `src/states/EddieSoundDebugState.ts` (debug bench, `?eddiesound=1`) | Sound | New |
| `public/assets/audio/eddie/` (any sampled assets) | Sound | New dir |
| `src/results/infinite-eddie-signoff.md` | QA | New |
| `tests/e2e/infinite-eddie.spec.ts` (Playwright) | QA | New |

**Shared-edit protocol for `LevelSelectState.ts`:** Gameplay owns it. Art may
want to restyle the new card; if so, Art sends Gameplay the CSS class names /
markup and Gameplay applies it. Nobody else edits this file.

**`main.ts` debug routes:** Art and Sound each need a `?…=1` debug route wired in
`main.ts`. To avoid three teammates editing `main.ts`, **Gameplay owns `main.ts`**
and wires all three debug routes (`?eddieart=1`, `?eddiesound=1`, and optionally
`?eddie=1` to jump straight to settings) in one edit, based on the class names
fixed in this doc. Art/Sound just deliver the classes with the exact names below.

---

## 5. Build sequence & dependencies

```
Phase 0 (Architect):  this doc approved.            ── DONE gate ──
                                  │
        ┌─────────────────────────┼──────────────────────────┐
        ▼                         ▼                            ▼
Phase 1 GAMEPLAY            Phase 1 ART (parallel)      Phase 1 SOUND (parallel)
 - eddieTypes.ts FIRST       - build against            - build against
   (publishes contracts)       eddieTypes.ts + the         eddieTypes.ts + the
 - Conductor opts               EddieArtFactory iface       EddieAudioFactory iface
 - basslineGen + tests       - 3 variants/asset on        - 3 variants/cue on
 - EddieScorer + tests          art/* branches              sound/* branches
 - EddieSettingsState        - EddieArtDebugState         - EddieSoundDebugState
 - InfiniteEddieState        - eddie.css
 - LevelSelect entry
 - main.ts debug routes
                                  │
                                  ▼
Phase 2 INTEGRATION: Gameplay imports the Art factory + Sound factory through the
   stable interfaces in §6/§8. Variant selection is debug-only; production picks
   a default variant (see §8).
                                  ▼
Phase 3 QA: full tsc + vitest + Playwright e2e, branch/naming audit, sign-off.
```

**Critical path:** `eddieTypes.ts` must land first — it is the contract surface.
Gameplay publishes it immediately (it has no dependencies) so Art and Sound can
compile against stable types on day one. Until it lands, Art/Sound build their
internals against the interface stubs reproduced verbatim in §6.

---

## 6. Contracts (stable shapes — build against these)

All of the following live in **`src/music/eddie/eddieTypes.ts`** (owned by
Gameplay, published first). Reproduced here verbatim so Art and Sound can start
before the file exists.

### 6.1 Settings → mode handoff

```ts
import type { PitchClass, KeyMode } from "../keys";

/** Everything the settings screen produces and hands to the play state. */
export interface EddieConfig {
  bpm: number;            // 60..200, default 120
  keyRoot: PitchClass;    // "C", "E", ...
  keyMode: KeyMode;       // "major" | "minor"
  bassline: BasslineNote[]; // 4 intro measures' worth (see 6.2), loops thereafter
  /** Which scored measure (0..15) is tagged for 8th notes. Lands in grid row 2
   *  or 3 (i.e. scored measure 4..11). */
  eighthTagMeasure: number;
  /** Which scored measure (0..15) is tagged for 16th notes. Lands in grid row 3
   *  or 4 (i.e. scored measure 8..15) and is always a different measure than
   *  eighthTagMeasure. */
  sixteenthTagMeasure: number;
}
```

### 6.2 Bassline data format

A simple rock bass line: 4 measures, 1–2 notes per measure, in the selected key.
It defines the chord context used for the "end on a chord tone" scoring bonus.

```ts
export interface BasslineNote {
  /** 0..3 — which of the 4 bassline measures this note belongs to. The play
   *  state loops this 4-measure pattern across all 20 measures (intro + scored),
   *  so scored measure m uses bassline measure (m % 4). */
  measure: number;
  /** Beat offset within the measure where the bass note starts: 0..3 (quarter
   *  positions only for v1). The FIRST note of each measure (beat 0) defines the
   *  active chord for that measure's chord-tone bonus. */
  beat: number;
  /** Pitch class of the bass note (the chord root for that span). */
  pitchClass: PitchClass;
  /** The chord tones for the bonus check: typically [root, 3rd, 5th] of the
   *  triad implied by this bass note within the selected key. Ending a
   *  quarter-note on any of these pitch classes earns the chord-tone bonus.
   *  Precomputed by basslineGen so the scorer stays pure key-agnostic logic. */
  chordTones: PitchClass[];
}
```

`basslineGen` signature (owned by Gameplay, unit-tested):

```ts
export function generateBassline(
  keyRoot: PitchClass,
  keyMode: KeyMode,
  rng?: () => number,   // injectable RNG for deterministic tests; default Math.random
): BasslineNote[];
```

> Bassline gen rules (v1): pick a simple I–IV–V-ish rock movement diatonic to the
> key; 1 note in most measures, 2 in at most one or two; every `pitchClass` must
> be in the selected key (`keyPitchClasses(keyRoot, keyMode)` from
> `src/music/keys.ts`). `chordTones` = the diatonic triad on that scale degree.

### 6.3 Per-quarter-note scoring

The scorer is a **pure, testable class** fed three things: the played-note stream
(from `KeyResolver.pitchFired` — same event combat uses), the bassline/config,
and beat events for measure/quarter boundaries. It evaluates **each quarter note
at the START of the next note** (per the brief) and emits an `eddieScore` event.

```ts
export type EddieScoreKind =
  | "quarter"   // baseline scored quarter
  | "eighth"    // 8th-note subdivision bonus present in this quarter
  | "sixteenth" // 16th-note subdivision bonus present in this quarter
  | "chordTone" // ended on a chord tone of the bass's current chord
  | "eighthTagClear"    // the 8th-tagged measure played all-8ths
  | "sixteenthTagClear" // the 16th-tagged measure played all-16ths
  | "outOfKey";  // note(s) not in key — zero points, still emitted for feedback

export interface EddieScoreEvent {
  /** Total points awarded for this scoring opportunity (>=0). */
  points: number;
  /** Score multiplier that drove `points` (1 = baseline). Bigger multiple =>
   *  bigger juice (see 6.4). */
  multiplier: number;
  measure: number;       // scored measure index 0..15
  beat: number;          // quarter index within the measure 0..3
  /** Tags describing what earned points this quarter (may be multiple). */
  kinds: EddieScoreKind[];
  /** Pixel-space origin hint for particles: where this note sits on the grid.
   *  Art may ignore and recompute from (measure,beat); provided for convenience.
   *  Null if the play state can't resolve it yet. */
  originHint: { x: number; y: number } | null;
  audioTime: number;     // event audio-clock time
}
```

Scorer class shape (owned by Gameplay):

```ts
import type { Conductor } from "../../audio/Conductor";
import type { KeyResolver } from "../KeyResolver";
import { EventBus } from "../../engine/EventBus";

export type EddieScorerEvents = {
  eddieScore: EddieScoreEvent;
  /** Cumulative running total after applying the latest eddieScore. */
  eddieTotal: { total: number; lastDelta: number; audioTime: number };
};

export class EddieScorer {
  readonly bus: EventBus<EddieScorerEvents>;
  constructor(conductor: Conductor, resolver: KeyResolver, config: EddieConfig);
  attach(): void;   // subscribe to conductor.onBeat + resolver.bus pitchFired
  detach(): void;   // unsubscribe, clear bus
  get total(): number;
}
```

#### Scoring rules (v1 — Gameplay implements, QA verifies via unit tests)

Per the brief, evaluated **per quarter note**, scored at the onset of the *next*
quarter (so the just-completed quarter is fully observed):

- **In-key gate:** points only for notes in the selected key. An out-of-key
  quarter scores 0 and emits `kinds: ["outOfKey"]`.
- **Baseline:** a single in-key quarter note = small base points (e.g. `10`).
  All-roots-every-measure (e.g. E E E E in E) must total to a *low* score, so the
  root note earns baseline but no variation bonus.
- **Variation:** award a small bonus when the quarter's pitch differs from the
  previous quarter's pitch (rewards melodic movement, not repetition).
- **Subdivision bonus:** if the quarter contained an **8th-note** subdivision
  (two notes in the quarter), add `eighth` bonus; a **16th-note** subdivision
  (≥3–4 notes in the quarter) adds a higher `sixteenth` bonus.
- **Chord-tone bonus:** if the quarter **ends** on a pitch class in the current
  measure's `chordTones` (from the active `BasslineNote`), add `chordTone` bonus.
- **Tagged-measure clears:** if `measure === config.eighthTagMeasure` and **every**
  quarter in that measure was played as 8ths → emit a measure-level
  `eighthTagClear` bonus (fires fire juice, §6.4). Same for `sixteenthTagMeasure`
  with all-16ths → `sixteenthTagClear` (bigger fire). These are measure-level and
  evaluated at the measure boundary.
- **Multiplier:** `multiplier` scales with how many bonus `kinds` stacked this
  quarter; it is the value Art reads to size shake/bg effects.

> Exact point/multiplier numbers are Gameplay's call but must satisfy the
> testable invariants in §9 (Gameplay acceptance). Keep the constants at the top
> of `EddieScorer.ts` and document them.

### 6.4 Juice events

Juice is **decoupled** from scoring via a dedicated event bus so Art subscribes
without touching scoring logic. The **play state (`InfiniteEddieState`, Gameplay)**
translates `EddieScoreEvent`s into juice events and owns this bus; Art subscribes.

```ts
export type EddieJuiceEvents = {
  /** Camera/background shake. magnitude grows with score multiplier. */
  eddieShake: { magnitude: number; audioTime: number };
  /** Particles should fly from origin to the score readout. */
  eddieParticles: {
    from: { x: number; y: number };
    count: number;          // scales with points
    color: string;          // hex; Art may override per variant
    audioTime: number;
  };
  /** Light a grid measure on fire. tier 1 = 8th clear, tier 2 = 16th clear. */
  eddieFire: { measure: number; tier: 1 | 2; audioTime: number };
  /** Background should pulse on this beat (Art interpolates the decay). */
  eddieBeatPulse: { beatInMeasure: number; downbeat: boolean; audioTime: number };
  /** The score number should visually increment to `total`. */
  eddieScorePop: { total: number; delta: number; audioTime: number };
};
```

`InfiniteEddieState` exposes this bus as a public readonly field
`juice: EventBus<EddieJuiceEvents>` so the Art modules (constructed by the play
state) subscribe in their own `attach(juiceBus)` and unsubscribe in `dispose()`.

### 6.5 Tagged-measure flags

Surfaced two ways:
- In `EddieConfig` (`eighthTagMeasure`, `sixteenthTagMeasure`) — Art reads these
  at construction to render the tags on the grid (8th tag = obvious; 16th tag = a
  visual *upgrade* over the 8th tag).
- Live via `eddieFire` when a tag is cleared.

---

## 7. Audio direction & interface (Sound)

Drums + bass like **80s drum machines** (think LinnDrum / DMX / TR-707 era). Bass
is **not a full synth pad** — it has a **slight bite** (a bit of edge/attack, e.g.
a touch of square/saw + a fast filter envelope), sitting between a sub and a
pluck.

Audio assets are **static assets** under `public/assets/audio/eddie/` if Sound
uses samples; pure-synth variants need no files but must still be reviewable in
the sound debug bench. The Conductor's existing `DrumSynth` is **combat's**; do
**not** repurpose it — Sound builds `EddieBeat`/`EddieBass` so the 80s flavor is
independent and swappable per variant.

### Stable Sound interface (so variant branches don't break Gameplay)

```ts
// src/audio/eddie/eddieAudioFactory.ts
import type { Conductor } from "../Conductor";
import type { EddieConfig } from "../../music/eddie/eddieTypes";

export interface EddieAudioRig {
  /** Subscribe to conductor.onBeat and schedule drums + bass. Plays drums in
   *  BOTH countIn and playing phases (the intro IS the generated beat). Bass
   *  follows config.bassline, looping every 4 measures. */
  start(): void;
  /** Fully tear down: unsubscribe, stop + disconnect all oscillators/sources,
   *  fade master to avoid clicks. Mirrors BackingTrack.stop(). */
  stop(): void;
  setMuted(muted: boolean): void;
}

export type EddieAudioVariant = "option-1" | "option-2" | "option-3";

/** Gameplay calls this with a default variant; debug bench lets you swap. */
export function createEddieAudio(
  variant: EddieAudioVariant,
  conductor: Conductor,
  config: EddieConfig,
): EddieAudioRig;
```

**Sound also implements `EddieSoundDebugState`** (route `?eddiesound=1`, wired by
Gameplay in `main.ts`): parks a `Conductor` in preroll like `MenuPulse`, lets you
cycle the three beat variants and three bass variants (number keys), and audibly
loops them so each can be reviewed. Pattern: copy `CharacterDebugState`'s
key-cycling + on-screen HUD structure.

---

## 8. Art direction & interface (Art)

**1980s graphic design:** Memphis shapes (squiggles, confetti triangles, grids),
synthwave gradients (magenta→cyan, sunset bands), VHS artifacts (scanlines,
chroma shift, tracking-line wobble). Target: looks at home on a blank Scotch VHS
tape cover. The existing palette (`#ff2bd6` magenta, `#00f0ff` cyan, `#ffd02b`
amber, deep purple `#0a0612`) is a good anchor — extend it, don't fight it.

Art owns **all** visuals: the 5×4 grid renderer, beat-pulse background + shake,
fire effect, score particles, the juicy fire-effect PLAY button on the settings
screen, and the 80s CSS.

### Stable Art interface (so variant branches don't break Gameplay)

Gameplay constructs ONE art rig and feeds it the juice bus + config. Each visual
asset has 3 variants; the factory picks one. The rig must mount into a parent
`HTMLElement` (HUD layer) and/or the Three.js `worldScene` provided by the play
state.

```ts
// src/eddie/art/eddieArtFactory.ts
import type * as THREE from "three";
import type { EventBus } from "../../engine/EventBus";
import type { EddieConfig, EddieJuiceEvents } from "../../music/eddie/eddieTypes";

export interface EddieArtRig {
  /** Build DOM/scene objects. `hudParent` is the HUD div; `scene` is the
   *  worldScene for any 3D background. Reads config for grid layout + tags. */
  mount(ctx: {
    hudParent: HTMLElement;
    scene: THREE.Scene;
    config: EddieConfig;
    juice: EventBus<EddieJuiceEvents>;
  }): void;
  /** Per-frame visual update (rAF dt + audioTime for pulse/shake interpolation).
   *  Visuals only — never decides scoring. */
  update(dt: number, audioTime: number): void;
  /** Highlight the currently-recording measure (0..15 scored; -1..-4 = intro
   *  rows, or pass a dedicated enum — Art decides, but must accept the play
   *  state telling it which cell is live). */
  setActiveMeasure(scoredMeasure: number): void;
  /** Tear down: remove DOM, dispose geometry/material/texture, unsubscribe. */
  dispose(): void;
}

export type EddieArtVariant = "option-1" | "option-2" | "option-3";

export function createEddieArt(variant: EddieArtVariant): EddieArtRig;
```

The **PLAY button** is part of the settings screen. To keep the settings screen
self-contained (Gameplay owns `EddieSettingsState`), Art exposes the button as a
standalone factory the settings state mounts:

```ts
// src/eddie/art/EddiePlayButton.ts
export interface EddiePlayButton {
  mount(parent: HTMLElement, onPlay: () => void): void;
  update(dt: number): void;   // fire/particle animation
  dispose(): void;
}
export function createEddiePlayButton(
  variant: EddieArtVariant,
): EddiePlayButton;
```

**Art also implements `EddieArtDebugState`** (route `?eddieart=1`, wired by
Gameplay in `main.ts`): a gallery that mounts the **active branch's** variant of
every asset (grid, background, fire, particles, play button) and drives them with
a synthetic juice bus firing fake `eddieScore`/`eddieFire`/`eddieBeatPulse` events
on a timer so each animates for review. Reviewing option-2/3 means switching to
that branch (one variant per branch — see §12). Pattern: copy
`CharacterDebugState`.

### Variant requirements (binding)

- **3 production-quality variants per asset.** Distinct in **style/approach**, not
  color swaps. (e.g. grid variant A = chunky neon-bordered cells; B = wireframe
  perspective grid receding to a horizon; C = VHS-cassette-label cells with
  tracking wobble.)
- Each variant on its own branch: `art/[asset-name]/option-[1-3]`
  (e.g. `art/grid/option-1`, `art/fire/option-2`). Asset names: `grid`,
  `background`, `fire`, `particles`, `play-button`.
- **One variant per branch (see §12).** Each `art/[asset]/option-[N]` branch wires
  *its* single variant as the factory's active implementation; the debug state
  renders whatever the checked-out branch provides. The factory `variant` arg is
  the stable integration *type* surface (so Gameplay's import never changes), but
  the live variant is selected by the branch, not by passing a different arg at
  runtime. The `infinite-eddie` integration branch carries **`option-1` of every
  asset** as the default until the lead picks winners after review.

---

## 9. Acceptance criteria (per teammate — concrete & checkable)

### Gameplay

- [ ] `src/music/eddie/eddieTypes.ts` published first, matching §6 verbatim.
- [ ] `Conductor` accepts `ConductorOptions`; **default construction is
      byte-for-byte behavior-identical** (combat levels unaffected — verify
      `LevelState` still passes existing tests).
- [ ] `generateBassline` returns 4 measures, 1–2 notes/measure, **every note in
      key** (unit test asserts membership in `keyPitchClasses`), deterministic
      under an injected RNG (unit test).
- [ ] `EddieScorer` unit tests prove:
  - all-roots (E E E E ×16 in E major) → a **low** total, no variation/subdivision
    bonuses;
  - an in-key 8th-note pattern scores **higher** than the same notes as quarters;
  - 16ths score **higher** than 8ths;
  - ending a quarter on a chord tone adds the chord-tone bonus;
  - out-of-key notes score **0** and emit `outOfKey`;
  - clearing the 8th-tagged measure emits `eighthTagClear`; the 16th-tagged
    measure emits `sixteenthTagClear`.
- [ ] `EddieSettingsState`: tempo picker (default 120), key picker (12 + maj/min),
      **random initial key from {E,A,G,C} × {maj,min}**, live beat (via Sound rig),
      live 4-measure input timeline (reuse `Timeline`/`MenuPulse` pattern),
      bassline regenerated on key change, PLAY button (Art) → `InfiniteEddieState`
      with a fully populated `EddieConfig`.
- [ ] `InfiniteEddieState`: drives Conductor (16-beat count-in / 16 play measures),
      wires `PitchTracker`→`KeyResolver`→`EddieScorer`, owns the `juice` bus,
      mounts the Art rig + Sound rig, advances `setActiveMeasure`, transitions back
      to settings/level-select on completion. **Clean `exit()`** (no leaked clocks
      — verify by entering/exiting 5×).
- [ ] LevelSelect shows an "INFINITE EDDIE" entry that routes to `EddieSettingsState`.
- [ ] `main.ts` wires `?eddie=1`, `?eddieart=1`, `?eddiesound=1` routes.
- [ ] `npx tsc --noEmit` clean; `npm test` green (incl. new scorer/bassline tests).

### Art

- [ ] All 6 art files implement the §8 interfaces exactly (factory + play button).
- [ ] 3 distinct variants per asset (`grid`, `background`, `fire`, `particles`,
      `play-button`) — **15 variants total**, each on branch
      `art/[asset]/option-[1-3]`, each production-quality and stylistically
      distinct (not recolors).
- [ ] `EddieArtDebugState` (`?eddieart=1`) renders every variant animating off a
      synthetic juice bus.
- [ ] 80s Memphis/synthwave/VHS direction is unmistakable; defensible beside a
      blank Scotch VHS cover. Grid clearly shows 5 rows × 4 measures, row 0
      visually deprioritized, the recording measure highlighted, the 8th tag
      obvious and the 16th tag an obvious *upgrade* over it.
- [ ] Fire effect triggers on `eddieFire`; particles fly to the score on
      `eddieParticles`; background pulses on `eddieBeatPulse` and shakes on
      `eddieShake` (bigger multiple ⇒ bigger shake).
- [ ] `eddie.css` scoped (prefix `eddie-`); no clobbering existing `.outrun-*`
      classes. `dispose()` leaves zero leaked DOM/Three resources (QA checks).
- [ ] `npx tsc --noEmit` clean on every art branch.

### Sound

- [ ] `EddieBeat` + `EddieBass` implement the §7 `EddieAudioRig` interface via
      `createEddieAudio`.
- [ ] 3 variants of the **beat** and 3 of the **bass** (distinct in mood/timbre/
      mix), each on branch `sound/[asset]/option-[1-3]` (asset names `beat`,
      `bass`). Any sampled assets live under `public/assets/audio/eddie/`.
- [ ] Beat reads 80s-drum-machine; bass has a **slight bite** (documented synth
      params or sample provenance). Bass follows `config.bassline`, looping every
      4 measures, in the selected key.
- [ ] Drums play in **both** count-in (intro) and playing phases.
- [ ] `EddieSoundDebugState` (`?eddiesound=1`) loops and cycles every variant.
- [ ] `stop()` fully tears down (no orphan oscillators, no clicks) — QA verifies
      no audio after exit.
- [ ] `npx tsc --noEmit` clean on every sound branch.

### QA

- [ ] `npx tsc --noEmit` clean on the integration branch; `npm test` fully green.
- [ ] Playwright e2e (`tests/e2e/infinite-eddie.spec.ts`, **NOT** Chrome MCP):
      launch → LevelSelect → Infinite Eddie → settings (assert default 120, a
      random key in {E,A,G,C}, a rendered bassline, a live timeline) → PLAY →
      assert 5×4 grid present, score increments when synthetic notes are fed
      (use the keyboard fallback / `emitSyntheticNote` path), active measure
      advances, mode completes and returns to a menu.
- [ ] Verify all art branches exist and are named exactly
      `art/{grid,background,fire,particles,play-button}/option-{1,2,3}` (15) and
      all sound branches `sound/{beat,bass}/option-{1,2,3}` (6).
- [ ] Verify no leaked audio clocks / DOM after 5 enter/exit cycles (eval check).
- [ ] Write sign-off to `src/results/infinite-eddie-signoff.md` with results,
      branch audit table, and any defects filed back to owners.

---

## 10. How parallel work stays non-conflicting

- **Disjoint file trees:** Gameplay in `src/states/`, `src/music/eddie/`,
  `src/audio/Conductor.ts`; Art entirely under `src/eddie/art/` + its own debug
  state + `eddie.css`; Sound entirely under `src/audio/eddie/` + its own debug
  state + `public/assets/audio/eddie/`. No two owners touch the same file.
- **One shared edit (`LevelSelectState.ts`) + `main.ts`** are both Gameplay-owned;
  others request via message.
- **Contracts are frozen in §6/§7/§8.** Art and Sound compile against the
  interfaces immediately (stubs reproduced here), so they don't block on
  Gameplay's implementation. If a contract must change, it changes **here first**
  (Architect updates the doc + notifies the team), never ad hoc in code.
- **Variant branches are isolated (one variant per branch, §12):** each `art/*`
  and `sound/*` branch carries a single variant wired as its factory's active
  implementation, in its own worktree, so branch creation never disturbs the
  shared tree and variants never conflict with integration. `infinite-eddie`
  carries `option-1` of every asset as the default.
- **Debug states are independent** routes (`?eddieart=1`, `?eddiesound=1`) so Art
  and Sound review their work without depending on Gameplay's play state being
  finished.

---

## 11. Open items the Architect will resolve on request

- Exact base-point and multiplier constants (Gameplay proposes; must satisfy §9
  invariants; Architect signs off if asked).
- Whether the intro's live bassline should also be auditioned on the settings
  screen via the Sound rig (recommended: yes — settings screen mounts the same
  `EddieAudioRig` so the player hears beat + bass before PLAY).
- Final variant winners (lead picks after Art/Sound review; default `option-1`).

---

## 12. Git & integration protocol (authoritative — lead decisions)

All teammates share **one working directory on disk**, so naive parallel branch
switching would corrupt the tree. These rules are binding.

### 12.1 Where each teammate works

- **Gameplay works directly on the `infinite-eddie` integration branch** — it is
  the spine. No worktree; Gameplay commits the contracts, the states, the scorer,
  the bassline generator, the Conductor options, the LevelSelect entry, and the
  `main.ts` debug routes straight onto `infinite-eddie`.
- **Art and Sound each work in their OWN git worktree** (the harness provisions an
  isolated worktree per agent). They create their `art/*` / `sound/*` branches
  inside their worktree so branch creation never disturbs the shared tree or each
  other.
- **Never** `git checkout`/`git switch` in the shared working directory to flip
  between teammates' branches. Branch isolation is via worktrees only.

### 12.2 Contract gate (ordering)

1. Gameplay **publishes & commits `src/music/eddie/eddieTypes.ts`** (the verbatim
   §6 contracts) to `infinite-eddie` **first**, before Art/Sound begin.
2. Art and Sound then branch their worktrees from a commit that **already
   contains** `eddieTypes.ts`, so they import the **real types**, not local stubs.
   (The verbatim stubs in §6/§7/§8 are only a fallback if someone must start
   before the commit lands; the committed file is the source of truth.)

The team lead releases Gameplay first to land the contracts; Art and Sound start
once the types are committed.

### 12.3 Variant / branch model

The earlier "render all three variants side by side" idea is **dropped** — it
conflicts with one-variant-per-branch. Final model:

- The `infinite-eddie` integration branch carries **`option-1` of every asset
  PLUS the factories and the debug states** (`eddieArtFactory.ts`,
  `eddieAudioFactory.ts`, `EddieArtDebugState`, `EddieSoundDebugState`).
- For each asset, branches `art/[asset]/option-[1-3]` (and
  `sound/[asset]/option-[1-3]`) **each contain that single variant wired as the
  factory's active implementation**.
- The debug state renders the **active (checked-out) branch's** variant.
  Reviewing option-2 or option-3 means switching to that branch — the brief
  explicitly blesses this: *"It's ok if the branch must be swapped to see
  different variations."*
- **All branches stay open.** The lead picks winners later; nothing is deleted on
  the teammates' side.

Asset/branch names (exact, QA audits these):
- Art: `art/grid/option-{1,2,3}`, `art/background/option-{1,2,3}`,
  `art/fire/option-{1,2,3}`, `art/particles/option-{1,2,3}`,
  `art/play-button/option-{1,2,3}` — **15 branches**.
- Sound: `sound/beat/option-{1,2,3}`, `sound/bass/option-{1,2,3}` — **6 branches**.

### 12.4 Merge / integration responsibility

- **Integration/merge is the team lead's job**, not the teammates'.
- Art and Sound: commit `option-1` to its `option-1` branch **and ensure
  `option-1` is mergeable into `infinite-eddie`**. Because every owner's files are
  disjoint (§4), the option-1 merges are conflict-free.
- The lead merges the `option-1` branches into `infinite-eddie` at integration so
  the mode compiles end-to-end with defaults.
- When done, **each teammate reports their exact branch names** (and which is the
  option-1 default) back to the lead.

### 12.5 Per-worktree typecheck

- Each worktree runs `npx tsc --noEmit` **against its own tree**.
- Art/Sound files must **compile standalone**: a teammate's debug state + factory
  + variant must typecheck importing **only** `eddieTypes.ts`, `three`, and
  engine modules (`EventBus`, `Game`/`GameState`, etc.) — **not** Gameplay's
  unfinished `EddieSettingsState`/`InfiniteEddieState`. This is why the Art/Sound
  debug states are self-contained and driven by a synthetic juice bus rather than
  the real play state.
- `npm test` (vitest) is run by Gameplay (scorer/bassline units) and by QA at
  integration; Art/Sound aren't required to add unit tests but must keep their
  worktree's `tsc` clean.

---

## 13. Corrections (post-review round — authoritative)

These supersede earlier conflicting guidance.

- **Grid cells are note timelines, not labels.** Each measure cell plots the
  *played notes* for that measure (positioned by beat), via a new `eddieNote`
  juice event. Never render text/number labels ("INTRO 1", "1".."16") as the cell
  body. Bass-chord labels above a cell and the 8th/16th tag badges are the only
  text.
- **No PLAY button on the play screen.** `InfiniteEddieState` is already playing
  when it loads. The PLAY button belongs only to `EddieSettingsState`. (The art
  debug gallery mounts the button solely to review that asset.)
- **Fire default = option-3** (retro pixel-fire / Doom automaton).
- **Background & particles: 6 options each**, in registries under
  `src/eddie/art/backgrounds/` and `src/eddie/art/particles/`, reviewable via
  `?eddieart=1&bg=N` / `&fx=N` (N = 1..6).
- **Settings screen: research-driven 80s themes**, reviewable via
  `?eddie=1&theme=N`.
