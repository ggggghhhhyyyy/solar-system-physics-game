import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine } from './engine.ts';
import { AU_M, G0, PHYSICAL_RADIUS_AU, R_SCHWARZSCHILD_SUN_AU, R_SUN_AU } from './constants.ts';
import { rocheLimitAU, isInsideRoche } from './orbital/roche.ts';
import { linearClosestApproach } from './orbital/encounters.ts';
import { orbiting, PLANETS, PRESETS, SUN } from './presets.ts';
import { calculateLagrangePoints } from './orbital/lagrange.ts';
import { classicalElements } from './orbital/elements.ts';
import { createBodyFromEphemeris } from './ephemeris/normalize.ts';
import { barycenter } from './frames/referenceFrames.ts';
import { exportSnapshot, restoreSnapshot } from './snapshot.ts';
import type { BodySpec } from './types.ts';

function sunEarth(): BodySpec[] {
  return [
    { ...SUN },
    PLANETS.earth(0),
  ];
}

describe('Physics V2 — Earth-Sun', () => {
  it('survives 1 year with stable a, e, period and small energy drift', () => {
    const e = new Engine();
    e.dt = 0.0002;
    e.softening = 1e-8;
    e.collisionsEnabled = false;
    e.reset(sunEarth());
    const earth = e.bodies.find((b) => b.key === 'earth')!;
    const sun = e.bodies.find((b) => b.key === 'sun')!;
    const el0 = e.orbitalElements(earth, sun);
    const E0 = e.diagnostics().current.totalEnergy;
    const steps = Math.round(1 / e.dt);
    for (let i = 0; i < steps; i++) e.step();
    const el1 = e.orbitalElements(earth, sun);
    const E1 = e.diagnostics().current.totalEnergy;
    assert.ok(el0.a != null && el1.a != null);
    assert.ok(Math.abs(el1.a - 1) < 0.01, `a=${el1.a}`);
    assert.ok(el1.e < 0.02, `e=${el1.e}`);
    assert.ok(el1.period != null && Math.abs(el1.period - 1) < 0.02, `P=${el1.period}`);
    assert.ok(Math.abs((E1 - E0) / E0) < 1e-5, `dE/E=${(E1 - E0) / E0}`);
    const r = Math.hypot(earth.x - sun.x, earth.y - sun.y, earth.z - sun.z);
    assert.ok(r > 0.9 && r < 1.1, `r=${r}`);
  });
});

describe('Physics V2 — Earth-Moon', () => {
  it('does not collide instantly and stays bound for 0.1 yr', () => {
    const earth = orbiting('地球', 1.0, 3e-6, 0.0008, '#4f9de8', 0, 1, { key: 'earth' });
    const moon = orbiting(
      '月球',
      0.00257,
      3.69e-8,
      0.00014,
      '#ddd',
      60,
      earth.mass,
      { key: 'moon' },
      { x: earth.x, y: earth.y, z: 0, vx: earth.vx, vy: earth.vy, vz: 0 },
    );
    const e = new Engine();
    e.dt = 5e-6;
    e.softening = 1e-8;
    e.collisionsEnabled = true;
    e.reset([{ ...SUN }, earth, moon]);
    const n0 = e.bodies.length;
    const steps = Math.round(0.1 / e.dt);
    for (let i = 0; i < steps; i++) e.step();
    const m = e.bodies.find((b) => b.key === 'moon');
    const ea = e.bodies.find((b) => b.key === 'earth');
    assert.equal(e.bodies.length, n0, 'moon must not merge into earth');
    assert.ok(m && ea);
    const el = e.orbitalElements(m, ea);
    assert.equal(el.unbound, false);
    assert.ok(el.a != null && el.a > 0.001 && el.a < 0.005, `a=${el.a}`);
  });
});

