/**
 * Normalized Cartesian state ready for the physics engine.
 * Phase 2 JPL Horizons / SPICE adapters must emit this — the engine
 * does not know what NASA is.
 */
export interface EphemerisState {
  epoch: string;
  referenceFrame: string;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
}

export type EphemerisUnits = 'AU_YEAR' | 'KM_S' | 'AU_D';

export type EphemerisSource = 'horizons-live' | 'horizons-cache' | 'keplerian';

export type TimeScale = 'TDB' | 'UTC';

export interface EphemerisIdentity {
  name: string;
  key?: string;
  mass: number;
  physicalRadius: number;
  renderRadius?: number;
  color: string;
  isStar?: boolean;
  isBlackHole?: boolean;
  ring?: boolean;
  noCollide?: boolean;
  gravityMode?: 'massive' | 'test-particle';
}

export interface LoadedSolarSystem {
  epoch: string;
  timeScale: TimeScale;
  source: EphemerisSource;
  referenceFrame: string;
  center: string;
  bodies: import('../types.ts').BodySpec[];
  viewRadius: number;
  dt: number;
  softening: number;
  warnings: string[];
}