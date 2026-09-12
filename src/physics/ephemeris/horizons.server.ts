import { catalogByHorizonsId } from './catalog.ts';
import { buildHorizonsUrl, epochToHorizonsCalendar, parseHorizonsVector } from './horizonsParse.ts';
import type { HorizonsFetchRequest, HorizonsFetchRow } from './loadSolarSystem.ts';

const TIMEOUT_MS = 18_000;
const GAP_MS = 350;

async function fetchOne(command: string, calendar: string, epochIso: string): Promise<HorizonsFetchRow> {
  const key = catalogByHorizonsId(command)?.key ?? command;
  const url = buildHorizonsUrl(command, calendar);
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
      if (!res.ok) {
        return { key, error: `Horizons HTTP ${res.status}` };
      }
      const json = (await res.json()) as { error?: string; result?: string };
      if (json.error) return { key, error: json.error };
      if (!json.result) return { key, error: 'Horizons returned empty result' };
      const parsed = parseHorizonsVector(json.result, epochIso);
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Sequential Horizons VECTOR queries. NASA-facing. Not imported by the engine.
 */
export async function fetchHorizonsStates(req: HorizonsFetchRequest): Promise<HorizonsFetchRow[]> {
  const calendar = epochToHorizonsCalendar(req.epoch);
  const out: HorizonsFetchRow[] = [];
  for (let i = 0; i < req.commands.length; i++) {
    const c = req.commands[i];
    out.push(await fetchOne(c.horizonsId, calendar, req.epoch));
    if (i < req.commands.length - 1) await sleep(GAP_MS);
  }
  return out;
}