describe('Physics V2 — conservation', () => {
  it('conserves momentum in a closed two-body system', () => {
    const e = new Engine();
    e.dt = 0.0002;
    e.softening = 1e-8;
    e.collisionsEnabled = false;
    e.reset(sunEarth());
    const p0 = e.diagnostics().current;
    for (let i = 0; i < 2000; i++) e.step();
    const p1 = e.diagnostics().current;
    const dp = Math.hypot(p1.px - p0.px, p1.py - p0.py, p1.pz - p0.pz);
    assert.ok(dp < 1e-10, `ΔP=${dp}`);
  });

  it('keeps leapfrog energy drift tiny over a long two-body orbit', () => {
    const e = new Engine();
    e.dt = 0.0002;
    e.softening = 1e-8;
    e.collisionsEnabled = false;
    e.reset(sunEarth());
    const E0 = e.diagnostics().current.totalEnergy;
    for (let i = 0; i < 8000; i++) e.step();
    const E1 = e.diagnostics().current.totalEnergy;
    assert.ok(Math.abs((E1 - E0) / E0) < 1e-5, `dE/E=${(E1 - E0) / E0}`);
  });
});

describe('Physics V2 — figure-8', () => {
  it('stays near the periodic three-body solution for one period', () => {
    const preset = PRESETS.find((p) => p.id === 'three')!;
    const e = new Engine();
    e.dt = 2e-5;
    e.softening = 1e-10;
    e.collisionsEnabled = false;
    e.reset(preset.bodies.map((b) => ({ ...b })));
    const T = 6.3259139829 / (2 * Math.PI);
    const start = e.bodies.map((b) => ({ x: b.x, y: b.y, z: b.z }));
    const steps = Math.round(T / e.dt);
    for (let i = 0; i < steps; i++) e.step();
    for (let i = 0; i < 3; i++) {
      const d = Math.hypot(
        e.bodies[i].x - start[i].x,
        e.bodies[i].y - start[i].y,
        e.bodies[i].z - start[i].z,
      );
      assert.ok(d < 0.08, `body ${i} drifted ${d}`);
    }
  });
});

describe('Physics V2 — test particle', () => {
  it('is attracted by Jupiter but does not back-react', () => {
    const sun: BodySpec = { ...SUN };
    const jup = orbiting('木星', 5.203, 9.55e-4, 0.055, '#d9a066', 0, 1, { key: 'jupiter' });
    const e = new Engine();
    e.softening = 1e-6;
    e.reset([sun, jup]);
    e.refreshAccel();
    const j = e.bodies.find((b) => b.key === 'jupiter')!;
    const ax0 = j.ax;
    const ay0 = j.ay;
    const az0 = j.az;
    e.addBody({
      name: 'probe',
      mass: 0.5,
      physicalRadius: 1e-6,
      renderRadius: 0.01,
      x: j.x + 0.05,
      y: j.y,
      z: 0,
      vx: j.vx,
      vy: j.vy,
      vz: 0,
      color: '#fff',
      gravityMode: 'test-particle',
    });
    e.refreshAccel();
    const j2 = e.bodies.find((b) => b.key === 'jupiter')!;
    assert.ok(Math.abs(j2.ax - ax0) < 1e-12, `ax ${j2.ax} vs ${ax0}`);
    assert.ok(Math.abs(j2.ay - ay0) < 1e-12);
    assert.ok(Math.abs(j2.az - az0) < 1e-12);
    const probe = e.bodies.find((b) => b.name === 'probe')!;
    assert.ok(Math.hypot(probe.ax, probe.ay, probe.az) > 1e-4, 'probe must feel gravity');
  });
});

describe('Physics V2 — 3D orbit', () => {
  it('keeps z ≠ 0 and stays bound on an inclined orbit', () => {
    const planet = orbiting('倾角行星', 1.0, 3e-6, 0.02, '#4f9de8', 90, 1, { iDeg: 25, lanDeg: 40 });
    const e = new Engine();
    e.dt = 0.0002;
    e.softening = 1e-8;
    e.collisionsEnabled = false;
    e.reset([{ ...SUN }, planet]);
    assert.ok(Math.abs(e.bodies[1].z) > 1e-4, `initial z=${e.bodies[1].z}`);
    for (let i = 0; i < 3000; i++) e.step();
    const b = e.bodies[1];
    const sun = e.bodies[0];
    assert.ok(Math.abs(b.z) > 1e-5 || Math.abs(b.vz) > 1e-5, 'orbit flattened');
    const el = e.orbitalElements(b, sun);
    assert.equal(el.unbound, false);
    assert.ok(el.i > (20 * Math.PI) / 180, `i=${el.i}`);
  });
});

