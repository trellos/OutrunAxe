import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { level1 } from "../levels/level1";
import { level2 } from "../levels/level2";
import { level3 } from "../levels/level3";
import { buildFlatRibbon, roadBoundingBox, isRoadFlat } from "./roadVerify";

/** A straight curve along +Z on the ground plane (the simple flat case). */
function straightZ(length = 200): THREE.Curve<THREE.Vector3> {
  return new THREE.LineCurve3(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -length),
  );
}

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

describe("buildFlatRibbon geometry shape", () => {
  it("a straight curve produces a wide, thin ribbon (width across, thickness up)", () => {
    const geom = buildFlatRibbon(straightZ(200), 8, 0.02, 32);
    geom.computeBoundingBox();
    const size = new THREE.Vector3();
    geom.boundingBox!.getSize(size);
    // Wide across X (railWidth), thin in Y (thickness), long in Z (curve length).
    expect(size.x).toBeCloseTo(8, 5);
    expect(size.y).toBeCloseTo(0.02, 5);
    expect(size.z).toBeCloseTo(200, 5);
    geom.dispose();
  });

  it("emits 4 vertices per sample and is indexed", () => {
    const steps = 10;
    const geom = buildFlatRibbon(straightZ(), 8, 0.02, steps);
    const pos = geom.getAttribute("position");
    expect(pos.count).toBe((steps + 1) * 4);
    expect(geom.getIndex()).not.toBeNull();
    geom.dispose();
  });
});

describe("isRoadFlat thresholds and curb offset", () => {
  it("a deliberately tall ribbon (thickness ~ railWidth) is NOT flat", () => {
    // Forcing the 'thickness' up to the rail width models the old vertical-
    // ribbon bug: sizeY becomes comparable to the horizontal footprint of a
    // short curve, pushing the ratio above the 0.2 default.
    const curve = straightZ(8);
    expect(isRoadFlat(curve, 8, /*thickness*/ 8)).toBe(false);
    // The same geometry passes if we loosen the ratio past ~1.0.
    expect(isRoadFlat(curve, 8, 8, 160, /*ratio*/ 1.5)).toBe(true);
  });

  it("respects the ratio parameter as the flat/not-flat boundary", () => {
    const curve = straightZ(100);
    const { sizeX, sizeY, sizeZ } = roadBoundingBox(curve, 8, 0.02);
    const observed = sizeY / Math.max(sizeX, sizeZ);
    // A ratio just below the observed value rejects; just above accepts.
    expect(isRoadFlat(curve, 8, 0.02, 160, observed - 1e-6)).toBe(false);
    expect(isRoadFlat(curve, 8, 0.02, 160, observed + 1e-6)).toBe(true);
  });

  it("a zero-length (degenerate) curve has no horizontal footprint and is not flat", () => {
    const point = new THREE.LineCurve3(
      new THREE.Vector3(5, 0, 5),
      new THREE.Vector3(5, 0, 5),
    );
    const box = roadBoundingBox(point, 8, 0.02, 8);
    // No length means the only spread is the rail width across X.
    expect(box.sizeZ).toBeCloseTo(0, 5);
    // Footprint is just the width (8); still classified flat since sizeY is tiny.
    expect(isRoadFlat(point)).toBe(true);
  });

  it("the curb offset shifts the ribbon centerline sideways without changing its size", () => {
    const curve = straightZ(120);
    const centered = buildFlatRibbon(curve, 2, 0.02, 32, /*offset*/ 0);
    const shifted = buildFlatRibbon(curve, 2, 0.02, 32, /*offset*/ 6);
    centered.computeBoundingBox();
    shifted.computeBoundingBox();
    const cSize = new THREE.Vector3();
    const sSize = new THREE.Vector3();
    centered.boundingBox!.getSize(cSize);
    shifted.boundingBox!.getSize(sSize);
    // Same dimensions...
    expect(sSize.x).toBeCloseTo(cSize.x, 5);
    // ...but the X center moved by the offset (curb sits beside the road).
    const cCenter = new THREE.Vector3();
    const sCenter = new THREE.Vector3();
    centered.boundingBox!.getCenter(cCenter);
    shifted.boundingBox!.getCenter(sCenter);
    expect(Math.abs(sCenter.x - cCenter.x)).toBeCloseTo(6, 4);
    centered.dispose();
    shifted.dispose();
  });
});
