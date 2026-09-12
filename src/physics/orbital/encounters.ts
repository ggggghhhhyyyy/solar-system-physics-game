import { isMassiveBody, isTestParticle } from '../body/semantics.ts';
import { SpatialHash3D } from '../spatial/hash3d.ts';
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
  /** Always true for this model. UI must show LINEAR APPROX. */
  linearApprox: true;
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
    linearApprox: true,
  };
}

function relevantForGlobal(b: Body): boolean {
  return isMassiveBody(b) || !!b.userLaunched;
}

/**
 * Closest pair.
 *
 * Selected mode: selected vs all relevant — O(N).
 * Global mode: massive + user-launched only. Spatial hash when N is large.
 * Never a 100k-tracer O(N²) sweep.
 */
export function closestEncounter(bodies: Body[], selectedId: number | null): EncounterReport | null {
  if (bodies.length < 2) return null;
  if (selectedId != null) {
    const sel = bodies.find((b) => b.id === selectedId);
    if (!sel) return null;
    let best: EncounterReport | null = null;
    for (const b of bodies) {
      if (b === sel) continue;
      if (isTestParticle(sel) && isTestParticle(b) && !b.userLaunched && !sel.userLaunched) continue;
      const rep = pairReport(sel, b);
      if (!best || rep.separationAU < best.separationAU) best = rep;
    }
    return best;
  }

  const candidates: Body[] = [];
  const indexOf = new Map<number, number>();
  for (const b of bodies) {
    if (!relevantForGlobal(b)) continue;
    indexOf.set(b.id, candidates.length);
    candidates.push(b);
  }
  if (candidates.length < 2) return null;

  if (candidates.length <= 64) {
    let best: EncounterReport | null = null;
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const rep = pairReport(candidates[i], candidates[j]);
        if (!best || rep.separationAU < best.separationAU) best = rep;
      }
    }
    return best;
  }

  let maxR = 0;
  for (const b of candidates) {
    const r = Math.max(b.collisionRadius, b.physicalRadius, 1e-4);
    if (r > maxR) maxR = r;
  }
  const cell = Math.max(maxR * 8, 0.05);
  const hash = new SpatialHash3D(cell);
  for (let i = 0; i < candidates.length; i++) {
    const b = candidates[i];
    hash.insert(i, b.x, b.y, b.z);
  }
  let best: EncounterReport | null = null;
  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[i];
    const neigh = hash.queryCellNeighbors(a.x, a.y, a.z);
    for (const j of neigh) {
      if (j <= i) continue;
      const rep = pairReport(a, candidates[j]);
      if (!best || rep.separationAU < best.separationAU) best = rep;
    }
  }
  return best;
}

/** Roche/TDE candidate: massive primary vs finite-size secondary. No tracer↔tracer. */
export function isTideCandidate(a: Body, b: Body): boolean {
  if (isTestParticle(a) && isTestParticle(b)) return false;
  const primary = a.mass >= b.mass ? a : b;
  const sat = primary === a ? b : a;
  if (!isMassiveBody(primary)) return false;
  if (!(sat.mass > 0) || sat.isBlackHole) return false;
  if (!(sat.physicalRadius > 0)) return false;
  if (isTestParticle(sat) && sat.noCollide && !sat.userLaunched) return false;
  return true;
}
