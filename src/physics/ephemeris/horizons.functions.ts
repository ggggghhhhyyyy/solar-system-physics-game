import { fetchHorizonsStates } from './horizons.server.ts';
import type { HorizonsFetchRequest, HorizonsFetchRow } from './loadSolarSystem.ts';

/**
 * Browser Horizons fetch. NASA-facing. Engine never imports this file.
 * If a browser blocks CORS, cache (2026-09-11 DE441) + Keplerian still load.
 */
export async function queryHorizonsStates(args: {
  data: HorizonsFetchRequest;
}): Promise<HorizonsFetchRow[]> {
  return fetchHorizonsStates(args.data);
}
