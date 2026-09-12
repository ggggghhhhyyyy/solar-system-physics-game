/**
 * Browser Horizons client. Talks ONLY to /api/horizons.
 * Engine never imports this file. NASA URL is not present here.
 */
import { formatCalendarFromJd } from '../time/epoch.ts';
import type { HorizonsFetcher, HorizonsFetchRow } from './loadSolarSystem.ts';
import type { HorizonsProxyRequest } from './horizonsRequest.ts';

export async function queryHorizonsStates(req: HorizonsProxyRequest): Promise<HorizonsFetchRow[]> {
  if ('url' in (req as object)) {
    throw new Error('client must not send a URL to the Horizons proxy');
  }
  const res = await fetch('/api/horizons', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      epoch: req.epoch,
      timeScale: req.timeScale ?? 'TDB',
      bodyIds: req.bodyIds,
      includeMoons: !!req.includeMoons,
      includeSpacecraft: !!req.includeSpacecraft,
    }),
  });
  const json = (await res.json().catch(() => null)) as
    | { rows?: HorizonsFetchRow[]; error?: string }
    | null;
  if (!res.ok) {
    throw new Error(json?.error ?? `Horizons proxy HTTP ${res.status}`);
  }
  if (!json?.rows) throw new Error(json?.error ?? 'Horizons proxy returned no rows');
  return json.rows;
}

/** Adapter matching loadSolarSystem's NASA-blind fetcher. Sends catalog keys only. */
export function browserHorizonsFetcher(): HorizonsFetcher {
  return async (req) =>
    queryHorizonsStates({
      epoch: formatCalendarFromJd(req.epoch.jd),
      timeScale: req.epoch.scale === 'UTC' ? 'UTC' : 'TDB',
      bodyIds: req.commands.map((c) => c.key),
    });
}
