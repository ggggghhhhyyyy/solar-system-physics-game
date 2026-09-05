import type { Body, BodySpec, SimEvent } from './types';

/** Gravitational constant in AU^3 / (M_sun * yr^2) */
export const G0 = 4 * Math.PI * Math.PI;

export const TRAIL_MAX = 600;

// Phase5 阈值与常量。
// N<=150 直接求和更快(建树/哈希开销主导);N^2≈22500 对以下 O(N^2)常数小,经验交叉点约100-200,取150。
const BH_THRESHOLD = 150;
// 碰撞网格分发阈值,与力计算同值:小 N 双循环常数更小。
const GRID_THRESHOLD = 150;
// Barnes-Hut 开角阈值 s/d<theta 则近似;0.7 为精度/速度常用折中。
const BH_THETA = 0.7;
// 网格整数哈希乘子(大质数分散格坐标)。
const HASH_X = 73856093;
const HASH_Y = 19349663;
// 网格最小格距,防零半径/重合导致除零。
const GRID_MIN = 1e-4;

// Barnes-Hut 四叉树节点(文件内私有,不导出)。叶容量1,空节点mass==0,查询时跳过。
class QuadNode {
  cx: number;
  cy: number;
  half: number;
  mass = 0;
  comX = 0;
  comY = 0;
  body = -1; // 叶中暂存的天体下标,-1 为空
  children: QuadNode[] | null = null;

  constructor(cx: number, cy: number, half: number) {
    this.cx = cx;
    this.cy = cy;
    this.half = half;
  }

  private childFor(x: number, y: number): QuadNode {
    const ch = this.children as QuadNode[];
    const east = x > this.cx ? 1 : 0;
    const north = y > this.cy ? 1 : 0;
    return ch[(north << 1) | east];
  }

  insert(idx: number, xs: Float64Array, ys: Float64Array, ms: Float64Array): void {
    if (this.children === null) {
      if (this.body === -1) {
        this.body = idx;
        this.mass = ms[idx];
        this.comX = xs[idx];
        this.comY = ys[idx];
        return;
      }
      // 重合退化:不再细分,质量已在下式计入,保终止。
      if (this.half < 1e-12) {
        const m = ms[idx];
        const tot = this.mass + m;
        if (tot > 0) {
          this.comX = (this.comX * this.mass + xs[idx] * m) / tot;
          this.comY = (this.comY * this.mass + ys[idx] * m) / tot;
        }
        this.mass = tot;
        return;
      }
      const old = this.body;
      this.body = -1;
      const h = this.half / 2;
      this.children = [
        new QuadNode(this.cx - h, this.cy - h, h),
        new QuadNode(this.cx + h, this.cy - h, h),
        new QuadNode(this.cx - h, this.cy + h, h),
        new QuadNode(this.cx + h, this.cy + h, h),
      ];
      this.childFor(xs[old], ys[old]).insert(old, xs, ys, ms);
      this.childFor(xs[idx], ys[idx]).insert(idx, xs, ys, ms);
      // 由子节点重算质量加权质心。
      let tot = 0;
      let cx = 0;
      let cy = 0;
      for (const c of this.children) {
        if (c.mass === 0) continue;
        const nt = tot + c.mass;
        cx = (cx * tot + c.comX * c.mass) / nt;
        cy = (cy * tot + c.comY * c.mass) / nt;
        tot = nt;
      }
      this.mass = tot;
      this.comX = cx;
      this.comY = cy;
      return;
    }
    const m = ms[idx];
    const tot = this.mass + m;
    if (tot > 0) {
      this.comX = (this.comX * this.mass + xs[idx] * m) / tot;
      this.comY = (this.comY * this.mass + ys[idx] * m) / tot;
    }
    this.mass = tot;
    this.childFor(xs[idx], ys[idx]).insert(idx, xs, ys, ms);
  }
}

export class Engine {
  bodies: Body[] = [];
  time = 0; // years
  dt = 0.0002; // years per integration step (~0.073 days)
  softening = 0.003; // AU
  gMultiplier = 1;
  collisionsEnabled = true;
  trailInterval = 0.0025; // years between trail samples
  escapeDistance = 400; // AU – bodies beyond this are removed

