# Test fixtures

Each fixture is an audio file (`.webm`) under `public/samples/<id>.webm` paired
with a JSON spec at `src/test/fixtures/<id>.json` describing what the player
performed. The verifier in [`fixtures.ts`](./fixtures.ts) loads both, runs
the engine offline, and compares the engine's emitted events against the
expected list.

## JSON schema

```jsonc
{
  // What the player performed. Each event is one note as the player
  // intended it — bends and taps after a pluck do NOT count as new
  // events here unless they're a fresh attack.
  "expected": [
    {
      "kind": "pluck" | "tap" | "bend",
      "tSec": 2.080,        // approximate audio time of the attack
      "pitchClass": "A",    // octave-agnostic; engine's pitch class checked
      // bend-only:
      "pitchPeak": "C",     // optional — pitch the bend reaches
      "pitchEnd":  "B"      // optional — pitch the bend lands on
    }
  ],
  // Tolerances used when matching detected events against `expected`.
  "tolerance": {
    "timeSec": 0.18,        // a detected onset matches if its time is
                            // within this window of an expected event
    "extras": 0             // how many extra detected onsets are tolerated
  }
}
```

## Adding a new fixture

1. Record `<id>.webm` into `public/samples/`. Start with 4 beats of metronome
   click, then play. Stop the recording with at least 0.5 s of trailing
   silence so silence-end fires cleanly.
2. Create `src/test/fixtures/<id>.json` describing the expected events.
3. Open the test bench, pick the fixture from the source dropdown, and
   visually confirm the verifier passes.
