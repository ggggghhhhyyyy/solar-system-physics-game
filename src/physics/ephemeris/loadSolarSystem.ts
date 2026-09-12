import type { BodySpec } from '../types.ts';
import {
  catalogByKey,
  MAJOR_MOON_KEYS,
  PLANET_KEYS,
  SOLAR_SYSTEM_CATALOG,
  SPACECRAFT_KEYS,
} from './catalog.ts';
import { cachedState, cacheMatchesEpoch } from './horizonsCache.ts';
import { keplerianSolarSystem } from './keplerian.ts';
import { createBodyFromEphemeris } from './normalize.ts';
import type { EphemerisSource, EphemerisState, LoadedSolarSystem } from './types.ts';

export interface HorizonsFetchRequest {
  epoch: string;
  commands: Array<{ key: string; horizonsId: string }>;
}

export interface HorizonsFetchRow {
  key: string;
  state?: EphemerisState;
  error?: string;
}

export type HorizonsFetcher = (req: HorizonsFetchRequest) => Promise<HorizonsFetchRow[]>;

export interface LoadSolarSystemOpts {
  epoch: string;
  includeSpacecraft?: boolean;
  includeMoons?: boolean;
  source: 'horizons' | 'keplerian' | 'auto';
  fetchStates?: HorizonsFetcher;
}

function identityOf(key: string) {
  const c = catalogByKey(key);
  if (!c) throw new Error(`unknown catalog body ${key}`);
  return c;
}

function wantedKeys(includeSpacecraft: boolean, includeMoons: boolean): string[] {
  const keys: string[] = [...PLANET_KEYS];
  if (includeMoons) keys.push(...MAJOR_MOON_KEYS);
  if (includeSpacecraft) keys.push(...SPACECRAFT_KEYS);
  return keys;
}

function assemble(
  epoch: string,
  source: EphemerisSource,
  rows: Map<string, EphemerisState>,
  includeSpacecraft: boolean,
  includeMoons: boolean,
  warnings: string[],
): LoadedSolarSystem {
  const keys = wantedKeys(includeSpacecraft, includeMoons);
  const bodies: BodySpec[] = [];
  const missing: string[] = [];
  for (const key of keys) {
    const st = rows.get(key);
    if (!st) {
      missing.push(key);
      continue;
    }
    const id = identityOf(key);
    const spec = createBodyFromEphemeris(id, st);
    spec.noCollide = id.noCollide;
    bodies.push(spec);
  }
  if (!bodies.some((b) => b.key === 'sun')) {
    throw new Error('ephemeris load missing the Sun');
  }
  const planets = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
  const missingPlanets = planets.filter((k) => !bodies.some((b) => b.key === k));
  if (missingPlanets.length) {
    throw new Error(`ephemeris load missing planets: ${missingPlanets.join(', ')}`);
  }
  for (const k of missing) {
    const name = catalogByKey(k)?.name ?? k;
    warnings.push(`${name} 无星历，已跳过`);
  }
  return {
    epoch,
    timeScale: 'TDB',
    source,
    referenceFrame: 'Ecliptic J2000 SSB',
    center: 'Solar System Barycenter (500@0)',
    bodies,
    viewRadius: includeSpacecraft ? 45 : 35,
    dt: 0.00012,
    softening: 1e-6,
    warnings,
  };
}

function fromCache(epoch: string, includeSpacecraft: boolean, includeMoons: boolean): LoadedSolarSystem {
  const rows = new Map<string, EphemerisState>();
  for (const key of wantedKeys(includeSpacecraft, includeMoons)) {
    const st = cachedState(key, epoch);
    if (st) rows.set(key, st);
  }
  return assemble(epoch, 'horizons-cache', rows, includeSpacecraft, includeMoons, [
    'JPL Horizons DE441 geometric states, cached at 2026-09-11 00:00 TDB.',
  ]);
}

export function normalizeEpoch(input: string): string {
  const raw = input.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00:00Z`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return `${raw}:00Z`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(raw)) return `${raw}Z`;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) throw new Error(`invalid epoch ${input}`);
  return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export async function loadSolarSystem(opts: LoadSolarSystemOpts): Promise<LoadedSolarSystem> {
  const epoch = normalizeEpoch(opts.epoch);
  const includeSpacecraft = !!opts.includeSpacecraft;
  const includeMoons = !!opts.includeMoons;

  if (opts.source === 'keplerian') {
    const loaded = keplerianSolarSystem(epoch);
    if (includeSpacecraft) {
      loaded.warnings.push('航天器没有开普勒近似，仅 Horizons 可加载。');
    }
    if (includeMoons) {
      loaded.warnings.push('伽利略卫星/泰坦等没有开普勒近似，仅 Horizons 可加载。');
    }
    return loaded;
  }

  const canCache = cacheMatchesEpoch(epoch);

  // Cache IS Horizons DE441 at that instant — do not hit the network.
  if (canCache) {
    return fromCache(epoch, includeSpacecraft, includeMoons);
  }

  if (opts.fetchStates) {
    const moonSet = new Set<string>(MAJOR_MOON_KEYS);
    const wanted = SOLAR_SYSTEM_CATALOG.filter((b) => {
      if (b.kind === 'spacecraft') return includeSpacecraft;
      if (moonSet.has(b.key)) return includeMoons;
      return true;
    });
    try {
      const fetched = await opts.fetchStates({
        epoch,
        commands: wanted.map((b) => ({ key: b.key, horizonsId: b.horizonsId })),
      });
      const rows = new Map<string, EphemerisState>();
      const warnings: string[] = [];
      for (const row of fetched) {
        if (row.state) rows.set(row.key, row.state);
        else if (row.error) warnings.push(`${row.key}: ${row.error}`);
      }
      return assemble(epoch, 'horizons-live', rows, includeSpacecraft, includeMoons, [
        'JPL Horizons live geometric VECTOR, CENTER=500@0, ecliptic J2000, AU-D → AU/year.',
        ...warnings,
      ]);
    } catch (err) {
      if (opts.source === 'auto') {
        const k = keplerianSolarSystem(epoch);
        k.warnings.unshift(
          `Horizons unavailable (${err instanceof Error ? err.message : 'error'}); fell back to JPL Keplerian approximation.`,
        );
        return k;
      }
      throw err;
    }
  }

  if (opts.source === 'auto') return keplerianSolarSystem(epoch);
  throw new Error('No Horizons fetcher and epoch is not the cached DE441 snapshot');
}
