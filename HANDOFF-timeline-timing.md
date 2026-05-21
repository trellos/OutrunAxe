# Timeline Timing Investigation Handoff

This document is a scoped handoff for someone picking up timing issues in the
HUD timeline (`src/hud/Timeline.ts`). It covers what the timeline is, the
specific bugs found during the 2026-05-16 code review, where to look, and
suggested experiments.

---

## What the timeline does

The timeline is a three-row canvas strip (≤25vh) that records what the player
plays and renders it as horizontal note bars in 12 pitch-class lanes:

```
  Row 0 (oldest, top)     ── measure N-2 ──────────────────
  Row 1 (middle)          ── measure N-1 ──────────────────
  Row 2 (active, bottom)  ── measure N   ──────────────────
                                 ↑ beat-pulse overlay
```

Each row is **576×92px** (4 beats × 144 px/beat, 12 lanes × 7 px/lane).
Rows scroll up one slot per measure via `shiftRowsUp()`.

The active row also draws a brief bright cyan **beat-pulse line** on its own
transparent overlay canvas via a private `requestAnimationFrame` loop.

**Key timing chain:**

```
Conductor.onBeat (scheduled audioCtx time)
  → shiftRowsUp(measureIdx) at each downbeat
  → sets row.measureStart = measureIdx

PitchTracker.onPitchUpdate
  → plotPitch(u.time, u.midi, u.onsetId)
  → converts audioTime → x via rowStartTime(measureStart)
```

---

## Known bugs (found in code review, not yet fixed)

### Bug 1 — Count-in notes are silently dropped

**File:** [`src/hud/Timeline.ts:121-126`](src/hud/Timeline.ts)

```typescript
if (info.phase === "countIn") {
  if (info.beatInPhase === 0 && this.rows[ROWS - 1].measureStart !== -1) {
    this.countInStart = info.time;
    this.shiftRowsUp(-1);
  }
  return;
}
```

**Problem:** All rows initialise with `measureStart: -1`. On the first
count-in downbeat, `this.rows[ROWS - 1].measureStart` IS `-1`, so the
condition `!== -1` is **false** — the branch never runs. `countInStart`
stays at its initial value of `-1`.

Later in `plotPitch`:
```typescript
if (row.measureStart === -1 && this.countInStart < 0) return;  // always hits
```

**Result:** Every note played during the four-count count-in is dropped from
the timeline without any visual feedback to the player.

**Likely intent:** Capture `countInStart` unconditionally on the first count-in
downbeat, then `shiftRowsUp(-1)` to mark the bottom row as "this is the
count-in row". The `!== -1` guard was probably meant to prevent re-triggering
on subsequent count-in beats, but the condition is inverted — it fires only
when the row is already allocated, not when it needs to be.

**Suggested fix:**
```typescript
if (info.phase === "countIn") {
  if (info.beatInPhase === 0 && this.countInStart < 0) {
    this.countInStart = info.time;
    this.shiftRowsUp(-1);
  }
  return;
}
```

---

### Bug 2 — Timeline BPM never updates after construction

**File:** [`src/hud/Timeline.ts:109`](src/hud/Timeline.ts)

```typescript
this.bpm = conductor.currentBpm;  // set once in constructor, then frozen
```

`Timeline.bpm` is captured once and never refreshed. `Conductor.setBpm()` can
change BPM during the `preroll` phase (e.g. a future calibration screen). If
BPM changes, `beatDur = 60 / this.bpm` drifts from the actual beat spacing,
causing:

- Note bars landing visually ahead of or behind their real beat position.
- The beat-pulse line misaligning with the metronome.

**Affected calculations:** `plotPitch` (x position), `drawPulse` (pulse
position). Both compute `beatDur` from `this.bpm`.

**Suggested fix:** Read `this.conductor.currentBpm` at the top of each
`plotPitch` and `drawPulse` call instead of caching it. One-line change, zero
risk for current usage where BPM is fixed before `attach()`.

---

### Bug 3 — `activeRow` is always `ROWS - 1` (dead field)

**File:** [`src/hud/Timeline.ts:56`](src/hud/Timeline.ts),
[`src/hud/Timeline.ts:222`](src/hud/Timeline.ts)

