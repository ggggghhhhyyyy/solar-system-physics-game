import type { Vec3 } from '../types.ts';
import { clamp, cross, dot, mag } from '../vec.ts';

const EPS = 1e-14;
const CIRC = 1e-8;
const EQUAT = 1e-10;

export type OrbitKind = 'circular' | 'elliptic' | 'parabolic' | 'hyperbolic' | 'rectilinear';

/**
 * Classical Keplerian elements in the inertial frame used by the engine
 * (ecliptic-like: xy is the reference plane, +z angular-momentum north).
 * Angles in radians, a / rp / ra in AU, period in years.
 *
 * Degenerate cases return 0 / null rather than NaN. PHYSICAL MODEL.
 */
export interface ClassicalElements {
  a: number | null;
  e: number;
  i: number;
  Omega: number;
  omega: number;
  nu: number;
  rp: number | null;
  ra: number | null;
  period: number | null;
  unbound: boolean;
  retrograde: boolean;
  kind: OrbitKind;
}

function empty(kind: OrbitKind, unbound: boolean): ClassicalElements {
  return {
    a: null,
    e: 0,
    i: 0,
    Omega: 0,
    omega: 0,
    nu: 0,
    rp: null,
    ra: null,
    period: null,
    unbound,
    retrograde: false,
    kind,
  };
}

function wrap2pi(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const t = x % (Math.PI * 2);
  return t < 0 ? t + Math.PI * 2 : t;
}

export function classicalElements(r: Vec3, v: Vec3, mu: number): ClassicalElements {
  if (!(mu > 0)) return empty('rectilinear', true);
  const rmag = mag(r);
  const vmag = mag(v);
  if (!(rmag > EPS) || !Number.isFinite(rmag) || !Number.isFinite(vmag)) {
    return empty('rectilinear', true);
  }

  const h = cross(r, v);
  const hmag = mag(h);
  const rdotv = dot(r, v);
  const energy = 0.5 * vmag * vmag - mu / rmag;

  const evec = {
    x: ((vmag * vmag - mu / rmag) * r.x - rdotv * v.x) / mu,
    y: ((vmag * vmag - mu / rmag) * r.y - rdotv * v.y) / mu,
    z: ((vmag * vmag - mu / rmag) * r.z - rdotv * v.z) / mu,
  };
  let e = mag(evec);
  if (!Number.isFinite(e)) e = 0;
  e = Math.max(0, e);

  if (hmag < EPS) {
    const out = empty('rectilinear', energy >= 0);
    out.e = e;
    if (Math.abs(energy) > EPS) out.a = -mu / (2 * energy);
    return out;
  }

  const i = Math.acos(clamp(h.z / hmag, -1, 1));
  const nx = -h.y;
  const ny = h.x;
  const nmag = Math.hypot(nx, ny);

  let Omega = 0;
  if (nmag > EPS && i > EQUAT && i < Math.PI - EQUAT) {
    Omega = Math.acos(clamp(nx / nmag, -1, 1));
    if (ny < 0) Omega = Math.PI * 2 - Omega;
  }

  let omega = 0;
  if (e > CIRC) {
    if (nmag > EPS && i > EQUAT && i < Math.PI - EQUAT) {
      const ndote = (nx * evec.x + ny * evec.y) / (nmag * e);
      omega = Math.acos(clamp(ndote, -1, 1));
      if (evec.z < 0) omega = Math.PI * 2 - omega;
    } else {
      omega = wrap2pi(Math.atan2(evec.y, evec.x));
      if (i > Math.PI / 2) omega = wrap2pi(-omega);
    }
  }

  let nu = 0;
  if (e > CIRC) {
    const edotr = (evec.x * r.x + evec.y * r.y + evec.z * r.z) / (e * rmag);
    nu = Math.acos(clamp(edotr, -1, 1));
    if (rdotv < 0) nu = Math.PI * 2 - nu;
  } else if (nmag > EPS) {
    const ndotr = (nx * r.x + ny * r.y) / (nmag * rmag);
    nu = Math.acos(clamp(ndotr, -1, 1));
    if (nx * r.y - ny * r.x < 0) nu = Math.PI * 2 - nu;
  } else {
    nu = wrap2pi(Math.atan2(r.y, r.x));
  }

  let a: number | null = null;
  let kind: OrbitKind;
  if (e < CIRC) kind = 'circular';
  else if (e < 1 - 1e-10) kind = 'elliptic';
  else if (e < 1 + 1e-10) kind = 'parabolic';
  else kind = 'hyperbolic';

  if (kind === 'parabolic') {
    a = Infinity as unknown as number;
    a = null;
  } else if (Math.abs(energy) > EPS) {
    a = -mu / (2 * energy);
    if (!Number.isFinite(a)) a = null;
  }

  let rp: number | null = null;
  let ra: number | null = null;
  if (kind === 'parabolic') {
    rp = (hmag * hmag) / (2 * mu);
  } else if (a != null) {
    rp = a * (1 - e);
    if (e < 1) ra = a * (1 + e);
  }
  if (rp != null && !(rp > 0)) rp = null;
  if (ra != null && !(ra > 0)) ra = null;

  let period: number | null = null;
  if (kind === 'circular' || kind === 'elliptic') {
    if (a != null && a > 0) {
      period = 2 * Math.PI * Math.sqrt((a * a * a) / mu);
      if (!Number.isFinite(period)) period = null;
    }
  }

  return {
    a: a != null && Number.isFinite(a) ? a : null,
    e,
    i: Number.isFinite(i) ? i : 0,
    Omega: wrap2pi(Omega),
    omega: wrap2pi(omega),
    nu: wrap2pi(nu),
    rp,
    ra,
    period,
    unbound: energy >= 0 || e >= 1,
    retrograde: i > Math.PI / 2 + 1e-12,
    kind,
  };
}

export function deg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/**
 * Perifocal → inertial for a circular / elliptic state. Used by presets.
 * VISUAL / GAMEPLAY: callers may still place bodies in the xy plane.
 */
export function stateFromElements(
  a: number,
  e: number,
  i: number,
  Omega: number,
  omega: number,
  nu: number,
  mu: number,
): { x: number; y: number; z: number; vx: number; vy: number; vz: number } {
  const p = a * Math.abs(1 - e * e) || a;
  const cnu = Math.cos(nu);
  const snu = Math.sin(nu);
  const r = p / Math.max(1e-15, 1 + e * cnu);
  const rx = r * cnu;
  const ry = r * snu;
  const sqrtMuP = Math.sqrt(Math.max(mu / Math.max(p, 1e-15), 0));
  const vxP = -snu * sqrtMuP;
  const vyP = (e + cnu) * sqrtMuP;

  const cw = Math.cos(omega);
  const sw = Math.sin(omega);
  const cO = Math.cos(Omega);
  const sO = Math.sin(Omega);
  const ci = Math.cos(i);
  const si = Math.sin(i);

  const R11 = cO * cw - sO * sw * ci;
  const R12 = -cO * sw - sO * cw * ci;
  const R21 = sO * cw + cO * sw * ci;
  const R22 = -sO * sw + cO * cw * ci;
  const R31 = sw * si;
  const R32 = cw * si;

  return {
    x: R11 * rx + R12 * ry,
    y: R21 * rx + R22 * ry,
    z: R31 * rx + R32 * ry,
    vx: R11 * vxP + R12 * vyP,
    vy: R21 * vxP + R22 * vyP,
    vz: R31 * vxP + R32 * vyP,
  };
}
