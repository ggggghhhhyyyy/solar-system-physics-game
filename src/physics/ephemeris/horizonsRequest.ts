/**
 * Browser ↔ our backend contract for live Horizons.
 * The client MUST NOT send a URL. The server assembles the JPL request.
 */

export interface HorizonsProxyRequest {
  /** Civil calendar (YYYY-MM-DD or YYYY-MM-DD HH:MM:SS). Interpreted as TDB by default. */
  epoch: string;
  timeScale?: 'TDB' | 'UTC';
  /** Catalog keys (sun, earth, …). Server maps these to a Horizons ID whitelist. */
  bodyIds?: string[];
  includeMoons?: boolean;
  includeSpacecraft?: boolean;
}

export const HORIZONS_MAX_BODIES = 24;