describe('Physics V2 — collision radius vs render radius', () => {
  it('collides on physical overlap, not visual overlap', () => {
    const mk = (x: number, physical: number, render: number, name: string): BodySpec => ({
      name,
      mass: 1e-6,
      physicalRadius: physical,
      renderRadius: render,
      collisionRadius: physical,
      x, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      color: '#fff',
    });
    const visualOnly = new Engine();
    visualOnly.dt = 1e-6;
    visualOnly.collisionsEnabled = true;
    visualOnly.reset([mk(0, 0.001, 1, 'A'), mk(0.5, 0.001, 1, 'B')]);
    visualOnly.step();
    assert.equal(visualOnly.bodies.length, 2, 'must NOT collide on renderRadius');

    const physicalHit = new Engine();
    physicalHit.dt = 1e-6;
    physicalHit.collisionsEnabled = true;
    physicalHit.reset([mk(0, 0.2, 0.001, 'A'), mk(0.1, 0.2, 0.001, 'B')]);
    physicalHit.step();
    assert.equal(physicalHit.bodies.length, 1, 'must collide on physicalRadius');
  });
});

describe('Physics V2 — 3D state / octree / frames / ephemeris / lagrange', () => {
  it('stores and integrates z, vz, az', () => {
    const e = new Engine();
    e.reset([
      { ...SUN },
      { name: 'p', mass: 3e-6, physicalRadius: PHYSICAL_RADIUS_AU.earth, x: 0, y: 0, z: 1, vx: 0, vy: 0, vz: 0, color: '#fff' },
    ]);
    e.refreshAccel();
    const p = e.bodies[1];
    assert.ok(Math.abs(p.az) > 0, 'az must be nonzero');
    e.step();
    assert.notEqual(p.z, 1);
  });

  it('uses octree path for N>150 without NaN', () => {
    const bodies: BodySpec[] = [{ ...SUN }];
    for (let i = 0; i < 180; i++) {
      bodies.push(orbiting(`a${i}`, 2 + i * 0.01, 1e-8, 0.001, '#aaa', i * 2));
    }
    const e = new Engine();
    e.reset(bodies);
    for (let i = 0; i < 5; i++) e.step();
    for (const b of e.bodies) {
      assert.ok(Number.isFinite(b.x) && Number.isFinite(b.vx) && Number.isFinite(b.ax));
      assert.ok(Number.isFinite(b.z) && Number.isFinite(b.vz) && Number.isFinite(b.az));
    }
  });

  it('barycentre is not locked to the sun', () => {
    const e = new Engine();
    e.reset(PRESETS.find((p) => p.id === 'solar')!.bodies.map((b) => ({ ...b })));
    const com = barycenter(e.bodies);
    const sun = e.bodies.find((b) => b.key === 'sun')!;
    assert.ok(Math.hypot(sun.vx, sun.vy, sun.vz) > 1e-6, 'sun must move about the barycentre');
    const d = Math.hypot(sun.x - com.x, sun.y - com.y, sun.z - com.z);
    assert.ok(d > 1e-4, `sun should be offset from COM, d=${d}`);
  });

  it('createBodyFromEphemeris maps Cartesian state into the engine', () => {
    const spec = createBodyFromEphemeris(
      { name: 'Earth', key: 'earth', mass: 3e-6, physicalRadius: PHYSICAL_RADIUS_AU.earth, color: '#4f9de8' },
      {
        epoch: { jd: 2461294.5, scale: 'TDB' },
        referenceFrame: 'ICRF',
        position: { x: 1, y: 0, z: 0 },
        velocity: { x: 0, y: 2 * Math.PI, z: 0 },
      },
    );
    const e = new Engine();
    e.reset([{ ...SUN, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }, spec], { epoch: '2026-09-11T00:00:00Z' });
    assert.ok(e.epoch);
    assert.equal(e.epoch.scale, 'UTC');
    assert.ok(Math.abs(e.epoch.jd - 2461294.5) < 0.001);
    assert.equal(e.bodies[1].x, 1);
    assert.equal(e.bodies[1].vy, 2 * Math.PI);
    assert.ok(e.simulationDate instanceof Date);
  });

  it('Lagrange L1–L5 for Sun-Earth and Earth-Moon are finite and ordered', () => {
    const e = new Engine();
    const earth = orbiting('地球', 1, 3e-6, 0.02, '#4f', 0, 1, { key: 'earth' });
    e.reset([{ ...SUN }, earth]);
    const pts = calculateLagrangePoints(e.bodies[0], e.bodies[1]);
    assert.ok(pts);
    const ids = pts!.map((p) => p.id).sort().join();
    assert.equal(ids, 'L1,L2,L3,L4,L5');
    for (const p of pts!) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
    }
    const l1 = pts!.find((p) => p.id === 'L1')!;
    const l2 = pts!.find((p) => p.id === 'L2')!;
    const sun = e.bodies[0];
    const ea = e.bodies[1];
    const r1 = Math.hypot(l1.x - ea.x, l1.y - ea.y, l1.z - ea.z);
    const r2 = Math.hypot(l2.x - ea.x, l2.y - ea.y, l2.z - ea.z);
    assert.ok(r1 > 0.005 && r1 < 0.02, `Sun-Earth L1 distance ${r1}`);
    assert.ok(r2 > 0.005 && r2 < 0.02, `Sun-Earth L2 distance ${r2}`);
    const dSunL1 = Math.hypot(l1.x - sun.x, l1.y - sun.y);
    const dSunE = Math.hypot(ea.x - sun.x, ea.y - sun.y);
    assert.ok(dSunL1 < dSunE, 'L1 lies between Sun and Earth');

    const moon = orbiting('月球', 0.00257, 3.69e-8, 0.0001, '#ddd', 0, ea.mass, { key: 'moon' }, {
      x: ea.x, y: ea.y, z: 0, vx: ea.vx, vy: ea.vy, vz: 0,
    });
    e.reset([ea, moon]);
    const em = calculateLagrangePoints(e.bodies[0], e.bodies[1]);
    assert.ok(em);
    const emL1 = em!.find((p) => p.id === 'L1')!;
    const d = Math.hypot(emL1.x - e.bodies[1].x, emL1.y - e.bodies[1].y);
    assert.ok(d > 1e-5 && d < 0.001, `Earth-Moon L1 ${d}`);
  });

  it('classical elements handle circular / equatorial / hyperbolic without NaN', () => {
    const circ = classicalElements({ x: 1, y: 0, z: 0 }, { x: 0, y: 2 * Math.PI, z: 0 }, G0);
    assert.ok(Number.isFinite(circ.e) && circ.e < 1e-6);
    assert.ok(Number.isFinite(circ.i) && Number.isFinite(circ.Omega) && Number.isFinite(circ.nu));
    const hyp = classicalElements({ x: 1, y: 0, z: 0 }, { x: 0, y: 20, z: 0 }, G0);
    assert.equal(hyp.unbound, true);
    assert.equal(hyp.kind, 'hyperbolic');
    assert.ok(Number.isFinite(hyp.e) && hyp.e > 1);
    assert.equal(hyp.period, null);
  });

  it('does not treat solar radius as 0.09 AU', () => {
    assert.ok(Math.abs(R_SUN_AU - 0.00465047) < 1e-6);
    assert.ok(SUN.physicalRadius < 0.005);
    assert.ok((SUN.renderRadius ?? 0) > 0.05);
  });
});

