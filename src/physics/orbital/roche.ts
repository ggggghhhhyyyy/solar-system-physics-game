import type { Body } from '../types.ts';

/**
 * Roche limit and tidal-disruption radius. PHYSICAL MODEL.
 *
 * Mass form, valid for finite-size primaries AND black holes
 * (never use density of a Schwarzschild sphere):
 *
 *   d = k * R_sat * (M_primary / M_sat)^{1/3}
 *
 * k = 2^{1/3} ≈ 1.26  rigid rubble pile
 * k = 2.44            classical incompressible fluid (Roche 1849)
 *
 * Equivalent to k * R_primary * (ρ_primary / ρ_sat)^{1/3} when the
 * primary has a well-defined volume. That substitution is invalid for BH.
 *
 * TDE: a star/planet is tidally disrupted by a black hole when r < d_fluid
 * AND r > R_s. We detect and report. We do NOT fragment the body — that
 * would be a fake hydro model.
 */

/** Classical fluid Roche coefficient. PHYSICAL MODEL. */
export const ROCHE_FLUID_K = 2.44;

/** Rigid Roche coefficient 2^{1/3}. PHYSICAL MODEL. */
export const ROCHE_RIGID_K = Math.cbrt(2);

export type RocheKind = 'rigid' | 'fluid';

export function rocheCoefficient(kind: RocheKind): number {
  return kind === 'fluid' ? ROCHE_FLUID_K : ROCHE_RIGID_K;
}

/**
 * Roche / tidal radius in AU. Null if either mass or satellite radius is missing.
 * `primary` is the heavier / disrupting body.
 */
export function rocheLimitAU(
  primary: { mass: number; isBlackHole?: boolean },
  satellite: { mass: number; physicalRadius: number },
  kind: RocheKind = 'fluid',
): number | null {
  if (!(primary.mass > 0) || !(satellite.mass > 0)) return null;
  if (!(satellite.physicalRadius > 0)) return null;
  const d = rocheCoefficient(kind) * satellite.physicalRadius * Math.cbrt(primary.mass / satellite.mass);
  return Number.isFinite(d) && d > 0 ? d : null;
}

export function pairRoche(
  a: { mass: number; physicalRadius: number; isBlackHole?: boolean },
  b: { mass: number; physicalRadius: number; isBlackHole?: boolean },
  kind: RocheKind = 'fluid',
): { primary: 'a' | 'b'; limit: number } | null {
  if (a.mass >= b.mass) {
    const limit = rocheLimitAU(a, b, kind);
    return limit == null ? null : { primary: 'a', limit };
  }
  const limit = rocheLimitAU(b, a, kind);
  return limit == null ? null : { primary: 'b', limit };
}

export function isInsideRoche(
  primary: { mass: number; x: number; y: number; z?: number; isBlackHole?: boolean },
  satellite: { mass: number; physicalRadius: number; x: number; y: number; z?: number },
  kind: RocheKind = 'fluid',
): boolean {
  const d = rocheLimitAU(primary, satellite, kind);
  if (d == null) return false;
  const r = Math.hypot(
    satellite.x - primary.x,
    satellite.y - primary.y,
    (satellite.z ?? 0) - (primary.z ?? 0),
  );
  return r < d;
}

/** TDE: BH primary, satellite inside fluid Roche, outside the horizon. */
export function isTidalDisruption(
  primary: Body,
  satellite: Body,
): { inside: boolean; rocheAU: number | null; separationAU: number } {
  const separationAU = Math.hypot(
    satellite.x - primary.x,
    satellite.y - primary.y,
    satellite.z - primary.z,
  );
  const rocheAU = rocheLimitAU(primary, satellite, 'fluid');
  const inside =
    !!primary.isBlackHole &&
    !satellite.isBlackHole &&
    rocheAU != null &&
    separationAU < rocheAU &&
    separationAU > primary.physicalRadius;
  return { inside, rocheAU, separationAU };
}
