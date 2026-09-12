import { isMassiveBody } from '../body/semantics.ts';
import type { Body } from '../types.ts';

export interface ConservationSnapshot {
  kinetic: number;
  potential: number;
  totalEnergy: number;
  px: number;
  py: number;
  pz: number;
  pMag: number;
  comX: number;
  comY: number;
  comZ: number;
  comMag: number;
  lx: number;
  ly: number;
  lz: number;
  lMag: number;
}

export interface DriftReport {
  current: ConservationSnapshot;
  baseline: ConservationSnapshot | null;
  /** ΔE / E0. Null if |E0| is tiny. */
  energyDrift: number | null;
  /** |ΔP|. */
  momentumDrift: number | null;
  /** ΔL / L0. */
  angularDrift: number | null;
  /** |ΔCOM| in AU. */
  comDrift: number | null;
}

/**
 * Drift colour bands. Defined here — UI must not hardcode thresholds.
 * green = stable, amber = watch, red = serious.
 */
export const DRIFT_THRESHOLDS = {
  energy: { green: 1e-6, amber: 1e-3 },
  momentum: { green: 1e-9, amber: 1e-6 },
  angular: { green: 1e-6, amber: 1e-3 },
  com: { green: 1e-8, amber: 1e-5 },
} as const;

export type DriftLevel = 'green' | 'amber' | 'red';

export function driftLevel(
  value: number | null,
  kind: keyof typeof DRIFT_THRESHOLDS,
): DriftLevel {
  if (value == null || !Number.isFinite(value)) return 'red';
  const a = Math.abs(value);
  const t = DRIFT_THRESHOLDS[kind];
  if (a <= t.green) return 'green';
  if (a <= t.amber) return 'amber';
  return 'red';
}

/**
 * Newtonian kinetic + pairwise potential of massive bodies.
 * Test particles are excluded from the conserved totals (they do not back-react,
 * so including them would make E/P/L appear to drift). PHYSICAL MODEL.
 */
export function computeConservation(bodies: readonly Body[], G: number, softening: number): ConservationSnapshot {
  const massive = bodies.filter(isMassiveBody);
  const n = massive.length;
  const eps2 = softening * softening;

  let kinetic = 0;
  let px = 0;
  let py = 0;
  let pz = 0;
  let mTot = 0;
  let comX = 0;
  let comY = 0;
  let comZ = 0;
  let lx = 0;
  let ly = 0;
  let lz = 0;

  for (const b of massive) {
    const v2 = b.vx * b.vx + b.vy * b.vy + b.vz * b.vz;
    kinetic += 0.5 * b.mass * v2;
    px += b.mass * b.vx;
    py += b.mass * b.vy;
    pz += b.mass * b.vz;
    mTot += b.mass;
    comX += b.mass * b.x;
    comY += b.mass * b.y;
    comZ += b.mass * b.z;
    lx += b.mass * (b.y * b.vz - b.z * b.vy);
    ly += b.mass * (b.z * b.vx - b.x * b.vz);
    lz += b.mass * (b.x * b.vy - b.y * b.vx);
  }
  if (mTot > 0) {
    comX /= mTot;
    comY /= mTot;
    comZ /= mTot;
  }

  let potential = 0;
  for (let i = 0; i < n; i++) {
    const a = massive[i];
    for (let j = i + 1; j < n; j++) {
      const b = massive[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dz = a.z - b.z;
      const r = Math.sqrt(dx * dx + dy * dy + dz * dz + eps2);
      if (r > 0) potential -= (G * a.mass * b.mass) / r;
    }
  }

  const pMag = Math.hypot(px, py, pz);
  const lMag = Math.hypot(lx, ly, lz);
  const comMag = Math.hypot(comX, comY, comZ);
  const totalEnergy = kinetic + potential;

  return {
    kinetic,
    potential,
    totalEnergy,
    px,
    py,
    pz,
    pMag,
    comX,
    comY,
    comZ,
    comMag,
    lx,
    ly,
    lz,
    lMag,
  };
}

export function computeDrift(
  current: ConservationSnapshot,
  baseline: ConservationSnapshot | null,
): DriftReport {
  if (!baseline) {
    return {
      current,
      baseline: null,
      energyDrift: null,
      momentumDrift: null,
      angularDrift: null,
      comDrift: null,
    };
  }
  const e0 = baseline.totalEnergy;
  const energyDrift = Math.abs(e0) > 1e-18 ? (current.totalEnergy - e0) / e0 : null;
  const dpx = current.px - baseline.px;
  const dpy = current.py - baseline.py;
  const dpz = current.pz - baseline.pz;
  const momentumDrift = Math.hypot(dpx, dpy, dpz);
  const l0 = baseline.lMag;
  const dlx = current.lx - baseline.lx;
  const dly = current.ly - baseline.ly;
  const dlz = current.lz - baseline.lz;
  const angularDrift = l0 > 1e-18 ? Math.hypot(dlx, dly, dlz) / l0 : null;
  const comDrift = Math.hypot(
    current.comX - baseline.comX,
    current.comY - baseline.comY,
    current.comZ - baseline.comZ,
  );
  return { current, baseline, energyDrift, momentumDrift, angularDrift, comDrift };
}
