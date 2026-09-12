import type { Body, Vec3 } from '../types.ts';

export interface LagrangePoint {
  id: 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
  x: number;
  y: number;
  z: number;
}

/**
 * Circular restricted three-body collinear / triangular points.
 * PHYSICAL MODEL — instantaneous snapshot in the primary–secondary plane.
 * Valid for circular (or slowly varying) orbits; not a full CR3BP propagator.
 *
 * Works for Sun–Earth, Sun–Jupiter, Earth–Moon (μ up to ~0.012).
 */
export function calculateLagrangePoints(primary: Body, secondary: Body): LagrangePoint[] | null {
  const dx = secondary.x - primary.x;
  const dy = secondary.y - primary.y;
  const dz = secondary.z - primary.z;
  const d = Math.hypot(dx, dy, dz);
  if (!(d > 1e-12) || !(primary.mass > 0) || !(secondary.mass > 0)) return null;

  let m1 = primary.mass;
  let m2 = secondary.mass;
  let p1 = primary;
  let p2 = secondary;
  if (m2 > m1) {
    const tmpM = m1;
    m1 = m2;
    m2 = tmpM;
    p1 = secondary;
    p2 = primary;
  }
  const mu = m2 / (m1 + m2);
  if (!(mu > 0) || mu >= 0.5) return null;

  const rx = p2.x - p1.x;
  const ry = p2.y - p1.y;
  const rz = p2.z - p1.z;
  const dist = Math.hypot(rx, ry, rz);
  const ux = rx / dist;
  const uy = ry / dist;
  const uz = rz / dist;

  const x1 = collinearRoot(mu, 'L1');
  const x2 = collinearRoot(mu, 'L2');
  const x3 = collinearRoot(mu, 'L3');
  if (x1 == null || x2 == null || x3 == null) return null;

  const bary = {
    x: (m1 * p1.x + m2 * p2.x) / (m1 + m2),
    y: (m1 * p1.y + m2 * p2.y) / (m1 + m2),
    z: (m1 * p1.z + m2 * p2.z) / (m1 + m2),
  };

  // CRTBP x-axis is primary → secondary, origin at barycentre, unit = dist.
  const along = (xi: number): Vec3 => ({
    x: bary.x + ux * xi * dist,
    y: bary.y + uy * xi * dist,
    z: bary.z + uz * xi * dist,
  });

  // Perpendicular in the orbital plane: h × r, with h ≈ r × v if available.
  const vx = p2.vx - p1.vx;
  const vy = p2.vy - p1.vy;
  const vz = p2.vz - p1.vz;
  let hx = ry * vz - rz * vy;
  let hy = rz * vx - rx * vz;
  let hz = rx * vy - ry * vx;
  let hm = Math.hypot(hx, hy, hz);
  if (hm < 1e-18) {
    // Fall back to a vector not parallel to r (prefer +z).
    const fx = uy * 1 - uz * 0;
    const fy = uz * 0 - ux * 1;
    const fz = ux * 0 - uy * 0;
    hx = fy * uz - fz * uy;
    hy = fz * ux - fx * uz;
    hz = fx * uy - fy * ux;
    hm = Math.hypot(hx, hy, hz);
    if (hm < 1e-18) return null;
  }
  // unit in-plane perpendicular = (h × r) / (|h| |r|)
  const px = (hy * rz - hz * ry) / (hm * dist);
  const py = (hz * rx - hx * rz) / (hm * dist);
  const pz = (hx * ry - hy * rx) / (hm * dist);

  const L4x = 0.5 - mu;
  const L4y = Math.sqrt(3) / 2;

  const l1 = along(x1);
  const l2 = along(x2);
  const l3 = along(x3);
  const l4 = {
    x: bary.x + (ux * L4x + px * L4y) * dist,
    y: bary.y + (uy * L4x + py * L4y) * dist,
    z: bary.z + (uz * L4x + pz * L4y) * dist,
  };
  const l5 = {
    x: bary.x + (ux * L4x - px * L4y) * dist,
    y: bary.y + (uy * L4x - py * L4y) * dist,
    z: bary.z + (uz * L4x - pz * L4y) * dist,
  };

  return [
    { id: 'L1', ...l1 },
    { id: 'L2', ...l2 },
    { id: 'L3', ...l3 },
    { id: 'L4', ...l4 },
    { id: 'L5', ...l5 },
  ];
}

function fCollinear(x: number, mu: number): number {
  const d1 = x + mu;
  const d2 = x - 1 + mu;
  const s1 = d1 >= 0 ? 1 : -1;
  const s2 = d2 >= 0 ? 1 : -1;
  const t1 = (1 - mu) * s1 / (d1 * d1);
  const t2 = mu * s2 / (d2 * d2);
  return x - t1 - t2;
}

function dfCollinear(x: number, mu: number): number {
  const d1 = x + mu;
  const d2 = x - 1 + mu;
  const t1 = 2 * (1 - mu) / Math.abs(d1 * d1 * d1);
  const t2 = 2 * mu / Math.abs(d2 * d2 * d2);
  return 1 + t1 + t2;
}

function collinearRoot(mu: number, which: 'L1' | 'L2' | 'L3'): number | null {
  const rho = Math.cbrt(mu / 3);
  let x0: number;
  if (which === 'L1') x0 = 1 - mu - rho;
  else if (which === 'L2') x0 = 1 - mu + rho;
  else x0 = -1 - 5 * mu / 12;

  let x = x0;
  for (let i = 0; i < 40; i++) {
    const f = fCollinear(x, mu);
    const df = dfCollinear(x, mu);
    if (!Number.isFinite(f) || !Number.isFinite(df) || Math.abs(df) < 1e-18) return null;
    const nx = x - f / df;
    if (!Number.isFinite(nx)) return null;
    if (Math.abs(nx - x) < 1e-14) {
      x = nx;
      break;
    }
    x = nx;
  }
  return Number.isFinite(x) ? x : null;
}
