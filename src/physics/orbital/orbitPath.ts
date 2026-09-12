/**
 * Sample a 3D osculating Keplerian orbit from classical elements.
 * VISUALIZATION of a PHYSICAL MODEL (two-body osculating elements).
 *
 * Do not rebuild a 2D xy ellipse from (rx, ry, rvx, rvy).
 */

import type { WorldPoint3D } from '../../rendering/projection.ts';
import { stateFromElements, type ClassicalElements } from './elements.ts';

export interface OrbitSample {
  points: WorldPoint3D[];
  kind: ClassicalElements['kind'];
  unbound: boolean;
}

export function sampleOsculatingOrbit(
  el: ClassicalElements,
  mu: number,
  origin: WorldPoint3D,
  samples = 160,
): OrbitSample {
  if (el.unbound || el.a == null || !(el.a > 0) || el.e >= 0.999 || !(mu > 0)) {
    return { points: [], kind: el.kind, unbound: true };
  }
  const points: WorldPoint3D[] = [];
  const n = Math.max(16, samples);
  for (let k = 0; k <= n; k++) {
    const nu = (k / n) * Math.PI * 2;
    const st = stateFromElements(el.a, el.e, el.i, el.Omega, el.omega, nu, mu);
    points.push({
      x: origin.x + st.x,
      y: origin.y + st.y,
      z: origin.z + st.z,
    });
  }
  return { points, kind: el.kind, unbound: false };
}
