import type { Body } from '../types.ts';
import { pairRoche, type RocheKind } from './roche.ts';

/**
 * Close-approach geometry. The time-of-closest-approach is a LINEAR
 * (constant-velocity) approximation — PHYSICAL APPROXIMATION, not a
 * two-body Kepler solve. Use it as a short-horizon warning, not an ephemeris.
 */

export interface EncounterReport {
  aId: number;
  bId: number;
  aName: string;
  bName: string;
  separationAU: number;
  vRelAUY: number;
  /** Years until linear closest approach. Negative = already passed. */
  tCA: number | null;
  rCA: number;
  approaching: boolean;
  rocheAU: number | null;
  insideRoche: boolean;
  tidalDisruption: boolean;
}

export function linearClosestApproach(
  rx: number,
  ry: number,
  rz: number,
  vx: number,
  vy: number,
  vz: number,
): { tCA: number | null; rCA: number; approaching: boolean } {
  const r2 = rx * rx + ry * ry + rz * rz;
  const v2 = vx * vx + vy * vy + vz * vz;
  const rv = rx * vx + ry * vy + rz * vz;
  const r = Math.sqrt(r2);
  const approaching = rv < 0;
  if (!(v2 > 1e-30)) return { tCA: null, rCA: r, approaching: false };
  const tCA = -rv / v2;
  const cx = rx + vx * tCA;
  const cy = ry + vy * tCA;
  const cz = rz + vz * tCA;
  const rCA = Math.hypot(cx, cy, cz);
  return { tCA, rCA, approaching };
}

function pairReport(a: Body, b: Body, kind: RocheKind = 'fluid'): EncounterReport {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const rz = b.z - a.z;
  const vx = b.vx - a.vx;
  const vy = b.vy - a.vy;
  const vz = b.vz - a.vz;
  const ca = linearClosestApproach(rx, ry, rz, vx, vy, vz);
  const roche = pairRoche(a, b, kind);
  const separationAU = Math.hypot(rx, ry, rz);
  const primaryIsBH = (roche?.primary === 'a' ? a : b).isBlackHole;
  const secondaryIsBH = (roche?.primary === 'a' ? b : a).isBlackHole;
  const insideRoche = roche != null && separationAU < roche.limit;
  return {
    aId: a.id,
    bId: b.id,
    aName: a.name,
    bName: b.name,
    separationAU,
    vRelAUY: Math.hypot(vx, vy, vz),
    tCA: ca.tCA,
    rCA: ca.rCA,
    approaching: ca.approaching,
    rocheAU: roche?.limit ?? null,
    insideRoche,
    tidalDisruption: insideRoche && !!primaryIsBH && !secondaryIsBH,
  };
}

/**
 * Closest pair. If `selectedId` is set, closest other body to that one.
 * Otherwise the globally closest pair (any gravityMode).
 */
export function closestEncounter(bodies: Body[], selectedId: number | null): EncounterReport | null {
  if (bodies.length < 2) return null;
  if (selectedId != null) {
    const sel = bodies.find((b) => b.id === selectedId);
    if (!sel) return null;
    let best: EncounterReport | null = null;
    for (const b of bodies) {
      if (b === sel) continue;
      const rep = pairReport(sel, b);
      if (!best || rep.separationAU < best.separationAU) best = rep;
    }
    return best;
  }
  let best: EncounterReport | null = null;
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const rep = pairReport(bodies[i], bodies[j]);
      if (!best || rep.separationAU < best.separationAU) best = rep;
    }
  }
  return best;
}
