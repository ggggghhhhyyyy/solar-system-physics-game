/**
 * JPL "Keplerian Elements for Approximate Positions of the Major Planets"
 * https://ssd.jpl.nasa.gov/planets/approx_pos.html
 *
 * PHYSICAL APPROXIMATION — two-body heliocentric, ecliptic J2000.
 * Table 1 is valid 1800–2050 AD (~1 arcmin inner planets).
 * Table 2 + extra terms cover 3000 BC–3000 AD at lower accuracy.
 * Earth row is the Earth–Moon barycentre, not the geocenter.
 * No Moon, no spacecraft — those need Horizons.
 */
import { G0 } from '../constants.ts';
import { stateFromElements } from '../orbital/elements.ts';
import type { BodySpec } from '../types.ts';
import { catalogByKey, KEPLERIAN_KEYS } from './catalog.ts';
import { createBodyFromEphemeris } from './normalize.ts';
import type { EphemerisState, LoadedSolarSystem } from './types.ts';

interface ElemRow {
  key: string;
  a0: number;
  adot: number;
  e0: number;
  edot: number;
  I0: number;
  Idot: number;
  L0: number;
  Ldot: number;
  varpi0: number;
  varpidot: number;
  Omega0: number;
  Omegadot: number;
  b?: number;
  c?: number;
  s?: number;
  f?: number;
}

/** Table 1: 1800–2050. a AU, e dimensionless, angles deg, rates / century. */
const TABLE1: ElemRow[] = [
  { key: 'mercury', a0: 0.38709927, adot: 0.00000037, e0: 0.20563593, edot: 0.00001906, I0: 7.00497902, Idot: -0.00594749, L0: 252.25032350, Ldot: 149472.67411175, varpi0: 77.45779628, varpidot: 0.16047689, Omega0: 48.33076593, Omegadot: -0.12534081 },
  { key: 'venus', a0: 0.72333566, adot: 0.00000390, e0: 0.00677672, edot: -0.00004107, I0: 3.39467605, Idot: -0.00078890, L0: 181.97909950, Ldot: 58517.81538729, varpi0: 131.60246718, varpidot: 0.00268329, Omega0: 76.67984255, Omegadot: -0.27769418 },
  { key: 'earth', a0: 1.00000261, adot: 0.00000562, e0: 0.01671123, edot: -0.00004392, I0: -0.00001531, Idot: -0.01294668, L0: 100.46457166, Ldot: 35999.37244981, varpi0: 102.93768193, varpidot: 0.32327364, Omega0: 0.0, Omegadot: 0.0 },
  { key: 'mars', a0: 1.52371034, adot: 0.00001847, e0: 0.09339410, edot: 0.00007882, I0: 1.84969142, Idot: -0.00813131, L0: -4.55343205, Ldot: 19140.30268499, varpi0: -23.94362959, varpidot: 0.44441088, Omega0: 49.55953891, Omegadot: -0.29257343 },
  { key: 'jupiter', a0: 5.20288700, adot: -0.00011607, e0: 0.04838624, edot: -0.00013253, I0: 1.30439695, Idot: -0.00183714, L0: 34.39644051, Ldot: 3034.74612775, varpi0: 14.72847983, varpidot: 0.21252668, Omega0: 100.47390909, Omegadot: 0.20469106 },
  { key: 'saturn', a0: 9.53667594, adot: -0.00125060, e0: 0.05386179, edot: -0.00050991, I0: 2.48599187, Idot: 0.00193609, L0: 49.95424423, Ldot: 1222.49362201, varpi0: 92.59887831, varpidot: -0.41897216, Omega0: 113.66242448, Omegadot: -0.28867794 },
  { key: 'uranus', a0: 19.18916464, adot: -0.00196176, e0: 0.04725744, edot: -0.00004397, I0: 0.77263783, Idot: -0.00242939, L0: 313.23810451, Ldot: 428.48202785, varpi0: 170.95427630, varpidot: 0.40805281, Omega0: 74.01692503, Omegadot: 0.04240589 },
  { key: 'neptune', a0: 30.06992276, adot: 0.00026291, e0: 0.00859048, edot: 0.00005105, I0: 1.77004347, Idot: 0.00035372, L0: -55.12002969, Ldot: 218.45945325, varpi0: 44.96476227, varpidot: -0.32241464, Omega0: 131.78422574, Omegadot: -0.00508664 },
];

