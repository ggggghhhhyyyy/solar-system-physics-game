export type GravityMode = 'massive' | 'test-particle';

export type UiMode = 'game' | 'science';

export type ReferenceFrameKind = 'barycentric' | 'heliocentric' | 'body-centric';

/**
 * BodySpec is the serialisable / authoring form of a body.
 *
 * physicalRadius  — REAL size in AU. Collision, density, g, Hill, Roche, …
 * renderRadius    — DISPLAY hint in AU. NEVER used by the physics engine.
 * collisionRadius — defaults to physicalRadius. Only arcade/debug may inflate it.
 */
export interface BodySpec {
  name: string;
  key?: string;
  mass: number;
  /** Real physical radius (AU). PHYSICAL MODEL. */
  physicalRadius: number;
  /** Display-only radius (AU). VISUAL APPROXIMATION. Optional. */
  renderRadius?: number;
  /** Collision radius (AU). Defaults to physicalRadius. */
  collisionRadius?: number;
  /** @deprecated v1 saves only. Migrated to physicalRadius + renderRadius. */
  radius?: number;
  x: number;
  y: number;
  z?: number;
  vx: number;
  vy: number;
  vz?: number;
  color: string;
  isStar?: boolean;
  isBlackHole?: boolean;
  noCollide?: boolean;
  ring?: boolean;
  userLaunched?: boolean;
  fixed?: boolean;
  /**
   * massive:        mutual N-body (default)
   * test-particle:  feels massive bodies, does not source gravity
   */
  gravityMode?: GravityMode;
}

export interface Body extends BodySpec {
  id: number;
  z: number;
  vz: number;
  ax: number;
  ay: number;
  az: number;
  physicalRadius: number;
  collisionRadius: number;
  renderRadius: number;
  gravityMode: GravityMode;
  createdAt: number;
  trail: Float32Array;
  trailHead: number;
  trailCount: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface StateVector {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface SimEvent {
  type: 'collision' | 'escaped' | 'roche' | 'tde';
  time: number;
  survivor?: Body;
  absorbed?: Body;
  body?: Body;
  primary?: Body;
  secondary?: Body;
  separationAU?: number;
  rocheAU?: number;
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  viewRadius: number;
  bodies: BodySpec[];
  dt?: number;
  softening?: number;
  /** ISO-8601 epoch. If set, UI shows a simulation calendar date. */
  epoch?: string | null;
}

export interface IntegratorWorld {
  bodies: Body[];
  dt: number;
  computeAccel: () => void;
}

export interface Integrator {
  readonly name: string;
  step(world: IntegratorWorld): void;
}
