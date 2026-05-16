# OutrunAxe

A 3D on-rails rhythm-combat game. You walk a rail through a neon city with a
guitar; note-tagged enemies fly in; you destroy them by playing notes that
fit the musical key they live in. Sticking to a key and landing melodic
combos multiplies your damage. Survive four measures per level.

**GTA III × Jet Set Radio × Time Crisis** — gritty textured night city,
cel-shaded, on rails.

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
