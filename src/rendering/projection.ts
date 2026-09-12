/**
 * Camera projection abstraction.
 *
 * Physics never depends on Canvas. The current renderer is an xy orthographic
 * projection of the 3D inertial state — a VISUAL APPROXIMATION.
 * A future Three.js / perspective camera implements the same interface.
 */

export interface WorldPoint3D {
  x: number;
  y: number;
  z: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
  /** World z, unused by the 2D canvas but reserved for depth sorting. */
  depth: number;
}

export interface CameraProjection {
  project(p: WorldPoint3D): ScreenPoint;
}

/** Orthographic drop of z. VISUAL APPROXIMATION. */
export function xyProjection(
  toScreen: (x: number, y: number) => readonly [number, number],
): CameraProjection {
  return {
    project(p: WorldPoint3D): ScreenPoint {
      const [x, y] = toScreen(p.x, p.y);
      return { x, y, depth: p.z };
    },
  };
}

/**
 * Placeholder for a future perspective camera. Not wired this round.
 * PHYSICAL MODEL is unchanged — this only maps world → screen.
 */
export function perspectiveProjection(
  toScreen: (x: number, y: number) => readonly [number, number],
  _opts?: { focal?: number; eyeZ?: number },
): CameraProjection {
  return xyProjection(toScreen);
}