const TABLE2: ElemRow[] = [
  { key: 'mercury', a0: 0.38709843, adot: 0.00000000, e0: 0.20563661, edot: 0.00002123, I0: 7.00559432, Idot: -0.00590158, L0: 252.25166724, Ldot: 149472.67486623, varpi0: 77.45771895, varpidot: 0.15940013, Omega0: 48.33961819, Omegadot: -0.12214182 },
  { key: 'venus', a0: 0.72332102, adot: -0.00000026, e0: 0.00676399, edot: -0.00005107, I0: 3.39777545, Idot: 0.00043494, L0: 181.97970850, Ldot: 58517.81560260, varpi0: 131.76755713, varpidot: 0.05679648, Omega0: 76.67261496, Omegadot: -0.27274174 },
  { key: 'earth', a0: 1.00000018, adot: -0.00000003, e0: 0.01673163, edot: -0.00003661, I0: -0.00054346, Idot: -0.01337178, L0: 100.46691572, Ldot: 35999.37306329, varpi0: 102.93005885, varpidot: 0.31795260, Omega0: -5.11260389, Omegadot: -0.24123856 },
  { key: 'mars', a0: 1.52371243, adot: 0.00000097, e0: 0.09336511, edot: 0.00009149, I0: 1.85181869, Idot: -0.00724757, L0: -4.56813164, Ldot: 19140.29934243, varpi0: -23.91744784, varpidot: 0.45223625, Omega0: 49.71320984, Omegadot: -0.26852431 },
  { key: 'jupiter', a0: 5.20248019, adot: -0.00002864, e0: 0.04853590, edot: 0.00018026, I0: 1.29861416, Idot: -0.00322699, L0: 34.33479152, Ldot: 3034.90371757, varpi0: 14.27495244, varpidot: 0.18199196, Omega0: 100.29282654, Omegadot: 0.13024619, b: -0.00012452, c: 0.06064060, s: -0.35635438, f: 38.35125000 },
  { key: 'saturn', a0: 9.54149883, adot: -0.00003065, e0: 0.05550825, edot: -0.00032044, I0: 2.49424102, Idot: 0.00451969, L0: 50.07571329, Ldot: 1222.11494724, varpi0: 92.86136063, varpidot: 0.54179478, Omega0: 113.63998702, Omegadot: -0.25015002, b: 0.00025899, c: -0.13434469, s: 0.87320147, f: 38.35125000 },
  { key: 'uranus', a0: 19.18797948, adot: -0.00020455, e0: 0.04685740, edot: -0.00001550, I0: 0.77298127, Idot: -0.00180155, L0: 314.20276625, Ldot: 428.49512595, varpi0: 172.43404441, varpidot: 0.09266985, Omega0: 73.96250215, Omegadot: 0.05739699, b: 0.00058331, c: -0.97731848, s: 0.17689245, f: 7.67025000 },
  { key: 'neptune', a0: 30.06952752, adot: 0.00006447, e0: 0.00895439, edot: 0.00000818, I0: 1.77005520, Idot: 0.00022400, L0: 304.22289287, Ldot: 218.46515314, varpi0: 46.68158724, varpidot: 0.01009938, Omega0: 131.78635853, Omegadot: -0.00606302, b: -0.00041348, c: 0.68346318, s: -0.10162547, f: 7.67025000 },
];

const DEG = Math.PI / 180;
const J2000 = 2451545.0;

export function julianDateUTC(iso: string): number {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new Error(`invalid epoch ${iso}`);
  return ms / 86400000 + 2440587.5;
}

function wrap360(x: number): number {
  let t = x % 360;
  if (t < 0) t += 360;
  return t;
}

function wrap180(x: number): number {
  let t = wrap360(x);
  if (t > 180) t -= 360;
  return t;
}

/** Kepler's equation M = E − e sin E, angles in radians. */
export function eccentricAnomaly(M: number, e: number): number {
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 40; i++) {
    const dE = (M - (E - e * Math.sin(E))) / (1 - e * Math.cos(E));
    E += dE;
    if (Math.abs(dE) < 1e-14) break;
  }
  return E;
}

export function trueAnomalyFromE(E: number, e: number): number {
  return Math.atan2(Math.sqrt(Math.max(0, 1 - e * e)) * Math.sin(E), Math.cos(E) - e);
}

