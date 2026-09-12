import { AU_M, G_SI, M_SUN_KG } from '../constants.ts';
import type { Body } from '../types.ts';
import { classicalElements } from './elements.ts';
import { isInsideRoche, rocheLimitAU } from './roche.ts';

export interface ScientificProperties {
  surfaceGravity: number | null;
  escapeVelocity: number | null;
  meanDensity: number | null;
  hillSphere: number | null;
  sphereOfInfluence: number | null;
  rocheFluid: number | null;
  rocheRigid: number | null;
  insideRoche: boolean;
}

/**
 * Derived body properties. PHYSICAL MODEL.
 * Returns null when a required input is missing — never invents a number.
 *
 * Units:
 *   surfaceGravity    m/s²     (SI G, kg, m)
 *   escapeVelocity    km/s
 *   meanDensity       kg/m³
 *   hillSphere        AU
 *   sphereOfInfluence AU
 *
 * Hill / SOI use osculating semi-major axis around `parent` if bound,
 * otherwise the current barycentric separation. That substitution is a
 * known approximation (see docs/PHYSICS_V2.md).
 */
export function scientificProperties(body: Body, parent: Body | undefined, G: number): ScientificProperties {
  const R = body.physicalRadius;
  const M = body.mass;
  const R_m = R * AU_M;
  const M_kg = M * M_SUN_KG;

  let surfaceGravity: number | null = null;
  let escapeVelocity: number | null = null;
  let meanDensity: number | null = null;

  if (R > 0 && M > 0 && Number.isFinite(R) && Number.isFinite(M)) {
    const g = (G_SI * M_kg) / (R_m * R_m);
    surfaceGravity = Number.isFinite(g) ? g : null;
    const vesc = Math.sqrt((2 * G_SI * M_kg) / R_m) / 1000;
    escapeVelocity = Number.isFinite(vesc) ? vesc : null;
    const vol = (4 / 3) * Math.PI * R_m * R_m * R_m;
    const rho = M_kg / vol;
    meanDensity = Number.isFinite(rho) && vol > 0 ? rho : null;
  }

  let hillSphere: number | null = null;
  let sphereOfInfluence: number | null = null;
  let rocheFluid: number | null = null;
  let rocheRigid: number | null = null;
  let insideRoche = false;
  if (parent && parent !== body && parent.mass > 0 && body.mass > 0) {
    const mu = G * (parent.mass + body.mass);
    const rel = {
      x: body.x - parent.x,
      y: body.y - parent.y,
      z: body.z - parent.z,
    };
    const vel = {
      x: body.vx - parent.vx,
      y: body.vy - parent.vy,
      z: body.vz - parent.vz,
    };
    const el = classicalElements(rel, vel, mu);
    const r = Math.hypot(rel.x, rel.y, rel.z);
    const a = el.a != null && el.a > 0 && !el.unbound ? el.a : r;
    if (a > 0 && Number.isFinite(a)) {
      const q = body.mass / parent.mass;
      const rh = a * Math.cbrt(q / 3);
      const soi = a * Math.pow(q, 0.4);
      hillSphere = Number.isFinite(rh) ? rh : null;
      sphereOfInfluence = Number.isFinite(soi) ? soi : null;
    }
    rocheFluid = rocheLimitAU(parent, body, 'fluid');
    rocheRigid = rocheLimitAU(parent, body, 'rigid');
    insideRoche = isInsideRoche(parent, body, 'fluid');
  }

  return { surfaceGravity, escapeVelocity, meanDensity, hillSphere, sphereOfInfluence, rocheFluid, rocheRigid, insideRoche };
}

/** Convenience: Hill sphere in AU, or null. */
export function hillSphereAU(body: Body, parent: Body, G: number): number | null {
  return scientificProperties(body, parent, G).hillSphere;
}

/** Convenience: SOI in AU, or null. */
export function sphereOfInfluenceAU(body: Body, parent: Body, G: number): number | null {
  return scientificProperties(body, parent, G).sphereOfInfluence;
}

/** Convert AU to km. */
export function auToKm(au: number): number {
  return au * AU_M / 1000;
}


