# Infinite Eddie

A 3D on-rails rhythm-combat game. You walk a rail through a neon city with a
guitar; note-tagged enemies fly in; you destroy them by playing notes that
fit the musical key they live in. Sticking to a key and landing melodic
combos multiplies your damage. Survive four measures per level.

**GTA III × Jet Set Radio × Time Crisis** — gritty textured night city,
cel-shaded, on rails.

## Modes

The title screen offers four:

- **OUTRUN** — the on-rails rhythm-combat game described below (the original).
- **SCORE RUN** — "Infinite Eddie": a mic/keyboard jam scored over 16 bars; the
  notes you play plot onto a timeline grid and spawn a living crowd below it.
  See [`docs/GDD.md`](docs/GDD.md).
- **BATTLE** — Score Run's sibling: a 16-bar shark fight on the neon ocean. Your
  played notes spawn swimmers, windsurf boards, and boomerangs; sharks swim in
  from the horizon and eat anyone undefended. Boards and boomerangs kill sharks.
- **CLIFF DIVE** — a 16-bar ocean cliff climb. Your notes spawn muscular climbers
  who scale the timeline-box edges; dolphins breach to spit them off, lobsters
  block the dolphins, and triplets drop healing orbs. Survivors swan-dive off the
  cliff at the end (`Dolphins:` knocked off vs `Dudes:` who dived). See
  [`HANDOFF-cliff-dive.md`](HANDOFF-cliff-dive.md).

## Play

```bash
npm install
npm run dev
```

Open the printed URL. Click **PLAY**, allow the microphone (or use the
keyboard piano), pick an outfit + guitar, choose a level.

- **Mic:** play/sing notes. Notes in an enemy's key damage it; the more you
  commit to one key, the harder you hit.
- **Keyboard piano:** `Z S X D C V G B H N J M` = C through B (no mic
  needed).
- **Combos** (per measure) multiply damage: start on the root, end on the
  root, a two-octave run, a repeated triplet phrase, a repeated 16th phrase.
- Enemies that reach you cost HP. Clear the measures with HP left to win.

URL flags: `?auto=1` auto-plays for hands-free demo; `?record=1` captures an
audio session for pitch-engine tuning.

## Levels

1. **Strip Mall Sunset** — 90 BPM, gentle tutorial.
2. **Subway Mezzanine** — 110 BPM, tiled tunnel.
3. **Rooftop Skyline** — 130 BPM, neon billboards.

Best scores persist locally; results show a **NEW BEST!** badge.

## Stack

Three.js (rendering + post-FX), Web Audio API (timing, synthesis, mic),
pitchfinder/Macleod (monophonic pitch detection), Vite + TypeScript. The
character is the CC0 `RobotExpressive` GLB.

## Developing

See [`AGENTS.md`](AGENTS.md) for architecture, the critical
GLB-rig/bloom/lighting gotchas, the audio-engine rules (carried over
unchanged from the project's 2D origin), and headless-verification notes.
The original build plan is in
[`plans/outrunaxe-3d-guitar-solo-combat.md`](plans/outrunaxe-3d-guitar-solo-combat.md).

```bash
npm run dev          # dev server
npx tsc --noEmit     # typecheck — must be clean before shipping
```
