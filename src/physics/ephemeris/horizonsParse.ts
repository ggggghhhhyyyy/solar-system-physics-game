import { DAYS_PER_YEAR } from '../constants.ts';
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
  state: EphemerisState;
}

/**
 * Parse a JPL Horizons VECTOR table (text inside JSON `result`).
 * Expects geometric Cartesian states. PHYSICAL MODEL — no invented numbers.
 * Returns the first sample inside $$SOE … $$EOE.
 */
export function parseHorizonsVector(text: string, epochIso: string): ParsedHorizonsVector {
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('empty Horizons result');
  }
  const soe = text.indexOf('$$SOE');
  const eoe = text.indexOf('$$EOE');
  if (soe < 0 || eoe < 0 || eoe <= soe) {
    throw new Error('Horizons result has no $$SOE/$$EOE vector table');
  }
  const block = text.slice(soe, eoe);
  const pos = XYZ.exec(block);
  const vel = VXYZ.exec(block);
  if (!pos || !vel) {
    throw new Error('Horizons vector table missing X/Y/Z or VX/VY/VZ');
  }
  const x = Number(pos[1]);
  const y = Number(pos[2]);
  const z = Number(pos[3]);
  const vx = Number(vel[1]);
  const vy = Number(vel[2]);
  const vz = Number(vel[3]);
  if (![x, y, z, vx, vy, vz].every(Number.isFinite)) {
    throw new Error('Horizons vector contained a non-finite component');
  }

  const units = /Output units\s*:\s*(AU-D|KM-S|KM-D)/i.exec(text)?.[1]?.toUpperCase() as
    | 'AU-D'
    | 'KM-S'
    | 'KM-D'
    | undefined;
  const frame = /Reference frame\s*:\s*(.+)/i.exec(text)?.[1]?.trim() ?? 'Ecliptic of J2000.0';
  const center = /Center body name:\s*(.+)/i.exec(text)?.[1]?.trim() ?? null;
  const target = /Target body name:\s*(.+)/i.exec(text)?.[1]?.trim() ?? null;

  const header = /([0-9]+\.[0-9]+)\s*=\s*(A\.D\.\s+[^\n]+)/.exec(block);
  const jdtdb = header ? Number(header[1]) : null;
  const calendar = header ? header[2].trim() : null;
  const timeScale = calendar?.includes('TDB') ? 'TDB' : calendar?.includes('UT') ? 'UTC' : 'TDB';

  let px = x;
  let py = y;
  let pz = z;
  let pvx = vx;
  let pvy = vy;
  let pvz = vz;
  const u = units ?? 'AU-D';
  if (u === 'AU-D') {
    pvx *= DAYS_PER_YEAR;
    pvy *= DAYS_PER_YEAR;
    pvz *= DAYS_PER_YEAR;
  } else if (u === 'KM-S') {
    // leave as KM_S — caller must convert via createBodyFromEphemeris
  } else if (u === 'KM-D') {
    // km/day → we convert to AU/year in the AU_YEAR path only; reject mixed
    throw new Error('KM-D Horizons units are not supported; request AU-D');
  }

  if (u !== 'AU-D') {
    throw new Error(`Horizons units ${u} must be AU-D for this adapter`);
  }

  return {
    jdtdb: jdtdb != null && Number.isFinite(jdtdb) ? jdtdb : null,
    calendar,
    timeScale,
    units: u,
    frame,
    center,
    target,
    state: {
      epoch: epochIso,
      referenceFrame: 'Ecliptic J2000 SSB',
      position: { x: px, y: py, z: pz },
      velocity: { x: pvx, y: pvy, z: pvz },
    },
  };
}

export function buildHorizonsUrl(command: string, epochCalendar: string): string {
  const start = epochCalendar;
  const stop = plusSeconds(epochCalendar, 60);
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

function plusSeconds(cal: string, sec: number): string {
  const iso = cal.includes('T') ? cal : cal.replace(' ', 'T');
  const stamped = /Z$/i.test(iso) ? iso : `${iso}Z`;
  const t = Date.parse(stamped);
  if (!Number.isFinite(t)) return cal;
  const d = new Date(t + sec * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

/** Calendar string Horizons accepts, from an ISO-8601 epoch. */
export function epochToHorizonsCalendar(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) throw new Error(`invalid epoch ${iso}`);
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}