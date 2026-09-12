import { AU_M, AU_PER_YEAR_TO_KMS } from '../constants.ts';
import type { BodySpec } from '../types.ts';
import type { EphemerisIdentity, EphemerisState, EphemerisUnits } from './types.ts';

/**
 * Convert a normalized ephemeris Cartesian state into a BodySpec.
 * Engine-facing. No HTTP, no JPL query strings.
 *
 * Default units: AU and AU/year (engine native).
 * KM_S: position in km, velocity in km/s — typical Horizons VECTOR output.
 */
export function createBodyFromEphemeris(
  identity: EphemerisIdentity,
  state: EphemerisState,
  units: EphemerisUnits = 'AU_YEAR',
): BodySpec {
  let x = state.position.x;
  let y = state.position.y;
  let z = state.position.z;
  let vx = state.velocity.x;
  let vy = state.velocity.y;
  let vz = state.velocity.z;
  if (units === 'KM_S') {
    const kmPerAU = AU_M / 1000;
    x /= kmPerAU;
    y /= kmPerAU;
    z /= kmPerAU;
    vx /= AU_PER_YEAR_TO_KMS;
    vy /= AU_PER_YEAR_TO_KMS;
    vz /= AU_PER_YEAR_TO_KMS;
  }
  return {
    name: identity.name,
    key: identity.key,
    mass: identity.mass,
    physicalRadius: identity.physicalRadius,
    renderRadius: identity.renderRadius,
    color: identity.color,
    isStar: identity.isStar,
    isBlackHole: identity.isBlackHole,
    ring: identity.ring,
    noCollide: identity.noCollide,
    gravityMode: identity.gravityMode ?? 'massive',
    x,
    y,
    z,
    vx,
    vy,
    vz,
  };
}

export function applyEphemerisState(
  spec: BodySpec,
  state: EphemerisState,
  units: EphemerisUnits = 'AU_YEAR',
): BodySpec {
  const n = createBodyFromEphemeris(
    {
      name: spec.name,
      key: spec.key,
      mass: spec.mass,
      physicalRadius: spec.physicalRadius,
      renderRadius: spec.renderRadius,
      color: spec.color,
      isStar: spec.isStar,
      isBlackHole: spec.isBlackHole,
      ring: spec.ring,
      gravityMode: spec.gravityMode,
    },
    state,
    units,
  );
  return { ...spec, ...n };
}
