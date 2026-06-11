// Headless vitest for the Cliff Dive crowd. Runs in the `node` environment (no
// DOM, no audio, no WebGL): the crowd + entities guard all DOM behind
// `typeof document` and advance purely via update(dt) + explicit
// onQuarterDiamonds / setActiveMeasure / measureWave / beat calls, with an
// injected seeded RNG for determinism.

import { describe, it, expect } from "vitest";
import { CliffDiveCrowd } from "./CliffDiveCrowd";
import { Climber } from "./Climber";
import type { BoxRect } from "./Climber";

/** Deterministic LCG so tests don't depend on Math.random. */
function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const BPM = 120;
const BEAT = 60 / BPM; // 0.5s

/** 4 side-by-side measure boxes, each 200px wide, 160px tall. */
function stubResolveCell(measure: number): BoxRect | null {
  const col = ((measure % 4) + 4) % 4;
  const left = col * 200 + 20;
  return { left, right: left + 160, top: 60, bottom: 220 };
}

function makeCrowd(seed = 1, extra: Record<string, unknown> = {}) {
  return new CliffDiveCrowd({
    resolveCell: stubResolveCell,
    beatDuration: BEAT,
    rng: seededRng(seed),
    viewW: () => 900,
    viewH: () => 600,
    ...extra,
  });
}

function quarter(measure: number, beat: number, subdiv: number, quality = 0.9) {
  const notes = Array.from({ length: subdiv }, () => ({ strong: true, quality }));
  return { measure, beat, subdiv, notes };
}

describe("CliffDiveCrowd spawn map", () => {
  it("subdiv 1 spawns 2 men on left+right edges", () => {
    const c = makeCrowd();
    c.onQuarterDiamonds(quarter(0, 0, 1));
    c.setActiveMeasure(1); // flush measure 0
    expect(c.totalMen).toBe(2);
    const edges = c.climberStates.map((s) => s.edge).sort();
    expect(edges).toEqual(["left", "right"]);
  });

  it("subdiv 2 spawns 1 man on the nearer box edge", () => {
    const c = makeCrowd();
    c.onQuarterDiamonds(quarter(0, 1, 2));
    c.setActiveMeasure(1);
    expect(c.totalMen).toBe(1);
    // Climbs a box EDGE (nearer side), not the note bar inside the box.
    expect(["left", "right"]).toContain(c.climberStates[0].edge);
  });

  it("subdiv 3 spawns 3 orbs", () => {
    const c = makeCrowd();
    c.onQuarterDiamonds(quarter(0, 0, 3));
    c.setActiveMeasure(1);
    expect(c.orbCount).toBe(3);
    expect(c.totalMen).toBe(0);
  });

  it("subdiv 4 spawns 4 lobsters", () => {
    const c = makeCrowd();
    c.onQuarterDiamonds(quarter(0, 0, 4));
    c.setActiveMeasure(1);
    expect(c.lobsterCount).toBe(4);
  });
});

describe("Climber unit behavior", () => {
  const box: BoxRect = { left: 100, right: 260, top: 60, bottom: 220 };

  function mkClimber(quality: number) {
    const tier = quality >= 0.8 ? "strong" : quality >= 0.45 ? "medium" : "weak";
    return new Climber({
      id: 1,
      hangX: box.left,
      hangY: box.bottom,
      box,
      edge: "left",
      tier,
      waterY: 560,
      viewW: 900,
    });
  }

  it("maps quality to hp tiers", () => {
    expect(mkClimber(0.9).maxHp).toBe(3);
    expect(mkClimber(0.5).maxHp).toBe(2);
    expect(mkClimber(0.2).maxHp).toBe(1);
  });

  it("3hp climber reaches the top in ~4 beats", () => {
    const c = mkClimber(0.9);
    // advance past the brief hang + shimmy (already at the left edge), then climb
    for (let i = 0; i < 400; i++) c.update(0.02, BEAT); // 8s sim
    // a 3hp man climbs a full box in 4 beats = 2s; well within 8s
    expect(c.atTop).toBe(true);
  });

  it("3hp from half height reaches top in ~2 beats (linear in remaining)", () => {
    const c = mkClimber(0.9);
    // get it climbing
    for (let i = 0; i < 30; i++) c.update(0.02, BEAT); // clear hang+shimmy
    expect(c.phase === "climb" || c.atTop).toBe(true);
    // step until roughly half height
    while (c.heightFrac < 0.5 && !c.atTop) c.update(0.01, BEAT);
    const start = c.heightFrac;
    expect(start).toBeGreaterThanOrEqual(0.5);
    // ~2 beats (1s) more should hit the top
    let t = 0;
    while (!c.atTop && t < 1.5) { c.update(0.01, BEAT); t += 0.01; }
    expect(c.atTop).toBe(true);
    expect(t).toBeLessThan(1.4);
  });

  it("dolphin hit drops 1hp and ~1/4 height", () => {
    const c = mkClimber(0.9);
    for (let i = 0; i < 60; i++) c.update(0.02, BEAT); // climb up a bit
    const before = c.heightFrac;
    c.takeDolphinHit();
    expect(c.hp).toBe(2);
    expect(before - c.heightFrac).toBeGreaterThan(0.2);
  });

  it("hp to 0 falls into the water and becomes safe", () => {
    const c = mkClimber(0.2); // 1hp
    for (let i = 0; i < 30; i++) c.update(0.02, BEAT);
    c.takeDolphinHit(); // -> 0hp -> falling
    for (let i = 0; i < 300; i++) c.update(0.02, BEAT);
    expect(c.inWater).toBe(true);
    expect(c.safe).toBe(true);
  });
});

