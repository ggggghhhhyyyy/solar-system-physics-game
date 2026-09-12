import type { Body, ReferenceFrameKind, StateVector } from '../types.ts';

export interface ReferenceFrame {
  kind: ReferenceFrameKind;
  /** For body-centric, the reference body id. */
  bodyId?: number | null;
  label: string;
}

export const BARYCENTRIC: ReferenceFrame = { kind: 'barycentric', label: 'Barycentric' };
export const HELIOCENTRIC: ReferenceFrame = { kind: 'heliocentric', label: 'Heliocentric' };

export function bodyCentric(body: Body): ReferenceFrame {
  return { kind: 'body-centric', bodyId: body.id, label: `${body.name}-centric` };
}

export interface FrameOrigin {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

/**
 * System barycentre (mass-weighted). Test particles contribute if they have mass,
 * which they typically do at trace level; their effect is negligible.
 * PHYSICAL MODEL. The engine never assumes the Sun sits at the origin.
 */
export function barycenter(bodies: readonly Body[]): FrameOrigin {
  let m = 0;
  let x = 0;
  let y = 0;
  let z = 0;
  let px = 0;
  let py = 0;
  let pz = 0;
  for (const b of bodies) {
    if (!(b.mass > 0)) continue;
    m += b.mass;
    x += b.mass * b.x;
    y += b.mass * b.y;
    z += b.mass * b.z;
    px += b.mass * b.vx;
    py += b.mass * b.vy;
    pz += b.mass * b.vz;
  }
  if (!(m > 0)) return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  return { x: x / m, y: y / m, z: z / m, vx: px / m, vy: py / m, vz: pz / m };
}

export function heaviestStar(bodies: readonly Body[]): Body | undefined {
  let best: Body | undefined;
  for (const b of bodies) {
    if (b.isBlackHole) continue;
    if (!b.isStar && b.mass < 0.05) continue;
    if (!best || b.mass > best.mass) best = b;
  }
  if (best) return best;
  for (const b of bodies) if (!best || b.mass > best.mass) best = b;
  return best;
}

export function resolveOrigin(bodies: readonly Body[], frame: ReferenceFrame): FrameOrigin {
  if (frame.kind === 'barycentric') return barycenter(bodies);
  if (frame.kind === 'heliocentric') {
    const star = heaviestStar(bodies);
    if (!star) return barycenter(bodies);
    return { x: star.x, y: star.y, z: star.z, vx: star.vx, vy: star.vy, vz: star.vz };
  }
  const id = frame.bodyId;
  const b = id == null ? undefined : bodies.find((x) => x.id === id);
  if (!b) return barycenter(bodies);
  return { x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz };
}

/**
 * State of `body` relative to a reference. The reference may be another body,
 * the system barycentre, or the heaviest star (heliocentric).
 */
export function getRelativeState(
  body: Body,
  reference: Body | 'barycentric' | 'heliocentric' | ReferenceFrame,
  bodies?: readonly Body[],
): StateVector {
  let o: FrameOrigin;
  if (reference === 'barycentric') {
    o = barycenter(bodies ?? [body]);
  } else if (reference === 'heliocentric') {
    o = resolveOrigin(bodies ?? [body], HELIOCENTRIC);
  } else if ('kind' in reference) {
    o = resolveOrigin(bodies ?? [body], reference);
  } else {
    o = { x: reference.x, y: reference.y, z: reference.z, vx: reference.vx, vy: reference.vy, vz: reference.vz };
  }
  return {
    x: body.x - o.x,
    y: body.y - o.y,
    z: body.z - o.z,
    vx: body.vx - o.vx,
    vy: body.vy - o.vy,
    vz: body.vz - o.vz,
  };
}
