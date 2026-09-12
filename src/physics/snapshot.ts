import type { Engine } from './engine.ts';
import { resolveRadii } from './engine.ts';
import type { BodySpec, GravityMode } from './types.ts';

export type SnapshotBody = BodySpec & { age: number };

export type SnapshotJSON = SnapshotV1 | SnapshotV2;

interface SnapshotV1Body {
  name: string;
  key?: string;
  mass: number;
  radius: number;
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
  gravityMode?: GravityMode;
  age: number;
}

interface SnapshotV1 {
  version: 1;
  time: number;
  bodies: SnapshotV1Body[];
}

interface SnapshotV2 {
  version: 2;
  time: number;
  epoch: string | null;
  bodies: SnapshotBody[];
}

export function exportSnapshot(engine: Engine): SnapshotV2 {
  return {
    version: 2,
    time: engine.time,
    epoch: engine.epoch,
    bodies: engine.bodies.map((b) => ({
      name: b.name,
      key: b.key,
      mass: b.mass,
      physicalRadius: b.physicalRadius,
      renderRadius: b.renderRadius,
      collisionRadius: b.collisionRadius,
      x: b.x,
      y: b.y,
      z: b.z,
      vx: b.vx,
      vy: b.vy,
      vz: b.vz,
      color: b.color,
      isStar: b.isStar,
      isBlackHole: b.isBlackHole,
      noCollide: b.noCollide,
      ring: b.ring,
      userLaunched: b.userLaunched,
      fixed: b.fixed,
      gravityMode: b.gravityMode,
      age: engine.time - b.createdAt,
    })),
  };
}

/**
 * Rebuild engine from a snapshot. v1 saves are migrated (legacy `radius`
 * becomes both physical and render — we do NOT reinterpret inflated
 * display radii as real sizes). Simulation time and body ages are restored.
 */
export function restoreSnapshot(engine: Engine, data: SnapshotJSON): void {
  const epoch = data.version === 2 ? data.epoch : engine.epoch;
  const specs: BodySpec[] = data.bodies.map((b) => migrateBody(b, data.version));
  engine.reset(specs, { epoch: epoch ?? null });
  engine.time = data.time;
  for (let i = 0; i < engine.bodies.length; i++) {
    const age = data.bodies[i]?.age;
    engine.bodies[i].createdAt = data.time - (typeof age === 'number' && Number.isFinite(age) ? age : 0);
  }
  engine.captureBaseline();
}

function migrateBody(b: SnapshotBody | SnapshotV1Body, version: 1 | 2): BodySpec {
  if (version === 1) {
    const v1 = b as SnapshotV1Body;
    const r = v1.radius;
    return {
      name: b.name,
      key: b.key,
      mass: b.mass,
      physicalRadius: r,
      renderRadius: r,
      collisionRadius: r,
      x: b.x,
      y: b.y,
      z: b.z ?? 0,
      vx: b.vx,
      vy: b.vy,
      vz: b.vz ?? 0,
      color: b.color,
      isStar: b.isStar,
      isBlackHole: b.isBlackHole,
      noCollide: b.noCollide,
      ring: b.ring,
      userLaunched: b.userLaunched,
      fixed: b.fixed,
      gravityMode: (b.gravityMode as GravityMode | undefined) ?? (b.noCollide ? 'test-particle' : 'massive'),
    };
  }
  const v2 = b as SnapshotBody;
  const radii = resolveRadii({
    ...v2,
    physicalRadius: v2.physicalRadius,
    renderRadius: v2.renderRadius,
    collisionRadius: v2.collisionRadius,
    radius: v2.radius,
  });
  return {
    name: v2.name,
    key: v2.key,
    mass: v2.mass,
    physicalRadius: radii.physicalRadius,
    renderRadius: radii.renderRadius,
    collisionRadius: radii.collisionRadius,
    x: v2.x,
    y: v2.y,
    z: v2.z ?? 0,
    vx: v2.vx,
    vy: v2.vy,
    vz: v2.vz ?? 0,
    color: v2.color,
    isStar: v2.isStar,
    isBlackHole: v2.isBlackHole,
    noCollide: v2.noCollide,
    ring: v2.ring,
    userLaunched: v2.userLaunched,
    fixed: v2.fixed,
    gravityMode: v2.gravityMode ?? 'massive',
  };
}

export function serializeSnapshot(data: SnapshotJSON): string {
  try {
    return JSON.stringify(data);
  } catch {
    return '';
  }
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isSnapshotBody(v: unknown, version: 1 | 2): v is SnapshotBody {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o['name'] !== 'string') return false;
  if (!isFiniteNum(o['mass']) || !isFiniteNum(o['x']) || !isFiniteNum(o['y'])) return false;
  if (!isFiniteNum(o['vx']) || !isFiniteNum(o['vy'])) return false;
  if (typeof o['color'] !== 'string' || !isFiniteNum(o['age'])) return false;
  if (version === 1) return isFiniteNum(o['radius']);
  return isFiniteNum(o['physicalRadius']) || isFiniteNum(o['radius']);
}

export function parseSnapshot(raw: string): SnapshotJSON | null {
  try {
    if (typeof raw !== 'string' || raw.length === 0) return null;
    const o = JSON.parse(raw) as Record<string, unknown>;
    const version = o['version'];
    if (version !== 1 && version !== 2) return null;
    if (!isFiniteNum(o['time'])) return null;
    if (!Array.isArray(o['bodies'])) return null;
    const bodies = o['bodies'] as unknown[];
    for (const b of bodies) if (!isSnapshotBody(b, version)) return null;
    if (version === 1) {
      return { version: 1, time: o['time'] as number, bodies: bodies as SnapshotV1['bodies'] };
    }
    const epoch = o['epoch'] == null ? null : typeof o['epoch'] === 'string' ? o['epoch'] : null;
    return { version: 2, time: o['time'] as number, epoch, bodies: bodies as SnapshotBody[] };
  } catch {
    return null;
  }
}
