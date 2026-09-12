/**
 * Uniform 3D spatial hash. Broad-phase only — not a physical model.
 * Used to avoid O(N²) pair scans for encounters / tides / collisions.
 */

const HASH_X = 73856093;
const HASH_Y = 19349663;
const HASH_Z = 83492791;

export class SpatialHash3D {
  readonly cell: number;
  private grid = new Map<number, number[]>();

  constructor(cell: number) {
    this.cell = Number.isFinite(cell) && cell > 0 ? cell : 1e-4;
  }

  clear(): void {
    this.grid.clear();
  }

  insert(i: number, x: number, y: number, z: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    const key = this.keyAt(x, y, z);
    const arr = this.grid.get(key);
    if (arr) arr.push(i);
    else this.grid.set(key, [i]);
  }

  private keyAt(x: number, y: number, z: number): number {
    const ix = Math.floor(x / this.cell);
    const iy = Math.floor(y / this.cell);
    const iz = Math.floor(z / this.cell);
    return ((ix * HASH_X) ^ (iy * HASH_Y) ^ (iz * HASH_Z)) | 0;
  }

  /**
   * Neighbor indices in the 27 adjacent cells. Does not de-duplicate across
   * cells; callers should skip j <= i / self.
   */
  queryCellNeighbors(x: number, y: number, z: number): number[] {
    const ix = Math.floor(x / this.cell);
    const iy = Math.floor(y / this.cell);
    const iz = Math.floor(z / this.cell);
    const out: number[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const key = (((ix + dx) * HASH_X) ^ ((iy + dy) * HASH_Y) ^ ((iz + dz) * HASH_Z)) | 0;
          const arr = this.grid.get(key);
          if (!arr) continue;
          for (let k = 0; k < arr.length; k++) out.push(arr[k]);
        }
      }
    }
    return out;
  }
}

export function hashKey(ix: number, iy: number, iz: number): number {
  return ((ix * HASH_X) ^ (iy * HASH_Y) ^ (iz * HASH_Z)) | 0;
}
