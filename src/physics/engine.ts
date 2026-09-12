import {
  BH_THRESHOLD,
  BH_THETA,
  G0,
  GRID_MIN,
  GRID_THRESHOLD,
  HASH_X,
  HASH_Y,
  HASH_Z,
  R_SCHWARZSCHILD_SUN_AU,
  TRAIL_MAX,
} from './constants.ts';
import {
  computeConservation,
  computeDrift,
  type ConservationSnapshot,
  type DriftReport,
} from './diagnostics/conservation.ts';
import { leapfrog } from './integrators/leapfrog.ts';
import { addForceFromOctree, OctNode } from './octree.ts';
import { classicalElements, type ClassicalElements } from './orbital/elements.ts';
import { rocheLimitAU } from './orbital/roche.ts';
import type { Body, BodySpec, GravityMode, Integrator, SimEvent, StateVector } from './types.ts';
import { finite3 } from './vec.ts';

export { G0, TRAIL_MAX };

function schwarzschildAU(mass: number): number {
  return R_SCHWARZSCHILD_SUN_AU * Math.max(mass, 0);
}

export function resolveRadii(spec: BodySpec): {
  physicalRadius: number;
  collisionRadius: number;
  renderRadius: number;
} {
  const physical =
    spec.physicalRadius ??
    (spec.isBlackHole ? schwarzschildAU(spec.mass) : (spec.radius ?? 0));
  const collision = spec.collisionRadius ?? physical;
  const render = spec.renderRadius ?? spec.radius ?? physical;
  return {
    physicalRadius: physical,
    collisionRadius: collision,
    renderRadius: render,
  };
}

function resolveGravityMode(spec: BodySpec): GravityMode {
  if (spec.gravityMode) return spec.gravityMode;
  return 'massive';
}

export class Engine {
  bodies: Body[] = [];
  time = 0;
  dt = 0.0002;
  softening = 0.003;
  gMultiplier = 1;
  collisionsEnabled = true;
  /** Arcade-only: if true, callers may inflate collisionRadius. Default off. */
  arcadeCollisions = false;
  trailInterval = 0.0025;
  escapeDistance = 400;
  integrator: Integrator = leapfrog;
  /** ISO-8601 epoch. Null → UI shows T+ elapsed. */
  epoch: string | null = null;
  /**
   * Split a step into n leapfrog substeps when an encounter timescale
   * is shorter than dt. Each substep still uses the symplectic KDK kick.
   * Off by default so game presets do not change.
   */
  adaptiveDt = false;
  maxSubsteps = 16;

  private events: SimEvent[] = [];
  private nextId = 1;
  private lastTrailTime = 0;
  private needAccel = true;
  private baseline: ConservationSnapshot | null = null;
  private tideInside = new Set<string>();

  private sx = new Float64Array(0);
  private sy = new Float64Array(0);
  private sz = new Float64Array(0);
  private sm = new Float64Array(0);
  private sax = new Float64Array(0);
  private say = new Float64Array(0);
  private saz = new Float64Array(0);
  private sr = new Float64Array(0);

  get G(): number {
    return G0 * this.gMultiplier;
  }

  /** Years since reset. */
  get elapsedTime(): number {
    return this.time;
  }

  /** Wall-clock simulation date, or null when no epoch is set. */
  get simulationDate(): Date | null {
    if (!this.epoch) return null;
    const t0 = Date.parse(this.epoch);
    if (!Number.isFinite(t0)) return null;
    return new Date(t0 + this.time * 365.25 * 86_400_000);
  }

  private ensureBuffers(n: number): void {
    if (this.sx.length >= n) return;
    const cap = Math.max(n, 64) * 2;
    this.sx = new Float64Array(cap);
    this.sy = new Float64Array(cap);
    this.sz = new Float64Array(cap);
    this.sm = new Float64Array(cap);
    this.sax = new Float64Array(cap);
    this.say = new Float64Array(cap);
    this.saz = new Float64Array(cap);
  }

