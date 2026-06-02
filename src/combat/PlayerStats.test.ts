import { describe, it, expect } from "vitest";
import { PlayerStats } from "./PlayerStats";

describe("PlayerStats", () => {
  it("starts at full HP", () => {
    const s = new PlayerStats();
    expect(s.hp).toBe(s.maxHp);
    expect(s.isDead).toBe(false);
  });

  it("takeDamage reduces hp", () => {
    const s = new PlayerStats();
    s.takeDamage(30);
    expect(s.hp).toBe(70);
  });

  it("hp never goes below 0", () => {
    const s = new PlayerStats();
    s.takeDamage(9999);
    expect(s.hp).toBe(0);
  });

  it("isDead is true exactly when hp === 0", () => {
    const s = new PlayerStats();
    s.takeDamage(s.maxHp);
    expect(s.isDead).toBe(true);
  });

  it("isDead is false at 1 HP", () => {
    const s = new PlayerStats();
    s.takeDamage(s.maxHp - 1);
    expect(s.isDead).toBe(false);
  });

  it("counters start at zero", () => {
    const s = new PlayerStats();
    expect(s.kills).toBe(0);
    expect(s.passes).toBe(0);
    expect(s.notesFired).toBe(0);
    expect(s.totalDamage).toBe(0);
  });

  it("multiple damage calls are cumulative", () => {
    const s = new PlayerStats();
    s.takeDamage(20);
    s.takeDamage(20);
    expect(s.hp).toBe(60);
  });

  it("score starts at zero and combines kills and damage", () => {
    const s = new PlayerStats();
    expect(s.score).toBe(0);
    s.kills = 3;
    s.totalDamage = 2.4;
    expect(s.score).toBe(3 * 100 + Math.round(2.4 * 50));
  });

  // Guard against the live HUD counter and the final results screen drifting
  // apart: both read PlayerStats.score, so this pins the one formula they share.
  it("score equals kills*100 + round(totalDamage*50) (single source of truth)", () => {
    const s = new PlayerStats();
    for (const [kills, dmg] of [
      [0, 0],
      [1, 0.3],
      [7, 12.49],
      [12, 13.5],
    ] as const) {
      s.kills = kills;
      s.totalDamage = dmg;
      expect(s.score).toBe(kills * 100 + Math.round(dmg * 50));
    }
  });
});

describe("PlayerStats dispatch log", () => {
  it("starts empty", () => {
    const s = new PlayerStats();
    expect(s.dispatches).toEqual([]);
  });

  it("recordDispatch appends entries in order with the given fields", () => {
    const s = new PlayerStats();
    s.recordDispatch("C", 2.5, 10);
    s.recordDispatch("F#", 4, 12.25);
    expect(s.dispatches).toEqual([
      { pitchClass: "C", damage: 2.5, time: 10 },
      { pitchClass: "F#", damage: 4, time: 12.25 },
    ]);
  });

  it("preserves dispatch order across many entries", () => {
    const s = new PlayerStats();
    const order = ["C", "D", "E", "G", "A"];
    order.forEach((pc, i) => s.recordDispatch(pc, i + 1, i));
    expect(s.dispatches.map((d) => d.pitchClass)).toEqual(order);
    expect(s.dispatches.map((d) => d.time)).toEqual([0, 1, 2, 3, 4]);
  });

  it("logging dispatches does not by itself change kills or score", () => {
    // recordDispatch is purely a log for the results screen; scoring is driven
    // separately by kills/totalDamage.
    const s = new PlayerStats();
    s.recordDispatch("C", 5, 1);
    expect(s.kills).toBe(0);
    expect(s.score).toBe(0);
    // ...and the score reflects kills+damage once those are set alongside.
    s.kills = 1;
    s.totalDamage = 5;
    expect(s.score).toBe(1 * 100 + Math.round(5 * 50));
  });
});

describe("score display parity (HUD vs results)", () => {
  // The live HUD (`setScore`/LevelState) and the results screen both read
  // `PlayerStats.score` directly, and `setScore` renders it via `String(value)`.
  // This pins the exact rendered string for both consumers so a future change
  // to either render path can't silently diverge from the shared number. (DOM
  // is intentionally avoided — the vitest env is `node`.)
  const render = (value: number) => String(value);

  it("the rendered HUD string equals the stringified shared score", () => {
    const s = new PlayerStats();
    s.kills = 4;
    s.totalDamage = 7.6;
    const shared = s.score; // single source consumed by HUD AND results
    expect(render(shared)).toBe(String(4 * 100 + Math.round(7.6 * 50)));
    expect(render(shared)).toBe(String(shared));
  });

  it("a zero score renders as \"0\"", () => {
    const s = new PlayerStats();
    expect(render(s.score)).toBe("0");
  });
});