function heliocentricState(row: ElemRow, T: number): { x: number; y: number; z: number; vx: number; vy: number; vz: number } {
  const a = row.a0 + row.adot * T;
  const e = Math.max(0, row.e0 + row.edot * T);
  const I = (row.I0 + row.Idot * T) * DEG;
  const L = row.L0 + row.Ldot * T;
  const varpi = row.varpi0 + row.varpidot * T;
  const Omega = (row.Omega0 + row.Omegadot * T) * DEG;
  let Mdeg = L - varpi;
  if (row.b != null && row.c != null && row.s != null && row.f != null) {
    Mdeg += row.b * T * T + row.c * Math.cos(row.f * T * DEG) + row.s * Math.sin(row.f * T * DEG);
  }
  const M = wrap180(Mdeg) * DEG;
  const E = eccentricAnomaly(M, e);
  const nu = trueAnomalyFromE(E, e);
  const omega = (varpi * DEG) - Omega;
  const mu = G0; // heliocentric two-body, M☉ = 1. PHYSICAL APPROXIMATION.
  return stateFromElements(a, e, I, Omega, omega, nu, mu);
}

function tableForYear(year: number): { rows: ElemRow[]; extra: boolean } {
  if (year >= 1800 && year <= 2050) return { rows: TABLE1, extra: false };
  return { rows: TABLE2, extra: true };
}

function barycentricShift(bodies: BodySpec[]): BodySpec[] {
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
    z += b.mass * (b.z ?? 0);
    px += b.mass * b.vx;
    py += b.mass * b.vy;
    pz += b.mass * (b.vz ?? 0);
  }
  if (!(m > 0)) return bodies;
  const cx = x / m;
  const cy = y / m;
  const cz = z / m;
  const vx = px / m;
  const vy = py / m;
  const vz = pz / m;
  return bodies.map((b) => ({
    ...b,
    x: b.x - cx,
    y: b.y - cy,
    z: (b.z ?? 0) - cz,
    vx: b.vx - vx,
    vy: b.vy - vy,
    vz: (b.vz ?? 0) - vz,
  }));
}

export function keplerianSolarSystem(epochIso: string): LoadedSolarSystem {
  const jd = julianDateUTC(epochIso);
  const T = (jd - J2000) / 36525;
  const year = new Date(Date.parse(epochIso)).getUTCFullYear();
  const { rows, extra } = tableForYear(year);
  const warnings: string[] = [
    'PHYSICAL APPROXIMATION — JPL Keplerian approximation (two-body, ecliptic J2000). Earth is the Earth–Moon barycentre.',
  ];
  if (extra) warnings.push('Epoch outside 1800–2050: using the long-period table with extra mean-anomaly terms.');
  if (year < -3000 || year > 3000) {
    warnings.push('Epoch is outside the documented 3000 BC–3000 AD window; elements are an extrapolation.');
  }

  const sunId = catalogByKey('sun')!;
  const heliocentric: BodySpec[] = [
    createBodyFromEphemeris(sunId, {
      epoch: epochIso,
      referenceFrame: 'Ecliptic J2000 heliocentric',
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
    }),
  ];

  for (const row of rows) {
    const id = catalogByKey(row.key);
    if (!id) continue;
    const st = heliocentricState(row, T);
    const state: EphemerisState = {
      epoch: epochIso,
      referenceFrame: 'Ecliptic J2000 heliocentric',
      position: { x: st.x, y: st.y, z: st.z },
      velocity: { x: st.vx, y: st.vy, z: st.vz },
    };
    heliocentric.push(createBodyFromEphemeris(id, state));
  }

  const bodies = barycentricShift(heliocentric);
  for (const key of KEPLERIAN_KEYS) {
    if (!bodies.some((b) => b.key === key)) {
      throw new Error(`keplerian assembly missing ${key}`);
    }
  }

  return {
    epoch: epochIso,
    timeScale: 'UTC',
    source: 'keplerian',
    referenceFrame: 'Ecliptic J2000 SSB (shifted from heliocentric Keplerian)',
    center: 'Solar System Barycenter (constructed)',
    bodies,
    viewRadius: 35,
    dt: 0.00015,
    softening: 1e-6,
    warnings,
  };
}