  private makeBody(spec: BodySpec): Body {
    const radii = resolveRadii(spec);
    return {
      name: spec.name,
      key: spec.key,
      mass: spec.mass,
      physicalRadius: radii.physicalRadius,
      collisionRadius: this.arcadeCollisions
        ? radii.collisionRadius
        : radii.physicalRadius,
      renderRadius: radii.renderRadius,
      x: spec.x,
      y: spec.y,
      z: spec.z ?? 0,
      vx: spec.vx,
      vy: spec.vy,
      vz: spec.vz ?? 0,
      color: spec.color,
      isStar: !!spec.isStar && !spec.isBlackHole,
      isBlackHole: !!spec.isBlackHole,
      noCollide: !!spec.noCollide,
      ring: !!spec.ring,
      userLaunched: !!spec.userLaunched,
      fixed: !!spec.fixed,
      gravityMode: resolveGravityMode(spec),
      id: this.nextId++,
      ax: 0,
      ay: 0,
      az: 0,
      createdAt: this.time,
      trail: new Float32Array(TRAIL_MAX * 2),
      trailHead: 0,
      trailCount: 0,
    };
  }

  reset(specs: BodySpec[], opts?: { epoch?: string | null }): void {
    this.time = 0;
    this.lastTrailTime = 0;
    this.events = [];
    this.nextId = 1;
    this.bodies = specs.map((s) => this.makeBody(s));
    this.needAccel = true;
    this.tideInside.clear();
    if (opts && 'epoch' in opts) this.epoch = opts.epoch ?? null;
    this.computeAccel();
    this.baseline = computeConservation(this.bodies, this.G, this.softening);
  }

  addBody(spec: BodySpec): Body {
    const b = this.makeBody(spec);
    this.bodies.push(b);
    this.needAccel = true;
    return b;
  }

  removeBody(id: number): void {
    this.bodies = this.bodies.filter((b) => b.id !== id);
    this.needAccel = true;
  }

