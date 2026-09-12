/**
 * Barnes-Hut octree. PHYSICAL MODEL — 3D monopole approximation.
 * 8 children, cube bounds, COM (x,y,z), mass. Same theta as the old quadtree.
 */

export class OctNode {
  cx: number;
  cy: number;
  cz: number;
  half: number;
  mass = 0;
  comX = 0;
  comY = 0;
  comZ = 0;
  body = -1;
  children: OctNode[] | null = null;

  constructor(cx: number, cy: number, cz: number, half: number) {
    this.cx = cx;
    this.cy = cy;
    this.cz = cz;
    this.half = half;
  }

  private childFor(x: number, y: number, z: number): OctNode {
    const ch = this.children as OctNode[];
    const east = x > this.cx ? 1 : 0;
    const north = y > this.cy ? 1 : 0;
    const up = z > this.cz ? 1 : 0;
    return ch[(up << 2) | (north << 1) | east];
  }

  insert(
    idx: number,
    xs: Float64Array,
    ys: Float64Array,
    zs: Float64Array,
    ms: Float64Array,
  ): void {
    if (this.children === null) {
      if (this.body === -1) {
        this.body = idx;
        this.mass = ms[idx];
        this.comX = xs[idx];
        this.comY = ys[idx];
        this.comZ = zs[idx];
        return;
      }
      if (this.half < 1e-12) {
        const m = ms[idx];
        const tot = this.mass + m;
        if (tot > 0) {
          this.comX = (this.comX * this.mass + xs[idx] * m) / tot;
          this.comY = (this.comY * this.mass + ys[idx] * m) / tot;
          this.comZ = (this.comZ * this.mass + zs[idx] * m) / tot;
        }
        this.mass = tot;
        return;
      }
      const old = this.body;
      this.body = -1;
      const h = this.half / 2;
      const kids: OctNode[] = new Array(8);
      let k = 0;
      for (let u = 0; u <= 1; u++) {
        for (let n = 0; n <= 1; n++) {
          for (let e = 0; e <= 1; e++) {
            kids[k++] = new OctNode(
              this.cx + (e ? h : -h),
              this.cy + (n ? h : -h),
              this.cz + (u ? h : -h),
              h,
            );
          }
        }
      }
      this.children = kids;
      this.childFor(xs[old], ys[old], zs[old]).insert(old, xs, ys, zs, ms);
      this.childFor(xs[idx], ys[idx], zs[idx]).insert(idx, xs, ys, zs, ms);
      let tot = 0;
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (const c of this.children) {
        if (c.mass === 0) continue;
        const nt = tot + c.mass;
        cx = (cx * tot + c.comX * c.mass) / nt;
        cy = (cy * tot + c.comY * c.mass) / nt;
        cz = (cz * tot + c.comZ * c.mass) / nt;
        tot = nt;
      }
      this.mass = tot;
      this.comX = cx;
      this.comY = cy;
      this.comZ = cz;
      return;
    }
    const m = ms[idx];
    const tot = this.mass + m;
    if (tot > 0) {
      this.comX = (this.comX * this.mass + xs[idx] * m) / tot;
      this.comY = (this.comY * this.mass + ys[idx] * m) / tot;
      this.comZ = (this.comZ * this.mass + zs[idx] * m) / tot;
    }
    this.mass = tot;
    this.childFor(xs[idx], ys[idx], zs[idx]).insert(idx, xs, ys, zs, ms);
  }

  contains(x: number, y: number, z: number): boolean {
    return (
      Math.abs(x - this.cx) <= this.half &&
      Math.abs(y - this.cy) <= this.half &&
      Math.abs(z - this.cz) <= this.half
    );
  }
}

export function addForceFromOctree(
  node: OctNode,
  target: number,
  xi: number,
  yi: number,
  zi: number,
  eps2: number,
  G: number,
  theta: number,
  axs: Float64Array,
  ays: Float64Array,
  azs: Float64Array,
): void {
  if (node.mass === 0) return;
  if (node.children === null) {
    const j = node.body;
    if (j === -1 || j === target) return;
    const dx = node.comX - xi;
    const dy = node.comY - yi;
    const dz = node.comZ - zi;
    const r2 = dx * dx + dy * dy + dz * dz + eps2;
    const inv = 1 / (r2 * Math.sqrt(r2));
    const f = G * node.mass * inv;
    axs[target] += f * dx;
    ays[target] += f * dy;
    azs[target] += f * dz;
    return;
  }
  const dx = node.comX - xi;
  const dy = node.comY - yi;
  const dz = node.comZ - zi;
  const r2 = dx * dx + dy * dy + dz * dz + eps2;
  const dist = Math.sqrt(r2);
  const s = node.half * 2;
  const inside = node.contains(xi, yi, zi);
  if (!inside && s / dist < theta) {
    const inv = 1 / (r2 * dist);
    const f = G * node.mass * inv;
    axs[target] += f * dx;
    ays[target] += f * dy;
    azs[target] += f * dz;
    return;
  }
  const ch = node.children;
  for (let k = 0; k < 8; k++) {
    const c = ch[k];
    if (c.mass === 0) continue;
    addForceFromOctree(c, target, xi, yi, zi, eps2, G, theta, axs, ays, azs);
  }
}