describe('Physics V2 — snapshot migration', () => {
  it('restores v2 time/epoch and migrates v1 radius without inventing physical size', () => {
    const e = new Engine();
    e.reset(sunEarth(), { epoch: '2026-09-11T00:00:00Z' });
    for (let i = 0; i < 50; i++) e.step();
    const snap = exportSnapshot(e);
    assert.equal(snap.version, 2);
    const t = e.time;
    const x = e.bodies[1].x;
    const e2 = new Engine();
    restoreSnapshot(e2, snap);
    assert.ok(Math.abs(e2.time - t) < 1e-12);
    assert.ok(e2.epoch);
    assert.equal(e2.epoch.scale, 'UTC');
    assert.ok(Math.abs(e2.epoch.jd - 2461294.5) < 0.001);
    assert.ok(Math.abs(e2.bodies[1].x - x) < 1e-12);
    assert.ok(e2.bodies[1].physicalRadius < 0.001);
    assert.ok(e2.bodies[1].renderRadius > e2.bodies[1].physicalRadius);

    const v1 = {
      version: 1 as const,
      time: 1.5,
      bodies: [{
        name: 'blob',
        mass: 1e-6,
        radius: 0.05,
        x: 1, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        color: '#fff',
        age: 0.25,
      }],
    };
    restoreSnapshot(e2, v1);
    assert.equal(e2.time, 1.5);
    assert.equal(e2.bodies[0].physicalRadius, 0.05);
    assert.equal(e2.bodies[0].renderRadius, 0.05);
    assert.ok(Math.abs(e2.bodies[0].createdAt - (1.5 - 0.25)) < 1e-12);
  });
});

