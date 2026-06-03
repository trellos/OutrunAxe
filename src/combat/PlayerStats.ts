export class PlayerStats {
  hp = 100;
  readonly maxHp = 100;
  kills = 0;
  passes = 0;
  notesFired = 0;
  totalDamage = 0;
  /** One entry per enemy dispatched (killed), in dispatch order. Consumed by
   *  the results screen to list every enemy taken down. `damage` is the
   *  enemy's total HP (how much it took to die); `time` is the audio-clock
   *  time of the killing blow in seconds. */
  dispatches: { pitchClass: string; damage: number; time: number }[] = [];

  takeDamage(amount: number) {
    this.hp = Math.max(0, this.hp - amount);
  }

  /** Log a single enemy dispatch for the results screen. */
  recordDispatch(pitchClass: string, damage: number, time: number) {
    this.dispatches.push({ pitchClass, damage, time });
  }

  get isDead(): boolean {
    return this.hp <= 0;
  }

  /** Running score. Single source of truth shared by the live HUD counter and
   *  the final results screen so the two always agree. */
  get score(): number {
    return this.kills * 100 + Math.round(this.totalDamage * 50);
  }
}
