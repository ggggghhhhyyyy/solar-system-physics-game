import { DAYS_PER_YEAR } from '../constants.ts';
import { coerceEpoch, formatCalendarFromJd, type Epoch } from '../time/epoch.ts';
import type { EphemerisState } from './types.ts';

const NUM = String.raw`[+-]?(?:\d+\.\d+|\d+)(?:[Ee][+-]?\d+)?`;
const XYZ = new RegExp(
  String.raw`X\s*=\s*(${NUM})\s+Y\s*=\s*(${NUM})\s+Z\s*=\s*(${NUM})`,
);
const VXYZ = new RegExp(
  String.raw`VX\s*=\s*(${NUM})\s+VY\s*=\s*(${NUM})\s+VZ\s*=\s*(${NUM})`,
);

export interface ParsedHorizonsVector {
  jdtdb: number | null;
  calendar: string | null;
  timeScale: 'TDB' | 'UTC' | null;
  units: 'AU-D' | 'KM-S' | 'KM-D' | null;
  frame: string | null;
  center: string | null;
  target: string | null;
  sampleCount: number;
  /** Always the first sample inside $$SOE … $$EOE. Documented, never silent. */
  state: EphemerisState;
}

function parseNumber(raw: string, label: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Horizons ${label} is not a finite number (${raw})`);
  return n;
}

/**
 * Parse a JPL Horizons VECTOR table (text inside JSON `result`).
 * Expects geometric Cartesian states. PHYSICAL MODEL — no invented numbers.
 *
 * Sample policy: the FIRST record inside $$SOE … $$EOE is used.
 * Additional samples (STEP_SIZE windows) are counted and ignored.
 * Missing SOE/EOE, missing velocity, wrong units, or non-finite numbers throw.
 */
export function parseHorizonsVector(text: string, epoch: Epoch | string): ParsedHorizonsVector {
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('empty Horizons result');
  }
  if (/No ephemeris for target/i.test(text) || /^\s*No matching/im.test(text)) {
    throw new Error('Horizons returned an error result with no vector table');
  }
  const requested = coerceEpoch(epoch, 'TDB');
  const soe = text.indexOf('$$SOE');
  const eoe = text.indexOf('$$EOE');
  if (soe < 0) throw new Error('Horizons result missing $$SOE');
  if (eoe < 0) throw new Error('Horizons result missing $$EOE');
  if (eoe <= soe) throw new Error('Horizons result has inverted $$SOE/$$EOE');
  const block = text.slice(soe + 5, eoe);
  if (!block.trim()) throw new Error('Horizons $$SOE/$$EOE block is empty');

  const posMatches = [...block.matchAll(new RegExp(XYZ, 'g'))];
  const velMatches = [...block.matchAll(new RegExp(VXYZ, 'g'))];
  if (posMatches.length === 0) throw new Error('Horizons vector table missing X/Y/Z');
  if (velMatches.length === 0) throw new Error('Horizons vector table missing VX/VY/VZ');
  const pos = posMatches[0];
  const vel = velMatches[0];

  const x = parseNumber(pos[1], 'X');
  const y = parseNumber(pos[2], 'Y');
  const z = parseNumber(pos[3], 'Z');
  const vx = parseNumber(vel[1], 'VX');
  const vy = parseNumber(vel[2], 'VY');
  const vz = parseNumber(vel[3], 'VZ');

  const unitsRaw = /Output units\s*:\s*(AU-D|KM-S|KM-D)/i.exec(text)?.[1];
  if (!unitsRaw) throw new Error('Horizons result missing Output units');
  const units = unitsRaw.toUpperCase() as 'AU-D' | 'KM-S' | 'KM-D';
  if (units !== 'AU-D') {
    throw new Error(`Horizons units ${units} are not AU-D; refusing silent conversion`);
  }

  const frame = /Reference frame\s*:\s*(.+)/i.exec(text)?.[1]?.trim() ?? null;
  const center = /Center body name:\s*(.+)/i.exec(text)?.[1]?.trim() ?? null;
  const target = /Target body name:\s*(.+)/i.exec(text)?.[1]?.trim() ?? null;

  const header = /([0-9]+\.[0-9]+)\s*=\s*(A\.D\.\s+[^\n]+)/.exec(block);
  const jdtdb = header ? Number(header[1]) : null;
  const calendar = header ? header[2].trim() : null;
  let timeScale: 'TDB' | 'UTC' | null = null;
  if (calendar?.includes('TDB')) timeScale = 'TDB';
  else if (calendar?.includes('UT')) timeScale = 'UTC';
  else timeScale = 'TDB';

  const pvx = vx * DAYS_PER_YEAR;
  const pvy = vy * DAYS_PER_YEAR;
  const pvz = vz * DAYS_PER_YEAR;

  const stateEpoch: Epoch =
    jdtdb != null && Number.isFinite(jdtdb) ? { jd: jdtdb, scale: timeScale ?? 'TDB' } : requested;

  return {
    jdtdb: jdtdb != null && Number.isFinite(jdtdb) ? jdtdb : null,
    calendar,
    timeScale,
    units,
    frame,
    center,
    target,
    sampleCount: posMatches.length,
    state: {
      epoch: stateEpoch,
      referenceFrame: 'Ecliptic J2000 SSB',
      position: { x, y, z },
      velocity: { x: pvx, y: pvy, z: pvz },
    },
  };
}

export function buildHorizonsUrl(command: string, epochCalendar: string): string {
  const start = epochCalendar;
  const stop = plusOneMinute(epochCalendar);
  const params = new URLSearchParams({
    format: 'json',
    COMMAND: `'${command}'`,
    OBJ_DATA: "'NO'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'VECTORS'",
    CENTER: "'500@0'",
    START_TIME: `'${start}'`,
    STOP_TIME: `'${stop}'`,
    STEP_SIZE: "'1 m'",
    VEC_TABLE: "'2'",
    REF_PLANE: "'ECLIPTIC'",
    OUT_UNITS: "'AU-D'",
    VEC_CORR: "'NONE'",
    REF_SYSTEM: "'ICRF'",
  });
  return `https://ssd.jpl.nasa.gov/api/horizons.api?${params.toString()}`;
}

function plusOneMinute(cal: string): string {
  // Horizons equal START/STOP is unsafe; +60 s on the civil digits.
  const m = cal.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return cal;
  let hour = Number(m[4]);
  let minute = Number(m[5]) + 1;
  if (minute >= 60) {
    minute = 0;
    hour += 1;
  }
  if (hour >= 24) hour = 23;
  return `${m[1]}-${m[2]}-${m[3]} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${m[6]}`;
}

/** Calendar string Horizons accepts, from a TDB (or UTC) epoch. */
export function epochToHorizonsCalendar(epoch: Epoch): string {
  return formatCalendarFromJd(epoch.jd);
}
