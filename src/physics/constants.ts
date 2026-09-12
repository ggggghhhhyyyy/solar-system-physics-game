/**
 * Canonical units for the physics engine.
 *
 * Two gravitational-parameter systems exist. They are NOT silently mixed.
 *
 * GAME / Gaussian (default presets):
 *   G0 = 4π² AU³ M☉⁻¹ yr⁻²
 *   A circular 1 AU orbit around 1 M☉ has P = 1 yr exactly.
 *   GAMEPLAY / pedagogical unit choice.
 *
 * SCIENCE / DE440:
 *   μ☉ from DE440 GM_sun converted to AU³ / yr² (Julian year).
 *   Used when ingesting Horizons / DE441 state vectors so dynamics
 *   and masses share one constant system.
 *
 * Relative difference is ~3.8e-5. Documented, not hidden.
 */

export type ConstantsSet = 'gaussian' | 'de440';

export interface PhysicsConstants {
  /** Gravitational parameter of 1 M☉ in AU³ / yr². */
  muSun: number;
  id: ConstantsSet;
  label: string;
}

/** Astronomical unit in metres (IAU 2012 exact). */
export const AU_M = 149_597_870_700;

export const DAYS_PER_YEAR = 365.25;

/** Julian year in seconds. */
export const YEAR_S = DAYS_PER_YEAR * 86_400;

/** Solar mass in kg (IAU 2015 conventional). Used only for SI derived props. */
export const M_SUN_KG = 1.988_47e30;

/** Newtonian G (SI). Used only for derived scientific properties. */
export const G_SI = 6.674_30e-11;

/** Speed of light (m/s). */
export const C_SI = 299_792_458;

/**
 * DE440 GM_sun in km³/s².
 * Source: JPL DE440, GM_sun = 132712440041.279419 km³ s⁻²
 * (same value used to form catalog mass ratios GM/GM☉).
 */
export const GM_SUN_KM3_S2 = 132_712_440_041.279419;

const AU_KM = AU_M / 1000;

/** DE440 μ☉ in engine units (AU³ / yr²). PHYSICAL MODEL for SCIENCE / JPL. */
export const GM_SUN_AU3_YR2 =
  (GM_SUN_KM3_S2 * YEAR_S * YEAR_S) / (AU_KM * AU_KM * AU_KM);

/** Gaussian gravitational parameter. GAME / pedagogical. */
export const G0 = 4 * Math.PI * Math.PI;

export const GAUSSIAN_CONSTANTS: PhysicsConstants = {
  id: 'gaussian',
  muSun: G0,
  label: 'Gaussian G = 4π² (1 AU / 1 M☉ / 1 yr)',
};

export const DE440_CONSTANTS: PhysicsConstants = {
  id: 'de440',
  muSun: GM_SUN_AU3_YR2,
  label: 'DE440 μ☉ (AU³/yr², Julian year)',
};

export function constantsById(id: ConstantsSet | undefined): PhysicsConstants {
  return id === 'de440' ? DE440_CONSTANTS : GAUSSIAN_CONSTANTS;
}

/** Earth mass in solar masses (engine mass unit). */
export const M_EARTH = 3.003_489e-6;

/** Solar radius in AU. PHYSICAL MODEL. */
export const R_SUN_AU = 6.957e8 / AU_M;

/** Schwarzschild radius of 1 M☉ in AU. PHYSICAL MODEL. Rs = 2GM/c². */
export const R_SCHWARZSCHILD_SUN_AU = (2 * G_SI * M_SUN_KG) / (C_SI * C_SI) / AU_M;

/** 1 AU/year in km/s. */
export const AU_PER_YEAR_TO_KMS = AU_M / YEAR_S / 1000;

export const TRAIL_MAX = 600;

/** Small-N / large-N switch. Empirically ~100–200; keep existing 150. */
export const BH_THRESHOLD = 150;
export const GRID_THRESHOLD = 150;
export const BH_THETA = 0.7;

export const HASH_X = 73856093;
export const HASH_Y = 19349663;
export const HASH_Z = 83492791;
export const GRID_MIN = 1e-4;

/**
 * Named-body physical radii (AU). PHYSICAL MODEL — mean volumetric radii.
 * Source: NASA / IAU nominal values. Do not use these for on-screen size.
 */
export const PHYSICAL_RADIUS_AU: Record<string, number> = {
  sun: R_SUN_AU,
  mercury: 2_439.7e3 / AU_M,
  venus: 6_051.8e3 / AU_M,
  earth: 6_371.0e3 / AU_M,
  moon: 1_737.4e3 / AU_M,
  mars: 3_389.5e3 / AU_M,
  jupiter: 69_911e3 / AU_M,
  saturn: 58_232e3 / AU_M,
  uranus: 25_362e3 / AU_M,
  neptune: 24_622e3 / AU_M,
  pluto: 1_188.3e3 / AU_M,
  io: 1_821.6e3 / AU_M,
  europa: 1_560.8e3 / AU_M,
  ganymede: 2_634.1e3 / AU_M,
  callisto: 2_410.3e3 / AU_M,
  mimas: 198.2e3 / AU_M,
  enceladus: 252.1e3 / AU_M,
  tethys: 531.0e3 / AU_M,
  dione: 561.4e3 / AU_M,
  rhea: 763.8e3 / AU_M,
  titan: 2_574.7e3 / AU_M,
  ariel: 578.9e3 / AU_M,
  umbriel: 584.7e3 / AU_M,
  titania: 788.9e3 / AU_M,
  oberon: 761.4e3 / AU_M,
  triton: 1_353.4e3 / AU_M,
  proteus: 210e3 / AU_M,
  charon: 606.0e3 / AU_M,
  phobos: 11.27e3 / AU_M,
  deimos: 6.2e3 / AU_M,
  eris: 1_163e3 / AU_M,
  haumea: 780e3 / AU_M,
  makemake: 715e3 / AU_M,
  trappist1: 0.119 * R_SUN_AU,
};

/**
 * Game-preset clock origin. UTC civil date — NOT the DE441 TDB cache epoch.
 * Do not suffix TDB calendars with Z.
 */
export const DEFAULT_EPOCH_UTC = '2026-09-11T00:00:00Z';
/** @deprecated Use DEFAULT_EPOCH_UTC. Kept so older imports compile. */
export const DEFAULT_EPOCH = DEFAULT_EPOCH_UTC;