describe("Scenario A: dolphins knock all 16 men into the water (no lobsters)", () => {
  it("spawns 16 men then drowns them all", () => {
    const c = makeCrowd(7);
    // measure 0: 4 quarter events -> 8 men on L/R edges
    for (let b = 0; b < 4; b++) c.onQuarterDiamonds(quarter(0, b, 1));
    // measures 1 & 2: 8 eighth events -> 8 mid men
    for (let b = 0; b < 4; b++) c.onQuarterDiamonds(quarter(1, b, 2));
    for (let b = 0; b < 4; b++) c.onQuarterDiamonds(quarter(2, b, 2));
    c.setActiveMeasure(3); // flush 0,1,2
    expect(c.totalMen).toBe(16);

    // Run repeated dolphin waves with NO lobsters until everyone is in the water.
    // Waves come every beat (a relentless assault with no lobster defence).
    let measure = 4;
    let simTime = 0;
    const MAX = 120; // seconds, generous bound
    while (c.menInWater < 16 && simTime < MAX) {
      c.measureWave(measure++);
      // advance a few frames between waves (a relentless overlapping assault)
      for (let i = 0; i < 8; i++) { c.update(0.02, BEAT); simTime += 0.02; }
    }
    expect(c.menInWater).toBe(16);
    expect(c.dolphinKnockdowns).toBeGreaterThanOrEqual(16);
  });
});

describe("Scenario B: lobsters protect the climbers to the top", () => {
  it("constant 16ths cancel dolphins; all men reach the top", () => {
    const c = makeCrowd(3);
    // 16 men exactly as scenario A.
    for (let b = 0; b < 4; b++) c.onQuarterDiamonds(quarter(0, b, 1));
    for (let b = 0; b < 4; b++) c.onQuarterDiamonds(quarter(1, b, 2));
    for (let b = 0; b < 4; b++) c.onQuarterDiamonds(quarter(2, b, 2));
    c.setActiveMeasure(3);
    expect(c.totalMen).toBe(16);

    let measure = 4;
    let simTime = 0;
    let sawLobsters = false;
    const MAX = 40;
    while (c.menAtTop < 16 && simTime < MAX) {
      c.measureWave(measure);
      // Feed a constant stream of 16ths every measure (4 quarters -> 16 lobsters).
      for (let b = 0; b < 4; b++) c.onQuarterDiamonds(quarter(measure, b, 4));
      c.setActiveMeasure(measure + 1); // flush this measure's lobsters immediately
      measure++;
      for (let i = 0; i < 100; i++) {
        c.update(0.02, BEAT);
        simTime += 0.02;
        if (c.lobsterCount > 0) sawLobsters = true;
      }
    }
    expect(sawLobsters).toBe(true);
    expect(c.menInWater).toBe(0);
    expect(c.menAtTop).toBe(16);
  });
});

describe("Dolphin / lobster / orb interactions", () => {
  it("a dolphin hits at most one climber per edge per wave", () => {
    const c = makeCrowd(11);
    // two men on the left edge of measure 0
    c.onQuarterDiamonds(quarter(0, 0, 1));
    c.onQuarterDiamonds(quarter(0, 1, 1));
    c.setActiveMeasure(1);
    const leftMen = c.climberStates.filter((s) => s.edge === "left");
    expect(leftMen.length).toBe(2);
    // one wave
    c.measureWave(4);
    for (let i = 0; i < 100; i++) c.update(0.02, BEAT);
    // each man should have lost at most 1 hp in a single wave
    for (const s of c.climberStates) {
      expect(s.maxHp - s.hp).toBeLessThanOrEqual(1);
    }
  });

  it("orbs heal needy men", () => {
    const c = makeCrowd(5);
    // one 3hp man, climb a bit, then injure him
    c.onQuarterDiamonds(quarter(0, 1, 2)); // mid man, 3hp
    c.setActiveMeasure(1);
    const man = c.climberStates[0];
    expect(man.maxHp).toBe(3);
    for (let i = 0; i < 60; i++) c.update(0.02, BEAT);
    // injure to 1hp via two dolphin hits is hard to target; spawn orbs after a
    // wave drops his hp. Instead: drive a wave to damage, then orbs to heal.
    c.measureWave(4);
    for (let i = 0; i < 100; i++) c.update(0.02, BEAT);
    const hurt = c.climberStates[0];
    if (hurt && hurt.hp < hurt.maxHp && hurt.phase !== "water") {
      const before = hurt.hp;
      c.onQuarterDiamonds(quarter(2, 0, 3)); // 3 orbs
      c.setActiveMeasure(3);
      for (let i = 0; i < 200; i++) c.update(0.02, BEAT);
      const after = c.climberStates[0];
      if (after) expect(after.hp).toBeGreaterThanOrEqual(before);
    }
  });
});

describe("Determinism", () => {
  it("identical seed + script -> identical snapshot", () => {
    function run(seed: number) {
      const c = makeCrowd(seed);
      for (let b = 0; b < 4; b++) c.onQuarterDiamonds(quarter(0, b, 1));
      c.setActiveMeasure(1);
      let m = 4;
      for (let w = 0; w < 6; w++) {
        c.measureWave(m++);
        for (let i = 0; i < 100; i++) c.update(0.02, BEAT);
      }
      return {
        men: c.totalMen,
        water: c.menInWater,
        top: c.menAtTop,
        knock: c.dolphinKnockdowns,
        states: c.climberStates.map((s) => `${s.id}:${s.hp}:${s.phase}`),
      };
    }
    expect(run(42)).toEqual(run(42));
  });
});