  getBody(id: number | null): Body | undefined {
    if (id == null) return undefined;
    return this.bodies.find((b) => b.id === id);
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  heaviest(): Body | undefined {
    let best: Body | undefined;
    for (const b of this.bodies) if (!best || b.mass > best.mass) best = b;
    return best;
  }

  clearTrails(): void {
    for (const b of this.bodies) {
      b.trailHead = 0;
      b.trailCount = 0;
    }
  }

  captureBaseline(): void {
    this.baseline = computeConservation(this.bodies, this.G, this.softening);
  }

  /** Public hook for tests / adapters. Does not advance time. */
  refreshAccel(): void {
    this.computeAccel();
  }

  diagnostics(): DriftReport {
    const current = computeConservation(this.bodies, this.G, this.softening);
    return computeDrift(current, this.baseline);
  }

  applyStateVector(id: number, sv: StateVector): boolean {
    const b = this.getBody(id);
    if (!b) return false;
    b.x = sv.x;
    b.y = sv.y;
    b.z = sv.z;
    b.vx = sv.vx;
    b.vy = sv.vy;
    b.vz = sv.vz;
    this.needAccel = true;
    return true;
  }

  orbitalElements(body: Body, ref: Body): ClassicalElements {
    return classicalElements(
      { x: body.x - ref.x, y: body.y - ref.y, z: body.z - ref.z },
      { x: body.vx - ref.vx, y: body.vy - ref.vy, z: body.vz - ref.vz },
      this.G * (ref.mass + body.mass),
    );
  }

  private isMassive(b: Body): boolean {
    return b.gravityMode !== 'test-particle' && b.mass > 0;
  }

  private computeAccel(): void {
    const bs = this.bodies;
    const n = bs.length;
    const G = this.G;
    const eps2 = this.softening * this.softening;
    this.ensureBuffers(n);

    const massiveIdx: number[] = [];
    const testIdx: number[] = [];
    for (let i = 0; i < n; i++) {
      if (this.isMassive(bs[i])) massiveIdx.push(i);
      else testIdx.push(i);
    }

    const xs = this.sx;
    const ys = this.sy;
    const zs = this.sz;
    const ms = this.sm;
    const axs = this.sax;
    const ays = this.say;
    const azs = this.saz;
    for (let i = 0; i < n; i++) {
      const b = bs[i];
      xs[i] = b.x;
      ys[i] = b.y;
      zs[i] = b.z;
      ms[i] = b.mass;
      axs[i] = 0;
      ays[i] = 0;
      azs[i] = 0;
    }

    const nM = massiveIdx.length;
    if (nM > BH_THRESHOLD) {
      this.computeAccelBarnesHut(massiveIdx, testIdx);
      return;
    }

    for (let a = 0; a < nM; a++) {
      const i = massiveIdx[a];
      const xi = xs[i];
      const yi = ys[i];
      const zi = zs[i];
      const miG = ms[i] * G;
      let ax = 0;
      let ay = 0;
      let az = 0;
      for (let b = a + 1; b < nM; b++) {
        const j = massiveIdx[b];
        const dx = xs[j] - xi;
        const dy = ys[j] - yi;
        const dz = zs[j] - zi;
        const r2 = dx * dx + dy * dy + dz * dz + eps2;
        const inv = 1 / (r2 * Math.sqrt(r2));
        const fx = dx * inv;
        const fy = dy * inv;
        const fz = dz * inv;
        const mjG = ms[j] * G;
        ax += mjG * fx;
        ay += mjG * fy;
        az += mjG * fz;
        axs[j] -= miG * fx;
        ays[j] -= miG * fy;
        azs[j] -= miG * fz;
      }
      axs[i] += ax;
      ays[i] += ay;
      azs[i] += az;
    }

    for (let t = 0; t < testIdx.length; t++) {
      const i = testIdx[t];
      const xi = xs[i];
      const yi = ys[i];
      const zi = zs[i];
      if (!finite3(xi, yi, zi)) continue;
      let ax = 0;
      let ay = 0;
      let az = 0;
      for (let a = 0; a < nM; a++) {
        const j = massiveIdx[a];
        const dx = xs[j] - xi;
        const dy = ys[j] - yi;
        const dz = zs[j] - zi;
        const r2 = dx * dx + dy * dy + dz * dz + eps2;
        const inv = 1 / (r2 * Math.sqrt(r2));
        const mjG = ms[j] * G;
        ax += mjG * dx * inv;
        ay += mjG * dy * inv;
        az += mjG * dz * inv;
      }
      axs[i] = ax;
      ays[i] = ay;
      azs[i] = az;
    }

    for (let i = 0; i < n; i++) {
      if (!finite3(xs[i], ys[i], zs[i])) {
        bs[i].ax = 0;
        bs[i].ay = 0;
        bs[i].az = 0;
      } else {
        bs[i].ax = axs[i];
        bs[i].ay = ays[i];
        bs[i].az = azs[i];
      }
    }
    this.needAccel = false;
  }

  private computeAccelBarnesHut(massiveIdx: number[], testIdx: number[]): void {
    const bs = this.bodies;
    const n = bs.length;
    const G = this.G;
    const eps2 = this.softening * this.softening;
    const xs = this.sx;
    const ys = this.sy;
    const zs = this.sz;
    const ms = this.sm;
    const axs = this.sax;
    const ays = this.say;
    const azs = this.saz;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const i of massiveIdx) {
      const x = xs[i];
      const y = ys[i];
      const z = zs[i];
      if (!finite3(x, y, z)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    if (minX === Infinity) {
      for (let i = 0; i < n; i++) {
        bs[i].ax = 0;
        bs[i].ay = 0;
        bs[i].az = 0;
      }
      this.needAccel = false;
      return;
    }
    const range = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    const half = Math.max(range / 2, 1e-9) * 1.05 + 1e-9;
    const root = new OctNode(
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (minZ + maxZ) / 2,
      half,
    );
    for (const i of massiveIdx) {
      if (!finite3(xs[i], ys[i], zs[i])) continue;
      if (!(ms[i] > 0)) continue;
      root.insert(i, xs, ys, zs, ms);
    }

    const query = (i: number) => {
      if (!finite3(xs[i], ys[i], zs[i])) {
        axs[i] = 0;
        ays[i] = 0;
        azs[i] = 0;
        return;
      }
      addForceFromOctree(root, i, xs[i], ys[i], zs[i], eps2, G, BH_THETA, axs, ays, azs);
    };
    for (const i of massiveIdx) query(i);
    for (const i of testIdx) query(i);

    for (let i = 0; i < n; i++) {
      bs[i].ax = axs[i];
      bs[i].ay = ays[i];
      bs[i].az = azs[i];
    }
    this.needAccel = false;
  }

  suggestedSubsteps(): number {
    if (!this.adaptiveDt) return 1;
    let tau = Infinity;
    const bs = this.bodies;
    const n = bs.length;
    for (let i = 0; i < n; i++) {
      const a = bs[i];
      for (let j = i + 1; j < n; j++) {
        const b = bs[j];
        if (a.noCollide && b.noCollide) continue;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dz = a.z - b.z;
        const r = Math.hypot(dx, dy, dz);
        if (!(r > 0) || !Number.isFinite(r)) continue;
        const v = Math.hypot(a.vx - b.vx, a.vy - b.vy, a.vz - b.vz);
        if (v > 1e-18) {
          const t = r / v;
          if (t < tau) tau = t;
        }
      }
    }
    if (!Number.isFinite(tau)) return 1;
    const target = Math.max(tau * 0.05, this.dt / this.maxSubsteps);
    return Math.max(1, Math.min(this.maxSubsteps, Math.ceil(this.dt / target)));
  }

  private pairTideKey(a: Body, b: Body): string {
    return a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
  }

  private scanTides(): void {
    const bs = this.bodies;
    const n = bs.length;
    const inside = new Set<string>();
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = bs[i];
        const b = bs[j];
        const primary = a.mass >= b.mass ? a : b;
        const sat = primary === a ? b : a;
        if (!(sat.mass > 0) || sat.isBlackHole) continue;
        const d = rocheLimitAU(primary, sat, 'fluid');
        if (d == null) continue;
        const r = Math.hypot(sat.x - primary.x, sat.y - primary.y, sat.z - primary.z);
        if (!(r < d)) continue;
        const key = this.pairTideKey(a, b);
        inside.add(key);
        if (this.tideInside.has(key)) continue;
        const tde = !!primary.isBlackHole && r > primary.physicalRadius;
        this.events.push({
          type: tde ? 'tde' : 'roche',
          time: this.time,
          primary,
          secondary: sat,
          separationAU: r,
          rocheAU: d,
        });
      }
    }
    this.tideInside = inside;
  }

