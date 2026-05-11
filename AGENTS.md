# OutrunAxe — Agent Guide

## What this is

A browser music game played with a real guitar through the microphone. The
player chooses a tempo (60–120 BPM), the game plays a synthesized 4/4 click,
and during four highlighted measures it captures pitch + onset from the mic
in real time and visualises each note as a dot on a horizontal measure
timeline.

Tech: **Phaser 3** (rendering, scenes, input), **Web Audio API** (timing,
synthesis, mic capture), **pitchfinder/Macleod** (monophonic pitch
detection), **Vite + TypeScript** (build). No frameworks beyond those.

The hard problem at the heart of this project is **real-time monophonic
pitch detection on guitar audio**: emit one clean reading per pluck, fast
enough that the dot lands on the beat the player intended.

## Design priorities

In order. When two priorities conflict, the higher one wins.

1. **Speed over robustness on dirty input.** Players are expected to voice
   notes cleanly. The algorithm should respond fast to clean attacks even if
   that means it behaves badly on muted strums, scrapes, or ambient noise.
   Don't add heuristics that improve dirty-input handling at the cost of
   clean-input latency.

2. **Onset timing > pitch label accuracy.** Where a note lands on the
   timeline matters more than whether it's labelled F#4 vs F#5. Visual `x`
   position is anchored to the detected onset; the pitch label is added once
   the detector locks (later). Mis-labelling is recoverable; mis-timing is
   not.

3. **Exploit rhythmic priors.** Notes will land at predictable rhythmic
   positions — on beats, between beats, on the edges of triplets between
   beats. The algorithm should *raise sensitivity* (lower confidence/median
   thresholds, allow earlier emission) near expected note positions, and use
   normal thresholds elsewhere. The Conductor already knows where these
   positions are; the engine doesn't use this yet.

4. **One algorithm, two callers.** `src/audio/PitchEngine.ts` is the single
   source of truth for pitch detection. `PitchTracker` (live mic) and
   `src/test/analyze.ts` (offline test bench) are thin wrappers. Any
   algorithm change goes in `PitchEngine`. Don't reintroduce parallel
   implementations — they will drift.

## Architecture

```
┌─ Phaser (visuals, input) ────────────────┐
│   StartScene  →  PlayScene               │
│   subscribes to PitchTracker emissions   │
└──────────────────────────────────────────┘
                  ▲
                  │ shared AudioContext clock
                  ▼
┌─ Web Audio (timing, sound, capture) ─────┐
│   Conductor     — lookahead scheduler    │
│   DrumSynth     — kick/snare/hat voices  │
│   BeepSynth     — count-in voice         │
│   PitchTracker  — mic + PitchEngine      │
│   AudioRecorder — session capture        │
└──────────────────────────────────────────┘
                  ▲
                  │ Float32Array buffer + audio time
                  ▼
┌─ PitchEngine (the algorithm) ────────────┐
│   1. Onset detection (per-chunk RMS)     │
│   2. Pitch detection (Macleod / YIN)     │
│   3. Octave correction (log-space mean)  │
│   4. 3-tap median filter                 │
│   5. New-note gate + sustain coalescing  │
│   6. Onset-corrected timestamps          │
└──────────────────────────────────────────┘
```

Phaser owns *no audio*. The Conductor uses a lookahead scheduler (Chris
Wilson pattern) to queue beats at exact `AudioContext.currentTime + offset`
values; Phaser polls Conductor state each frame for visuals.

## Project layout

```
src/
  audio/
    AudioContextSingleton.ts   one shared AudioContext, lazily resumed
    AudioRecorder.ts           WebM capture on ?record=1
    BeepSynth.ts               count-in beeps
    Conductor.ts               beat scheduling, phase machine, BPM
    DrumSynth.ts               kick/snare/hat synthesis
    PitchEngine.ts             *** the algorithm ***
    PitchTracker.ts            live mic wrapper around PitchEngine
  scenes/
    StartScene.ts              tempo, mute, play button
    PlayScene.ts               4 measure bars, note rendering
  test/
    analyze.ts                 offline wrapper around PitchEngine
    main.ts                    test bench page entry
  ui/
    style.ts                   palette + active art style (A/B/C)
  main.ts                      Phaser game bootstrap
index.html                     game entry
pitch-test.html                offline analyzer entry
public/samples/                drop recordings here for offline tests
```