  private events: SimEvent[] = [];
  private nextId = 1;
  private lastTrailTime = 0;
  private needAccel = true;

  get G(): number {
    return G0 * this.gMultiplier;
  }

  // Scratch buffers (structure-of-arrays) for the O(N^2) force loop
  private sx = new Float64Array(0);
  private sy = new Float64Array(0);
  private sm = new Float64Array(0);
  private sax = new Float64Array(0);
  private say = new Float64Array(0);

  private makeBody(spec: BodySpec): Body {
    // explicit field order => monomorphic object shape for V8
    return {
      name: spec.name,
      key: spec.key,
      mass: spec.mass,
      radius: spec.radius,
      x: spec.x,
      y: spec.y,
      vx: spec.vx,
      vy: spec.vy,
      color: spec.color,
      isStar: !!spec.isStar,
      ring: !!spec.ring,
      userLaunched: !!spec.userLaunched,
      fixed: !!spec.fixed,
      id: this.nextId++,
      ax: 0,
      ay: 0,
      createdAt: this.time,
      trail: new Float32Array(TRAIL_MAX * 2),
      trailHead: 0,
      trailCount: 0,
    };
  }

  reset(specs: BodySpec[]): void {
    this.time = 0;
    this.lastTrailTime = 0;
    this.events = [];
    this.bodies = specs.map((s) => this.makeBody(s));
    this.needAccel = true;
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

  private computeAccel(): void {
    const bs = this.bodies;
    const n = bs.length;
    const G = this.G;
    const eps2 = this.softening * this.softening;

    // Phase5 分发:N>150 走 Barnes-Hut 近似,小 N 走原直接求和(下文原样)。
    if (n > BH_THRESHOLD) {
      this.computeAccelBarnesHut();
      return;
    }
    if (this.sx.length < n) {
      const cap = Math.max(n, 64) * 2;
      this.sx = new Float64Array(cap);
      this.sy = new Float64Array(cap);
      this.sm = new Float64Array(cap);
      this.sax = new Float64Array(cap);
      this.say = new Float64Array(cap);
    }
    const xs = this.sx, ys = this.sy, ms = this.sm, axs = this.sax, ays = this.say;
    for (let i = 0; i < n; i++) {
      const b = bs[i];
      xs[i] = b.x;
      ys[i] = b.y;
      ms[i] = b.mass * G;
      axs[i] = 0;
      ays[i] = 0;
    }
    for (let i = 0; i < n; i++) {
      const xi = xs[i];
      const yi = ys[i];
      const mi = ms[i];
      let ax = 0;
      let ay = 0;
      for (let j = i + 1; j < n; j++) {
        const dx = xs[j] - xi;
        const dy = ys[j] - yi;
        const r2 = dx * dx + dy * dy + eps2;
        const inv = 1 / (r2 * Math.sqrt(r2));
        const fx = dx * inv;
        const fy = dy * inv;
        ax += ms[j] * fx;
        ay += ms[j] * fy;
        axs[j] -= mi * fx;
        ays[j] -= mi * fy;
      }
      axs[i] += ax;
      ays[i] += ay;
    }
    for (let i = 0; i < n; i++) {
      bs[i].ax = axs[i];
      bs[i].ay = ays[i];
    }
    // 极端防护:非有限坐标静默置零(不扩展 SimEvent 类型,故无事件);有限输入下为 no-op。
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) {
        bs[i].ax = 0;
        bs[i].ay = 0;
      }
    }
    this.needAccel = false;
  }

  // Barnes-Hut 近似路径(N>150)。树每 step 重建:每步位移小,后续可做增量优化。
  // fixed 有质量仍建树(提供引力);computeAccel 照算其 ax/ay,step 里跳过 kick(原语义)。
  private computeAccelBarnesHut(): void {
    const bs = this.bodies;
    const n = bs.length;
    const G = this.G;
    const eps2 = this.softening * this.softening;
    if (this.sx.length < n) {
      const cap = Math.max(n, 64) * 2;
      this.sx = new Float64Array(cap);
      this.sy = new Float64Array(cap);
      this.sm = new Float64Array(cap);
      this.sax = new Float64Array(cap);
      this.say = new Float64Array(cap);
    }
    const xs = this.sx, ys = this.sy, ms = this.sm, axs = this.sax, ays = this.say;
    for (let i = 0; i < n; i++) {
      const b = bs[i];
      xs[i] = b.x;
      ys[i] = b.y;
      ms[i] = b.mass;
      axs[i] = 0;
      ays[i] = 0;
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = xs[i], y = ys[i];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (minX === Infinity) {
      for (let i = 0; i < n; i++) { bs[i].ax = 0; bs[i].ay = 0; }
      this.needAccel = false;
      return;
    }
    const range = Math.max(maxX - minX, maxY - minY);
    const half = Math.max(range / 2, 1e-9) * 1.05 + 1e-9;
    const root = new QuadNode((minX + maxX) / 2, (minY + maxY) / 2, half);
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) continue;
      if (!(ms[i] > 0)) continue; // 零质量不提供引力,跳过建树
      root.insert(i, xs, ys, ms);
    }
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) {
        axs[i] = 0;
        ays[i] = 0;
        continue;
      }
      this.addForceFromNode(root, i, xs[i], ys[i], eps2, G, axs, ays);
    }
    for (let i = 0; i < n; i++) {
      bs[i].ax = axs[i];
      bs[i].ay = ays[i];
    }
    this.needAccel = false;
  }

  private addForceFromNode(
    node: QuadNode, target: number, xi: number, yi: number,
    eps2: number, G: number, axs: Float64Array, ays: Float64Array,
  ): void {
    if (node.mass === 0) return; // 空节点跳过
    if (node.children === null) {
      const j = node.body;
      if (j === -1 || j === target) return; // 空/自体跳过
      const dx = node.comX - xi;
      const dy = node.comY - yi;
      const r2 = dx * dx + dy * dy + eps2; // softening 与直接法一致
      const inv = 1 / (r2 * Math.sqrt(r2));
      const f = G * node.mass * inv;
      axs[target] += f * dx;
      ays[target] += f * dy;
      return;
    }
    const dx = node.comX - xi;
    const dy = node.comY - yi;
    const r2 = dx * dx + dy * dy + eps2;
    const dist = Math.sqrt(r2);
    const s = node.half * 2;
    // 目标在节点内则强制细分,避自引力误差;否则 s/d<theta 近似为单质点。
    const inside = Math.abs(xi - node.cx) <= node.half && Math.abs(yi - node.cy) <= node.half;
    if (!inside && s / dist < BH_THETA) {
      const inv = 1 / (r2 * dist);
      const f = G * node.mass * inv;
      axs[target] += f * dx;
      ays[target] += f * dy;
      return;
    }
    const ch = node.children as QuadNode[];
    for (let k = 0; k < 4; k++) {
      const c = ch[k];
      if (c.mass === 0) continue;
      this.addForceFromNode(c, target, xi, yi, eps2, G, axs, ays);
    }
  }

  /** One leapfrog (kick-drift-kick) step. */
  step(): void {
    if (this.needAccel) this.computeAccel();
    const dt = this.dt;
    const half = dt * 0.5;
    const bs = this.bodies;
    for (const b of bs) {
      if (b.fixed) continue;
      b.vx += b.ax * half;
      b.vy += b.ay * half;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
    this.computeAccel();
    for (const b of bs) {
      if (b.fixed) continue;
      b.vx += b.ax * half;
      b.vy += b.ay * half;
    }
    this.time += dt;

    if (this.collisionsEnabled) this.handleCollisions();
    this.removeEscapees();

    if (this.time - this.lastTrailTime >= this.trailInterval) {
      this.lastTrailTime = this.time;
      for (const b of bs) {
        const h = b.trailHead;
        b.trail[h * 2] = b.x;
        b.trail[h * 2 + 1] = b.y;
        b.trailHead = (h + 1) % TRAIL_MAX;
        if (b.trailCount < TRAIL_MAX) b.trailCount++;
      }
    }
  }

  /** Advance simulation by `years` of simulated time, capped at maxSteps. */
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
      if (dx * dx + dy * dy > lim2) {
        this.bodies.splice(i, 1);
        this.events.push({ type: 'escaped', time: this.time, body: b });
        this.needAccel = true;
      }
    }
  }

  private sr = new Float64Array(0);

  private handleCollisions(): void {
    // Phase5 分发:N>150 走空间哈希,小 N 走原双循环(下文原样)。
    if (this.bodies.length > GRID_THRESHOLD) {
      this.handleCollisionsHashed();
      return;
    }
    let merged = true;
    while (merged) {
      merged = false;
      const bs = this.bodies;
      const n = bs.length;
      if (this.sr.length < n) this.sr = new Float64Array(Math.max(n, 64) * 2);
      if (this.sx.length < n) {
        this.sx = new Float64Array(Math.max(n, 64) * 2);
        this.sy = new Float64Array(Math.max(n, 64) * 2);
      }
      const xs = this.sx, ys = this.sy, rs = this.sr;
      // sx/sy hold positions from the last computeAccel (called at end of step), so they are current
      for (let i = 0; i < n; i++) {
        xs[i] = bs[i].x;
        ys[i] = bs[i].y;
        rs[i] = bs[i].radius;
      }
      outer: for (let i = 0; i < n; i++) {
        const xi = xs[i], yi = ys[i], ri = rs[i];
        for (let j = i + 1; j < n; j++) {
          const dx = xi - xs[j];
          const dy = yi - ys[j];
          const rr = ri + rs[j];
          if (dx * dx + dy * dy < rr * rr) {
            this.merge(bs[i], bs[j]);
            merged = true;
            break outer;
          }
        }
      }
    }
  }

  // 均匀网格碰撞(N>150)。格距=全体最大直径*2(钳 GRID_MIN),碰撞对必在同格/邻格,仅查 3x3。
  // 复用 merge,一次只合一对后重建网格,保 while-merged 事件顺序语义;哈希碰撞仅增候选,距离过滤保正确。
  private handleCollisionsHashed(): void {
    let merged = true;
    while (merged) {
      merged = false;
      const bs = this.bodies;
      const n = bs.length;
      if (n < 2) return;
      if (this.sr.length < n) this.sr = new Float64Array(Math.max(n, 64) * 2);
      if (this.sx.length < n) {
        this.sx = new Float64Array(Math.max(n, 64) * 2);
        this.sy = new Float64Array(Math.max(n, 64) * 2);
      }
      const xs = this.sx, ys = this.sy, rs = this.sr;
      for (let i = 0; i < n; i++) {
        xs[i] = bs[i].x;
        ys[i] = bs[i].y;
        rs[i] = bs[i].radius;
      }
      let maxR = 0;
      for (let i = 0; i < n; i++) if (rs[i] > maxR) maxR = rs[i];
      let cell = maxR * 4;
      if (!Number.isFinite(cell) || cell < GRID_MIN) cell = GRID_MIN;
      const grid = new Map<number, number[]>();
      for (let i = 0; i < n; i++) {
        if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) continue;
        const ix = Math.floor(xs[i] / cell);
        const iy = Math.floor(ys[i] / cell);
        const key = ((ix * HASH_X) ^ (iy * HASH_Y)) | 0;
        const arr = grid.get(key);
        if (arr) arr.push(i);
        else grid.set(key, [i]);
      }
      outer: for (let i = 0; i < n; i++) {
        if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) continue;
        const ix = Math.floor(xs[i] / cell);
        const iy = Math.floor(ys[i] / cell);
        let cand: number[] | null = null;
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const key = (((ix + dx) * HASH_X) ^ ((iy + dy) * HASH_Y)) | 0;
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
        if (cand === null) continue;
        cand.sort((a, b) => a - b);
        let prev = -1;
        for (let k = 0; k < cand.length; k++) {
          const j = cand[k];
          if (j === prev) continue;
          prev = j;
          const ddx = xs[i] - xs[j];
          const ddy = ys[i] - ys[j];
          const rr = rs[i] + rs[j];
          if (ddx * ddx + ddy * ddy < rr * rr) {
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
    if (total > 0) {
      if (!survivor.fixed) {
        survivor.vx = (a.mass * a.vx + b.mass * b.vx) / total;
        survivor.vy = (a.mass * a.vy + b.mass * b.vy) / total;
        survivor.x = (a.mass * a.x + b.mass * b.x) / total;
        survivor.y = (a.mass * a.y + b.mass * b.y) / total;
      }
    }
    survivor.mass = total;
    survivor.radius = Math.cbrt(
      survivor.radius ** 3 + other.radius ** 3,
    );
    if (other.isStar && !survivor.isStar && other.mass > survivor.mass * 0.5) {
      survivor.isStar = true;
    }
    this.bodies = this.bodies.filter((x) => x !== other);
    this.events.push({ type: 'collision', time: this.time, survivor, absorbed: other });
    this.needAccel = true;
  }

  /** Find body under world coordinate with tolerance (AU). */
  bodyAt(wx: number, wy: number, tol: number): Body | undefined {
    let best: Body | undefined;
    let bestD = Infinity;
    for (const b of this.bodies) {
      const dx = b.x - wx;
      const dy = b.y - wy;
      const d = Math.sqrt(dx * dx + dy * dy);
      const hit = Math.max(b.radius, tol);
      if (d < hit && d < bestD) {
        best = b;
        bestD = d;
      }
    }
    return best;
  }

  /** Specific orbital energy of body relative to reference. Negative => bound. */
  specificEnergy(b: Body, ref: Body): number {
    const dx = b.x - ref.x;
    const dy = b.y - ref.y;
    const dvx = b.vx - ref.vx;
    const dvy = b.vy - ref.vy;
    const r = Math.sqrt(dx * dx + dy * dy);
    return 0.5 * (dvx * dvx + dvy * dvy) - (this.G * (ref.mass + b.mass)) / Math.max(r, 1e-6);
  }

  /**
   * Predict the trajectory of a hypothetical new body.
   * Integrates a copy of the (massive) system plus the test body.
   */
  predict(
    spec: { x: number; y: number; vx: number; vy: number; mass: number },
    steps = 700,
    stride = 3,
    dtMul = 4,
  ): number[] {
    const massive = this.bodies.length > 40
      ? this.bodies.filter((b) => b.mass > 1e-8)
      : this.bodies;
    const n = massive.length + 1;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    const vxs = new Float64Array(n);
    const vys = new Float64Array(n);
    const ms = new Float64Array(n);
    const fixed = new Uint8Array(n);
    const axs = new Float64Array(n);
    const ays = new Float64Array(n);
    massive.forEach((b, i) => {
      xs[i] = b.x; ys[i] = b.y; vxs[i] = b.vx; vys[i] = b.vy; ms[i] = b.mass; fixed[i] = b.fixed ? 1 : 0;
    });
    const t = n - 1;
    xs[t] = spec.x; ys[t] = spec.y; vxs[t] = spec.vx; vys[t] = spec.vy; ms[t] = spec.mass;

    const G = this.G;
    const eps2 = this.softening * this.softening;
    const dt = this.dt * dtMul;
    const half = dt / 2;
    const accel = () => {
      axs.fill(0); ays.fill(0);
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const dx = xs[j] - xs[i];
          const dy = ys[j] - ys[i];
          const r2 = dx * dx + dy * dy + eps2;
          const inv = 1 / (r2 * Math.sqrt(r2));
          axs[i] += G * ms[j] * dx * inv; ays[i] += G * ms[j] * dy * inv;
          axs[j] -= G * ms[i] * dx * inv; ays[j] -= G * ms[i] * dy * inv;
        }
      }
    };
    const out: number[] = [xs[t], ys[t]];
    accel();
    for (let s = 1; s <= steps; s++) {
      for (let i = 0; i < n; i++) {
        if (fixed[i]) continue;
        vxs[i] += axs[i] * half; vys[i] += ays[i] * half;
        xs[i] += vxs[i] * dt; ys[i] += vys[i] * dt;
      }
      accel();
      for (let i = 0; i < n; i++) {
        if (fixed[i]) continue;
        vxs[i] += axs[i] * half; vys[i] += ays[i] * half;
      }
      // stop if test body hits a massive body
      let hit = false;
      for (let i = 0; i < t; i++) {
        const dx = xs[t] - xs[i];
        const dy = ys[t] - ys[i];
        const r = massive[i].radius;
        if (dx * dx + dy * dy < r * r) { hit = true; break; }
      }
      if (s % stride === 0) out.push(xs[t], ys[t]);
      if (hit) break;
    }
    return out;
  }
}
