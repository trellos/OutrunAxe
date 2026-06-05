// InteractionDirector — the party AI.
//
// Strong characters (root/3rd/5th) are focal points; nearby weak characters
// gather around them and the group performs a party activity scaled by how many
// showed up and how good the host is:
//   1 guest  -> high-five
//   2 guests -> toast
//   3 guests -> pyramid (perfect host stacks 3 tiers, normal 2, loose 1) / dance
//
// Each activity runs gather -> perform -> release. Characters are claimed via
// their `busy` flag (which suspends their own wander) and driven directly here.

import type { Character } from "./Character";

type ActivityKind = "highfive" | "toast" | "pyramid" | "dance";

interface Activity {
  kind: ActivityKind;
  host: Character;
  guests: Character[];
  phase: "gather" | "perform";
  timer: number; // perform-phase countdown (seconds)
  centerX: number; // ground anchor (host's spot)
}

const GATHER_RANGE = 260; // px: how far a weak character will come for a host
const MAX_GUESTS = 3;

export class InteractionDirector {
  private activities: Activity[] = [];
  private cooldown = 2; // seconds until the next attempt to start something

  constructor(private getCharacters: () => Iterable<Character>) {}

  update(dt: number): void {
    for (let i = this.activities.length - 1; i >= 0; i--) {
      if (this.tickActivity(this.activities[i], dt)) this.activities.splice(i, 1);
    }
    this.cooldown -= dt;
    if (this.cooldown <= 0) {
      this.cooldown = 1.5 + Math.random() * 2.5;
      this.tryStart();
    }
  }

  /** Try to form one new activity from idle, grounded characters. */
  private tryStart(): void {
    const free: Character[] = [];
    for (const c of this.getCharacters()) if (c.grounded && !c.busy) free.push(c);

    const hosts = free.filter((c) => c.tier === "strong");
    const guestsAll = free.filter((c) => c.tier === "weak");
    if (hosts.length === 0 || guestsAll.length === 0) return;

    const host = hosts[Math.floor(Math.random() * hosts.length)];
    const near = guestsAll
      .map((g) => ({ g, d: Math.abs(g.x - host.x) }))
      .filter((o) => o.d <= GATHER_RANGE)
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_GUESTS)
      .map((o) => o.g);
    if (near.length === 0) return;

    const kind: ActivityKind =
      near.length >= 3 ? "pyramid" : near.length === 2 ? "toast" : "highfive";

    host.busy = true;
    host.glow = true;
    for (const g of near) {
      g.busy = true;
      g.glow = true;
    }

    this.activities.push({
      kind,
      host,
      guests: near,
      phase: "gather",
      timer: this.performDuration(kind),
      centerX: host.x,
    });
  }

  private performDuration(kind: ActivityKind): number {
    switch (kind) {
      case "highfive":
        return 1.2;
      case "toast":
        return 2.0;
      case "pyramid":
        return 3.0;
      case "dance":
        return 2.6;
    }
  }

  /** Gather slot X for guest i: alternating sides, fanning out from the host. */
  private slotX(a: Activity, i: number): number {
    const spacing = a.host.getSpriteSize().w * 0.85;
    const rank = Math.floor(i / 2) + 1;
    const side = i % 2 === 0 ? 1 : -1;
    return a.centerX + side * spacing * rank;
  }

  /** Advance one activity; returns true when finished (and released). */
  private tickActivity(a: Activity, dt: number): boolean {
    if (a.phase === "gather") {
      let allThere = a.host.walkToward(a.centerX, dt, 24);
      a.guests.forEach((g, i) => {
        const arrived = g.walkToward(this.slotX(a, i), dt, 38);
        allThere = arrived && allThere;
      });
      if (allThere) {
        a.phase = "perform";
        this.startPerform(a);
      }
      return false;
    }

    // perform
    a.timer -= dt;
    if (a.timer <= 0) {
      this.release(a);
      return true;
    }
    return false;
  }

  /** Lock in the performance poses/positions for the activity. */
  private startPerform(a: Activity): void {
    a.host.setPose(a.kind === "dance" ? "jump" : "interact");

    if (a.kind === "pyramid") {
      const tiers =
        a.host.quality === "perfect" ? 3 : a.host.quality === "normal" ? 2 : 1;
      const tierH = a.host.getSpriteSize().h * 0.65;
      a.guests.forEach((g, i) => {
        if (i < tiers) {
          // Climb onto the host: stacked straight up the centre.
          g.walkToward(a.centerX, 1, 9999); // snap to centre
          g.setElevation(tierH * (i + 1));
          g.setPose("interact");
        } else {
          // Extra friends cheer from the side.
          g.setPose("interact");
        }
      });
      return;
    }

    // high-five / toast / dance: everyone faces in and plays the social pose.
    const pose = a.kind === "dance" ? "jump" : "interact";
    for (const g of a.guests) g.setPose(pose);
  }

  /** Release all participants back to wandering. */
  private release(a: Activity): void {
    const reset = (c: Character) => {
      c.busy = false;
      c.glow = false;
      c.setElevation(0);
      c.setPose("idle");
    };
    reset(a.host);
    a.guests.forEach(reset);
  }
}
