/**
 * Server-only JPL Horizons adapter. NASA-facing.
 * Must never be imported from the engine or from a browser module.
 */
import { coerceEpoch, type Epoch } from '../time/epoch.ts';
import {
  catalogByKey,
  MAJOR_MOON_KEYS,
  PLANET_KEYS,
  SPACECRAFT_KEYS,
} from './catalog.ts';
import { buildHorizonsUrl, epochToHorizonsCalendar, parseHorizonsVector } from './horizonsParse.ts';
import type { HorizonsProxyRequest } from './horizonsRequest.ts';
import { HORIZONS_MAX_BODIES } from './horizonsRequest.ts';
import type { EphemerisState } from './types.ts';

export interface HorizonsFetchRow {
  key: string;
  state?: EphemerisState;
  error?: string;
}

const TIMEOUT_MS = 18_000;
const GAP_MS = 350;
const MAX_EPOCH_YEAR = 9999;
const MIN_EPOCH_YEAR = -3000;

const WHITELIST = new Set<string>([
  ...PLANET_KEYS,
  ...MAJOR_MOON_KEYS,
  ...SPACECRAFT_KEYS,
]);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function wantedKeys(req: HorizonsProxyRequest): string[] {
  if (req.bodyIds && req.bodyIds.length) {
    const keys: string[] = [];
    for (const id of req.bodyIds) {
      if (typeof id !== 'string' || !WHITELIST.has(id)) {
        throw new Error(`body id '${id}' is not on the Horizons whitelist`);
      }
      if (!keys.includes(id)) keys.push(id);
    }
    return keys;
  }
  const keys: string[] = [...PLANET_KEYS];
  if (req.includeMoons) keys.push(...MAJOR_MOON_KEYS);
  if (req.includeSpacecraft) keys.push(...SPACECRAFT_KEYS);
  return keys;
}

function parseEpoch(req: HorizonsProxyRequest): Epoch {
  if (typeof req.epoch !== 'string' || req.epoch.length < 4 || req.epoch.length > 32) {
    throw new Error('invalid epoch');
  }
  if (/https?:/i.test(req.epoch) || req.epoch.includes('://')) {
    throw new Error('epoch must be a calendar date, not a URL');
  }
  const scale = req.timeScale === 'UTC' ? 'UTC' : 'TDB';
  const epoch = coerceEpoch(req.epoch, scale);
  const year = Math.floor((epoch.jd - 1721425.5) / 365.25);
  if (year < MIN_EPOCH_YEAR || year > MAX_EPOCH_YEAR) {
    throw new Error(`epoch year ${year} out of range`);
  }
  return epoch;
}

async function fetchOne(horizonsId: string, key: string, calendar: string, epoch: Epoch): Promise<HorizonsFetchRow> {
  const url = buildHorizonsUrl(horizonsId, calendar);
  if (!url.startsWith('https://ssd.jpl.nasa.gov/api/horizons.api?')) {
    throw new Error('refusing to fetch a non-Horizons URL');
  }
  let last = 'Horizons request failed';
  for (let attempt = 0; attempt < 3; attempt++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ac.signal, headers: { Accept: 'application/json' } });
      if (res.status === 503 || res.status === 429) {
        last = `Horizons HTTP ${res.status}`;
        await sleep(400 * (attempt + 1));
        continue;
      }
      if (!res.ok) return { key, error: `Horizons HTTP ${res.status}` };
      const json = (await res.json()) as { error?: string; result?: string };
      if (json.error) return { key, error: json.error };
      if (!json.result) return { key, error: 'Horizons returned empty result' };
      const parsed = parseHorizonsVector(json.result, epoch);
      return { key, state: parsed.state };
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
      await sleep(400 * (attempt + 1));
    } finally {
      clearTimeout(t);
    }
  }
  return { key, error: last };
}

/**
 * Sequential Horizons VECTOR queries. NASA-facing. Server only.
 */
export async function fetchHorizonsStates(req: HorizonsProxyRequest): Promise<HorizonsFetchRow[]> {
  if (req && typeof req === 'object' && 'url' in req) {
    throw new Error('open URL proxy is forbidden');
  }
  const epoch = parseEpoch(req);
  const keys = wantedKeys(req);
  if (keys.length === 0) throw new Error('no bodies requested');
  if (keys.length > HORIZONS_MAX_BODIES) {
    throw new Error(`too many bodies (${keys.length} > ${HORIZONS_MAX_BODIES})`);
  }
  const calendar = epochToHorizonsCalendar(epoch);
  const out: HorizonsFetchRow[] = [];
  for (let i = 0; i < keys.length; i++) {
    const cat = catalogByKey(keys[i]);
    if (!cat) throw new Error(`unknown catalog body ${keys[i]}`);
    out.push(await fetchOne(cat.horizonsId, cat.key, calendar, epoch));
    if (i < keys.length - 1) await sleep(GAP_MS);
  }
  return out;
}

export function assertSafeHorizonsRequest(raw: unknown): HorizonsProxyRequest {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('invalid Horizons request');
  }
  const o = raw as Record<string, unknown>;
  if ('url' in o) throw new Error('open URL proxy is forbidden');
  if (typeof o.epoch !== 'string') throw new Error('epoch is required');
  if (o.timeScale != null && o.timeScale !== 'TDB' && o.timeScale !== 'UTC') {
    throw new Error('timeScale must be TDB or UTC');
  }
  if (o.bodyIds != null) {
    if (!Array.isArray(o.bodyIds) || o.bodyIds.some((x) => typeof x !== 'string')) {
      throw new Error('bodyIds must be catalog keys');
    }
  }
  return {
    epoch: o.epoch,
    timeScale: o.timeScale === 'UTC' ? 'UTC' : 'TDB',
    bodyIds: o.bodyIds as string[] | undefined,
    includeMoons: !!o.includeMoons,
    includeSpacecraft: !!o.includeSpacecraft,
  };
}

export interface HorizonsProxyResult {
  status: number;
  body: { rows?: HorizonsFetchRow[]; error?: string };
}

/** Shared by Vite middleware, Vercel `api/horizons`, and TanStack `/api/horizons`. */
export async function handleHorizonsPost(raw: unknown): Promise<HorizonsProxyResult> {
  try {
    const req = assertSafeHorizonsRequest(raw);
    const rows = await fetchHorizonsStates(req);
    return { status: 200, body: { rows } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Horizons proxy error';
    const status = /forbidden|whitelist|invalid|required|not a URL|too many/i.test(message) ? 400 : 502;
    return { status, body: { error: message } };
  }
}