  step(): void {
    const nSub = this.suggestedSubsteps();
    const h = this.dt / nSub;
    const saved = this.dt;
    this.dt = h;
    for (let s = 0; s < nSub; s++) {
      if (this.needAccel) this.computeAccel();
      this.integrator.step({
        bodies: this.bodies,
        dt: h,
        computeAccel: () => this.computeAccel(),
      });
      this.time += h;
      if (this.collisionsEnabled) this.handleCollisions();
    }
    this.dt = saved;
    this.removeEscapees();
    this.scanTides();

    if (this.time - this.lastTrailTime >= this.trailInterval) {
      this.lastTrailTime = this.time;
      for (const b of this.bodies) {
        const h2 = b.trailHead;
        b.trail[h2 * 2] = b.x;
        b.trail[h2 * 2 + 1] = b.y;
        b.trailHead = (h2 + 1) % TRAIL_MAX;
        if (b.trailCount < TRAIL_MAX) b.trailCount++;
      }
    }
  }

  advance(years: number, maxSteps = 600): void {
    let steps = Math.round(years / this.dt);
    if (steps > maxSteps) steps = maxSteps;
    for (let i = 0; i < steps; i++) this.step();
  }

  private removeEscapees(): void {
    const ref = this.heaviest();
    if (!ref) return;
    const lim2 = this.escapeDistance * this.escapeDistance;
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const b = this.bodies[i];
      if (b === ref) continue;
      const dx = b.x - ref.x;
      const dy = b.y - ref.y;
      const dz = b.z - ref.z;
      if (dx * dx + dy * dy + dz * dz > lim2) {
        this.bodies.splice(i, 1);
        this.events.push({ type: 'escaped', time: this.time, body: b });
        this.needAccel = true;
      }
    }
  }

  private handleCollisions(): void {
    if (this.bodies.length > GRID_THRESHOLD) {
      this.handleCollisionsHashed();
      return;
    }
    let merged = true;
    while (merged) {
      merged = false;
      const bs = this.bodies;
      const n = bs.length;
      this.ensureBuffers(n);
      if (this.sr.length < n) this.sr = new Float64Array(Math.max(n, 64) * 2);
      const xs = this.sx;
      const ys = this.sy;
      const zs = this.sz;
      const rs = this.sr;
      for (let i = 0; i < n; i++) {
        xs[i] = bs[i].x;
        ys[i] = bs[i].y;
        zs[i] = bs[i].z;
        rs[i] = bs[i].collisionRadius;
      }
      outer: for (let i = 0; i < n; i++) {
        const iNC = bs[i].noCollide;
        for (let j = i + 1; j < n; j++) {
          if (iNC && bs[j].noCollide) continue;
          if (this.pairHits(i, j, xs, ys, zs, rs, bs)) {
            this.merge(bs[i], bs[j]);
            merged = true;
            break outer;
          }
        }
      }
    }
  }

  private pairHits(
    i: number,
    j: number,
    xs: Float64Array,
    ys: Float64Array,
    zs: Float64Array,
    rs: Float64Array,
    bs: Body[],
  ): boolean {
    const dx = xs[i] - xs[j];
    const dy = ys[i] - ys[j];
    const dz = zs[i] - zs[j];
    const rr = rs[i] + rs[j];
    const r2 = dx * dx + dy * dy + dz * dz;
    if (r2 < rr * rr) return true;
    const dvx = bs[i].vx - bs[j].vx;
    const dvy = bs[i].vy - bs[j].vy;
    const dvz = bs[i].vz - bs[j].vz;
    const dt = this.dt;
    const pdx = dx - dvx * dt;
    const pdy = dy - dvy * dt;
    const pdz = dz - dvz * dt;
    const sx = dx - pdx;
    const sy = dy - pdy;
    const sz = dz - pdz;
    const seg2 = sx * sx + sy * sy + sz * sz;
    if (seg2 < 1e-30) return false;
    let t = -((pdx * sx + pdy * sy + pdz * sz) / seg2);
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const cx = pdx + t * sx;
    const cy = pdy + t * sy;
    const cz = pdz + t * sz;
    return cx * cx + cy * cy + cz * cz < rr * rr;
  }

  private handleCollisionsHashed(): void {
    let merged = true;
    while (merged) {
      merged = false;
      const bs = this.bodies;
      const n = bs.length;
      if (n < 2) return;
      this.ensureBuffers(n);
      if (this.sr.length < n) this.sr = new Float64Array(Math.max(n, 64) * 2);
      const xs = this.sx;
      const ys = this.sy;
      const zs = this.sz;
      const rs = this.sr;
      for (let i = 0; i < n; i++) {
        xs[i] = bs[i].x;
        ys[i] = bs[i].y;
        zs[i] = bs[i].z;
        rs[i] = bs[i].collisionRadius;
      }
      let maxR = 0;
      for (let i = 0; i < n; i++) if (rs[i] > maxR) maxR = rs[i];
      let cell = maxR * 4;
      if (!Number.isFinite(cell) || cell < GRID_MIN) cell = GRID_MIN;
      const grid = new Map<number, number[]>();
      for (let i = 0; i < n; i++) {
        if (!finite3(xs[i], ys[i], zs[i])) continue;
        const ix = Math.floor(xs[i] / cell);
        const iy = Math.floor(ys[i] / cell);
        const iz = Math.floor(zs[i] / cell);
        const key = ((ix * HASH_X) ^ (iy * HASH_Y) ^ (iz * HASH_Z)) | 0;
        const arr = grid.get(key);
        if (arr) arr.push(i);
        else grid.set(key, [i]);
      }
      outer: for (let i = 0; i < n; i++) {
        if (!finite3(xs[i], ys[i], zs[i])) continue;
        const ix = Math.floor(xs[i] / cell);
        const iy = Math.floor(ys[i] / cell);
        const iz = Math.floor(zs[i] / cell);
        let cand: number[] | null = null;
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
              const key =
                (((ix + dx) * HASH_X) ^ ((iy + dy) * HASH_Y) ^ ((iz + dz) * HASH_Z)) | 0;
              const arr = grid.get(key);
              if (!arr) continue;
              for (let k = 0; k < arr.length; k++) {
                const j = arr[k];
                if (j <= i) continue;
                if (cand === null) cand = [];
                cand.push(j);
              }
            }
          }
        }
        if (cand === null) continue;
        cand.sort((a, b) => a - b);
        let prev = -1;
        for (let k = 0; k < cand.length; k++) {
          const j = cand[k];
          if (j === prev) continue;
          prev = j;
          if (bs[i].noCollide && bs[j].noCollide) continue;
          if (this.pairHits(i, j, xs, ys, zs, rs, bs)) {
            this.merge(bs[i], bs[j]);
            merged = true;
            break outer;
          }
        }
      }
    }
  }

  private merge(a: Body, b: Body): void {
    const survivor = a.mass >= b.mass ? a : b;
    const other = survivor === a ? b : a;
    const total = a.mass + b.mass;
    if (total > 0 && !survivor.fixed) {
      survivor.vx = (a.mass * a.vx + b.mass * b.vx) / total;
      survivor.vy = (a.mass * a.vy + b.mass * b.vy) / total;
      survivor.vz = (a.mass * a.vz + b.mass * b.vz) / total;
      survivor.x = (a.mass * a.x + b.mass * b.x) / total;
      survivor.y = (a.mass * a.y + b.mass * b.y) / total;
      survivor.z = (a.mass * a.z + b.mass * b.z) / total;
    }
    const oldMass = survivor.mass;
    survivor.mass = total;
    survivor.noCollide = a.noCollide && b.noCollide;
    if (survivor.gravityMode === 'test-particle' && other.gravityMode === 'massive') {
      survivor.gravityMode = 'massive';
    } else if (other.gravityMode === 'test-particle' && survivor.gravityMode === 'massive') {
      // keep massive
    } else if (survivor.gravityMode === 'test-particle' && other.gravityMode === 'test-particle') {
      survivor.gravityMode = 'test-particle';
    }

    if (survivor.isBlackHole || other.isBlackHole) {
      survivor.physicalRadius = schwarzschildAU(total);
      survivor.collisionRadius = this.arcadeCollisions
        ? survivor.collisionRadius
        : survivor.physicalRadius;
      if (oldMass > 0) {
        survivor.renderRadius *= Math.cbrt(total / oldMass);
      } else {
        survivor.renderRadius = Math.cbrt(survivor.renderRadius ** 3 + other.renderRadius ** 3);
      }
      survivor.isBlackHole = true;
      survivor.isStar = false;
    } else {
      survivor.physicalRadius = Math.cbrt(
        survivor.physicalRadius ** 3 + other.physicalRadius ** 3,
      );
      survivor.collisionRadius = this.arcadeCollisions
        ? Math.cbrt(survivor.collisionRadius ** 3 + other.collisionRadius ** 3)
        : survivor.physicalRadius;
      survivor.renderRadius = Math.cbrt(survivor.renderRadius ** 3 + other.renderRadius ** 3);
    }
    if (other.isStar && !survivor.isStar && other.mass > survivor.mass * 0.5) {
      survivor.isStar = true;
    }
    this.bodies = this.bodies.filter((x) => x !== other);
    this.events.push({ type: 'collision', time: this.time, survivor, absorbed: other });
    this.needAccel = true;
  }

  /**
   * Picking uses a caller-supplied hit radius (typically the on-screen visual
   * radius in AU), never physicalRadius. UI must pass visual scale.
   */
  bodyAt(wx: number, wy: number, hitRadiusAU: (b: Body) => number): Body | undefined {
    let best: Body | undefined;
    let bestD = Infinity;
    for (const b of this.bodies) {
      const dx = b.x - wx;
      const dy = b.y - wy;
      const d = Math.hypot(dx, dy);
      const hit = hitRadiusAU(b);
      if (d < hit && d < bestD) {
        best = b;
        bestD = d;
      }
    }
    return best;
  }

  specificEnergy(b: { x: number; y: number; z?: number; vx: number; vy: number; vz?: number; mass?: number }, ref: Body): number {
    const dx = b.x - ref.x;
    const dy = b.y - ref.y;
    const dz = (b.z ?? 0) - ref.z;
    const dvx = b.vx - ref.vx;
    const dvy = b.vy - ref.vy;
    const dvz = (b.vz ?? 0) - ref.vz;
    const r = Math.hypot(dx, dy, dz);
    const m = b.mass ?? 0;
    return 0.5 * (dvx * dvx + dvy * dvy + dvz * dvz) - (this.G * (ref.mass + m)) / Math.max(r, 1e-6);
  }

  predict(
    spec: { x: number; y: number; z?: number; vx: number; vy: number; vz?: number; mass: number },
    steps = 700,
    stride = 3,
    dtMul = 4,
  ): number[] {
    const massive = this.bodies.length > 40
      ? this.bodies.filter((b) => this.isMassive(b) && b.mass > 1e-8)
      : this.bodies.filter((b) => this.isMassive(b));
    const n = massive.length + 1;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    const zs = new Float64Array(n);
    const vxs = new Float64Array(n);
    const vys = new Float64Array(n);
    const vzs = new Float64Array(n);
    const ms = new Float64Array(n);
    const fixed = new Uint8Array(n);
    const axs = new Float64Array(n);
    const ays = new Float64Array(n);
    const azs = new Float64Array(n);
    massive.forEach((b, i) => {
      xs[i] = b.x;
      ys[i] = b.y;
      zs[i] = b.z;
      vxs[i] = b.vx;
      vys[i] = b.vy;
      vzs[i] = b.vz;
      ms[i] = b.mass;
      fixed[i] = b.fixed ? 1 : 0;
    });
    const t = n - 1;
    xs[t] = spec.x;
    ys[t] = spec.y;
    zs[t] = spec.z ?? 0;
    vxs[t] = spec.vx;
    vys[t] = spec.vy;
    vzs[t] = spec.vz ?? 0;
    ms[t] = spec.mass;

    const G = this.G;
    const eps2 = this.softening * this.softening;
    const dt = this.dt * dtMul;
    const half = dt / 2;
    const accel = () => {
      axs.fill(0);
      ays.fill(0);
      azs.fill(0);
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const dx = xs[j] - xs[i];
          const dy = ys[j] - ys[i];
          const dz = zs[j] - zs[i];
          const r2 = dx * dx + dy * dy + dz * dz + eps2;
          const inv = 1 / (r2 * Math.sqrt(r2));
          const f = G * inv;
          axs[i] += f * ms[j] * dx;
          ays[i] += f * ms[j] * dy;
          azs[i] += f * ms[j] * dz;
          axs[j] -= f * ms[i] * dx;
          ays[j] -= f * ms[i] * dy;
          azs[j] -= f * ms[i] * dz;
        }
      }
    };
    const out: number[] = [xs[t], ys[t]];
    accel();
    for (let s = 1; s <= steps; s++) {
      for (let i = 0; i < n; i++) {
        if (fixed[i]) continue;
        vxs[i] += axs[i] * half;
        vys[i] += ays[i] * half;
        vzs[i] += azs[i] * half;
        xs[i] += vxs[i] * dt;
        ys[i] += vys[i] * dt;
        zs[i] += vzs[i] * dt;
      }
      accel();
      for (let i = 0; i < n; i++) {
        if (fixed[i]) continue;
        vxs[i] += axs[i] * half;
        vys[i] += ays[i] * half;
        vzs[i] += azs[i] * half;
      }
      let hit = false;
      for (let i = 0; i < t; i++) {
        const dx = xs[t] - xs[i];
        const dy = ys[t] - ys[i];
        const dz = zs[t] - zs[i];
        const r = massive[i].collisionRadius;
        if (dx * dx + dy * dy + dz * dz < r * r) {
          hit = true;
          break;
        }
      }
      if (s % stride === 0) out.push(xs[t], ys[t]);
      if (hit) break;
    }
    return out;
  }
}