describe('Physics V2 — Roche / TDE / encounters', () => {
  it('places the Moon outside Earth fluid Roche ~18 400 km', () => {
    const earth = { mass: 3.003_489_6e-6, physicalRadius: PHYSICAL_RADIUS_AU.earth, x: 0, y: 0, z: 0 };
    const moon = { mass: 3.694_3e-8, physicalRadius: PHYSICAL_RADIUS_AU.moon, x: 0.00257, y: 0, z: 0 };
    const d = rocheLimitAU(earth, moon, 'fluid');
    assert.ok(d != null);
    const km = (d! * AU_M) / 1000;
    assert.ok(km > 17_000 && km < 20_000, `roche km=${km}`);
    assert.equal(isInsideRoche(earth, moon, 'fluid'), false);
    const rigid = rocheLimitAU(earth, moon, 'rigid')!;
    assert.ok(rigid < d!, 'rigid Roche is smaller than fluid');
  });

  it('TDE radius of a solar-type star at 10 M☉ BH lies outside the horizon', () => {
    const rs = 10 * R_SCHWARZSCHILD_SUN_AU;
    const bh = { mass: 10, physicalRadius: rs, isBlackHole: true, x: 0, y: 0, z: 0 };
    const star = { mass: 1, physicalRadius: R_SUN_AU, x: 0, y: 0, z: 0 };
    const d = rocheLimitAU(bh, star, 'fluid');
    assert.ok(d != null && d > rs * 100, `tde=${d} rs=${rs}`);
  });

  it('linear closest approach is r/v for a head-on intercept', () => {
    const ca = linearClosestApproach(1, 0, 0, -2, 0, 0);
    assert.ok(Math.abs((ca.tCA ?? -1) - 0.5) < 1e-12);
    assert.ok(ca.rCA < 1e-12);
    assert.equal(ca.approaching, true);
  });

  it('adaptive dt splits a fast encounter into substeps', () => {
    const e = new Engine();
    e.dt = 0.01;
    e.adaptiveDt = true;
    e.collisionsEnabled = false;
    e.reset([
      { ...SUN, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
      {
        name: 'imp',
        mass: 1e-9,
        physicalRadius: 1e-8,
        x: 0.001,
        y: 0,
        z: 0,
        vx: -80,
        vy: 0,
        vz: 0,
        color: '#fff',
      },
    ]);
    const n = e.suggestedSubsteps();
    assert.ok(n > 1 && n <= 16, `n=${n}`);
    e.adaptiveDt = false;
    assert.equal(e.suggestedSubsteps(), 1);
  });
});
