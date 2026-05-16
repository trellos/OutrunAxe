export class PlayerStats {
  hp = 100;
  readonly maxHp = 100;
  kills = 0;
  passes = 0;
  notesFired = 0;
  totalDamage = 0;

  takeDamage(amount: number) {
    this.hp = Math.max(0, this.hp - amount);
  }

  get isDead(): boolean {
    return this.hp <= 0;
  }
}
