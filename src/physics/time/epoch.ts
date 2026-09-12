/**
 * Formal time / epoch model. PHYSICAL MODEL.
 *
 * The engine stores Julian Date + time scale. UI may format UTC or TDB.
 * Never treat a TDB calendar label as a JS Date with a Z suffix.
 */

export type TimeScale = 'UTC' | 'TDB' | 'TT';

export interface Epoch {
  /** Julian Date in `scale`. */
  jd: number;
  scale: TimeScale;
}

export const J2000_JD = 2451545.0;
export const JD_UNIX_EPOCH = 2440587.5;
export const SECONDS_PER_DAY = 86400;
export const DAYS_PER_JULIAN_YEAR = 365.25;

/**
 * NUMERICAL APPROXIMATION.
 * TDB ≈ TT, TT = TAI + 32.184 s, TAI = UTC + leap seconds.
 * The TDB−TT periodic term (~1.6 ms) is neglected.
 * Leap-second table is coarse and documented — not a full SOFA/ERFA model.
 */
const LEAP_TAI_UTC: Array<{ jdUtc: number; leap: number }> = [
  { jdUtc: 2441317.5, leap: 10 }, // 1972
  { jdUtc: 2441499.5, leap: 11 },
  { jdUtc: 2441683.5, leap: 12 },
  { jdUtc: 2442048.5, leap: 13 },
  { jdUtc: 2442413.5, leap: 14 },
  { jdUtc: 2442778.5, leap: 15 },
  { jdUtc: 2443144.5, leap: 16 },
  { jdUtc: 2443509.5, leap: 17 },
  { jdUtc: 2443874.5, leap: 18 },
  { jdUtc: 2444239.5, leap: 19 },
  { jdUtc: 2444786.5, leap: 20 },
  { jdUtc: 2445151.5, leap: 21 },
  { jdUtc: 2445516.5, leap: 22 },
  { jdUtc: 2446247.5, leap: 23 },
  { jdUtc: 2447161.5, leap: 24 },
  { jdUtc: 2447892.5, leap: 25 },
  { jdUtc: 2448257.5, leap: 26 },
  { jdUtc: 2448804.5, leap: 27 },
  { jdUtc: 2449169.5, leap: 28 },
  { jdUtc: 2449534.5, leap: 29 },
  { jdUtc: 2450083.5, leap: 30 },
  { jdUtc: 2450630.5, leap: 31 },
  { jdUtc: 2451179.5, leap: 32 },
  { jdUtc: 2453736.5, leap: 33 },
  { jdUtc: 2454832.5, leap: 34 },
  { jdUtc: 2456109.5, leap: 35 },
  { jdUtc: 2457204.5, leap: 36 },
  { jdUtc: 2457754.5, leap: 37 }, // 2017-01-01
];

const TT_MINUS_TAI = 32.184;

export function unixMsToJd(ms: number): number {
  return ms / 86_400_000 + JD_UNIX_EPOCH;
}

export function jdToUnixMs(jd: number): number {
  return (jd - JD_UNIX_EPOCH) * 86_400_000;
}

export function taiMinusUtcSeconds(jdUtc: number): number {
  let leap = 10;
  for (const row of LEAP_TAI_UTC) {
    if (jdUtc >= row.jdUtc) leap = row.leap;
  }
  return leap;
}

/** TDB − UTC in seconds at a UTC Julian Date. NUMERICAL APPROXIMATION. */
export function tdbMinusUtcSeconds(jdUtc: number): number {
  return taiMinusUtcSeconds(jdUtc) + TT_MINUS_TAI;
}

export function epochToUtcJd(epoch: Epoch): number {
  if (epoch.scale === 'UTC') return epoch.jd;
  const dt = tdbMinusUtcSeconds(epoch.jd) / SECONDS_PER_DAY;
  return epoch.jd - dt;
}

export function epochToTdbJd(epoch: Epoch): number {
  if (epoch.scale === 'TDB' || epoch.scale === 'TT') return epoch.jd;
  return epoch.jd + tdbMinusUtcSeconds(epoch.jd) / SECONDS_PER_DAY;
}

export function addJulianYears(epoch: Epoch, years: number): Epoch {
  return { jd: epoch.jd + years * DAYS_PER_JULIAN_YEAR, scale: epoch.scale };
}

/**
 * Parse a calendar string as a civil date in the given scale.
 * Digits are NOT interpreted as JS Date UTC when scale is TDB.
 */
export function epochFromCalendar(calendar: string, scale: TimeScale): Epoch {
  const parts = parseCalendar(calendar);
  const jd = julianDateFromParts(parts);
  return { jd, scale };
}

