// Aggregates every character definition for the debug viewer and
// in-game wiring. Each file is owned by one art agent.
import type { CharacterDef } from "./types";
import { def as mainGunslinger } from "./mainGunslinger";
import { def as mainSilva } from "./mainSilva";
import { def as mainMetal } from "./mainMetal";
import { def as enemyMba } from "./enemyMba";
import { def as enemyManHater } from "./enemyManHater";
import { def as enemyLatte } from "./enemyLatte";
import { def as enemyPrude } from "./enemyPrude";

export const CHARACTERS: CharacterDef[] = [
  mainGunslinger, mainSilva, mainMetal,
  enemyMba, enemyManHater, enemyLatte, enemyPrude,
];

export const MAIN_CHARACTERS = CHARACTERS.filter((c) => c.kind === "main");
export const ENEMY_CHARACTERS = CHARACTERS.filter((c) => c.kind === "enemy");

export function characterById(id: string): CharacterDef | undefined {
  return CHARACTERS.find((c) => c.id === id);
}