```typescript
private activeRow = ROWS - 1;
// ...
this.activeRow = ROWS - 1;  // inside shiftRowsUp — always the same value
```

`shiftRowsUp` hardcodes `this.activeRow = ROWS - 1` every call. The field
never holds any other value. All read sites (`drawPulse`, `plotPitch`) use
`this.rows[this.activeRow]` which is always `this.rows[2]`.

Not causing a bug today, but the field implies scrollable row focus that
doesn't exist and will mislead future work on the timeline.

**Suggested fix:** Remove the field; replace all `this.rows[this.activeRow]`
with `this.rows[ROWS - 1]`.

---

### Bug 4 — Potential pulse suppression on first count-in beat (contingent on Bug 1 fix)

**File:** [`src/hud/Timeline.ts:190`](src/hud/Timeline.ts)

```typescript
const into = this.conductor.audioTime - rowStartTime;
if (into < 0 || into > totalBeats * beatDur) return;
```

The Conductor schedules beats with a 100ms lookahead: `info.time` in `onBeat`
is a future audio timestamp. `countInStart` is captured from `info.time`, so
it is up to 100ms in the future relative to `ctx.currentTime` at the moment
of capture.

After Bug 1 is fixed, the pulse will be suppressed for approximately 0–100ms
at the start of the count-in row (because `conductor.audioTime < rowStartTime`
until the clock catches up). This may look like the pulse "pops in late" on
the first beat.

**Verify after fixing Bug 1.** If it's perceptible, the fix is to allow a
small negative grace window:
```typescript
if (into < -0.05 || into > totalBeats * beatDur) return;
```
or to capture `countInStart` from `ctx.currentTime` instead of `info.time`
(trading clock-source consistency for immediacy).

---

## Where to look

| File | What |
|------|------|
| [`src/hud/Timeline.ts`](src/hud/Timeline.ts) | All four issues above |
| [`src/audio/Conductor.ts`](src/audio/Conductor.ts) | `onBeat`, `measureStartTime`, `currentPhase`, `audioTime`, `setBpm` |
| [`src/hud/noteBars.ts`](src/hud/noteBars.ts) | `BarAccumulator` — correct, no issues here |
| [`src/hud/MenuPulse.ts`](src/hud/MenuPulse.ts) | Sibling using same patterns — check if the BPM cache (Bug 2) exists there too |

---

## Suggested investigation order

1. **Fix Bug 1** (count-in guard inverted). One-line change, immediate visual
   payoff: keyboard notes during the count-in should appear in the bottom row.

2. **Fix Bug 2** (BPM cache) alongside Bug 1 — no risk, makes the code more
   correct in preparation for any BPM-change flow.

3. **Verify Bug 4** after Bug 1 is fixed — watch whether the cyan pulse
   appears immediately on the count-in row's first downbeat or arrives ~100ms
   late. Fix only if perceptible.

4. **Remove `activeRow`** (Bug 3) last — pure cleanup with no runtime effect.

---

## How to verify

```
npm run dev
```

Navigate to any level. During the **count-in** (before the drum pattern locks
in), play keyboard notes (`Z X C V`). After Bug 1 is fixed you should see
bars appear in the bottom timeline row immediately. After all fixes:

- Bars should align horizontally with beat grid lines for notes played on the
  beat.
- The cyan pulse line should track left→right within the row in lockstep with
  the audible metronome click, including during the count-in.

---

## What is NOT broken

The rest of `Timeline.ts` is in good shape after the previous bug passes:

- **12-lane pitch quantisation** (`laneY`) is correct — adjacent pitch classes
  are always ≥ 1px apart, no overlap possible.
- **Canvas pixel fidelity** — 1:1 backing store, `imageSmoothingEnabled: false`,
  integer coords, `image-rendering: pixelated`. No antialiasing blur.
- **`BarAccumulator`** (onsetId grouping) — correct and covered by tests in
  `src/test/barCount.ts`.
- **Overlay/pulse cleanup** — `detach()` cancels the rAF and removes both
  canvases.
- **Row boundary bar reset** — `shiftRowsUp` calls `this.bars.reset()` so a
  sustained note never extends across a measure boundary.