export interface CalendarParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function parseCalendar(input: string): CalendarParts {
  const raw = input.trim().replace('T', ' ').replace(/Z$/i, '');
  const m = raw.match(
    /^(-?\d{1,6})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?)?$/,
  );
  if (!m) {
    const t = Date.parse(input);
    if (!Number.isFinite(t)) throw new Error(`invalid calendar ${input}`);
    const d = new Date(t);
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds() + d.getUTCMilliseconds() / 1000,
    };
  }
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: m[4] ? Number(m[4]) : 0,
    minute: m[5] ? Number(m[5]) : 0,
    second: m[6] ? Number(m[6]) : 0,
  };
}

/** Gregorian calendar → Julian Date (same digits, no time-scale conversion). */
export function julianDateFromParts(p: CalendarParts): number {
  let { year, month } = p;
  const day = p.day + (p.hour + (p.minute + p.second / 60) / 60) / 24;
  if (month <= 2) {
    year -= 1;
    month += 12;
  }
  const A = Math.floor(year / 100);
  const B = 2 - A + Math.floor(A / 4);
  return (
    Math.floor(365.25 * (year + 4716)) +
    Math.floor(30.6001 * (month + 1)) +
    day +
    B -
    1524.5
  );
}

export function formatCalendarFromJd(jd: number, fractionDigits = 0): string {
  const z = Math.floor(jd + 0.5);
  const f = jd + 0.5 - z;
  let A = z;
  if (z >= 2299161) {
    const alpha = Math.floor((z - 1867216.25) / 36524.25);
    A = z + 1 + alpha - Math.floor(alpha / 4);
  }
  const B = A + 1524;
  const C = Math.floor((B - 122.1) / 365.25);
  const D = Math.floor(365.25 * C);
  const E = Math.floor((B - D) / 30.6001);
  const day = B - D - Math.floor(30.6001 * E) + f;
  const month = E < 14 ? E - 1 : E - 13;
  const year = month > 2 ? C - 4716 : C - 4715;
  const dayInt = Math.floor(day);
  let rem = (day - dayInt) * 24;
  const hour = Math.floor(rem);
  rem = (rem - hour) * 60;
  const minute = Math.floor(rem);
  const second = (rem - minute) * 60;
  const ss =
    fractionDigits > 0 ? second.toFixed(fractionDigits).padStart(2 + 1 + fractionDigits, '0') : String(Math.floor(second + 1e-9)).padStart(2, '0');
  return `${year}-${String(month).padStart(2, '0')}-${String(dayInt).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${ss}`;
}

export function formatEpoch(epoch: Epoch, elapsedYears = 0): { calendar: string; jd: number; scale: TimeScale } {
  const e = addJulianYears(epoch, elapsedYears);
  return { calendar: formatCalendarFromJd(e.jd), jd: e.jd, scale: e.scale };
}

export function formatUtc(epoch: Epoch, elapsedYears = 0): string {
  const e = addJulianYears(epoch, elapsedYears);
  return `${formatCalendarFromJd(epochToUtcJd(e))} UTC`;
}

export function formatTdb(epoch: Epoch, elapsedYears = 0): string {
  const e = addJulianYears(epoch, elapsedYears);
  return `${formatCalendarFromJd(epochToTdbJd(e))} TDB`;
}

export function formatJd(epoch: Epoch, elapsedYears = 0): string {
  const e = addJulianYears(epoch, elapsedYears);
  return `JD ${e.jd.toFixed(5)} ${e.scale}`;
}

/**
 * Coerce authoring input.
 * - Epoch object: used as-is
 * - ISO with Z: UTC
 * - date-only / space calendar: callerScale (NASA UI uses TDB)
 */
export function coerceEpoch(input: Epoch | string, defaultScale: TimeScale = 'UTC'): Epoch {
  if (typeof input !== 'string') {
    if (!Number.isFinite(input.jd)) throw new Error('invalid epoch jd');
    return { jd: input.jd, scale: input.scale };
  }
  const raw = input.trim();
  if (/Z$/i.test(raw) || /[+-]\d{2}:\d{2}$/.test(raw)) {
    return epochFromCalendar(raw, 'UTC');
  }
  return epochFromCalendar(raw, defaultScale);
}

export function epochsEqual(a: Epoch, b: Epoch, tolDays = 60 / SECONDS_PER_DAY): boolean {
  const da = a.scale === 'UTC' ? epochToTdbJd(a) : a.jd;
  const db = b.scale === 'UTC' ? epochToTdbJd(b) : b.jd;
  return Math.abs(da - db) <= tolDays;
}

export function isEpoch(v: unknown): v is Epoch {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Epoch).jd === 'number' &&
    Number.isFinite((v as Epoch).jd) &&
    ((v as Epoch).scale === 'UTC' || (v as Epoch).scale === 'TDB' || (v as Epoch).scale === 'TT')
  );
}
