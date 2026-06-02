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
});