## Run / test

- `npm run dev` — Vite dev server at http://127.0.0.1:5173/
- `/` — the game. Append `?record=1` to capture a session.
- `/pitch-test.html` — offline analyzer. Reads from `public/samples/`.
- `npx tsc --noEmit` — typecheck. Run before considering work done.

## Iteration loop for the algorithm

1. Open `/` with `?record=1`, play a session. On completion the browser
   downloads two files: a `.webm` (audio) and a `.json` (every emission the
   live engine produced, with relative timestamps).
2. Drop the `.webm` into `public/samples/`, update `RECORDING_URL` in
   `src/test/main.ts`.
3. Open `/pitch-test.html`. The test bench runs `PitchEngine` over the
   captured audio. Because both paths use the same engine, the offline
   result is what the live engine *would have produced* on that exact audio.
4. Tune `PitchEngine` until offline output matches the desired notes.
5. No port-back step — same code.

If live and offline disagree on the same audio, the cause is almost always
the recording fidelity (Opus compression smearing transients) or a state
reset that fires live but not offline. The emission JSON sidecar is the
authoritative answer to "what did live actually emit?"

## Known issues / open work

- **Attack-transient pitch glitches.** Macleod occasionally locks onto an
  overtone for one or two frames during the pluck transient (visible as
  stray C#4 dots during F#4 plucks). 3-tap median catches some. Tightening
  Macleod's probability threshold from 0.85 → 0.95 helps but drops soft
  plucks. Open question: is CREPE worth the 5 MB model load?
- **Beat-proximity sensitivity (priority 3) is unimplemented.** Engine
  doesn't know about beat positions yet. Plan: PitchTracker passes a
  `beatProximity` signal into `PitchEngine.process()`; near expected note
  positions the engine relaxes its thresholds and emits sooner.
- **Latency calibration.** `INPUT_LATENCY_HINT = 50ms` in PitchTracker is a
  per-device guess. A first-run calibration screen (tap on the beat 4 times,
  measure offset) would replace it.
- **Scoring.** The game captures notes but doesn't score them against a
  target pattern.
- **Recording fidelity vs file size.** AudioRecorder uses Opus at 256 kbps.
  Default 64 kbps smears transients enough that offline analysis under-
  counts onsets vs live. WAV via AudioWorklet would be lossless but bigger.

## Conventions

- **Algorithm changes go in `PitchEngine.ts`.** If you find yourself editing
  `analyze.ts` to change detection behaviour, stop — that's the bug pattern
  that caused the live/offline divergence we just fixed.
- **Prefer changes that improve clean-input latency.** Heuristics that make
  the algorithm more lenient on attack-transient noise will slow it down.
  Push that work to the player (clean plucking) before pushing it to the
  algorithm.
- **The test bench is the source of truth for "did this work?"** Always
  verify a change against a real recording before claiming a fix.
- **Don't reintroduce duplicate state machines.** If two callers need
  different behaviour, parameterise PitchEngine, don't fork it.

## Glossary

- **Onset** — energy spike marking a pluck attack. Detected by per-chunk RMS
  ratio inside the buffer. Used as the authoritative timestamp for a note's
  visual position.
- **Emission** — one `PitchReading` produced by `PitchEngine.process()`. May
  be an onset (first reading of a new attack, `isNewNote: true`) or a
  fallback (sustain reading, `isNewNote: false`).
- **isNewNote** — flag on a `PitchReading`. PlayScene uses it to decide
  between "start a new dot" (true) and "extend the active line" (false).
- **Preroll / count-in / playing / done** — Conductor phases. The mic is
  active across all of them but the engine is `reset()` at the boundary
  between count-in and playing to discard beep-bleed state.
