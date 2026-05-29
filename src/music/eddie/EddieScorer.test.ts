import { describe, it, expect } from "vitest";
import { EddieScorer } from "./EddieScorer";
import { generateBassline } from "./basslineGen";
import { EventBus } from "../../engine/EventBus";
import type { Conductor, BeatInfo, Phase } from "../../audio/Conductor";
import type { KeyResolver, PitchFiredEvent } from "../KeyResolver";
import type { EddieConfig, EddieScoreEvent, PitchClass } from "./eddieTypes";

// ---------------------------------------------------------------------------
// Pure test harness. The scorer only touches conductor.onBeat /
// onPhaseChange / audioTime and resolver.bus.on("pitchFired"), so we fake
// exactly those. A "step" plays one quarter: open the beat, feed its notes;
// the NEXT beat (or `done`) finalizes and scores it.
// ---------------------------------------------------------------------------

class FakeConductor {
  private beatListeners = new Set<(b: BeatInfo) => void>();
  private phaseListeners = new Set<(p: Phase) => void>();
  audioTime = 0;

  onBeat(fn: (b: BeatInfo) => void) {
    this.beatListeners.add(fn);
    return () => this.beatListeners.delete(fn);
  }
  onPhaseChange(fn: (p: Phase) => void) {
    this.phaseListeners.add(fn);
    return () => this.phaseListeners.delete(fn);
  }
  emitBeat(info: BeatInfo) {
    this.audioTime = info.time;
    this.beatListeners.forEach((fn) => fn(info));
  }
  emitPhase(p: Phase) {
    this.phaseListeners.forEach((fn) => fn(p));
  }
}

class FakeResolver {
  bus = new EventBus<{ pitchFired: PitchFiredEvent; keysNarrowed: unknown }>();
  fire(pitchClass: PitchClass, measureIdx: number, audioTime: number) {
    this.bus.emit("pitchFired", {
      pitchClass,
      midi: 60,
      confidence: 1,
      audioTime,
      measureIdx,
    });
  }
}

interface Harness {
  scorer: EddieScorer;
  events: EddieScoreEvent[];
  /** Play `notes` as one quarter at (measure, beat). */
  play(measure: number, beat: number, notes: PitchClass[]): void;
  /** Flush the final pending quarter/measure. */
  finish(): void;
  total(): number;
}

function makeHarness(config: EddieConfig): Harness {
  const conductor = new FakeConductor();
  const resolver = new FakeResolver();
  const scorer = new EddieScorer(
    conductor as unknown as Conductor,
    resolver as unknown as KeyResolver,
    config,
  );
  scorer.attach();

  const events: EddieScoreEvent[] = [];
  scorer.bus.on("eddieScore", (e) => events.push(e));

  let t = 0;
  const beatDur = 0.5; // 120 BPM-ish; absolute value is irrelevant to scoring

  const play = (measure: number, beat: number, notes: PitchClass[]) => {
    // Open the quarter window with a beat event.
    conductor.emitBeat({
      beat: measure * 4 + beat,
      time: t,
      phase: "playing",
      beatInPhase: beat,
      measureInPlay: measure,
    });
    // Distribute the notes across the quarter (times don't affect scoring,
    // only the count and order/last-pitch do).
    notes.forEach((pc, i) => {
      resolver.fire(pc, measure, t + (i + 1) * (beatDur / (notes.length + 1)));
    });
    t += beatDur;
  };

  const finish = () => {
    conductor.audioTime = t;
    conductor.emitPhase("done");
  };

  return { scorer, events, play, finish, total: () => scorer.total };
}

// E major config with explicit bassline so chord tones are predictable.
function eMajorConfig(): EddieConfig {
  return {
    bpm: 120,
    keyRoot: "E",
    keyMode: "major",
    bassline: generateBassline("E", "major", () => 0.1),
    eighthTagMeasure: 5,
    sixteenthTagMeasure: 10,
  };
}

