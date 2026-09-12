import type { BodySpec } from '../types.ts';
import { coerceEpoch, type Epoch } from '../time/epoch.ts';
import {
  catalogByKey,
  MAJOR_MOON_KEYS,
  PLANET_KEYS,
  SOLAR_SYSTEM_CATALOG,
  SPACECRAFT_KEYS,
} from './catalog.ts';
import { cachedState, cacheMatchesEpoch, HORIZONS_CACHE_PROVENANCE } from './horizonsCache.ts';
import { keplerianSolarSystem } from './keplerian.ts';
import { createBodyFromEphemeris } from './normalize.ts';
import type { EphemerisMode, EphemerisSource, EphemerisState, LoadedSolarSystem } from './types.ts';

export interface HorizonsFetchRequest {
  epoch: Epoch;
  commands: Array<{ key: string; horizonsId: string }>;
}

export interface HorizonsFetchRow {
  key: string;
  state?: EphemerisState;
  error?: string;
}

export type HorizonsFetcher = (req: HorizonsFetchRequest) => Promise<HorizonsFetchRow[]>;

export interface LoadSolarSystemOpts {
  epoch: Epoch | string;
  includeSpacecraft?: boolean;
  includeMoons?: boolean;
  /**
   * horizons — cache or live Horizons. Failure is an error. No Keplerian fallback.
   * auto     — cache → live → Keplerian, with an explicit warning.
   * keplerian — JPL approximate planetary elements only.
   */
  source: EphemerisMode;
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
  epoch: Epoch,
  source: EphemerisSource,
  rows: Map<string, EphemerisState>,
  includeSpacecraft: boolean,
  includeMoons: boolean,
  warnings: string[],
  fallback: boolean,
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
    timeScale: epoch.scale === 'UTC' ? 'UTC' : 'TDB',
    source,
    referenceFrame: 'Ecliptic J2000 SSB',
    center: 'Solar System Barycenter (500@0)',
    bodies,
    viewRadius: includeSpacecraft ? 45 : 35,
    dt: 0.00012,
    softening: 1e-6,
    warnings,
    constants: 'de440',
    fallback,
  };
}

function fromCache(epoch: Epoch, includeSpacecraft: boolean, includeMoons: boolean): LoadedSolarSystem {
  const rows = new Map<string, EphemerisState>();
  for (const key of wantedKeys(includeSpacecraft, includeMoons)) {
    const st = cachedState(key, epoch);
    if (st) rows.set(key, st);
  }
  const p = HORIZONS_CACHE_PROVENANCE;
  return assemble(epoch, 'horizons-cache', rows, includeSpacecraft, includeMoons, [
    `JPL Horizons ${p.ephemeris} geometric states, ${p.calendar} ${p.timeScale}, CENTER=${p.center}, ${p.refPlane} ${p.refSystem}, VEC_CORR=${p.vecCorr}.`,
  ], false);
}

export async function loadSolarSystem(opts: LoadSolarSystemOpts): Promise<LoadedSolarSystem> {
  const epoch = coerceEpoch(opts.epoch, opts.source === 'keplerian' ? 'UTC' : 'TDB');
  const includeSpacecraft = !!opts.includeSpacecraft;
  const includeMoons = opts.includeMoons !== false;

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

  if (cacheMatchesEpoch(epoch)) {
    return fromCache(HORIZONS_CACHE_PROVENANCE.timeScale === 'TDB' ? { jd: 2461294.5, scale: 'TDB' } : epoch, includeSpacecraft, includeMoons);
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
      if (rows.size === 0) {
        throw new Error(warnings[0] ?? 'Horizons returned no states');
      }
      return assemble(epoch, 'horizons-live', rows, includeSpacecraft, includeMoons, [
        'JPL Horizons live geometric VECTOR, CENTER=500@0, ecliptic J2000, AU-D → AU/year.',
        ...warnings,
      ], false);
    } catch (err) {
      if (opts.source === 'horizons') {
        throw err instanceof Error ? err : new Error(String(err));
      }
      const k = keplerianSolarSystem(epoch);
      k.warnings.unshift(
        `SOURCE: KEPLERIAN FALLBACK — Horizons unavailable (${err instanceof Error ? err.message : 'error'}).`,
      );
      k.fallback = true;
      return k;
    }
  }

  if (opts.source === 'auto') {
    const k = keplerianSolarSystem(epoch);
    k.warnings.unshift('SOURCE: KEPLERIAN FALLBACK — no Horizons fetcher and epoch is not the cached DE441 snapshot.');
    k.fallback = true;
    return k;
  }
  throw new Error('No Horizons fetcher and epoch is not the cached DE441 snapshot');
}
