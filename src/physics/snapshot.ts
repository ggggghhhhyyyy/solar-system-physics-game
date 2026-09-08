import type { Engine } from './engine';
import type { BodySpec } from './types';

// 快照 body:标准 BodySpec + 年龄(年)
export type SnapshotBody = BodySpec & { age: number };

export interface SnapshotJSON {
  version: 1;
  time: number;
  bodies: SnapshotBody[];
}

// 导出当前引擎状态为纯 JSON(不含 trail/加速度)
export function exportSnapshot(engine: Engine): SnapshotJSON {
  return {
    version: 1,
    time: engine.time,
    bodies: engine.bodies.map((b) => ({
      name: b.name,
      key: b.key,
      mass: b.mass,
      radius: b.radius,
      x: b.x,
      y: b.y,
      vx: b.vx,
      vy: b.vy,
      color: b.color,
      isStar: b.isStar,
      isBlackHole: b.isBlackHole,
      noCollide: b.noCollide,
      ring: b.ring,
      userLaunched: b.userLaunched,
      fixed: b.fixed,
      age: engine.time - b.createdAt,
    })),
  };
}

/**
 * 用快照重建引擎(调用 engine.reset)。
 * v1 局限:time 会归零;body id 重新分配;createdAt 归零导致年龄/任务计时重计。
 */
export function restoreSnapshot(engine: Engine, data: SnapshotJSON): void {
  const specs: BodySpec[] = data.bodies.map((b) => ({
    name: b.name,
    key: b.key,
    mass: b.mass,
    radius: b.radius,
    x: b.x,
    y: b.y,
    vx: b.vx,
    vy: b.vy,
    color: b.color,
    isStar: b.isStar,
    isBlackHole: b.isBlackHole,
    noCollide: b.noCollide,
    ring: b.ring,
    userLaunched: b.userLaunched,
    fixed: b.fixed,
  }));
  engine.reset(specs);
}

// 快照→JSON 字符串,失败返回空字符串
export function serializeSnapshot(data: SnapshotJSON): string {
  try {
    return JSON.stringify(data);
  } catch {
    return '';
  }
}

function isSnapshotBody(v: unknown): v is SnapshotBody {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o['name'] === 'string' &&
    typeof o['mass'] === 'number' &&
    typeof o['radius'] === 'number' &&
    typeof o['x'] === 'number' &&
    typeof o['y'] === 'number' &&
    typeof o['vx'] === 'number' &&
    typeof o['vy'] === 'number' &&
    typeof o['color'] === 'string' &&
    typeof o['age'] === 'number'
  );
}

// JSON 字符串→快照,非法返回 null
export function parseSnapshot(raw: string): SnapshotJSON | null {
  try {
    if (typeof raw !== 'string' || raw.length === 0) return null;
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (o['version'] !== 1) return null;
    if (typeof o['time'] !== 'number' || !Number.isFinite(o['time'])) return null;
    if (!Array.isArray(o['bodies'])) return null;
    const bodies = o['bodies'] as unknown[];
    for (const b of bodies) if (!isSnapshotBody(b)) return null;
    return { version: 1, time: o['time'] as number, bodies: bodies as SnapshotBody[] };
  } catch {
    return null;
  }
}