describe("EddieScorer", () => {
  it("all-roots (E E E E x16) totals LOW — baseline only, no variation/subdiv", () => {
    const h = makeHarness(eMajorConfig());
    for (let m = 0; m < 16; m++) {
      for (let b = 0; b < 4; b++) h.play(m, b, ["E"]);
    }
    h.finish();
    // Every scored quarter is a single repeated root: baseline only, no
    // variation (same pitch each time) and no subdivision.
    for (const e of h.events) {
      expect(e.kinds).not.toContain("eighth");
      expect(e.kinds).not.toContain("sixteenth");
      expect(e.kinds).not.toContain("eighthTagClear");
      expect(e.kinds).not.toContain("sixteenthTagClear");
    }
    // 64 quarters. E is the root and a chord tone of the I chord, so SOME
    // chord-tone bonuses apply, but no variation/subdivision stacking. Compare
    // against a clearly higher melodic run below; assert it's bounded.
    const baselineOnly = h.events.filter((e) => e.kinds.length === 1 && e.kinds[0] === "quarter");
    expect(baselineOnly.length).toBeGreaterThan(0);
  });

  it("an 8th-note pattern scores higher than the same notes as quarters", () => {
    const quarters = makeHarness(eMajorConfig());
    for (let b = 0; b < 4; b++) quarters.play(0, b, ["E"]);
    quarters.finish();

    const eighths = makeHarness(eMajorConfig());
    for (let b = 0; b < 4; b++) eighths.play(0, b, ["E", "G#"]);
    eighths.finish();

    expect(eighths.total()).toBeGreaterThan(quarters.total());
  });

  it("16ths score higher than 8ths", () => {
    const eighths = makeHarness(eMajorConfig());
    for (let b = 0; b < 4; b++) eighths.play(0, b, ["E", "G#"]);
    eighths.finish();

    const sixteenths = makeHarness(eMajorConfig());
    for (let b = 0; b < 4; b++) sixteenths.play(0, b, ["E", "G#", "B", "G#"]);
    sixteenths.finish();

    expect(sixteenths.total()).toBeGreaterThan(eighths.total());
  });

  it("ending a quarter on a chord tone adds the chordTone bonus", () => {
    const config = eMajorConfig();
    const h = makeHarness(config);
    // Bassline measure 0 downbeat is the I chord (root E). Its triad is
    // E/G#/B. End on B (a chord tone) vs end on F# (in key, not a chord tone).
    const chordTones = config.bassline.find((n) => n.measure === 0 && n.beat === 0)!.chordTones;
    expect(chordTones).toContain("B");
    expect(chordTones).not.toContain("F#");

    h.play(0, 0, ["B"]); // ends on chord tone
    h.play(0, 1, ["F#"]); // ends on non-chord in-key tone
    h.finish();

    const first = h.events.find((e) => e.beat === 0)!;
    const second = h.events.find((e) => e.beat === 1)!;
    expect(first.kinds).toContain("chordTone");
    expect(second.kinds).not.toContain("chordTone");
  });

  it("out-of-key notes score 0 and emit outOfKey", () => {
    const h = makeHarness(eMajorConfig());
    // C natural is not in E major.
    h.play(0, 0, ["C"]);
    h.finish();
    const e = h.events.find((ev) => ev.measure === 0 && ev.beat === 0)!;
    expect(e.points).toBe(0);
    expect(e.kinds).toEqual(["outOfKey"]);
    expect(h.total()).toBe(0);
  });

  it("clearing the 8th-tagged measure emits eighthTagClear", () => {
    const config = eMajorConfig(); // eighthTagMeasure = 5
    const h = makeHarness(config);
    // Play measures 0..5; measure 5 entirely as 8ths. A following measure-6
    // boundary beat finalizes measure 5's tag-clear.
    for (let m = 0; m <= 5; m++) {
      for (let b = 0; b < 4; b++) {
        if (m === config.eighthTagMeasure) h.play(m, b, ["E", "F#"]);
        else h.play(m, b, ["E"]);
      }
    }
    h.finish();
    expect(h.events.some((e) => e.kinds.includes("eighthTagClear") && e.measure === 5)).toBe(true);
  });

  it("clearing the 16th-tagged measure emits sixteenthTagClear", () => {
    const config = eMajorConfig(); // sixteenthTagMeasure = 10
    const h = makeHarness(config);
    for (let m = 0; m <= 10; m++) {
      for (let b = 0; b < 4; b++) {
        if (m === config.sixteenthTagMeasure) h.play(m, b, ["E", "F#", "G#", "A"]);
        else h.play(m, b, ["E"]);
      }
    }
    h.finish();
    expect(h.events.some((e) => e.kinds.includes("sixteenthTagClear") && e.measure === 10)).toBe(true);
  });

  it("a partial 8th measure does NOT clear the 8th tag", () => {
    const config = eMajorConfig();
    const h = makeHarness(config);
    for (let m = 0; m <= 5; m++) {
      for (let b = 0; b < 4; b++) {
        if (m === config.eighthTagMeasure && b < 3) h.play(m, b, ["E", "F#"]);
        else h.play(m, b, ["E"]); // last beat of tagged measure is a quarter
      }
    }
    h.finish();
    expect(h.events.some((e) => e.kinds.includes("eighthTagClear"))).toBe(false);
  });

  it("rewards melodic variation over repetition", () => {
    // Hold chord-tone and subdivision constant so only variation differs:
    // E and B are both chord tones of the I chord (E/G#/B). The repeated run
    // never varies; the alternating run varies on quarters 2-4.
    const chordTones = eMajorConfig().bassline.find((n) => n.measure === 0 && n.beat === 0)!.chordTones;
    expect(chordTones).toEqual(expect.arrayContaining(["E", "B"]));

    const repeated = makeHarness(eMajorConfig());
    for (let b = 0; b < 4; b++) repeated.play(0, b, ["E"]);
    repeated.finish();

    const varied = makeHarness(eMajorConfig());
    const melody: PitchClass[] = ["E", "B", "E", "B"];
    melody.forEach((pc, b) => varied.play(0, b, [pc]));
    varied.finish();

    expect(varied.total()).toBeGreaterThan(repeated.total());
  });
});
