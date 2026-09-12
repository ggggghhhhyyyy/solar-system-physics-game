import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine } from '../engine.ts';
import { barycenter } from '../frames/referenceFrames.ts';
import { classicalElements } from '../orbital/elements.ts';
import { G0 } from '../constants.ts';
import { parseHorizonsVector } from './horizonsParse.ts';
import { eccentricAnomaly, julianDateUTC, keplerianSolarSystem, trueAnomalyFromE } from './keplerian.ts';
import { loadSolarSystem } from './loadSolarSystem.ts';
import { HORIZONS_CACHE_2026_09_11 } from './horizonsCache.ts';

const EARTH_FIXTURE = `
*******************************************************************************
Target body name: Earth (399)                     {source: DE441}
Center body name: Solar System Barycenter (0)     {source: DE441}
Output units    : AU-D
Output type     : GEOMETRIC cartesian states
Reference frame : Ecliptic of J2000.0
*******************************************************************************
$$SOE
2461294.500000000 = A.D. 2026-Sep-11 00:00:00.0000 TDB
 X = 9.832120976335644E-01 Y =-2.158800827312486E-01 Z = 1.047935899095542E-04
 VX= 3.329266696098533E-03 VY= 1.676845226440829E-02 VZ=-5.058874382694192E-07
$$EOE
`;

describe('Phase 2 — Horizons parser', () => {
  it('parses AU-D geometric state and converts velocity to AU/year', () => {
    const p = parseHorizonsVector(EARTH_FIXTURE, { jd: 2461294.5, scale: 'TDB' });
    assert.equal(p.timeScale, 'TDB');
    assert.equal(p.units, 'AU-D');
    assert.ok(Math.abs(p.state.position.x - 0.9832120976335644) < 1e-12);
    assert.ok(Math.abs(p.state.position.y + 0.2158800827312486) < 1e-12);
    assert.ok(Math.abs(p.state.velocity.x - 3.329266696098533e-3 * 365.25) < 1e-12);
    const r = Math.hypot(p.state.position.x, p.state.position.y, p.state.position.z);
    assert.ok(r > 0.98 && r < 1.02, `r=${r}`);
    const v = Math.hypot(p.state.velocity.x, p.state.velocity.y, p.state.velocity.z);
    assert.ok(v > 6.0 && v < 6.5, `v=${v}`);
  });

  it('rejects missing $$SOE', () => {
    assert.throws(() => parseHorizonsVector('no table here', { jd: 2451545, scale: 'TDB' }));
  });
});

describe('Phase 2 — Keplerian JPL approx', () => {
  it('solves Kepler without NaN', () => {
    const E = eccentricAnomaly(0.1, 0.2);
    assert.ok(Number.isFinite(E));
    const nu = trueAnomalyFromE(E, 0.2);
    assert.ok(Number.isFinite(nu));
  });

  it('places Earth near 1 AU at J2000 and does not nail the Sun to the origin', () => {
    const jd = julianDateUTC('2000-01-01T12:00:00Z');
    assert.ok(Math.abs(jd - 2451545.0) < 0.001);
    const sys = keplerianSolarSystem('2000-01-01T12:00:00Z');
    const sun = sys.bodies.find((b) => b.key === 'sun')!;
    const earth = sys.bodies.find((b) => b.key === 'earth')!;
    const r = Math.hypot(earth.x - sun.x, earth.y - sun.y, (earth.z ?? 0) - (sun.z ?? 0));
    assert.ok(r > 0.98 && r < 1.02, `Earth r=${r}`);
    const el = classicalElements(
      { x: earth.x - sun.x, y: earth.y - sun.y, z: (earth.z ?? 0) - (sun.z ?? 0) },
      { x: earth.vx - sun.vx, y: earth.vy - sun.vy, z: (earth.vz ?? 0) - (sun.vz ?? 0) },
      G0 * (sun.mass + earth.mass),
    );
    assert.ok(el.a != null && Math.abs(el.a - 1) < 0.02, `a=${el.a}`);
    assert.ok(el.e < 0.03, `e=${el.e}`);
    const com = barycenter(
      sys.bodies.map((b, i) => ({
        ...b,
        id: i + 1,
        z: b.z ?? 0,
        vz: b.vz ?? 0,
        ax: 0, ay: 0, az: 0,
        physicalRadius: b.physicalRadius,
        collisionRadius: b.physicalRadius,
        renderRadius: b.renderRadius ?? b.physicalRadius,
        gravityMode: b.gravityMode ?? 'massive',
        createdAt: 0,
        trail: new Float32Array(0),
        trailHead: 0,
        trailCount: 0,
      })),
    );
    const sunOff = Math.hypot(sun.x - com.x, sun.y - com.y, (sun.z ?? 0) - com.z);
    assert.ok(sunOff > 1e-4, `sun offset from COM ${sunOff}`);
    assert.equal(sys.source, 'keplerian');
    assert.ok(!sys.bodies.some((b) => b.key === 'moon'));
  });
});

