import * as THREE from "three";

/**
 * Pure verification helpers for the road geometry.
 *
 * The road in {@link buildRoad} is a 2D cross-section (width `railWidth` along
 * the shape's local X, thickness `thickness` along the shape's local Y)
 * extruded along the level curve via {@link THREE.ExtrudeGeometry}. For the
 * road to lie FLAT on the XZ ground plane, the extrusion's Frenet frame must
 * map the cross-section's wide axis (railWidth) onto a horizontal direction so
 * the resulting mesh is wide (X/Z) and thin (Y). If the frame instead maps the
 * width onto the vertical axis, the road "stands up" as a tall ribbon facing
 * the camera — the classic bug this module guards against.
 *
 * These helpers rebuild the exact geometry used by the renderer and measure its
 * axis-aligned bounding box so the result can be asserted in unit tests without
 * a WebGL context (three runs headlessly under Node).
 */

export interface RoadBoxSize {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
}

/**
 * Build a FLAT road ribbon by sampling the curve and offsetting each sample
 * left/right by `railWidth / 2` along the horizontal (XZ) perpendicular of the
 * tangent. The ribbon's two edges sit at `y` and the top face is raised by
 * `thickness`, so the geometry is wide across the ground and only `thickness`
 * tall — independent of the curve's Frenet frame.
 *
 * This is the geometry the renderer uses for the road/curbs and that the
 * verification helpers measure, so the test and the shipped mesh can never
 * disagree.
 *
 * @param offset  Lateral offset of the ribbon's centerline (used for curbs).
 * @param width   Width of the ribbon across the ground.
 * @param height  Top-face height above the ribbon base.
 */
export function buildFlatRibbon(
  curve: THREE.Curve<THREE.Vector3>,
  width: number,
  height: number,
  steps = 160,
  offset = 0,
): THREE.BufferGeometry {
  const half = width / 2;
  const positions: number[] = [];
  const indices: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();

  // For each sample we emit 4 vertices: bottom-left, bottom-right, top-left,
  // top-right (top = raised by `height`). Consecutive samples are stitched into
  // the top face plus the two outer walls so the ribbon reads as a solid strip.
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = curve.getPointAt(t);
    curve.getTangentAt(t, tangent);
    // Horizontal perpendicular: flatten tangent onto XZ then cross with up.
    tangent.y = 0;
    if (tangent.lengthSq() < 1e-8) tangent.set(0, 0, -1);
    tangent.normalize();
    side.crossVectors(up, tangent).normalize(); // points to the road's left/right

    const cx = p.x + side.x * offset;
    const cz = p.z + side.z * offset;
    const lx = cx + side.x * half;
    const lz = cz + side.z * half;
    const rx = cx - side.x * half;
    const rz = cz - side.z * half;

    // bottom-left, bottom-right, top-left, top-right
    positions.push(lx, p.y, lz);
    positions.push(rx, p.y, rz);
    positions.push(lx, p.y + height, lz);
    positions.push(rx, p.y + height, rz);
  }

  for (let i = 0; i < steps; i++) {
    const a = i * 4;
    const b = (i + 1) * 4;
    // top face (top-left a+2, top-right a+3)
    indices.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2);
    // left wall (bottom-left a, top-left a+2)
    indices.push(a, a + 2, b, a + 2, b + 2, b);
    // right wall (bottom-right a+1, top-right a+3)
    indices.push(a + 1, b + 1, a + 3, a + 3, b + 1, b + 3);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

/**
 * Build the flat road ribbon and return the axis-aligned bounding-box
 * dimensions of the resulting vertices. Mirrors exactly what the renderer
 * produces (same {@link buildFlatRibbon} call).
 */
export function roadBoundingBox(
  curve: THREE.Curve<THREE.Vector3>,
  railWidth = 8,
  thickness = 0.02,
  steps = 160,
): RoadBoxSize {
  const geom = buildFlatRibbon(curve, railWidth, thickness, steps);
  geom.computeBoundingBox();
  const box = geom.boundingBox!;
  const size = new THREE.Vector3();
  box.getSize(size);
  geom.dispose();
  return { sizeX: size.x, sizeY: size.y, sizeZ: size.z };
}

/**
 * A road is "flat" when its vertical extent (sizeY) is small relative to its
 * horizontal footprint (the larger of sizeX/sizeZ). A correctly-laid road has
 * sizeY on the order of `thickness` plus any curve elevation change, while the
 * horizontal footprint spans the whole curve (hundreds of units). A broken,
 * vertically-standing road would have sizeY on the order of `railWidth`.
 *
 * @param ratio Maximum allowed sizeY / max(sizeX, sizeZ). Default 0.2 — well
 *   above the curve's own slope contribution but far below the ~1.0 a vertical
 *   ribbon would produce.
 */
export function isRoadFlat(
  curve: THREE.Curve<THREE.Vector3>,
  railWidth = 8,
  thickness = 0.02,
  steps = 160,
  ratio = 0.2,
): boolean {
  const { sizeX, sizeY, sizeZ } = roadBoundingBox(curve, railWidth, thickness, steps);
  const horizontal = Math.max(sizeX, sizeZ);
  if (horizontal === 0) return false;
  return sizeY / horizontal <= ratio;
}
