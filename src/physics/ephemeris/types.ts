/**
 * Normalized Cartesian state ready for the physics engine.
 * Phase 2 JPL Horizons / SPICE adapters must emit this — the engine
 * does not know what NASA is.
 */
import type { BodySpec } from '../types.ts';
import type { Epoch, TimeScale } from '../time/epoch.ts';
import type { ConstantsSet } from '../constants.ts';

export interface EphemerisState {
  epoch: Epoch;
  referenceFrame: string;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
}

export type EphemerisUnits = 'AU_YEAR' | 'KM_S' | 'AU_D';

export type EphemerisSource = 'horizons-live' | 'horizons-cache' | 'keplerian';

export type EphemerisMode = 'horizons' | 'auto' | 'keplerian';

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
  epoch: Epoch;
  timeScale: TimeScale;
  source: EphemerisSource;
  referenceFrame: string;
  center: string;
  bodies: BodySpec[];
  viewRadius: number;
  dt: number;
  softening: number;
  warnings: string[];
  constants: ConstantsSet;
  fallback: boolean;
}

export type { Epoch, TimeScale };