describe('Phase 2 — DE441 cache loader', () => {
  it('loads cached Horizons states with a free Sun, bound Earth, test-particle probes', async () => {
    const sys = await loadSolarSystem({
      epoch: '2026-09-11T00:00:00Z',
      includeSpacecraft: true,
      source: 'auto',
    });
    assert.equal(sys.source, 'horizons-cache');
    const sun = sys.bodies.find((b) => b.key === 'sun')!;
    const earth = sys.bodies.find((b) => b.key === 'earth')!;
    const moon = sys.bodies.find((b) => b.key === 'moon')!;
    const jwst = sys.bodies.find((b) => b.key === 'jwst')!;
    const v1 = sys.bodies.find((b) => b.key === 'voyager1')!;
    assert.ok(Math.hypot(sun.x, sun.y, sun.z ?? 0) > 0.001);
    const rE = Math.hypot(earth.x - sun.x, earth.y - sun.y, (earth.z ?? 0) - (sun.z ?? 0));
    assert.ok(rE > 0.98 && rE < 1.02, `Earth-Sun ${rE}`);
    const rM = Math.hypot(moon.x - earth.x, moon.y - earth.y, (moon.z ?? 0) - (earth.z ?? 0));
    assert.ok(rM > 0.002 && rM < 0.003, `Moon-Earth ${rM}`);
    assert.equal(jwst.gravityMode, 'test-particle');
    assert.equal(v1.gravityMode, 'test-particle');
    assert.ok(Math.hypot(v1.x, v1.y, v1.z ?? 0) > 100);

    const e = new Engine();
    e.collisionsEnabled = true;
    e.dt = 0.00012;
    e.reset(sys.bodies, { epoch: sys.epoch });
    const n0 = e.bodies.length;
    for (let i = 0; i < 200; i++) e.step();
    assert.equal(e.bodies.length, n0, 'real radii must not merge Earth-Moon or Parker-Sun');
    const earth2 = e.bodies.find((b) => b.key === 'earth')!;
    const el = e.orbitalElements(earth2, e.bodies.find((b) => b.key === 'sun')!);
    assert.equal(el.unbound, false);
    assert.ok(e.simulationDate instanceof Date);
  });

  it('cached Earth matches the parser fixture', () => {
    const c = HORIZONS_CACHE_2026_09_11.earth;
    const p = parseHorizonsVector(EARTH_FIXTURE, { jd: 2461294.5, scale: 'TDB' });
    assert.ok(Math.abs(c.x - p.state.position.x) < 1e-12);
    assert.ok(Math.abs(c.vx - p.state.velocity.x) < 1e-12);
  });

  it('horizons source at the cache epoch does not need a fetcher', async () => {
    const sys = await loadSolarSystem({
      epoch: '2026-09-11',
      includeSpacecraft: false,
      source: 'horizons',
    });
    assert.equal(sys.source, 'horizons-cache');
    assert.equal(sys.timeScale, 'TDB');
    assert.ok(sys.bodies.some((b) => b.key === 'earth'));
    assert.ok(!sys.bodies.some((b) => b.key === 'voyager1'));
  });

  it('auto at J2000 without a fetcher falls back to the Keplerian table', async () => {
    const sys = await loadSolarSystem({
      epoch: '2000-01-01',
      source: 'auto',
    });
    assert.equal(sys.source, 'keplerian');
    assert.ok(sys.warnings.some((w) => /PHYSICAL APPROXIMATION|Keplerian approximation/i.test(w)));
  });

  it('cached Galilean moons sit at real distances from Jupiter', async () => {
    const sys = await loadSolarSystem({
      epoch: '2026-09-11',
      includeMoons: true,
      includeSpacecraft: false,
      source: 'horizons',
    });
    const j = sys.bodies.find((b) => b.key === 'jupiter')!;
    const io = sys.bodies.find((b) => b.key === 'io')!;
    const titan = sys.bodies.find((b) => b.key === 'titan')!;
    const saturn = sys.bodies.find((b) => b.key === 'saturn')!;
    const rIo = Math.hypot(io.x - j.x, io.y - j.y, (io.z ?? 0) - (j.z ?? 0));
    assert.ok(rIo > 0.0025 && rIo < 0.0032, `Io-Jupiter ${rIo}`);
    const rT = Math.hypot(titan.x - saturn.x, titan.y - saturn.y, (titan.z ?? 0) - (saturn.z ?? 0));
    assert.ok(rT > 0.007 && rT < 0.009, `Titan-Saturn ${rT}`);
    assert.ok(!sys.bodies.some((b) => b.key === 'voyager1'));
  });
});
