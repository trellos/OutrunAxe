import { describe, it, expect } from "vitest";
import { level1 } from "../levels/level1";
import { level2 } from "../levels/level2";
import { level3 } from "../levels/level3";
import { roadBoundingBox, isRoadFlat } from "./roadVerify";

const levels = [
  { name: "level1", level: level1 },
  { name: "level2", level: level2 },
  { name: "level3", level: level3 },
];

describe("road geometry lies flat on the XZ ground plane", () => {
  for (const { name, level } of levels) {
    it(`${name}: road bounding box is wide+thin, not vertical`, () => {
      const box = roadBoundingBox(level.curve);
      // Diagnostic output so the numbers are visible in test logs.
      // eslint-disable-next-line no-console
      console.log(
        `[road] ${name} bbox sizeX=${box.sizeX.toFixed(2)} sizeY=${box.sizeY.toFixed(
          2,
        )} sizeZ=${box.sizeZ.toFixed(2)} flat=${isRoadFlat(level.curve)}`,
      );
      const horizontal = Math.max(box.sizeX, box.sizeZ);
      // A flat road spans hundreds of units horizontally...
      expect(horizontal).toBeGreaterThan(50);
      // ...and is thin vertically relative to that footprint.
      expect(box.sizeY / horizontal).toBeLessThan(0.2);
      expect(isRoadFlat(level.curve)).toBe(true);
    });
  }
});
